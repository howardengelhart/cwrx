var request = require('request'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'share_url': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('share-light (E2E)', function() {
    it('should successfully share a shortened url', function(done) {
        var options = {
            url: config.share_url,
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
    
    it('should successfully share to facebook', function(done) {
        var options = {
            url: config.share_url + '/facebook?fbUrl=' +
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
    
    it('should successfully share to twitter', function(done) {
        var options = {
            url: config.share_url + '/twitter?twitUrl=' +
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
