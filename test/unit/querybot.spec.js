var flush = true;
describe('querybot (UT)', function() {
    var mockLog, logger, q, pg, nextSpy, doneSpy, errorSpy, req, lib,
        mockPromise, mockDefer, mockCache, requestUtils, pgUtils;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        pg              = require('pg.js');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');
        pgUtils         = require('../../lib/pgUtils');
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
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

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

    describe('queryParamsFromRequest',function(){
        var req, mockResponse, result, queryOpts, setResult ;
        beforeEach(function(){
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
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { campaignIds : ['ABC'], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });
        
        it('pulls campaignIds from the query params',function(done){
            req.query.ids = 'ABC,DEF'; 
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { campaignIds : ['ABC','DEF'], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });

        it('ignores query param ids if main id param is set',function(done){
            mockResponse.body = [{ id : 'ABC' }];
            req.params.id = 'ABC'; 
            req.query.ids = 'DEF,GHI'; 
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { campaignIds : ['ABC'], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });

        it('squashes duplicate ids',function(done){
            req.query.ids = 'DEF,ABC,GHI,ABC'; 
            mockResponse.body = [{ id : 'DEF' },{ id : 'ABC' },{ id : 'GHI' }];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { campaignIds : ['DEF','ABC','GHI'], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns nothing',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.body = [];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { campaignIds : [], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns error',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.response.statusCode = 401;
            mockResponse.body = 'Unauthorized.';
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(mockLog.error).toHaveBeenCalledWith(
                    '[%1] Campaign Check Failed with: %2 : %3', req.uuid, 401, 'Unauthorized.'
                );
                expect(result).toEqual( { campaignIds : [], startDate : null, endDate : null } );
            })
            .then(done,done.fail);
        });

        it('will reject if there are no ids on the request',function(done){
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('At least one campaignId is required.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('pulls startDate from the query params',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.startDate = '2016-01-01';
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { 
                    campaignIds : ['ABC','DEF'],
                    startDate : '2016-01-01',
                    endDate :  null
                } );
            })
            .then(done,done.fail);
        });

        it('pulls endDate from the query params',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.endDate   = '2016-01-02';
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { 
                    campaignIds : ['ABC','DEF'],
                    startDate : null,
                    endDate : '2016-01-02' 
                } );
            })
            .then(done,done.fail);
        });

        it('pulls startDate and endDate from the query params',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.startDate = '2016-01-01';
            req.query.endDate   = '2016-01-02';
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.queryParamsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual( { 
                    campaignIds : ['ABC','DEF'],
                    startDate : '2016-01-01',
                    endDate : '2016-01-02' 
                } );
            })
            .then(done,done.fail);
        });
        
        it('will reject if startDate is improperly formatted',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.startDate = '01/01/2016';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid startDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('will reject if startDate is improperly formatted with stuff at end',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.startDate = '2016-01-01;delete * from *;';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid startDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('will reject if startDate is improperly formatted with stuff at start',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.startDate = 'delete * from *;2016-01-01';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid startDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('will reject if endDate is improperly formatted',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.endDate = '01/01/2016';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid endDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('will reject if endDate is improperly formatted with stuff at end',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.endDate = '2016-01-01;delete * from *;';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid endDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        it('will reject if endDate is improperly formatted with stuff at start',function(done){
            req.query.ids = 'ABC,DEF';
            req.query.endDate = 'delete * from *;2016-01-01';
            lib.queryParamsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('Invalid endDate format, expecting YYYY-MM-DD.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
        
        

    });

    describe('datesToDateClause',function(){
        it('return null if there are no dates',function(){
            expect(lib.datesToDateClause(null,null,'rec_ts')).toBeNull();
        });

        it('return clause with only start if there are is no endDate',function(){
            expect(lib.datesToDateClause('2016-01-03',null,'rec_ts'))
                .toEqual('rec_ts >= \'2016-01-03\'');
        });

        it('return clause with only end if there are is no startDate',function(){
            expect(lib.datesToDateClause(null,'2016-01-03','rec_ts'))
                .toEqual('rec_ts < (date \'2016-01-03\' + interval \'1 day\')');
        });
        
        it('return clause with range if there are is startDate and endDate',function(){
            expect(lib.datesToDateClause('2016-01-01','2016-01-03','rec_ts'))
                .toEqual('rec_ts >= \'2016-01-01\' AND rec_ts < (date \'2016-01-03\' + interval \'1 day\')');
        });
    });

    describe('getCampaignDataFromCache',function(){
        var fakeCache;
        beforeEach(function(){
            fakeCache = {
                'abc:null:null:summary'             : { campaignId : 'abc', v: 1 },
                'abc:2016-01-03:null:summary'       : { campaignId : 'abc', v: 2 },
                'abc:null:2016-01-03:summary'       : { campaignId : 'abc', v: 3 },
                'def:null:null:summary'             : { campaignId : 'def', v: 1 },
                'ghi:null:null:summary'             : { campaignId : 'ghi', v: 1 },
                'ghi:2016-01-03:2016-01-03:summary' : { campaignId : 'ghi', v: 2 }
            };
            spyOn(lib,'campaignCacheGet').and.callFake(function(id){
                return q(fakeCache[id]);
            });
        });

        it('returns data that it finds',function(done){
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],null,null,'summary')
            .then(function(res){
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc', v: 1 },
                    'def' : { campaignId : 'def', v: 1 },
                    'ghi' : { campaignId : 'ghi', v: 1 }
                });
            })
            .then(done,done.fail);
        });

        it('returns data that it finds with start date',function(done){
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],'2016-01-03',null,'summary')
            .then(function(res){
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc', v: 2 }
                });
            })
            .then(done,done.fail);
        });

        it('returns data that it finds with end date',function(done){
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],null,'2016-01-03','summary')
            .then(function(res){
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc', v: 3 }
                });
            })
            .then(done,done.fail);
        });

        it('returns data that it finds with start and end date',function(done){
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],'2016-01-03','2016-01-03','summary')
            .then(function(res){
                expect(res).toEqual({
                    'ghi' : { campaignId : 'ghi', v: 2 }
                });
            })
            .then(done,done.fail);
        });

        it('warns if there is an error, but proceeds',function(done){
            var err = new Error('An error');
            lib.campaignCacheGet.and.callFake(function(id){
                if (id === 'def:null:null:summary') {
                    return q.reject(err);
                } else {
                    return q(fakeCache[id]);
                }
            });
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],null,null,'summary')
            .then(function(res){
                expect(mockLog.warn).toHaveBeenCalledWith('Cache error: Key=%1, Error=%2',
                    'def:null:null:summary','An error');
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc', v: 1 },
                    'ghi' : { campaignId : 'ghi', v: 1 }
                });
            })
            .then(done,done.fail);
        });
    });

    describe('setCampaignDataInCache',function(){
        var fakeData;
        beforeEach(function(){
            fakeData = {
                'abc' : { campaignId : 'abc' },
                'def' : { campaignId : 'def' },
                'ghi' : { campaignId : 'ghi' }
            };
            spyOn(lib,'campaignCacheSet').and.callFake(function(id,data){
                return q(true);
            });
        });

        it('caches the data',function(done){
            lib.setCampaignDataInCache(fakeData,null,'2016-01-01','summary')
            .then(function(result){
                expect(lib.campaignCacheSet.calls.count()).toEqual(3);
                expect(lib.campaignCacheSet.calls.allArgs()[0])
                    .toEqual( ['abc:null:2016-01-01:summary', { campaignId: 'abc'}] );
                expect(lib.campaignCacheSet.calls.allArgs()[1])
                    .toEqual( ['def:null:2016-01-01:summary', { campaignId: 'def'}] );
                expect(lib.campaignCacheSet.calls.allArgs()[2])
                    .toEqual( ['ghi:null:2016-01-01:summary', { campaignId: 'ghi'}] );
                expect(result).toBe(fakeData);
            })
            .then(done,done.fail);
        });
        
        it('does NOT reject when there is an error',function(done){
            lib.campaignCacheSet.and.callFake(function(id){
                return q.reject(new Error('An error'));
            });
            lib.setCampaignDataInCache(fakeData,null,null,'summary')
            .then(function(result){
                expect(result).toBe(fakeData);
            })
            .then(done,done.fail);
        });
    });

    describe('processCampaignSummaryRecord',function(){
        var record;
        beforeEach(function(){
            record = {
                campaignId : 'abc',
                eventType  : 'cardView',
                eventCount : '100',
                eventCost  : '25.2500'
            };
        });

        it('initializes a record',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });

        it('initializes a record with range=user data',function(){
            record.range = 'user';
            var obj = lib.processCampaignSummaryRecord(record,undefined,'2015-01-01','2016-01-01');
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                },
                range : {
                    startDate : '2015-01-01',
                    endDate   : '2016-01-01',
                    impressions : 100,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });

        it('adds view and cost to initialized record',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'billableView';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
            record.range = 'today';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });
        
        it('adds actual view and cost to initialized record',function(){
            lib._state.config.useActualViews = true;
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'completedView';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
            record.range = 'today';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '25.2500',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
            delete lib._state.config.useActualViews;
        });

        it('adds actual view and cost to initialized record using billable views',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'completedView';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views  : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {},
                    actualViews : 100
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
            
            record.range = 'today';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views: 0,
                    actualViews : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    actualViews : 100,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
            
        });
        
        
        it('adds link click to initialized record',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'link.Facebook';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {
                        facebook : 100
                    },
                    shareClicks : {}
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });

        });

        it('adds share click to initialized record',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'shareLink.Nosebook';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : {
                        nosebook : 100
                    }
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });

        it('ignores eventTypes it is not concerned with',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'videoImpression';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : { }
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });
        
        it('treates a NaN eventCount as 0',function(){
            record.eventCount = null;
            var obj = lib.processCampaignSummaryRecord(record);
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : { }
                },
                today : {
                    impressions : 0,
                    views : 0,
                    quartile1 : 0,
                    quartile2 : 0,
                    quartile3 : 0,
                    quartile4 : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });
    });

    describe('adjustCampaignSummary',function(){
        var summary;
        beforeEach(function(){
            summary = {
                campaignId : 'abc',
                summary : {
                    impressions : 0, views : 1000,
                    quartile1 : 900, quartile2 : 800, quartile3 : 700, quartile4 : 600,
                    totalSpend : '0.0000', linkClicks : { }, shareClicks : { }
                },
                today : {
                    impressions : 0, views : 100,
                    quartile1 : 90, quartile2 : 80, quartile3 : 70, quartile4 : 60,
                    totalSpend : '0.0000',
                    linkClicks : { facebook : 5}, shareClicks : { twitter: 3 }
                },
                range : {
                    impressions : 0, views : 500,
                    quartile1 : 400, quartile2 : 300, quartile3 : 200, quartile4 : 100,
                    totalSpend : '0.0000', linkClicks : {}, shareClicks : {}
                }
            };
        });

        it('does nothing if there are no actual views defined',function(){
            lib.adjustCampaignSummary(summary);
            expect(summary.summary).toEqual(jasmine.objectContaining(
                {  quartile1 : 900, quartile2 : 800, quartile3 : 700, quartile4 : 600 }
            ));
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 90, quartile2 : 80, quartile3 : 70, quartile4 : 60 }
            ));
            expect(summary.range).toEqual(jasmine.objectContaining(
                {  quartile1 : 400, quartile2 : 300, quartile3 : 200, quartile4 : 100 }
            ));

        });

        it('does nothing to quartiles if actualViews = views, removes actualViews',function(){
            summary.summary.actualViews = 1000;
            summary.today.actualViews = 100;
            summary.range.actualViews = 500;
            lib.adjustCampaignSummary(summary);
            expect(summary.summary).toEqual(jasmine.objectContaining(
                {  quartile1 : 900, quartile2 : 800, quartile3 : 700, quartile4 : 600 }
            ));
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 90, quartile2 : 80, quartile3 : 70, quartile4 : 60 }
            ));
            expect(summary.range).toEqual(jasmine.objectContaining(
                {  quartile1 : 400, quartile2 : 300, quartile3 : 200, quartile4 : 100 }
            ));
            
            expect(summary.summary.actualViews).not.toBeDefined();
            expect(summary.today.actualViews).not.toBeDefined();
            expect(summary.range.actualViews).not.toBeDefined();
        });

        it('does nothing to quartiles if actualViews < views, removes actualViews',function(){
            summary.summary.actualViews = 950;
            summary.today.actualViews = 95;
            summary.range.actualViews = 450;
            lib.adjustCampaignSummary(summary);
            expect(summary.summary).toEqual(jasmine.objectContaining(
                {  quartile1 : 900, quartile2 : 800, quartile3 : 700, quartile4 : 600 }
            ));
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 90, quartile2 : 80, quartile3 : 70, quartile4 : 60 }
            ));
            expect(summary.range).toEqual(jasmine.objectContaining(
                {  quartile1 : 400, quartile2 : 300, quartile3 : 200, quartile4 : 100 }
            ));
            
            expect(summary.summary.actualViews).not.toBeDefined();
            expect(summary.today.actualViews).not.toBeDefined();
            expect(summary.range.actualViews).not.toBeDefined();
        });

        it('adjusts quartiles if actualViews > views, removes actualViews',function(){
            summary.summary.actualViews = 1100;
            summary.today.actualViews = 110;
            summary.range.actualViews = 550;
            lib.adjustCampaignSummary(summary);
            expect(summary.summary).toEqual(jasmine.objectContaining(
                {  quartile1 : 820, quartile2 : 730, quartile3 : 640, quartile4 : 550 }
            ));
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 82, quartile2 : 73, quartile3 : 64, quartile4 : 55, 
                    linkClicks : { facebook : 5}, shareClicks : { twitter: 3 } }
            ));
            expect(summary.range).toEqual(jasmine.objectContaining(
                {  quartile1 : 365, quartile2 : 275, quartile3 : 180, quartile4 : 90 }
            ));
            
            expect(summary.summary.actualViews).not.toBeDefined();
            expect(summary.today.actualViews).not.toBeDefined();
            expect(summary.range.actualViews).not.toBeDefined();
        });

        it('adjusts quartiles if actualViews + quartiles > views, removes actualViews',function(){
            summary.summary =   {  views : 1500, actualViews: 2000,
                quartile1 : 1900, quartile2 : 1800, quartile3 : 1700, quartile4 : 1600 };
            summary.today   =   {  views : 150, actualViews: 200,
                quartile1 : 190, quartile2 : 180, quartile3 : 170, quartile4 : 160 };
            summary.range   =   {  views : 500, actualViews: 1000,
                quartile1 : 900, quartile2 : 800, quartile3 : 700, quartile4 : 600 };

            lib.adjustCampaignSummary(summary);
            expect(summary.summary).toEqual(jasmine.objectContaining(
                {  quartile1 : 1425, quartile2 : 1350, quartile3 : 1275, quartile4 : 1200 }
            ));
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 143, quartile2 : 135, quartile3 : 128, quartile4 : 120 }
            ));
            expect(summary.range).toEqual(jasmine.objectContaining(
                {  quartile1 : 450, quartile2 : 400, quartile3 : 350, quartile4 : 300 }
            ));
            
            expect(summary.summary.actualViews).not.toBeDefined();
            expect(summary.today.actualViews).not.toBeDefined();
            expect(summary.range.actualViews).not.toBeDefined();
        });

        it('adjusts quartiles if actualViews > views and quartiles > actualViews, removes actualViews',function(){
            summary.today   =   {  views : 150, actualViews: 200,
                quartile1 : 300, quartile2 : 250, quartile3 : 200, quartile4 : 150 };

            lib.adjustCampaignSummary(summary);
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  quartile1 : 225, quartile2 : 188, quartile3 : 150, quartile4 : 113 }
            ));
            
            expect(summary.today.actualViews).not.toBeDefined();
        });

        
        it('handles 0 views',function(){
            summary.today   =   {  views : 0, actualViews: 20,
                quartile1 : 19, quartile2 : 18, quartile3 : 17, quartile4 : 16, 
                linkClicks : { facebook : 5}, shareClicks : { twitter: 3 }
            };
            lib.adjustCampaignSummary(summary);
            expect(summary.today).toEqual(jasmine.objectContaining(
                {  
                    quartile1 : 0, quartile2 : 0, quartile3 : 0, quartile4 : 0,
                    linkClicks : { }, shareClicks : { }
                }
            ));
            
            expect(summary.today.actualViews).not.toBeDefined();
        });

    });

    describe('queryCampaignSummary',function(){
        var req;
        beforeEach(function(){
            req = { 
                campaignIds : ['id1','id2']
            };
            spyOn(pgUtils,'query').and.returnValue(mockPromise);
        });

        it('will pass campaignIds as parameters',function(){
            lib.queryCampaignSummary(['abc','def']);
            expect(pgUtils.query.calls.mostRecent().args[1]).toEqual([
                ['abc','def'],
                ['launch','load','play','impression','requestPlayer']
            ]);
        });
    });

    describe('getCampaignSummaryAnalytics',function(){
        var req, fakeCacheData, fakeQueryData;
        beforeEach(function(){
            req = {};
            fakeCacheData = {
                'abc' : { campaignId : 'abc', summary : {} },
                'def' : { campaignId : 'def', summary : {} },
                'ghi' : { campaignId : 'ghi', summary : {} }
            };
            fakeQueryData = {
                'abc' : { campaignId : 'abc', summary : {} },
                'def' : { campaignId : 'def', summary : {} },
                'ghi' : { campaignId : 'ghi', summary : {} }
            };
            spyOn(lib,'getCampaignDataFromCache').and.returnValue(q(fakeCacheData));
            spyOn(lib,'queryCampaignSummary').and.returnValue(q(fakeQueryData));
            spyOn(lib,'setCampaignDataInCache').and.callFake(function(data,key){
                return q(data);   
            });
            spyOn(lib,'queryParamsFromRequest').and.returnValue(
                q({ campaignIds : ['abc','def','ghi'], startDate :null , endDate : null })
            );
        });

        it('will return an empty result if queryParamsFromRequest returns no ids',function(done){
            var err;
            lib.queryParamsFromRequest.and.returnValue(q( { campaignIds : [] } ));
            lib.getCampaignSummaryAnalytics(req)
            .then(function(r){
                expect(r.campaignSummaryAnalytics).toEqual([]); 
                expect(lib.getCampaignDataFromCache).not.toHaveBeenCalled();
                expect(lib.queryCampaignSummary).not.toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('can get all data from the cache',function(done){
            lib.getCampaignSummaryAnalytics(req)
            .then(function(){
                expect(lib.getCampaignDataFromCache).toHaveBeenCalledWith(
                    ['abc','def','ghi'],null,null,'summary'
                );
                expect(lib.queryCampaignSummary).not.toHaveBeenCalled();
                expect(lib.setCampaignDataInCache).not.toHaveBeenCalled();
                expect(req.campaignSummaryAnalytics).toEqual([
                    { campaignId : 'abc' , summary : {}},
                    { campaignId : 'def' , summary : {}},
                    { campaignId : 'ghi' , summary : {}}
                ]);
            })
            .then(done,done.fail);
        });

        it('can get all data from the db',function(done){
            lib.getCampaignDataFromCache.and.returnValue(q(undefined));
            lib.getCampaignSummaryAnalytics(req)
            .then(function(){
                expect(lib.getCampaignDataFromCache).toHaveBeenCalledWith(
                    ['abc','def','ghi'],null,null,'summary'
                );
                expect(lib.queryCampaignSummary).toHaveBeenCalledWith( 
                    ['abc','def','ghi'],null,null);
                expect(lib.setCampaignDataInCache).toHaveBeenCalledWith(
                    fakeQueryData, null, null, 'summary'     
                );
                expect(req.campaignSummaryAnalytics).toEqual([
                    { campaignId : 'abc' , summary : {}},
                    { campaignId : 'def' , summary : {}},
                    { campaignId : 'ghi' , summary : {}}
                ]);
            })
            .then(done,done.fail);
        });

        it('can get some data from cache and some from query',function(done){
            delete fakeCacheData.abc;
            delete fakeCacheData.ghi;
            delete fakeQueryData.def;
            lib.getCampaignDataFromCache.and.returnValue(q(fakeCacheData));
            lib.queryCampaignSummary.and.returnValue(q(fakeQueryData));
            lib.getCampaignSummaryAnalytics(req)
            .then(function(){
                expect(lib.getCampaignDataFromCache).toHaveBeenCalledWith(
                    ['abc','def','ghi'],null,null,'summary'
                );
                expect(lib.queryCampaignSummary).toHaveBeenCalledWith( ['abc','ghi'],null,null);
                expect(lib.setCampaignDataInCache).toHaveBeenCalledWith(
                    fakeQueryData, null, null, 'summary'     
                );
                expect(req.campaignSummaryAnalytics).toEqual([
                    { campaignId : 'def' , summary : {}},
                    { campaignId : 'abc' , summary : {}},
                    { campaignId : 'ghi' , summary : {}}
                ]);
            })
            .then(done,done.fail);
        });
    });
});
