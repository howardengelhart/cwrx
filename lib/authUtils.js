(function(){
    'use strict';
    var q           = require('q'),
        logger      = require('./logger'),
        uuid        = require('./uuid'),
        bcrypt      = require('bcrypt'),
        mongoUtils  = require('./mongoUtils'),
        enums       = require('../lib/enums'),
        Status      = enums.Status,
        authUtils = {};
        
    // Retrieve a user from mongodb. Must either pass in a coll or have previously set this._coll
    authUtils.getUser = function(id) {
        var self = this;

        if (!self._coll) {
            throw new Error('No collection provided!');
        }
        
        return q.npost(self._coll, 'findOne', [{id: id}]).then(function(account) {
            return q(mongoUtils.safeUser(account));
        }).catch(function(error) {
            return q.reject(JSON.stringify({
                error: 'Error looking up user',
                detail: error
            }));
        });
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
     * function will log the results of authentication, and send appropriate error
     * responses if it fails. If authentication succeeds, it will call next() and store
     * the user object on the request.
     */
    authUtils.middlewarify = function(perms, coll) {
        var log = logger.getLog(),
            self = this;
        if (coll) {
            self._coll = coll;
        }

        return function authenticate(req, res, next) {
            if (!req.uuid) {
                req.uuid = uuid.createUuid().substr(0,10);
            }
            var routeStr = req.route.method.toUpperCase() + ' ' + req.route.path;
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
    authUtils.userPassChecker = function(coll) {
        var log = logger.getLog(),
            self = this;
        if (coll) {
            self._coll = coll;
        }
        
        return function authenticate(req, res, next) {
            if (!self._coll) {
                log.error('[%1] Error checking creds: authUtils._coll not defined', req.uuid);
                return res.send(500, 'Error checking authorization of user');
            }
        
            if (!req.uuid) {
                req.uuid = uuid.createUuid().substr(0,10);
            }
            var routeStr = req.route.method.toUpperCase() + ' ' + req.route.path;
            if (!req.body || typeof req.body.email !== 'string' ||
                             typeof req.body.password !== 'string') {
                log.info('[%1] Unauthorized request %2: Need email and password',
                         req.uuid, routeStr);
                return res.send(400, 'Must provide email and password');
            }
            
            req.body.email = req.body.email.toLowerCase();
            
            q.npost(self._coll, 'findOne', [{email: req.body.email}])
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
                    if (matching) {
                        req.user = mongoUtils.safeUser(account);
                        log.info('[%1] User %2 is authorized to %3',
                                 req.uuid, req.user.id, routeStr);
                        next();
                    } else {
                        log.info('[%1] Unauthorized request %2: invalid password',
                                 req.uuid, routeStr, req.body.email);
                        return res.send(401, 'Invalid email or password');
                    }
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
