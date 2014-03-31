(function(){
    'use strict';
    var logger  = require('../lib/logger'),
        uuid    = require('../lib/uuid'),
        q       = require('q'),
        promise = require('../lib/promise');

    /**
     * Will cache promises for the results of queries to mongo.  When freshTTL minutes have passed
     * since the last time a given query was made, this will return the cached results but start a
     * call to refresh the cached results; this will reset the promise's age. When maxTTL minutes
     * have passed since the last time a given query was made, this will remove the cache promise
     * and force a new call to mongo, caching the new promise.
     */
    var QueryCache = function(freshTTL, maxTTL, coll) {
        var self = this;
        if (!freshTTL || !maxTTL || !coll) {
            throw new Error('Must provide a freshTTL, maxTTL, and mongo collection');
        }
        self.freshTTL = freshTTL*60*1000;
        self.maxTTL = maxTTL*60*1000;
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
            var age = new Date() - deferred.keeperCreateTime;
            log.trace(age);
            if (age > self.maxTTL) {
                log.info('Query %1 too old, removing', key);
                self._keeper.remove(key, true);
            } else if (age > self.freshTTL && !deferred.refreshStarted) {
                deferred.refreshStarted = true;
                log.info('Query %1 needs to be refreshed', key);
                process.nextTick(function() {
                    q.npost(self._coll.find(query, {sort:sort, limit:limit, skip:skip}), 'toArray')
                    .then(function(results) {
                        log.trace('Query %1 refreshed successfully', key);
                        var newDeferred = self._keeper.defer(key);
                        newDeferred.resolve(results);
                    }).catch(function(error) {
                        var newDeferred = self._keeper.defer(key);
                        setTimeout(function() { self._keeper.remove(key, true); }, 10*1000);
                        newDeferred.reject(error);
                    });
                });
                return deferred.promise;
            } else {
                log.info('Query %1 cache hit', key);
                return deferred.promise;
            }
        }
        log.info('Query %1 cache miss', key);
        deferred = self._keeper.defer(key);
        q.npost(self._coll.find(query, {sort: sort, limit: limit, skip: skip}), 'toArray')
        .then(function(results) {
            deferred.resolve(results);
        // cache mongo errors for short time to reduce load on mongo while it's having problems
        }).catch(function(error) {
            setTimeout(function() { self._keeper.remove(key, true); }, 10*1000);
            deferred.reject(error);
        });
        
        return deferred.promise;
    };

    module.exports = QueryCache;
}());
