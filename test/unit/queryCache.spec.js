var flush = true;
describe('QueryCache', function() {
    var q, uuid, promise, fakeColl, QueryCache;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        uuid        = require('../../lib/uuid');
        promise     = require('../../lib/promise');
        QueryCache  = require('../../lib/queryCache');
        
        fakeColl = { find: jasmine.createSpy('coll.find') };
        
        jasmine.Clock.useMock();
    });
   
    describe('initialization', function() {
        it('should throw an error if not provided with the right params', function() {
            var msg = "Must provide a freshTTL, maxTTL, and mongo collection";
            expect(function() { new QueryCache() }).toThrow(msg);
            expect(function() { new QueryCache(5) }).toThrow(msg);
            expect(function() { new QueryCache(5, 10) }).toThrow(msg);
            expect(function() { new QueryCache(null, null, fakeColl) }).toThrow(msg);
            expect(function() { new QueryCache(5, 10, fakeColl) }).not.toThrow();
        });
        
        it('should set or initialize any required properties', function() {
            var cache = new QueryCache(5, 10, fakeColl);
            expect(cache.freshTTL).toBe(5*60*1000);
            expect(cache.maxTTL).toBe(10*60*1000);
            expect(cache._coll).toBe(fakeColl);
            expect(cache._keeper instanceof promise.Keeper).toBeTruthy('cache._keeper is Keeper');
        });
    });

    describe('sortQuery', function() {
        it('should simply return the query if not an object', function() {
            expect(QueryCache.sortQuery('abcd')).toBe('abcd');
            expect(QueryCache.sortQuery(10)).toBe(10);
        });
        
        it('should recursively sort an object by its keys', function() {
            var query = {b: 1, a: 2, c: 5};
            var sorted = QueryCache.sortQuery(query);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: 1, c: 5}));
            
            var query = {b: {f: 3, e: 8}, a: 2, c: [3, 2, 1]};
            var sorted = QueryCache.sortQuery(query);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: {e: 8, f: 3}, c: [3, 2, 1]}));
            
            var query = {b: [{h: 1, g: 2}, {e: 5, f: 3}], a: 2};
            var sorted = QueryCache.sortQuery(query);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: [{g: 2, h: 1}, {e: 5, f: 3}]}));
        });
    });
    
    describe('formatQuery', function() {
        var query;
        beforeEach(function() {
            query = {};
            spyOn(QueryCache, 'sortQuery').andCallThrough();
        });
        
        it('should transform arrays into mongo-style $in objects', function() {
            query.id = ['e-1', 'e-2', 'e-3'];
            var newQuery = QueryCache.formatQuery(query);
            expect(newQuery).toEqual({id: { $in: ['e-1', 'e-2', 'e-3']}});
            expect(QueryCache.sortQuery).toHaveBeenCalled();
        });
    });
    
    describe('getPromise', function() {
        var cache, fakeCursor, query, opts;
        beforeEach(function() {
            query = { id: "e-1234" };
            opts = { sort: { id: 1 }, limit: 0, skip: 0 };
            cache = new QueryCache(1, 2, fakeColl);
            spyOn(uuid, 'hashText').andReturn('fakeHash');
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, [{id: 'e-1234'}])
                })
            };
            fakeColl.find.andReturn(fakeCursor);
        });
        
        it('should retrieve a promise from the cache if the query matches', function(done) {
            var deferred = cache._keeper.defer('fakeHash');
            deferred.resolve([{id: 'e-1234'}]);
            cache.getPromise({id: 'e-1234'}, {id: 1}, 0, 0)
            .then(function(exps) {
                expect(exps).toEqual([{id: 'e-1234'}]);
                var keyObj = { query: {id: 'e-1234'}, sort: {id: 1}, limit:0, skip:0};
                var key = JSON.stringify(keyObj);
                expect(uuid.hashText).toHaveBeenCalledWith(key);
                expect(fakeColl.find).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should make a new promise and search mongo if the query is not cached', function(done) {
            cache.getPromise(query, opts.sort, opts.limit, opts.skip)
            .then(function(exps) {
                expect(exps).toEqual([{id: 'e-1234'}]);
                expect(fakeColl.find).toHaveBeenCalledWith(query, opts);
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(uuid.hashText).toHaveBeenCalled();
                expect(cache._keeper._deferreds.fakeHash).toBeDefined();
                expect(cache._keeper.pendingCount).toBe(0);
                expect(cache._keeper.fulfilledCount).toBe(1);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
                
        it('should refresh a query after freshTTL', function(done) {
            var deferred = cache._keeper.defer('fakeHash');
            var start = new Date(new Date() - (cache.freshTTL + 1));
            deferred.keeperCreateTime = start;
            deferred.resolve([{id: 'e-1234'}]);
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, [{id: 'e-4567'}])
            });
            cache.getPromise(query, opts.sort, opts.limit, opts.skip)
            .then(function(exps) {
                expect(exps).toEqual([{id: 'e-1234'}]);
                expect(fakeColl.find).toHaveBeenCalledWith(query, opts);
                return;
            }).then(function() {
                var newDeferred = cache._keeper._deferreds.fakeHash;
                expect(newDeferred).toBeDefined();
                expect(newDeferred.keeperCreateTime - start).toBeGreaterThan(cache.freshTTL);
                expect(newDeferred.promise.inspect()).toEqual({state: 'fulfilled', value: [{id: 'e-4567'}]});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not attempt to refresh a query multiple times', function(done) {
            var deferred = cache._keeper.defer('fakeHash');
            var start = new Date(new Date() - (cache.freshTTL + 1));
            deferred.keeperCreateTime = start;
            deferred.resolve([{id: 'e-1234'}]);
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, [{id: 'e-4567'}])
            });
            q.all([cache.getPromise(query, opts.sort, opts.limit, opts.skip),
                   cache.getPromise(query, opts.sort, opts.limit, opts.skip)])
            .spread(function(exps1, exps2) {
                expect(exps1).toEqual([{id: 'e-1234'}]);
                expect(exps2).toEqual([{id: 'e-1234'}]);
                expect(fakeColl.find).toHaveBeenCalledWith(query, opts);
                expect(fakeColl.find.calls.length).toBe(1);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should delete the cached query after maxTTL', function(done) {
            var deferred = cache._keeper.defer('fakeHash');
            var start = new Date(new Date() - (cache.maxTTL + 1));
            deferred.keeperCreateTime = start;
            deferred.resolve([{id: 'e-1234'}]);
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, [{id: 'e-4567'}])
            });
            cache.getPromise(query, opts.sort, opts.limit, opts.skip)
            .then(function(exps) {
                expect(exps).toEqual([{id: 'e-4567'}]);
                expect(fakeColl.find).toHaveBeenCalledWith(query, opts);
                var newDeferred = cache._keeper._deferreds.fakeHash;
                expect(newDeferred.keeperCreateTime - start).toBeGreaterThan(cache.maxTTL);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should pass along errors from mongo', function(done) {
            spyOn(cache._keeper, 'remove');
            fakeCursor.toArray.andCallFake(function(cb) { cb('Error!'); });
            cache.getPromise(query, opts.sort, opts.limit, opts.skip)
            .then(function(exps) {
                expect(exps).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(fakeColl.find).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(uuid.hashText).toHaveBeenCalled();
                expect(cache._keeper._deferreds.fakeHash).toBeDefined();
                expect(cache._keeper.rejectedCount).toBe(1);
                jasmine.Clock.tick(10*1000);
                expect(cache._keeper.remove).toHaveBeenCalledWith('fakeHash', true);
                done();
            });
        });
    });
});
