var flush = true;
describe('querybot (UT)', function() {
    var mockLog, logger, q, pg, nextSpy, doneSpy, errorSpy, req, mockState, dbpass,
        mockLookup, mockDefer, mockClient, mockDone, mockPromise, mockCache, requestUtils;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        pg              = require('pg.js');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');
        dbpass          = require('../../lib/dbpass');
        requestUtils    = require('../../lib/requestUtils');


        mockClient = {
            query : jasmine.createSpy('client.query')
        };

        mockDone = jasmine.createSpy('pg.connect.done');

        spyOn(pg,'connect').and.callFake(function(cb){
            cb(null,mockClient,mockDone);   
        });

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

        mockLookup = jasmine.createSpy('dbpass.lookup');

        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        spyOn(dbpass, 'open').and.returnValue(mockLookup);

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockState = {
            config : {
                pg : {
                    defaults : {}
                }
            }
        }

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

    describe('pgInit',function(){
        beforeEach(function(){
            mockState.config.pg.defaults = {
                poolSize    : 21,
                poolIdleTimeout : 4440,
                reapIntervalMillis : 1200,
                user        : 'myUser',
                database    : 'mydb',
                host        : 'myhost',
                port        : 6666
            };
        });

        it('throws an exception if missing defaults database setting',function(){
            delete mockState.config.pg.defaults.database;
            expect(function(){
                lib.pgInit(mockState);
            }).toThrow(new Error('Missing configuration: pg.defaults.database'));

        });

        it('throws an exception if missing defaults user setting',function(){
            delete mockState.config.pg.defaults.user;
            expect(function(){
                lib.pgInit(mockState);
            }).toThrow(new Error('Missing configuration: pg.defaults.user'));

        });

        it('throws an exception if missing defaults host setting',function(){
            delete mockState.config.pg.defaults.host;
            expect(function(){
                lib.pgInit(mockState);
            }).toThrow(new Error('Missing configuration: pg.defaults.host'));

        });

        it('sets the defauts on the pg object based on config defaults',function(){
            lib.pgInit(mockState);
            expect(pg.defaults.poolSize).toEqual(21);
            expect(pg.defaults.poolIdleTimeout).toEqual(4440);
            expect(pg.defaults.reapIntervalMillis).toEqual(1200);
            expect(pg.defaults.database).toEqual('mydb');
            expect(pg.defaults.user).toEqual('myUser');
            expect(pg.defaults.host).toEqual('myhost');
            expect(pg.defaults.port).toEqual(6666);
        });

        it('ignores settings that are not supported',function(){
            mockState.config.pg.defaults.swimmingPoolSize = 100;
            lib.pgInit(mockState);
            expect(pg.defaults.poolSize).toEqual(21);
            expect(pg.defaults.swimmingPoolSize).not.toBeDefined();
        });

        it('sets the default password based on other defaults and pgpass',function(){
            mockLookup.and.returnValue('password');
            lib.pgInit(mockState);
            expect(dbpass.open).toHaveBeenCalled();
            expect(mockLookup).toHaveBeenCalledWith('myhost',6666,'mydb','myUser');            
            expect(pg.defaults.password).toEqual('password');
        });

    });

    describe('campaignIdsFromRequest',function(){
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
                root : campaignHost = 'https://local'
            };

            mockResponse = {
                response : {
                    headers : {},
                    statusCode : 200
                },
                body : {}
            };

            setResult = function(r) { result = r; return result; }

            result = null;

            queryOpts = null;
           
            spyOn(requestUtils,'qRequest').and.callFake(function(method,opts){
                queryOpts = opts;
                return q(mockResponse);
            });
            
        });

        it('pulls campaignIds from the request params',function(done){
            mockResponse.body = [{ id : 'ABC' }];
            req.params.id = 'ABC'; 
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual(['ABC']);
            })
            .then(done,done.fail);
        });
        
        it('pulls campaignIds from the query params',function(done){
            req.query.ids = 'ABC,DEF'; 
            mockResponse.body = [{ id : 'ABC' },{ id : 'DEF' }];
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC,DEF');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual(['ABC','DEF']);
            })
            .then(done,done.fail);
        });

        it('ignores query param ids if main id param is set',function(done){
            mockResponse.body = [{ id : 'ABC' }];
            req.params.id = 'ABC'; 
            req.query.ids = 'DEF,GHI'; 
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('ABC');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual(['ABC']);
            })
            .then(done,done.fail);
        });

        it('squashes duplicate ids',function(done){
            req.query.ids = 'DEF,ABC,GHI,ABC'; 
            mockResponse.body = [{ id : 'DEF' },{ id : 'ABC' },{ id : 'GHI' }];
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual(['DEF','ABC','GHI']);
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns nothing',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.body = [];
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(result).toEqual([]);
            })
            .then(done,done.fail);
        });

        it('return empty array if campaign service returns error',function(done){
            req.query.ids = 'DEF,ABC,GHI'; 
            mockResponse.response.statusCode = 401;
            mockResponse.body = 'Unauthorized.';
            lib.campaignIdsFromRequest(req)
            .then(setResult)
            .then(function(){
                expect(queryOpts.qs.ids).toEqual('DEF,ABC,GHI');
                expect(queryOpts.url).toEqual('https://local/api/campaigns/');
                expect(mockLog.error).toHaveBeenCalledWith(
                    '[%1] Campaign Check Failed with: %2 : %3', req.uuid, 401, 'Unauthorized.'
                );
                expect(result).toEqual([]);
            })
            .then(done,done.fail);
        });

        it('will reject if there are no ids on the request',function(done){
            lib.campaignIdsFromRequest(req)
            .then(done.fail,function(err){
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                expect(err).toEqual(new Error('At least one campaignId is required.'));
                expect(err.status).toEqual(400);
                done();
            });
        });
    });

    describe('pgQuery',function(){
        it('will reject if the connect rejects',function(){
            var err = new Error('Failed to Connect!');
            pg.connect.and.callFake(function(cb){
                cb(err,mockClient,mockDone);   
            });
            lib.pgQuery('abc','param1');
            expect(mockDefer.reject).toHaveBeenCalledWith(new Error('Internal Error'));
            expect(mockLog.error).toHaveBeenCalledWith('pg.connect error: %1', err.message);
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('will reject if the client query errs',function(){
            var err = new Error('Failed to Query!');
            mockClient.query.and.callFake(function(statement,args,cb){
                cb(err,null); 
            });
            lib.pgQuery('abc','param1');
            expect(mockClient.query).toHaveBeenCalled();
            expect(mockLog.error).toHaveBeenCalledWith(
                'pg.client.query error: %1, %2, %3', err.message, 'abc', 'param1'
            );
            expect(mockDefer.reject).toHaveBeenCalledWith(new Error('Internal Error'));
        });

        it('will return results if query does not error',function(){
            var results = { rows : [] };
            mockClient.query.and.callFake(function(statement,args,cb){
                cb(null,results); 
            });
            lib.pgQuery(req);
            expect(mockClient.query).toHaveBeenCalled();
            expect(mockDefer.resolve).toHaveBeenCalledWith(results);
        });
    });

    describe('getCampaignDataFromCache',function(){
        var fakeCache;
        beforeEach(function(){
            fakeCache = {
                'abc:summary' : { campaignId : 'abc' },
                'def:summary' : { campaignId : 'def' },
                'ghi:summary' : { campaignId : 'ghi' }
            };
            spyOn(lib,'campaignCacheGet').and.callFake(function(id){
                return q(fakeCache[id]);
            });
        });

        it('returns data that it finds',function(done){
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],':summary')
            .then(function(res){
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc' },
                    'def' : { campaignId : 'def' },
                    'ghi' : { campaignId : 'ghi' }
                });
            })
            .then(done,done.fail);
        });

        it('warns if there is an error, but proceeds',function(done){
            var err = new Error('An error');
            lib.campaignCacheGet.and.callFake(function(id){
                if (id === 'def:summary') {
                    return q.reject(err);
                } else {
                    return q(fakeCache[id]);
                }
            });
            lib.getCampaignDataFromCache(['abc','123','def','ghi'],':summary')
            .then(function(res){
                expect(mockLog.warn).toHaveBeenCalledWith('Cache error: Key=%1, Error=%2',
                    'def:summary','An error');
                expect(res).toEqual({
                    'abc' : { campaignId : 'abc' },
                    'ghi' : { campaignId : 'ghi' }
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
            lib.setCampaignDataInCache(fakeData,':summary')
            .then(function(result){
                expect(lib.campaignCacheSet.calls.count()).toEqual(3);
                expect(lib.campaignCacheSet.calls.allArgs()[0])
                    .toEqual( ['abc:summary', { campaignId: 'abc'}] );
                expect(lib.campaignCacheSet.calls.allArgs()[1])
                    .toEqual( ['def:summary', { campaignId: 'def'}] );
                expect(lib.campaignCacheSet.calls.allArgs()[2])
                    .toEqual( ['ghi:summary', { campaignId: 'ghi'}] );
                expect(result).toBe(fakeData);
            })
            .then(done,done.fail);
        });
        
        it('does NOT reject when there is an error',function(done){
            lib.campaignCacheSet.and.callFake(function(id){
                return q.reject(new Error('An error'));
            });
            lib.setCampaignDataInCache(fakeData,':summary')
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
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                }
            });
        });

        it('adds view and cost to initialized record',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'completedView';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 100,
                    totalSpend : '25.2500',
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
                    totalSpend : '0.0000',
                    linkClicks : {
                        facebook : 100
                    },
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
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : {
                        nosebook : 100
                    }
                }
            });
        });

        it('ignores eventTypes it is not concerned with',function(){
            var obj = lib.processCampaignSummaryRecord(record);
            record.eventType = 'q1';
            lib.processCampaignSummaryRecord(record,obj);
            expect(obj).toEqual({
                campaignId : 'abc',
                summary : {
                    impressions : 100,
                    views : 0,
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : { }
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
                    totalSpend : '0.0000',
                    linkClicks : { },
                    shareClicks : { }
                }
            });
        });
    });

    describe('queryCampaignSummary',function(){
        var req;
        beforeEach(function(){
            req = { 
                campaignIds : ['id1','id2']
            };
            spyOn(lib,'pgQuery').and.returnValue(mockPromise);
        });

        it('will pass campaignIds as parameters',function(){
            lib.queryCampaignSummary(['abc','def']);
            expect(lib.pgQuery.calls.mostRecent().args[1]).toEqual([
                ['abc','def'],
                ['q1','q2','q3','q4','launch','load','play']
            ]);
        });
    });

    describe('getCampaignSummaryAnalytics',function(){
        var req, fakeCacheData, fakeQueryData, fakeIds;
        beforeEach(function(){
            req = {},
            fakeIds = [ 'abc', 'def', 'ghi' ];
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
            spyOn(lib,'campaignIdsFromRequest').and.returnValue(q(['abc','def','ghi']));
        });

        it('will return an empty result if campaignIdsFromRequest returns no ids',function(done){
            var err;
            lib.campaignIdsFromRequest.and.returnValue(q([]));
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
                    ['abc','def','ghi'],':summary'
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
                    ['abc','def','ghi'],':summary'
                );
                expect(lib.queryCampaignSummary).toHaveBeenCalledWith( ['abc','def','ghi']);
                expect(lib.setCampaignDataInCache).toHaveBeenCalledWith(
                    fakeQueryData, ':summary'     
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
                    ['abc','def','ghi'],':summary'
                );
                expect(lib.queryCampaignSummary).toHaveBeenCalledWith( ['abc','ghi']);
                expect(lib.setCampaignDataInCache).toHaveBeenCalledWith(
                    fakeQueryData, ':summary'     
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
