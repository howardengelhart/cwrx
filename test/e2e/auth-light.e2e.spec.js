var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        authUrl   : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('auth-light (E2E):', function() {
    describe('auth process: ', function() {
        var cookieJar = require('request').jar(),
            testUser = {
                email: 'johnnyTestmonkey@cinema6.com',
                password: 'bananas4bananas'
            };
        
        it('login the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: testUser
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('johnnyTestmonkey@cinema6.com');
                expect(resp.body.password).not.toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('get the login status of the test user', function(done) {
            var options = {
                url: config.authUrl + '/status',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('johnnyTestmonkey@cinema6.com');
                expect(resp.body.password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('logout the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('/api/auth/meta', function() {
        it('should print out appropriate metadata about the auth service', function(done) {
            var options = {
                url: config.authUrl + '/meta'
            };
            testUtils.qRequest('get', [options])
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.started).toBeDefined();
                expect(new Date(resp.body.started).toString()).not.toEqual('Invalid Date');
                expect(resp.body.status).toBe("OK");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});  // end -- describe auth (E2E)
