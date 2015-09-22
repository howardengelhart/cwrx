(function(){
    'use strict';

    var inspect         = require('util').inspect,
        q               = require('q'),
        bcrypt          = require('bcrypt'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        mongoUtils      = require('../lib/mongoUtils'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        email           = require('../lib/email'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        userModule  = {};

    userModule.userSchema = {
        email: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __required: true,
            __locked: true
        },
        password: {
            __allowed: true,
            __type: 'string',
            __locked: true
        },
        applications: {
            __allowed: false,
            __locked: true
        },
        permissions: {
            __allowed: false,
            __locked: true
        },
        fieldValidation: {
            __allowed: false,
            __locked: true
        },
        entitlements: {
            __allowed: false,
            __locked: true
        },
        policies: {
            __allowed: false,
            __type: 'stringArray',
            __entries: {
                __acceptableValues: []
            }
        },
        roles: {
            __allowed: false,
            __type: 'stringArray',
            __entries: {
                __acceptableValues: []
            }
        }
    };


    function withDefaults(object, defaults) {
        return Object.keys(defaults).reduce(function(object, key) {
            if (objUtils.isPOJO(object[key]) && objUtils.isPOJO(defaults[key])) {
                withDefaults(object[key], defaults[key]);
            } else if (!(key in object)) {
                object[key] = defaults[key];
            }

            return object;
        }, object);
    }

    userModule.setupSvc = function setupSvc(db) {
        var opts = { userProp: false },
            userSvc = new CrudSvc(db.collection('users'), 'u', opts, userModule.userSchema);

        userSvc._db = db;

        var preventGetAll = userSvc.preventGetAll.bind(userSvc);
        var hashPassword = userModule.hashProp.bind(userModule, 'password');
        var hashNewPassword = userModule.hashProp.bind(userModule, 'newPassword');
        var setupUser = userModule.setupUser;
        var validateUniqueEmail = userSvc.validateUniqueProp.bind(userSvc, 'email', null);
        var validateRoles = userModule.validateRoles.bind(userModule, userSvc);
        var validatePolicies = userModule.validatePolicies.bind(userModule, userSvc);
        var preventSelfDeletion = userModule.preventSelfDeletion;
        var checkExistingWithNewEmail = userModule.checkExistingWithNewEmail.bind(
            userModule, userSvc
        );
        var authorizeForceLogout = userModule.authorizeForceLogout;

        // override some default CrudSvc methods with custom versions for users
        userSvc.transformMongoDoc = mongoUtils.safeUser;
        userSvc.checkScope = userModule.checkScope;
        userSvc.userPermQuery = userModule.userPermQuery;

        userSvc.use('read', preventGetAll);

        userSvc.use('create', userModule.validatePassword);
        userSvc.use('create', hashPassword);
        userSvc.use('create', setupUser);
        userSvc.use('create', validateUniqueEmail);
        userSvc.use('create', validateRoles);
        userSvc.use('create', validatePolicies);

        userSvc.use('edit', userModule.validatePassword);
        userSvc.use('edit', validateRoles);
        userSvc.use('edit', validatePolicies);

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

    /* Directives like __unchangeable and __required don't work properly for password since it's
     * trimmed off the origObj, so replicate that validation logic here. */
    userModule.validatePassword = function(req, next, done) {
        var log = logger.getLog();

        if (!req.origObj) {
            if (!req.body.password) {
                log.info('[%1] No password provided when creating new user', req.uuid);
                return done({ code: 400, body: 'Missing required field: password' });
            }
        } else {
            delete req.body.password;
        }

        return next();
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
            config: {},
            roles: [],
            policies: []
        });

        newUser.email = newUser.email.toLowerCase();

        return next();
    };

    // Check that all of the user's roles exist
    userModule.validateRoles = function(svc, req, next, done) {
        var log = logger.getLog();

        if (!req.body.roles || req.body.roles.length === 0) {
            return q(next());
        }

        var cursor = svc._db.collection('roles').find(
            { name: { $in: req.body.roles }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        );

        return q.npost(cursor, 'toArray').then(function(fetched) {
            if (fetched.length === req.body.roles.length) {
                return next();
            }

            var missing = req.body.roles.filter(function(reqRole) {
                return fetched.every(function(role) { return role.name !== reqRole; });
            });

            var msg = 'These roles were not found: [' + missing.join(',') + ']';

            log.info('[%1] Not saving user: %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for roles: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    // Check that all of the user's policies exist
    userModule.validatePolicies = function(svc, req, next, done) {
        var log = logger.getLog();

        if (!req.body.policies || req.body.policies.length === 0) {
            return q(next());
        }

        var cursor = svc._db.collection('policies').find(
            { name: { $in: req.body.policies }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        );

        return q.npost(cursor, 'toArray').then(function(fetched) {
            if (fetched.length === req.body.policies.length) {
                return next();
            }

            var missing = req.body.policies.filter(function(reqPol) {
                return fetched.every(function(pol) { return pol.name !== reqPol; });
            });

            var msg = 'These policies were not found: [' + missing.join(',') + ']';

            log.info('[%1] Not saving user: %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for policies: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
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

    // Custom method that looks up whether an email address is in use.
    userModule.validEmail = function validEmail(sv, req) {
        var log = logger.getLog();
        var email = req.query.email;
        /**
         * More practical version of the RFC 2822 standard definition of an email address.
         * Removes double quote and bracket syntax, allows two letter country codes and
         * specific top level domains.
         */
        var emailRegex = new RegExp('^[a-z0-9!#$%&’*+/=?^_`{|}~-]+(?:\\.[a-z0-9!#$%&’*+/=?^_`{|}' +
            '~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:[A-Z]{2}|com|org|net|gov|mil|biz|' +
            'info|mobi|name|aero|jobs|museum)$');

        if (!email || typeof email !== 'string') {
            log.info('[%1] Did not provide an email', req.uuid);
            return q({ code: 400, body: 'Must provide an email' });
        }

        email = email.toLowerCase();

        if(!email.match(emailRegex)) {
            log.info('[%1] The provided email is not valid', req.uuid);
            return q({ code: 400, body: 'Invalid email address' });
        }

        var query = {
            email: email
        };

        return q.npost(sv._coll, 'count', [query]).then(function(count) {
            if (count > 0) {
                return { code: 400, body: 'Invalid email address' };
            } else {
                return { code: 200, body: true };
            }
        });
    };

    userModule.setupEndpoints = function(app, svc, sessions, audit, sessionStore, config) {
        var router      = express.Router(),
            mountPath   = '/api/account/users?'; // prefix to all endpoints declared here


        var credsChecker = authUtils.userPassChecker();
        router.post('/email', credsChecker, audit, function(req, res) {
            userModule.changeEmail(svc, req, config.ses.sender).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error changing email',
                    detail: error
                });
            });
        });

        router.post('/password', credsChecker, audit, function(req, res) {
            userModule.changePassword(svc, req, config.ses.sender).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error changing password',
                    detail: error
                });
            });
        });

        router.get('/validEmail', function(req, res) {
            userModule.validEmail(svc, req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error checking for valid email',
                    detail: error
                });
            });
        });

        var authGetUser = authUtils.middlewarify({users: 'read'});
        router.get('/:id', sessions, authGetUser, audit, function(req,res) {
            svc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                if ((req.query.decorated !== 'true' && req.query.decorated !== true) ||
                    resp.body.id === undefined) {
                    return res.send(resp.code, resp.body);
                }

                return authUtils.decorateUser(resp.body).then(function(user) {
                    res.send(resp.code, user);
                });
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving user',
                    detail: error
                });
            });
        });

        router.get('/', sessions, authGetUser, audit, function(req, res) {
            var query = {};
            if (req.query.org) {
                query.org = String(req.query.org);
            }
            if (req.query.role) {
                query.roles = String(req.query.role);
            }
            if (req.query.policy) {
                query.policies = String(req.query.policy);
            }
            if (req.query.ids) {
                query.id = String(req.query.ids).split(',');
            }

            svc.getObjs(query, req, true)
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
        router.post('/', sessions, authPostUser, audit, function(req, res) {
            svc.createObj(req)
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
        router.put('/:id', sessions, authPutUser, audit, function(req, res) {
            svc.editObj(req)
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
        router.delete('/:id', sessions, authDelUser, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting user',
                    detail: error
                });
            });
        });

        router.post('/logout/:id', sessions, authPutUser, audit, function(req, res) {
            userModule.forceLogoutUser(svc, req, sessionStore.db.collection('sessions'))
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error logging out user\'s sessions',
                    detail: error
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = userModule;
}());
