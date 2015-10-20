var CacheMutex = require('../../lib/cacheMutex.js'),
    q          = require('q');

describe('cacheMutex', function() {

    var mutex,
        mockCache;

    beforeEach(function() {
        mockCache = {
            add: jasmine.createSpy('add()').and.returnValue(q()),
            delete: jasmine.createSpy('delete()').and.returnValue(q())
        };
        mutex = new CacheMutex(mockCache, 'sher-Lock', 1000);
    });
    
    describe('constructor', function() {
        it('should initialize values', function() {
            expect(mutex._cache).toBe(mockCache);
            expect(mutex._lockName).toBe('sher-Lock');
            expect(mutex._hasLock).toBe(false);
            expect(mutex._ttl).toBe(1000);
        });
    });
    
    describe('acquire', function() {
        it('should attempt to add to memcached', function(done) {
            mutex.acquire().done(function() {
                expect(mockCache.add).toHaveBeenCalledWith('sher-Lock', 'LOCKED', 1000);
                done();
            });
        });
        
        describe('when able to add to memcached', function() {
            var result;
            
            beforeEach(function(done) {
                mockCache.add.and.returnValue(q('LOCKED'));
                var success = function(locked) {
                    result = locked;
                };
                mutex.acquire().then(success).done(done);
            });
            
            it('should set hasLock', function() {
                expect(mutex._hasLock).toBe(true);
            });
            
            it('should resolve with false', function() {
                expect(result).toBe(false);
            });
        });
        
        describe('when unable to add to memcached', function() {
            var result;
            
            beforeEach(function(done) {
                mockCache.add.and.returnValue(q(undefined));
                var success = function(locked) {
                    result = locked;
                };
                mutex.acquire().then(success).done(done);
            });
            
            it('should set hasLock', function() {
                expect(mutex._hasLock).toBe(false);
            });
            
            it('should resolve with true', function() {
                expect(result).toBe(true);
            });
        });
    });
    
    describe('release', function() {
        describe('if a lock has been acquired', function() {
            beforeEach(function(done) {
                mutex._hasLock = true;
                mutex.release().done(done);
            });
            
            it('should delete the memcached key', function() {
                expect(mockCache.delete).toHaveBeenCalledWith('sher-Lock');
            });
            
            it('should set hasLock', function() {
                expect(mutex._hasLock).toBe(false);
            });
        });
        
        describe('if a lock has not been acquired', function() {
            beforeEach(function(done) {
                mutex._hasLock = false;
                mutex.release().done(done);
            });
            
            it('should not delete the memcached key', function() {
                expect(mockCache.delete).not.toHaveBeenCalled();
            });
            
            it('should not set hasLock', function() {
                expect(mutex._hasLock).toBe(false);
            });
        });
    });
});
