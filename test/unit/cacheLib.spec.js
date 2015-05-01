var flush = true;
describe('cacheLib', function() {
    var q, mockLog, logger, cacheLib, mockMemLib, mockMemClient, anyFunc, Memcached;
    
    beforeEach(function() {
        jasmine.Clock.useMock();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        logger      = require('../../lib/logger');
        anyFunc     = jasmine.any(Function);
        
        mockMemClient = {
            servers: ['host1:11211'],
            stats: jasmine.createSpy('memcached.stats()'),
            get: jasmine.createSpy('memcached.get()'),
            set: jasmine.createSpy('memcached.set()'),
            add: jasmine.createSpy('memcached.add()'),
            delete: jasmine.createSpy('memcached.delete()'),
            end: jasmine.createSpy('memcached.end()'),
            on: jasmine.createSpy('memcached.on()').andCallFake(function(event, fn) {
                mockMemClient['on' + event] = fn;
            })
        };
        
        mockMemLib = jasmine.createSpy('Memcached()').andReturn(mockMemClient);
        require.cache[require.resolve('memcached')] = { exports: mockMemLib };
        
        delete require.cache[require.resolve('../../lib/cacheLib')];
        cacheLib = require('../../lib/cacheLib');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        
        spyOn(cacheLib.Cache.prototype, '_initClient').andCallThrough();
    });
    
    describe('Cache', function() {
        describe('initialization', function() {
            it('should call _initClient with the servers', function() {
                var cache = new cacheLib.Cache('host1:123,host2:456', 5000, 6000);
                expect(cache.timeouts).toEqual({read: 5000, write: 6000});
                expect(cache._initClient).toHaveBeenCalledWith(['host1:123', 'host2:456']);
            });
            
            it('should create a dynamic cacheReady property', function() {
                var cache = new cacheLib.Cache();
                expect(cache.cacheReady).toBe(false);
                cache._initClient(['host1:123']);
                expect(cache.cacheReady).toBe(true);
                mockMemClient.servers = [];
                expect(cache.cacheReady).toBe(false);
            });
            
            it('should have defaults for the timeouts', function() {
                var cache = new cacheLib.Cache('host1:123,host2:456');
                expect(cache.timeouts).toEqual({read: 500, write: 2000});
                expect(cache._initClient).toHaveBeenCalled();
            });

            it('should handle different formats of server lists', function() {
                var c1 = new cacheLib.Cache(['host1:123', 'host2:456', 'host3:789']);
                expect(cacheLib.Cache.prototype._initClient.calls[0].args).toEqual([['host1:123', 'host2:456', 'host3:789']]);
                
                var c2 = new cacheLib.Cache([]);
                expect(cacheLib.Cache.prototype._initClient.calls[1].args).toEqual([[]]);
                expect(c2._memcached).not.toBeDefined();
                
                var c3 = new cacheLib.Cache('');
                expect(cacheLib.Cache.prototype._initClient.calls[2].args).toEqual([[]]);
                expect(c3._memcached).not.toBeDefined();

                var c4 = new cacheLib.Cache('host1:123');
                expect(cacheLib.Cache.prototype._initClient.calls[3].args).toEqual([['host1:123']]);
            });
        });
        
        describe('_initClient', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache();
            });

            it('should correctly initialize the memcached client', function() {
                expect(cache._memcached).not.toBeDefined();
                cache._initClient(['host1:123', 'host2:456']);
                expect(cache._memcached).toBe(mockMemClient);
                expect(mockMemLib).toHaveBeenCalledWith(['host1:123', 'host2:456'], {
                    retries: 3,
                    minTimeout: 1000,
                    maxTimeout: 1000,
                    timeout: 0,
                    failures: 0,
                    idle: 0,
                    remove: true
                });
                expect(mockMemClient.on).toHaveBeenCalledWith('failure', anyFunc);
            });
            
            it('should not create a memcached client if there are no servers', function() {
                cache._initClient([]);
                cache._initClient(undefined);
                expect(cache._memcached).not.toBeDefined();
                expect(mockMemLib).not.toHaveBeenCalled();
            });
            
            describe('sets up a "failure" handler that', function() {
                it('should fully remove a server from the client', function() {
                    cache._initClient(['host1:123', 'host2:456']);
                    mockMemClient.servers = ['host1:123', 'host2:456'];
                    mockMemClient.connections = {
                        'host1:123': { conn: 'yes' },
                        'host2:456': { conn: 'yes' }
                    };
                    mockMemClient.issues = {
                        'host1:123': { failedOnce: 'yes' },
                        'host2:456': { failedOnce: 'no' }
                    };
                    
                    mockMemClient.onfailure({ server: 'host2:456', err: 'oh noes!' });
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.servers).toEqual(['host1:123']);
                    expect(mockMemClient.connections).toEqual({ 'host1:123': { conn: 'yes' } });
                    expect(mockMemClient.issues).toEqual({ 'host1:123': { failedOnce: 'yes' } });
                });
            });
        });
        
        describe('updateServers', function() {
            var cache, end1, end2;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:123');
                end1 = jasmine.createSpy('end'), end2 = jasmine.createSpy('end');
                mockMemClient.servers = ['h1:11', 'h1:22'];
                mockMemClient.connections = {
                    'h1:11': { end: end1, conn: 'yes' },
                    'h1:22': { end: end2, conn: 'yes' }
                };
                mockMemClient.issues = {
                    'h1:11': { failedOnce: 'yes' },
                    'h1:22': { failedOnce: 'no' }
                };
                mockMemClient.HashRing = {
                    add: jasmine.createSpy('HashRing.add'),
                    swap: jasmine.createSpy('HashRing.swap'),
                    remove: jasmine.createSpy('HashRing.remove')
                };
                spyOn(cache, 'checkConnection').andReturn(q(true));
            });
            
            it('should swap in new servers and call checkConnection', function(done) {
                cache.updateServers('h2:11,h2:22').then(function(val) {
                    expect(val).toBe(true);
                    expect(mockMemClient.servers).toEqual(['h2:11', 'h2:22']);
                    expect(mockMemClient.connections['h1:11']).not.toBeDefined();
                    expect(mockMemClient.connections['h1:22']).not.toBeDefined();
                    expect(mockMemClient.issues['h1:11']).not.toBeDefined();
                    expect(mockMemClient.issues['h1:22']).not.toBeDefined();
                    expect(end1).toHaveBeenCalled();
                    expect(end2).toHaveBeenCalled();
                    expect(mockMemClient.HashRing.swap).toHaveBeenCalledWith('h1:11', 'h2:11');
                    expect(mockMemClient.HashRing.swap).toHaveBeenCalledWith('h1:22', 'h2:22');
                    expect(mockMemClient.HashRing.add).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.remove).not.toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should call HashRing.add for extra added servers', function(done) {
                mockMemClient.servers = ['h1:11'];
                cache.updateServers(['h2:11', 'h2:22']).then(function(val) {
                    expect(val).toBe(true);
                    expect(mockMemClient.servers).toEqual(['h2:11', 'h2:22']);
                    expect(mockMemClient.connections['h1:11']).not.toBeDefined();
                    expect(mockMemClient.issues['h1:11']).not.toBeDefined();
                    expect(end1).toHaveBeenCalled();
                    expect(mockMemClient.HashRing.swap).toHaveBeenCalledWith('h1:11', 'h2:22');
                    expect(mockMemClient.HashRing.add).toHaveBeenCalledWith('h2:11');
                    expect(mockMemClient.HashRing.remove).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should call HashRing.remove for extra removed servers', function(done) {
                cache.updateServers('h2:11').then(function(val) {
                    expect(val).toBe(true);
                    expect(mockMemClient.servers).toEqual(['h2:11']);
                    expect(mockMemClient.connections['h1:11']).not.toBeDefined();
                    expect(mockMemClient.connections['h1:22']).not.toBeDefined();
                    expect(mockMemClient.issues['h1:11']).not.toBeDefined();
                    expect(mockMemClient.issues['h1:22']).not.toBeDefined();
                    expect(end1).toHaveBeenCalled();
                    expect(end2).toHaveBeenCalled();
                    expect(mockMemClient.HashRing.swap).toHaveBeenCalledWith('h1:22', 'h2:11');
                    expect(mockMemClient.HashRing.add).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.remove).toHaveBeenCalledWith('h1:11');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should do nothing if there are no changes', function(done) {
                cache.updateServers('h1:11,h1:22').then(function(val) {
                    expect(val).toBe(true);
                    expect(mockMemClient.servers).toEqual(['h1:11', 'h1:22']);
                    expect(mockMemClient.HashRing.swap).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.add).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.remove).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should warn if the cache is updated to have no servers', function(done) {
                cache.updateServers('').then(function(val) {
                    expect(val).not.toBeDefined();
                    expect(cache.checkConnection).not.toHaveBeenCalled();
                    expect(mockMemClient.servers).toEqual([]);
                    expect(mockMemClient.HashRing.swap).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.add).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.remove).toHaveBeenCalledWith('h1:11');
                    expect(mockMemClient.HashRing.remove).toHaveBeenCalledWith('h1:22');
                    expect(mockLog.warn).toHaveBeenCalled();
                    expect(cache.cacheReady).toBe(false);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should call _initClient if the memcached client did not exist', function(done) {
                delete cache._memcached;
                cache.updateServers('h2:11,h2:22').then(function(val) {
                    expect(val).toBe(true);
                    expect(cache._memcached).toBe(mockMemClient);
                    expect(cache._initClient).toHaveBeenCalledWith(['h2:11', 'h2:22']);
                    expect(mockMemClient.HashRing.swap).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.add).not.toHaveBeenCalled();
                    expect(mockMemClient.HashRing.remove).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if checkConnection fails', function(done) {
                cache.checkConnection.andReturn(q.reject('I GOT A PROBLEM'));
                cache.updateServers('h2:11,h2:22').then(function(val) {
                    expect(val).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                    expect(mockMemClient.servers).toEqual(['h2:11', 'h2:22']);
                    expect(mockMemClient.HashRing.swap).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        describe('_memcachedCommand', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211', 1000, 2000);
                mockMemClient.stats.andCallFake(function(cb) { cb(null, ['stats1', 'stats2']); });
                mockMemClient.set.andCallFake(function(key, val, ttl, cb) { cb(); });
            });
            
            it('should call the appropriate command on the memcached client', function(done) {
                cache._memcachedCommand('stats', 'read').then(function(resp) {
                    expect(resp).toEqual(['stats1', 'stats2']);
                    expect(mockMemClient.stats).toHaveBeenCalledWith(anyFunc);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should properly handle commands with args', function(done) {
                cache._memcachedCommand('set', 'write', ['foo', {a: 1, b: 2}, 5000]).then(function(resp) {
                    expect(resp).toBe();
                    expect(mockMemClient.set).toHaveBeenCalledWith('foo', {a: 1, b: 2}, 5000, anyFunc);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if the command fails', function(done) {
                mockMemClient.stats.andCallFake(function(cb) { cb('I GOT A PROBLEM'); });
                cache._memcachedCommand('stats', 'read').then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.message).toBe('Memcache failure');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.stats).toHaveBeenCalledWith(anyFunc);
                }).done(done);
            });
            
            it('should reject if the command times out', function(done) {
                mockMemClient.set.andCallFake(function(key, val, ttl, cb) {
                    setTimeout(function() { cb(null, 'success'); }, cache.timeouts.write + 10);
                });
                var promise = cache._memcachedCommand('set', 'write', ['foo', 'bar', 1000]);
                process.nextTick(function() { jasmine.Clock.tick(cache.timeouts.write + 5); });

                promise.then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.message).toBe('Memcache failure');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.set).toHaveBeenCalled();
                }).done(done);
            });
            
            it('should use the read timeout if an invalid opType is passed', function(done) {
                mockMemClient.delete.andCallFake(function(key, vall, tll, cb) {
                    setTimeout(function() { cb(null, 'success'); }, cache.timeouts.read + 10);
                });
                var promise = cache._memcachedCommand('delete', 'something', ['foo']);
                process.nextTick(function() { jasmine.Clock.tick(cache.timeouts.read + 5); });

                promise.then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.message).toBe('Memcache failure');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.delete).toHaveBeenCalledWith('foo', anyFunc);
                }).done(done);
            });
            
            it('should reject if an unknown or undefined command is passed', function(done) {
                cache._memcachedCommand('doCoolShit', 'read').catch(function(error) {
                    expect(error).toBe('"doCoolShit" is not a valid memcached command');
                    return cache._memcachedCommand();
                }).catch(function(error) {
                    expect(error).toBe('"undefined" is not a valid memcached command');
                }).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('checkConnection', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211');
                spyOn(cache, '_memcachedCommand').andReturn(q(['stats1', 'stats2']));
            });
            
            it('should call _memcachedCommand with stats', function(done) {
                cache.checkConnection().then(function(resp) {
                    expect(resp).toBe(true);
                    expect(cache._memcachedCommand).toHaveBeenCalledWith('stats', 'read');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should pass through errors', function(done) {
                cache._memcachedCommand.andReturn(q.reject('I GOT A PROBLEM'));
                cache.checkConnection().then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                }).done(done);
            });
            
            it('should reject if the cache is not ready', function(done) {
                mockMemClient.servers = [];
                cache.checkConnection().then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('Cache is not usable yet');
                }).done(done);
            });
        });
        
        describe('get', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211');
                spyOn(cache, '_memcachedCommand').andReturn(q('bar'));
            });
            
            it('should call _memcachedCommand with get', function(done) {
                cache.get('foo').then(function(resp) {
                    expect(resp).toBe('bar');
                    expect(cache._memcachedCommand).toHaveBeenCalledWith('get', 'read', ['foo']);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should pass through errors', function(done) {
                cache._memcachedCommand.andReturn(q.reject('I GOT A PROBLEM'));
                cache.get('foo').then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                }).done(done);
            });

            it('should reject if the cache is not ready', function(done) {
                mockMemClient.servers = [];
                cache.get('foo').then(function() {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('Cache is not usable yet');
                }).done(done);
            });
        });
        
        describe('set', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211');
                spyOn(cache, '_memcachedCommand').andReturn(q('success'));
            });
            
            it('should call _memcachedCommand with set', function(done) {
                cache.set('foo', {a: 1, aKey: 'aVal'}, 60*60*1000).then(function(resp) {
                    expect(resp).toBe('success');
                    expect(cache._memcachedCommand).toHaveBeenCalledWith('set', 'write', ['foo', {a: 1, aKey: 'aVal'}, 60*60]);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should pass through errors', function(done) {
                cache._memcachedCommand.andReturn(q.reject('I GOT A PROBLEM'));
                cache.set('foo', {a: 1, aKey: 'aVal'}, 60*60*1000).then(function(resp) {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                }).done(done);
            });

            it('should reject if the cache is not ready', function(done) {
                mockMemClient.servers = [];
                cache.set('foo', {a: 1, aKey: 'aVal'}, 60*60*1000).then(function(resp) {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('Cache is not usable yet');
                }).done(done);
            });
        });
        
        describe('add', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211', 1000, 2000);
                mockMemClient.add.andCallFake(function(key, val, ttl, cb) { cb(null, 'success'); });
            });
            
            it('should call the appropriate command on the memcached client', function(done) {
                cache.add('foo', 'bar', 5000).then(function(resp) {
                    expect(resp).toEqual('success');
                    expect(mockMemClient.add).toHaveBeenCalledWith('foo', 'bar', 5, anyFunc);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if the command fails', function(done) {
                mockMemClient.add.andCallFake(function(cb) { cb('I GOT A PROBLEM'); });
                cache.add('foo', 'bar', 5000).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.message).toBe('Memcache failure');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.add).toHaveBeenCalled();
                }).done(done);
            });
            
            it('should reject if the command times out', function(done) {
                mockMemClient.add.andCallFake(function(key, val, ttl, cb) {
                    setTimeout(function() { cb(null, 'success'); }, cache.timeouts.write + 10);
                });
                var promise = cache.add('foo', 'bar', 5000);
                process.nextTick(function() { jasmine.Clock.tick(cache.timeouts.write + 5); });

                promise.then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.message).toBe('Memcache failure');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockMemClient.add).toHaveBeenCalled();
                }).done(done);
            });
            
            it('should resolve if memcached.add fails because the key was already stored', function(done) {
                mockMemClient.add.andCallFake(function(key, val, ttl, cb) { cb(new Error('Item is not stored')); });
                cache.add('foo', 'bar', 5000).then(function(resp) {
                    expect(resp).toBe();
                    expect(mockMemClient.add).toHaveBeenCalledWith('foo', 'bar', 5, anyFunc);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should reject if the cache is not ready', function(done) {
                mockMemClient.servers = [];
                cache.add('foo', 'bar', 5000).then(function(resp) {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('Cache is not usable yet');
                }).done(done);
            });
        });
        
        describe('delete', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211');
                spyOn(cache, '_memcachedCommand').andReturn(q('success'));
            });
            
            it('should call _memcachedCommand with delete', function(done) {
                cache.delete('foo').then(function(resp) {
                    expect(resp).toBe('success');
                    expect(cache._memcachedCommand).toHaveBeenCalledWith('delete', 'write', ['foo']);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should pass through errors', function(done) {
                cache._memcachedCommand.andReturn(q.reject('I GOT A PROBLEM'));
                cache.delete('foo').then(function(resp) {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('I GOT A PROBLEM');
                }).done(done);
            });

            it('should reject if the cache is not ready', function(done) {
                mockMemClient.servers = [];
                cache.delete('foo').then(function(resp) {
                    expect('resolved').not.toBe('resolved');
                }).catch(function(error) {
                    expect(error).toBe('Cache is not usable yet');
                }).done(done);
            });
        });
        
        describe('close', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('host1:11211');
            });
            
            it('should call memcached.end()', function() {
                cache.close();
                expect(mockMemClient.end).toHaveBeenCalledWith();
            });
            
            it('should do nothing if the cache is not ready', function() {
                mockMemClient.servers = [];
                cache.close();
                expect(mockMemClient.end).not.toHaveBeenCalled();
            });
        });
    });

    describe('_callIfReady', function() {
        var cache;
        beforeEach(function() {
            cache = new cacheLib.Cache('host1:11211');
        });
        
        it('should wrap a function and call it if the cache is ready', function(done) {
            cache.fn = cacheLib._callIfReady(function(arg1, arg2) {
                expect(this).toBe(cache);
                expect(arg1).toBe('foo');
                expect(arg2).toBe('bar');
                return q('done');
            });
            
            cache.fn('foo', 'bar').then(function(val) {
                expect(val).toBe('done');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the cache is not ready', function(done) {
            cache.fn = cacheLib._callIfReady(function() {
                return q('done');
            });
            cache._memcached.servers = [];
            
            cache.fn().then(function(val) {
                expect(val).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Cache is not usable yet');
            }).done(done);
        });
    });
});

