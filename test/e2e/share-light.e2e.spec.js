var request = require('request'),
    path    = require('path'),
    fs      = require('fs-extra'),
    q       = require('q'),
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
        request.post(options, function(error, response, body) {
            if (body && body.error) {
                console.log("Error clearing share log: " + JSON.stringify(body));
            }
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        var spec = jasmine.getEnv().currentSpec;
        testNum++;
        var options = {
            url: config.maintUrl + '/get_log?logFile=share.log'
        };
        q.npost(request, 'get', [options])
        .then(function(values) {
            if (!values[1]) return q.reject();
            if (values[1].error) return q.reject(values[1]);
            if (spec && spec.results && spec.results().failedCount != 0) {
                console.log('\nRemote log for failed spec "' + spec.description + '":\n');
                console.log(values[1]);
                console.log('-------------------------------------------------------------------');
            }
            var fname = path.join(__dirname, 'logs/share-light.test' + testNum + '.log');
            return q.npost(fs, 'outputFile', [fname, values[1]]);
        }).then(function() {
            done();
        }).catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
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
            
            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                body = body || {};
                expect(body.error).not.toBeDefined();
                expect(body.url).toBe('http://fake.cinema6.com/');
                expect(body.shortUrl.match(/http:\/\/ci6\.co\/(g6|i5)/)).toBeTruthy();
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
            
            request.get(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                expect(response).toBeDefined();
                expect(response.statusCode).toBe(200);
                expect(response.request.href.match(/^https:\/\/www\.facebook\.com/)).toBeTruthy();
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
            
            request.get(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                expect(response).toBeDefined();
                expect(response.statusCode).toBe(200);
                expect(response.request.href.match(
                    /^https:\/\/twitter\.com\/intent\/tweet\?text=Hello&url=http%3A%2F%2Fci6\.co%2F(j6|r8)/)).toBeTruthy();
                done();
            });
        });
    });
    
    describe('/share/meta', function() {
        it('should print out appropriate metadata about the share service', function(done) {
            var options = {
                url: config.shareUrl + '/meta'
            };
            request.get(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                var data = JSON.parse(body);
                expect(data.version).toBeDefined();
                expect(data.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(data.config).toBeDefined();
                                
                var bucket = process.env.bucket || 'c6.dev';
                var media = (bucket === 'c6.dev') ? 'media/' : '';
                expect(data.config.s3).toBeDefined();
                expect(data.config.s3.share).toBeDefined();
                expect(data.config.s3.share.bucket).toBe(bucket);
                expect(data.config.s3.share.path).toBe(media + 'usr/screenjack/data');
                done();
            });
        });
    });  //  end -- describe /share/meta
});  //  end -- describe share-light (E2E)
