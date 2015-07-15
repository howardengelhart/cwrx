#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        inspect         = require('util').inspect,
        q               = require('q'),
        bcrypt          = require('bcrypt'),
        aws             = require('aws-sdk'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        mongoUtils      = require('../lib/mongoUtils'),
        journal         = require('../lib/journal'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        CrudSvc         = require('../lib/crudSvc.js'),
        email           = require('../lib/email'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        state       = {},
        userModule  = {}; // for exporting functions to unit tests

    function isObject(value) {
        return Object(value) === value;
    }

    function withDefaults(object, defaults) {
        return Object.keys(defaults).reduce(function(object, key) {
            if (isObject(object[key]) && isObject(defaults[key])) {
                withDefaults(object[key], defaults[key]);
            } else if (!(key in object)) {
                object[key] = defaults[key];
            }

            return object;
        }, object);
    }

    // This is the template for user's configuration
    state.defaultConfig = {
        appName: 'userSvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/userSvc/caches/run/'),
        },
        ses: {
            region: 'us-east-1',
            sender: 'support@cinema6.com'
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
        secretsPath: path.join(process.env.HOME,'.userSvc.secrets.json'),
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

    userModule.setupSvc = function setupSvc(collection) {
        var userSvc = new CrudSvc(collection, 'u', { userProp: false });

        var preventGetAll = userSvc.preventGetAll.bind(userSvc);
        var hashPassword = userModule.hashProp.bind(userModule, 'password');
        var hashNewPassword = userModule.hashProp.bind(userModule, 'newPassword');
        var setupUser = userModule.setupUser;
        var validateUniqueEmail = userSvc.validateUniqueProp.bind(userSvc, 'email', null);
        var preventSelfDeletion = userModule.preventSelfDeletion;
        var checkExistingWithNewEmail = userModule.checkExistingWithNewEmail.bind(
            userModule, userSvc
        );
        var authorizeForceLogout = userModule.authorizeForceLogout;

        userSvc.transformMongoDoc = mongoUtils.safeUser;
        userSvc.checkScope = userModule.checkScope;
        userSvc.userPermQuery = userModule.userPermQuery;

        userSvc.editValidator._forbidden.push('email', 'password');
        userSvc.editValidator._condForbidden.permissions = userModule.permsCheck;

        userSvc.createValidator._required.push('email', 'password');
        userSvc.createValidator._condForbidden.permissions = userModule.permsCheck;

        userSvc.use('create', hashPassword);
        userSvc.use('create', setupUser);
        userSvc.use('create', validateUniqueEmail);

        userSvc.use('read', preventGetAll);

        userSvc.use('delete', preventSelfDeletion);

        userSvc.use('changePassword', hashNewPassword);

        userSvc.use('changeEmail', checkExistingWithNewEmail);

        userSvc.use('forceLogout', authorizeForceLogout);

        return userSvc;
    };

    // Check whether the requester can operate on the target user according to their scope
    userModule.checkScope = function(requester, user, verb) {
        return !!(requester && requester.permissions && requester.permissions.users &&
                  requester.permissions.users[verb] &&
             (requester.permissions.users[verb] === Scope.All ||
             (requester.permissions.users[verb] === Scope.Org && (requester.org === user.org ||
                                                                  requester.id === user.id)) ||
             (requester.permissions.users[verb] === Scope.Own && requester.id === user.id) ));
    };

    // Adds fields to a find query to filter out users the requester can't see
    userModule.userPermQuery = function(query, requester) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            readScope = requester.permissions.users.read,
            log = logger.getLog();

        newQuery.status = {$ne: Status.Deleted}; // never show deleted users

        if (!Scope.isScope(readScope)) {
            log.warn('User has invalid scope ' + readScope);
            readScope = Scope.Own;
        }

        if (readScope === Scope.Own) {
            newQuery.$or = [ { id: requester.id } ];
        } else if (readScope === Scope.Org) {
            newQuery.$or = [ { org: requester.org }, { id: requester.id } ];
        }

        return newQuery;
    };

    // make sure requester can't edit own perms or set perms that are greater than their own
    userModule.permsCheck = function permsCheck(updates, orig, requester) {
        var log = logger.getLog();

        if (objUtils.compareObjects(updates.permissions, requester.permissions)) {
            return true;
        }

        if (!requester.permissions) {
            log.trace('Requester has no permissions');
            return false;
        }
        if (orig.id && (orig.id === requester.id)) {
            log.trace('Requester trying to change own permissions');
            return false;
        }

        return Object.keys(updates.permissions).every(function(key) {
            if (!requester.permissions[key]) {
                log.trace('Can\'t set perms for %1 since requester has no perms for %1', key);
                return false;
            }
            var updateObj = updates.permissions[key];
            var requesterObj = requester.permissions[key];
            return Object.keys(updates.permissions[key]).every(function(verb) {
                if (Scope.compare(updateObj[verb], requesterObj[verb]) > 0) {
                    log.trace('Can\'t set perm %1: %2: %3 when requester has %1: %2: %4',
                              key, verb, updateObj[verb], requesterObj[verb]);
                    return false;
                }
                return true;
            });
        });
    };

    // Used as middleware when creating a user to encrypt their password before storing
    // it in the DB
    userModule.hashProp = function hashPassword(prop, req, next, done) {
        var log = logger.getLog();
        var value = req.body[prop];
        var user = req.user;

        if (!value || typeof value !== 'string') {
            log.info('[%1] User %2 did not provide a valid %3', req.uuid, user.id, prop);
            return q(done({ code: 400, body: prop + ' is missing/not valid.' }));
        }

        return q.npost(bcrypt, 'hash', [value, bcrypt.genSaltSync()])
            .then(function updateProp(hash) {
                req.body[prop] = hash;
            }).then(next);
    };

    // Give the user some default properties. Make sure their email is lowercase. This is used as
    // middleware when creating a user.
    userModule.setupUser = function setupUser(req, next) {
        var newUser = req.body;

        withDefaults(newUser, {
            applications: ['e-51ae37625cb57f'], // Minireelinator
            type: 'Publisher',
            config: {},
            permissions: {
                elections: {
                    read: Scope.Org,
                    create: Scope.Org,
                    edit: Scope.Org,
                    delete: Scope.Org
                },
                experiences: {
                    read: Scope.Org,
                    create: Scope.Org,
                    edit: Scope.Org,
                    delete: Scope.Org
                },
                users: {
                    read: Scope.Org,
                    edit: Scope.Own
                },
                orgs: {
                    read: Scope.Own,
                    edit: Scope.Own
                },
                sites: {
                    read: Scope.Org
                }
            }
        });

        newUser.email = newUser.email.toLowerCase();

        return next();
    };

    // Make sure the user is not trying to delete themselves. This is used as middleware when
    // deleting a user.
    userModule.preventSelfDeletion = function preventSelfDeletion(req, next, done) {
        var log = logger.getLog();
        var requester = req.user;
        var userId = req.params.id;

        if (userId === requester.id) {
            log.warn('[%1] User %2 tried to delete themselves', req.uuid, requester.id);

            return done({ code: 400, body: 'You cannot delete yourself' });
        }

        return next();
    };

    // Custom method used to change the user's password.
    userModule.changePassword = function changePassword(svc, req, emailSender) {
        var log = logger.getLog();

        return svc.customMethod(req, 'changePassword', function doChange() {
            var newPassword = req.body.newPassword;
            var notifyEmail = req.body.email;
            var user = req.user;

            return mongoUtils.editObject(svc._coll, { password: newPassword }, user.id)
                .then(function sendEmail() {
                    log.info('[%1] User %2 successfully changed their password', req.uuid, user.id);

                    email.notifyPwdChange(emailSender, notifyEmail)
                        .then(function logSuccess() {
                            log.info('[%1] Notified user of change at %2', req.uuid, notifyEmail);
                        })
                        .catch(function logError(error) {
                            log.error(
                                '[%1] Error sending email to %2: %3',
                                req.uuid, notifyEmail, inspect(error)
                            );
                        });

                    return { code: 200, body: 'Successfully changed password' };
                })
                .catch(function logError(reason) {
                    log.error(
                        '[%1] Error changing password for user %2: %3',
                        req.uuid, user.id, inspect(reason)
                    );

                    throw reason;
                });
        });
    };

    // Ensures that the user is not trying to change their email to the email address of
    // another user. It is used as middleware when changing the user's email.
    userModule.checkExistingWithNewEmail = function checkExistingWithNewEmail(sv, req, next, done) {
        var log = logger.getLog();

        if (!req.body.newEmail || typeof req.body.newEmail !== 'string') {
            log.info('[%1] User %2 did not provide a new email', req.uuid, req.user.id);
            return done({ code: 400, body: 'Must provide a new email' });
        }

        var email = req.body.newEmail.toLowerCase();
        var mockReq = {
            body: { email: email }
        };

        req.body.newEmail = email;

        return sv.validateUniqueProp('email', null, mockReq, next, done);
    };

    // Custom method to change the user's email.
    userModule.changeEmail = function changeEmail(svc, req, emailSender) {
        var log = logger.getLog();

        function notifyEmailChange(oldEmail, newEmail) {
            var SUBJECT = 'Your Account Email Address Has Changed';
            var TEMPLATE = 'emailChange.html';
            var TEMPLATE_VARS = { newEmail: newEmail, sender: emailSender };

            return email.compileAndSend(emailSender, oldEmail, SUBJECT, TEMPLATE, TEMPLATE_VARS);
        }

        return svc.customMethod(req, 'changeEmail', function doChange() {
            var user = req.user;
            var newEmail = req.body.newEmail;
            var oldEmail = req.body.email;

            return mongoUtils.editObject(svc._coll, { email: newEmail }, user.id)
                .then(function succeed() {
                    log.info('[%1] User %2 successfully changed their email', req.uuid, user.id);

                    notifyEmailChange(oldEmail, newEmail)
                        .then(function logSuccess() {
                            log.info('[%1] Notified user of change at %2', req.uuid, oldEmail);
                        })
                        .catch(function logError(error) {
                            log.error(
                                '[%1] Error sending email to %2: %3',
                                req.uuid, oldEmail, inspect(error)
                            );
                        });

                    return { code: 200, body: 'Successfully changed email' };
                })
                .catch(function logError(reason) {
                    log.error(
                        '[%1] Error changing email for user %2: %3',
                        req.uuid, user.id, inspect(reason)
                    );

                    throw reason;
                });
        });
    };

    // Make sure the requester is an administrator of users. Used as middleware for
    // forceLogout.
    userModule.authorizeForceLogout = function authorizeForceLogout(req, next, done) {
        var log = logger.getLog();
        var requester = req.user;

        if (!(requester.permissions &&
              requester.permissions.users &&
              requester.permissions.users.edit &&
              requester.permissions.users.edit === Scope.All)) {

            log.info('[%1] User %2 not authorized to force logout users', req.uuid, requester.id);
            return done({ code: 403, body: 'Not authorized to force logout users' });
        }

        return next();
    };

    // Custom method that removes all of a user's sessions from the sessions collection.
    userModule.forceLogoutUser = function forceLogoutUser(svc, req, sessions) {
        var log = logger.getLog();

        return svc.customMethod(req, 'forceLogout', function forceLogout() {
            var id = req.params.id;
            var requester = req.user;

            log.info(
                '[%1] Admin %2 is deleting all login sessions for %3',
                req.uuid, requester.id, id
            );

            return q.npost(sessions, 'remove', [{ 'session.user': id }, { w: 1, journal: true }])
                .then(function succeed(count) {
                    log.info('[%1] Successfully deleted %2 session docs', req.uuid, count);

                    return { code: 204 };
                })
                .catch(function fail(reason) {
                    log.error(
                        '[%1] Error removing sessions for user %2: %3',
                        req.uuid, id, inspect(reason)
                    );

                    throw reason;
                });
        });
    };

    userModule.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            userSvc      = userModule.setupSvc(users),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._coll = users;

        // Nodemailer will automatically get SES creds, but need to set region here
        aws.config.region = state.config.ses.region;

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
            authUtils._coll = users;
            userSvc._coll = users;
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

        app.use(bodyParser.json());

        app.get('/api/account/user/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/account/user/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        var credsChecker = authUtils.userPassChecker(users);
        app.post('/api/account/user/email', credsChecker, audit, function(req, res) {
            userModule.changeEmail(userSvc, req, state.config.ses.sender).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error changing email',
                    detail: error
                });
            });
        });

        app.post('/api/account/user/password', credsChecker, audit, function(req, res) {
            userModule.changePassword(userSvc, req, state.config.ses.sender).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error changing password',
                    detail: error
                });
            });
        });

        var authGetUser = authUtils.middlewarify({users: 'read'});
        app.get('/api/account/user/:id', sessWrap, authGetUser, audit, function(req,res){
            userSvc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving user',
                    detail: error
                });
            });
        });

        app.get('/api/account/users', sessWrap, authGetUser, audit, function(req, res) {
            var query = {};
            if (req.query.org) {
                query.org = String(req.query.org);
            } else if (req.query.ids) {
                query.id = req.query.ids.split(',');
            }

            userSvc.getObjs(query, req, true)
            .then(function(resp) {
                if (resp.headers && resp.headers['content-range']) {
                    res.header('content-range', resp.headers['content-range']);
                }

                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving users',
                    detail: error
                });
            });
        });

        var authPostUser = authUtils.middlewarify({users: 'create'});
        app.post('/api/account/user', sessWrap, authPostUser, audit, function(req, res) {
            userSvc.createObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating user',
                    detail: error
                });
            });
        });

        var authPutUser = authUtils.middlewarify({users: 'edit'});
        app.put('/api/account/user/:id', sessWrap, authPutUser, audit, function(req, res) {
            userSvc.editObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating user',
                    detail: error
                });
            });
        });

        var authDelUser = authUtils.middlewarify({users: 'delete'});
        app.delete('/api/account/user/:id', sessWrap, authDelUser, audit, function(req, res) {
            userSvc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting user',
                    detail: error
                });
            });
        });

        app.post('/api/account/user/logout/:id', sessWrap, authPutUser, audit, function(req, res) {
            userModule.forceLogoutUser(userSvc, req, state.sessionStore.db.collection('sessions'))
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error logging out user\'s sessions',
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
        .then(userModule.main)
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
        module.exports = userModule;
    }
}());
