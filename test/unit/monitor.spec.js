describe('monitor',function(){
    var mockLogger, mockLog, mockHttp, mockHttps, mockHttpReq, mockHttpRes, mockFs, mockGlob,
        requestUtils, resolveSpy, rejectSpy, flush = true, app, q, anyFunc;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.clock().install();
        
        q               = require('q');
        mockGlob        = require('glob');
        mockFs          = require('fs-extra');
        mockHttp        = require('http');
        mockHttps       = require('https');
        mockLogger      = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        app             = require('../../bin/monitor').app;

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
            send        : jasmine.createSpy('httpRes.send'),
            setEncoding : jasmine.createSpy('httpRes.setEncoding')
        };

        anyFunc = jasmine.any(Function);

        mockHttpReq.on.and.callFake(function(eventName,handler){
            mockHttpReq._on[eventName] = handler;
        });

        mockHttpRes.on.and.callFake(function(eventName,handler){
            mockHttpRes._on[eventName] = handler;
        });

        spyOn(mockGlob,'Glob');

        spyOn(mockLogger,'createLog').and.returnValue(mockLog);
        spyOn(mockLogger,'getLog').and.returnValue(mockLog);
        
        spyOn(mockFs,'existsSync');
        spyOn(mockFs,'readFileSync');
        spyOn(mockFs,'readJsonSync');

        spyOn(mockHttp,  'request').and.returnValue(mockHttpReq);
        spyOn(mockHttps, 'request').and.returnValue(mockHttpReq);

        spyOn(process , 'kill');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
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

            var reqOpts = mockHttp.request.calls.allArgs()[0][0],
                reqCb = mockHttp.request.calls.allArgs()[0][1];

            expect(reqOpts.hostname).toEqual(params.checkHttp.host);
            expect(reqOpts.port).toEqual(params.checkHttp.port);
            expect(reqOpts.path).toEqual(params.checkHttp.path);

            //Trigger the http.request response callback
            mockHttpRes.statusCode = 200;
            mockHttpRes.headers = {
                'content-type' : 'application/json'
            };
            reqCb(mockHttpRes);
            mockHttpRes._on.data('{ "key1" : "value1", "key2" : "value2" }');
            mockHttpRes._on.end();
        });

        it('rejects a promise if the call returns a non 2xx code',function(done){
            app.checkHttp(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].httpCode).toEqual(502);
                expect(rejectSpy.calls.mostRecent().args[0].message).toEqual('This is an error.');
            })
            .done(done);

            var reqCb = mockHttp.request.calls.allArgs()[0][1];

            //Trigger the http.request response callback
            mockHttpRes.statusCode = 400;
            mockHttpRes.headers = {
                'content-type' : 'text/plain'
            };
            reqCb(mockHttpRes);
            mockHttpRes._on.data('This is an error.');
            mockHttpRes._on.end();

        });

        it('rejects a promise if the http call errors out',function(done){
            app.checkHttp(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].httpCode).toEqual(500);
                expect(rejectSpy.calls.mostRecent().args[0].message).toEqual('This is an error.');
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
            var reqOpts = mockHttps.request.calls.allArgs()[0][0];
            expect(reqOpts.port).toEqual(443);
        });
        
        it('sets port to 80 if !params.checkHttp.https and port is undefined',function(){
            delete params.checkHttp.port;
            app.checkHttp(params);
            var reqOpts = mockHttp.request.calls.allArgs()[0][0];
            expect(reqOpts.port).toEqual(80);
        });

        it('sets hostname to localhost if not set', function(){
            delete params.checkHttp.host;
            app.checkHttp(params);
            var reqOpts = mockHttp.request.calls.allArgs()[0][0];
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
            mockFs.existsSync.and.returnValue(false);
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Process unavailable.');
            })
            .done(done);
        });

        it('will reject if pidfile is missing',function(done){
            mockFs.existsSync.and.returnValue(false);
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(mockFs.existsSync).toHaveBeenCalledWith(params.checkProcess.pidPath);
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Process unavailable.');
            })
            .done(done);
        });
        
        it('will reject if process not running',function(done){
            mockFs.existsSync.and.returnValue(true);
            mockFs.readFileSync.and.returnValue('9332');
            process.kill.and.callFake(function(pid,signal){
                throw new Error('kill ESRCH');
            });
            app.checkProcess(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(mockFs.readFileSync).toHaveBeenCalledWith(params.checkProcess.pidPath);
                expect(process.kill).toHaveBeenCalledWith(9332,0);
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Process unavailable.');
            })
            .done(done);
        });

        it('will resolve if process is running',function(done){
            mockFs.existsSync.and.returnValue(true);
            mockFs.readFileSync.and.returnValue('9332');
            process.kill.and.returnValue(true);
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
            
            app.checkProcess.and.returnValue(q(params));
            app.checkHttp.and.returnValue(q(params));

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

            app.checkProcess.and.returnValue(q(params));
            app.checkHttp.and.returnValue(q(params));
            
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
                expect(rejectSpy.calls.mostRecent().args[0].httpCode).toEqual(500);
                expect(rejectSpy.calls.mostRecent().args[0].message)
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
            app.checkProcess.and.returnValue(q(params));
            app.checkHttp.and.returnValue(q.reject({message : 'Failed', httpCode : 500 }));
            app.checkService(params).then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].httpCode).toEqual(500);
                expect(rejectSpy.calls.mostRecent().args[0].message).toEqual('Failed');
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
            app.checkProcess.and.returnValue(q(params));
            app.checkHttp.and.returnValue(q(params));
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
            app.checkProcess.and.callFake(function(p){ return q(p); });
            app.checkHttp.and.callFake(function(p){ return q(p); });
            
            app.checkServices(params)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalledWith({
                    serviceA : '200', serviceB : '200', serviceC : '200'
                });
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

        it('will reject if there are no services ',function(done){
            app.checkProcess.and.callFake(function(p){ return q(p); });
            app.checkHttp.and.callFake(function(p){ return q(p); });
            
            app.checkServices([])
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalledWith({ httpCode : 500, message : 'No services monitored.' });
            })
            .done(done);
        });

        it('will reject if any of the service checks fail',function(done){
            app.checkProcess.and.callFake(function(p){
                if (p.checkProcess.pidPath === 'pidPath_serviceB'){
                    return q.reject({ message : 'FAIL!', httpCode : 500});
                }
                return q(p);
            });
            app.checkHttp.and.callFake(function(p){ return q(p); });
            
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
    
    /* handleGetStatus -- begin */
    describe('handleGetStatus',function(){
        var state;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('handleGetStatus.resolve');
            rejectSpy  = jasmine.createSpy('handleGetStatus.reject');
            
            spyOn(app,'checkProcess').and.callFake(function(p){ return q(p); });
            spyOn(app,'checkHttp').and.callFake(function(p){ return q(p); });
            
            state = {
                config   : {},
                services : [
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
                ]
            };

        });

        it('will generate a 200 response if the check succeeds',function(done){
            app.handleGetStatus(state,mockHttpReq,mockHttpRes)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockHttpRes.send).toHaveBeenCalledWith(200, {
                    serviceA : '200', serviceB : '200', serviceC : '200'
                });
            })
            .done(done);
        });
        
        it('will generate a 500 response if there are no services configured', function(done){
            state.services = [];
            app.handleGetStatus(state,mockHttpReq,mockHttpRes)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockHttpRes.send).toHaveBeenCalledWith(500, 'No services monitored.');
            })
            .done(done);
        });


        it('will generate a 502 response if an http check fails', function(done){
            app.checkHttp.and.callFake(function(p){
                if (p.name === 'serviceC'){
                    return q.reject({ httpCode : 502, message : 'Failed' });
                }
                return q(p);
            });
            app.handleGetStatus(state,mockHttpReq,mockHttpRes)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockHttpRes.send).toHaveBeenCalledWith(502, {
                    serviceA : '200', serviceB : '200', serviceC : '502'
                });
            })
            .done(done);
        });

        it('will generate a 503 response if a checkProcess call fails', function(done){
            app.checkProcess.and.callFake(function(p){
                if (p.name === 'serviceB'){
                    return q.reject({ httpCode : 503, message : 'Process unavailable' });
                }
                return q(p);
            });
            app.checkHttp.and.callFake(function(p){
                if (p.name === 'serviceC'){
                    return q.reject({ httpCode : 502, message : 'Failed' });
                }
                return q(p);
            });
            app.handleGetStatus(state,mockHttpReq,mockHttpRes)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockHttpRes.send).toHaveBeenCalledWith(502, {
                    serviceA : '200', serviceB : '503', serviceC : '502'
                });
            })
            .done(done);
        });
        
        it('will generate a 504 response if a check times out', function(done){
            app.checkHttp.and.callFake(function(p){
                setTimeout(function(){
                    return q(p);
                },2000);
            });
            state.config.requestTimeout = 1000;
            app.handleGetStatus(state,mockHttpReq,mockHttpRes)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockHttpRes.send).toHaveBeenCalledWith(504,'Request timed out.');
            })
            .done(done);
            jasmine.clock().tick(1200);
        });
    });
    /* handleGetStatus -- end */
    
    /* loadMonitorProfiles  -- begin */
    describe('loadMonitorProfiles', function(){
        var state;
        beforeEach(function(){
            state = {
                config : {}
            };
            resolveSpy = jasmine.createSpy('loadMonitorProfiles.resolve');
            rejectSpy  = jasmine.createSpy('loadMonitorProfiles.reject');
        });

         it('uses the state.monitorInc setting to find files',function(done){
            var globPattern;
            mockGlob.Glob.and.callFake(function(pattern,callback){
                globPattern = pattern;
                callback(null,[]);
            });
            state.config.monitorInc = '/opt/sixxy/conf/*.mon';
            app.loadMonitorProfiles(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(globPattern).toEqual('/opt/sixxy/conf/*.mon');
            })
            .done(done);
        });

        it('adds the contents of the monitor files to the state.services array',function(done){
            mockGlob.Glob.and.callFake(function(pattern,callback){
                callback(null,['fileA.json','fileB.json']);
            });
            mockFs.readJsonSync.and.callFake(function(fpath){
                if (fpath === 'fileA.json'){
                    return { name : 'serviceA', checkProgress : {} };
                }
                return { name : 'serviceB', checkProgress : {} };
            });
            state.config.monitorInc = '/opt/sixxy/conf/*.mon';
            app.loadMonitorProfiles(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(mockFs.readJsonSync.calls.count()).toEqual(2);
                expect(state.services.length).toEqual(2);
            })
            .done(done);
        });
        
        it('rejects if there is an error reading a config file',function(done){
            mockGlob.Glob.and.callFake(function(pattern,callback){
                callback(null,['fileA.json','fileB.json']);
            });
            mockFs.readJsonSync.and.callFake(function(fpath){
                if (fpath === 'fileA.json'){
                    return { name : 'serviceA', checkProgress : {} };
                }
                throw new Error('NOT JSON');
            });
            state.config.monitorInc = '/opt/sixxy/conf/*.mon';
            app.loadMonitorProfiles(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Failed to read fileB.json with NOT JSON');
            })
            .done(done);
        });
    });
    /* loadMonitorProfiles  -- end */
    
    /* verifyConfiguration -- begin */
    describe('verifyConfiguration',function(){
        var state;
        beforeEach(function(){
            state = { config : {} };
            resolveSpy = jasmine.createSpy('verifyConfiguration.resolve');
            rejectSpy  = jasmine.createSpy('verifyConfiguration.reject');
        });

        it('will not reject if there are no services',function(done){
            app.verifyConfiguration({})
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

        it('will not reject if the services configs are empty',function(done){
            app.verifyConfiguration({ services : [] })
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });
        
        it('will reject if there is a service missing its name', function(done){
            state.services = [
                { name: 'serviceA', checkProcess : { pidPath : 'pidA' } },
                { xame: 'serviceB', checkProcess : { pidPAth : 'pidB' } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Service at index 1 requires a name.');
            })
            .done(done);
        });

        it('will reject if there is an invalid service::checkProcess config', function(done){
            state.services = [
                { name: 'serviceA', checkProcess : { pidPath : 'pidA' } },
                { name: 'serviceB', checkProcess : { pidPxxx : 'pidB' } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Service serviceB requires pidPath for checkProcess.');
            })
            .done(done);
        });

        it('will reject if there is an invalid service::checkHttp config', function(done){
            state.services = [
                { name: 'serviceA', checkHttp : { path : 'pidA' } },
                { name: 'serviceB', checkHttp : {  } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Service serviceB requires path for checkHttp.');
            })
            .done(done);
        });

        it('will reject if there no valid service checks configured', function(done){
            state.services = [
                { name: 'serviceA', xxxckHttp : { path : 'pidA' } },
                { name: 'serviceB', xxxckProcess : { pidPath : 'pidB' } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalled();
                expect(rejectSpy.calls.mostRecent().args[0].message)
                    .toEqual('Service serviceA requires checkProcess or checkHttp.');
            })
            .done(done);
        });

        it('will resolve if there are valid service checks configured', function(done){
            state.services = [
                { name: 'serviceA', checkHttp : { path : 'pidA' } },
                { name: 'serviceB', checkProcess : { pidPath : 'pidB' } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

        it('will set checkHttp.timeout with state.config.checkHttpTime if unset',function(done){
            state.config.checkHttpTimeout = 1000;
            state.services = [
                { name: 'serviceA', checkHttp : { path : 'pidA' } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(state.services[0].checkHttp.timeout).toEqual(1000);
            })
            .done(done);
        });
        
        it('will leave checkHttp.timeout if set',function(done){
            state.config.checkHttpTimeout = 1000;
            state.services = [
                { name: 'serviceA', checkHttp : { path : 'pidA', timeout : 200 } }
            ];
            app.verifyConfiguration(state)
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).toHaveBeenCalled();
                expect(rejectSpy).not.toHaveBeenCalled();
                expect(state.services[0].checkHttp.timeout).toEqual(200);
            })
            .done(done);
        });
    });
    /* verifyConfiguration -- end */
    
    /* getASGInstances -- begin */
    describe('getASGInstances', function() {
        var ASG, EC2, config, mockGroups, mockReservations;
        beforeEach(function() {
            mockGroups = [{
                Instances: [
                    { InstanceId: 'i-1', LifecycleState: 'InService' },
                    { InstanceId: 'i-2', LifecycleState: 'Terminating' },
                    { InstanceId: 'i-3', LifecycleState: 'InService' }
                ]
            }];
            mockReservations = [
                { Instances: [ { InstanceId: 'i-1', PrivateIpAddress: '1.2.3.4' } ] },
                { Instances: [ { InstanceId: 'i-3', PrivateIpAddress: '5.6.7.8' } ] }
            ];
            ASG = { describeAutoScalingGroups: jasmine.createSpy('describeASGs').and.callFake(function(params, cb) {
                cb(null, { AutoScalingGroups: mockGroups });
            }) };
            EC2 = { describeInstances: jasmine.createSpy('describeInstances').and.callFake(function(params, cb) {
                cb(null, { Reservations: mockReservations });
            }) };
        });
        
        it('should return a list of instances\' private ip addresses', function(done) {
            app.getASGInstances(ASG, EC2, 'testGroup').then(function(ips) {
                expect(ips).toEqual(['1.2.3.4', '5.6.7.8']);
                expect(ASG.describeAutoScalingGroups).toHaveBeenCalledWith({ AutoScalingGroupNames: ['testGroup'] }, anyFunc);
                expect(EC2.describeInstances).toHaveBeenCalledWith({ InstanceIds: ['i-1', 'i-3'] }, anyFunc);
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if there are no active instances in the group', function(done) {
            mockGroups[0].Instances[0].LifecycleState = 'Pending';
            mockGroups[0].Instances[2].LifecycleState = 'Detaching';

            app.getASGInstances(ASG, EC2, 'testGroup').then(function(ips) {
                expect(ips).toEqual([]);
                expect(ASG.describeAutoScalingGroups).toHaveBeenCalled();
                expect(EC2.describeInstances).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if incomplete data is returned from describing the ASG', function(done) {
            mockGroups = [];

            app.getASGInstances(ASG, EC2, 'testGroup').then(function(ips) {
                expect(ips).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('AWS Error');
                expect(ASG.describeAutoScalingGroups).toHaveBeenCalled();
                expect(EC2.describeInstances).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if describing the ASG fails', function(done) {
            ASG.describeAutoScalingGroups.and.callFake(function(params, cb) { cb('I GOT A PROBLEM'); });

            app.getASGInstances(ASG, EC2, 'testGroup').then(function(ips) {
                expect(ips).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('AWS Error');
                expect(ASG.describeAutoScalingGroups).toHaveBeenCalled();
                expect(EC2.describeInstances).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if describing the instances fails', function(done) {
            EC2.describeInstances.and.callFake(function(params, cb) { cb('I GOT A PROBLEM'); });

            app.getASGInstances(ASG, EC2, 'testGroup').then(function(ips) {
                expect(ips).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('AWS Error');
                expect(ASG.describeAutoScalingGroups).toHaveBeenCalled();
                expect(EC2.describeInstances).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    /* getASGInstances -- end */

    /* getCacheServers -- begin */
    describe('getCacheServers', function() {
        var cfg;
        beforeEach(function() {
            cfg = { groupName: 'testGroup', cachePort: 123, scanTimeout: 2000, serverIps: ['3.3.3.3', '4.4.4.4'] };
            spyOn(app, 'getASGInstances').and.returnValue(q(['1.1.1.1', '2.2.2.2']));
            spyOn(requestUtils, 'portScan').and.returnValue(q(true));
        });
        
        it('should lookup servers from the ASG and verify that the cache is running on each', function(done) {
            app.getCacheServers('mockASG', 'mockEC2', cfg).then(function(hosts) {
                expect(hosts).toEqual(['1.1.1.1:123', '2.2.2.2:123']);
                expect(app.getASGInstances).toHaveBeenCalledWith('mockASG', 'mockEC2', 'testGroup');
                expect(requestUtils.portScan.calls.count()).toBe(2);
                expect(requestUtils.portScan).toHaveBeenCalledWith('1.1.1.1', 123, 2000);
                expect(requestUtils.portScan).toHaveBeenCalledWith('2.2.2.2', 123, 2000);
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should use a static list of ips if no ASG groupName is provided', function(done) {
            delete cfg.groupName;
            app.getCacheServers('mockASG', 'mockEC2', cfg).then(function(hosts) {
                expect(hosts).toEqual(['3.3.3.3:123', '4.4.4.4:123']);
                expect(app.getASGInstances).not.toHaveBeenCalled();
                expect(requestUtils.portScan.calls.count()).toBe(2);
                expect(requestUtils.portScan).toHaveBeenCalledWith('3.3.3.3', 123, 2000);
                expect(requestUtils.portScan).toHaveBeenCalledWith('4.4.4.4', 123, 2000);
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if no list of serverIps or groupName is provided', function(done) {
            delete cfg.groupName;
            delete cfg.serverIps;
            app.getCacheServers('mockASG', 'mockEC2', cfg).then(function(hosts) {
                expect(hosts).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('No way to get servers');
                expect(app.getASGInstances).not.toHaveBeenCalled();
                expect(requestUtils.portScan).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should log a warning if the cache is not running on a server', function(done) {
            requestUtils.portScan.and.callFake(function(host, port, timeout) {
                if (host === '1.1.1.1') return q.reject('nope');
                else return q(true);
            });
            app.getCacheServers('mockASG', 'mockEC2', cfg).then(function(hosts) {
                expect(hosts).toEqual(['2.2.2.2:123']);
                expect(requestUtils.portScan.calls.count()).toBe(2);
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getASGInstances fails', function(done) {
            app.getASGInstances.and.returnValue(q.reject('I GOT A PROBLEM'));
            app.getCacheServers('mockASG', 'mockEC2', cfg).then(function(hosts) {
                expect(hosts).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(app.getASGInstances).toHaveBeenCalled();
                expect(requestUtils.portScan).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    /* getCacheServers -- end */
});
