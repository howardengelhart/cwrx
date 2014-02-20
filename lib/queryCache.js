var logger  = require('../lib/logger'),
    uuid    = require('../lib/uuid'),
    q       = require('q'),
    promise = require('../lib/promise');

var QueryCache = function(cacheTTL, coll) {
    var self = this;
    if (!cacheTTL || !coll) {
        throw new Error("Must provide a cacheTTL and mongo collection");
    }
    self.cacheTTL = cacheTTL*60*1000;
    self._coll = coll;
    self._keeper = new promise.Keeper();
};

QueryCache.sortQuery = function(query) {
    var self = this,
        newQuery = {};
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

QueryCache.formatQuery = function(query) {
    var self = this;
    Object.keys(query).forEach(function(key) {
        if (query[key] instanceof Array) {
            query[key] = {$in: query[key]};
        }
    });
    return QueryCache.sortQuery(query);
};

QueryCache.prototype.getPromise = function(reqId, query, sort, limit, skip) {
    var self = this,
        log = logger.getLog(),
        keyObj = {query: query, sort: sort, limit: limit, skip: skip},
        key = uuid.hashText(JSON.stringify(keyObj)).substr(0,18),
        deferred = self._keeper.getDeferred(key, true);
    if (deferred) {
        log.info("[%1] Query %2 cache hit", reqId, key);
        return deferred.promise;
    }
    log.info("[%1] Query %2 cache miss", reqId, key);
    deferred = self._keeper.defer(key);
    q.npost(self._coll.find(query, {sort: sort, limit: limit, skip: skip}), 'toArray')
    .then(function(results) {
        deferred.resolve(results);
    }).catch(function(error) { // don't cache mongo errors; may change depending on what mongo errors we could expect
        self._keeper.remove(key, true);
        deferred.reject(error);
    });
    
    setTimeout(function() {
        log.trace("Removing query %1 from the cache", key);
        self._keeper.remove(key, true);
    }, self.cacheTTL);
    
    return deferred.promise;
};

module.exports = QueryCache;
