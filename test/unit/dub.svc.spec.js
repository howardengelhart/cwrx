var flush = true;
describe('dub (UT)',function(){
    var dub, mockLog, mockLogger, mockAws, mockVware, mockAssemble, mockId3, mockHostname,
        path, fs, q, crypto, request, cwrxConfig, uuid, hostname, ffmpeg, sanitize, s3util;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        jasmine.getEnv().defaultTimeoutInterval = 3000;

        path        = require('path');
        fs          = require('fs-extra');
        q           = require('q');
        crypto      = require('crypto');
        request     = require('request');
        cwrxConfig  = require('../../lib/config');
        uuid        = require('../../lib/uuid');
        hostname    = require('../../lib/hostname');
        ffmpeg      = require('../../lib/ffmpeg');
        sanitize    = require('../sanitize');
        s3util      = require('../../lib/s3util');

        headObjSpy = jasmine.createSpy('s3_headObj');
        
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
        mockAws = {
            config: {
                loadFromPath: jasmine.createSpy('aws_config_loadFromPath')
            },
            S3: function() {
                return {};
            }
        };
        mockVware = {
            createAuthToken: jasmine.createSpy('vw_create_auth_token'),
            createRequest: jasmine.createSpy('vw_create_request'),
            textToSpeech: jasmine.createSpy('vw_tts'),
            voices: {
                'Allison': 'fakeVoiceAllison'
            }
        };
        mockAssemble = jasmine.createSpy('assemble');
        mockId3 = jasmine.createSpy('id3Info');
        mockHostname = jasmine.createSpy('hostname').andReturn(q('fakeHost'));

        dub = sanitize(['../bin/dub'])
                .andConfigure([['../lib/logger', mockLogger],   ['aws-sdk', mockAws],
                               ['../lib/vocalware', mockVware], ['../lib/assemble', mockAssemble],
                               ['../lib/id3', mockId3], ['../lib/hostname', mockHostname]])
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
        
        it('should correctly setup the config object', function(done) {
            dub.createConfiguration(program).then(function(cfgObject) {
                expect(createConfig).toHaveBeenCalledWith('utConfig', dub.defaultConfiguration);
                expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
                expect(mockAws.config.loadFromPath).toHaveBeenCalledWith('fakeAuth.json');
                
                expect(cfgObject.caches.line).toBe('ut/line/');
                expect(cfgObject.caches.script).toBe('ut/script/');
                expect(cfgObject.ensurePaths).toBeDefined();
                expect(cfgObject.cacheAddress).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if it cannot load the s3 config', function(done) {
            mockAws.config.loadFromPath.andThrow('Exception!');
            dub.createConfiguration(program).catch(function(error) {
                expect(error).toBeDefined();
                
                mockAws.config.loadFromPath.andReturn();
                delete mockConfig.s3;
                return dub.createConfiguration(program);
            }).catch(function(error) {
                expect(error).toBeDefined();
                done();
            });
        });

        describe('ensurePaths method', function() {
            it('should create directories if needed', function(done) {
                dub.createConfiguration(program).then(function(cfgObject) {
                    existsSpy.andReturn(false);
                    cfgObject.ensurePaths();
                    expect(existsSpy.calls.length).toBe(2);
                    expect(mkdirSpy.calls.length).toBe(2);
                    expect(existsSpy).toHaveBeenCalledWith('ut/line/');
                    expect(mkdirSpy).toHaveBeenCalledWith('ut/line/');
                    expect(existsSpy).toHaveBeenCalledWith('ut/script/');
                    expect(mkdirSpy).toHaveBeenCalledWith('ut/script/');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });
            
            it('should not create directories if they exist', function(done) {
                dub.createConfiguration(program).then(function(cfgObject) {
                    existsSpy.andReturn(true);
                    cfgObject.ensurePaths();
                    expect(existsSpy.calls.length).toBe(2);
                    expect(mkdirSpy).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });
        });
        
        it('should create a working cacheAddress method', function(done) {
            dub.createConfiguration(program).then(function(cfgObject) {
                expect(cfgObject.cacheAddress('test.mp3', 'line')).toBe('ut/line/test.mp3');
                expect(cfgObject.cacheAddress('script.mp3', 'script')).toBe('ut/script/script.mp3');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('job:', function() {
        var configObject, config, mockTemplate, job,
            doneFlag = false;
        
        beforeEach(function(done) {
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
                proxyTimeout: 5000,
                responseTimeout: 1000,
                caches : {
                    run     : 'caches/run/',
                    line    : 'caches/line/',
                    blanks  : 'caches/blanks/',
                    script  : 'caches/script/',
                    video   : 'caches/video/',
                    output  : 'caches/output/',
                    jobs    : 'caches/jobs/'
                },
                tts : {
                    voice       : "Allison",
                    effect      : "R",
                    level       : "3",
                    auth        : 'fake.tts.json',
                    bitrate     : '48k',
                    frequency   : 22050,
                    workspace   : __dirname
                }
            };
            spyOn(cwrxConfig, 'createConfigObject').andReturn(configObject);
            
            mockTemplate = {
                video   : "test.mp4",
                script  : [
                    { "ts" : "1", "line" : "line1"},
                    { "ts" : "2.2", "line" : "line2"},
                    { "ts" : "3.3", "line" : "line3"},
                ]
            };
            spyOn(uuid, 'hashText').andCallFake(function(txt) {
                if (txt.match(/^line\d/)) {
                    return 'hashLine--' + txt.match(/^line\d/);
                } else if (txt.match(/test\.mp4/)) {
                    return 'hashOutput';
                } else {
                    return 'hashScript';
                }
            });
            spyOn(dub, 'updateJobStatus');
            
            doneFlag = false; // used for all async functions
            
            mockVware.createAuthToken.andReturn('fakeAuthToken');
            
            dub.createConfiguration({}).done(function(cfgObject) {
                config = cfgObject;
                config.enableAws = true;
            
                job = dub.createDubJob('123456', mockTemplate, config);
                job.jobFilePath = 'ut-job.json';
                
                // track these calls and easily manipulate them later, but default is to call through
                spyOn(job, 'setStartTime').andCallThrough();
                spyOn(job, 'setEndTime').andCallThrough();
                spyOn(job, 'hasVideo').andCallThrough();
                spyOn(job, 'hasOutput').andCallThrough();
                spyOn(job, 'hasVideoLength').andCallThrough();
                spyOn(job, 'hasScript').andCallThrough();
                spyOn(job, 'hasLines').andCallThrough();
                done();
            });
        });
        
        describe('createJobFile', function() {
            beforeEach(function() {
                spyOn(fs, 'writeJsonSync');
            });
            
            it('should write information to a job file and return its path', function() {
                fs.writeJsonSync.andReturn();
                var now = new Date().valueOf();
                dub.createJobFile(job, config);
                expect(job.jobFilePath).toBe('caches/jobs/job_123456.json');
                expect(fs.writeJsonSync).toHaveBeenCalled();
                expect(fs.writeJsonSync.calls[0].args[0]).toBe('caches/jobs/job_123456.json');
                
                var data = fs.writeJsonSync.calls[0].args[1] || {};
                expect(data.jobId).toBe('123456');
                expect(Math.abs(data.createTime - now)).toBeLessThan(50);
                expect(Math.abs(data.lastUpdateTime - now)).toBeLessThan(50);
                expect(data.lastStatus).toBeDefined();
                expect(data.lastStatus.code).toBe(202);
                expect(data.lastStatus.step).toBe('Initialization');
                expect(data.resultFile).toBe('test_hashOutput.mp4');
                expect(data.resultUrl).toBe('https://s3.amazonaws.com/ut/media/output/test_hashOutput.mp4');
                expect(data.resultMD5).not.toBeDefined();
            });
            
            it('should log an error if it fails to write to the file', function() {
                fs.writeJsonSync.andCallFake(function() {
                    throw new Error("Error!");
                });
                expect(function() {dub.createJobFile(job, config);}).not.toThrow();
                expect(mockLog.error).toHaveBeenCalled();
            });
        });
        
        describe('updateJobStatus', function() {
            var start = new Date().valueOf(),
                jobFile;
            
            beforeEach(function() {
                jobFile = {
                    jobId: '123456',
                    createTime: start,
                    lastUpdateTime: start,
                    lastStatus: {
                        code: 202,
                        step: 'Initialization'
                    },
                    resultFile: 'resultFile.mp4',
                    resultUrl: 'http://resultUrl.com'
                };
                dub.updateJobStatus.andCallThrough();
                spyOn(fs, 'readJsonSync').andReturn(jobFile);
                spyOn(fs, 'writeJsonSync').andReturn();
            });
            
            it('should update the lastStatus in the job file', function() {
                expect(function() {dub.updateJobStatus(job, 111, 'UnitTest');}).not.toThrow();
                expect(fs.readJsonSync).toHaveBeenCalled();
                expect(fs.readJsonSync).toHaveBeenCalledWith('ut-job.json');
                expect(fs.writeJsonSync).toHaveBeenCalledWith('ut-job.json', jobFile);
                
                expect(jobFile.lastStatus.code).toBe(111);
                expect(jobFile.lastStatus.step).toBe('UnitTest');
                expect(jobFile.lastUpdateTime).toBeGreaterThan(jobFile.createTime);
            });
            
            it('should be able to copy over arbitrary JSON data passed to it', function() {
                var data = {
                    resultMD5: 'fakeMD5',
                    resultFile: 'newFile.mp4'
                };
                expect(function() {dub.updateJobStatus(job, 111, 'UnitTest', data);}).not.toThrow();
                expect(fs.readJsonSync).toHaveBeenCalled();
                expect(fs.readJsonSync).toHaveBeenCalledWith('ut-job.json');
                expect(fs.writeJsonSync).toHaveBeenCalledWith('ut-job.json', jobFile);
                    
                expect(jobFile.lastStatus.code).toBe(111);
                expect(jobFile.lastStatus.step).toBe('UnitTest');
                expect(jobFile.lastUpdateTime).toBeGreaterThan(jobFile.createTime);
                expect(jobFile.resultMD5).toBe('fakeMD5');
                expect(jobFile.resultFile).toBe('newFile.mp4');
            });
            
            it('should handle failures from reading and parsing the file', function() {
                fs.readJsonSync.andCallFake(function(fname) {
                    throw new Error("Error!");
                });
                expect(function() {dub.updateJobStatus(job, 111, 'UnitTest');}).not.toThrow();
                expect(fs.readJsonSync).toHaveBeenCalled();
                expect(fs.writeJsonSync).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            });
            
            it('should pass along failures from writing the file', function() {
                fs.writeJsonSync.andCallFake(function(fname, obj) {
                    throw new Error('Error!');
                });
                expect(function() {dub.updateJobStatus(job, 111, 'UnitTest');}).not.toThrow();
                expect(fs.readJsonSync).toHaveBeenCalled();
                expect(fs.writeJsonSync).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            });
            
            it('should skip if the job file was never created', function() {
                delete job.jobFilePath;
                expect(function() {dub.updateJobStatus(job, 111, 'UnitTest');}).not.toThrow();
                expect(fs.readJsonSync).not.toHaveBeenCalled();
                expect(fs.writeJsonSync).not.toHaveBeenCalled();
            });
        });

        describe('createDubJob', function() {
            it('should create a job with valid configuration and template', function(){
                expect(job).toBeDefined();
                expect(job.id).toBe('123456');
                expect(job.version).toBe(1);
                
                expect(job.ttsAuth).toBe('fakeAuthToken');
                expect(job.tts).toEqual(config.tts);
                expect(job.tracks.length).toEqual(3);
                expect(job.enableAws()).toEqual(true);

                expect(job.scriptHash).toEqual('hashScript');
                expect(job.scriptFname).toEqual('test_hashScript.mp3');
                expect(job.scriptPath).toEqual('caches/script/test_hashScript.mp3');
                
                expect(job.videoPath).toEqual('caches/video/test.mp4');
                expect(job.blanksPath).toEqual('caches/blanks/');
                
                expect(job.outputHash).toEqual('hashOutput');
                expect(job.outputFname).toEqual('test_hashOutput.mp4');
                expect(job.outputPath).toEqual('caches/output/test_hashOutput.mp4');
                expect(job.outputUri).toEqual('https://s3.amazonaws.com/ut/media/output/test_hashOutput.mp4');
                expect(job.outputType).toEqual('s3');

                var srcParams = job.getS3SrcVideoParams();
                expect(srcParams.Bucket).toEqual('ut');
                expect(srcParams.Key).toEqual('ut/media/video/test.mp4');

                var outParams = job.getS3OutParams();
                expect(outParams.Bucket).toEqual('ut');
                expect(outParams.Key).toEqual('ut/media/output/test_hashOutput.mp4');
                expect(outParams.ACL).toEqual('public-read');
                expect(outParams.ContentType).toEqual('video/mp4');
                
                expect(job.videoMetadataPath).toEqual('caches/video/test_mp4_metadata.json');
                
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
            
            it('should create a working assembleTemplate method', function() {
                expect(job.assembleTemplate).toBeDefined();
                job.videoMetadata = {duration: 3.5};
                job.tracks.forEach(function(track, i) {
                    track.metaData = "meta" + (i + 1);
                });
                var tmpl = job.assembleTemplate();
                
                expect(tmpl.id).toBe('123456');
                expect(tmpl.duration).toBe(3.5);
                expect(tmpl.bitrate).toBe('48k');
                expect(tmpl.frequency).toBe(22050);
                expect(tmpl.output).toBe('caches/script/test_hashScript.mp3');
                expect(tmpl.blanks).toBe('caches/blanks/');
                
                var playlist = [
                    { "ts" : 1,   "src" : "caches/line/hashLine--line1.mp3", "metaData": "meta1"},
                    { "ts" : 2.2, "src" : "caches/line/hashLine--line2.mp3", "metaData": "meta2"},
                    { "ts" : 3.3, "src" : "caches/line/hashLine--line3.mp3", "metaData": "meta3"}
                ];
                tmpl.playList.forEach(function(track, i) {
                    expect(track.ts).toEqual(playlist[i].ts);
                    expect(track.src).toEqual(playlist[i].src);
                    expect(track.metaData).toEqual(playlist[i].metaData);
                });
            });
        });

        describe('startCreateJob', function() {
            var headSpy, timerCallback;
            beforeEach(function() {
                jasmine.Clock.useMock();
                spyOn(dub, 'handleRequest');
                spyOn(dub, 'handleTrackRequest');
                timerCallback = jasmine.createSpy('timer_callback');
                headSpy = jasmine.createSpy('s3_head_obj');
                mockAws.S3 = function() {
                    return {headObject: headSpy};
                };
            });
            
            it('should respond with the video\'s url if it exists', function(done) {
                headSpy.andCallFake(function(params, cb) {
                    setTimeout(function() {
                        timerCallback();
                        cb(null, {ETag: 'fakeMD5'});
                    }, 500);
                });
                
                var promise = dub.startCreateJob(job, config);
                jasmine.Clock.tick(500);
                promise.then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(201);
                    expect(resp.data.output).toBe('https://s3.amazonaws.com/ut/media/output/test_hashOutput.mp4');
                    expect(resp.data.md5).toBe('fakeMD5');
                    
                    expect(timerCallback).toHaveBeenCalled();
                    expect(JSON.stringify(headSpy.calls[0].args[0])).toBe(
                        JSON.stringify({Key: 'ut/media/output/test_hashOutput.mp4', Bucket: 'ut'}));
                    expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 201, 'Completed', {resultMD5: 'fakeMD5'});
                    expect(dub.handleRequest).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should start handleRequest if the video does not exist', function(done) {
                headSpy.andCallFake(function(params, cb) {
                    setTimeout(function() {
                        timerCallback();
                        cb('No such video!');
                    }, 500);
                });
                
                var promise = dub.startCreateJob(job, config);
                jasmine.Clock.tick(500);
                promise.then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(202);
                    expect(resp.data.jobId).toBe('123456');
                    expect(resp.data.host).toBe('fakeHost');
                    expect(dub.handleRequest).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should call handleTrackRequest for a track conversion job', function(done) {
                headSpy.andCallFake(function(params, cb) {
                    setTimeout(function() {
                        timerCallback();
                        cb('No such video!');
                    }, 500);
                });
                job.trackConversion = true;
                
                var promise = dub.startCreateJob(job, config);
                jasmine.Clock.tick(500);
                promise.then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(dub.handleTrackRequest).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should respond quickly through a timeout if s3.headObject takes too long', function(done) {
                headSpy.andCallFake(function(params, cb) {
                    setTimeout(function() {
                        timerCallback();
                        cb(null, {ETag: 'fakeMD5'});
                    }, 1500);
                });
                
                var promise = dub.startCreateJob(job, config);
                jasmine.Clock.tick(1000);
                promise.then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(202);
                    expect(resp.data.jobId).toBe('123456');
                    expect(resp.data.host).toBe('fakeHost');
                    expect(timerCallback).not.toHaveBeenCalled();
                    
                    jasmine.Clock.tick(500);
                    expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 201, 'Completed', {resultMD5: 'fakeMD5'});
                    expect(dub.handleRequest).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should handle errors from handleRequest', function(done) {
                headSpy.andCallFake(function(params, cb) {
                    setTimeout(function() {
                        timerCallback();
                        cb('No such video!');
                    }, 500);
                });
                dub.handleRequest.andCallFake(function(job, cb) {
                    cb('Error!');
                });
                
                var promise = dub.startCreateJob(job, config);
                jasmine.Clock.tick(500);
                promise.then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(202);
                    expect(resp.data.jobId).toBe('123456');
                    expect(resp.data.host).toBe('fakeHost');
                    
                    expect(dub.handleRequest).toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
        });
        
        describe('getStatus', function() {
            describe('with matched hosts', function() {
                beforeEach(function() {
                    spyOn(fs, 'readJson');
                });
                
                it('should successfully read the status from the file', function(done) {
                    fs.readJson.andCallFake(function(fpath, cb) {
                        cb(null, {
                            lastStatus: {code: 201},
                            resultUrl: 'http://fake.com',
                            resultMD5: 'fakeMD5'
                        });
                    });
                    
                    dub.getStatus('123456', 'fakeHost', config)
                    .then(function(resp) {
                        expect(resp).toBeDefined();
                        expect(resp.code).toBe(201);
                        expect(JSON.stringify(resp.data.lastStatus)).toBe(JSON.stringify({code: 201}));
                        expect(resp.data.jobId).toBe('123456');
                        expect(resp.data.output).toBe('http://fake.com');
                        expect(resp.data.md5).toBe('fakeMD5');
                        
                        expect(fs.readJson).toHaveBeenCalled();
                        expect(fs.readJson.calls[0].args[0]).toBe('caches/jobs/job_123456.json');
                        done();
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        done();
                    });
                });
            
                it('should handle failures to read + parse the file', function(done) {
                    fs.readJson.andCallFake(function(fpath, cb) {
                        cb('Error!');
                    });
                    
                    dub.getStatus('123456', 'fakeHost', config)
                    .catch(function(error) {
                        expect(error).toBe('Error!');
                        expect(fs.readJson).toHaveBeenCalled();
                        done();
                    });
                });
                
                it('should fail if lastStatus is missing from the file', function(done) {
                    fs.readJson.andCallFake(function(fpath, cb) {
                        cb(null, {foo: 'bar'});
                    });
                    
                    dub.getStatus('123456', 'fakeHost', config)
                    .catch(function(error) {
                        expect(error).toBe('missing or malformed lastStatus in job file');
                        expect(fs.readJson).toHaveBeenCalled();
                        done();
                    });
                });
                
                it('should fail if the lastStatus code is missing from the file', function(done) {
                    fs.readJson.andCallFake(function(fpath, cb) {
                        cb(null, {lastStatus: {step: 'foo'}});
                    });
                    
                    dub.getStatus('123456', 'fakeHost', config)
                    .catch(function(error) {
                        expect(error).toBe('missing or malformed lastStatus in job file');
                        expect(fs.readJson).toHaveBeenCalled();
                        done();
                    });
                });
            });
            
            describe('with unmatched hosts', function() {
                var timerCallback;
                beforeEach(function() {
                    jasmine.Clock.useMock();
                    spyOn(request, 'get');
                    timerCallback = jasmine.createSpy('timer_callback');
                });
                
                it('should successfully proxy the request', function(done) {
                    request.get.andCallFake(function(url, cb) {
                        setTimeout(function() {
                            timerCallback();
                            cb(null, {statusCode: 201}, 'fakeBody');
                        }, 1000);
                    });
                    
                    var promise = dub.getStatus('123456', 'differentHost', config);
                    jasmine.Clock.tick(1000)
                    promise.then(function(resp) {
                        expect(resp).toBeDefined();
                        expect(resp.code).toBe(201);
                        expect(resp.data).toBe('fakeBody');
                        
                        expect(timerCallback).toHaveBeenCalled();
                        expect(request.get).toHaveBeenCalled();
                        expect(request.get.calls[0].args[0])
                            .toBe('http://differentHost/dub/status/123456?host=differentHost&proxied=true');
                        done();
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        done();
                    });
                });
                
                it('should use a different url if the jobId is a track job', function(done) {
                    request.get.andCallFake(function(url, cb) {
                        setTimeout(function() {
                            timerCallback();
                            cb(null, {statusCode: 201}, 'fakeBody');
                        }, 1000);
                    });
                    
                    var promise = dub.getStatus('t-123456', 'differentHost', config);
                    jasmine.Clock.tick(1000)
                    promise.then(function(resp) {
                        expect(resp).toBeDefined();
                        expect(resp.code).toBe(201);
                        expect(resp.data).toBe('fakeBody');
                        
                        expect(timerCallback).toHaveBeenCalled();
                        expect(request.get).toHaveBeenCalled();
                        expect(request.get.calls[0].args[0])
                            .toBe('http://differentHost/dub/track/status/t-123456?host=differentHost&proxied=true');
                        done();
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        done();
                    });
                });
                
                it('should handle failures from the proxied host', function(done) {
                    request.get.andCallFake(function(url, cb) {
                        setTimeout(function() {
                            timerCallback();
                            cb(null, {statusCode: 500}, {error: 'Error!'});
                        }, 1000);
                    });
                    
                    var promise = dub.getStatus('123456', 'differentHost', config);
                    jasmine.Clock.tick(1000)
                    promise.then(function(resp) {
                        expect(resp).toBeDefined();
                        expect(resp.code).toBe(500);
                        expect(JSON.stringify(resp.data.detail)).toBe(JSON.stringify({error: 'Error!'}));
                        expect(timerCallback).toHaveBeenCalled();
                        done();
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        done();
                    });
                });
                
                it('should timeout if the host takes too long', function(done) {
                    request.get.andCallFake(function(url, cb) {
                        setTimeout(function() {
                            timerCallback();
                            cb(null, {statusCode: 500}, {error: 'Error!'});
                        }, 5100);
                    });
                    
                    var promise = dub.getStatus('123456', 'differentHost', config);
                    jasmine.Clock.tick(5000)
                    promise.then(function(resp) {
                        expect(resp).toBeDefined();
                        expect(resp.code).toBe(504);
                        expect(resp.data.detail).toBe('Timed out while proxying request');
                        expect(request.get).toHaveBeenCalled();
                        expect(timerCallback).not.toHaveBeenCalled();
                        done();
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        done();
                    });
                });
            });
        });
        
        describe('handleRequest', function() {
            var getSrc, convertLines, collectMeta, vidLength, convertScript, applyScript, upload;
            
            beforeEach(function() {
                getSrc         = spyOn(dub, 'getSourceVideo').andReturn(q(job));
                convertLines   = spyOn(dub, 'convertLinesToMP3').andReturn(q(job));
                collectMeta    = spyOn(dub, 'collectLinesMetadata').andReturn(q(job));
                vidLength      = spyOn(dub, 'getVideoLength').andReturn(q(job));
                convertScript  = spyOn(dub, 'convertScriptToMP3').andReturn(q(job));
                applyScript    = spyOn(dub, 'applyScriptToVideo').andReturn(q(job));
                upload         = spyOn(dub, 'uploadToStorage').andReturn(q(job));
            });
            
            it('should correctly call each function', function(done) {
                job.md5 = 'fakeMD5';
                dub.handleRequest(job, function(err, job) {
                    expect(err).toBeNull();
                    expect(job.setStartTime).toHaveBeenCalledWith('handleRequest');
                    expect(getSrc).toHaveBeenCalledWith(job);
                    expect(convertLines).toHaveBeenCalledWith(job);
                    expect(collectMeta).toHaveBeenCalledWith(job);
                    expect(vidLength).toHaveBeenCalledWith(job);
                    expect(convertScript).toHaveBeenCalledWith(job);
                    expect(applyScript).toHaveBeenCalledWith(job);
                    expect(upload).toHaveBeenCalledWith(job);
                    
                    expect(job.setEndTime).toHaveBeenCalledWith('handleRequest');
                    expect(dub.updateJobStatus).toHaveBeenCalledWith(
                        job, 201, 'Completed', {resultMD5: 'fakeMD5'});
                    done();
                });
            });
            
            it('should halt and fail if any function dies', function() {
                convertScript.andReturn(q.reject({fnName: 'convertScriptToMP3', msg: 'Died!'}));
                dub.handleRequest(job, function(err, job) {
                    expect(err).toBeDefined();
                    expect(job.setStartTime).toHaveBeenCalledWith('handleRequest');
                    expect(getSrc).toHaveBeenCalledWith(job);
                    expect(convertLines).toHaveBeenCalledWith(job);
                    expect(collectMeta).toHaveBeenCalledWith(job);
                    expect(vidLength).toHaveBeenCalledWith(job);
                    expect(convertScript).toHaveBeenCalledWith(job);
                    
                    expect(applyScript).not.toHaveBeenCalled();
                    expect(upload).not.toHaveBeenCalled();
                    
                    expect(job.setEndTime).toHaveBeenCalledWith('handleRequest');
                    expect(dub.updateJobStatus).toHaveBeenCalledWith(
                        job, 500, 'convertScriptToMP3', {failMsg: 'Died!'});
                    done();
                });
            });
        });
        
        describe('getSourceVideo', function() {
            var getObjSpy;
            
            beforeEach(function() {
                getObjSpy = spyOn(s3util, 'getObject');
            });
            
            it('should skip if the source or output already exists', function() {
                job.hasVideo.andReturn(true);
                runs(function() {
                    dub.getSourceVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasVideo.andReturn(false);
                        job.hasOutput.andReturn(true);
                        return retval;
                    }).then(dub.getSourceVideo(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(getObjSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
                        
            it('should reject with an error if aws is not enabled', function() {
                spyOn(job, 'enableAws').andReturn(false);
                runs(function() {
                    dub.getSourceVideo(job).catch(function(error) {
                        expect(error.fnName).toBe('getSourceVideo');
                        expect(getObjSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getSourceVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('getSourceVideo');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
            
            it('should correctly upload a video', function() {
                getObjSpy.andReturn(q());
                spyOn(job, 'getS3SrcVideoParams').andReturn('s3SrcParams');
                runs(function() {
                    dub.getSourceVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(getObjSpy).toHaveBeenCalled();
                        var spyArgs = getObjSpy.calls[0].args;
                        expect(spyArgs[1]).toEqual('s3SrcParams');
                        expect(spyArgs[2]).toEqual('caches/video/test.mp4');
                        expect(job.setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getSourceVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('getSourceVideo');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should handle errors from s3util', function() {
                getObjSpy.andReturn(q.reject('Rejected!'));
                runs(function() {
                    dub.getSourceVideo(job).catch(function(error) {
                        expect(error.fnName).toBe('getSourceVideo');
                        expect(job.setStartTime).toHaveBeenCalledWith('getSourceVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getSourceVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('getSourceVideo');                        
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
        });
        
        describe('convertLinesToMP3', function() {
            var mockSay;
            
            beforeEach(function() {
                mockSay = jasmine.createSpy('vw_rqs_say');
                mockVware.createRequest.andReturn({ say: mockSay });            
            });
            
            it('should skip if the output, script, or lines already exist', function() {
                job.hasOutput.andReturn(true);
                runs(function() {
                    dub.convertLinesToMP3(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasOutput.andReturn(false);
                        job.hasLines.andReturn(true);
                        return retval;
                    }).then(dub.convertLinesToMP3(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasLines.andReturn(false);
                        job.hasScript.andReturn(true);
                        return retval;
                    }).then(dub.convertLinesToMP3(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockVware.createRequest).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should convert each line to speech', function() {
                mockVware.textToSpeech.andCallFake(function(rqs, fpath, cb) {
                    cb(null, rqs, null);
                });
                runs(function() {
                    dub.convertLinesToMP3(job).then(function(retval) {
                        expect(retval).toBe(job);
                        for (var i = 0; i < mockTemplate.script.length; i++) {
                            expect(mockVware.createRequest.calls[i].args[0]).toEqual({authToken: 'fakeAuthToken'});
                            expect(mockSay.calls[i].args[0]).toBe('line' + (i + 1));
                            expect(mockSay.calls[i].args[1]).toBe('fakeVoiceAllison');
                            
                            var ttsArgs = mockVware.textToSpeech.calls[i].args;
                            expect(ttsArgs[1]).toBe("caches/line/hashLine--line" + (i + 1) + ".mp3");
                            expect(ttsArgs[0].fxType).toBe('R');
                            expect(ttsArgs[0].fxLevel).toBe('3');
                        }
                        expect(job.setStartTime).toHaveBeenCalledWith('convertLinesToMP3');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'convertLinesToMP3');
                        expect(job.setEndTime).toHaveBeenCalledWith('convertLinesToMP3');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });

            it('should retry once per track for a failed conversion', function() {
                var failed = {};
                mockVware.textToSpeech.andCallFake(function(rqs, fpath, cb) {
                    if (!failed[fpath]) {
                        failed[fpath] = true;
                        cb('Failing this once', rqs, null);
                    } else {
                        cb(null, rqs, null);
                    }
                });
                runs(function() {
                    dub.convertLinesToMP3(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockLog.error.calls.length).toBe(3);
                        expect(job.setStartTime).toHaveBeenCalledWith('convertLinesToMP3');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'convertLinesToMP3');
                        expect(job.setEndTime).toHaveBeenCalledWith('convertLinesToMP3');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should fail if even one track fails to convert', function() {
                mockVware.textToSpeech.andCallFake(function(rqs, fpath, cb) {
                    if (fpath.match(/line2/)) {
                        cb('Failing this one', rqs, null);
                    } else {
                        cb(null, rqs, null);
                    }
                });
                runs(function() {
                    dub.convertLinesToMP3(job).catch(function(error) {
                        expect(error.fnName).toBe('convertLinesToMP3');
                        expect(error.msg).toBe('Failing this one');
                        expect(mockLog.error.calls.length).toBe(2);
                        expect(job.setStartTime).toHaveBeenCalledWith('convertLinesToMP3');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'convertLinesToMP3');
                        expect(job.setEndTime).toHaveBeenCalledWith('convertLinesToMP3');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });

        describe('collectLinesMetadata', function() {
            var getLineMeta;
            
            beforeEach(function() {
                getLineMeta = spyOn(dub, 'getLineMetadata');
            });
            
            it('should skip if the script or output already exists', function() {
                job.hasScript.andReturn(true);
                runs(function() {
                    dub.collectLinesMetadata(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasScript.andReturn(false);
                        job.hasOutput.andReturn(true);
                        return retval;
                    }).then(dub.collectLinesMetadata(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(getLineMeta).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should call getLineMetadata for each track', function() {
                getLineMeta.andReturn(q());
                
                runs(function() {
                    dub.collectLinesMetadata(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(getLineMeta.calls.length).toEqual(3);
                        expect(getLineMeta.calls[0].args[0].fname).toEqual("hashLine--line1.mp3");
                        expect(getLineMeta.calls[1].args[0].fname).toEqual("hashLine--line2.mp3");
                        expect(getLineMeta.calls[2].args[0].fname).toEqual("hashLine--line3.mp3");
                        expect(job.setStartTime).toHaveBeenCalledWith('collectLinesMetadata');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'collectLinesMetadata');
                        expect(job.setEndTime).toHaveBeenCalledWith('collectLinesMetadata');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should reject even if it fails to find metadata for one line', function() {
                getLineMeta.andCallFake(function(track) {
                    if (track.fname === "hashLine--line2.mp3") {
                        return q.reject('Reject this one');
                    } else {
                        return q();
                    }
                });
                
                runs(function() {
                    dub.collectLinesMetadata(job).catch(function(error) {
                        expect(error.fnName).toEqual('collectLinesMetadata');
                        expect(getLineMeta.calls.length).toEqual(3);
                        expect(job.setStartTime).toHaveBeenCalledWith('collectLinesMetadata');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'collectLinesMetadata');
                        expect(job.setEndTime).toHaveBeenCalledWith('collectLinesMetadata');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });
        
        describe('getLineMetadata', function() {
            var readJsonSpy, writeFileSpy, mockTrack;
            
            beforeEach(function() {
                readJsonSpy = spyOn(fs, 'readJSONSync');
                writeFileSpy = spyOn(fs, 'writeFileSync');
                mockTrack = {
                    fpath: 'fakeFilePath',
                    metapath: 'fakeMetaPath'
                };
            });
            
            it('should skip if the metadata file exists', function() {
                readJsonSpy.andReturn({duration: 3.5});
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).then(function(retval) {
                        expect(retval).toBe(mockTrack);
                        expect(mockId3).not.toHaveBeenCalled();
                        expect(writeFileSpy).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should retrieve line metadata and write it to a file', function() {
                readJsonSpy.andCallFake(function(path, opts) {
                    throw {errno: 34};
                });
                mockId3.andCallFake(function(path, cb) {
                    cb(null, {foo: 'bar', duration: 3.5});
                });
                writeFileSpy.andReturn();
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).then(function(retval) {
                        expect(retval).toBe(mockTrack);
                        expect(mockLog.error).not.toHaveBeenCalled();
                        expect(readJsonSpy.calls[0].args[0]).toEqual('fakeMetaPath');
                        expect(readJsonSpy.calls[0].args[1].encoding).toEqual('utf8');
                        expect(mockId3.calls[0].args[0]).toBe('fakeFilePath');
                        expect(writeFileSpy.calls[0].args[0]).toEqual('fakeMetaPath');
                        expect(writeFileSpy.calls[0].args[1]).toEqual(JSON.stringify(
                            {foo: 'bar', duration: 3.5}));
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should complete even if the metadata file is unreadable', function() {
                readJsonSpy.andCallFake(function(path, opts) {
                    throw {errno: 1};
                });
                mockId3.andCallFake(function(path, cb) {
                    cb(null, {duration: 3.5, foo: 'bar'});
                });
                writeFileSpy.andReturn();
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).then(function(retval) {
                        expect(retval).toBe(mockTrack);
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(mockId3).toHaveBeenCalled();
                        expect(writeFileSpy).toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should complete even if it cannot write to the metadata file', function() {
                readJsonSpy.andCallFake(function(path, opts) {
                    throw {errno: 34};
                });
                mockId3.andCallFake(function(path, cb) {
                    cb(null, {duration: 3.5, foo: 'bar'});
                });
                writeFileSpy.andCallFake(function(path, data) {
                    throw new Error("Error!");
                });
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).then(function(retval) {
                        expect(retval).toBe(mockTrack);
                        expect(mockLog.warn).toHaveBeenCalled();
                        expect(mockId3).toHaveBeenCalled();
                        expect(writeFileSpy).toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should reject if id3 fails', function() {
                readJsonSpy.andCallFake(function(path, opts) {
                    throw {errno: 1};
                });
                mockId3.andCallFake(function(path, cb) {
                    cb('Error!', null);
                });
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).catch(function(error) {
                        expect(error).toBeDefined();
                        expect(mockId3).toHaveBeenCalled();
                        expect(writeFileSpy).not.toHaveBeenCalled();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should reject if there is no duration in the returned data', function() {
                readJsonSpy.andCallFake(function(path, opts) {
                    throw {errno: 1};
                });
                mockId3.andCallFake(function(path, cb) {
                    cb(null, {foo: 'bar'});
                });
                
                runs(function() {
                    dub.getLineMetadata(mockTrack).catch(function(error) {
                        expect(error).toBeDefined();
                        expect(mockId3).toHaveBeenCalled();
                        expect(writeFileSpy).not.toHaveBeenCalled();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });

        describe('getVideoLength', function() {
            var probeSpy, writeFileSpy;
            
            beforeEach(function() {
                probeSpy = spyOn(ffmpeg, 'probe');
                writeFileSpy = spyOn(fs, 'writeFileSync');
            });
            
            it('should skip if the output, script, or vid length already exists', function() {
                job.hasOutput.andReturn(true);
                runs(function() {
                    dub.getVideoLength(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasOutput.andReturn(false);
                        job.hasVideoLength.andReturn(true);
                        return retval;
                    }).then(dub.getVideoLength(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasVideoLength.andReturn(false);
                        job.hasScript.andReturn(true);
                        return retval;
                    }).then(dub.getVideoLength(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(probeSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should probe for video metadata and write it to a file', function() {
                probeSpy.andCallFake(function(fpath, cb) {
                    cb(null, {duration: 3.5});
                });
                runs(function() {
                    dub.getVideoLength(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(probeSpy.calls[0].args[0]).toBe('caches/video/test.mp4');
                        var writeFileArgs = writeFileSpy.calls[0].args;
                        expect(writeFileArgs[0]).toBe('caches/video/test_mp4_metadata.json');
                        expect(writeFileArgs[1]).toEqual(JSON.stringify({duration: 3.5}));
                        expect(job.setStartTime).toHaveBeenCalledWith('getVideoLength');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getVideoLength');
                        expect(job.setEndTime).toHaveBeenCalledWith('getVideoLength');
                        doneFlag = true;
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should print errors from ffmpeg even if the command succeeded', function() {
                probeSpy.andCallFake(function(fpath, cb) {
                    cb(null, {duration: 3.5}, null, 'stderr errors');
                });
                runs(function() {
                    dub.getVideoLength(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockLog.warn).toHaveBeenCalled();
                        expect(mockLog.warn.calls[0].args[2]).toBe('stderr errors');
                        expect(job.setStartTime).toHaveBeenCalledWith('getVideoLength');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getVideoLength');
                        expect(job.setEndTime).toHaveBeenCalledWith('getVideoLength');
                        doneFlag = true;
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
            
            it('should handle failures from ffmpeg', function() {
                probeSpy.andCallFake(function(fpath, cb) {
                    cb('Rejected!', null);
                });
                runs(function() {
                    dub.getVideoLength(job).catch(function(error) {
                        expect(error.fnName).toBe('getVideoLength');
                        expect(writeFileSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).toHaveBeenCalledWith('getVideoLength');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getVideoLength');
                        expect(job.setEndTime).toHaveBeenCalledWith('getVideoLength');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should reject if probe returns no video duration', function() {
                probeSpy.andCallFake(function(fpath, cb) {
                    cb(null, {foo: 'bar'});
                });
                runs(function() {
                    dub.getVideoLength(job).catch(function(error) {
                        expect(error.fnName).toBe('getVideoLength');
                        expect(writeFileSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).toHaveBeenCalledWith('getVideoLength');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getVideoLength');
                        expect(job.setEndTime).toHaveBeenCalledWith('getVideoLength');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should succeed even if there are errors from writing info to a file', function() {
                probeSpy.andCallFake(function(fpath, cb) {
                    cb(null, {duration: 3.5});
                });
                writeFileSpy.andThrow('Nope!');
                runs(function() {
                    dub.getVideoLength(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(writeFileSpy).toHaveBeenCalled();
                        expect(mockLog.warn).toHaveBeenCalled();
                        expect(job.setStartTime).toHaveBeenCalledWith('getVideoLength');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'getVideoLength');
                        expect(job.setEndTime).toHaveBeenCalledWith('getVideoLength');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });

        describe('convertScriptToMP3', function() {
            var templateSpy;
            
            beforeEach(function() {
                templateSpy = spyOn(job, 'assembleTemplate').andReturn('Fake Template');
            });
        
            it('should skip if the output, script, or vid length already exists', function() {
                job.hasOutput.andReturn(true);
                runs(function() {
                    dub.convertScriptToMP3(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.hasOutput.andReturn(false);
                        job.hasScript.andReturn(true);
                        return retval;
                    }).then(dub.convertScriptToMP3(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockAssemble).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should assemble a script', function() {
                mockAssemble.andReturn(q({}));
                runs(function() {
                    dub.convertScriptToMP3(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockAssemble).toHaveBeenCalledWith('Fake Template');
                        expect(job.setStartTime).toHaveBeenCalledWith('convertScriptToMP3');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'convertScriptToMP3');
                        expect(job.setEndTime).toHaveBeenCalledWith('convertScriptToMP3');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should handle errors from assemble', function() {
                mockAssemble.andReturn(q.reject('Rejected!'));
                runs(function() {
                    dub.convertScriptToMP3(job).catch(function(error) {
                        expect(error.fnName).toBe('convertScriptToMP3');
                        expect(job.setStartTime).toHaveBeenCalledWith('convertScriptToMP3');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'convertScriptToMP3');
                        expect(job.setEndTime).toHaveBeenCalledWith('convertScriptToMP3');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });

        describe('applyScriptToVideo', function() {
            var mergeSpy;
            
            beforeEach(function() {
                mergeSpy = spyOn(ffmpeg, 'mergeAudioToVideo');
            });
        
            it('should skip if the output already exists', function() {
                job.hasOutput.andReturn(true);
                runs(function() {
                    dub.applyScriptToVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mergeSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should merge audio to video', function() {
                mergeSpy.andCallFake(function(vpath, spath, opath, tmpl, cb) {
                    cb(null, null, null);
                });
                runs(function() {
                    dub.applyScriptToVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        var mergeArgs = mergeSpy.calls[0].args;
                        expect(mergeArgs[0]).toEqual('caches/video/test.mp4');
                        expect(mergeArgs[1]).toEqual('caches/script/test_hashScript.mp3');
                        expect(mergeArgs[2]).toEqual('caches/output/test_hashOutput.mp4');
                        expect(mergeArgs[3].frequency).toEqual(22050);
                        expect(job.setStartTime).toHaveBeenCalledWith('applyScriptToVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'applyScriptToVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('applyScriptToVideo');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should print errors from ffmpeg even if the command succeeded', function() {
                mergeSpy.andCallFake(function(vpath, spath, opath, tmpl, cb) {
                    cb(null, null, null, 'stderr errors');
                });
                runs(function() {
                    dub.applyScriptToVideo(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(mockLog.warn).toHaveBeenCalled();
                        expect(mockLog.warn.calls[0].args[2]).toBe('stderr errors');
                        expect(job.setStartTime).toHaveBeenCalledWith('applyScriptToVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'applyScriptToVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('applyScriptToVideo');
                        doneFlag = true;
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);                
            });
            
            it('should handle errors from ffmpeg', function() {
                mergeSpy.andCallFake(function(vpath, spath, opath, tmpl, cb) {
                    cb('Error!', null, null);
                });
                runs(function() {
                    dub.applyScriptToVideo(job).catch(function(error) {
                        expect(error.fnName).toBe('applyScriptToVideo');
                        expect(job.setStartTime).toHaveBeenCalledWith('applyScriptToVideo');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'applyScriptToVideo');
                        expect(job.setEndTime).toHaveBeenCalledWith('applyScriptToVideo');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        });
        
        describe('uploadToStorage', function() {
            var headSpy, putSpy, readFileSpy, hashSpy;

            beforeEach(function() {
                putSpy = spyOn(s3util, 'putObject');
                headSpy = jasmine.createSpy('s3_head_obj');
                readFileSpy = spyOn(fs, 'readFileSync');
                hashSpy = spyOn(crypto, 'createHash').andReturn({
                    update: function(data) {
                        this.buff = data;
                    },
                    digest: function(type) {
                        return type + ' digest of ' + this.buff;
                    }
                });
                mockAws.S3 = function() {
                    return {headObject: headSpy};
                };
            });
            
            it('should skip if the output type is local or s3 is not enabled', function() {
                job.outputType = 'local';
                runs(function() {
                    dub.uploadToStorage(job).then(function(retval) {
                        expect(retval).toBe(job);
                        job.outputType = 's3';
                        spyOn(job, 'enableAws').andReturn(false);
                        return retval;
                    }).then(dub.uploadToStorage(job)).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(headSpy).not.toHaveBeenCalled();
                        expect(job.setStartTime).not.toHaveBeenCalled();
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should successfully upload a file to s3', function() {
                readFileSpy.andReturn('localVideo');
                headSpy.andCallFake(function(params, cb) {
                    cb('Not existent!', null);
                });
                putSpy.andReturn(q('Success!'));
                
                runs(function() {
                    dub.uploadToStorage(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(readFileSpy).toHaveBeenCalledWith('caches/output/test_hashOutput.mp4');
                        expect(hashSpy).toHaveBeenCalledWith('md5');
                        expect(job.md5).toEqual('hex digest of localVideo');
                        
                        var headParams = headSpy.calls[0].args[0];
                        expect(headParams.Bucket).toEqual('ut');
                        expect(headParams.Key).toEqual('ut/media/output/test_hashOutput.mp4');
                        
                        expect(putSpy.calls[0].args[1]).toEqual('caches/output/test_hashOutput.mp4');
                        var putParams = putSpy.calls[0].args[2];
                        
                        expect(putParams.Bucket).toEqual('ut');
                        expect(putParams.Key).toEqual('ut/media/output/test_hashOutput.mp4');
                        expect(putParams.ACL).toEqual('public-read');
                        expect(putParams.ContentType).toEqual('video/mp4');
                        
                        expect(job.setStartTime).toHaveBeenCalledWith('uploadToStorage');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'uploadToStorage');
                        expect(job.setEndTime).toHaveBeenCalledWith('uploadToStorage');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should not upload a file if it already exists on s3', function() {
                readFileSpy.andReturn('localVideo');
                headSpy.andCallFake(function(params, cb) {
                    cb(null, { ETag: '"hex digest of localVideo"' });
                });
                
                runs(function() {
                    dub.uploadToStorage(job).then(function(retval) {
                        expect(retval).toBe(job);
                        expect(headSpy).toHaveBeenCalled();
                        expect(putSpy).not.toHaveBeenCalled();                        
                        expect(job.setStartTime).toHaveBeenCalledWith('uploadToStorage');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'uploadToStorage');
                        expect(job.setEndTime).toHaveBeenCalledWith('uploadToStorage');
                        doneFlag = true;
                    }).catch(function(error) { 
                        expect(error.toString()).not.toBeDefined();
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
            
            it('should handle errors from s3util', function() {
                readFileSpy.andReturn('localVideo');
                headSpy.andCallFake(function(params, cb) {
                    cb('Not existent!', null);
                });
                putSpy.andReturn(q.reject('Rejected!'));
                
                runs(function() {
                    dub.uploadToStorage(job).catch(function(error) {
                        expect(error.fnName).toBe('uploadToStorage');
                        expect(job.setStartTime).toHaveBeenCalledWith('uploadToStorage');
                        expect(dub.updateJobStatus).toHaveBeenCalledWith(job, 202, 'uploadToStorage');
                        expect(job.setEndTime).toHaveBeenCalledWith('uploadToStorage');
                        doneFlag = true;
                    });
                });
                waitsFor(function() { return doneFlag; }, 3000);
            });
        }); // end -- describe uploadToStorage

    }); // end -- describe job process

}); // end -- describe dub

