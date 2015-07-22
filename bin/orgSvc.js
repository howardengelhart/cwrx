#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        CrudSvc         = require('../lib/crudSvc'),
        journal         = require('../lib/journal'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        
        state = {},
        orgModule = {}; // for exporting functions to unit tests

    // This is the template for user's configuration
    state.defaultConfig = {
        appName: 'orgSvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/orgSvc/caches/run/'),
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000,   // 14 days; unit here is milliseconds
            minAge: 60*1000,            // TTL for cookies for unauthenticated users
            secure: false,              // true == HTTPS-only; set to true for staging/production
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
            },
            c6Journal: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };
    
    orgModule.setupSvc = function(coll, userColl) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(coll, 'o', opts);
            
        svc._userColl = userColl;
        
        svc.userPermQuery = orgModule.userPermQuery;
        svc.checkScope = orgModule.checkScope;
        
        svc.createValidator._required.push('name');
        svc.createValidator._condForbidden.adConfig = orgModule.checkAdConfig.bind(orgModule, svc);
        svc.editValidator._condForbidden.adConfig = orgModule.checkAdConfig.bind(orgModule, svc);
        
        svc.use('read', svc.preventGetAll.bind(svc));

        svc.use('create', orgModule.createPermCheck);
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', orgModule.setupConfig);

        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));
        
        svc.use('delete', orgModule.deletePermCheck);
        svc.use('delete', orgModule.activeUserCheck.bind(orgModule, svc));
        
        return svc;
    };
    
    // Check whether the requester can change the org's adConfig
    orgModule.checkAdConfig = function(svc, updates, orig, requester) {
        return svc.checkScope(requester, orig, 'editAdConfig');
    };

    
    // Check whether the requester can operate on the target org according to their scope
    orgModule.checkScope = function(requester, org, verb) {
        return !!(requester && requester.permissions && requester.permissions.orgs &&
                  requester.permissions.orgs[verb] &&
             ( (requester.permissions.orgs[verb] === Scope.All) ||
               (requester.permissions.orgs[verb] === Scope.Org && requester.org === org.id) ||
               (requester.permissions.orgs[verb] === Scope.Own && requester.org === org.id) ) );
    };

    // Adds fields to a find query to filter out orgs the requester can't see
    orgModule.userPermQuery = function(query, requester) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            readScope = (requester.permissions.orgs || {}).read,
            log = logger.getLog();
        
        newQuery.status = {$ne: Status.Deleted}; // never show deleted users
        
        if (!Scope.isScope(readScope)) {
            log.warn('User has invalid scope ' + readScope);
            readScope = Scope.Own;
        }
        
        if (readScope === Scope.Own || readScope === Scope.Org) {
            newQuery.id = requester.org;
        }
        
        return newQuery;
    };
    
    orgModule.createPermCheck = function(req, next, done) {
        var log = logger.getLog();

        if (req.user.permissions.orgs.create !== Scope.All) {
            log.info('[%1] User %2 is not authorized to create orgs', req.uuid, req.user.id);
            return q(done({ code: 403, body: 'Not authorized to create orgs' }));
        }

        return q(next());
    };

    orgModule.setupConfig = function(req, next/*, done*/) {
        if (!req.body.config) {
            req.body.config = {};
        }

        if (!req.body.waterfalls) {
            req.body.waterfalls = {};
        }
        
        objUtils.extend(req.body.waterfalls, {
            video: ['cinema6'],
            display: ['cinema6']
        });
        
        return q(next());
    };
    
    orgModule.deletePermCheck = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.params.id === req.user.org) {
            log.info('[%1] User %2 tried to delete their own org', req.uuid, req.user.id);
            return q(done({ code: 400, body: 'You cannot delete your own org' }));
        }

        if (req.user.permissions.orgs.delete !== Scope.All) {
            log.info('[%1] User %2 is not authorized to delete orgs', req.uuid, req.user.id);
            return q(done({ code: 403, body: 'Not authorized to delete orgs' }));
        }

        return q(next());
    };
    
    orgModule.activeUserCheck = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { org: req.params.id, status: { $ne: Status.Deleted } };

        return q.npost(svc._userColl.find(query), 'count')
        .then(function(count) {
            if (count > 0) {
                log.info('[%1] Can\'t delete org %2 since it still has %3 active users',
                         req.uuid, req.params.id, count);
                return done({ code: 400, body: 'Org still has active users' });
            }
            
            return q(next());
        });
    };

    // Main
    orgModule.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
            
        var app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            orgs         = state.dbs.c6Db.collection('orgs'),
            orgSvc       = orgModule.setupSvc(orgs, users),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
        var sessionOpts = {
            key: state.config.sessions.key,
            resave: false,
            secret: state.secrets.cookieParser || '',
            cookie: {
                httpOnly: true,
                secure: state.config.sessions.secure,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        };
        
        var sessions = sessionLib(sessionOpts);

        app.set('trust proxy', 1);

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            orgs  = state.dbs.c6Db.collection('orgs');
            orgSvc._coll = orgs;
            orgSvc._userColl = users;
            authUtils._db = state.dbs.c6Db;
            log.info('Recreated collections from restarted c6Db');
        });
        
        state.dbStatus.sessions.on('reconnected', function() {
            sessionOpts.store = state.sessionStore;
            sessions = sessionLib(sessionOpts);
            log.info('Recreated session store from restarted db');
        });

        state.dbStatus.c6Journal.on('reconnected', function() {
            auditJournal.resetColl(state.dbs.c6Journal.collection('audit'));
            log.info('Reset journal\'s collection from restarted db');
        });


        app.use(function(req, res, next) {
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.use(function(req, res, next) {
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
            res.send(200, state.config.appVersion);
        });


        app.use(bodyParser.json());
        
        var authGetOrg = authUtils.middlewarify({orgs: 'read'});
        app.get('/api/account/org/:id', sessWrap, authGetOrg, audit, function(req, res) {
            orgSvc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving org',
                    detail: error
                });
            });
        });

        app.get('/api/account/orgs', sessWrap, authGetOrg, audit, function(req, res) {
            var query = {};
            if (req.query.ids) {
                query.id = req.query.ids.split(',');
            }

            orgSvc.getObjs(query, req, true)
            .then(function(resp) {
                if (resp.headers && resp.headers['content-range']) {
                    res.header('content-range', resp.headers['content-range']);
                }

                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving orgs',
                    detail: error
                });
            });
        });

        var authPostOrg = authUtils.middlewarify({orgs: 'create'});
        app.post('/api/account/org', sessWrap, authPostOrg, audit, function(req, res) {
            orgSvc.createObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating org',
                    detail: error
                });
            });
        });

        var authPutOrg = authUtils.middlewarify({orgs: 'edit'});
        app.put('/api/account/org/:id', sessWrap, authPutOrg, audit, function(req, res) {
            orgSvc.editObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating org',
                    detail: error
                });
            });
        });

        var authDelOrg = authUtils.middlewarify({orgs: 'delete'});
        app.delete('/api/account/org/:id', sessWrap, authDelOrg, audit, function(req, res) {
            orgSvc.deleteObj(req)
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
                if (err.status && err.status < 500) {
                    log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                    res.send(err.status, err.message || 'Bad Request');
                } else {
                    log.error('[%1] Internal Error: %2', req.uuid, err && err.message || err);
                    res.send(err.status || 500, err.message || 'Internal error');
                }
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
        .then(orgModule.main)
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
        module.exports = orgModule;
    }

}());

