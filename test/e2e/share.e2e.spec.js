var request = require('request'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'share_url': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'remove_script_url': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint/remove_S3_script'
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

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('share (E2E)', function() {
    describe('valid script test', function() {
        it('should successfully send a request to the share server', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    data: shareItem,
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee'
                }
            };

            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                expect(error).toBeNull();
                if (body) {
                    expect(body.error).not.toBeDefined();
                    expect(body.url).toBeDefined();
                    expect(body.shortUrl).toBeDefined();
                    expect(body.url.match(/^http:\/\/cinema6.com\/#\/experiences\/shared~screenjack~e-\w{14}$/)).toBeTruthy();
                    expect(body.shortUrl.match(/http:\/\/(awe|c-6|ci6)\.(sm|co)\/\w+$/)).toBeTruthy();
                    
                    var scriptId;
                    if (body['url']) {
                        var urlParts = body['url'].split('~');
                        var scriptId = urlParts[urlParts.length - 1];
                    }
                }

                // cleanup
                if (!scriptId) {
                    done();
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
                
                done();
            });
        });
    });
    
    describe('awesm release sharer', function() {
        it('should successfully create a shortened link', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    origin: 'http://fake.cinema6.com/',
                    awesmParams: {
                        tag: 'release'
                    },
                    staticLink: true
                }
            };
            
            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                if (!body) {
                    done();
                    return;
                }
                expect(body.error).not.toBeDefined();
                expect(body.url).toBe('http://fake.cinema6.com/');
                expect(body.shortUrl).toBe('http://ci6.co/t2');
                done();
            });
        });
    }); // end -- awesm release sharer
}); // end -- share (E2E)

