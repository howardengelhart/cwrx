var include     = require('../lib/inject').require,
    path        = include('path'),
    fs          = include('fs-extra'),
    sanitize    = include('../test/sanitize'),
    cwrxConfig  = include('../lib/config');

describe('dub',function(){
    var rmList = [];
    var dub, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger, mockAws;
    
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
    
        dub = sanitize(['../bin/dub'])
                .andConfigure([['../lib/logger', mockLogger], ['aws-sdk', mockAws]])
                .andRequire();
    });

    afterEach(function(){
        rmList.forEach(function(removable){
            if (fs.existsSync(removable)){
                fs.removeSync(removable);
            }
        });
    });
    
    describe('getVersion', function() {
        var existsSpy, readFileSpy;
        
        beforeEach(function() {
            existsSpy = spyOn(fs, 'existsSync');
            readFileSpy = spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(dub.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(dub.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/dub.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/dub.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(dub.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/dub.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(dub.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/dub.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../bin/dub.version'));
        });
    });
    
    describe('createConfiguration', function() {
        var existsSpy, mkdirSpy, createConfig, mockConfig,
            program = {
                config: 'utConfig',
                enableAws: true
            };
        
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
            expect(dub.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = dub.createConfiguration(program);
            expect(createConfig).toHaveBeenCalledWith('utConfig', dub.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
            
            expect(cfgObject.caches.line).toBe('ut/line/');
            expect(cfgObject.caches.script).toBe('ut/script/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should throw an error if it can\'t load the s3 config', function() {
            mockAws.config.loadFromPath.andThrow('Exception!');
            expect(function() {dub.createConfiguration(program);}).toThrow();

            mockAws.config.loadFromPath.andReturn();
            delete mockConfig.s3;
            expect(function() {dub.createConfiguration(program);}).toThrow();
        });

        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = dub.createConfiguration(program);
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
                var cfgObject = dub.createConfiguration(program);
                existsSpy.andReturn(true);
                cfgObject.ensurePaths();
                expect(existsSpy.calls.length).toBe(2);
                expect(mkdirSpy).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = dub.createConfiguration(program);
            expect(cfgObject.cacheAddress('test.mp3', 'line')).toBe('ut/line/test.mp3');
        });
    });
    
    /*describe('job', function(){
        var config;
        beforeEach(function(){

            rmList.push(path.join(__dirname,'caches')); 
            rmList.push(path.join(__dirname,'tmpcfg.json'));
            
            fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),JSON.stringify({
                s3     : {
                    src : {
                        bucket : 'c6.dev',
                        path   : 'media/src/screenjack/video'
                    },
                    out : {
                        bucket : 'c6.dev',
                        path   : 'media/usr/screenjack/video'
                    }
                },
                output : {
                    uri : "https://s3.amazonaws.com/c6.dev/media/usr/screenjack/video/",
                    type : "s3"
                },
                caches : {
                    run     : path.join(__dirname,'caches/run/'),
                    line    : path.join(__dirname,'caches/line/'),
                    blanks  : path.join(__dirname,'caches/blanks/'),
                    script  : path.join(__dirname,'caches/script/'),
                    video   : path.join(__dirname,'caches/video/'),
                    output  : path.join(__dirname,'caches/output/')
                },
                tts : {
                    auth        : path.join(process.env.HOME,'.tts.json'),
                    bitrate     : '48k',
                    frequency   : 22050,
                    workspace   : __dirname
                }
            }));
            config = dub.createConfiguration(
                { config : path.join(__dirname,'tmpcfg.json')}
            );
            config.ensurePaths();
        });

        describe('createDubJob method', function(){
            var jobTemplate;
            
            it('should create a job with valid configuration and template', function(){
                var jobTemplate = dub.loadTemplateFromFile(path.join(__dirname,'dub_ut_job1.json')),
                    job = dub.createDubJob('123456',jobTemplate,config);
                expect(job).toBeDefined();
                expect(job.ttsAuth).toBeDefined();
                expect(job.tts).toEqual(config.tts);
                expect(job.tracks.length).toEqual(10);
                expect(job.enableAws()).toEqual(true);

                expect(job.scriptHash).toEqual(
                    '18ad78e66da8a3be711011f66ce4fd484fde3373'
                );
                expect(job.outputHash).toEqual(
                    'fdbc5df8ff9e246a5d4f70fac2f362afc80766c6'
                );
                expect(job.outputFname).toEqual(
                    'scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                
                expect(job.videoPath).toEqual(path.join(__dirname,'caches/video/scream.mp4'));
                expect(job.outputPath).toEqual(path.join(__dirname,
                    'caches/output/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4')
                );
                expect(job.outputUri).toEqual(
                    'https://s3.amazonaws.com/c6.dev/media/usr/screenjack/video/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                expect(job.outputType).toEqual('s3');

                var srcParams = job.getS3SrcVideoParams();
                expect(srcParams.Bucket).toEqual('c6.dev');
                expect(srcParams.Key).toEqual('media/src/screenjack/video/scream.mp4');

                var outParams = job.getS3OutVideoParams();
                expect(outParams.Bucket).toEqual('c6.dev');
                expect(outParams.Key).toEqual(
                    'media/usr/screenjack/video/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                expect(outParams.ACL).toEqual('public-read');
                expect(outParams.ContentType).toEqual('video/mp4');

                expect(job.hasVideoLength()).toBeFalsy();
                expect(job.hasOutput()).toBeFalsy();
                expect(job.hasScript()).toBeFalsy();
                expect(job.hasVideo()).toBeFalsy();
                
                var trackFnames = [
                    "678d97754d976dc300659e383da2d93418bdcce4.mp3",
                    "94b284a8b497078df74d05a60d129427526b9228.mp3",
                    "5acda92bba24e111a4b16ccbe0985302a755fedf.mp3",
                    "b4fbb1374001d7c51262a45c992586230dcf6c75.mp3",
                    "c2e4f267d36d372cf1a1d8a7f43479d43d1cd063.mp3",
                    "3101b6063061b820538f4675f80231abcb451946.mp3",
                    "b5884dc590c5159a633186bfb8e2de7e94733558.mp3",
                    "a32e8774e9d22404189c38a4bda97fbe2cd7b448.mp3",
                    "6e69b533aaa3084e6dae7e9932cf5da85ed427a6.mp3",
                    "752b567f55210732234ab7526022ba2fbc7b9ebc.mp3"
                ];
                job.tracks.forEach(function(track, index) {
                    expect(track.fname).toEqual(trackFnames[index]);
                });
            });

        }); // end -- describe createDubJob method

    });*/ // end -- describe job interface*/

}); // end -- describe dub

