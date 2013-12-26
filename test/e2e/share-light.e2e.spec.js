var request     = require('request'),
    path        = require('path'),
    fs          = require('fs-extra'),
    q           = require('q'),
    testUtils   = require('./testUtils'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'shareUrl': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
        'maintUrl': 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
    };

jasmine.getEnv().defaultTimeoutInterval = 3000;

describe('share-light (E2E)', function() {
    var testNum = 0;
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'share.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing share log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('share.log', config.maintUrl, jasmine.getEnv().currentSpec, ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
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
    });  //  end -- describe /share/meta
});  //  end -- describe share-light (E2E)
