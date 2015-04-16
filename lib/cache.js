/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        Memcached   = require('memcached'),
        logger      = require('./logger'),

        cacheLib = { timeouts: {} };
        
    //TODO: should this be a instantiate-able class instead of some universal static cache?

    cacheLib.timeouts.get = 500; //TODO: rethinkl, ultimately will want to get from config
    cacheLib.timeouts.set = 2000;

    cacheLib._memcached = new Memcached('localhost:11211'); //TODO: replace this placeholder!
    

    cacheLib.get = function(key) {
        var log = logger.getLog();

        return q.npost(cacheLib._memcached, 'get', [String(key)])
        .then(function(val) {
            log.trace('Successfully retrieved %1 from memcached', key); // TODO: maybe not for cache misses
            return q(val);
        })
        .timeout(cacheLib.timeouts.get)
        .catch(function(error) {
            log.error('Error retrieving %1 from memcached: %2', key, util.inspect(error)); //TODO: or log.warn?
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    cacheLib.set = function(key, val, ttl) {
        var log = logger.getLog();
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds

        return q.npost(cacheLib._memcached, 'set', [String(key), val, ttl])
        .then(function() {
            log.trace('Successfully set %1 in memcached', key);
            return q();
        })
        .timeout(cacheLib.timeouts.set)
        .catch(function(error) {
            log.error('Error setting %1 in memcached: %2', key, util.inspect(error)); //TODO: or log.warn?
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    cacheLib.add = function(key, val, ttl) { //TODO: rename? this is set-if-not-exists
        var log = logger.getLog();
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds

        return q.npost(cacheLib._memcached, 'add', [String(key), val, ttl])
        .then(function() {
            log.trace('Successfully set %1 in memcached', key);
            return q();
        })
        .timeout(cacheLib.timeouts.set)
        .catch(function(error) {
            log.error('Error setting %1 in memcached: %2', key, util.inspect(error)); //TODO: or log.warn?
            return q.reject(new Error('Memcache failure'));
        });
    };

    module.exports = cacheLib;
}());
