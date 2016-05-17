var flush = true;
describe('querybot (UT)', function() {
    var mockLog, logger, q, req, lib, mockPromise, mockDefer, mockCache ;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');

        mockDefer = {
            promise : {},
            resolve : jasmine.createSpy('resolve'),
            reject  : jasmine.createSpy('reject')
        };

        mockPromise = {
            'then'  : jasmine.createSpy('promise.then'),
            'catch' : jasmine.createSpy('promise.catch')
        };

        mockPromise.then.and.returnValue(mockPromise);
        mockPromise.catch.and.returnValue(mockPromise);

        spyOn(q,'defer').and.returnValue(mockDefer);

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };


        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        req = { uuid: '1234' };
        
        mockCache = {
            set : jasmine.createSpy('cache.set'),
            get : jasmine.createSpy('cache.get')
        };

        mockCache.set.and.returnValue(mockPromise);
        mockCache.get.and.returnValue(mockPromise);

    });

    describe('cache',function(){
        beforeEach(function(){
            lib._state.cache = mockCache;
            lib._state.config = {};
        });

        it('get uses the memcache if the ttl is > 0',function(){
            lib._state.config.campaignCacheTTL = 100;
            lib.campaignCacheGet('key');
            expect(mockCache.get).toHaveBeenCalled();
        });

        it('get skips the memcache if the ttl is = 0',function(){
            lib._state.config.campaignCacheTTL = 0;
            lib.campaignCacheGet('key');
            expect(mockCache.get).not.toHaveBeenCalled();
        });

        it('set uses the memcache if the ttl is > 0',function(){
            lib._state.config.campaignCacheTTL = 100;
            lib.campaignCacheSet('key',{});
            expect(mockCache.set).toHaveBeenCalled();
        });

        it('set skips the memcache if the ttl is = 0',function(){
            lib._state.config.campaignCacheTTL = 0;
            lib.campaignCacheSet('key',{});
            expect(mockCache.set).not.toHaveBeenCalled();
        });

    });
});
