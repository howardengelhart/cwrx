var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    statusHost  = process.env['statusHost'] ? process.env['statusHost'] : host,
    config      = {
        dubUrl   : 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        maintUrl : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
        proxyUrl : 'http://' + (statusHost === 'localhost' ? statusHost + ':3000' : statusHost) + '/dub'
    };

jasmine.getEnv().defaultTimeoutInterval = 40000;

describe('dub (E2E)', function() {
    var templateFile, templateJSON, screamTemplate, badTemplate,
        testNum = 0;
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'dub.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing dub log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('dub.log', config.maintUrl, jasmine.getEnv().currentSpec, ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
    beforeEach(function() {
        screamTemplate = {
            'video'   : 'scream_e2e.mp4',
            'tts'     : {
                'voice'  : 'Paul',
                'effect' : 'R',
                'level'  : '3'
            },
            'script'  : [
                { 'ts': '8.70', 'line': 'Hello' },
                { 'ts': '11.83', 'line': 'You contacted me on Facebook' },
                { 'ts': '17.67', 'line': 'What is that?' },
                { 'ts': '19.20', 'line': 'Glue <prosody rate=\'fast\'> tin </prosody> <Break time=\'10ms\'/> free?' },
                { 'ts': '21.00', 'line': 'Glue <prosody rate=\'fast\'> tin </prosody>  <Break time=\'10ms\'/> makes me poop' },
                { 'ts': '25.25', 'line': 'E T?' },
                { 'ts': '28.00', 'line': 'Should I rub your butt?' },
                { 'ts': '30.75', 'line': 'Do you care that I have herpes?'  },
                { 'ts': '35.08', 'line': 'Actually, I look like a monster from a scary movie' },
                { 'ts': '45.00', 'line': 'That is funny, I wear a mask sometimes too.  But, mine is made out of dried human pee, and poop, that I find in the park.  I would really like to come over and massage your butt.  Lets see how it goes.  I\'ve already updated my Facebook status to say, I\'m cooking popcorn with that chick from E T <Break time=\'250ms\'/>  hash tag winning.' }
            ],
            'e2e'     : {
                'md5': '55f69223027db8d68d36dff26ccaea39'  // NOTE: if you change the 'script' section or the source video on S3, you will need to update this md5
            }
        };
    });
    
    describe('/dub/create', function() {
        it('should succeed with a valid template', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            }, reqFlag = false;
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.body.output).toBeDefined();
                expect(typeof(resp.body.output)).toEqual('string');
                expect(resp.body.md5).toEqual(screamTemplate.e2e.md5);
                
                if (resp.body.md5 !== screamTemplate.e2e.md5) {
                    return done();
                }

                var options = {
                    url : config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                testUtils.qRequest('post', [options])
                .catch(function(error) {
                    console.log('Error cleaning caches: ' + error);
                }).finally(function() {
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should succeed with a randomized template', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            };
            
            screamTemplate.script.forEach(function(track) {
                track.line += Math.round(Math.random() * 10000);
            });

            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.body.output).toBeDefined();
                expect(typeof(resp.body.output)).toEqual('string');
                expect(resp.body.md5).not.toEqual(screamTemplate.e2e.md5);

                var options = {
                    url : config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                testUtils.qRequest('post', [options])
                .catch(function(error) {
                    console.log('Error cleaning caches: ' + error);
                }).finally(function() {
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should fail if given a template with no script', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            };
            
            delete screamTemplate.script;
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBeDefined();
                expect(error.detail).toBe('Expected script section in template');
                done();
            });
        });
    
        it('should fail if given an invalid source video', function(done) {
            var cacheOpts = {
                url: config.maintUrl + '/cache_file',
                json: {
                    fname: 'invalid.mp4',
                    data: 'This is a fake video file',
                    cache: 'video'
                }
            };
            
            testUtils.qRequest('post', [cacheOpts])
            .then(function(resp) {
                var vidOpts = {
                    url: config.dubUrl + '/create',
                    json: screamTemplate
                };
                screamTemplate.video = 'invalid.mp4';
                return testUtils.qRequest(request, 'post', [vidOpts]);
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBeDefined();
                expect(error.detail.match(/invalid\.mp4: Invalid data found when processing input/)).toBeTruthy();
            }).finally(function() {
                var cleanOpts = {
                    url: config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                testUtils.qRequest('post', [cleanOpts])
                .catch(function(error) {
                    console.log('Error cleaning caches: ' + error);
                }).finally(function() {
                    done();
                });
            });
        });

        it('should fail if given a template with a non-existent video', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            };
            
            screamTemplate.video = 'fake_video.mp4';
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBeDefined();
                expect(error.detail.match('The specified key does not exist')).toBeTruthy();
                done();
            });
        });
    });
    
    describe('/dub/status', function() {
        it('should succeed for a valid job id', function(done) {
            var fileOpts = {
                url: config.maintUrl + '/cache_file',
                json: {
                    fname: "job-e2eJob.json",
                    data: {
                        jobId: "e2eJob",
                        lastStatus: {
                            code: 201,
                            step: "Completed"
                        }
                    },
                    cache: 'jobs'
                }
            };
            
            testUtils.qRequest('post', [fileOpts])
            .then(function() {
                var statOpts = {
                    url: config.dubUrl + '/status/e2eJob?host=' + host
                };
                return testUtils.qRequest('get', [statOpts]);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.lastStatus).toBeDefined();
                expect(resp.body.lastStatus.code).toBe(201);
                expect(resp.body.lastStatus.step).toBe("Completed");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should succeed at proxying a status request for a valid job id', function(done) {
            if (statusHost === host) {
                console.log("statusHost not defined or identical to testHost. Not running proxy /status test");
                return done();
            }
            var fileOpts = {
                url: config.maintUrl + '/cache_file',
                json: {
                    fname: "job-e2eJob.json",
                    data: {
                        jobId: "e2eJob",
                        lastStatus: {
                            code: 201,
                            step: "Completed"
                        }
                    },
                    cache: 'jobs'
                }
            };
            
            testUtils.qRequest('post', [fileOpts])
            .then(function() {
                var statOpts = {
                    url: config.proxyUrl + '/status/e2eJob?host=' + host
                };
                return testUtils.qRequest('get', [statOpts]);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.lastStatus).toBeDefined();
                expect(resp.body.lastStatus.code).toBe(201);
                expect(resp.body.lastStatus.step).toBe("Completed");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    
        it('should fail for an invalid job id', function(done) {
            var options = {
                url: config.dubUrl + '/status/nonexistent?host=' + host
            };
            
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to check status');
                expect(errorObj.detail.code).toBe('ENOENT');
                done();
            });
        });
        
        it('should fail for an invalid job file', function(done) {
            var fileOpts = {
                url: config.maintUrl + '/cache_file',
                json: {
                    fname: "job-invalid.json",
                    data: "This is not a job file",
                    cache: 'jobs'
                }
            };
            
            testUtils.qRequest('post', [fileOpts])
            .then(function() {
                var statOpts = {
                    url: config.dubUrl + '/status/invalid?host=' + host
                };
                return testUtils.qRequest('get', [statOpts]);
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to check status');
                expect(errorObj.detail).toBe('missing or malformed lastStatus in job file');
                done();
            });
        });
    });  //  end -- describe /dub/status
});  //  end -- describe dub (E2E)
