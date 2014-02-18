var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    testNum     = process.env['testNum'] || 0,  // usually the Jenkins build number
    config = {
        'shareUrl': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'maintUrl': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint'
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
                url: config.shareUrl,
                json: {
                    data: shareItem,
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee'
                }
            };

            testUtils.qRequest('post', [options])
            .then(function(resp) {
                var scriptId;
                expect(resp.body.url).toBeDefined();
                expect(resp.body.shortUrl).toBeDefined();
                resp.body.url = resp.body.url || '';
                resp.body.shortUrl = resp.body.shortUrl || '';
                expect(resp.body.url.match(/^http:\/\/cinema6.com\/#\/experiences\/shared~screenjack~e-\w{14}$/)).toBeTruthy();
                expect(resp.body.shortUrl.match(/http:\/\/(awe|c-6|ci6)\.(sm|co)\/\w+$/)).toBeTruthy();

                // cleanup
                var scriptId = resp.body.url.match(/e-\w{14}$/);
                if (!scriptId) {
                    return done();
                }
                var options = {
                    url : config.maintUrl + 'remove_S3_script',
                    json: {
                        fname: scriptId[0] + '.json'
                    }
                }
                testUtils.qRequest('post', [options])
                .catch(function(error) {
                    console.log('Error removing S3 script: ' + error);
                }).finally(function() {
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    
        // the client should prevent this through caching, but the backend should still handle it correctly
        it('should be able to re-share a link', function(done) {
            var options = {
                url: config.shareUrl,
                json: {
                    data: shareItem,
                    origin: 'http://cinema6.com/#/experiences/shared~screenjack~e-1234567890abcd'
                }
            };

            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.body.url).toBeDefined();
                expect(resp.body.shortUrl).toBeDefined();
                resp.body.url = resp.body.url || '';
                resp.body.shortUrl = resp.body.shortUrl || '';
                expect(resp.body.url.match(/^http:\/\/cinema6.com\/#\/experiences\/shared~screenjack~e-\w{14}$/)).toBeTruthy();
                expect(resp.body.url).not.toEqual('http://cinema6.com/#/experiences/shared~screenjack~e-1234567890abcd');
                expect(resp.body.shortUrl.match(/http:\/\/(awe|c-6|ci6)\.(sm|co)\/\w+$/)).toBeTruthy();
                
                // cleanup
                var scriptId = resp.body.url.match(/e-\w{14}$/);
                if (!scriptId) {
                    return done();
                }
                var options = {
                    url : config.maintUrl + 'remove_S3_script',
                    json: {
                        fname: scriptId[0] + '.json'
                    }
                }
                testUtils.qRequest('post', [options])
                .catch(function(error) {
                    console.log('Error removing S3 script: ' + error);
                }).finally(function() {
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    
        it('should fail if given an item with no uri', function(done) {
            var options = {
                url: config.shareUrl,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: shareItem
                }
            };
            delete shareItem.uri;
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj.error).toBeDefined();
                expect(errorObj.detail.match(/missing uri/)).toBeTruthy();
                done();
            });
        });
    
        it('should fail if given an item with a malformed uri', function(done) {
            var options = {
                url: config.shareUrl,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: shareItem
                }
            };
            shareItem.uri = 'fakeUri';
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj.error).toBeDefined();
                expect(errorObj.detail.match(/fakeUri/)).toBeTruthy();
                done();
            });
        });
    
       it('should fail if given a malformed item', function(done) {
            var options = {
                url: config.shareUrl,
                json: {
                    origin: 'http://cinema6.com/#/experiences/screenjack~brucelee',
                    data: 'This is fake data'
                }
            };
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(errorObj) {
                expect(errorObj.error).toBeDefined();
                expect(errorObj.detail.match(/missing uri/)).toBeTruthy();
                done();
            });
        });
    });
    
    describe('/share/facebook', function() {
        it('should fail if not given the correct params', function(done) {
            var options = {
                url: config.shareUrl + '/facebook?'
            };
            
            testUtils.qRequest('get', [options])
            .catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                options.url += '&fbUrl=http://facebook.com'
                return testUtils.qRequest('get', [options]);
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                options.url = config.shareUrl + '/facebook?&origin=http://cinema6.com'
                return testUtils.qRequest('get', [options]);
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                done();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/share/twitter', function() {
        it('should fail if not given the correct params', function(done) {
            var options = {
                url: config.shareUrl + '/twitter?'
            };
            
            testUtils.qRequest('get', [options])
            .catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                options.url += '&twitUrl=http://twitter.com'
                return testUtils.qRequest('get', [options]);
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                options.url = config.shareUrl + '/twitter?&origin=http://cinema6.com'
                return testUtils.qRequest('get', [options]);
            }).catch(function(errorObj) {
                expect(errorObj.error).toBe('Unable to complete request.');
                done();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            });
        });
    });
    
    
    // THIS SHOULD ALWAYS GO LAST
    describe('log cleanup', function() {
        it('copies the logs locally and then clears the remote log file', function(done) {
            if (!process.env['getLogs']) return done();
            testUtils.getLog('share.log', config.maintUrl, 'share', testNum)
            .then(function() {
                var options = {
                    url: config.maintUrl + '/clear_log',
                    json: {
                        logFile: 'share.log'
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
});  // end -- describe share (E2E)
