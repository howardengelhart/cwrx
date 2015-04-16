/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        Memcached   = require('memcached'),
        logger      = require('./logger'),
        util        = require('util');
        
    //TODO: should this be a instantiate-able class instead of some universal static cache?

    function Cache(servers, getTimeout, setTimeout) {
        servers = typeof servers === 'string' ? servers.split(',') : servers;
        
        this.timeouts = {
            get: getTimeout || 500, //TODO: reconsider these?
            set: setTimeout || 2000
        };
        //TODO: decide on/set config...
        this._memcached = new Memcached(servers);
        //TODO: setup necessary functions/event handlers...
    }
    
    Cache.prototype.checkConnection = function() {
        var log = logger.getLog(),
            self = this;
            
        return q.npost(self._memcached, 'stats')
        .then(function(resp) {
            log.info('Successfully connected to %1 cache servers', resp.length);
            return true;
        })
        .catch(function(error) {
            log.error('Error checking memcache connection: %1', util.inspect(error));
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    // Get value of the key from the cache
    Cache.prototype.get = function(key) {
        var log = logger.getLog(),
            self = this;

        return q.npost(self._memcached, 'get', [String(key)])
        .then(function(val) {
            log.trace('Successfully retrieved %1 from memcached', key);
            return q(val);
        })
        .timeout(self.timeouts.get)
        .catch(function(error) {
            log.error('Error retrieving %1 from memcached: %2', key, util.inspect(error));
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    // Set key to be val in the cache (regardless of whether key is already defined)
    Cache.prototype.set = function(key, val, ttl) {
        var log = logger.getLog(),
            self = this;
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds

        return q.npost(self._memcached, 'set', [String(key), val, ttl])
        .then(function() {
            log.trace('Successfully set %1 in memcached', key);
            return q();
        })
        .timeout(self.timeouts.set)
        .catch(function(error) {
            log.error('Error setting %1 in memcached: %2', key, util.inspect(error));
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    // Set key to be val in the cache (only if key is not already defined)
    Cache.prototype.add = function(key, val, ttl) {
        var log = logger.getLog(),
            self = this;
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds

        return q.npost(self._memcached, 'add', [String(key), val, ttl])
        .then(function() {
            log.trace('Successfully set %1 in memcached', key);
            return q();
        })
        .timeout(self.timeouts.set)
        .catch(function(error) {
            log.error('Error setting %1 in memcached: %2', key, util.inspect(error));
            return q.reject(new Error('Memcache failure'));
        });
    };

    module.exports = Cache;
}());
