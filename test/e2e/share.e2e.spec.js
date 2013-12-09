var request = require('request'),
    q       = require('q'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'share_url': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'remove_script_url': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint/remove_S3_script'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('share (E2E)', function() {
    var shareItem;
    
    beforeEach(function() {
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
    });
    
    describe('/share', function() {
        it('should successfully share a valid script', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    data: shareItem,
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee'
                }
            };

            request.post(options, function(error, response, body) {
                var scriptId;
                expect(body).toBeDefined();
                expect(error).toBeNull();
                body = body || {};
                expect(body.error).not.toBeDefined();
                expect(body.url).toBeDefined();
                expect(body.shortUrl).toBeDefined();
                body.url = body.url || '';
                body.shortUrl = body.shortUrl || '';
                expect(body.url.match(/^http:\/\/cinema6.com\/#\/experiences\/shared~screenjack~e-\w{14}$/)).toBeTruthy();
                expect(body.shortUrl.match(/http:\/\/(awe|c-6|ci6)\.(sm|co)\/\w+$/)).toBeTruthy();

                // cleanup
                var scriptId = body.url.match(/e-\w{14}$/);
                if (!scriptId) {
                    done();
                    return;
                }
                var options = {
                    url : config.remove_script_url,
                    json: {
                        fname: scriptId[0] + '.json'
                    }
                }
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull('maint error');
                    if (body) {
                        expect(body.error).not.toBeDefined('maint error');
                    }
                    done();
                });
            });
        });
    
        // the client should prevent this through caching, but the backend should still handle it correctly
        it('should be able to re-share a link', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    data: shareItem,
                    origin: 'http://cinema6.com/#/experiences/shared~screenjack~e-1234567890abcd'
                }
            };

            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                expect(error).toBeNull();
                body = body || {};
                expect(body.error).not.toBeDefined();
                expect(body.url).toBeDefined();
                expect(body.shortUrl).toBeDefined();
                body.url = body.url || '';
                body.shortUrl = body.shortUrl || '';
                expect(body.url.match(/^http:\/\/cinema6.com\/#\/experiences\/shared~screenjack~e-\w{14}$/)).toBeTruthy();
                expect(body.url).not.toEqual('http://cinema6.com/#/experiences/shared~screenjack~e-1234567890abcd');
                expect(body.shortUrl.match(/http:\/\/(awe|c-6|ci6)\.(sm|co)\/\w+$/)).toBeTruthy();
                
                // cleanup
                var scriptId = body.url.match(/e-\w{14}$/);
                if (!scriptId) {
                    done();
                    return;
                }
                var options = {
                    url : config.remove_script_url,
                    json: {
                        fname: scriptId[0] + '.json'
                    }
                }
                request.post(options, function(error, response, body) {
                    expect(error).toBeNull('maint error');
                    if (body) {
                        expect(body.error).not.toBeDefined('maint error');
                    }
                    done();
                });
            });
        });
    
        it('should fail if given an item with no uri', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: shareItem
                }
            };
            delete shareItem.uri;
            
            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                body = body || {};
                expect(body.error).toBeDefined();
                expect(body.detail).toBeDefined();
                body.detail = body.detail || '';
                expect(body.detail.match(/missing uri/)).toBeTruthy();
                done();
            });
        });
    
        it('should fail if given an item with a malformed uri', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: shareItem
                }
            };
            shareItem.uri = 'fakeUri';
            
            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                body = body || {};
                expect(body.error).toBeDefined();
                expect(body.detail).toBeDefined();
                body.detail = body.detail || '';
                expect(body.detail.match(/fakeUri/)).toBeTruthy();
                done();
            });
        });
    
        it('should fail if given a malformed item', function(done) {
            var options = {
                url: config.share_url,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: 'This is fake data'
                }
            };
            
            request.post(options, function(error, response, body) {
                expect(body).toBeDefined();
                body = body || {};
                expect(body.error).toBeDefined();
                expect(body.detail).toBeDefined();
                body.detail = body.detail || '';
                expect(body.detail.match(/missing uri/)).toBeTruthy();
                done();
            });
        });
    
    describe('/share/facebook', function() {
        it('should fail if not given the correct params', function(done) {
            var options = {
                url: config.share_url + '/facebook?'
            };
            
            q.npost(request, 'get', [options]).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                options.url += '&fbUrl=http://facebook.com'
                return q.npost(request, 'get', [options]);
            }).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                options.url = config.share_url + '/facebook?&origin=http://cinema6.com'
                return q.npost(request, 'get', [options]);
            }).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/share/twitter', function() {
        it('should fail if not given the correct params', function(done) {
            var options = {
                url: config.share_url + '/twitter?'
            };
            
            q.npost(request, 'get', [options]).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                options.url += '&twitUrl=http://twitter.com'
                return q.npost(request, 'get', [options]);
            }).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                options.url = config.share_url + '/twitter?&origin=http://cinema6.com'
                return q.npost(request, 'get', [options]);
            }).then(function(values) {
                expect(values).toBeDefined();
                expect(values[0].statusCode).toBe(400);
                expect(values[1]).toBe('Unable to complete request.');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });  //  end -- describe /share/twitter
});  // end -- describe share (E2E)

