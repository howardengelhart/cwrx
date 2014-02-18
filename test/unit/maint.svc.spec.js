var flush = true;
describe('maint (UT)', function() {
    var maint, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger, mockAws,
        path, fs, q, cwrxConfig, sanitize, child_process;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        path            = require('path');
        fs              = require('fs-extra');
        q               = require('q');
        child_process   = require('child_process');
        cwrxConfig      = require('../../lib/config');
        sanitize        = require('../sanitize');


        traceSpy    = jasmine.createSpy('log_trace');
        errorSpy    = jasmine.createSpy('log_error');
        warnSpy     = jasmine.createSpy('log_warn');
        infoSpy     = jasmine.createSpy('log_info');
        fatalSpy    = jasmine.createSpy('log_fatal');
        logSpy      = jasmine.createSpy('log_log');
        putObjSpy   = jasmine.createSpy('s3_putObj');
        
        var mockLog = {
            trace : traceSpy,
            error : errorSpy,
            warn  : warnSpy,
            info  : infoSpy,
            fatal : fatalSpy,
            log   : logSpy        
        };
        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };
        mockAws = {
            config: {
                loadFromPath: jasmine.createSpy('aws_config_loadFromPath')
            }
        };

        maint = sanitize(['../bin/maint'])
                .andConfigure([['../lib/logger', mockLogger], ['aws-sdk', mockAws]])
                .andRequire();
    });

    describe('getVersion', function() {
        var existsSpy, readFileSpy;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            readFileSpy = spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(maint.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(maint.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
        });
    });

    describe('createConfiguration', function() {
        var existsSpy, mkdirSpy, createConfig, mockConfig;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            mkdirSpy = spyOn(fs, 'mkdirsSync');
            mockConfig = {
                caches: {
                    line: 'ut/line/',
                    script: 'ut/script/',
                },
                log: {
                    logLevel: 'trace'
                },
                s3: {
                    auth: 'fakeAuth.json'
                }
            },
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
        });
    
        it('should exist', function() {
            expect(maint.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', maint.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.line).toBe('ut/line/');
            expect(cfgObject.caches.script).toBe('ut/script/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            mockAws.config.loadFromPath.andThrow('Exception!');
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();

            mockAws.config.loadFromPath.andReturn();
            delete mockConfig.s3;
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();
        });

        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(false);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.length).toBe(2);
                expect(mkdirSpy.calls.length).toBe(2);
                expect(existsSpy).toHaveBeenCalledWith('ut/line/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/line/');
                expect(existsSpy).toHaveBeenCalledWith('ut/script/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/script/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(true);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.length).toBe(2);
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.mp3', 'line')).toBe('ut/line/test.mp3');
        });
    });

    describe('removeFiles', function() {
        var removeSpy, existsSpy,
            doneFlag = false,
            files = ['abc.mp3', 'line/ghi.json'];
        
        beforeEach(function() {
            removeSpy = spyOn(fs, 'remove');
            existsSpy = spyOn(fs, 'existsSync');
        });
        
        it('should exist', function() {
            expect(maint.removeFiles).toBeDefined();
        });
        
        it('should remove a list of files', function() {
            existsSpy.andReturn(true);
            removeSpy.andCallFake(function(fpath, cb) {
                cb(null, 'Success!');
            });
            runs(function() {
                maint.removeFiles(files).then(function(count) {
                    expect(count).toBe(2);
                    expect(removeSpy.calls.length).toBe(2);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy.calls[0].args[0]).toBe('abc.mp3');
                    expect(removeSpy.calls[1].args[0]).toBe('line/ghi.json');
                    expect(existsSpy).toHaveBeenCalledWith('abc.mp3');
                    expect(existsSpy).toHaveBeenCalledWith('line/ghi.json');
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
        
        it('should not remove non-existent files', function() {
            existsSpy.andReturn(false);
            runs(function() {
                maint.removeFiles(files).then(function(count) {
                    expect(count).toBe(0);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy).not.toHaveBeenCalled();
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
        
        it('should handle errors from deleting files correctly', function() {
            existsSpy.andReturn(true);
            removeSpy.andCallFake(function(fpath, cb) {
                if (fpath === 'abc.mp3') {
                    cb('Error on ' + fpath, null);
                } else {
                    cb(null, 'Success!');
                }
            });
            runs(function() {
                maint.removeFiles(files).catch(function(error) {
                    expect(count).toBe(0);
                    expect(existsSpy.calls.length).toBe(2);
                    expect(removeSpy.calls.length).toBe(2);
                    expect(error).toBe('Error on abc.mp3');
                    doneFlag = true;
                });
            });
            waitsFor(function() { return doneFlag; }, 3000);
        });
    });
   
    describe('restartService', function(){
        it('will resolve a promise if succeds',function(done){
            var resolveSpy = jasmine.createSpy('restartService.resolve'),
                rejectSpy = jasmine.createSpy('restartService.reject');
            spyOn(child_process,'exec').andCallFake(function(cmd,cb){
                cb(null,'OK',null);
            });

            maint.restartService('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(child_process.exec).toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith('abc'); 
                    expect(rejectSpy).not.toHaveBeenCalled(); 
                    done();
                });
        });

        it('will reject if exec fails',function(done){
            var resolveSpy = jasmine.createSpy('restartService.resolve'),
                rejectSpy = jasmine.createSpy('restartService.reject');
            spyOn(child_process,'exec').andCallFake(function(cmd,cb){
                cb({ message : 'failed' },null,null);
            });

            maint.restartService('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(child_process.exec).toHaveBeenCalled();
                    expect(resolveSpy).not.toHaveBeenCalled(); 
                    expect(rejectSpy).toHaveBeenCalledWith({ message : 'failed' }); 
                    done();
                });
        });
    });
    
    describe('startLogTail', function() {
        var mockChild, config,
            EventEmitter = require('events').EventEmitter;
        
        beforeEach(function() {
            mockChild = {
                pid: 1234,
                kill: jasmine.createSpy('child.kill'),
                stderr: { on: jasmine.createSpy('child.stderr.on') },
                on: jasmine.createSpy('child.on')
            };
            spyOn(child_process, 'spawn').andReturn(mockChild);
            config = {
                log: { logDir: 'testLogs' }
            };
        });
        
        it('should start a tail on a log file', function() {
            var resp = maint.startLogTail('test.log', config);
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('tail started');
            expect(maint.logtailKids['test.log']).toBe(mockChild);
            expect(child_process.spawn).toHaveBeenCalledWith(
                'tail', ['-n', 0, '-f', 'testLogs/test.log']);
            expect(mockChild.kill).not.toHaveBeenCalled();
            expect(mockChild.on).toHaveBeenCalled();
            expect(mockChild.on.calls[0].args[0]).toBe('error');
            expect(typeof mockChild.on.calls[0].args[1]).toBe('function');
            expect(mockChild.stderr.on).toHaveBeenCalled();
            expect(mockChild.stderr.on.calls[0].args[0]).toBe('data');
            expect(typeof mockChild.stderr.on.calls[0].args[1]).toBe('function');
        });
        
        it('should still succeed if the tail has already been started on the log file', function() {
            maint.logtailKids['test.log'] = mockChild;
            var resp = maint.startLogTail('test.log', config);
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('tail already started');
            expect(child_process.spawn).not.toHaveBeenCalled();
            expect(mockChild.on).not.toHaveBeenCalled();
            expect(mockChild.stderr.on).not.toHaveBeenCalled();
        });
        
        it('should create a functional handler for the child\'s stderr stream', function() {
            mockChild.stderr = new EventEmitter();
            var resp = maint.startLogTail('test.log', config);
            expect(resp.code).toBe(200);
            mockChild.stderr.emit('data', ['I got a problem']);
            expect(errorSpy).toHaveBeenCalled();
            expect(mockChild.attemptedKill).toBe(true);
            expect(mockChild.kill).toHaveBeenCalled();
        });
        
        it('should create a functional handler for error events', function() {
            mockChild = new EventEmitter();
            mockChild.stderr = { on: jasmine.createSpy('child.stderr.on') };
            mockChild.kill = jasmine.createSpy('child.kill');
            child_process.spawn.andReturn(mockChild);
            var resp = maint.startLogTail('test.log', config);
            expect(resp.code).toBe(200);
            mockChild.emit('error', ['I got a problem']);
            expect(errorSpy).toHaveBeenCalled();
            expect(mockChild.attemptedKill).toBe(true);
            expect(mockChild.kill).toHaveBeenCalled();
        });
        
        it('should create an error handler that does not loop if kill emits an error', function() {
            mockChild = new EventEmitter();
            mockChild.stderr = { on: jasmine.createSpy('child.stderr.on') };
            mockChild.kill = jasmine.createSpy('child.kill').andCallFake(function() {
                mockChild.emit('error', ['I cannot be killed!']);
            });
            child_process.spawn.andReturn(mockChild);
            var resp = maint.startLogTail('test.log', config);
            expect(resp.code).toBe(200);
            mockChild.emit('error', ['I got a problem']);
            expect(errorSpy.calls.length).toBe(2);
            expect(mockChild.attemptedKill).toBe(true);
            expect(mockChild.kill.calls.length).toBe(1);
        });
    });
    
    describe('getLogLines', function() {
        var readSpy;
        beforeEach(function() {
            readSpy = jasmine.createSpy('child.stdout.read').andReturn(new Buffer("I did stuff"));
            maint.logtailKids['test.log'] = {
                stdout: { read: readSpy }
            };
        });
        
        it('should read data from the tail process\' stdout', function() {
            var resp = maint.getLogLines('test.log');
            expect(resp).toBeDefined();
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('I did stuff');
            expect(readSpy).toHaveBeenCalled();
            expect(maint.logtailKids['test.log']).toBeDefined();
        });
        
        it('should not do anything if there is no data', function() {
            readSpy.andReturn();
            var resp = maint.getLogLines('test.log');
            expect(resp).toBeDefined();
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('');
            expect(readSpy).toHaveBeenCalled();
            expect(maint.logtailKids['test.log']).toBeDefined();
        });
        
        it('should fail if the tail was never started', function() {
            var resp = maint.getLogLines('fake.log');
            expect(resp).toBeDefined();
            expect(resp.code).toBe(400);
            expect(resp.data).toEqual( {error: 'tail not started'} );
            expect(readSpy).not.toHaveBeenCalled();
            expect(maint.logtailKids['test.log']).toBeDefined();
        });
    });
    
    describe('stopLogTail', function() {
        it('should stop the tail on a log file', function() {
            var killSpy = jasmine.createSpy('child.kill');
            maint.logtailKids['test.log'] = {
                kill: killSpy
            };
            var resp = maint.stopLogTail('test.log');
            expect(resp).toBeDefined();
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('stopped tail');
            expect(killSpy).toHaveBeenCalled();
            expect(maint.logtailKids['test.log']).not.toBeDefined();
        });
        
        it('should still succeed if no tail has been started on the log file', function() {
            var resp = maint.stopLogTail('test.log');
            expect(resp).toBeDefined();
            expect(resp.code).toBe(200);
            expect(resp.data).toBe('tail not started');
            expect(maint.logtailKids['test.log']).not.toBeDefined();
        });
    });
}); // end -- describe maint
