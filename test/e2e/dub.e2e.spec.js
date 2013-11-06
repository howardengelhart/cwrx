var request = require('request'),
    fs      = require('fs'),
    path    = require('path'),
    url     = require('url'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'video_url': 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub/create',
        'share_url': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'clean_cache_url': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint/clean_cache',
        'remove_script_url': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint/remove_S3_script'
    },
    
    screamTemplate = {
        'uri'     : 'screenjack~scream',
        'video'   : 'scream.mp4',
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
            'md5': 'f698b7fd42850771be1ed534608a118c'  // NOTE: if you change the 'script' section or the source video on S3, you will need to update this md5
        }
    },
    badTemplate = {
        'uri'     : 'screenjack~scream',
        'video'   : 'scream.mp4',
        'tts'     : {
              'voice'  : 'Allison',
              'effect' : 'R',
              'level'  : '3'
            }
    },
    shareItem = {
        'id': 'e-123',
        'uri': 'screenjack~scream',
        'content_type': 'usergen',
        'appUrl': 'assets/experiences/screenjack/app/#/usergen',
        'data': {
            'video': 'scream',
            'category': 'action',
            'views': 1000,
            'src': 'scream',
        }
    };

describe('dub video server:', function() {
    var templateFile, templateJSON;

    describe('uncached valid template test - scream', function() {
        it('should successfully send a request to the dub server', function() {

            var options = {
                url: config.video_url,
                json: screamTemplate
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull();
                    expect(body).toBeDefined();
                    if (body) {
                        expect(body['error']).not.toBeDefined();
                        expect(body['output']).toBeDefined();
                        expect(typeof(body['output'])).toEqual('string');
                        expect(body['md5']).toBeDefined();
                        expect(body['md5']).toEqual(screamTemplate['e2e']['md5']);
                    }
                    
                    // cleanup
                    var options = {
                        url : config.clean_cache_url,
                        json: screamTemplate
                    }
                    request.post(options, function(error, response, body) {
                        if (error) console.log('Error cleaning caches: ' + error);
                    });
                    
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag }, 40000);
        });
    });
    
    describe('missing script test', function() {
        it('should unsuccessfully send a request to the dub server', function() {
            var options = {
                url: config.video_url,
                json: badTemplate
            }, reqFlag = false;
            
            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(body).toBeDefined();
                    if (body) {
                        expect(body['error']).toBeDefined();
                        expect(body['detail']).toBeDefined();
                        expect(body['detail']).toEqual('Expected script section in template');
                    }
                    reqFlag = true;
                });            
            });
            waitsFor(function() { return reqFlag }, 40000);
        });
    });
});

describe('dub share server:', function() {
    describe('valid script test - scream', function() {
        it('should successfully send a request to the dub server', function() {
            var fakeOrigin = 'http://cinema6.com/#/experiences/screenjack~brucelee';

            var options = {
                url: config.share_url,
                json: {
                    data: shareItem,
                    origin: fakeOrigin
                }
            }, reqFlag = false;

            runs(function() {
                request.post(options, function(error, response, body) {
                    expect(body).toBeDefined();
                    expect(error).toBeNull('error');
                    if (body) {
                        expect(body['error']).not.toBeDefined('body[\'error\']');
                        expect(body['url']).toBeDefined('url');
                        expect(body['url']).not.toBe(fakeOrigin);
                        
                        var scriptId;
                        if (body['url']) {
                            var urlParts = body['url'].split('~');
                            var scriptId = urlParts[urlParts.length - 1];
                        }
                    }

                    // cleanup
                    if (!scriptId) {
                        reqFlag = true;
                        return;
                    }
                    var options = {
                        url : config.remove_script_url,
                        json: {
                            fname: scriptId + '.json'
                        }
                    }
                    request.post(options, function(error, response, body) {
                        expect(error).toBeNull();
                        if (body) {
                            expect(body['error']).not.toBeDefined();
                        }
                    });
                    
                    reqFlag = true;
                });
            });
            waitsFor(function() { return reqFlag }, 40000);
        });
    });
});



