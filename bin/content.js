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
        mongoUtils      = require('../lib/mongoUtils'),
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
            experiences: 1,
            cloudFront: 5,
            auth: 10
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            db: 'sessions'
        },
        secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
        mongo: {
            host: 'localhost',
            port: 27017,
            db: 'c6Db',
            retryConnect : true
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
            org: [FieldValidator.eqReqFieldFunc('org'),
                  FieldValidator.scopeFunc('experiences', 'create', Scope.All)]
        }
    });
    content.updateValidator = new FieldValidator({ forbidden: ['id', 'org', 'created'] });

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
            var experiences = results.filter(function(result) {
                return content.checkScope(req.user, result, 'experiences', 'read') ||
                      (result.status === Status.Active && result.access === Access.Public);
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
        if (!obj.access) {
            obj.access = Access.Public;
        }
        return q.npost(experiences, 'insert', [obj, {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created experience %3', req.uuid, user.id, obj.id);
            return q({code: 201, body: obj});
        }).catch(function(error) {
            log.error('[%1] Error creating experience %2 for user %3: %4',
                      req.uuid, obj.id, user.id, error);
            return q.reject(error);
        });
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
        
        log.info('[%1] User %2 is attempting to update experience %3',req.uuid,user.id,updates.id);
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
            updates.lastUpdated = new Date();
            return q.npost(experiences, 'findAndModify',
                           [{id: id}, {id: 1}, {$set: updates}, {w: 1, journal: true, new: true}])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated experience %3',
                         req.uuid, user.id, updated.id);
                deferred.resolve({code: 200, body: updated});
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
            deferred = q.defer(),
            now;
        log.info('[%1] User %2 is attempting to delete experience %3', req.uuid, user.id, id);
        q.npost(experiences, 'findOne', [{id: id}])
        .then(function(orig) {
            now = new Date();
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
            if (orig.status === Status.Deleted) {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            return q.npost(experiences, 'update', [{id: id},
                           {$set: {lastUpdated:now, status:Status.Deleted}}, {w:1, journal:true}])
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
            app         = express();
        // set auth cacheTTL now that we've loaded config
        authUtils = require('../lib/authUtils')(state.config.cacheTTLs.auth);

        // if connection to mongo is down; immediately reject all requests
        // otherwise the request will hang trying to get the session from mongo
        app.use(function(req, res, next) {
            mongoUtils.checkRunning(state.config.mongo.host, state.config.mongo.port)
            .then(function() {
                next();
            }).catch(function(error) {
                log.error('Connection to mongo is down: %1', error);
                res.send(500, 'Connection to database is down');
            });
        });

        app.use(express.bodyParser());
        app.use(express.cookieParser(state.secrets.cookieParser || ''));
        app.use(express.session({
            key: state.config.sessions.key,
            cookie: {
                httpOnly: false,
                maxAge: state.config.sessions.maxAge
            },
            store: state.sessionStore
        }));

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
        
        var experiences = state.db.collection('experiences');
        var expCache = new QueryCache(state.config.cacheTTLs.experiences, experiences);
        
        // simple get active experience by id, public
        app.get('/api/content/experience/:id', function(req, res/*, next*/) {
            var promise;
            if (req.session.user) {
                log.trace('[%1] Attempting to look up user %2 for public GET experiences',
                          req.uuid, req.session.user);
                promise = authUtils.getUser(req.session.user, state.db)
                .then(function(user) {
                    if (!user) {
                        log.warn('[%1] User %2 could not be found', req.uuid, req.session.user);
                    } else {
                        log.trace('[%1] Found user %2', req.uuid, user.id);
                        req.user = user;
                    }
                }).catch(function(error) {
                    log.error('[%1] Could not look up user %2: %3',
                              req.uuid, req.session.user, JSON.stringify(error));
                });
            } else {
                promise = q();
            }
            promise.then(function() {
                return content.getExperiences({id: req.params.id}, req, expCache);
            }).then(function(resp) {
                if (!req.user) {
                    res.header('cache-control', 'max-age=' + state.config.cacheTTLs.cloudFront*60);
                }
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                if (!req.user) {   // cache errors for shorter time
                    res.header('cache-control', 'max-age=60');
                }
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });

        // robust get experience by query, requires authenticated user with read perms
        var authGetExp = authUtils.middlewarify(state.db, {experiences: 'read'});
        app.get('/api/content/experiences', authGetExp, function(req, res/*, next*/) {
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
        
        var authPostExp = authUtils.middlewarify(state.db, {experiences: 'create'});
        app.post('/api/content/experience', authPostExp, function(req, res/*, next*/) {
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
        
        var authPutExp = authUtils.middlewarify(state.db, {experiences: 'edit'});
        app.put('/api/content/experience/:id', authPutExp, function(req, res/*, next*/) {
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
        
        var authDelExp = authUtils.middlewarify(state.db, {experiences: 'delete'});
        app.delete('/api/content/experience/:id', authDelExp, function(req, res/*, next*/) {
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
        
        app.get('/api/content/meta', function(req, res/*, next*/){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
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
