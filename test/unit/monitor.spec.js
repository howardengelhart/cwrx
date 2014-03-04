describe('monitor',function(){
    var mockLogger, mockLog, mockHttp, mockHttps, mockHttpReq, mockHttpRes, mockFs, mockGlob,
        resolveSpy, rejectSpy, flush = true, app, q;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();
        
        q           = require('q');
        mockGlob    = require('glob');
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
            send        : jasmine.createSpy('httpRes.send'),
            setEncoding : jasmine.createSpy('httpRes.setEncoding')
        };


        mockHttpReq.on.andCallFake(function(eventName,handler){
            mockHttpReq._on[eventName] = handler;
        });

        mockHttpRes.on.andCallFake(function(eventName,handler){
            mockHttpRes._on[eventName] = handler;
        });

        spyOn(mockGlob,'Glob');

        spyOn(mockLogger,'createLog').andReturn(mockLog);
        spyOn(mockLogger,'getLog').andReturn(mockLog);
        
        spyOn(mockFs,'existsSync');
        spyOn(mockFs,'readFileSync');
        spyOn(mockFs,'readJsonSync');

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
                expect(rejectSpy.mostRecentCall.args[0].httpCode).toEqual(502);
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
                    .toEqual('Process unavailable.');
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
                    .toEqual('Process unavailable.');
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
                    .toEqual('Process unavailable.');
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
                expect(resolveSpy).toHaveBeenCalledWith({
                    serviceA : '200', serviceB : '200', serviceC : '200'
                });
                expect(rejectSpy).not.toHaveBeenCalled();
            })
            .done(done);
        });

        it('will reject if there are no services ',function(done){
            app.checkProcess.andCallFake(function(p){ return q(p); });
            app.checkHttp.andCallFake(function(p){ return q(p); });
            
            app.checkServices([])
            .then(resolveSpy,rejectSpy)
            .finally(function(){
                expect(resolveSpy).not.toHaveBeenCalled();
                expect(rejectSpy).toHaveBeenCalledWith({ httpCode : 500, message : 'No services monitored.' });
            })
            .done(done);
        });

        it('will reject if any of the service checks fail',function(done){
            app.checkProcess.andCallFake(function(p){ 
                if (p.checkProcess.pidPath === 'pidPath_serviceB'){
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
    
    /* handleGetStatus -- begin */
    describe('handleGetStatus',function(){
        var state;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('handleGetStatus.resolve');
            rejectSpy  = jasmine.createSpy('handleGetStatus.reject');
            
            spyOn(app,'checkProcess').andCallFake(function(p){ return q(p); });
            spyOn(app,'checkHttp').andCallFake(function(p){ return q(p); });
            
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
            app.checkHttp.andCallFake(function(p){ 
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
            app.checkProcess.andCallFake(function(p){
                if (p.name === 'serviceB'){
                    return q.reject({ httpCode : 503, message : 'Process unavailable' });
                }
                return q(p); 
            });
            app.checkHttp.andCallFake(function(p){ 
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
            app.checkHttp.andCallFake(function(p){ 
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
            jasmine.Clock.tick(1200);
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
            mockGlob.Glob.andCallFake(function(pattern,callback){
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
            mockGlob.Glob.andCallFake(function(pattern,callback){
                callback(null,['fileA.json','fileB.json']);      
            });
            mockFs.readJsonSync.andCallFake(function(fpath){
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
                expect(mockFs.readJsonSync.callCount).toEqual(2);
                expect(state.services.length).toEqual(2);
            })
            .done(done);
        });
        
        it('rejects if there is an error reading a config file',function(done){
            mockGlob.Glob.andCallFake(function(pattern,callback){
                callback(null,['fileA.json','fileB.json']);      
            });
            mockFs.readJsonSync.andCallFake(function(fpath){
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
                expect(rejectSpy.mostRecentCall.args[0].message)
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
                expect(rejectSpy.mostRecentCall.args[0].message)
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
                expect(rejectSpy.mostRecentCall.args[0].message)
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
                expect(rejectSpy.mostRecentCall.args[0].message)
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
                expect(rejectSpy.mostRecentCall.args[0].message)
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


});
