var request = require('request'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'video_url': 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub/create',
    };

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

    describe('cached valid template test - siri', function() {
        it('should successfully send a request to the dub server', function(done) {
            var options = {
                url: config.video_url,
                json: siriTemplate
            };

            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                if (body) {
                    expect(body.error).not.toBeDefined();
                    expect(body.output).toBeDefined();
                    expect(typeof(body.output)).toEqual('string');
                    expect(body.md5).toEqual(siriTemplate.e2e.md5);
                }
                done();
            });
        });
    });
});

