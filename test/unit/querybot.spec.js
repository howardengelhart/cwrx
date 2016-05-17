var flush = true;
fdescribe('querybot (UT)', function() {
    var mockLog, logger, q, req, lib, mockPromise, mockDefer, mockCache, requestUtils ;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');

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

    describe('lookupCampaigns',function(){
        var req, mockResponse, result, queryOpts, setResult ;
        beforeEach(function(){
            lib._state.config = {};

            req = {
                uuid : '123',
                params : {},
                query  : {},
                headers : { cookie : 'abc' },
                protocol : 'https'
            };

            lib._state.config.api = {
                root : 'https://local'
            };

            mockResponse = {
                response : {
                    headers : {},
                    statusCode : 200
                },
                body : {}
            };

            setResult = function(r) { result = r; return result; };

            result = null;

            queryOpts = null;
           
            spyOn(requestUtils, 'proxyRequest').and.callFake(function(req, method, opts) {
                queryOpts = opts;
                return q(mockResponse);
            });
        });
        
        it('pulls campaignIds from the request params',function(done){
            mockResponse.body = [{ id : 'ABC' }];
            req.params.id = 'ABC'; 
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( [{ id : 'ABC'}] );
            })
            .then(done,done.fail);
        });
        
        it('pulls campaignIds from the query params',function(done){
            req.query.ids = 'ABC,DEF'; 
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( [{ id : 'ABC' },{ id : 'DEF' }] );
            })
            .then(done,done.fail);
        });

        it('ignores query param ids if main id param is set',function(done){
            mockResponse.body = [{ id : 'ABC' }];
            req.params.id = 'ABC'; 
            req.query.ids = 'DEF,GHI'; 
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( [{ id : 'ABC' }] );
            })
            .then(done,done.fail);
        });

        it('squashes duplicate ids',function(done){
            req.query.ids = 'DEF,ABC,GHI,ABC'; 
            mockResponse.body = [{ id : 'DEF' },{ id : 'ABC' },{ id : 'GHI' }];
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( [{ id : 'DEF' },{ id : 'ABC' },{ id : 'GHI' }] );
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns nothing',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.body = [];
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual(  [] );
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns error',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.response.statusCode = 401;
            mockResponse.body = 'Unauthorized.';
            lib.lookupCampaigns(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(mockLog.error).toHaveBeenCalledWith(
                    '[%1] Campaign Check Failed with: %2 : %3', req.uuid, 401, 'Unauthorized.'
                );
                expect(result).toEqual( [] );
            })
            .then(done,done.fail);
        });

        it('will reject if there are no ids on the request',function(done){
            lib.lookupCampaigns(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('At least one campaignId is required.'));
                expect(err.status).toEqual(400);
                done();
            });
        });

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
