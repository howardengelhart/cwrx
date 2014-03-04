(function(){
    'use strict';
    var logger  = require('../lib/logger'),
        uuid    = require('../lib/uuid'),
        q       = require('q'),
        promise = require('../lib/promise');

    // cacheTTL determines how long the keeper keeps results for. coll is a mongo collection.
    var QueryCache = function(cacheTTL, coll) {
        var self = this;
        if (!cacheTTL || !coll) {
            throw new Error('Must provide a cacheTTL and mongo collection');
        }
        self.cacheTTL = cacheTTL*60*1000;
        self._coll = coll;
        self._keeper = new promise.Keeper();
    };

    // Sort the query object by its keys to ensure equal queries are identical once stringified
    QueryCache.sortQuery = function(query) {
        var newQuery = {};
        if (typeof query !== 'object') {
            return query;
        }
        if (query instanceof Array) {
            newQuery = [];
        }
        Object.keys(query).sort().forEach(function(key) {
            newQuery[key] = QueryCache.sortQuery(query[key]);
        });
        return newQuery;
    };

    // translate array values to $in format for mongo, then sort
    QueryCache.formatQuery = function(query) {
        Object.keys(query).forEach(function(key) {
            if (query[key] instanceof Array) {
                query[key] = {$in: query[key]};
            }
        });
        return QueryCache.sortQuery(query);
    };

    /**
     * This wraps the collection.find method and caches its results, and should be used in place of
     * it. If the query object contains multiple fields, QueryCache.formatQuery should be called on
     * it first.
     */
    QueryCache.prototype.getPromise = function(query, sort, limit, skip) {
        var self = this,
            log = logger.getLog(),
            keyObj = {query: query, sort: sort, limit: limit, skip: skip},
            key = uuid.hashText(JSON.stringify(keyObj)).substr(0,18),
            deferred = self._keeper.getDeferred(key, true);
        log.trace('Query obj %1 maps to %2', JSON.stringify(keyObj), key);
        if (deferred) {
            log.info('Query %1 cache hit', key);
            return deferred.promise;
        }
        log.info('Query %1 cache miss', key);
        deferred = self._keeper.defer(key);
        q.npost(self._coll.find(query, {sort: sort, limit: limit, skip: skip}), 'toArray')
        .then(function(results) {
            deferred.resolve(results);
        // don't cache mongo errors; may change depending on what mongo errors we could expect
        }).catch(function(error) {
            self._keeper.remove(key, true);
            deferred.reject(error);
        });
        
        setTimeout(function() {
            log.trace('Removing query %1 from the cache', key);
            self._keeper.remove(key, true);
        }, self.cacheTTL);
        
        return deferred.promise;
    };

    module.exports = QueryCache;
}());
