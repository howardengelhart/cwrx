var flush = true;
fdescribe('querybot (UT)', function() {
    var mockLog, logger, q, pg, nextSpy, doneSpy, errorSpy, req, mockState, dbpass,
        mockLookup, mockDefer, mockClient, mockDone, mockPromise;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        pg              = require('pg.js');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');
        dbpass          = require('../../lib/dbpass');


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
        var req;
        beforeEach(function(){
            req = {
                uuid : '123',
                params : {},
                query  : {}
            };
        });

        it('pulls campaignIds from the request params',function(){
            req.params.id = 'ABC'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['ABC']);
        });
        
        it('pulls campaignIds from the request params',function(){
            req.query.id = 'ABC,DEF'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['ABC','DEF']);
        });

        it('ignores query param ids if main id param is set',function(){
            req.params.id = 'ABC'; 
            req.query.id = 'DEF,GHI'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['ABC']);
        });

        it('squashes duplicate ids',function(){
            req.query.id = 'DEF,ABC,GHI,ABC'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['DEF','ABC','GHI']);
        });

        it('will be an empty array if there are no ids',function(){
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual([]);
        });
    });

    describe('pgQuery',function(){
        it('will reject if the connect rejects',function(){
            var err = new Error('Failed to Connect!');
            pg.connect.and.callFake(function(cb){
                cb(err,mockClient,mockDone);   
            });
            lib.pgQuery('abc','param1');
            expect(mockDefer.reject).toHaveBeenCalledWith(err);
            expect(mockClient.query).not.toHaveBeenCalled();
        });

        it('will reject if the client query errs',function(){
            var err = new Error('Failed to Query!');
            mockClient.query.and.callFake(function(statement,args,cb){
                cb(err,null); 
            });
            lib.pgQuery('abc','param1');
            expect(mockClient.query).toHaveBeenCalled();
            expect(mockDefer.reject).toHaveBeenCalledWith(err);
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

    describe('queryCampaignSummary',function(){
        var req;
        beforeEach(function(){
            req = { 
                campaignIds : ['id1','id2']
            };
            spyOn(lib,'pgQuery').and.returnValue(mockPromise);
        });

        it('will throw an exception if there are no campaignIds',function(){
            req.campaignIds = [];
            expect(function(){
                lib.queryCampaignSummary(req);
            }).toThrow(new Error('At least one campaignId is required.'));
        });
        
        it('will pass campaignIds as parameters',function(){
            req.campaignIds = ['abc','def'];
            lib.queryCampaignSummary(req);
            expect(lib.pgQuery.calls.mostRecent().args[1]).toBe(req.campaignIds);
        });

        it('will put query results on req',function(){
            var results = { rows : [] };
            req.campaignIds = ['abc','def'];
            mockPromise.then.and.callFake(function(cb){
                cb(results);        
            });
            lib.queryCampaignSummary(req);
            expect(req.campaignSummaryResults).toBe(results.rows);
        });
    });


});
