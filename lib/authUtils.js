var q           = require('q'),
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

    /* Currently, perms should be an object whose keys would appear in user.entitlements
     * If this fails because the user is not found or the permissions don't match, it will reject with
     * an object with an error property. If it fails because mongo encounters an error, it will reject
     * with an object with error and detail properties. */
    authUtils.authUser = function(req, db, perms) {
        if (!req.session || !req.session.user) {
            return q.reject({error: "No user is logged in"});
        }
        return authUtils.getUser(req.session.user, db).then(function(user) {
            if (user.status !== 'active') {
                return q.reject({error: "User is inactive"});
            } else if (authUtils.compare(perms, user.permissions)) {
                return q(user);
            } else {
                return q.reject({error: "Permissions do not match"});
            }
        });
    };

    return authUtils;
};

