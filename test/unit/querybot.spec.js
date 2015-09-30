var flush = true;
fdescribe('querybot (UT)', function() {
    var mockLog, logger, q, pg, nextSpy, doneSpy, errorSpy, req, mockState, dbpass, mockLookup;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        pg              = require('pg.js');
        lib             = require('../../bin/querybot');
        logger          = require('../../lib/logger');
        dbpass          = require('../../lib/dbpass');

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

        it('can pull ids from both request params and query',function(){
            req.params.id = 'ABC'; 
            req.query.id = 'DEF,GHI'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['ABC','DEF','GHI']);
        });

        it('squashes duplicate ids',function(){
            req.params.id = 'ABC'; 
            req.query.id = 'DEF,ABC,GHI'; 
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual(['ABC','DEF','GHI']);
        });

        it('will be an empty array if there are no ids',function(){
            lib.campaignIdsFromRequest(req);
            expect(req.campaignIds).toEqual([]);
        });
    });
/*
    describe('formatCampaignSummarySQL',function(){
        var req;
        beforeEach(function(){
            req = { 
                campaignIds : []
            };
        });

        it('will throw an exception if there are no campaignIds',function(){
            expect(function(){
                lib.formatCampaignSummarySQL(req)
            }).toThrow(new Error('At least one campaignId is required!'));
        });

        it('will format a sql statement with one id',function(){
            req.campaignIds.push('ABC');
            lib.formatCampaignSummarySQL(req);
            expect(req.sqlCampaignSummary).toEqual(
                'SELECT campaign_id,impressions,views,clicks,total_spend ' +
                'FROM fct.v_cpv_campaign_activity_crosstab WHERE campaign_id = \'ABC\''
            );
        });
        
        it('will format a sql statement with a list of ids',function(){
            req.campaignIds.push('ABC','DEF','GHI');
            lib.formatCampaignSummarySQL(req);
            expect(req.sqlCampaignSummary).toEqual(
                'SELECT campaign_id,impressions,views,clicks,total_spend ' +
                'FROM fct.v_cpv_campaign_activity_crosstab WHERE campaign_id IN (' +
                '\'ABC\',\'DEF\',\'GHI\')'
            );
        });

    });
*/

});
