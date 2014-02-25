describe('monitor',function(){
    var mockLogger, mockLog, mockHttp, mockHttps, mockHttpReq, mockHttpRes, mockFs,
        resolveSpy, rejectSpy, flush = true, app, q;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();
        
        q           = require('q');
        mockFs      = require('fs-extra');
        mockHttp    = require('http'),
        mockHttps   = require('https'),
        mockLogger  = require('../../lib/logger');
        app         = require('../../bin/monitor').app;

        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };

        mockHttpReq = {
            _on     : {},
            on      : jasmine.createSpy('httpReq.on'),
            end     : jasmine.createSpy('httpReq.end'),
            write   : jasmine.createSpy('httpReq.write')
        };

        mockHttpRes = {
            _on     : {},
            on          : jasmine.createSpy('httpRes.on'),
            setEncoding : jasmine.createSpy('httpRes.setEncoding')
        };


        mockHttpReq.on.andCallFake(function(eventName,handler){
            mockHttpReq._on[eventName] = handler;
        });

        mockHttpRes.on.andCallFake(function(eventName,handler){
            mockHttpRes._on[eventName] = handler;
        });

        spyOn(mockLogger,'createLog').andReturn(mockLog);
        spyOn(mockLogger,'getLog').andReturn(mockLog);
        
        spyOn(mockFs,'existsSync');
        spyOn(mockFs,'readFileSync');

        spyOn(mockHttp,  'request').andReturn(mockHttpReq);
        spyOn(mockHttps, 'request').andReturn(mockHttpReq);

        spyOn(process , 'kill');
    });

    /* checkHttp -- begin */
    describe('checkHttp',function(){
        var params;
        beforeEach(function(){
            params = {
                checkHttp : {
                    host        : 'localhost',
                    port        : 4444,
                    path        : 'api/test/meta'
                }
            };
            resolveSpy = jasmine.createSpy('checkHttp.resolve');
            rejectSpy  = jasmine.createSpy('checkHttp.reject');
        });

        it('resolves a promise if it succeeds',function(done){
            app.checkHttp(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalledWith(params);
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(params.checkHttp.response.statusCode).toEqual(200);
                expect(params.checkHttp.response.data.key1).toEqual('value1');
                expect(params.checkHttp.response.data.key2).toEqual('value2');
            })
            .done(done);

            var reqOpts = mockHttp.request.argsForCall[0][0],
                reqCb = mockHttp.request.argsForCall[0][1];

            expect(reqOpts.hostname).toEqual(params.checkHttp.host);
            expect(reqOpts.port).toEqual(params.checkHttp.port);
            expect(reqOpts.path).toEqual(params.checkHttp.path);

            //Trigger the http.request response callback
            mockHttpRes.statusCode = 200;
            mockHttpRes.headers = {
                'content-type' : 'application/json'
            }
            reqCb(mockHttpRes);
            mockHttpRes._on.data('{ "key1" : "value1", "key2" : "value2" }');
            mockHttpRes._on.end();
        });

        it('rejects a promise if the call returns a non 2xx code',function(done){
            app.checkHttp(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].httpCode).toEqual(400);
                expect(rejectSpy.mostRecentCall.args[0].message).toEqual('This is an error.');
            })
            .done(done);

            var reqCb = mockHttp.request.argsForCall[0][1];

            //Trigger the http.request response callback
            mockHttpRes.statusCode = 400;
            mockHttpRes.headers = {
                'content-type' : 'text/plain'
            }
            reqCb(mockHttpRes);
            mockHttpRes._on.data('This is an error.');
            mockHttpRes._on.end();

        });

        it('rejects a promise if the http call errors out',function(done){
            app.checkHttp(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].httpCode).toEqual(500);
                expect(rejectSpy.mostRecentCall.args[0].message).toEqual('This is an error.');
            })
            .done(done);

            mockHttpReq._on.error({ message : 'This is an error.' });
        });

        it('uses https if params.checkHttp.https = true',function(){
            params.checkHttp.https = true;
            app.checkHttp(params);
            expect(mockHttps.request).toHaveBeenCalled();
        });

        it('sets port to 443 if params.checkHttp.https === true and port is undefined',function(){
            params.checkHttp.https = true;
            delete params.checkHttp.port;
            app.checkHttp(params);
            var reqOpts = mockHttps.request.argsForCall[0][0];
            expect(reqOpts.port).toEqual(443);
        });
        
        it('sets port to 80 if !params.checkHttp.https and port is undefined',function(){
            delete params.checkHttp.port;
            app.checkHttp(params);
            var reqOpts = mockHttp.request.argsForCall[0][0];
            expect(reqOpts.port).toEqual(80);
        });

        it('sets hostname to localhost if not set', function(){
            delete params.checkHttp.host;
            app.checkHttp(params);
            var reqOpts = mockHttp.request.argsForCall[0][0];
            expect(reqOpts.hostname).toEqual('localhost');
        });
    });
    /* checkHttp -- end */

    /* checkProcess -- begin */
    describe('checkProcess',function(){
        var params;
        beforeEach(function(){
            params = {
                checkProcess : {
                    pidPath     : '/opt/sixxy/somepath'
                }
            };
            resolveSpy = jasmine.createSpy('checkProcess.resolve');
            rejectSpy  = jasmine.createSpy('checkProcess.reject');
        });
        
        it('will reject if pidfile is missing',function(done){
            mockFs.existsSync.andReturn(false);
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].message)
                    .toEqual('Unable to locate pid.');
            })
            .done(done);
        });

        it('will reject if pidfile is missing',function(done){
            mockFs.existsSync.andReturn(false);
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(mockFs.existsSync).toHaveBeenCalledWith(params.checkProcess.pidPath);
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].message)
                    .toEqual('Unable to locate pid.');
            })
            .done(done);
        });
        
        it('will reject if process not running',function(done){
            mockFs.existsSync.andReturn(true);
            mockFs.readFileSync.andReturn('9332');
            process.kill.andCallFake(function(pid,signal){
                throw new Error('kill ESRCH');
            });
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(mockFs.readFileSync).toHaveBeenCalledWith(params.checkProcess.pidPath);
                expect(process.kill).toHaveBeenCalledWith(9332,0);
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].message)
                    .toEqual('Unable to locate process.');
            })
            .done(done);
        });

        it('will resolve if process is running',function(done){
            mockFs.existsSync.andReturn(true);
            mockFs.readFileSync.andReturn('9332');
            process.kill.andReturn(true);
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalledWith(params);
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });
    });
    /* checkProcess -- end */
    
    /* checkService -- begin */
    describe('checkService',function(){
        var params;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('checkService.resolve');
            rejectSpy  = jasmine.createSpy('checkService.reject');
            
            spyOn(app,'checkProcess');
            spyOn(app,'checkHttp');
        });

        it('will only checkHttp if configured to only checkHttp',function(done){
            params = {
                checkHttp : {
                    host : 'host',
                    port : 'port',
                    path : 'path'
                }
            };
            
            app.checkProcess.andReturn(q(params));
            app.checkHttp.andReturn(q(params));

            app.checkService(params)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(app.checkHttp).toHaveBeenCalled();
                    expect(app.checkProcess).not.toHaveBeenCalled();
                    expect(params.checks).toEqual(1);
                })
                .done(done);
        });

        it('will only checkProcess if configured to only checkProcess',function(done){
            params = {
                checkProcess : {
                    pidPath : 'path'
                }
            };

            app.checkProcess.andReturn(q(params));
            app.checkHttp.andReturn(q(params));
            
            app.checkService(params)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(app.checkHttp).not.toHaveBeenCalled();
                    expect(app.checkProcess).toHaveBeenCalled();
                    expect(params.checks).toEqual(1);
                })
                .done(done);
        });

        it('will reject if not configured for any checks',function(done){
            app.checkService({}).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].httpCode).toEqual(500);
                expect(rejectSpy.mostRecentCall.args[0].message)
                    .toEqual('No checks performed.');
            })
            .done(done);
        });
        
        it('will reject if one of the checks fails',function(done){
            params = {
                checkHttp : {
                    host : 'host',
                    port : 'port',
                    path : 'path'
                },
                checkProcess : {
                    pidPath : 'path'
                }
            };
            app.checkProcess.andReturn(q(params));
            app.checkHttp.andReturn(q.reject({message : 'Failed', httpCode : 500 }));
            app.checkService(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy.mostRecentCall.args[0].httpCode).toEqual(500);
                expect(rejectSpy.mostRecentCall.args[0].message).toEqual('Failed');
            })
            .done(done);
        });

        it('will resolve if all checks pass',function(done){
            params = {
                checkHttp : {
                    host : 'host',
                    port : 'port',
                    path : 'path'
                },
                checkProcess : {
                    pidPath : 'path'
                }
            };
            app.checkProcess.andReturn(q(params));
            app.checkHttp.andReturn(q(params));
            app.checkService(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalledWith(params);
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

    });
    /* checkService -- end */
    
    /* checkServices -- begin */
    describe('checkServices',function(){
        var params;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('checkService.resolve');
            rejectSpy  = jasmine.createSpy('checkService.reject');
            
            spyOn(app,'checkProcess');
            spyOn(app,'checkHttp');
            
            params = [
                {
                    name         : 'serviceA',
                    checkHttp    : { host : 'host', port : 'port', path : 'path' },
                    checkProcess : { pidPath : 'pidPath' }
                },
                {
                    name         : 'serviceB',
                    checkProcess : { pidPath : 'pidPath_serviceB' }
                },
                {
                    name         : 'serviceC',
                    checkHttp    : { host : 'host', port : 'port', path : 'path' },
                }
            ];

        });

        it('will resolve if all services pass all checks',function(done){
            app.checkProcess.andCallFake(function(p){ return q(p); });
            app.checkHttp.andCallFake(function(p){ return q(p); });
            
            app.checkServices(params)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalledWith(params);
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

        it('will reject if any of the service checks fail',function(done){
            app.checkProcess.andCallFake(function(p){ 
                if (p.pidPath === 'pidPath_serviceB'){
                    return q.reject({ message : 'FAIL!', httpCode : 500});
                }
                return q(p); 
            });
            app.checkHttp.andCallFake(function(p){ return q(p); });
            
            app.checkServices(params)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
            })
            .done(done);
        });
    });
    /* checkServices -- end */


});
