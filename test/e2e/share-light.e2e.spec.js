var request = require('request'),
    host = process.env['host'] ? process.env['host'] : 'localhost',
    config = {
        'share_url': 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/share',
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('share-light (E2E)', function() {
    it('should successfully use the release sharer to create a shortened link', function(done) {
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
            body = body || {};
            expect(body.error).not.toBeDefined();
            expect(body.url).toBe('http://fake.cinema6.com/');
            expect(body.shortUrl).toBe('http://ci6.co/j2');
            done();
        });
    });
});
