var flush = true;
describe('maint (UT)', function() {
    var maint, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger, mockAws, request,
        path, fs, q, cwrxConfig, logger, aws, child_process;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.clock().install();

        path            = require('path');
        fs              = require('fs-extra');
        q               = require('q');
        request         = require('request');
        child_process   = require('child_process');
        aws             = require('aws-sdk');
        logger          = require('../../lib/logger');
        cwrxConfig      = require('../../lib/config');


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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        spyOn(aws.config, 'loadFromPath');
        maint = require('../../bin/maint');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
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
            existsSpy.and.returnValue(true);
            readFileSpy.and.returnValue('ut123');
            
            expect(maint.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.and.returnValue(false);
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/maint.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.and.returnValue(true);
            readFileSpy.and.throwError('Exception!');
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
            createConfig = spyOn(cwrxConfig, 'createConfigObject').and.returnValue(mockConfig);
        });
    
        it('should exist', function() {
            expect(maint.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', maint.defaultConfiguration);
            expect(logger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(aws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.line).toBe('ut/line/');
            expect(cfgObject.caches.script).toBe('ut/script/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            aws.config.loadFromPath.and.throwError('Exception!');
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();

            aws.config.loadFromPath.and.returnValue();
            delete mockConfig.s3;
            expect(function() {maint.createConfiguration({config: 'utConfig'})}).toThrow();
        });

        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.and.returnValue(false);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.count()).toBe(2);
                expect(mkdirSpy.calls.count()).toBe(2);
                expect(existsSpy).toHaveBeenCalledWith('ut/line/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/line/');
                expect(existsSpy).toHaveBeenCalledWith('ut/script/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/script/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = maint.createConfiguration({config: 'utConfig'});
                existsSpy.and.returnValue(true);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.count()).toBe(2);
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = maint.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.mp3', 'line'))
		.toBe(path.normalize('ut/line/test.mp3'));
        });
    });

    describe('removeFiles', function() {
        var removeSpy, existsSpy,
            files = ['abc.mp3', 'line/ghi.json'];
        
        beforeEach(function() {
            removeSpy = spyOn(fs, 'remove');
            existsSpy = spyOn(fs, 'existsSync');
        });
        
        it('should exist', function() {
            expect(maint.removeFiles).toBeDefined();
        });
        
        it('should remove a list of files', function(done) {
            existsSpy.and.returnValue(true);
            removeSpy.and.callFake(function(fpath, cb) {
                cb(null, 'Success!');
            });
            maint.removeFiles(files).then(function(count) {
                expect(count).toBe(2);
                expect(removeSpy.calls.count()).toBe(2);
                expect(existsSpy.calls.count()).toBe(2);
                expect(removeSpy.calls.all()[0].args[0]).toBe('abc.mp3');
                expect(removeSpy.calls.all()[1].args[0]).toBe('line/ghi.json');
                expect(existsSpy).toHaveBeenCalledWith('abc.mp3');
                expect(existsSpy).toHaveBeenCalledWith('line/ghi.json');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not remove non-existent files', function(done) {
            existsSpy.and.returnValue(false);
            maint.removeFiles(files).then(function(count) {
                expect(count).toBe(0);
                expect(existsSpy.calls.count()).toBe(2);
                expect(removeSpy).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle errors from deleting files correctly', function(done) {
            existsSpy.and.returnValue(true);
            removeSpy.and.callFake(function(fpath, cb) {
                if (fpath === 'abc.mp3') {
                    cb('Error on ' + fpath, null);
                } else {
                    cb(null, 'Success!');
                }
            });
            maint.removeFiles(files).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(existsSpy.calls.count()).toBe(2);
                expect(removeSpy.calls.count()).toBe(2);
                expect(error).toBe('Error on abc.mp3');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
   
    describe('restartService', function(){
        var resolveSpy, rejectSpy;
        beforeEach(function() {
            spyOn(request, 'get').and.callFake(function(opts, cb) {
                if (this.get.calls.count() > 3) cb(null, {statusCode: 200}, 'success');
                else cb(null, {statusCode: 502}, 'Bad Gateway');
            });
            spyOn(child_process,'exec').and.callFake(function(cmd,cb){
                cb(null,'OK',null);
            });
            resolveSpy = jasmine.createSpy('restartService.resolve');
            rejectSpy = jasmine.createSpy('restartService.reject');
        });

        it('will resolve a promise if it succeeds',function(done){
            var promise = maint.restartService('abc', 'http://testUrl.com', 500, 4);
            for (var i = 0; i < 4; i++) { jasmine.clock().tick(501); }
            promise.then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(child_process.exec).toHaveBeenCalled();
                    expect(request.get.calls.count()).toBe(4);
                    request.get.calls.all().forEach(function(callObj) {
                        expect(callObj.args).toEqual([{url: 'http://testUrl.com'}, jasmine.any(Function)]);
                    });
                    expect(resolveSpy).toHaveBeenCalledWith('abc'); 
                    expect(rejectSpy).not.toHaveBeenCalled(); 
                    done();
                });
        });
        
        it('will fail if checking if the service is running times out', function(done) {
            var promise = maint.restartService('abc', 'http://testUrl.com', 500, 3);
            for (var i = 0; i < 4; i++) { jasmine.clock().tick(501); }
            promise.then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(child_process.exec).toHaveBeenCalled();
                    expect(request.get.calls.count()).toBe(3);
                    expect(resolveSpy).not.toHaveBeenCalled(); 
                    expect(rejectSpy).toHaveBeenCalledWith({message: 'Hit max call count for checking service'}); 
                    done();
                });
        });

        it('will reject if exec fails',function(done){
            child_process.exec.and.callFake(function(cmd,cb){
                cb({ message : 'failed' },null,null);
            });

            maint.restartService('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(child_process.exec).toHaveBeenCalled();
                    expect(request.get).not.toHaveBeenCalled();
                    expect(resolveSpy).not.toHaveBeenCalled(); 
                    expect(rejectSpy).toHaveBeenCalledWith({ message : 'failed' }); 
                    done();
                });
        });
    });
}); // end -- describe maint
