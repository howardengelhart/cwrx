var request     = require('request'),
    path        = require('path'),
    fs          = require('fs-extra'),
    q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    testNum     = process.env['testNum'] || 0,  // usually the Jenkins build number
    config = {
        'shareUrl': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'maintUrl': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
    };

jasmine.getEnv().defaultTimeoutInterval = 3000;

describe('share-light (E2E)', function() {
    describe('/share', function() {
        it('should successfully share a shortened url', function(done) {
            var options = {
                url: config.shareUrl,
                json: {
                    origin: 'http://fake.cinema6.com/',
                    staticLink: true
                }
            };
            
            testUtils.qRequest('post', [options])
            .then(function(resp) {
                expect(resp.body.url).toBe('http://fake.cinema6.com/');
                expect(resp.body.shortUrl.match(/http:\/\/ci6\.co\/(g6|i5)/)).toBeTruthy();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/share/facebook', function() {
        it('should successfully share to facebook', function(done) {
            var options = {
                url: config.shareUrl + '/facebook?fbUrl=' +
                     encodeURIComponent('https://facebook.com/dialog/feed?redirect_uri=http://cinema6.com') +
                     '&origin=' + encodeURIComponent('http://fake.cinema6.com') + '&staticLink=true'
            };
            
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.response.request.href.match(/^https:\/\/www\.facebook\.com/)).toBeTruthy();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/share/twitter', function() {
        it('should successfully share to twitter', function(done) {
            var options = {
                url: config.shareUrl + '/twitter?twitUrl=' +
                     encodeURIComponent('https://twitter.com/share?text=Hello') +
                     '&origin=' + encodeURIComponent('http://fake.cinema6.com') + '&staticLink=true'
            };
            
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.response.request.href.match(
                    /^https:\/\/twitter\.com\/intent\/tweet\?text=Hello&url=http%3A%2F%2Fci6\.co%2F(j6|r8)/)).toBeTruthy();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/share/meta', function() {
        it('should print out appropriate metadata about the share service', function(done) {
            var options = {
                url: config.shareUrl + '/meta'
            };
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(resp.body.config).toBeDefined();
                                
                var bucket = process.env.bucket || 'c6.dev';
                var media = (bucket === 'c6.dev') ? 'media/' : '';
                expect(resp.body.config.s3).toBeDefined();
                expect(resp.body.config.s3.share).toBeDefined();
                expect(resp.body.config.s3.share.bucket).toBe(bucket);
                expect(resp.body.config.s3.share.path).toBe(media + 'usr/screenjack/data');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    
    // THIS SHOULD ALWAYS GO LAST
    describe('log cleanup', function() {
        it('copies the logs locally and then clears the remote log file', function(done) {
            if (!process.env['getLogs']) return done();
            testUtils.getLog('share.log', config.maintUrl, 'share-light', testNum)
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
});  //  end -- describe share-light (E2E)
