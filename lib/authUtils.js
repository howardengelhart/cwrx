var q           = require('q'),
    logger      = require('./logger'),
    uuid        = require('./uuid'),
    mongoUtils  = require('./mongoUtils');
    
// Can configure this module with a TTL for objects in its cache. The TTL should be in minutes.
module.exports = function(cacheTTL) {
    var authUtils = {};
    authUtils._cache = {};  // placed on the exported object for unit testing
    cacheTTL = (cacheTTL || 30)*60*1000;

    // Retrieve a user object from a local cache or from mongodb
    authUtils.getUser = function(id, db) {
        var deferred = q.defer();
        if (authUtils._cache[id]) {
            return q(authUtils._cache[id]);
        }
        q.npost(db.collection('users'), 'findOne', [{id: id}]).then(function(userAccount) {
            if (!userAccount) {
                return deferred.reject({error: "User not found"});
            }
            var user = mongoUtils.safeUser(userAccount);
            authUtils._cache[id] = user;
            setTimeout(function() {
                delete authUtils._cache[id];
            }, cacheTTL);
            deferred.resolve(user);
        }).catch(function(error) {
            deferred.reject({
                error: "Error looking up user",
                detail: error
            });
        });
        return deferred.promise;
    };

    // deep object comparison, using first param as template to compare to
    authUtils.compare = function(item, userItem) {
        if (typeof item === 'object') {
            for (var key in item) {
                if (!authUtils.compare(item[key], userItem[key])) {
                    return false;
                }
            }
            return true;
        } else {
            return item === userItem;
        }
    };

    /** 
     * Currently, perms should be an object whose keys would appear in user.entitlements
     * If this fails because the user is not found or the permissions don't match, it will reject
     * with an object with an error property. If it fails because mongo encounters an error, it
     * will reject with an object with error and detail properties.
     */
    authUtils.authUser = function(id, db, perms) {
        return authUtils.getUser(id, db).then(function(user) {
            if (user.status !== 'active') {
                return q.reject({error: "User is inactive"});
            } else if (authUtils.compare(perms, user.permissions)) {
                return q(user);
            } else {
                return q.reject({error: "Permissions do not match"});
            }
        });
    };
    
    /**
     * Return a function wrapping authUser that can be used as Express middleware. This function
     * will log the results of authentication, and send appropriate error responses if it fails.
     * If authentication succeeds, it will call next() and store the user object on the request.
     */
    authUtils.middlewarify = function(db, perms) {
        var log = logger.getLog();
        return function authenticate(req, res, next) {
            if (!req.uuid) req.uuid = uuid.createUuid().substr(0,10);
            var routeStr = req.route.method.toUpperCase() + ' ' + req.route.path;
            if (!req.session || !req.session.user) {
                log.info('[%1] Unauthorized request %2: No user logged in', req.uuid, routeStr);
                return res.send(401, "Unauthorized");
            }
            authUtils.authUser(req.session.user, db, perms).then(function(user) {
                req.user = user;
                log.info('[%1] User %2 is authorized to %3', req.uuid, user.id, routeStr);
                next();
            }).catch(function(errorObj) {
                if (errorObj.detail) {
                    log.error('[%1] Error authorizing user %2 for %3: %4',
                              req.uuid, req.session.user, routeStr, errorObj.detail);
                    res.send(500, "Error checking authorization of user");
                } else {
                    log.info('[%1] User %2 is not authorized to %3: %4',
                             req.uuid, req.session.user, routeStr, errorObj.error);
                    res.send(401, "Unauthorized");
                }
            });
        };
    };

    return authUtils;
};

