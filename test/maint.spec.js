var include     = require('../lib/inject').require,
    path        = include('path'),
    fs          = include('fs-extra'),
    q           = include('q'),
    sanitize    = include('../test/sanitize');

describe('maint', function() {
    var maint, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger, mockAws;
    
    beforeEach(function() {
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
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/maint.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/maint.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(maint.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/maint.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/maint.version'));
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
            createConfig = spyOn(include('../lib/config'), 'createConfigObject').andReturn(mockConfig);
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
});
