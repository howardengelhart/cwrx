var fs          = require('fs-extra'),
    path        = require('path'),
    sanitize    = require('../sanitize'),
    q           = require('q'),
    uuid        = require('../../lib/uuid'),
    vocalware   = require('../../lib/vocalware'),
    cwrxConfig  = require('../../lib/config');

describe('dub track job (UT)', function() {
    var dub, mockLog, mockLogger, mockHostname, mockTemplate, job, config;
    
    beforeEach(function(done) {
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
        mockVware = {
            createAuthToken: jasmine.createSpy('vw_create_auth_token').andReturn('fakeAuthToken')
        };
        mockHostname = jasmine.createSpy('hostname').andReturn(q('fakeHost'));

        dub = sanitize(['../bin/dub'])
                .andConfigure([['../lib/logger', mockLogger], ['../lib/hostname', mockHostname],
                               ['../lib/vocalware', mockVware]])
                .andRequire();
                
        var configObject;
        configObject = {
            s3     : {
                tracks : {
                    bucket : 'ut',
                    path   : 'ut/media/track'
                },
                auth: 'fake.aws.json',
            },
            output : {
                trackUri : "https://s3.amazonaws.com/ut/media/track/",
                type : "s3"
            },
            responseTimeout: 1000,
            caches : {
                run     : 'caches/run/',
                line    : 'caches/line/',
                jobs    : 'caches/jobs/'
            },
            tts : {
                auth        : 'fake.tts.json',
                bitrate     : '48k',
                frequency   : 22050,
                workspace   : __dirname
            }
        };
        spyOn(cwrxConfig, 'createConfigObject').andReturn(configObject);
        
        mockTemplate = {
            tts   : {
                voice   : "Allison",
                effect  : "R",
                level   : "3"
            },
            line: "This is a test"
        };
        spyOn(uuid, 'hashText').andReturn('trackHash');
        spyOn(dub, 'updateJobStatus');
        
        dub.createConfiguration({}).done(function(cfgObject) {
            config = cfgObject;
            config.enableAws = true;
        
            job = dub.createTrackJob('123456', mockTemplate, config);
            job.jobFilePath = 'ut-job.json';
            
            spyOn(job, 'setStartTime').andCallThrough();
            spyOn(job, 'setEndTime').andCallThrough();
            done();
        });
    });
    
    describe('createTrackJob', function() {
        it('should create a job with valid configuration and template', function() {
            expect(job).toBeDefined();
            expect(job.id).toBe('123456');
            
            expect(job.ttsAuth).toBe('fakeAuthToken');
            expect(job.tracks.length).toEqual(1);
            expect(job.enableAws()).toEqual(true);

            expect(job.tts.voice).toBe("Allison");
            expect(job.tts.effect).toBe("R");
            expect(job.tts.level).toBe("3");
            
            expect(job.outputFname).toEqual('trackHash.mp3');
            expect(job.outputPath).toEqual('caches/line/trackHash.mp3');
            expect(job.outputUri).toEqual('https://s3.amazonaws.com/ut/media/track/trackHash.mp3');
            expect(job.outputType).toEqual('s3');
            
            var outParams = job.getS3OutParams();
            expect(outParams.Bucket).toEqual('ut');
            expect(outParams.Key).toEqual('ut/media/track/trackHash.mp3');
            expect(outParams.ACL).toEqual('public-read');
            expect(outParams.ContentType).toEqual('audio/mpeg');
        });

        it('should throw an error if the template has no line', function() {
            delete mockTemplate.line;
            expect(function() {dub.createTrackJob('12345', mockTemplate, config);}).toThrow();
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
    });
    
    describe('handleTrackRequest', function() {
        beforeEach(function() {
            spyOn(dub, 'convertLinesToMP3').andReturn(q(job));
            spyOn(dub, 'uploadToStorage').andReturn(q(job));
        });
        
        it('should correctly call each function', function(done) {
            job.md5 = 'fakeMD5';
            dub.handleTrackRequest(job).then(function(resp) {
                expect(resp).toBe(job);
                expect(job.setStartTime).toHaveBeenCalledWith('handleTrackRequest');
                expect(dub.convertLinesToMP3).toHaveBeenCalledWith(job);
                expect(dub.uploadToStorage).toHaveBeenCalledWith(job);
                expect(job.setEndTime).toHaveBeenCalledWith('handleTrackRequest');
                expect(dub.updateJobStatus).toHaveBeenCalledWith(
                    job, 201, 'Completed', {resultMD5: 'fakeMD5'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should halt if any function dies', function(done) {
            dub.convertLinesToMP3.andReturn(q.reject({fnName: 'convertLinesToMP3', msg: 'Died!'}));
            dub.handleTrackRequest(job).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(job.setStartTime).toHaveBeenCalledWith('handleTrackRequest');
                expect(dub.convertLinesToMP3).toHaveBeenCalledWith(job);
                expect(dub.uploadToStorage).not.toHaveBeenCalled();
                expect(job.setEndTime).toHaveBeenCalledWith('handleTrackRequest');
                expect(dub.updateJobStatus).toHaveBeenCalledWith(
                    job, 500, 'convertLinesToMP3', {failMsg: 'Died!'});
                done();
            });
        });
    });
});
