var flush = true;
describe('mongoUtils', function() {
    var pg, pgUtils, q, logger, mockLog;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q       = require('q');
        pg      = require('pg.js');
        pgUtils = require('../../lib/pgUtils');
        logger  = require('../../lib/logger');

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
