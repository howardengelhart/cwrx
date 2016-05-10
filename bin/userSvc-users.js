(function(){
    'use strict';

    var inspect         = require('util').inspect,
        q               = require('q'),
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
        Model           = require('../lib/model.js'),
        enums           = require('../lib/enums'),
        CacheMutex      = require('../lib/cacheMutex.js'),
        streamUtils     = require('../lib/streamUtils'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        userModule  = { config: {} };

    userModule.userSchema = {
        company: {
            __allowed: true,
            __type: 'string'
        },
        advertiser: {
            __allowed: false,
            __type: 'string'
        },
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
        },
        referralCode: {
            __allowed: false,
            __type: 'string'
        },
        paymentPlanId: {
            __allowed: false,
            __type: 'string'
        },
        promotion: {
            __allowed: false,
            __type: 'string'
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

    userModule.setupSvc = function setupSvc(db, config, cache, appCreds) {
        ['kinesis', 'api', 'sessions', 'validTargets', 'newUserPermissions', 'activationTokenTTL']
        .forEach(function(key) {
            userModule.config[key] = config[key];
        });
        Object.keys(userModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            userModule.config.api[key].baseUrl = urlUtils.resolve(
                userModule.config.api.root,
                userModule.config.api[key].endpoint
            );
        });
    
    
        var opts = { userProp: false },
            userSvc = new CrudSvc(db.collection('users'), 'u', opts, userModule.userSchema);

        userSvc._db = db;

        streamUtils.createProducer(userModule.config.kinesis);
        
        var hashPassword = userModule.hashProp.bind(userModule, 'password');
        var hashNewPassword = userModule.hashProp.bind(userModule, 'newPassword');
        var validateUniqueEmail = userSvc.validateUniqueProp.bind(userSvc, 'email', null);
        var validateRoles = userModule.validateRoles.bind(userModule, userSvc);
        var validatePolicies = userModule.validatePolicies.bind(userModule, userSvc);
        var checkExistingWithNewEmail = userModule.checkExistingWithNewEmail.bind(
            userModule, userSvc
        );
        var setupSignupUser = userModule.setupSignupUser.bind(userModule, userSvc);
        var checkValidToken = userModule.checkValidToken.bind(userModule, userSvc);
        var createLinkedEntities = userModule.createLinkedEntities.bind(userModule,
            cache, userSvc, appCreds);

        // override some default CrudSvc methods with custom versions for users
        userSvc.transformMongoDoc = mongoUtils.safeUser;
        userSvc.checkScope = userModule.checkScope;
        userSvc.userPermQuery = userModule.userPermQuery;

        userSvc.use('create', userModule.validatePassword);
        userSvc.use('create', hashPassword);
        userSvc.use('create', userModule.setupUser);
        userSvc.use('create', validateUniqueEmail);
        userSvc.use('create', validateRoles);
        userSvc.use('create', validatePolicies);

        userSvc.use('edit', userModule.validatePassword);
        userSvc.use('edit', validateRoles);
        userSvc.use('edit', validatePolicies);

        userSvc.use('delete', userModule.preventSelfDeletion);

        userSvc.use('changePassword', userModule.validateTarget);
        userSvc.use('changePassword', hashNewPassword);

        userSvc.use('changeEmail', userModule.validateTarget);
        userSvc.use('changeEmail', checkExistingWithNewEmail);

        userSvc.use('forceLogout', userModule.authorizeForceLogout);

        userSvc.use('signupUser', userModule.validateTarget);
        userSvc.use('signupUser', setupSignupUser);
        userSvc.use('signupUser', userModule.validatePassword);
        userSvc.use('signupUser', hashPassword);
        userSvc.use('signupUser', userModule.setupUser);
        userSvc.use('signupUser', validateUniqueEmail);
        userSvc.use('signupUser', userModule.giveActivationToken);

        userSvc.use('confirmUser', userModule.validateTarget);
        userSvc.use('confirmUser', checkValidToken);
        userSvc.use('confirmUser', createLinkedEntities);

        userSvc.use('resendActivation', userModule.validateTarget);
        userSvc.use('resendActivation', userModule.giveActivationToken);

        return userSvc;
    };

    // Create a modified user model for /signup that allows setting referralCode
    userModule.createSignupModel = function(svc) {
        var signupSchema = JSON.parse(JSON.stringify(svc.model.schema));
        signupSchema.referralCode.__allowed = true;
        signupSchema.paymentPlanId.__allowed = true;
        signupSchema.promotion.__allowed = true;

        return new Model('users', signupSchema);
    };
    
    // Validate (or default) req.query.target param
    userModule.validateTarget = function(req, next, done) {
        var log = logger.getLog();
        req.query.target = req.query.target || 'selfie';

        if (userModule.config.validTargets.indexOf(req.query.target) === -1) {
            log.info('[%1] Target %2 not supported, only support [%3]',
                     req.uuid, req.query.target, userModule.config.validTargets.join(','));
            return done({ code: 400, body: 'Invalid Target' });
        }
        
        return next();
    };

    userModule.checkValidToken = function(svc, req, next, done) {
        var log = logger.getLog(),
            id = req.params.id,
            token = req.body.token;

        return mongoUtils.findObject(svc._coll, { id: String(id) })
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
                        req.requester = authUtils.createRequester(req);
                        return next();
                    });
            });
    };

    userModule.createLinkedEntities = function(cache, svc, appCreds, req, next, done) {
        var log = logger.getLog(),
            company = req.user.company || null,
            id = req.user.id,
            mutex = new CacheMutex(cache, 'confirmUser:' + id, 60 * 1000);
            
        // Post a new entity of the given type
        function postEntity(entityName, opts) {
            return requestUtils.makeSignedRequest(appCreds, 'post', opts).then(function(resp) {
                if (resp.response.statusCode === 201) {
                    var createdId = resp.body.id;
                    log.info('[%1] Created %2 %3 for user %4', req.uuid, entityName, createdId, id);
                    return q(createdId);
                }
                
                return q.reject({ code: resp.response.statusCode, body: resp.body });
            })
            .catch(function(error) {
                log.error('[%1] Failed creating %2 for %3: %4',
                          req.uuid, entityName, id, inspect(error));
                return q.reject('Failed creating ' + entityName);
            });
        }

        return mutex.acquire().then(function(acquired) {
            if (!acquired) {
                log.info('[%1] Another confirm operation is already in progress for user %2',
                         req.uuid, id);
                return done({ code: 400, body: 'Another operation is already in progress' });
            }

            var orgBody = {
                name: (company ? company : 'newOrg') + ' (' + id + ')'
            };
            
            if (!!req.user.referralCode) {
                orgBody.referralCode = req.user.referralCode;
            }

            if (!!req.user.paymentPlanId) {
                orgBody.paymentPlanId = req.user.paymentPlanId;
            }
            
            return (!!req.user.org ? q(req.user.org) : postEntity('org', {
                url: userModule.config.api.orgs.baseUrl,
                json: orgBody
            }))
            .then(function(orgId) {
                req.user.org = orgId;
                
                return postEntity('advertiser', {
                    url: userModule.config.api.advertisers.baseUrl,
                    json: {
                        name: (company ? company : 'newAdvertiser'),
                        org: orgId
                    }
                });
            })
            .then(function() {
                return mutex.release();
            })
            .then(function() {
                return next();
            })
            .catch(function() {
                var promise;
                if (req.user.org) {
                    log.info('[%1] Saving created org id on user %2', req.uuid, id);
                    promise = mongoUtils.editObject(svc._coll, { org: req.user.org }, id);
                } else {
                    promise = q();
                }

                return promise.finally(function() {
                    return mutex.release().finally(function() {
                        return q.reject('Failed creating linked entities');
                    });
                });
            });
        });
    };

    userModule.setupSignupUser = function setupSignupUser(svc, req, next, done) {
        svc.setupObj(req, function() {
            req.body.status = Status.New;
            req.body.external = true;

            var newUserCfg = userModule.config.newUserPermissions[req.query.target] || {};

            req.body.roles = newUserCfg.roles || [];
            req.body.policies = newUserCfg.policies || [];

            next();
        }, done);
    };

    // Check whether the requester can operate on the target user according to their scope
    userModule.checkScope = function(req, obj, verb) {
        var requester = req.requester || {};

        function matchUser() {
            return req.user && req.user.id === obj.id;
        }
        function matchOrg() {
            return req.user && req.user.org === obj.org;
        }
        
        return !!( requester.permissions && requester.permissions.users &&
                   requester.permissions.users[verb] &&
             ( requester.permissions.users[verb] === Scope.All ||
              (requester.permissions.users[verb] === Scope.Org && (matchOrg() || matchUser())) ||
              (requester.permissions.users[verb] === Scope.Own && matchUser() )
             )
        );
    };

    // Adds fields to a find query to filter out users the requester can't see
    userModule.userPermQuery = function(query, req) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            userId = req.user && req.user.id || '',
            orgId = req.user && req.user.org || '',
            readScope = req.requester.permissions.users.read,
            log = logger.getLog(),
            orClause;

        newQuery.status = {$ne: Status.Deleted}; // never show deleted users

        if (!Scope.isScope(readScope)) {
            log.warn('Requester has invalid scope ' + readScope);
            readScope = Scope.Own;
        }

        if (readScope === Scope.Own) {
            orClause = { $or: [ { id: userId } ] };
        } else if (readScope === Scope.Org) {
            orClause = { $or: [ { id: userId }, { org: orgId } ] };
        }
        
        mongoUtils.mergeORQuery(newQuery, orClause);

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

        if (!value || typeof value !== 'string') {
            log.info('[%1] Requester %2 did not provide a valid %3',
                     req.uuid, req.requester && req.requester.id || '', prop);
            return q(done({ code: 400, body: prop + ' is missing/not valid.' }));
        }

        return q.npost(bcrypt, 'hash', [value, bcrypt.genSaltSync()])
            .then(function updateProp(hash) {
                req.body[prop] = hash;
            }).then(next);
    };

    // Give the user some default properties. Make sure their email is lowercase.
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
    userModule.giveActivationToken = function giveActivationToken(req, next) {
        var newUser = req.body,
            now = new Date(),
            tokenTTL = userModule.config.activationTokenTTL,
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

    // Check that all of the user's roles exist
    userModule.validateRoles = function(svc, req, next, done) {
        var log = logger.getLog();

        if (!req.body.roles || req.body.roles.length === 0) {
            return q(next());
        }

        return q(svc._db.collection('roles').find(
            { name: { $in: req.body.roles }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        ).toArray())
        .then(function(fetched) {
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

        return q(svc._db.collection('policies').find(
            { name: { $in: req.body.policies }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        ).toArray())
        .then(function(fetched) {
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
        var userId = req.params.id;

        if (userId === req.requester.id) {
            log.warn('[%1] User %2 tried to delete themselves', req.uuid, req.requester.id);

            return done({ code: 400, body: 'You cannot delete yourself' });
        }

        return next();
    };

    // Ensures that the user is not trying to change their email to the email address of
    // another user. It is used as middleware when changing the user's email.
    userModule.checkExistingWithNewEmail = function checkExistingWithNewEmail(sv, req, next, done) {
        var log = logger.getLog();

        if (!req.body.newEmail || typeof req.body.newEmail !== 'string') {
            log.info('[%1] User %2 did not provide a new email', req.uuid, req.requester.id);
            return done({ code: 400, body: 'Must provide a new email' });
        }

        var email = req.body.newEmail.toLowerCase();
        var mockReq = {
            body: { email: email }
        };

        req.body.newEmail = email;

        return sv.validateUniqueProp('email', null, mockReq, next, done);
    };

    // Make sure the requester is an administrator of users. Used as middleware for
    // forceLogout.
    userModule.authorizeForceLogout = function authorizeForceLogout(req, next, done) {
        var log = logger.getLog();

        if (!(req.requester.permissions &&
              req.requester.permissions.users &&
              req.requester.permissions.users.edit &&
              req.requester.permissions.users.edit === Scope.All)) {
            log.info('[%1] %2 not authorized to force logout users', req.uuid, req.requester.id);
            return done({ code: 403, body: 'Not authorized to force logout users' });
        }

        return next();
    };


    // Custom method used to change the user's password.
    userModule.changePassword = function changePassword(svc, req) {
        var log = logger.getLog();

        return svc.customMethod(req, 'changePassword', function doChange() {
            var newPassword = req.body.newPassword;
            var user = req.user;

            return mongoUtils.editObject(svc._coll, { password: newPassword }, user.id)
                .then(function logSuccess() {
                    log.info('[%1] User %2 successfully changed their password', req.uuid, user.id);
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

    // Custom method to change the user's email.
    userModule.changeEmail = function changeEmail(svc, req) {
        var log = logger.getLog();

        return svc.customMethod(req, 'changeEmail', function doChange() {
            var user = req.user;
            var newEmail = req.body.newEmail;

            return mongoUtils.editObject(svc._coll, { email: newEmail }, user.id)
                .then(function succeed() {
                    log.info('[%1] User %2 successfully changed their email', req.uuid, user.id);
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

    // Custom method that removes all of a user's sessions from the sessions collection.
    userModule.forceLogoutUser = function forceLogoutUser(svc, req, sessions) {
        var log = logger.getLog();

        return svc.customMethod(req, 'forceLogout', function forceLogout() {
            var id = req.params.id;

            log.info(
                '[%1] Admin %2 is deleting all login sessions for %3',
                req.uuid, req.requester.id, id
            );

            return q(sessions.deleteMany({ 'session.user': id }, { w: 1, j: true }))
                .then(function succeed(result) {
                    var count = result.deletedCount;
                    log.info('[%1] Successfully deleted %2 session docs', req.uuid, count);

                    if(id === req.session.user) {
                        log.info('[%1] Admin %2 is deleting their own login sessions.',
                            req.uuid, id);
                        delete req.session;
                    }
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
        var log = logger.getLog(),
            model = userModule.createSignupModel(svc);

        var validity = model.validate('create', req.body, {}, {}); //TODO: move to middleware?
        if(!validity.isValid) {
            return q({ code: 400, body: validity.reason});
        }
        
        return svc.customMethod(req, 'signupUser', function signup() {
            log.info('[%1] Creating new user with email %2', req.uuid, req.body.email);
        
            return mongoUtils.createObject(svc._coll, req.body)
            .then(svc.transformMongoDoc)
            .then(function(obj) {
                var formatted = svc.formatOutput(obj);
                
                return streamUtils.produceEvent('accountCreated', {
                    target: req.query.target,
                    token: req.tempToken,
                    user: formatted
                })
                .then(function() {
                    log.info('[%1] Produced accountCreated event for user %2',
                             req.uuid, formatted.id);
                    return { code: 201, body: formatted };
                })
                .catch(function(error) {
                    log.error('[%1] Failed producing accountCreated event: %2',
                              req.uuid, inspect(error));
                    return q.reject('Failed producing accountCreated event');
                });
            })
            .finally(function() {
                delete req.tempToken;
            });
        });
    };
    
    userModule.confirmUser = function(svc, req, journal) {
        var log = logger.getLog();
        if(!req.body.token) {
            log.info('[%1] User did not provide a token', req.uuid);
            return q({ code: 400, body: 'Must provide a token'});
        }
        return svc.customMethod(req, 'confirmUser', function confirm() {
            var id = req.user.id,
                opts = { w: 1, j: true, returnOriginal: false, sort: { id: 1 } },
                updates = {
                    $set: {
                        lastUpdated: new Date(),
                        status: Status.Active,
                        org: req.user.org
                    },
                    $unset: { activationToken: 1 }
                };
            return q(svc._coll.findOneAndUpdate({ id: id }, updates, opts))
            .then(function(result) {
                var userAccount = result.value;
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
                req.session.cookie.maxAge = userModule.config.sessions.maxAge;
                log.info('[%1] User %2 has been successfully confirmed', req.uuid, decorated.id);
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

        return mongoUtils.findObject(svc._coll, { id: id })
        .then(function(user) {
            if(!user || !user.activationToken) {
                log.warn('[%1] There is no activation token to resend on user %2', req.uuid, id);
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
                .then(function(updated) {
                    return streamUtils.produceEvent('resendActivation', {
                        target: req.query.target,
                        token: req.tempToken,
                        user: updated
                    })
                    .catch(function(error) { //TODO: need to hand test this
                        log.error('[%1] Failed producing resendActivation event: %2',
                                  req.uuid, inspect(error));
                        return q.reject('Failed producing resendActivation event');
                    });
                })
                .then(function() {
                    log.info('[%1] Produced resendActivation event for user %2',
                             req.uuid, req.user.id);
                    return { code: 204 };
                });
            })
            .finally(function() {
                delete req.tempToken;
            });
        });
    };


    userModule.produceAccountActivated = function(req, resp) {
        var log = logger.getLog();
        
        if(resp.code === 200 && typeof resp.body === 'object') {
            return streamUtils.produceEvent('accountActivated', {
                target: req.query.target,
                user: resp.body
            }).then(function() {
                log.info('[%1] Produced accountActivated event for user %2', req.uuid,
                    resp.body.id);
            }).catch(function(error) {
                log.error('[%1] Error producing accountActivated event for user %2: %3',
                    req.uuid, resp.body.id, inspect(error));
            }).thenResolve(resp);
        } else {
            return q(resp);
        }
    };
    
    userModule.producePasswordChanged = function(req, resp) {
        var log = logger.getLog();
        
        if(resp.code === 200) {
            return streamUtils.produceEvent('passwordChanged', {
                target: req.query.target,
                user: req.user
            }).then(function() {
                log.info('[%1] Produced passwordChanged event for user %2', req.uuid,
                    req.user.id);
            }).catch(function(error) {
                log.error('[%1] Error producing passwordChanged event for user %2: %3',
                    req.uuid, req.user.id, inspect(error));
            }).thenResolve(resp);
        } else {
            return q(resp);
        }
    };
    
    userModule.produceEmailChanged = function(req, resp){
        var log = logger.getLog();
        
        if(resp.code === 200) {
            var oldEmail = req.body.email;
            var newEmail = req.body.newEmail;
            var oldUser = req.user;
            var newUser = objUtils.extend({ email: newEmail }, oldUser);

            return q.allSettled([oldUser, newUser].map(function(user) {
                return streamUtils.produceEvent('emailChanged', {
                    target: req.query.target,
                    oldEmail: oldEmail,
                    newEmail: newEmail,
                    user: user
                });
            })).then(function(results) {
                results.forEach(function(result) {
                    if(result.state === 'fulfilled') {
                        log.info('[%1] Produced emailChanged event for user %2', req.uuid,
                            oldUser.id);
                    } else {
                        log.error('[%1] Error producing emailChanged event for user %2: %3',
                            req.uuid, oldUser.id, inspect(result.reason));
                    }
                });
                return resp;
            });
        } else {
            return q(resp);
        }
    };

    userModule.setupEndpoints = function(app, svc, sessions, audit, sessionStore, config,
                                                                    journal, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/users?'; // prefix to all endpoints declared here

        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('users', { allowApps: true });
        
        var credsChecker = authUtils.userPassChecker();
        router.post('/email', credsChecker, audit, function(req, res) {
            var promise = userModule.changeEmail(svc, req)
            .then(function(resp) {
                return userModule.produceEmailChanged(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error changing email', detail: error });
                });
            });
        });

        router.post('/password', credsChecker, audit, function(req, res) {
            var promise = userModule.changePassword(svc, req)
            .then(function(resp) {
                return userModule.producePasswordChanged(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error changing password', detail: error });
                });
            });
        });

        router.post('/signup', function(req, res) {
            var promise = userModule.signupUser(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error signing up user', detail: error });
                });
            });
        });

        router.post('/confirm/:id', sessions, function(req, res) {
            var promise = userModule.confirmUser(svc, req, journal)
            .then(function(resp) {
                return userModule.produceAccountActivated(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error confirming user signup', detail: error });
                });
            });
        });

        var authNewUser = authUtils.middlewarify({ userStatuses: [Status.New] });
        router.post('/resendActivation', sessions, authNewUser, function(req, res) {
            var promise = userModule.resendActivation(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error resending activation link', detail: error });
                });
            });
        });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                if ((req.query.decorated !== 'true' && req.query.decorated !== true) ||
                    resp.body.id === undefined) {
                    return resp;
                }

                return authUtils.decorateUser(resp.body).then(function(user) {
                    resp.body = user;
                    return resp;
                });
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving user', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
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

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving users', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req)
            .then(function(resp) {
                if ((req.query.decorated !== 'true' && req.query.decorated !== true) ||
                    resp.body.id === undefined) {
                    return resp;
                }

                return authUtils.decorateUser(resp.body).then(function(user) {
                    resp.body = user;
                    return resp;
                });
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating user', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req)
            .then(function(resp) {
                if ((req.query.decorated !== 'true' && req.query.decorated !== true) ||
                    resp.body.id === undefined) {
                    return resp;
                }

                return authUtils.decorateUser(resp.body).then(function(user) {
                    resp.body = user;
                    return resp;
                });
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating user', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting user', detail: error });
                });
            });
        });

        router.post('/logout/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = userModule.forceLogoutUser(
                svc,
                req,
                sessionStore.db.collection('sessions')
            );
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error logging out user\'s sessions', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = userModule;
}());
