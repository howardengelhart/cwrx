var request = require('request'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'video_url': 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub/create',
        'clean_cache_url': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint/clean_cache',
    },
    
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
    },
    badTemplate = {
        'uri'     : 'screenjack~scream',
        'video'   : 'scream.mp4',
        'tts'     : {
              'voice'  : 'Allison',
              'effect' : 'R',
              'level'  : '3'
            }
    };

describe('dub (E2E)', function() {
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

