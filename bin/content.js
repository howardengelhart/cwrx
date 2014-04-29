#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        QueryCache      = require('../lib/queryCache'),
        FieldValidator  = require('../lib/fieldValidator'),
        authUtils       = require('../lib/authUtils')(),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Access          = enums.Access,
        Scope           = enums.Scope,
        
        state       = {},
        content = {}; // for exporting functions to unit tests

    state.name = 'content';
    // This is the template for content's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            experiences: {
                freshTTL: 1,
                maxTTL: 10
            },
            cloudFront: 5,
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            minAge: 60*1000, // TTL for cookies for unauthenticated users
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };

    // Check whether the user can operate on the experience according to their scope
    content.checkScope = function(user, experience, object, verb) {
        return !!(user && user.permissions && user.permissions[object] &&
                  user.permissions[object][verb] &&
             (user.permissions[object][verb] === Scope.All ||
             (user.permissions[object][verb] === Scope.Org && (user.org === experience.org ||
                                                               user.id === experience.user)) ||
             (user.permissions[object][verb] === Scope.Own && user.id === experience.user) ));
    };
    
    content.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            org:    function(exp, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('experiences','create',Scope.All);
                        return eqFunc(exp, orig, requester) || scopeFunc(exp, orig, requester);
                    }
        }
    });
    content.updateValidator = new FieldValidator({ forbidden: ['id', 'org', 'created'] });
    
    content.getMostRecentState = function(experience) {
        var log = logger.getLog(),
            newExp = {};
        
        for (var key in experience) {
            if (key === 'data') {
                if (!(experience.data instanceof Array)) {
                    log.warn('Experience %1 does not have array of data, not getting most recent',
                             experience.id);
                    newExp.data = experience.data;
                } else {
                    newExp.data = experience.data[0].data;
                }
            } else if (key === 'status') {
                if (!(experience.status instanceof Array)) {
                    log.warn('Experience %1 does not have status array, not getting most recent',
                             experience.id);
                    newExp.status = experience.status;
                } else {
                    newExp.status = experience.status[0].status;
                }
            } else {
                newExp[key] = experience[key];
            }
        }
        return newExp;
    };

    content.getExperiences = function(query, req, cache) {
        var limit = req.query && req.query.limit || 0,
            skip = req.query && req.query.skip || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog(),
            promise;
        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }
        query = QueryCache.formatQuery(query);
        
        if (req.user) { // don't use cache, access mongo collection directly
            log.info('[%1] User %2 getting experiences with %3, sort %4, limit %5, skip %6',
                     req.uuid,req.user.id,JSON.stringify(query),JSON.stringify(sortObj),limit,skip);
                     
            var opts = {sort: sortObj, limit: limit, skip: skip};
            promise = q.npost(cache._coll.find(query, opts), 'toArray');
            
        } else { // use cached promise
            log.info('[%1] Guest user getting experiences with %2, sort %3, limit %4, skip %5',
                     req.uuid, JSON.stringify(query), JSON.stringify(sortObj), limit, skip);
                     
            promise = cache.getPromise(query, sortObj, limit, skip);
        }
        return promise.then(function(results) {
            log.trace('[%1] Retrieved %2 experiences', req.uuid, results.length);
            
            var experiences = results.map(content.getMostRecentState).filter(function(result) {
                return result.status !== Status.Deleted &&
                      (content.checkScope(req.user, result, 'experiences', 'read') ||
                       (result.status === Status.Active && result.access === Access.Public) ||
                       (req.user && req.user.applications &&
                                    req.user.applications.indexOf(result.id) >= 0));
            });
            
            log.info('[%1] Showing the user %2 experiences', req.uuid, experiences.length);
            if (experiences.length === 0) {
                return q({code: 404, body: 'No experiences found'});
            } else {
                return q({code: 200, body: experiences});
            }
        }).catch(function(error) {
            log.error('[%1] Error getting experiences: %2', req.uuid, error);
            return q.reject(error);
        });
    };

    content.createExperience = function(req, experiences) {
        var obj = req.body,
            user = req.user,
            log = logger.getLog(),
            now = new Date();
        if (!obj || typeof obj !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        if (!content.createValidator.validate(obj, {}, user)) {
            log.warn('[%1] experience contains illegal fields', req.uuid);
            log.trace('exp: %1  |  requester: %2', JSON.stringify(obj), JSON.stringify(user));
            return q({code: 400, body: 'Illegal fields'});
        }
        obj.id = 'e-' + uuid.createUuid().substr(0,14);
        log.trace('[%1] User %2 is creating experience %3', req.uuid, user.id, obj.id);
        obj.created = now;
        obj.lastUpdated = now;
        obj.user = user.id;
        if (user.org) {
            obj.org = user.org;
        }
        if (!obj.status) {
            obj.status = Status.Active;
        }
        obj.status = [ { user: user.username, date: now, status: obj.status } ];
        if (!obj.access) {
            obj.access = Access.Public;
        }
        if (obj.data) {
            obj.data = [ { user: user.username, date: now, data: obj.data } ];
            if (obj.status[0].status === Status.Active) {
                obj.data[0].active = true;
            }
        }

        return q.npost(experiences, 'insert', [obj, {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created experience %3', req.uuid, user.id, obj.id);
            return q({code: 201, body: content.getMostRecentState(obj)});
        }).catch(function(error) {
            log.error('[%1] Error creating experience %2 for user %3: %4',
                      req.uuid, obj.id, user.id, error);
            return q.reject(error);
        });
    };
    
    content.compareData = function(a, b) {
        return JSON.stringify(QueryCache.sortQuery(a)) === JSON.stringify(QueryCache.sortQuery(b));
    };
    
    content.formatUpdates = function(req, orig, updates, user) {
        var log = logger.getLog(),
            now = new Date();

        if (!(orig.data instanceof Array)) {
            log.warn('[%1] Original exp %2 does not have an array of data', req.uuid, orig.id);
            orig.data = [ { user: user.username, date: orig.created, data: orig.data } ];
        }
        if (!(orig.status instanceof Array)) {
            log.warn('[%1] Original exp %2 does not have an array of statuses', req.uuid, orig.id);
            orig.status = [{user: user.username, date: orig.created, status: orig.status}];
        }

        if (updates.data) {
            if (!content.compareData(orig.data[0].data, updates.data)) {
                var dataWrapper = { user: user.username, date: now, data: updates.data };
                if (orig.status[0].status === Status.Active) {
                    dataWrapper.active = true;
                    orig.data.unshift(dataWrapper);
                } else if (orig.data[0].active) { // preserve previously active data
                    orig.data.unshift(dataWrapper);
                } else {
                    orig.data[0] = dataWrapper;
                }
                updates.data = orig.data;
            } else {
                delete updates.data;
            }
        }
        
        if (updates.status) {
            if (updates.status !== orig.status[0].status) {
                var statWrapper = { user: user.username, date: now, status: updates.status };
                if (updates.status === Status.Active) {
                    orig.data[0].active = true;
                    updates.data = orig.data;
                } else if (updates.data) {
                    delete updates.data[0].active;
                }
                orig.status.unshift(statWrapper);
                updates.status = orig.status;
            } else {
                delete updates.status;
            }
        }
        
        updates.lastUpdated = now;
    };

    content.updateExperience = function(req, experiences) {
        var updates = req.body,
            id = req.params.id,
            user = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        log.info('[%1] User %2 is attempting to update experience %3',req.uuid,user.id,id);
        q.npost(experiences, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist; not creating it', req.uuid, id);
                return deferred.resolve({code: 404, body: 'That experience does not exist'});
            }
            if (!content.updateValidator.validate(updates, orig, user)) {
                log.warn('[%1] updates contain illegal fields', req.uuid);
                log.trace('exp: %1  |  orig: %2  |  requester: %3',
                          JSON.stringify(updates), JSON.stringify(orig), JSON.stringify(user));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            if (!content.checkScope(user, orig, 'experiences', 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
                return deferred.resolve({
                    code: 403,
                    body: 'Not authorized to edit this experience'
                });
            }

            content.formatUpdates(req, orig, updates, user);

            return q.npost(experiences, 'findAndModify',
                           [{id: id}, {id: 1}, {$set: updates}, {w: 1, journal: true, new: true}])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated experience %3',
                         req.uuid, user.id, updated.id);
                deferred.resolve({code: 200, body: content.getMostRecentState(updated)});
            });
        }).catch(function(error) {
            log.error('[%1] Error updating experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    content.deleteExperience = function(req, experiences) {
        var id = req.params.id,
            user = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        log.info('[%1] User %2 is attempting to delete experience %3', req.uuid, user.id, id);
        q.npost(experiences, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            if (!content.checkScope(user, orig, 'experiences', 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return deferred.resolve({
                    code: 403,
                    body: 'Not authorized to delete this experience'
                });
            }

            if (orig.status[0] && orig.status[0].status === Status.Deleted) {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            
            var updates = { status: Status.Deleted };
            content.formatUpdates(req, orig, updates, user);

            return q.npost(experiences, 'update', [{id: id}, {$set: updates}, {w:1, journal:true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted experience %3', req.uuid, user.id, id);
                deferred.resolve({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    content.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
            
        var express     = require('express'),
            app         = express(),
            users       = state.dbs.c6Db.collection('users'),
            authTTLs    = state.config.cacheTTLs.auth;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);

        app.use(express.bodyParser());
        app.use(express.cookieParser(state.secrets.cookieParser || ''));
        
        var sessions = express.session({
            key: state.config.sessions.key,
            cookie: {
                httpOnly: false,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        });

        app.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.all('*', function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-Health/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });
        
        var experiences = state.dbs.c6Db.collection('experiences');
        var expTTLs = state.config.cacheTTLs.experiences;
        var expCache = new QueryCache(expTTLs.freshTTL, expTTLs.maxTTL, experiences);

        // public get experience by id
        app.get('/api/public/content/experience/:id', function(req, res) {
            content.getExperiences({id: req.params.id}, req, expCache)
            .then(function(resp) {
                res.header('cache-control', 'max-age=' + state.config.cacheTTLs.cloudFront*60);
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.header('cache-control', 'max-age=60');
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });
        
        // public get experience by id
        app.get('/api/content/public/experience/:id', function(req, res) {
            content.getExperiences({id: req.params.id}, req, expCache)
            .then(function(resp) {
                res.header('cache-control', 'max-age=' + state.config.cacheTTLs.cloudFront*60);
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.header('cache-control', 'max-age=60');
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });
        
        var authGetExp = authUtils.middlewarify({experiences: 'read'});
        
        // private get experience by id
        app.get('/api/content/experience/:id', sessions, authGetExp, function(req, res) {
            content.getExperiences({id: req.params.id}, req, expCache)
            .then(function(resp) {
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });

        // private get experience by query
        app.get('/api/content/experiences', sessions, authGetExp, function(req, res) {
            var queryFields = ['ids', 'user', 'org', 'type'];
            function isKeyInFields(key) {
                return queryFields.indexOf(key) >= 0;
            }
            if (!req.query || !(Object.keys(req.query).some(isKeyInFields))) {
                log.info('[%1] Cannot GET /content/experiences with no query params',req.uuid);
                return res.send(400, 'Must specify at least one supported query param');
            }
            var query = {};
            if (req.query.ids) {
                query.id = req.query.ids.split(',');
            }
            if (req.query.user) {
                query.user = req.query.user;
            }
            if (req.query.org) {
                query.org = req.query.org;
            }
            if (req.query.type) {
                query.type = req.query.type;
            }
            content.getExperiences(query, req, expCache)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });
        
        var authPostExp = authUtils.middlewarify({experiences: 'create'});
        app.post('/api/content/experience', sessions, authPostExp, function(req, res) {
            content.createExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating experience',
                    detail: error
                });
            });
        });
        
        var authPutExp = authUtils.middlewarify({experiences: 'edit'});
        app.put('/api/content/experience/:id', sessions, authPutExp, function(req, res) {
            content.updateExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating experience',
                    detail: error
                });
            });
        });
        
        var authDelExp = authUtils.middlewarify({experiences: 'delete'});
        app.delete('/api/content/experience/:id', sessions, authDelExp, function(req, res) {
            content.deleteExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting experience',
                    detail: error
                });
            });
        });
        
        app.get('/api/content/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/content/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(function(err, req, res, next) {
            if (err) {
                log.error('Error: %1', err);
                res.send(500, 'Internal error');
            } else {
                next();
            }
        });
        
        app.listen(state.cmdl.port);
        log.info('Service is listening on port: ' + state.cmdl.port);

        return state;
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(service.initMongo)
        .then(service.initSessionStore)
        .then(content.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.message || err);
            log.error(err.message || err);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = content;
    }
}());
