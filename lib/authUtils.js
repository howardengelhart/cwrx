(function(){
    'use strict';
    var q           = require('q'),
        path        = require('path'),
        util        = require('util'),
        bcrypt      = require('bcrypt'),
        logger      = require('./logger'),
        uuid        = require('./uuid'),
        objUtils    = require('./objUtils'),
        mongoUtils  = require('./mongoUtils'),
        enums       = require('../lib/enums'),
        signatures  = require('../lib/signatures'),
        Status      = enums.Status,
        Scope       = enums.Scope,
        authUtils = {};
        
    // Retrieve a user from mongodb. Must have previously set this._db
    authUtils.getUser = function(id) {
        var self = this;

        return mongoUtils.findObject(self._db.collection('users'), { id: id })
        .then(function(account) {
            var user = mongoUtils.safeUser(account);
            return authUtils.decorateUser(user);
        }).catch(function(error) {
            return q.reject(JSON.stringify({
                error: 'Error looking up user',
                detail: error
            }));
        });
    };
    
    /**
     * Retrieve the user's roles, policies, and roles' policies, then merge all policies together
     * and set the resulting permissions, fieldValidation, and entitlements props on the user.
     */
    authUtils.decorateUser = function(user) {
        var self = this,
            log = logger.getLog(),
            roleColl = self._db.collection('roles'),
            polColl = self._db.collection('policies'),
            rolePromise, polPromise, polList;
            
        if (!user) {
            return q(user);
        }
            
        polList = user.policies || [];
    
        if (!user.roles || !user.roles.length) {
            rolePromise = q();
        } else {
            rolePromise = q(roleColl.find(
                { name: { $in: user.roles }, status: Status.Active }
            ).toArray());
        }
        
        return rolePromise.then(function(roles) {
            (roles || []).forEach(function(role) {
                polList = polList.concat(role.policies || []);
            });
            
            log.trace('User %1 has policies: [%2]', user.id, polList);
            
            if (polList.length === 0) {
                polPromise = q();
            } else {
                polPromise = q(polColl.find(
                    { name: { $in: polList }, status: Status.Active },
                    { sort: { name: 1 } }
                ).toArray());
            }
            
            return polPromise;
        })
        .then(function(policies) {
            if (!policies || !policies.length) {
                log.warn('No policies found for user %1', user.id);
                return q();
            }
            
            user.permissions = authUtils.mergePermissions(policies);
            user.fieldValidation = authUtils.mergeValidation(policies);
            user.entitlements = authUtils.mergeEntitlements(policies);
            user.applications = authUtils.mergeApplications(policies);
        })
        .thenResolve(user)
        .catch(function(error) {
            log.error('Error decorating user %1: %2', user.id, error && error.stack || error);
            return q.reject('Mongo error');
        });
    };

    /**
     * Merges the permissions in the list of policies in the most permissive way (take all objects +
     * verbs defined, take the highest scope set for a verb). Scope.Deny will override all other
     * scopes, and will result in the verb being unset in the final permissions object.
     */
    authUtils.mergePermissions = function(policies) {
        var perms = {};
        
        policies.forEach(function(policy) {
            if (!policy.permissions) {
                return;
            }
            
            Object.keys(policy.permissions).forEach(function(entity) {
                perms[entity] = perms[entity] || {};
                
                Object.keys(policy.permissions[entity]).forEach(function(verb) {
                    // don't overwrite an existing deny scope
                    if (perms[entity][verb] === Scope.Deny) {
                        return;
                    }
                    
                    // deny overwrites any existing scope
                    if (policy.permissions[entity][verb] === Scope.Deny) {
                        perms[entity][verb] = policy.permissions[entity][verb];
                        return;
                    }
                
                    // otherwise, overwrite existing if scope is higher
                    if (Scope.compare(policy.permissions[entity][verb], perms[entity][verb]) > 0) {
                        perms[entity][verb] = policy.permissions[entity][verb];
                    }
                });
            });
        });
        
        // clear off anything with scope === 'deny'
        Object.keys(perms).forEach(function(entity) {
            Object.keys(perms[entity]).forEach(function(verb) {
                if (perms[entity][verb] === Scope.Deny) {
                    delete perms[entity][verb];
                }
            });
        });
        
        return perms;
    };

    /**
     * Merges the fieldValidation blocks in the policies. It combines all fields, and when conflicts
     * exist for a non-DSL field (not beginning with '__'), the config block from the highest
     * priority policy is taken.
     */
    authUtils.mergeValidation = function(policies) {
        var validation = {};
        
        function mergeValidationObj(target, source) {
            if (!source || !objUtils.isPOJO(source)) {
                return;
            }
            
            Object.keys(source).forEach(function(key) {
                // ignore '__' fields part of validation DSL, except '__entries'
                if (/^__.+/.test(key) && key !== '__entries') {
                    return;
                }
                
                
                // copy full sub-object if undefined in target
                if (!target[key]) {
                    target[key] = source[key];
                    return;
                }
                
                // otherwise recursively merge sub-props
                mergeValidationObj(target[key], source[key]);
            });
        }
        
        // sort by priority so we take rules from policies with highest priority first
        policies.sort(function(a, b) {
            return b.priority - a.priority;
        }).forEach(function(policy) {
            mergeValidationObj(validation, policy.fieldValidation);
        });
        
        return validation;
    };
    
    /**
     * Merge the entitlements in the list of policies: combine all fields, preferring value from
     * highest priority policy in the event of conflicts.
     */
    authUtils.mergeEntitlements = function(policies) {
        var entitlements = {};
        
        // sort by priority so we take rules from policies with highest priority first
        policies.sort(function(a, b) {
            return b.priority - a.priority;
        }).forEach(function(policy) {
            if (!policy.entitlements) {
                return;
            }
            
            // take each entitlement key/val from policy if not defined so far
            Object.keys(policy.entitlements).forEach(function(key) {
                if (entitlements[key] === undefined) {
                    entitlements[key] = policy.entitlements[key];
                }
            });
        });
        
        return entitlements;
    };

    // Merge the applications in the list of policies: take every id in each array; ignore dupliates
    authUtils.mergeApplications = function(policies) {
        var applications = [];
        
        policies.forEach(function(policy) {
            if (!policy.applications) {
                return;
            }
            
            // add all applications not already in the array
            applications = applications.concat(policy.applications.filter(function(id) {
                return applications.indexOf(id) === -1;
            }));
        });
        
        return applications;
    };
    
    // Create a "requester" entity, merged from req.user + req.application (if defined)
    authUtils.createRequester = function(req) {
        var user = req.user || {},
            app = req.application || {},
            requester = { id: user.id || app.id };

        // Treat these as mock policies, prioritising app priviledges over user priviledges
        requester.permissions = authUtils.mergePermissions([
            { priority: 2, permissions: app.permissions },
            { priority: 1, permissions: user.permissions }
        ]);
        requester.fieldValidation = authUtils.mergeValidation([
            { priority: 2, fieldValidation: app.fieldValidation },
            { priority: 1, fieldValidation: user.fieldValidation }
        ]);
        requester.entitlements = authUtils.mergeEntitlements([
            { priority: 2, entitlements: app.entitlements },
            { priority: 1, entitlements: user.entitlements }
        ]);
        requester.applications = authUtils.mergeApplications([
            { priority: 2, applications: app.applications },
            { priority: 1, applications: user.applications }
        ]);
        
        return requester;
    };

    /**
     * Perms should be an object whose keys are database objects, and the values are
     * strings of the verbs required for the method. For example, { experiences: 'write' }.
     * This will check that each dbObject-verb pair in perms exists in requesterPerms
     * (ignoring scopes, so anything with 'deny' should be trimmed out).
     */
    authUtils._compare = function(perms, requesterPerms) {
        if (!perms || Object.keys(perms).length === 0) {
            return true;
        }

        return !!requesterPerms && Object.keys(perms).every(function(key) {
            return (requesterPerms[key] && requesterPerms[key][perms[key]]);
        });
    };

    /**
     * Checks that the user with the given id exists, and that its status is in an accepted list of
     * statuses (defaulting to just 'active'). Returned object format:
     * {
     *     success  : Boolean,  // whether or not the user has authenticated successfully
     *     user     : Object    // authenticated user, if success === true
     *     code     : Number,   // if set, response should be returned with this status code
     *     message  : String,   // if set, response will be returned with this body message
     * }
     */
    authUtils.authUser = function(req, statuses) {
        var log = logger.getLog();

        if (!req.session || !req.session.user) {
            log.trace('[%1] No user in session', req.uuid);
            return q({ success: false });
        }
        
        return authUtils.getUser(req.session.user).then(function(user) {
            if (!user) {
                log.info('[%1] Unauthorized: user %2 not found', req.uuid, req.session.user);
                return q({ success: false, code: 401, message: 'Unauthorized' });
            }
            if (!statuses) {
                statuses = [Status.Active];
            }

            var hasPermittedStatus = statuses.indexOf(user.status) !== -1;
            if (!hasPermittedStatus) {
                log.info('[%1] Unauthorized: user %2 is %3 instead of %4',
                         req.uuid, user.id, user.status, statuses.join(', '));

                return q({ success: false, code: 403, message: 'Forbidden' });
            }
            
            log.trace('[%1] Successfully authenticated user %2', req.uuid, user.id);
            return q({ success: true, user: user });
        });
    };


    // Fetch the requesting application by key from mongo.
    authUtils.getApp = function(key, req) {
        var self = this,
            log = logger.getLog();
        
        return mongoUtils.findObject(
            self._db.collection('applications'),
            { key: key, status: Status.Active }
        )
        .catch(function(error) {
            log.error('[%1] Error fetching application %2: %3', req.uuid, key, util.inspect(error));
            return q.reject('Db error');
        });
    };

    /**
     * Attempt to fetch + authenticate app that has signed the req. Returned object format:
     * {
     *     success      : Boolean,  // whether or not the app has authenticated successfully
     *     application  : Object    // authenticated app, if success === true
     *     code         : Number,   // if set, response should be returned with this status code
     *     message      : String,   // if set, response will be returned with this body message
     * }
     */
    authUtils.authApp = function(req, tsGracePeriod) {
        var log = logger.getLog(),
            params = signatures.parseAuthHeaders(req);
        
        if (!params.appKey || !params.ts || !params.nonce || !params.signature) {
            return q({ success: false });
        }
        
        if ((Date.now() - params.ts) > tsGracePeriod) {
            log.info('[%1] Unauthorized: timestamp %2 is older than grace period %3',
                     req.uuid, params.ts, tsGracePeriod);
            return q({ success: false, code: 400, message: 'Request timestamp header is too old' });
        }
        
        return authUtils.getApp(params.appKey, req)
        .then(function(app) {
            if (!app) {
                log.info('[%1] Unauthorized: app %2 not found', req.uuid, params.appKey);
                return q({ success: false, code: 401, message: 'Unauthorized' });
            }
            
            if (!signatures.verifyRequest(req, app)) {
                log.info('[%1] Unauthorized: computed sig differs from header', req.uuid);
                return q({ success: false, code: 401, message: 'Unauthorized' });
            }
            
            log.trace('[%1] Successfully authenticated app %2', req.uuid, params.appKey);
            
            // need to save this in case we need to proxy new requests for this app
            req._appSecret = app.secret;
            return q({ success: true, application: mongoUtils.safeApplication(app) });
        });
    };
    
    /**
     * Return an Express middleware function that checks the authentication of the request.
     * - if the request is authenticated, it calls next() and initializes req.requester
     *   - if a user and/or app is authenticated, it initializes req.user and/or req.application
     * - otherwise, it calls res.send()
     *
     * Supported opts (all are optional):
     * {
     *   allowApps      : Boolean   // if true, will attempt to verify request signature + app
     *   tsGracePeriod  : Number    // see signatures.Verifier
     *   userStatuses   : Array     //  list of acceptable user statuses (default to ['active'])
     *   permissions    : {
     *     <objName>    : <verb>,   // requester must have permissions[objName][verb]
     *   }
     * } 
     */
    authUtils.middlewarify = function(opts) {
        var log = logger.getLog();
        opts = opts || {};
        
        return function authorize(req, res, next) {
            return q.all([
                authUtils.authUser(req, opts.userStatuses),
                !!opts.allowApps ? authUtils.authApp(req, opts.tsGracePeriod) : q({success: false})
            ])
            .spread(function(userResult, appResult) {
                // If user auth successful, save to req
                if (userResult.success && userResult.user) {
                    req.user = userResult.user;
                }
                else if (userResult.code) { // otherwise, if need to respond now, call res.send()
                    return res.send(userResult.code, userResult.message || 'Unauthorized');
                }

                // if app auth successful, save to req
                if (appResult.success && appResult.application) {
                    req.application = appResult.application;
                } else if (appResult.code) { // otherwise, if need to respond now, call res.send()
                    return res.send(appResult.code, appResult.message || 'Unauthorized');
                }

                // if neither user nor app authenticated response with 401
                if (!req.user && !req.application) {
                    log.info('[%1] Unauthorized: no user or app authenticated', req.uuid);
                    return res.send(401, 'Unauthorized');
                }
                
                // req.requester contains merged permissions etc. from user + app
                req.requester = authUtils.createRequester(req);
                
                // Check if combined requester has permissions necessary for endpoint
                if (!authUtils._compare(opts.permissions, req.requester.permissions)) {
                    log.info('[%1] Unauthorized: %2 has insufficient permissions',
                             req.uuid, req.requester.id);
                    return res.send(403, 'Forbidden');
                }
                
                // Resave session to extend its TTL
                var promise;
                if (req.session && req.session.user) {
                    promise = q.npost(req.session, 'save');
                } else {
                    promise = q();
                }
                return promise.then(function() {
                    next();
                });
            })
            .catch(function(error) {
                log.error('[%1] Error authorizing request: %2',
                          req.uuid, error && error.stack || error);
                res.send(500, 'Error authorizing request');
            });
        };
    };

    /**
     * Return an object with auth middleware for 'read', 'create', 'edit', and 'delete'; each
     * middlewarify call adds { permissions: { <objName>: <verb> } } to opts
     */
    authUtils.crudMidware = function(objName, opts) {
        var midWareObj = {};

        ['read', 'create', 'edit', 'delete'].forEach(function(verb) {
            var verbOpts = { permissions: {} };
            verbOpts.permissions[objName] = verb;
            objUtils.extend(verbOpts, opts);
            midWareObj[verb] = authUtils.middlewarify(verbOpts);
        });
        
        return midWareObj;
    };

    /**
     * Return a function that validates a email/password combination that can be used as
     * Express middleware.  It acts similarly to middlewarify and will store the user object
     * as req.user, but it does not require the session storage and will not generate a valid
     * login session.
     */
    authUtils.userPassChecker = function(db) {
        var log = logger.getLog(),
            self = this;
        if (db) {
            self._db = db;
        }
        
        return function authenticate(req, res, next) {
            if (!self._db) {
                log.error('[%1] Error checking creds: authUtils._db not defined', req.uuid);
                return res.send(500, 'Error checking authorization of user');
            }
        
            if (!req.uuid) {
                req.uuid = uuid.createUuid().substr(0,10);
            }
            var routeStr = req.method.toUpperCase() + ' ' + path.join(req.baseUrl, req.route.path);
            if (!req.body || typeof req.body.email !== 'string' ||
                             typeof req.body.password !== 'string') {
                log.info('[%1] Unauthorized request %2: Need email and password',
                         req.uuid, routeStr);
                return res.send(400, 'Must provide email and password');
            }
            
            req.body.email = req.body.email.toLowerCase();
            
            mongoUtils.findObject(self._db.collection('users'), { email: req.body.email })
            .then(function(account) {
                if (!account) {
                    log.info('[%1] Unauthorized request %2: unknown email %3',
                             req.uuid, routeStr, req.body.email);
                    return res.send(401, 'Invalid email or password');
                } else if (account.status !== Status.Active) {
                    log.info('[%1] Unauthorized request %2: user %3 not active',
                             req.uuid, routeStr, account.email);
                    return res.send(403, 'Account not active');
                }

                return q.npost(bcrypt, 'compare', [req.body.password, account.password])
                .then(function(matching) {
                    if (!matching) {
                        log.info('[%1] Unauthorized request %2: invalid password',
                                 req.uuid, routeStr, req.body.email);
                        return res.send(401, 'Invalid email or password');
                    }
                    
                    return authUtils.decorateUser(mongoUtils.safeUser(account))
                    .then(function(user) {
                        req.user = user;
                        req.requester = authUtils.createRequester(req);
                        log.trace('[%1] User %2 is authorized to %3',
                                 req.uuid, req.user.id, routeStr);
                        next();
                    });
                });
            })
            .catch(function(error) {
                log.error('[%1] Error checking user/pass for %2 for %3: %4',
                          req.uuid, req.body.email, routeStr, error && error.stack || error);
                res.send(500, 'Error checking authorization of user');
            });
        };
    };
    
    module.exports = authUtils;
}());
