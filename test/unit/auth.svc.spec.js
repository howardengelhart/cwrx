var path        = require('path'),
    fs          = require('fs-extra'),
    cwrxConfig  = require('../../lib/config'),
    uuid        = require('../../lib/uuid'),
    sanitize    = require('../sanitize');

describe('auth (UT)', function() {
    var auth, mockLog, mockLogger;
    
    beforeEach(function() {
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };

        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };

        auth = sanitize(['../bin/auth'])
                .andConfigure([['../lib/logger', mockLogger]])
                .andRequire();
    });

    describe('getVersion', function() {
        
        beforeEach(function() {
            spyOn(fs, 'existsSync');
            spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(auth.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            fs.existsSync.andReturn(true);
            fs.readFileSync.andReturn('ut123');
            
            expect(auth.getVersion()).toEqual('ut123');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            fs.existsSync.andReturn(false);
            expect(auth.getVersion()).toEqual('unknown');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).not.toHaveBeenCalled();
            
            fs.existsSync.andReturn(true);
            fs.readFileSync.andThrow('Exception!');
            expect(auth.getVersion()).toEqual('unknown');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
        });
    });

    describe('createConfiguration', function() {
        var createConfig, mockConfig;
        
        beforeEach(function() {
            spyOn(fs, 'existsSync');
            spyOn(fs, 'mkdirsSync');
            spyOn(fs, 'readJsonSync');
            
            mockConfig = {
                caches: {
                    run: 'ut/run/'
                },
                log: {
                    logLevel: 'trace'
                },
                secrets: {
                    path: '/secrets/.secrets.json'
                }
            };
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
        });
    
        it('should exist', function() {
            expect(auth.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', auth.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(fs.readJsonSync).toHaveBeenCalledWith('/secrets/.secrets.json');
            
            expect(cfgObject.caches.run).toBe('ut/run/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should correctly load secrets from a file', function() {
            fs.readJsonSync.andReturn({
                cookieParser: 'cookieSecret',
                session: 'secretSession',
            });
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(cfgObject.secrets.cookieParser).toBe('cookieSecret');
            expect(cfgObject.secrets.session).toBe('secretSession');
        });
        
        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = auth.createConfiguration({config: 'utConfig'});
                fs.existsSync.andReturn(false);
                cfgObject.ensurePaths();
                expect(fs.existsSync).toHaveBeenCalledWith('ut/run/');
                expect(fs.mkdirsSync).toHaveBeenCalledWith('ut/run/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = auth.createConfiguration({config: 'utConfig'});
                fs.existsSync.andReturn(true);
                cfgObject.ensurePaths();
                expect(fs.mkdirsSync).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.pid', 'run')).toBe('ut/run/test.pid');
        });
    });
    
    
}); // end -- describe auth
