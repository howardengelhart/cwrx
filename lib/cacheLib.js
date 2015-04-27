/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        Memcached   = require('memcached'),
        logger      = require('./logger'),
        util        = require('util');
        
    function Cache(servers, readTimeout, writeTimeout) {
        if (!servers || servers.length === 0) {
            throw new Error('Cannot create a cache without servers to connect to');
        }
        servers = typeof servers === 'string' ? servers.split(',') : servers;
        
        this.timeouts = {
            read: readTimeout || 500,
            write: writeTimeout || 2000
        };
        // this config may change later as I decide on how adding/removing servers will work
        this._memcached = new Memcached(servers, {
            retries: 1,
            minTimeout: 1000,
            maxTimeout: 1000,
            reconnect: 2000,
            timeout: 1000,
            failures: 0,
            failuresTimeout: 1000,
            retry: 1000,
            idle: 0,
        });
        
        //TODO: setup event handlers?
    }
    
    //TODO: test, comment
    Cache.prototype.updateServers = function(servers) {
        var log = logger.getLog(),
            self = this,
            addList, removeList;
            
        servers = (typeof servers === 'string' ? servers.split(',') : servers) || [];
        
        addList = servers.filter(function(s) {
            return self._memcached.servers.indexOf(s) === -1;
        });
        
        removeList = self._memcached.servers.filter(function(s) {
            return servers.indexOf(s) === -1;
        });
        
        log.info('Adding servers %1 to memcached client', addList);
        log.info('Removing servers %1 to memcached client', addList);
        
        while (Math.max(addList.length, removeList.length) > 0) {
            var toAdd = addList.pop(),
                toRemove = removeList.pop();

            if (toRemove) {
                self._memcached.connections[toRemove].end();
                delete self._memcached.connections[toRemove];
                delete self._memcached.issues[toRemove];

                // try to swap toRemove + toAdd in HashRing, to minimize re-hashing keys to servers
                if (toAdd) {
                    self._memcached.HashRing.swap(toRemove, toAdd);
                } else {
                    self._memcached.HashRing.remove(toRemove);
                }
            } else if (toAdd) {
                self._memcached.HashRing.add(toAdd);
            }
        }
        
        self._memcached.servers = servers;
        
        return self.checkConnection();
    };
    
    // Execute a command against the memcached client. opType determines which timeout value to use
    Cache.prototype._memcachedCommand = function(cmd, opType, args) {
        var log = logger.getLog(),
            self = this,
            keyStr = args && args[0] && ('for ' + args[0]) || ''; // for logging
            
        if (!cmd || !self._memcached[cmd]) {
            return q.reject('"' + cmd + '" is not a valid memcached command');
        }

        opType = (opType in self.timeouts) ? opType : 'read';
            
        return q.npost(self._memcached, cmd, args)
        .then(function(resp) {
            log.trace('Successfully executed %1 %2 on cache', cmd, keyStr);
            return q(resp);
        })
        .timeout(self.timeouts[opType])
        .catch(function(error) {
            log.error('Error executing %1 %2 on cache: %3', cmd, keyStr, util.inspect(error));
            return q.reject(new Error('Memcache failure'));
        });
    };
    
    // For node-memcached client, run a basic command to check that connection is working
    Cache.prototype.checkConnection = function() {
        return this._memcachedCommand('stats', 'read').thenResolve(true);
    };
    
    // Get value of the key from the cache
    Cache.prototype.get = function(key) {
        return this._memcachedCommand('get', 'read', [key]);
    };
    
    // Set key to be val in the cache (regardless of whether key is already defined)
    Cache.prototype.set = function(key, val, ttl) {
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds
        return this._memcachedCommand('set', 'write', [key, val, ttl]);
    };
    
    // Set key to be val in the cache (only if key is not already defined)
    Cache.prototype.add = function(key, val, ttl) {
        var log = logger.getLog(),
            self = this;

        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds
        
        return q.npost(self._memcached, 'add', [key, val, ttl])
        .then(function(resp) {
            log.trace('Successfully executed add for %1 on cache', key);
            return q(resp);
        })
        .timeout(self.timeouts.write)
        .catch(function(error) {
            if (error && error.message === 'Item is not stored') {
                log.info('Key %1 already exists in cache, not overwriting', key);
                return q();
            } else {
                log.error('Error executing add for %1 on cache: %2', key, util.inspect(error));
                return q.reject(new Error('Memcache failure'));
            }
        });
    };
    
    // Delete key from cache
    Cache.prototype.delete = function(key) {
        return this._memcachedCommand('delete', 'write', [key]);
    };
    
    // Closes all connections to the cache
    Cache.prototype.close = function() {
        this._memcached.end();
    };

    
    // An async factory method for creating cache conn; should work for any cache lib
    function createCache(servers, readTimeout, writeTimeout) {
        return q.fcall(function() {
            var cache = new Cache(servers, readTimeout, writeTimeout);
            
            return cache.checkConnection().thenResolve(cache);
        });
    }

    module.exports = {
        Cache: Cache,
        createCache: createCache
    };
}());
