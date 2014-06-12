#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        FieldValidator  = require('../lib/fieldValidator'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils')(),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        
        state       = {},
        orgSvc     = {}; // for exporting functions to unit tests

    state.name = 'org';

    // This is the template for user's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/orgSvc/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
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
        secretsPath: path.join(process.env.HOME,'.orgSvc.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };

    // Check whether the requester can operate on the target org according to their scope
    orgSvc.checkScope = function(requester, org, verb) {
        return !!(requester && requester.permissions && requester.permissions.orgs &&
                  requester.permissions.orgs[verb] &&
             (requester.permissions.orgs[verb] === Scope.All ||
             (requester.permissions.orgs[verb] === Scope.Org && requester.org === org.id)||
             (requester.permissions.orgs[verb] === Scope.Own && requester.org === org.id) ));
    };

    // Validate fields when creating an org
    orgSvc.createValidator = new FieldValidator({
        forbidden: ['id', 'created']
    });

    // Validate fields when updating an org
    orgSvc.updateValidator = new FieldValidator({
        forbidden: ['id', 'name', 'created', '_id'],
    });

    // Get a single org from mongo
    orgSvc.getOrg = function(req, orgs) {

        var id = req.params.id,
            log = logger.getLog();

        if (!orgSvc.checkScope(req.user,{id: id},'read')) {
            log.info('[%1] User %2 is not authorized to read org %3', req.uuid, req.user.id, id);
            return q({code: 403, body: 'Not authorized to read org'});
        }
        log.info('[%1] User %2 getting org %3', req.uuid,req.user.id, id);
        return q.npost(orgs.find({ id: id }), 'toArray')
        .then(function(results) {
            log.trace('[%1] Retrieved %2 orgs', req.uuid, results.length);
            if(results.length === 0){
                log.info('[%1] Showing the requester no org documents', req.uuid);
                return q({code: 404, body: 'No orgs found'});
            }
            if(results.length !== 1){
                log.warn('[%1] There is more than one org with id %2, getting first', req.uuid, id);
            }
            var org = results[0];
            if (org.status === Status.Deleted) {
                log.info('[%1] Showing the requester no org documents', req.uuid);
                return q({code: 404, body: 'No orgs found'});
            } else {
                delete org._id;
                org = mongoUtils.unescapeKeys(org);
                log.info('[%1] Showing the requester org %2', req.uuid, org.id);
                return q({code: 200, body: org});
            }
        }).catch(function(error) {
            log.error('[%1] Error getting orgs: %2', req.uuid, error);
            return q.reject(error);
        });
    };

    // Get a list of all orgs from mongo
    orgSvc.getOrgs = function(req, orgs) {

        var limit = req.query && req.query.limit || 0,
            skip = req.query && req.query.skip || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog();

        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }

        if (!(req.user.permissions &&
              req.user.permissions.orgs &&
              req.user.permissions.orgs.read &&
              req.user.permissions.orgs.read === Scope.All)) {
            log.info('[%1] User %2 is not authorized to read all orgs', req.uuid, req.user.id);
            return q({code: 403, body: 'Not authorized to read all orgs'});
        }

        log.info('[%1] User %2 getting orgs with sort %3, limit %4, skip %5', req.uuid,
                 req.user.id, JSON.stringify(sortObj), limit, skip);
        return q.npost(orgs.find({}, {sort: sortObj, limit: limit, skip: skip}), 'toArray')
        .then(function(results) {
            log.trace('[%1] Retrieved %2 orgs', req.uuid, results.length);
            var orgs = results.filter(function(result) {
                return result.status !== Status.Deleted;
            });
            orgs = orgs.map(function(result){
                delete result._id;
                return mongoUtils.unescapeKeys(result);
            });
            log.info('[%1] Showing the requester %2 org documents', req.uuid, orgs.length);
            if (orgs.length === 0) {
                return q({code: 404, body: 'No orgs found'});
            } else {
                return q({code: 200, body: orgs});
            }
        }).catch(function(error) {
            log.error('[%1] Error getting orgs: %2', req.uuid, error);
            return q.reject(error);
        });
    };

    // Setup a new org with reasonable defaults
    orgSvc.setupOrg = function(newOrg) {
        var now = new Date();
        newOrg.id = 'o-' + uuid.createUuid().substr(0,14);
        newOrg.created = now;
        newOrg.lastUpdated = now;
        if (!newOrg.status) {
            newOrg.status = Status.Active;
        }
        if (!newOrg.waterfalls) {
            newOrg.waterfalls = {};
        }
        var defaultWaterfalls = {
            video: ['c6'],
            display: ['c6']
        };
        Object.keys(defaultWaterfalls).forEach(function(key) {
            if (!newOrg.waterfalls[key]) {
                newOrg.waterfalls[key] = defaultWaterfalls[key];
            }
        });
        delete newOrg._id;
        newOrg = mongoUtils.escapeKeys(newOrg);
    };

    // Create an org in mongo
    orgSvc.createOrg = function(req, orgs) {
        var newOrg = req.body,
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!newOrg || typeof newOrg !== 'object' || Object.keys(newOrg).length === 0) {
            return q({code: 400, body: 'You must provide an object in the body'});
        } else if (!newOrg.name) {
            return q({code: 400, body: 'New org object must have a name'});
        }
        if (!(requester && requester.permissions && requester.permissions.orgs &&
                           requester.permissions.orgs.create === Scope.All)) {
            log.info('[%1] User %2 is not authorized to create orgs', req.uuid, requester.id);
            return q({code: 403, body: 'Not authorized to create orgs'});
        }

        // check if an org already exists with that name
        q.npost(orgs, 'findOne', [{name: newOrg.name}])
        .then(function(orgAccount) {
            if (orgAccount) {
                log.info('[%1] Org %2 already exists', req.uuid, req.body.name);
                return deferred.resolve({
                    code: 409,
                    body: 'An org with that name already exists'
                });
            }
            if (!orgSvc.createValidator.validate(newOrg, {}, requester)) {
                log.warn('[%1] newOrg contains illegal fields', req.uuid);
                log.trace('newOrg: %1  |  requester: %2',
                          JSON.stringify(newOrg), JSON.stringify(requester));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            orgSvc.setupOrg(newOrg);
            log.trace('[%1] User %2 is creating org %3', req.uuid, requester.id, newOrg.id);
            return q.npost(orgs, 'insert', [newOrg, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully created org %3 with id: %4',
                         req.uuid, requester.id, newOrg.name, newOrg.id);
                delete newOrg._id;
                newOrg = mongoUtils.unescapeKeys(newOrg);
                deferred.resolve({ code: 201, body: newOrg });
            });
        }).catch(function(error) {
            log.error('[%1] Error creating org %2 for user %3: %4',
                      req.uuid, newOrg.id, requester.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    // Update an org in mongo
    orgSvc.updateOrg = function(req, orgs) {
        var updates = req.body,
            id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        log.info('[%1] User %2 is attempting to update org %3', req.uuid, requester.id, id);
        if (!orgSvc.checkScope(requester, {id: id}, 'edit')) {
            log.info('[%1] User %2 is not authorized to edit %3', req.uuid, requester.id, id);
            return q({code: 403, body: 'Not authorized to edit this org'});
        }
        q.npost(orgs, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Org %2 does not exist; not creating them', req.uuid, id);
                return deferred.resolve({code: 404, body: 'That org does not exist'});
            }
            if (!orgSvc.updateValidator.validate(updates, orig, requester)) {
                log.warn('[%1] Updates contain illegal fields', req.uuid);
                log.trace('updates: %1  |  orig: %2  |  requester: %3', JSON.stringify(updates),
                          JSON.stringify(orig), JSON.stringify(requester));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            updates.lastUpdated = new Date();
            var updateObj = { $set: mongoUtils.escapeKeys(updates) };
            var opts = {w: 1, journal: true, new: true};
            return q.npost(orgs, 'findAndModify', [{id: id}, {id: 1}, updateObj, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated org %3',
                         req.uuid, requester.id, updated.id);
                delete updated._id;
                updated = mongoUtils.unescapeKeys(updated);
                deferred.resolve({code: 200, body: updated});
            });
        }).catch(function(error) {
            log.error('[%1] Error updating org %2 for user %3: %4',req.uuid,id,requester.id,error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    // Delete an org from mongo
    orgSvc.deleteOrg = function(req, orgs) {
        var id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer(),
            now;
        if (id === requester.org) {
            log.warn('[%1] User %2 tried to delete their own org', req.uuid, requester.id);
            return q({code: 400, body: 'You cannot delete your own org'});
        }
        log.info('[%1] User %2 is attempting to delete org %3', req.uuid, requester.id, id);
        if (!(req.user.permissions &&
              req.user.permissions.orgs &&
              req.user.permissions.orgs.delete &&
              req.user.permissions.orgs.delete === Scope.All)) {
            log.info('[%1] User %2 is not authorized to delete org %3', req.uuid, req.user.id, id);
            return q({code: 403, body: 'Not authorized to delete this org'});
        }
        q.npost(orgs, 'findOne', [{id: id}])
        .then(function(orig) {
            now = new Date();
            if (!orig) {
                log.info('[%1] Org %2 does not exist', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            if (orig.status === Status.Deleted) {
                log.info('[%1] Org %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            var updates = {$set: {lastUpdated: now, status: Status.Deleted}};
            return q.npost(orgs, 'update', [{id:id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted org %3', req.uuid, requester.id, id);
                deferred.resolve({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting org %2 for user %3: %4',req.uuid,id,requester.id,error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    // Main
    orgSvc.main = function(state) {
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
            orgs       = state.dbs.c6Db.collection('orgs'),
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

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            orgs  = state.dbs.c6Db.collection('orgs');
            authUtils._cache._coll = users;
            log.info('Recreated collections from restarted c6Db');
        });
        
        state.dbStatus.sessions.on('reconnected', function() {
            sessions = express.session({
                key: state.config.sessions.key,
                cookie: {
                    httpOnly: false,
                    maxAge: state.config.sessions.minAge
                },
                store: state.sessionStore
            });
            log.info('Recreated session store from restarted db');
        });

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessionsWrapper(req, res, next) {
            sessions(req, res, next);
        }

        app.all('*', function(req, res, next) {
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
        
        app.get('/api/account/org/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });
        
        app.get('/api/account/org/version',function(req, res) {
            res.send(200, state.config.version);
        });

        var authGetUser = authUtils.middlewarify({orgs: 'read'});
        app.get('/api/account/org/:id', sessionsWrapper, authGetUser, function(req,res){
            orgSvc.getOrg(req, orgs)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving org',
                    detail: error
                });
            });
        });

        app.get('/api/account/orgs', sessionsWrapper, authGetUser, function(req, res) {
            orgSvc.getOrgs(req, orgs)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving orgs',
                    detail: error
                });
            });
        });

        var authPostUser = authUtils.middlewarify({orgs: 'create'});
        app.post('/api/account/org', sessionsWrapper, authPostUser, function(req, res) {
            orgSvc.createOrg(req, orgs)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating org',
                    detail: error
                });
            });
        });

        var authPutUser = authUtils.middlewarify({orgs: 'edit'});
        app.put('/api/account/org/:id', sessionsWrapper, authPutUser, function(req, res) {
            orgSvc.updateOrg(req, orgs)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating org',
                    detail: error
                });
            });
        });

        var authDelUser = authUtils.middlewarify({orgs: 'delete'});
        app.delete('/api/account/org/:id', sessionsWrapper, authDelUser, function(req, res) {
            orgSvc.deleteOrg(req, orgs)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting org',
                    detail: error
                });
            });
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
        .then(orgSvc.main)
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
        module.exports = orgSvc;
    }

}());

