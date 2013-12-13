var request = require('request'),
    q       = require('q'),
    path    = require('path'),
    fs      = require('fs-extra'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'dubUrl': 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        'maintUrl': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
    };

jasmine.getEnv().defaultTimeoutInterval = 40000;

describe('dub (E2E)', function() {
    var templateFile, templateJSON, screamTemplate, badTemplate,
        testNum = 0;
    
    beforeEach(function(done) {
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'dub.log'
            }
        };
        request.post(options, function(error, response, body) {
            if (body.error) {
                console.log("Error clearing dub log: " + JSON.stringify(body));
            }
            done();
        });
    });
    afterEach(function(done) {
        testNum++;
        var options = {
            url: config.maintUrl + '/get_log?logFile=dub.log'
        };
        q.npost(request, 'get', [options])
        .then(function(values) {
            if (!values[1]) return q.reject();
            if (values[1].error) return q.reject(values[1]);
            var fname = path.join(__dirname, 'logs/dub.test' + testNum + '.log');
            return q.npost(fs, 'outputFile', [fname, values[1]]);
        }).then(function() {
            done();
        }).catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
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
            
            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                if (body) {
                    expect(body.error).not.toBeDefined();
                    expect(body.output).toBeDefined();
                    expect(typeof(body.output)).toEqual('string');
                    expect(body.md5).toEqual(screamTemplate.e2e.md5);
                }
                
                if (body.md5 !== screamTemplate.e2e.md5) {
                    return done();
                }

                var options = {
                    url : config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                request.post(options, function(error, response, body) {
                    if (error) console.log('Error cleaning caches: ' + error);
                    done();
                });
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

            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                if (body) {
                    expect(body.error).not.toBeDefined();
                    expect(body.output).toBeDefined();
                    expect(typeof(body.output)).toEqual('string');
                    expect(body.md5).toBeDefined();
                    expect(body.md5).not.toEqual(screamTemplate.e2e.md5);
                }
                
                var options = {
                    url : config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                request.post(options, function(error, response, body) {
                    if (error) console.log('Error cleaning caches: ' + error);
                    done();
                });
            });
        });

        it('should fail if given a template with no script', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            };
            
            delete screamTemplate.script;
            
            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                if (body) {
                    expect(body.error).toBeDefined();
                    expect(body.detail).toEqual('Expected script section in template');
                }
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
            
            q.npost(request, 'post', [cacheOpts]).then(function() {
                var vidOpts = {
                    url: config.dubUrl + '/create',
                    json: screamTemplate
                };
                screamTemplate.video = 'invalid.mp4';
                return q.npost(request, 'post', [vidOpts]);
            }).then(function(values) {  // values = [request, body]
                expect(values).toBeDefined();
                expect(values[1]).toBeDefined();
                expect(values[1].error).toBeDefined();
                expect(values[1].detail.match(/invalid\.mp4: Invalid data found when processing input/)).toBeTruthy();
                
                var cleanOpts = {
                    url: config.maintUrl + '/clean_cache',
                    json: screamTemplate
                }
                return q.npost(request, 'post', [cleanOpts]);
            }).then(function() {
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should fail if given a template with a non-existent video', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: screamTemplate
            };
            
            screamTemplate.video = 'fake_video.mp4';
            
            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                if (body) {
                    expect(body.error).toBeDefined();
                    expect(body.detail).toBeDefined();
                }
                done();
            });
        });
    });  //  end -- describe /dub/create
});  //  end -- describe dub (E2E)
