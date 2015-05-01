/*jslint camelcase: false */
(function(){
    'use strict';
    var q           = require('q'),
        Memcached   = require('memcached'),
        logger      = require('./logger'),
        util        = require('util'),
        
        cacheLib = {};

    // Wrap a Cache method that relies on the memcached client, and reject if the cache is not ready
    cacheLib._callIfReady = function(method) {
        return function() {
            var self = this;
            
            if (!self.cacheReady) {
                return q.reject('Cache is not usable yet');
            }
            
            return method.apply(self, Array.prototype.slice.call(arguments));
        };
    };

    // Initialize a cache using a list of servers (CSV or array) and optional timeout values
    cacheLib.Cache = function(servers, readTimeout, writeTimeout) {
        var self = this;

        // Used within our code to give up on a memcached command and send a response to the client
        self.timeouts = {
            read: readTimeout || 500,
            write: writeTimeout || 2000
        };

        Object.defineProperty(self, 'cacheReady', {
            get : function() {
                return !!(self._memcached && self._memcached.servers &&
                          self._memcached.servers.length > 0);
            }
        });

        servers = (servers && typeof servers === 'string' ? servers.split(',') : servers) || [];
        self._initClient(servers);
    };
    
    // Initializes the internal memcached client with the array of servers, if it's not empty
    cacheLib.Cache.prototype._initClient = function(servers) {
        var self = this,
            log = logger.getLog();
            
        if (!servers || servers.length === 0) {
            log.info('No servers provided, not initializing memcached client');
            return;
        }
            
        log.info('Initializing cache client with servers: [%1]', servers);
    
        /* This config ensures the client will retry failed connections up to 3 times, with 1 sec
         * timeouts in between retries. After those 3 tries, it will mark the server as dead and
         * completely remove it from the server list. Also, connections will not timeout if idle. */
        self._memcached = new Memcached(servers, {
            retries: 3,
            minTimeout: 1000,
            maxTimeout: 1000,
            timeout: 0,
            failures: 0,
            idle: 0,
            remove: true
        });

        // This ensures a failed server is fully removed from the client
        //TODO: maybe just build this into a forked node-memcached? or send a PR for it?
        self._memcached.on('failure', function(details) {
            log.error('Memcached server %1 has failed + is being removed', details.server);
            delete self._memcached.issues[details.server];
            delete self._memcached.connections[details.server];
            self._memcached.servers = self._memcached.servers.filter(function(s) {
                return s !== details.server;
            });
        });
    };
    
    /* Update the cache client with a new list of servers. Will call _initClient if no internal
     * client. Calls checkConnection() to create connections to newly added servers and check the
     * validity of the server list. */
    cacheLib.Cache.prototype.updateServers = function(servers) {
        var log = logger.getLog(),
            self = this,
            addList, removeList;
            
        servers = (servers && typeof servers === 'string' ? servers.split(',') : servers) || [];
        
        if (!self._memcached) {
            self._initClient(servers);
            return self.checkConnection();
        }
        
        addList = servers.filter(function(s) {
            return self._memcached.servers.indexOf(s) === -1;
        });
        
        removeList = self._memcached.servers.filter(function(s) {
            return servers.indexOf(s) === -1;
        });
        
        if (addList.length === 0 && removeList.length === 0) {
            log.trace('No changes to cache server list');
            return self.checkConnection();
        }
        
        log.info('Adding servers [%1] to memcached client', addList);
        log.info('Removing servers [%1] from memcached client', removeList);
        
        while (Math.max(addList.length, removeList.length) > 0) {
            var toAdd = addList.pop(),
                toRemove = removeList.pop();

            if (toRemove) {
                if (self._memcached.connections[toRemove]) {
                    self._memcached.connections[toRemove].end();
                    delete self._memcached.connections[toRemove];
                }
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
        
        if (servers.length === 0) {
            log.warn('No cache servers, reverting to cache unready state');
            return q();
        }
        
        return self.checkConnection();
    };
    
    // Execute a command against the memcached client. opType determines which timeout value to use
    cacheLib.Cache.prototype._memcachedCommand = function(cmd, opType, args) {
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
    cacheLib.Cache.prototype.checkConnection = cacheLib._callIfReady(function() {
        return this._memcachedCommand('stats', 'read').thenResolve(true);
    });
    
    // Get value of the key from the cache
    cacheLib.Cache.prototype.get = cacheLib._callIfReady(function(key) {
        return this._memcachedCommand('get', 'read', [key]);
    });
    
    // Set key to be val in the cache (regardless of whether key is already defined)
    cacheLib.Cache.prototype.set = cacheLib._callIfReady(function(key, val, ttl) {
        ttl = ttl / 1000; // our TTL vals are in ms but memcached expects seconds
        return this._memcachedCommand('set', 'write', [key, val, ttl]);
    });
    
    // Set key to be val in the cache (only if key is not already defined)
    cacheLib.Cache.prototype.add = cacheLib._callIfReady(function(key, val, ttl) {
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
    });
    
    // Delete key from cache
    cacheLib.Cache.prototype.delete = cacheLib._callIfReady(function(key) {
        return this._memcachedCommand('delete', 'write', [key]);
    });

    
    // Closes all connections to the cache
    cacheLib.Cache.prototype.close = function() {
        var log = logger.getLog(),
            self = this;

        if (!self.cacheReady) {
            log.info('Cache not ready, so not closing any connections');
            return;
        }

        self._memcached.end();
    };

    module.exports = cacheLib;
}());
