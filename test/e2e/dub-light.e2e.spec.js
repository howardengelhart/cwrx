var request         = require('request'),
    q               = require('q'),
    path            = require('path'),
    fs              = require('fs-extra'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    statusHost      = process.env['statusHost'] || host,
    config = {
        dubUrl    : 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        maintUrl  : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
        statusUrl : 'http://' + (statusHost === 'localhost' ? statusHost + ':3000' : statusHost) + '/dub/status/'
    },
    statusTimeout = 35000;

jasmine.getEnv().defaultTimeoutInterval = 40000;

describe('dub-light (E2E)', function() {
    var templateFile, templateJSON, siriTemplate;
    
    beforeEach(function() {
        siriTemplate = {
            'video'   : 'siri_e2e.mp4',
            'tts'     : {
                'voice'  : 'Susan'
            },
            'script'  : [
	            { "ts": "6", "line": "new message from Josh. My head is stuck in the toaster.  Pick me up at the hospital after work." },
	            { "ts": "20", "line": "Clear. You can stop at the Taco Bell bathroom, to take a nasty poop." },
	            { "ts": "33", "line": "No, but CNN reports: <prosody pitch=\"high\"> hoe lee shit </prosody> a shark naydough." },
	            { "ts": "39.5", "line": "Better idea, sharks don't like wine." },
	            { "ts": "45", "line": "Hey jerk, stop bothering mee with dumb questions." },
	            { "ts": "51", "line": "Ok, I'll pretend like I'm doing that <Break time=\"750ms\"/> <prosody rate=\"slow\"> I hate you. </prosody>" }
            ],
            'e2e'     : {
                'md5': '4762fa45938d5f626b387d14bd23cf32'  // NOTE: if you change the 'script' section or the source video on S3, you will need to update this md5
            }
        };
    });

    describe('/dub/create', function() {
        it('should succeed with a valid slightly random template', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: siriTemplate
            };
            siriTemplate.script[Math.floor(Math.random() * siriTemplate.script.length)].line += Math.round(Math.random() * 10000);
            requestUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.body.output).toBeDefined();
                expect(typeof(resp.body.output)).toEqual('string');
                expect(resp.body.md5).not.toEqual(siriTemplate.e2e.md5);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should succeed using API version 2', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: siriTemplate 
            }, jobId, host;
            siriTemplate.version = 2;
            siriTemplate.script[Math.floor(Math.random() * siriTemplate.script.length)].line +=
                                Math.round(Math.random() * 10000);
            
            requestUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(202);
                expect(resp.body.jobId.match(/^v-\w{10}$/)).toBeTruthy();
                expect(resp.body.host).toBeDefined();
                return testUtils.checkStatus(resp.body.jobId, resp.body.host, config.statusUrl, statusTimeout);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.data).toBeDefined();
                expect(resp.data.lastStatus).toBeDefined();
                expect(resp.data.lastStatus.code).toBe(201);
                expect(resp.data.lastStatus.step).toBe('Completed');
                expect(resp.data.output).toBeDefined();
                expect(resp.data.md5).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/dub/track/create', function() {
        it('should succeed with a valid slightly random line', function(done) {
            var options = {
                url: config.dubUrl + '/track/create',
                json: {
                    line: 'This is a test ' + Math.round(Math.random() * 10000)
                }
            };
            
            requestUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(202);
                expect(resp.body.jobId.match(/^t-\w{10}$/)).toBeTruthy();
                expect(resp.body.host).toBeDefined();
                return testUtils.checkStatus(resp.body.jobId, resp.body.host, config.statusUrl, statusTimeout);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.data).toBeDefined();
                expect(resp.data.lastStatus).toBeDefined();
                expect(resp.data.lastStatus.code).toBe(201);
                expect(resp.data.lastStatus.step).toBe('Completed');
                expect(resp.data.output).toBeDefined();
                expect(resp.data.md5).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/dub/meta', function() {
        it('should print out appropriate metadata about the dub service', function(done) {
            var options = {
                url: config.dubUrl + '/meta'
            };
            requestUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(resp.body.config).toBeDefined();
                
                expect(resp.body.config.hostname).toBeDefined();
                expect(resp.body.config.proxyTimeout).toBeDefined();
                expect(resp.body.config.responseTimeout).toBeDefined();
                
                expect(resp.body.config.output).toBeDefined();
                expect(resp.body.config.output.type).toBe('s3');
                expect(resp.body.config.output.uri.match(/\/usr\/screenjack\/video/)).toBeTruthy();
                
                var bucket = process.env.bucket || 'c6.dev';
                var media = (bucket === 'c6.dev') ? 'media/' : '';
                expect(resp.body.config.s3).toBeDefined();
                expect(resp.body.config.s3.src).toBeDefined();
                expect(resp.body.config.s3.src.bucket).toBe(bucket);
                expect(resp.body.config.s3.src.path).toBe(media + 'src/screenjack/video');
                expect(resp.body.config.s3.out.bucket).toBe(bucket);
                expect(resp.body.config.s3.out.path).toBe(media + 'usr/screenjack/video');
                expect(resp.body.config.s3.tracks.bucket).toBe(bucket);
                expect(resp.body.config.s3.tracks.path).toBe(media + 'usr/screenjack/track');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});  //  end -- describe dub-light (E2E)
