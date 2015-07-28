(function(){
    'use strict';
    var q           = require('q'),
        path        = require('path'),
        logger      = require('./logger'),
        uuid        = require('./uuid'),
        bcrypt      = require('bcrypt'),
        mongoUtils  = require('./mongoUtils'),
        enums       = require('../lib/enums'),
        Status      = enums.Status,
        Scope       = enums.Scope,
        authUtils = {};
        
    //TODO: rethink how authUtils._db is used/passed in + whether this should be instantiated class
        
    // Retrieve a user from mongodb. Must have previously set this._db
    authUtils.getUser = function(id) {
        var self = this;

        return q.npost(self._db.collection('users'), 'findOne', [{id: id}])
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
    
    
    authUtils.decorateUser = function(user) { //TODO: comment, test
        var self = this,
            log = logger.getLog(),
            roleColl = self._db.collection('roles'),
            polColl = self._db.collection('policies'),
            rolePromise, polPromise, polList;
            
        polList = user.policies || [];
    
        if (!user.roles || !user.roles.length) {
            rolePromise = q();
        } else { //TODO: will we use role ids or names?
            rolePromise = q.npost(roleColl.find({ id: { $in: user.roles } }), 'toArray');
        }
        
        return rolePromise.then(function(roles) {
            (roles || []).forEach(function(role) {
                polList.concat(role.policies || []);
            });
            
            log.trace('User %1 has policies: [%2]', user.id, polList);
            
            if (polList.length === 0) {
                polPromise = q();
            } else { //TODO: policiy ids or names?
                var cursor = polColl.find({ id: { $in: polList } }, { sort: { id: 1 } });
                polPromise = q.npost(cursor, 'toArray');
            }
            
            return polPromise;
        })
        .then(function(policies) {
            if (!policies) {
                log.warn('No policies found for user %1', user.id);
                return q();
            }
            
            user.permissions = authUtils.mergePermissions(policies);
            user.fieldValidation = authUtils.mergeValidation(policies);
            user.entitlements = authUtils.mergeEntitlements(policies);
        })
        .thenResolve(user);
        //TODO: should we catch errors here? rethink error handling in all these funcs?
    };

    
    authUtils.mergePermissions = function(policies) { //TODO: test, comment
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


    authUtils.mergeValidation = function(policies) { //TODO: test, comment
        var validation = {};
        
        // sort by priority so we take rules from policies with highest priority first
        policies.sort(function(a, b) {
            return b.priority - a.priority;
        }).forEach(function(policy) {
            authUtils._mergeValidationObj(validation, policy.fieldValidation);
        });
        
        return validation;
    };
    
    
    authUtils._mergeValidationObj = function(target, source) { //TODO: test, comment
        if (!source || typeof source !== 'object') {
            return;
        }
        
        Object.keys(source).forEach(function(key) {
            // ignore '_' fields part of validation DSL
            if (/^_.+/.test(key)) {
                return;
            }
            
            // copy full sub-object if undefined in target
            if (!target[key]) {
                target[key] = source[key];
                return;
            }
            
            // otherwise recursively merge sub-props
            authUtils._mergeValidationObj(target[key], source[key]);
        });
    };


    authUtils.mergeEntitlements = function(policies) { //TODO: test, comment
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


    /**
     * Perms should be an object whose keys are database objects, and the values are
     * strings of the verbs required for the method. For example, { experiences: 'write' }.
     * This will check that each dbObject-verb pair in perms exists in userPerms
     * (ignoring scopes).
     */
    authUtils.compare = function(perms, userPerms) {
        return Object.keys(perms).every(function(key) {
            return (userPerms[key] && userPerms[key][perms[key]]);
        });
    };

    /** 
     * Checks that the user with the given id exists, is active, and has the required
     * permissions. If this fails because the user is not found or the permissions don't
     * match, it will reject with an object with an error property. If it fails because
     * mongo encounters an error, it will reject with an object with error and detail
     * properties.
     */
    authUtils.authUser = function(id, perms) {
        return authUtils.getUser(id).then(function(user) {
            if (!user) {
                return q('User not found');
            }
            if (user.status !== Status.Active) {
                return q('User is not active');
            } else if (authUtils.compare(perms, user.permissions)) {
                return q({user: user});
            } else {
                return q('Permissions do not match');
            }
        });
    };
    
    /**
     * Return a function wrapping authUser that can be used as Express middleware. This
     * function will log the results of authorization, and send appropriate error
     * responses if it fails. If authorization succeeds, it will call next() and store
     * the user object on the request.
     */
    authUtils.middlewarify = function(perms, db) {
        var log = logger.getLog(),
            self = this;
        if (db) {
            self._db = db;
        }

        return function authorize(req, res, next) {
            if (!req.uuid) {
                req.uuid = uuid.createUuid().substr(0,10);
            }
            var routeStr = req.method.toUpperCase() + ' ' + path.join(req.baseUrl, req.route.path);
            if (!req.session || !req.session.user) {
                log.info('[%1] Unauthorized request %2: No user logged in', req.uuid, routeStr);
                return res.send(401, 'Unauthorized');
            }
            authUtils.authUser(req.session.user, perms).then(function(result) {
                if (result.user) {
                    req.user = result.user;
                    log.info('[%1] User %2 is authorized to %3',req.uuid,req.user.id,routeStr);
                    next();
                } else {
                    log.info('[%1] User %2 is not authorized to %3: %4',
                             req.uuid, req.session.user, routeStr, result);
                    res.send(403, 'Forbidden');
                }
            }).catch(function(error) {
                log.error('[%1] Error authorizing user %2 for %3: %4',
                          req.uuid, req.session.user, routeStr, error);
                res.send(500, 'Error checking authorization of user');
            });
        };
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
            
            q.npost(self._db.collection('users'), 'findOne', [{email: req.body.email}])
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
                        log.info('[%1] User %2 is authorized to %3',
                                 req.uuid, req.user.id, routeStr);
                        next();
                    });
                });
            })
            .catch(function(error) {
                log.error('[%1] Error checking user/pass for %2 for %3: %4',
                          req.uuid, req.body.email, routeStr, error);
                res.send(500, 'Error checking authorization of user');
            });
        };
    };
    
    module.exports = authUtils;
}());
