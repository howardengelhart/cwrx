#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path        = require('path'),
        q           = require('q'),
        bcrypt      = require('bcrypt'),
        logger      = require('../lib/logger'),
        uuid        = require('../lib/uuid'),
        mongoUtils  = require('../lib/mongoUtils'),
        authUtils   = require('../lib/authUtils')(),
        service     = require('../lib/service'),
        enums       = require('../lib/enums'),
        Status      = enums.Status,

        state       = {},
        auth = {}; // for exporting functions to unit tests

    state.name = 'auth';
    // This is the template for auth's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/auth/caches/run/'),
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            db: 'sessions'
        },
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        secretsPath: path.join(process.env.HOME,'.auth.secrets.json'),
        mongo: {
            host: 'localhost',
            port: 27017,
            db: 'c6Db',
            retryConnect : true
        }
    };

    auth.login = function(req, users) {
        if (!req.body || !req.body.username || !req.body.password) {
            return q({
                code: 400,
                body: 'You need to provide a username and password in the body'
            });
        }
        var deferred = q.defer(),
            log = logger.getLog(),
            userAccount;

        log.info('[%1] Starting login for user %2', req.uuid, req.body.username);
        q.npost(users, 'findOne', [{username: req.body.username}])
        .then(function(account) {
            if (!account) {
                log.info('[%1] Failed login for user %2: unknown username',
                         req.uuid,req.body.username);
                return deferred.resolve({code: 401, body: 'Invalid username or password'});
            }
            userAccount = account;
            return q.npost(bcrypt, 'compare', [req.body.password, userAccount.password])
            .then(function(matching) {
                if (matching) {
                    if (account.status !== Status.Active) {
                        log.info('[%1] Failed login for user %2: account status is %3',
                                 req.uuid, req.body.username, account.status);
                        return deferred.resolve({code: 403, body: 'Account not active'});
                    }
                    log.info('[%1] Successful login for user %2', req.uuid, req.body.username);
                    var user = mongoUtils.safeUser(userAccount);
                    return q.npost(req.session, 'regenerate').then(function() {
                        req.session.user = user.id;
                        return deferred.resolve({
                            code: 200,
                            body: user
                        });
                    });
                } else {
                    log.info('[%1] Failed login for user %2: invalid password',
                             req.uuid, req.body.username);
                    return deferred.resolve({code: 401, body: 'Invalid username or password'});
                }
            });
        }).catch(function(error) {
            log.error('[%1] Error logging in user %2: %3', req.uuid, req.body.username, error);
            deferred.reject(error);
        });

        return deferred.promise;
    };

    auth.logout = function(req) {
        var deferred = q.defer(),
            log = logger.getLog();
        log.info('[%1] Starting logout for %2', req.uuid, req.sessionID);
        if (!req.session || !req.session.user) {
            log.info('[%1] User with sessionID %2 attempting to logout but is not logged in',
                     req.uuid, req.sessionID);
            deferred.resolve({code: 204});
        } else {
            log.info('[%1] Logging out user %2 with sessionID %3',
                     req.uuid, req.session.user, req.sessionID);
            q.npost(req.session, 'destroy').then(function() {
                deferred.resolve({code: 204});
            }).catch(function(error) {
                log.error('[%1] Error logging out user %2: %3',
                    req.uuid, req.session.user, error);
                deferred.reject(error);
            });
        }
        return deferred.promise;
    };

    auth.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var express     = require('express'),
            app         = express(),
            users       = state.db.collection('users'),
            authTTLs    = state.config.cacheTTLs.auth;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);

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
            if (    !req.headers['user-agent'] ||
                    !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });

        app.post('/api/auth/login', function(req, res/*, next*/) {
            auth.login(req, users).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing login'
                });
            });
        });

        app.post('/api/auth/logout', function(req, res/*, next*/) {
            auth.logout(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing logout'
                });
            });
        });

        var authGetUser = authUtils.middlewarify({});
        app.get('/api/auth/status', authGetUser, function(req, res/*, next*/) {
            res.send(200, req.user); // errors handled entirely by authGetUser
        });

        app.get('/api/auth/meta', function(req, res/*, next*/){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
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
        .then(auth.main)
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
        module.exports = auth;
    }
}());
