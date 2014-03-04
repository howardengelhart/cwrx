(function(){
    'use strict';
    var q           = require('q'),
        logger      = require('./logger'),
        uuid        = require('./uuid'),
        mongoUtils  = require('./mongoUtils');
        
    // Can configure this module with a TTL for objects in its cache. The TTL should be in minutes.
    // if a cache object is not provided, a new one will be created
    module.exports = function(cacheTTL, cache) {
        var authUtils = {};
        // cache is placed on the exported object for unit testing
        authUtils._cache = (typeof cache === 'object') ? cache : {};
        cacheTTL = (cacheTTL || 30)*60*1000;

        // Retrieve a user object from a local cache or from mongodb
        authUtils.getUser = function(id, db) {
            var deferred = q.defer();
            if (authUtils._cache[id]) {
                return q(authUtils._cache[id]);
            }
            q.npost(db.collection('users'), 'findOne', [{id: id}]).then(function(userAccount) {
                if (!userAccount) {
                    return deferred.resolve(userAccount);
                }
                var user = mongoUtils.safeUser(userAccount);
                authUtils._cache[id] = user;
                setTimeout(function() {
                    delete authUtils._cache[id];
                }, cacheTTL);
                deferred.resolve(user);
            }).catch(function(error) {
                deferred.reject({
                    error: 'Error looking up user',
                    detail: error
                });
            });
            return deferred.promise;
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
        authUtils.authUser = function(id, db, perms) {
            return authUtils.getUser(id, db).then(function(user) {
                if (!user) {
                    return q.reject({error: 'User not found'});
                }
                if (user.status !== 'active') {
                    return q.reject({error: 'User is inactive'});
                } else if (authUtils.compare(perms, user.permissions)) {
                    return q(user);
                } else {
                    return q.reject({error: 'Permissions do not match'});
                }
            });
        };
        
        /**
         * Return a function wrapping authUser that can be used as Express middleware. This
         * function will log the results of authentication, and send appropriate error
         * responses if it fails. If authentication succeeds, it will call next() and store
         * the user object on the request.
         */
        authUtils.middlewarify = function(db, perms) {
            var log = logger.getLog();
            return function authenticate(req, res, next) {
                if (!req.uuid) {
                    req.uuid = uuid.createUuid().substr(0,10);
                }
                var routeStr = req.route.method.toUpperCase() + ' ' + req.route.path;
                if (!req.session || !req.session.user) {
                    log.info('[%1] Unauthorized request %2: No user logged in', req.uuid, routeStr);
                    return res.send(401, 'Unauthorized');
                }
                authUtils.authUser(req.session.user, db, perms).then(function(user) {
                    req.user = user;
                    log.info('[%1] User %2 is authorized to %3', req.uuid, user.id, routeStr);
                    next();
                }).catch(function(errorObj) {
                    if (errorObj.detail) {
                        log.error('[%1] Error authorizing user %2 for %3: %4',
                                  req.uuid, req.session.user, routeStr, errorObj.detail);
                        res.send(500, 'Error checking authorization of user');
                    } else {
                        log.info('[%1] User %2 is not authorized to %3: %4',
                                 req.uuid, req.session.user, routeStr, errorObj.error);
                        res.send(403, 'Forbidden');
                    }
                });
            };
        };

        return authUtils;
    };
}());
