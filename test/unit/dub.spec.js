var include     = require('../../lib/inject').require,
    path        = include('path'),
    fs          = include('fs-extra'),
    q           = include('q'),
    sanitize    = include('../test/sanitize'),
    cwrxConfig  = include('../lib/config'),
    s3util      = include('../lib/s3util'),
    vocalware   = include('../lib/vocalware');

describe('dub',function(){
    var dub, traceSpy, errorSpy, warnSpy, infoSpy, fatalSpy, logSpy, mockLogger, mockAws;
    
    beforeEach(function() {
        traceSpy    = jasmine.createSpy('log_trace');
        errorSpy    = jasmine.createSpy('log_error');
        warnSpy     = jasmine.createSpy('log_warn');
        infoSpy     = jasmine.createSpy('log_info');
        fatalSpy    = jasmine.createSpy('log_fatal');
        logSpy      = jasmine.createSpy('log_log');
        headObjSpy   = jasmine.createSpy('s3_headObj');
        
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
                    headObject: headObjSpy
                }
            }
        };
    
        dub = sanitize(['../bin/dub'])
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
            expect(dub.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            existsSpy.andReturn(true);
            readFileSpy.andReturn('ut123');
            
            expect(dub.getVersion()).toEqual('ut123');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/dub.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/dub.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            existsSpy.andReturn(false);
            expect(dub.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/dub.version'));
            expect(readFileSpy).not.toHaveBeenCalled();
            
            existsSpy.andReturn(true);
            readFileSpy.andThrow('Exception!');
            expect(dub.getVersion()).toEqual('unknown');
            expect(existsSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/dub.version'));
            expect(readFileSpy).toHaveBeenCalledWith(path.join(__dirname, '../../bin/dub.version'));
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
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
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
    
    describe('job:', function() {
        var configObject, config, mockTemplate, job, setStartTime, setEndTime,
            hasVideo, hasOutput, hasLength, hasScript, hasLines;
        
        beforeEach(function() {
            configObject = {
                s3     : {
                    src : {
                        bucket : 'ut',
                        path   : 'ut/media/video'
                    },
                    out : {
                        bucket : 'ut',
                        path   : 'ut/media/output'
                    },
                    auth: 'fake.aws.json',
                },
                output : {
                    uri : "https://s3.amazonaws.com/ut/media/output",
                    type : "s3"
                },
                caches : {
                    run     : 'caches/run/',
                    line    : 'caches/line/',
                    blanks  : 'caches/blanks/',
                    script  : 'caches/script/',
                    video   : 'caches/video/',
                    output  : 'caches/output/'
                },
                tts : {
                    auth        : 'fake.tts.json',
                    bitrate     : '48k',
                    frequency   : 22050,
                    workspace   : __dirname
                }
            };
            spyOn(cwrxConfig, 'createConfigObject').andReturn(configObject);
            config = dub.createConfiguration({});
            config.enableAws = true;
            
            mockTemplate = {
                video   : "test.mp4",
                script  : [
                    { "ts" : "1", "line" : "line1"},
                    { "ts" : "2.2", "line" : "line2"},
                    { "ts" : "3.3", "line" : "line3"},
                ]
            };
            spyOn(include('../lib/uuid'), 'hashText').andCallFake(function(txt) {
                if (txt.match(/^line\d/)) {
                    return 'hashLine--' + txt.match(/^line\d/);
                } else if (txt.match(/test\.mp4/)) {
                    return 'hashOutput';
                } else {
                    return 'hashScript';
                }
            });
            spyOn(vocalware, 'createAuthToken').andReturn('fakeAuthToken');
            job = dub.createDubJob('123456', mockTemplate, config);
            
            // track these calls and easily manipulate them later, but default is to call through
            setStartTime = spyOn(job, 'setStartTime').andCallThrough();
            setEndTime = spyOn(job, 'setEndTime').andCallThrough();
            hasVideo = spyOn(job, 'hasVideo').andCallThrough();
            hasOutput = spyOn(job, 'hasOutput').andCallThrough();
            hasLength = spyOn(job, 'hasVideoLength').andCallThrough();
            hasScript = spyOn(job, 'hasScript').andCallThrough();
            hasLines = spyOn(job, 'hasLines').andCallThrough();
        });

        describe('createDubJob method', function() { //TODO: test more stuff?
            it('should create a job with valid configuration and template', function(){
                expect(job).toBeDefined();
                expect(job.ttsAuth).toBe('fakeAuthToken');
                expect(job.tts).toEqual(config.tts);
                expect(job.tracks.length).toEqual(3);
                expect(job.enableAws()).toEqual(true);

                expect(job.scriptHash).toEqual('hashScript');
                expect(job.outputHash).toEqual('hashOutput');
                expect(job.outputFname).toEqual('test_hashOutput.mp4');
                expect(job.blanksPath).toEqual('caches/blanks/');
                
                expect(job.videoPath).toEqual('caches/video/test.mp4');
                expect(job.outputPath).toEqual('caches/output/test_hashOutput.mp4');
                expect(job.outputUri).toEqual('https://s3.amazonaws.com/ut/media/output/test_hashOutput.mp4');
                expect(job.outputType).toEqual('s3');

                var srcParams = job.getS3SrcVideoParams();
                expect(srcParams.Bucket).toEqual('ut');
                expect(srcParams.Key).toEqual('ut/media/video/test.mp4');

                var outParams = job.getS3OutVideoParams();
                expect(outParams.Bucket).toEqual('ut');
                expect(outParams.Key).toEqual('ut/media/output/test_hashOutput.mp4');
                expect(outParams.ACL).toEqual('public-read');
                expect(outParams.ContentType).toEqual('video/mp4');
                
                expect(job.videoMetadataPath).toEqual('caches/video/test_metadata.json');

                
                expect(job.hasVideoLength()).toBeFalsy();
                expect(job.hasOutput()).toBeFalsy();
                expect(job.hasScript()).toBeFalsy();
                expect(job.hasVideo()).toBeFalsy();
                
                var trackFnames = [
                    "hashLine--line1.mp3",
                    "hashLine--line2.mp3",
                    "hashLine--line3.mp3",
                ];
                job.tracks.forEach(function(track, index) {
                    expect(track.fname).toEqual(trackFnames[index]);
                    expect(track.fpath).toEqual('caches/line/' + trackFnames[index]);
                    expect(track.metaname).toEqual(trackFnames[index].replace('.mp3', '.json'));
                    expect(track.metapath).toEqual('caches/line/' + trackFnames[index].replace('.mp3', '.json'));
                });
            });
            
            it('should throw an error if the template has no script', function() {
                delete mockTemplate.script;
                expect(function() {dub.createDubJob('12345', mockTemplate, config);}).toThrow();
            });
            
            it('should create a working setStartTime method', function() {
                job.setStartTime('ut');
                expect(job.elapsedTimes['ut'].start instanceof Date).toBeTruthy();
            });
            
            it('should create a working setEndTime method', function() {
                spyOn(job, 'getElapsedTime').andReturn(1);
                
                job.elapsedTimes['ut'] = {};
                job.elapsedTimes['ut'].start = new Date();
                
                job.setEndTime('ut');
                expect(job.elapsedTimes['ut'].end instanceof Date).toBeTruthy();
                expect(job.getElapsedTime).toHaveBeenCalledWith('ut');
            });
            
            it('should create a working getElapsedTime method', function() {
                job.elapsedTimes['ut'] = {};
                job.elapsedTimes['ut'].start = new Date();
                job.elapsedTimes['ut'].end = new Date(job.elapsedTimes['ut'].start.valueOf() + 3000);
                
                expect(job.getElapsedTime('ut')).toEqual(3);
            });
        }); // end -- describe createDubJob method
        
        describe('handleRequest', function() { // TODO: fix this - seems like spying on module's functions doesn't affect internal versions of them
            var getSrc, convertLines, collectMeta, vidLength, convertScript, applyScript, upload, a,
                doneFlag = false;
            
            beforeEach(function() {
                /*getSrc         = spyOn(dub, 'getSourceVideo').andReturn(q(job));
                convertLines   = spyOn(dub, 'convertLinesToMP3').andReturn(q(job));
                collectMeta    = spyOn(dub, 'collectLinesMetadata').andReturn(q(job));
                vidLength      = spyOn(dub, 'getVideoLength').andReturn(q(job));
                convertScript  = spyOn(dub, 'convertScriptToMP3').andReturn(q(job));
                applyScript    = spyOn(dub, 'applyScriptToVideo').andReturn(q(job));
                upload         = spyOn(dub, 'uploadToStorage').andReturn(q(job));*/
            });
            
            it('should correctly call each function', function() {
                /*runs(function() {
                    dub.handleRequest(job, function(err, job) {
                        expect(err).toBeNull();
                        expect(setStartTime).toHaveBeenCalledWith('handleRequest');
                        expect(getSrc).toHaveBeenCalledWith(job);
                        expect(convertLines).toHaveBeenCalledWith(job);
                        expect(collectMeta).toHaveBeenCalledWith(job);
                        expect(vidLength).toHaveBeenCalledWith(job);
                        expect(convertScript).toHaveBeenCalledWith(job);
                        expect(applyScript).toHaveBeenCalledWith(job);
                        expect(upload).toHaveBeenCalledWith(job);
                        expect(setEndTime).toHaveBeenCalledWith('handleRequest');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);*/
            });
        });
        
        describe('getSourceVideo', function() {
            var getObjSpy, doneFlag;
            
            beforeEach(function() {
                getObjSpy = spyOn(s3util, 'getObject');
                doneFlag = false;
            });
                        
            it('should correctly upload a video', function() {
                getObjSpy.andReturn(q());
                spyOn(job, 'getS3SrcVideoParams').andReturn('s3SrcParams');
                runs(function() {
                    dub.getSourceVideo(job).done(function(retval) {
                        expect(retval).toBe(job);
                        expect(getObjSpy).toHaveBeenCalled();
                        var spyArgs = getObjSpy.calls[0].args;
                        expect(spyArgs[1]).toEqual('s3SrcParams');
                        expect(spyArgs[2]).toEqual('caches/video/test.mp4');
                        expect(setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(setEndTime).toHaveBeenCalledWith('getSourceVideo');                        
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should handle errors from s3util', function() {
                getObjSpy.andReturn(q.reject('Rejected!'));
                runs(function() {
                    dub.getSourceVideo(job).catch(function(error) {
                        expect(error).toEqual({fnName: 'getSourceVideo', msg: 'Rejected!'});
                        expect(setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(setEndTime).toHaveBeenCalledWith('getSourceVideo');                        
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
            
            it('should skip if the source or output already exists', function() {
                hasVideo.andReturn(true);
                runs(function() {
                    dub.getSourceVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        hasVideo.andReturn(false);
                        hasOutput.andReturn(true);
                        return retval;
                    }).then(dub.getSourceVideo(job)).done(function(retval) {
                        expect(retval).toBe(job);
                        expect(getObjSpy).not.toHaveBeenCalled();
                        expect(setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
                        
            it('should reject with an error if aws is not enabled', function() {
                spyOn(job, 'enableAws').andReturn(false);
                runs(function() {
                    dub.getSourceVideo(job).catch(function(error) {
                        expect(error).toBeDefined();
                        expect(getObjSpy).not.toHaveBeenCalled();
                        expect(setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(setEndTime).toHaveBeenCalledWith('getSourceVideo');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
        });
        
        describe('convertLinesToMP3', function() {
        
        });

        describe('collectLinesMetadata', function() {
        
        });

        describe('getVideoLength', function() {
        
        });

        describe('convertScriptToMP3', function() {
        
        });

        describe('applyScriptToVideo', function() {
        
        });
        
        describe('uploadToStorage', function() {
        
        });

    }); // end -- describe job interface*/

}); // end -- describe dub

