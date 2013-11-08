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

describe('share server:', function() {
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

