#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        bcrypt          = require('bcrypt'),
        crypto          = require('crypto'),
        aws             = require('aws-sdk'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        expressUtils    = require('../lib/expressUtils'),
        logger          = require('../lib/logger'),
        mongoUtils      = require('../lib/mongoUtils'),
        journal         = require('../lib/journal'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        email           = require('../lib/email'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,

        state   = {},
        auth    = {}; // for exporting functions to unit tests

    // This is the template for auth's configuration
    state.defaultConfig = {
        appName: 'auth',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/auth/caches/run/'),
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 30*60*1000,         // 30 minutes; unit here is milliseconds
            minAge: 60*1000,            // TTL for cookies for unauthenticated users
            secure: false,              // true == HTTPS-only; set to true for staging/production
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        emails: {
            awsRegion: 'us-east-1',
            sender: 'no-reply@cinema6.com',
            supportAddress: 'support@cinema6.com'
        },
        forgotTargets: {
            portal: 'http://localhost:9000/#/password/reset',
            selfie: 'http://localhost:9000/#/pass/reset?selfie=true'
        },
        passwordResetPages: {
            portal: 'http://localhost:9000/#/password/forgot',
            selfie: 'http://localhost:9000/#/pass/forgot?selfie=true'
        },
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
        },
        pubsub: {
            cacheCfg: {
                port: 21211,
                isPublisher: false
            }
        },
        cache: {
            timeouts: {},
            servers: null
        },
        resetTokenTTL   : 1*30*60*1000, // 30 minutes; unit here is milliseconds
        loginAttempts: {
            ttl: 15*60*1000,            // 15 minutes; unit here is milliseconds
            threshold: 3
        },
        secretsPath     : path.join(process.env.HOME,'.auth.secrets.json')
    };

    auth.login = function(req, users, config, auditJournal, cache) {
        if (!req.body || typeof req.body.email !== 'string' ||
                         typeof req.body.password !== 'string') {
            return q({ code: 400, body: 'You need to provide an email and password in the body' });
        }
        var deferred = q.defer(),
            log = logger.getLog(),
            userAccount,
            maxAge = config.sessions.maxAge,
            loginAttempts = config.loginAttempts,
            targets = config.passwordResetPages;
            
        req.body.email = req.body.email.toLowerCase();

        log.info('[%1] Starting login for user %2', req.uuid, req.body.email);
        mongoUtils.findObject(users, { email: req.body.email })
        .then(function(account) {
            if (!account) {
                log.info('[%1] Failed login for user %2: unknown email', req.uuid, req.body.email);
                return deferred.resolve({code: 401, body: 'Invalid email or password'});
            }
            userAccount = account;
            return q.npost(bcrypt, 'compare', [req.body.password, userAccount.password])
            .then(function(matching) {
                var cacheKey = 'loginAttempts:' + userAccount.id;
                if (!matching) {
                    return cache.add(cacheKey, 0, loginAttempts.ttl)
                        .then(function() {
                            return cache.incrTouch(cacheKey, 1, loginAttempts.ttl);
                        })
                        .then(function(numAttempts) {
                            log.info('[%1] Failed login attempt #%2 for user %3: invalid password',
                                     req.uuid, numAttempts, req.body.email);
                            if (numAttempts === loginAttempts.threshold) {
                                log.info('[%1] Sending email to %2 suggesting password reset ' +
                                    'after %3 failed login attempts',
                                    req.uuid, req.body.email, numAttempts);
                                    
                                var target = targets[(userAccount.external) ? 'selfie' : 'portal'];
                                return email.failedLogins(
                                    config.emails.sender,
                                    req.body.email,
                                    target
                                );
                            }
                        })
                        .catch(function(error) {
                            log.warn('[%1] Error updating login attempts for user %2: %3',
                                req.uuid, userAccount.id, error);
                        })
                        .finally(function() {
                            return deferred.resolve({code: 401, body: 'Invalid email or password'});
                        });
                }
                
                if (account.status !== Status.Active && account.status !== Status.New) {
                    log.info('[%1] Failed login for user %2: account status is %3',
                             req.uuid, req.body.email, account.status);
                    return deferred.resolve({code: 403, body: 'Account not active or new'});
                }

                log.info('[%1] Successful login for user %2', req.uuid, req.body.email);
                var user = mongoUtils.safeUser(userAccount);

                return cache.delete(cacheKey)
                .catch(function(error) {
                    log.warn('[%1] Failed deleting key %2 in cache: %3', req.uuid, cacheKey,
                             error && error.stack || error);
                })
                .then(function() {
                    return q.npost(req.session, 'regenerate');
                })
                .then(function() {
                    return authUtils.decorateUser(user);
                })
                .then(function(decorated) {
                    auditJournal.writeAuditEntry(req, decorated.id);

                    req.session.user = decorated.id;
                    req.session.cookie.maxAge = maxAge;
                    return deferred.resolve({
                        code: 200,
                        body: decorated
                    });
                });
            });
        }).catch(function(error) {
            log.error('[%1] Error logging in user %2: %3', req.uuid, req.body.email, error);
            deferred.reject(error);
        });

        return deferred.promise;
    };

    auth.logout = function(req, auditJournal) {
        var deferred = q.defer(),
            log = logger.getLog();

        log.info('[%1] Starting logout for %2', req.uuid, req.sessionID);

        if (!req.session || !req.session.user) {
            log.info('[%1] User with sessionID %2 attempting to logout but is not logged in',
                     req.uuid, req.sessionID);
            deferred.resolve({code: 204});
        } else {
            var user = req.session.user;
            auditJournal.writeAuditEntry(req, user);
            log.info('[%1] Logging out user %2 with sessionID %3', req.uuid, user, req.sessionID);

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
    
    auth.forgotPassword = function(req, users, config, auditJournal) {
        var log = logger.getLog(),
            now = new Date(),
            reqEmail = req.body && req.body.email,
            targetName = req.body && req.body.target || '',
            target = config.forgotTargets[targetName] || '',
            token;
        
        if (typeof reqEmail !== 'string' || !targetName) {
            log.info('[%1] Incomplete forgot password request', req.uuid);
            return q({code: 400, body: 'Need to provide email and target in the request'});
        }
        if (!target) {
            log.info('[%1] Invalid target %2, only accept %3',
                     req.uuid, targetName, Object.keys(config.forgotTargets));
            return q({code: 400, body: 'Invalid target'});
        }
        
        reqEmail = reqEmail.toLowerCase();
        
        log.info('[%1] User %2 forgot their password, sending reset code', req.uuid, reqEmail);
        
        return mongoUtils.findObject(users, { email: reqEmail })
        .then(function(account) {
            if (!account) {
                log.info('[%1] No user with email %2 exists', req.uuid, reqEmail);
                return q({code: 404, body: 'That user does not exist'});
            }
            
            if (account.status !== Status.Active) {
                log.info('[%1] User %2 not active', req.uuid, reqEmail);
                return q({code: 403, body: 'Account not active'});
            }

            auditJournal.writeAuditEntry(req, account.id);

            return q.npost(crypto, 'randomBytes', [24])
            .then(function(buff) {
                token = buff.toString('hex');
                return q.npost(bcrypt, 'hash', [token, bcrypt.genSaltSync()]);
            })
            .then(function(hashed) {
                var updates = {
                    resetToken: {
                        token: hashed,
                        expires: new Date(now.valueOf() + config.resetTokenTTL)
                    }
                };
                return mongoUtils.editObject(users, updates, account.id);
            })
            .then(function() {
                log.info('[%1] Saved reset token for %2 to database', req.uuid, reqEmail);

                var url = target + ((target.indexOf('?') === -1) ? '?' : '&') +
                          'id=' + account.id + '&token=' + token;

                return email.resetPassword(config.emails.sender, reqEmail, url);
            })
            .then(function() {
                log.info('[%1] Successfully sent reset email to %2', req.uuid, reqEmail);
                return q({code: 200, body: 'Successfully generated reset token'});
            });
        })
        .catch(function(error) {
            log.error('[%1] Error generating reset token for %2: %3', req.uuid, reqEmail, error);
            return q.reject(error);
        });
    };
    
    auth.resetPassword = function(req, users, config, auditJournal, sessions) {
        var log = logger.getLog(),
            id = req.body && req.body.id,
            token = req.body && req.body.token,
            newPassword = req.body && req.body.newPassword,
            now = new Date();
        
        if (typeof id !== 'string' || typeof token !== 'string' || typeof newPassword !== 'string'){
            log.info('[%1] Incomplete reset request %2', req.uuid, id ? 'for user ' + id : '');
            return q({code: 400, body: 'Must provide id, token, and newPassword'});
        }
        
        log.info('[%1] User %2 attempting to reset their password', req.uuid, id);
        
        return mongoUtils.findObject(users, { id: id })
        .then(function(account) {
            if (!account) {
                log.info('[%1] No user with id %2 exists', req.uuid, id);
                return q({code: 404, body: 'That user does not exist'});
            }
            if (account.status !== Status.Active) {
                log.info('[%1] User %2 not active', req.uuid, id);
                return q({code: 403, body: 'Account not active'});
            }

            auditJournal.writeAuditEntry(req, id);

            if (!account.resetToken || !account.resetToken.expires) {
                log.info('[%1] User %2 has no reset token in the database', req.uuid, id);
                return q({code: 403, body: 'No reset token found'});
            }
            if (now > account.resetToken.expires) {
                log.info('[%1] Reset token for user %2 expired at %3',
                         req.uuid, id, account.resetToken.expires);
                return q({code: 403, body: 'Reset token expired'});
            }
            return q.npost(bcrypt, 'compare', [token, account.resetToken.token])
            .then(function(matching) {
                var updatedAccount;
                
                if (!matching) {
                    log.info('[%1] Request token does not match reset token in db', req.uuid);
                    return q({code: 403, body: 'Invalid request token'});
                }
                
                return q.npost(bcrypt, 'hash', [newPassword, bcrypt.genSaltSync()])
                .then(function(hashed) {
                    var opts = { w: 1, j: true, returnOriginal: false, sort: { id: 1 } },
                        updates = {
                            $set: { password: hashed, lastUpdated: now },
                            $unset: { resetToken: 1 }
                        };
                    return q(users.findOneAndUpdate({ id: id }, updates, opts));
                })
                .then(function(result) {
                    updatedAccount = result.value;
                    log.info('[%1] User %2 successfully reset their password', req.uuid, id);
                    
                    email.passwordChanged(
                        config.emails.sender,
                        account.email,
                        config.emails.supportAddress
                    )
                    .then(function() {
                        log.info('[%1] Notified user of change at %2', req.uuid, account.email);
                    }).catch(function(error) {
                        log.error('[%1] Error sending msg to %2: %3',req.uuid,account.email,error);
                    });
                    return q(sessions.deleteMany({ 'session.user': id }, { w: 1, j: true }));
                })
                .then(function(result) {
                    log.info('[%1] Successfully deleted %2 session docs',
                             req.uuid, result.deletedCount);
                    return q.npost(req.session, 'regenerate');
                })
                .then(function() {
                    return authUtils.decorateUser(mongoUtils.safeUser(updatedAccount));
                }).then(function(decorated) {
                    req.session.user = decorated.id;
                    req.session.cookie.maxAge = config.sessions.maxAge;
                    return q({ code: 200, body: decorated });
                });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error resetting password for user %2: %3', req.uuid, id, error);
            return q.reject(error);
        });
    };

    auth.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
        aws.config.region = state.config.emails.region;

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        app.use(expressUtils.basicMiddleware());
        app.use(bodyParser.json());

        app.post('/api/auth/login', state.sessions, function(req, res) {
            auth.login(req, users, state.config, auditJournal, state.cache)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing login'
                });
            });
        });

        app.post('/api/auth/logout', state.sessions, function(req, res) {
            auth.logout(req, auditJournal).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error processing logout'
                });
            });
        });

        var audit = auditJournal.middleware.bind(auditJournal),
            authGetStatus = authUtils.middlewarify({
                userStatuses: [Status.Active, Status.New],
                allowApps: true
            });

        app.get('/api/auth/status', state.sessions, authGetStatus, audit, function(req, res) {
            res.send(200, req.user || req.application);
        });
        
        app.post('/api/auth/password/forgot', function(req, res) {
            auth.forgotPassword(req, users, state.config, auditJournal)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error generating reset code'
                });
            });
        });
        
        app.post('/api/auth/password/reset', state.sessions, function(req, res) {
            auth.resetPassword(req, users, state.config, auditJournal,
                               state.sessionStore.db.collection('sessions'))
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(/*error*/) {
                res.send(500, {
                    error: 'Error resetting password'
                });
            });
        });

        app.get('/api/auth/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/auth/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(expressUtils.errorHandler());

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
        .then(service.initSessions)
        .then(service.initPubSubChannels)
        .then(service.initCache)
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
