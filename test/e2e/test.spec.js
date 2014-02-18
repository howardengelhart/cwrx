var testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    config      = {
        dubUrl    : 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        maintUrl  : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
    },
    startedTail = false;

describe('simple test', function() {
    beforeEach(function(done) {
        if (startedTail || !process.env['getLogs']) {
            return done();
        }
        testUtils.qRequest('post', {url: config.maintUrl + '/logtail/start/dub.log'}).then(function(resp) {
            console.log(resp.body);
            startedTail = true;
            done();
        }).catch(function(error) {
            console.log("oh noes!");
            console.log(error);
            done();
        });
    });
    
    afterEach(function(done) {
        if (!startedTail || !process.env['getLogs']) {
            return done();
        }
        testUtils.qRequest('get', {url: config.maintUrl + '/logtail/dub.log'}).then(function(resp) {
            console.log("this is what the log was");
            console.log(resp.body);
            done();
        }).catch(function(error) {
            console.log("oh noes!");
            console.log(error);
            done();
        });
    });
    
    it('sends req to /dub/meta', function(done) {
        // console.log(host.foo.bar);
        testUtils.qRequest('get', {url: config.dubUrl + '/meta'}).then(function(resp) {
            expect(resp.body).toBeDefined();
            done();
        }).catch(function(error) {
            expect(error.toString()).not.toBeDefined();
            done();
        });
    });
    
    it('sends req to /dub/stats', function(done) {
        testUtils.qRequest('get', {url: config.dubUrl + '/status/v-1234'}).then(function(resp) {
            expect(resp).toBeDefined();
            expect(resp.response.statusCode).toBe(400);
            done();
        }).catch(function(error) {
            expect(error).not.toBeDefined();
            done();
        });
    });
    
    it('does nothing', function() {
        expect(true).toBeTruthy();
    });
});

if (process.env['getLogs']) {
    describe('cleanup', function() {
        it('calls /maint/logtail/stop', function(done) {
            testUtils.qRequest('post', {url: config.maintUrl + '/logtail/stop/dub.log'}).done(function() {
                done();
            });
        });
    });
}
