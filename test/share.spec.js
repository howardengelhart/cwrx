var include     = require('../lib/inject').require,
    path        = include('path'),
    fs          = include('fs-extra'),
    sanitize    = require('./sanitize');

describe('share', function() {
    var share, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger,
        mockAws, putObjSpy;

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
            },
            S3: function() {
                return {
                    putObject: putObjSpy
                }
            }
        };

        share = sanitize(['../bin/share'])
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
            expect(share.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(share.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(share.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/share.version'));
        });
    });

    describe('createConfiguration', function() {
        var existsSpy, mkdirSpy, createConfig, mockConfig;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            mkdirSpy = spyOn(fs, 'mkdirsSync');
            mockConfig = {
                caches: {
                    run: 'ut/run/'
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
            expect(share.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = share.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', share.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.run).toBe('ut/run/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            mockAws.config.loadFromPath.andThrow('Exception!');
            expect(function() {share.createConfiguration({config: './utConfig'})}).toThrow();

            mockAws.config.loadFromPath.andReturn();
            delete mockConfig.s3;
            expect(function() {share.createConfiguration({config: './utConfig'})}).toThrow();
        });
        
        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = share.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(false);
                cfgObject.ensurePaths();
                expect(existsSpy).toHaveBeenCalledWith('ut/run/');
                expect(mkdirSpy).toHaveBeenCalledWith('ut/run/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = share.createConfiguration({config: 'utConfig'});
                existsSpy.andReturn(true);
                cfgObject.ensurePaths();
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = share.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.pid', 'run')).toBe('ut/run/test.pid');
        });
    });

    describe('shareLink', function() {
        it('should exist', function() {
            expect(share.getVersion).toBeDefined();
        });
        
        it('should correctly return a link if not given an experience object', function() {
            var req = {
                uuid: 'abc123',
                body: {
                    origin: 'http://cinema6.com/#/experiences/ut'
                }
            };
            
            share.shareLink(req, null, function (err, url) {
                expect(err).toBeNull();
                expect(url).toBe('http://cinema6.com/#/experiences/ut');
            });
        });

        it('should fail if not given an origin url', function() {
            req = { uuid: 'abc123' };
            
            share.shareLink(req, null, function(err, url) {
                expect(err).toBeDefined('err');
                expect(url).not.toBeDefined();
            });
            
            req.body = {data: {id: 'e-1'}};
            share.shareLink(req, null, function(err, url) {
                expect(err).toBeDefined('err');
                expect(url).not.toBeDefined();                
            });
            
            expect(errorSpy.calls.length).toBe(2);
        });

        describe('tests with S3', function() {
            var config, req, uuidSpy;
                
            beforeEach(function() {
                uuidSpy = spyOn(include('../lib/uuid'), 'createUuid').andReturn('ut1'),
                config = {
                    s3: {
                        share: {
                            bucket: 'ut_bucket',
                            path: 'ut/'
                        }
                    }
                },
                req = {
                    uuid: 'abc123',
                    body: {
                        origin: 'http://cinema6.com/#/experiences/utApp~oldId',
                        data: {
                            id: 'oldId',
                            uri: 'utApp~oldId',
                            title: 'Test Experience'
                        }
                    }
                };
            });
                    
            it('should correctly upload an experience and return a link for it', function() {
                putObjSpy.andCallFake(function(params, cb) {
                    cb(null, 'Success!');
                });
                share.shareLink(req, config, function(err, url) {
                    expect(err).toBeNull();
                    expect(url).toBe('http://cinema6.com/#/experiences/shared~utApp~e-ut1');
                    
                    expect(putObjSpy).toHaveBeenCalled();
                    var putParams = putObjSpy.calls[0].args[0];
                    expect(putParams.Bucket).toBe('ut_bucket');
                    expect(putParams.Key).toBe('ut/e-ut1.json');
                    expect(putParams.ACL).toBe('public-read');
                    expect(putParams.ContentType).toBe('application/JSON');
                    
                    var modExp = JSON.parse(putParams.Body);
                    expect(modExp).toBeDefined();
                    expect(modExp.id).toBe('e-ut1');
                    expect(modExp.uri).toBe('shared~utApp~e-ut1');
                    expect(modExp.title).toBe('Test Experience');
                });
            });
            
            it('should handle S3 failures', function() {
                putObjSpy.andCallFake(function(params, cb) {
                    cb('Oh noes S3 broke', null);
                });
                
                share.shareLink(req, config, function(err, url) {
                    expect(putObjSpy).toHaveBeenCalled();
                    expect(err).toBe('Oh noes S3 broke');
                    expect(url).not.toBeDefined();
                });
            });
            
        });
    });
});

