var flush = true;
describe('querybot-ssb: apps (UT)', function() {
    var mockLog, logger, q, req, lib, mockPromise, mockDefer, requestUtils, querybot;
    
    beforeEach(function() {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(1453929767464)); //Wed Jan 27 2016 16:22:47 GMT-0500 (EST)
        
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        lib             = require('../../bin/querybot-ssb_apps');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        querybot        = require('../../bin/querybot');
        
        lib.ServiceError     = querybot.ServiceError;
        lib.campaignCacheGet = querybot.campaignCacheGet;
        lib.campaignCacheSet = querybot.campaignCacheSet;

        lib.state       = {
            config : {

            }
        };

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

    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('queryParamsFromRequest',function(){
        var mockRequest, mockResponse;
        beforeEach(function(){
            mockRequest = {},

            lib.lookupCampaigns = jasmine.createSpy('lookupCampaigns')
                .and.callFake(function(req) {
                    return q(mockResponse);
                });
        });

        it('passes a list of campaign ids if the lookup succeeds',function(done){
            mockResponse = [ { id : 'ABC' }, { id : 'DEF' } ];
            lib.queryParamsFromRequest(mockRequest)
            .then(function(result){
                expect(result.campaignIds).toEqual(['ABC','DEF']);
            })
            .then(done,done.fail);
        });

        it('rejects if the lookup fails',function(done){
            mockResponse = [ ];
            lib.queryParamsFromRequest(mockRequest)
            .then(done.fail,function(e){
                expect(e.message).toEqual('Not Found');
            })
            .then(done,done.fail);
        });


    });

    describe('initializeResponseRecord',function(){
        it('initializes a full response record',function(){
            expect(lib.initializeResponseRecord('abc')).toEqual({ 
                campaignId: 'abc',
                summary: { clicks: 0, installs: 0, launches: 0, users: 0, views: 0 },
                cycle: { clicks: 0, installs: 0, launches: 0, users: 0, views: 0 },
                daily_7: [ 
                    {date:'2016-01-20',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-21',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-22',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-23',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-24',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-25',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-26',clicks:0,installs:0,launches:0,users:0,views:0}
                ],
                daily_30: [ 
                    {date:'2015-12-28',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2015-12-29',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2015-12-30',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2015-12-31',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-01',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-02',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-03',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-04',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-05',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-06',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-07',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-08',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-09',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-10',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-11',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-12',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-13',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-14',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-15',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-16',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-17',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-18',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-19',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-20',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-21',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-22',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-23',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-24',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-25',clicks:0,installs:0,launches:0,users:0,views:0},
                    {date:'2016-01-26',clicks:0,installs:0,launches:0,users:0,views:0}
                ],
                today: [
                    {hour:'2016-01-27T00:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T01:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T02:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T03:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T04:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T05:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T06:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T07:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T08:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T09:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T10:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T11:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T12:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T13:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T14:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T15:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T16:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T17:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T18:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T19:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T20:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T21:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T22:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0},
                    {hour:'2016-01-27T23:00:00.000Z',clicks:0,installs:0,launches:0,users:0,views:0}
                ]
            });
        });
    });

    describe('queryOverall',function(){
        var records, expected_result, response;
        beforeEach(function(){
            expected_result = {
                abc : lib.initializeResponseRecord('abc'),
                def : lib.initializeResponseRecord('def')
            };

            response = {
                abc : lib.initializeResponseRecord('abc'),
                def : lib.initializeResponseRecord('def')
            };

            records = [
                { campaignId: 'abc', eventType: 'clicks',   eventCount: 11 },
                { campaignId: 'abc', eventType: 'views',    eventCount: 121 },
                { campaignId: 'abc', eventType: 'users',    eventCount: 111 },
                { campaignId: 'def', eventType: 'clicks',   eventCount: 99 },
                { campaignId: 'def', eventType: 'views',    eventCount: 291 },
                { campaignId: 'def', eventType: 'users',    eventCount: 275 },
                { campaignId: 'def', eventType: 'installs', eventCount: 11 },
                { campaignId: 'def', eventType: 'launches', eventCount: 41 }
            ]

            lib.pgUtils = {
                query : jasmine.createSpy('pgUtils.query')
            };

            lib.pgUtils.query.and.returnValue(q({ rows : records }));
        });

        it('adds to an already initialized object',function(done){
            expected_result.abc.summary = {
                clicks : 11, installs: 0, launches: 0, users: 111, views:121 
            };
            records.splice(3,5);
            lib.queryOverall(response)
            .then(function(result){
                expect(result).toEqual(expected_result);
            })
            .then(done,done.fail);
        });

        it('sets all the expected properties',function(done){
            expected_result.def.summary = {
                clicks : 99, installs: 11, launches: 41, users: 275, views: 291 
            };
            records.splice(0,3);
            lib.queryOverall(response)
            .then(function(result){
                expect(result).toEqual(expected_result);
            })
            .then(done,done.fail);
        });

        it('ignores an unrecoginzed eventType', function(done){
            expected_result.abc.summary = {
                clicks : 11, installs: 0, launches: 0, users: 0, views: 121 
            };
            records.splice(3,5);
            records[2].eventType = 'horse';
            lib.queryOverall(response)
            .then(function(result){
                expect(result).toEqual(expected_result);
            })
            .then(done,done.fail);
        });
    });
    
    describe('queryDaily',function(){
        var records, expected_result, response;
        beforeEach(function(){
            expected_result = {
                abc : lib.initializeResponseRecord('abc'),
                def : lib.initializeResponseRecord('def')
            };

            response = {
                abc : lib.initializeResponseRecord('abc'),
                def : lib.initializeResponseRecord('def')
            };
            records = [
                { recDate: '2016-01-26', campaignId: 'abc', eventType: 'clicks',   eventCount: 11 },
                { recDate: '2016-01-26', campaignId: 'abc', eventType: 'views',    eventCount: 121 },
                { recDate: '2016-01-26', campaignId: 'abc', eventType: 'users',    eventCount: 111 },
                { recDate: '2016-01-26', campaignId: 'def', eventType: 'clicks',   eventCount: 99 },
                { recDate: '2016-01-26', campaignId: 'def', eventType: 'users',    eventCount: 275 },
                { recDate: '2016-01-26', campaignId: 'def', eventType: 'installs', eventCount: 11 },
                { recDate: '2016-01-26', campaignId: 'def', eventType: 'launches', eventCount: 41 },
                { recDate: '2016-01-26', campaignId: 'def', eventType: 'views',    eventCount: 291 },
                { recDate: '2016-01-25', campaignId: 'def', eventType: 'views',    eventCount: 275 },
                { recDate: '2016-01-24', campaignId: 'def', eventType: 'views',    eventCount: 274 },
                { recDate: '2016-01-23', campaignId: 'def', eventType: 'views',    eventCount: 273 },
                { recDate: '2016-01-22', campaignId: 'def', eventType: 'views',    eventCount: 272 },
                { recDate: '2016-01-21', campaignId: 'def', eventType: 'views',    eventCount: 271 },
                { recDate: '2016-01-20', campaignId: 'def', eventType: 'views',    eventCount: 270 },
                { recDate: '2016-01-19', campaignId: 'def', eventType: 'views',    eventCount: 269 },
                { recDate: '2016-01-18', campaignId: 'def', eventType: 'views',    eventCount: 268 },
                { recDate: '2016-01-17', campaignId: 'def', eventType: 'views',    eventCount: 267 },
                { recDate: '2016-01-16', campaignId: 'def', eventType: 'views',    eventCount: 266 },
                { recDate: '2016-01-15', campaignId: 'def', eventType: 'views',    eventCount: 265 },
                { recDate: '2016-01-14', campaignId: 'def', eventType: 'views',    eventCount: 264 },
                { recDate: '2016-01-13', campaignId: 'def', eventType: 'views',    eventCount: 263 },
                { recDate: '2016-01-12', campaignId: 'def', eventType: 'views',    eventCount: 262 },
                { recDate: '2016-01-11', campaignId: 'def', eventType: 'views',    eventCount: 261 },
                { recDate: '2016-01-10', campaignId: 'def', eventType: 'views',    eventCount: 260 },
                { recDate: '2016-01-09', campaignId: 'def', eventType: 'views',    eventCount: 259 },
                { recDate: '2016-01-08', campaignId: 'def', eventType: 'views',    eventCount: 258 },
                { recDate: '2016-01-07', campaignId: 'def', eventType: 'views',    eventCount: 257 },
                { recDate: '2016-01-06', campaignId: 'def', eventType: 'views',    eventCount: 256 },
                { recDate: '2016-01-05', campaignId: 'def', eventType: 'views',    eventCount: 255 },
                { recDate: '2016-01-04', campaignId: 'def', eventType: 'views',    eventCount: 254 },
                { recDate: '2016-01-03', campaignId: 'def', eventType: 'views',    eventCount: 253 },
                { recDate: '2016-01-02', campaignId: 'def', eventType: 'views',    eventCount: 252 },
                { recDate: '2016-01-01', campaignId: 'def', eventType: 'views',    eventCount: 251 },
                { recDate: '2015-12-31', campaignId: 'def', eventType: 'views',    eventCount: 250 },
                { recDate: '2015-12-30', campaignId: 'def', eventType: 'views',    eventCount: 249 },
                { recDate: '2015-12-29', campaignId: 'def', eventType: 'views',    eventCount: 248 },
                { recDate: '2015-12-28', campaignId: 'def', eventType: 'views',    eventCount: 247 },
                { recDate: '2015-12-27', campaignId: 'def', eventType: 'views',    eventCount: 246 },
                { recDate: '2015-12-26', campaignId: 'def', eventType: 'views',    eventCount: 245 },
                { recDate: '2015-12-25', campaignId: 'def', eventType: 'views',    eventCount: 244 },
            ]

            lib.pgUtils = {
                query : jasmine.createSpy('pgUtils.query')
            };

            lib.pgUtils.query.and.returnValue(q({ rows : records }));
        });

        it('initializes a record if it is unset',function(done){
            expected_result.abc.daily_7 = [
                { date:'2016-01-20', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-21', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-22', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-23', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-24', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-25', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-26', clicks :11, installs:0, launches:0, users:111, views:121}
            ];
            expected_result.abc.daily_30 = [
                { date:'2015-12-28', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2015-12-29', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2015-12-30', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2015-12-31', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-01', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-02', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-03', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-04', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-05', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-06', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-07', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-08', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-09', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-10', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-11', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-12', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-13', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-14', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-15', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-16', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-17', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-18', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-19', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-20', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-21', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-22', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-23', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-24', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-25', clicks :0, installs:0, launches:0, users:0, views:0 },
                { date:'2016-01-26', clicks :11, installs:0, launches:0, users:111, views:121}

            ];

            expected_result.def.daily_7 = [
                { date:'2016-01-20', clicks :0, installs:0, launches:0, users:0, views:270},
                { date:'2016-01-21', clicks :0, installs:0, launches:0, users:0, views:271},
                { date:'2016-01-22', clicks :0, installs:0, launches:0, users:0, views:272},
                { date:'2016-01-23', clicks :0, installs:0, launches:0, users:0, views:273},
                { date:'2016-01-24', clicks :0, installs:0, launches:0, users:0, views:274},
                { date:'2016-01-25', clicks :0, installs:0, launches:0, users:0, views:275},
                { date:'2016-01-26', clicks :99, installs:11, launches:41, users:275, views:291}
            ];
            expected_result.def.daily_30 = [
                { date:'2015-12-28', clicks :0, installs:0, launches:0, users:0, views:247 },
                { date:'2015-12-29', clicks :0, installs:0, launches:0, users:0, views:248 },
                { date:'2015-12-30', clicks :0, installs:0, launches:0, users:0, views:249 },
                { date:'2015-12-31', clicks :0, installs:0, launches:0, users:0, views:250 },
                { date:'2016-01-01', clicks :0, installs:0, launches:0, users:0, views:251 },
                { date:'2016-01-02', clicks :0, installs:0, launches:0, users:0, views:252 },
                { date:'2016-01-03', clicks :0, installs:0, launches:0, users:0, views:253 },
                { date:'2016-01-04', clicks :0, installs:0, launches:0, users:0, views:254 },
                { date:'2016-01-05', clicks :0, installs:0, launches:0, users:0, views:255 },
                { date:'2016-01-06', clicks :0, installs:0, launches:0, users:0, views:256 },
                { date:'2016-01-07', clicks :0, installs:0, launches:0, users:0, views:257 },
                { date:'2016-01-08', clicks :0, installs:0, launches:0, users:0, views:258 },
                { date:'2016-01-09', clicks :0, installs:0, launches:0, users:0, views:259 },
                { date:'2016-01-10', clicks :0, installs:0, launches:0, users:0, views:260 },
                { date:'2016-01-11', clicks :0, installs:0, launches:0, users:0, views:261 },
                { date:'2016-01-12', clicks :0, installs:0, launches:0, users:0, views:262 },
                { date:'2016-01-13', clicks :0, installs:0, launches:0, users:0, views:263 },
                { date:'2016-01-14', clicks :0, installs:0, launches:0, users:0, views:264 },
                { date:'2016-01-15', clicks :0, installs:0, launches:0, users:0, views:265 },
                { date:'2016-01-16', clicks :0, installs:0, launches:0, users:0, views:266 },
                { date:'2016-01-17', clicks :0, installs:0, launches:0, users:0, views:267 },
                { date:'2016-01-18', clicks :0, installs:0, launches:0, users:0, views:268 },
                { date:'2016-01-19', clicks :0, installs:0, launches:0, users:0, views:269 },
                { date:'2016-01-20', clicks :0, installs:0, launches:0, users:0, views:270 },
                { date:'2016-01-21', clicks :0, installs:0, launches:0, users:0, views:271 },
                { date:'2016-01-22', clicks :0, installs:0, launches:0, users:0, views:272 },
                { date:'2016-01-23', clicks :0, installs:0, launches:0, users:0, views:273 },
                { date:'2016-01-24', clicks :0, installs:0, launches:0, users:0, views:274 },
                { date:'2016-01-25', clicks :0, installs:0, launches:0, users:0, views:275 },
                { date:'2016-01-26', clicks :99, installs:11, launches:41, users:275, views:291}
            ];

            lib.queryDaily(response)
            .then(function(result){
                expect(result).toEqual(expected_result);
            })
            .then(done,done.fail);
        });

    });

    describe('getCampaignDataFromCache',function(){
        var response;
        beforeEach(function(){
            response = {
                abc : {
                    campaignId : 'abc',
                    summary : {}, daily_7 : [], daily_30 :  [], today : []
                },
                def : {
                    campaignId : 'def',
                    summary : {}, daily_7 : [], daily_30 :  [], today : []
                }
            };
            lib.campaignCacheGet = jasmine.createSpy('campaignCacheGet');
        });

        it('returns the cached data structure campaign if found',function(done){
            var val = { campaignId : 'abc' };
            lib.campaignCacheGet.and.callFake(function(id){
                return  q(val);
            });

            lib.getCampaignDataFromCache('abc')
            .then(function(r){
                expect(lib.campaignCacheGet.calls.argsFor(0)).toEqual(['qb:ssb:apps:abc']);
                expect(r).toBe(val);
            })
            .then(done,done.fail);
        });

        it('returns null if there is an error',function(done){
            var e = new Error('err');
            lib.campaignCacheGet.and.callFake(function(id){
                return  q.reject(e);
            });

            lib.getCampaignDataFromCache('abc')
            .then(function(r){
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.argsFor(0)).toEqual([
                    'Cache error: Key=%1, Error=%2', 'qb:ssb:apps:abc', 'err'
                ]);
                expect(r).toBeNull();
            })
            .then(done,done.fail);
        });

    });

    describe('setCampaignDataInCache',function(){
        var data;
        beforeEach(function(){
            data = { campaignId : 'abc' };
            lib.campaignCacheSet = jasmine.createSpy('campaignCacheSet');
        });

        it('returns the passed data structure campaign if succeeds',function(done){
            lib.campaignCacheSet.and.returnValue(q(true));

            lib.setCampaignDataInCache('abc',data)
            .then(function(r){
                expect(lib.campaignCacheSet.calls.argsFor(0)).toEqual([
                    'qb:ssb:apps:abc',data
                ]);
                expect(r).toBe(data);
            })
            .then(done,done.fail);
        });

        it('returns the passed data if there is an error',function(done){
            var e = new Error('err');
            lib.campaignCacheSet.and.returnValue(q.reject(e));

            lib.setCampaignDataInCache('abc',data)
            .then(function(r){
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.argsFor(0)).toEqual([
                    'Cache set error: Key=%1, Error=%2', 'qb:ssb:apps:abc', 'err'
                ]);
                expect(r).toBe(data);
            })
            .then(done,done.fail);
        });


    });

    describe('getUncachedCampaignIds',function(){
        var response;
        beforeEach(function(){
            response = {
                'abc' : { campaignId : 'abc' },
                'def' : { campaignId : 'def', cacheTime : new Date() },
                'ghi' : { campaignId : 'ghi' }
            };
        });

        it('returns a list of campaignIds for campaigns with no cacheTime',function(){
            expect(lib.getUncachedCampaignIds(response)).toEqual([ 'abc','ghi' ]);
        });

        it('returns an empty list if there are no campaigns without a cacheTime',function(){
            response.abc.cacheTime = new Date();
            response.ghi.cacheTime = new Date();
            expect(lib.getUncachedCampaignIds(response)).toEqual([ ]);
        });
    });
});
