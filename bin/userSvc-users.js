(function(){
    'use strict';

    var inspect         = require('util').inspect,
        q               = require('q'),
        url             = require('url'),
        urlUtils        = require('url'),
        bcrypt          = require('bcrypt'),
        crypto          = require('crypto'),
        express         = require('express'),
        requestUtils    = require('../lib/requestUtils'),
        logger          = require('../lib/logger'),
        mongoUtils      = require('../lib/mongoUtils'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        email           = require('../lib/email'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        userModule  = { _nonces: {} };

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
        },
        activationToken: {
            __allowed: false,
            __locked: true
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

    userModule.setupSvc = function setupSvc(db, config) {
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
        var filterProps = userModule.filterProps.bind(userModule,
            ['org', 'customer', 'advertiser', 'roles', 'policies']);
        var giveActivationToken = userModule.giveActivationToken.bind(userModule,
            config.activationTokenTTL);
        var sendActivationEmail = userModule.sendActivationEmail.bind(userModule,
            config.ses.sender, config.activationTarget);
        var setupSignupUser = userModule.setupSignupUser.bind(userModule, userSvc,
            config.newUserPermissions.roles, config.newUserPermissions.policies);
        var validatePassword = userModule.validatePassword;
        var checkValidToken = userModule.checkValidToken.bind(userModule, userSvc);
        var createLinkedEntities = userModule.createLinkedEntities.bind(userModule, config.api,
            config.port);
        var sendConfirmationEmail = userModule.sendConfirmationEmail.bind(userModule,
            config.ses.sender);
        var handleBrokenUser = userModule.handleBrokenUser.bind(userModule, userSvc);

        // override some default CrudSvc methods with custom versions for users
        userSvc.transformMongoDoc = mongoUtils.safeUser;
        userSvc.checkScope = userModule.checkScope;
        userSvc.userPermQuery = userModule.userPermQuery;

        userSvc.use('read', preventGetAll);

        userSvc.use('create', validatePassword);
        userSvc.use('create', hashPassword);
        userSvc.use('create', setupUser);
        userSvc.use('create', validateUniqueEmail);
        userSvc.use('create', validateRoles);
        userSvc.use('create', validatePolicies);

        userSvc.use('edit', validatePassword);
        userSvc.use('edit', validateRoles);
        userSvc.use('edit', validatePolicies);

        userSvc.use('delete', preventSelfDeletion);

        userSvc.use('changePassword', hashNewPassword);

        userSvc.use('changeEmail', checkExistingWithNewEmail);

        userSvc.use('forceLogout', authorizeForceLogout);

        userSvc.use('signupUser', setupSignupUser);
        userSvc.use('signupUser', filterProps);
        userSvc.use('signupUser', validatePassword);
        userSvc.use('signupUser', hashPassword);
        userSvc.use('signupUser', setupUser);
        userSvc.use('signupUser', validateUniqueEmail);
        userSvc.use('signupUser', giveActivationToken);
        userSvc.use('signupUser', sendActivationEmail);

        userSvc.use('confirmUser', checkValidToken);
        userSvc.use('confirmUser', createLinkedEntities);
        userSvc.use('confirmUser', handleBrokenUser);
        userSvc.use('confirmUser', sendConfirmationEmail);

        userSvc.use('resendActivation', giveActivationToken);
        userSvc.use('resendActivation', sendActivationEmail);

        return userSvc;
    };

    userModule.checkValidToken = function(svc, req, next, done) {
        var log = logger.getLog(),
            id = req.params.id,
            token = req.body.token;
        return q.npost(svc._coll, 'findOne', [{ id: String(id) }])
            .then(function(result) {
                if(!result) {
                    log.info('[%1] User %2 was not found', req.uuid, id);
                    return done({ code: 404, body: 'User not found' });
                }
                if(result.status !== Status.New || !result.activationToken) {
                    log.info('[%1] User %2 cannot be activated', req.uuid, id);
                    return done({ code: 403, body: 'Confirmation failed' });
                }
                if(new Date(result.activationToken.expires) < new Date()) {
                    log.info('[%1] User %2 has an expired activation token', req.uuid, id);
                    return done({ code: 403, body: 'Activation token has expired' });
                }
                return q.npost(bcrypt, 'compare', [String(token), result.activationToken.token])
                    .then(function(matching) {
                        if(!matching) {
                            log.info('[%1] User %2 provided an incorrect token', req.uuid, id);
                            return done({ code: 403, body: 'Confirmation failed' });
                        }
                        req.user = svc.transformMongoDoc(result);
                        return next();
                    });
            });
    };

    userModule.createLinkedEntities = function(api, port, req, next) {
        var log = logger.getLog(),
            company = req.user.company || null,
            id = req.user.id,
            sixxyCookie = null;

        function createCustomer(advertiserId) {
            var name = (company ? company : 'newCustomer') + ' (' + id + ')';
            var options = { url: url.resolve(api.root, api.customers.endpoint),
                json: { name: name, advertisers: [advertiserId] },
                headers: { cookie: sixxyCookie } };
            return requestUtils.qRequest('post', options).then(function(resp) {
                if(resp.response.statusCode === 201) {
                    req.user.customer = resp.body.id;
                    log.info('[%1] Created customer %3 for user %4', req.uuid, resp.body.id, id);
                } else {
                    return q.reject(resp.response.statusCode + ', ' + resp.body);
                }
            }).catch(function(error) {
                req.user.status = Status.Error;
                log.error('[%1] Error creating customer for user %2: %3', req.uuid, id, error);
            });
        }

        return userModule.getSixxySession(req, port)
            .then(function(cookie) {
                sixxyCookie = cookie;
                log.info('[%1] Got cookie for sixxy user', req.uuid);

                var orgName = (company ? company : 'newOrg') + ' (' + id + ')';
                var adName = (company ? company : 'newAdvertiser') + ' (' + id + ')';

                var orgOpts = { url: url.resolve(api.root, api.orgs.endpoint),
                    json: { name: orgName }, headers: { cookie: sixxyCookie } };
                var adOpts = { url: url.resolve(api.root, api.advertisers.endpoint),
                    json: { name: adName }, headers: { cookie: sixxyCookie } };

                var createOrg = requestUtils.qRequest('post', orgOpts);
                var createAdvertiser = requestUtils.qRequest('post', adOpts);

                return q.allSettled([createOrg, createAdvertiser]);
            })
            .spread(function(orgResult, adResult) {
                // Handle orgResult
                var orgState = orgResult.state;
                var orgResp = orgResult.value;
                if(orgState === 'fulfilled' && orgResp.response.statusCode === 201) {
                    req.user.org = orgResp.body.id;
                    log.info('[%1] Created org %2 for user %3', req.uuid, orgResp.body.id, id);
                } else {
                    req.user.status = Status.Error;
                    var orgErr = (orgState === 'rejected') ? orgResult.reason :
                        orgResp.response.statusCode + ', ' + orgResp.body;
                    log.error('[%1] Error creating org for user %2: %3', req.uuid, id, orgErr);
                }
                // Handle adResult
                var adState = adResult.state;
                var adResp = adResult.value;
                if(adState === 'fulfilled' && adResp.response.statusCode === 201) {
                    var advertiserId = adResp.body.id;
                    req.user.advertiser = advertiserId;
                    log.info('[%1] Created advertiser %2 for user %3', req.uuid, adResp.body.id,
                        id);
                    return createCustomer(advertiserId).finally(next);
                } else {
                    req.user.status = Status.Error;
                    var adErr = (adState === 'rejected') ? adResult.reason :
                        adResp.response.statusCode + ', ' + adResp.body;
                    log.error('[%1] Error creating advertiser for user %2: %3', req.uuid, id,
                        adErr);
                }
                return next();
            });
    };

    userModule.handleBrokenUser = function(svc, req, next) {
        if(req.user.status === Status.Error) {
            var log = logger.getLog(),
                id = req.user.id,
                opts = { w: 1, journal: true, new: true },
                updates = {
                    $set: {
                        lastUpdated: new Date(),
                        status: Status.Error
                    },
                    $unset: { activationToken: 1 }
                };
            return q.npost(svc._coll, 'findAndModify', [{id: id}, {id: 1}, updates, opts])
                .then(function() {
                    log.warn('[%1] User %2 is in a broken state', req.uuid, id);
                    return q.reject('The user is in a broken state.');
                });
        }
        return next();
    };

    userModule.setupSignupUser = function setupSignupUser(svc, roles, policies, req, next, done) {
        svc.setupObj(req, function() {
            req.body.status = Status.New;
            req.body.roles = roles;
            req.body.policies = policies;
            req.body.external = true;

            next();
        }, done);
    };

    // Filters properties off the body of the provided request
    userModule.filterProps = function filterProps(props, req, next) {
        props.forEach(function(prop) {
            if(req.body[prop]) {
                delete req.body[prop];
            }
        });
        next();
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
            if (user) {
                log.info('[%1] User %2 did not provide a valid %3', req.uuid, user.id, prop);
            } else {
                log.info('[%1] User did not provide a valid %2', req.uuid, prop);
            }
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

    // Give the user an activation token.
    // This is used as middleware when signing up a new user.
    userModule.giveActivationToken = function giveActivationToken(tokenTTL, req, next) {
        var newUser = req.body,
            now = new Date(),
            log = logger.getLog();

        return q.npost(crypto, 'randomBytes', [24])
        .then(function(buff) {
            var token = buff.toString('hex');
            req.tempToken = token; // will be removed in the sendActivationEmail middleware
            return q.npost(bcrypt, 'hash', [token, bcrypt.genSaltSync()]);
        })
        .then(function(hashed) {
            newUser.activationToken = {
                token: hashed,
                expires: new Date(now.valueOf() + tokenTTL)
            };
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error generating reset token for %2: %3',
                req.uuid, req.body.email, error);
            return q.reject(error);
        });
    };

    userModule.sendActivationEmail = function(sender, target, req, next, done) {
        var token = req.tempToken,
            id = req.body.id,
            reqEmail = req.body.email,
            log = logger.getLog();

        var link = target + ((target.indexOf('?') === -1) ? '?' : '&') +
            'id=' + id + '&token=' + token;

        return email.sendActivationEmail(sender, reqEmail, link)
            .then(function() {
                delete req.tempToken;
                return next();
            })
            .catch(function(error) {
                if(error.name === 'InvalidParameterValue') {
                    log.info('[%1] Problem sending msg to %2: %3', req.uuid, reqEmail, error);
                    return done({code: 400, body: 'Invalid email address'});
                } else {
                    log.error('[%1] Error sending msg to %2: %3', req.uuid, reqEmail, error);
                    return q.reject(error);
                }
            });
    };

    userModule.sendConfirmationEmail = function(sender, req, next) {
        var recipient = req.user.email;
        return email.notifyAccountActivation(sender, recipient).then(function() {
            return next();
        });
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

    userModule.signupUser = function signupUser(svc, req) {
        var validity = svc.model.validate('create', req.body, {}, {});
        if(validity.isValid) {
            return svc.customMethod(req, 'signupUser', function signup() {
                return mongoUtils.createObject(svc._coll, req.body)
                .then(svc.transformMongoDoc)
                .then(function(obj) {
                    return { code: 201, body: svc.formatOutput(obj) };
                });
            });
        } else {
            return q({ code: 400, body: validity.reason});
        }
    };
    
    userModule.getSixxySession = function(req, port) {
        var url = urlUtils.format({
                protocol: 'http',
                hostname: 'localhost',
                port: port,
                pathname: '/__internal/sixxyUserSession'
            });

        return q.npost(crypto, 'randomBytes', [24])
        .then(function(buff) {
            var nonce = buff.toString('hex');
            
            userModule._nonces[req.uuid] = nonce;

            return requestUtils.qRequest('post', {
                url: url,
                json: { uuid: req.uuid, nonce: nonce }
            });
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 204) {
                var msg = 'Failed to request sixxy session: code = ' + resp.response.statusCode +
                          ', body = ' + resp.body;
                return q.reject(msg);
            }

            var authCookie = (resp.response.headers['set-cookie'] || []).filter(function(cookie) {
                return (/^c6Auth/).test(cookie);
            })[0];
            
            if (!authCookie) {
                return q.reject('No c6Auth cookie in response');
            }
            
            return authCookie;
        });
    };
    
    userModule.insertSixxySession = function(req, res, config) {
        var log = logger.getLog();
        
        if (!req.body.nonce || !req.body.uuid) {
            log.warn('[%1] Request does not have nonce + uuid', req.uuid);
            return res.send(400);
        }
        if (req.body.nonce !== userModule._nonces[req.body.uuid]) {
            log.warn('[%1] Invalid nonce for uuid %2', req.uuid, req.body.uuid);
            return res.send(400);
        }
        
        delete userModule._nonces[req.body.uuid];
        
        log.info('[%1] Returning sixxy user cookie to request %2', req.uuid, req.body.uuid);

        return q.npost(req.session, 'regenerate').done(function() {
            req.session.user = config.systemUserId;
            req.session.cookie.maxAge = 60*1000;
            res.send(204);
        });
    };

    userModule.confirmUser = function(svc, req, journal, maxAge) {
        var log = logger.getLog();
        if(!req.body.token) {
            log.info('[%1] User did not provide a token', req.uuid);
            return q({ code: 400, body: 'Must provide a token'});
        }
        return svc.customMethod(req, 'confirmUser', function confirm() {
            var id = req.user.id,
                opts = { w: 1, journal: true, new: true },
                updates = {
                    $set: {
                        lastUpdated: new Date(),
                        status: Status.Active,
                        org: req.user.org,
                        customer: req.user.customer,
                        advertiser: req.user.advertiser
                    },
                    $unset: { activationToken: 1 }
                };
            return q.npost(svc._coll, 'findAndModify', [{id: id}, {id: 1}, updates, opts])
                .then(function(results) {
                    var userAccount = results[0];
                    delete req.user;
                    return q.all([
                        q.npost(req.session, 'regenerate'),
                        authUtils.decorateUser(svc.transformMongoDoc(userAccount))
                    ]);
                })
                .then(function(results) {
                    var decorated = results[1];
                    journal.writeAuditEntry(req, decorated.id);
                    req.session.user = decorated.id;
                    req.session.cookie.maxAge = maxAge;
                    log.info('[%1] User %2 has been successfully confirmed', req.uuid,
                        decorated.id);
                    return { code: 200, body: decorated };
                })
                .catch(function(error) {
                    log.error('[%1] Error updating user %2: %3', req.uuid, id, error);
                    return q.reject(error);
                });
        });
    };

    userModule.resendActivation = function(svc, req) {
        var log = logger.getLog(),
            id = req.session.user;
        return q.npost(svc._coll, 'findOne', [{id: id}])
            .then(function(user) {
                if(!user.activationToken) {
                    log.warn('[%1] There is no activation token to resend on user %2', req.uuid,
                        id);
                    return { code: 403, body: 'No activation token to resend' };
                }
                req.body.id = id;
                req.body.email = user.email;
                return svc.customMethod(req, 'resendActivation', function() {
                    var updates = {
                        lastUpdated: new Date(),
                        activationToken: req.body.activationToken
                    };
                    return mongoUtils.editObject(svc._coll, updates, id)
                        .then(function() {
                            return { code: 204 };
                        });
                });
            });
    };

    userModule.setupEndpoints = function(app, svc, sessions, audit, sessionStore, config, journal) {
        var router      = express.Router(),
            mountPath   = '/api/account/users?'; // prefix to all endpoints declared here

        app.post('/__internal/sixxyUserSession', sessions, function(req, res) {
            userModule.insertSixxySession(req, res, config);
        });

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

        router.post('/signup', function(req, res) {
            userModule.signupUser(svc, req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error signing up user',
                    detail: error
                });
            });
        });

        router.post('/confirm/:id', sessions, function(req, res) {
            userModule.confirmUser(svc, req, journal, config.sessions.maxAge).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error confirming user signup',
                    detail: error
                });
            });
        });

        var authNewUser = authUtils.middlewarify({}, null, [Status.New]);
        router.post('/resendActivation', sessions, authNewUser, function(req, res) {
            userModule.resendActivation(svc, req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error resending activation link',
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
            if ('ids' in req.query) {
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
