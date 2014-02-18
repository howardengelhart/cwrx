var q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    testUtils   = require('./testUtils'),
    id3Info     = require('../../lib/id3'),
    host        = process.env['host'] || 'localhost',
    statusHost  = process.env['statusHost'] || host,
    testNum     = process.env['testNum'] || 0,  // usually the Jenkins build number
    config      = {
        dubUrl   : 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        maintUrl : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
        proxyUrl : 'http://' + (statusHost === 'localhost' ? statusHost + ':3000' : statusHost) + '/dub',
        trackStatUrl : 'http://' + (statusHost === 'localhost' ? statusHost + ':3000' : statusHost) + '/dub/track/status/'
    },
    statusTimeout = 10000;

jasmine.getEnv().defaultTimeoutInterval = 40000;

describe('dub (E2E)', function() {
    var templateFile, templateJSON, screamTemplate, badTemplate;
    
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
                return testUtils.qRequest('post', [vidOpts]);
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
                expect(error.detail).toBeDefined();
                done();
            });
        });
    });
    
    describe('/dub/status', function() {
        it('should succeed for a valid job id', function(done) {
            var fileOpts = {
                url: config.maintUrl + '/cache_file',
                json: {
                    fname: "job_e2eJob.json",
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
                expect(JSON.stringfiy(error)).not.toBeDefined();
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
                    fname: "job_e2eJob.json",
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
                expect(JSON.stringify(error)).not.toBeDefined();
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
                    fname: "job_invalid.json",
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
    });
    
    describe('/dub/track/create', function(done) {
        it('should create a correct mp3 file', function(done) {
            var options = {
                url: config.dubUrl + '/track/create',
                json: {
                    tts: {
                        voice: "Paul",
                        randTag: Math.random()
                    },
                    line: "This is a test line"
                }
            };
            var correctId3 = {
                audio_duration: 1.446,
                kbps: 48,
                khz: 22050,
                lips: 'f0=15&f1=15&f2=15&f3=9&f4=9&f5=15&f6=9&f7=5&f8=6&f9=15&f10=9&f11=9&f12=12&f13=12&f14=12&f15=5&f16=7&f17=0&nofudge=1&lipversion=2&ok=1',
                phonemes: 'P,0,66,13,xS,66,1396,71,.G,66,346,77,6W,66,346,77,ThisP,66,116,60,DP,116,206,89,iP,206,346,76,sW,346,526,71,isP,346,426,62,iP,426,526,79,zW,526,596,72,aP,526,596,72,!W,596,976,60,testP,596,726,59,tP,726,816,90,eP,816,916,44,sP,916,976,38,tW,976,1396,74,lineP,976,1176,82,lP,1176,1266,91,IP,1266,1396,52,nP,1396,1426,13,x'
            };
            
            function getTrackID3(url) {
                var options = {
                    url: url
                }, deferred = q.defer();
                
                testUtils.qRequest('get', [options])
                .then(function(resp) {
                    return q.npost(fs, 'writeFile', [path.join(__dirname, 'temp.mp3'), resp.body]);
                }).then(function() {
                    id3Info(path.join(__dirname, 'temp.mp3'), function(err, result) {
                        if (err) deferred.reject(err);
                        else deferred.resolve(result);
                    });
                });
                return deferred.promise;
            }
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(202);
                expect(resp.body.jobId.match(/^t-\w{10}$/)).toBeTruthy();
                expect(resp.body.host).toBeDefined();
                return testUtils.checkStatus(resp.body.jobId, resp.body.host, config.trackStatUrl,
                                             statusTimeout, 1000);
            }).then(function(resp) {
                expect(resp.data.output).toBeDefined();
                expect(typeof(resp.data.output)).toEqual('string');
                return getTrackID3(resp.data.output);
            }).then(function(result) {
                expect(result).toBeDefined();
                var equal = true;
                Object.keys(correctId3).forEach(function(key) {
                    if (key === 'phonemes') {
                        result[key] = result[key].replace(/\s+/g, '');
                    }
                    expect(result[key]).toBe(correctId3[key]);
                    if (result[key] !== correctId3[key]) equal = false;
                });
                
                if (equal) fs.removeSync(path.join(__dirname, 'temp.mp3'));

                var cleanOpts = {
                    url : config.maintUrl + '/clean_track',
                    json: options.json
                };
                
                testUtils.qRequest('post', [cleanOpts])
                .catch(function(error) {
                    console.log('Error removing track: ' + JSON.stringify(error));
                }).finally(function() {
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if given a template with no line', function(done) {
            var options = {
                url: config.dubUrl + '/track/create',
                json: {}
            };
        
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe('Unable to process request.');
                expect(errorObj.detail).toBe('Expected line string in template');
                done();
            });
        });
        
        it('should fail if given an invalid template', function(done) {
            var options = {
                url: config.dubUrl + '/track/create',
                json: {
                    line: {
                        ts: '0.1',
                        text: 'This is a test'
                    }
                }
            };
        
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe('Unable to process request.');
                expect(errorObj.detail).toBe('Expected line string in template');
                done();
            });
        });
    });
    
    
    // THIS SHOULD ALWAYS GO LAST
    describe('log cleanup', function() {
        it('copies the logs locally and then clears the remote log file', function(done) {
            if (!process.env['getLogs']) return done();
            testUtils.getLog('dub.log', config.maintUrl, 'dub', testNum)
            .then(function() {
                var options = {
                    url: config.maintUrl + '/clear_log',
                    json: {
                        logFile: 'dub.log'
                    }
                };
                return testUtils.qRequest('post', [options]);
            }).then(function(resp) {
                console.log("Cleared remote log");
                done();
            }).catch(function(error) {
                console.log("Error getting and clearing log:");
                console.log(error);
                done();
            });
        });
    });
});  //  end -- describe dub (E2E)
