var flush = true;
describe('CrudSvc', function() {
    var q, mockLog, logger, cacheLib, mockMemcached, mockMemClient, anyFunc, Memcached;
    
    beforeEach(function() {
        jasmine.Clock.useMock();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        logger      = require('../../lib/logger');
        anyFunc     = jasmine.any(Function);
        
        mockMemClient = {
            stats: jasmine.createSpy('memcached.stats()'),
            get: jasmine.createSpy('memcached.get()'),
            set: jasmine.createSpy('memcached.set()'),
            add: jasmine.createSpy('memcached.add()'),
            delete: jasmine.createSpy('memcached.delete()'),
            end: jasmine.createSpy('memcached.end()'),
        };
        
        mockMemcached = jasmine.createSpy('Memcached()').andReturn(mockMemClient);
        require.cache[require.resolve('memcached')] = { exports: mockMemcached };
        
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
    });
    
    describe('Cache', function() {
        describe('initialization', function() {
            it('should correctly create a memcached client', function() {
                var cache = new cacheLib.Cache('host1:123,host2:456', 5000, 6000);
                expect(cache.timeouts).toEqual({read: 5000, write: 6000});
                expect(cache._memcached).toBe(mockMemClient);
                expect(mockMemcached).toHaveBeenCalledWith(['host1:123', 'host2:456'], {
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
            });
            
            it('should have defaults for the timeouts', function() {
                var cache = new cacheLib.Cache('host1:123,host2:456');
                expect(cache.timeouts).toEqual({read: 500, write: 2000});
                expect(mockMemcached).toHaveBeenCalled();
            });

            it('should handle an array of servers', function() {
                var cache = new cacheLib.Cache(['host1:123', 'host2:456', 'host3:789']);
                expect(mockMemcached).toHaveBeenCalledWith(['host1:123', 'host2:456', 'host3:789'], jasmine.any(Object));
            });
            
            it('should throw an error if no servers are provided', function() {
                var msg = 'Cannot create a cache without servers to connect to';
                expect(function() { new cacheLib.Cache(); }).toThrow(msg);
                expect(function() { new cacheLib.Cache(''); }).toThrow(msg);
                expect(function() { new cacheLib.Cache([]); }).toThrow(msg);
                expect(mockMemcached).not.toHaveBeenCalled();
            });
        });
        
        describe('_memcachedCommand', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211', 1000, 2000);
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
                cache = new cacheLib.Cache('localhost:11211');
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
        });
        
        describe('get', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211');
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
        });
        
        describe('set', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211');
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
        });
        
        describe('add', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211', 1000, 2000);
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
        });
        
        describe('delete', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211');
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
        });
        
        describe('close', function() {
            var cache;
            beforeEach(function() {
                cache = new cacheLib.Cache('localhost:11211');
            });
            
            it('should call memcached.end()', function() {
                cache.close();
                expect(mockMemClient.end).toHaveBeenCalledWith();
            });
        });
    });
    
    describe('createCache', function() {
        beforeEach(function() {
            mockMemClient.stats.andCallFake(function(cb) { cb(null, ['stats1', 'stats2']); });
        });

        it('should create and test a cache connection', function(done) {
            cacheLib.createCache('host1:123,host2:456', 5000, 6000).then(function(cache) {
                expect(cache instanceof cacheLib.Cache).toBe(true);
                expect(cache._memcached).toBe(mockMemClient);
                expect(cache.timeouts).toEqual({read: 5000, write: 6000});
                expect(mockMemClient.stats).toHaveBeenCalledWith(anyFunc);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if checkConnection fails', function(done) {
            mockMemClient.stats.andCallFake(function(cb) { cb('I GOT A PROBLEM'); });
            cacheLib.createCache('host1:123,host2:456', 5000, 6000).then(function(cache) {
                expect(cache).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('Memcache failure');
                expect(mockMemClient.stats).toHaveBeenCalledWith(anyFunc);
            }).done(done);
        });
        
        it('should reject if no servers are provided', function(done) {
            cacheLib.createCache('', 5000, 6000).then(function(cache) {
                expect(cache).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('Cannot create a cache without servers to connect to');
                expect(mockMemClient.stats).not.toHaveBeenCalled();
            }).done(done);
        });
    });
});

