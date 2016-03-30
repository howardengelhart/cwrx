var flush = true;
describe('pgUtils', function() {
    var pg, pgUtils, q, logger, mockLog, dbpass;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q       = require('q');
        pg      = require('pg.js');
        pgUtils = require('../../lib/pgUtils');
        logger  = require('../../lib/logger');
        dbpass  = require('../../lib/dbpass');

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
    });

    describe('initConfig',function() {
        var state, mockLookup;
        beforeEach(function() {
            state = {
                config: {
                    pg: {
                        defaults: {
                            poolSize    : 21,
                            poolIdleTimeout : 4440,
                            reapIntervalMillis : 1200,
                            user        : 'myUser',
                            database    : 'mydb',
                            host        : 'myhost',
                            port        : 6666
                        }
                    }
                }
            };

            mockLookup = jasmine.createSpy('dbpass.lookup');
            spyOn(dbpass, 'open').and.returnValue(mockLookup);
        });

        it('throws an exception if missing certain default settings',function(){
            ['database', 'user', 'host'].forEach(function(setting) {
                var stateCopy = JSON.parse(JSON.stringify(state));
                delete stateCopy.config.pg.defaults[setting];
                
                expect(function() {
                    pgUtils.initConfig(stateCopy);
                }).toThrow(new Error('Missing configuration: pg.defaults.' + setting));
            });
        });

        it('sets the defauts on the pg object based on config defaults',function(){
            pgUtils.initConfig(state);
            expect(pg.defaults.poolSize).toEqual(21);
            expect(pg.defaults.poolIdleTimeout).toEqual(4440);
            expect(pg.defaults.reapIntervalMillis).toEqual(1200);
            expect(pg.defaults.database).toEqual('mydb');
            expect(pg.defaults.user).toEqual('myUser');
            expect(pg.defaults.host).toEqual('myhost');
            expect(pg.defaults.port).toEqual(6666);
        });

        it('ignores settings that are not supported',function(){
            state.config.pg.defaults.swimmingPoolSize = 100;
            pgUtils.initConfig(state);
            expect(pg.defaults.poolSize).toEqual(21);
            expect(pg.defaults.swimmingPoolSize).not.toBeDefined();
        });

        it('sets the default password based on other defaults and pgpass',function(){
            mockLookup.and.returnValue('password');
            pgUtils.initConfig(state);
            expect(dbpass.open).toHaveBeenCalled();
            expect(mockLookup).toHaveBeenCalledWith('myhost',6666,'mydb','myUser');            
            expect(pg.defaults.password).toEqual('password');
        });
    });

    describe('query',function() {
        var mockClient, mockDone;
        beforeEach(function() {
            mockClient = {
                query : jasmine.createSpy('client.query')
            };

            mockDone = jasmine.createSpy('pg.connect.done');

            spyOn(pg,'connect').and.callFake(function(cb) {
                cb(null, mockClient, mockDone);   
            });
        });
    
        it('will reject if the connect rejects',function(done) {
            var err = new Error('Failed to Connect!');
            pg.connect.and.callFake(function(cb){
                cb(err,mockClient,mockDone);
            });

            pgUtils.query('abc','param1').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Internal Error'));
                expect(error.status).toBe(500);
                expect(mockLog.error).toHaveBeenCalledWith('pg.connect error: %1', err.message);
                expect(mockClient.query).not.toHaveBeenCalled();            
            }).done(done);
        });

        it('will reject if the client query errs',function(done) {
            var err = new Error('Failed to Query!');
            mockClient.query.and.callFake(function(statement,args,cb){
                cb(err,null); 
            });

            pgUtils.query('abc','param1').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Internal Error'));
                expect(error.status).toBe(500);
                expect(mockLog.error).toHaveBeenCalledWith(
                    'pg.client.query error: %1, %2, %3', err.message, 'abc', 'param1'
                );
                expect(mockClient.query).toHaveBeenCalled();            
            }).done(done);
        });

        it('will return results if query does not error',function(done) {
            var results = { rows : [] };
            mockClient.query.and.callFake(function(statement,args,cb){
                cb(null,results); 
            });

            pgUtils.query('abc','param1').then(function(resp) {
                expect(resp).toEqual({ rows: [] });
                expect(mockClient.query).toHaveBeenCalledWith('abc', 'param1', jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
});
