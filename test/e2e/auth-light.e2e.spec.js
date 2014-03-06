var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        authUrl   : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('auth-light (E2E):', function() {
    describe('auth process', function() {
        var user = {
            username: 'auth-lightE2EUser',
            password: 'password',
            e2e: true
        };
        var cookieJar = require('request').jar();
        
        it('should sign a user up', function(done) {
            var options = {
                url: config.authUrl + '/signup',
                jar: cookieJar,
                json: user
            };
            
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBeDefined();
                expect(resp.body.user.username).toBe("auth-lightE2EUser");
                expect(resp.body.user.password).not.toBeDefined();
                expect(resp.body.user.created).toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should log a user out', function(done) {
            var options = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                expect(resp.response.headers['set-cookie']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should log a user in', function(done) {
            var options = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: user
            };
            
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBeDefined();
                expect(resp.body.user.username).toBe("auth-lightE2EUser");
                expect(resp.body.user.password).not.toBeDefined();
                expect(resp.body.user.created).toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should delete a user account', function(done) {
            var options = {
                url: config.authUrl + '/delete_account',
                jar: cookieJar
            };
            
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Successfully deleted account");
                expect(resp.response.headers['set-cookie']).not.toBeDefined();
                var loginOpts = {
                    url: config.authUrl + '/login',
                    json: user,
                    jar: cookieJar
                };
                return testUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Invalid username or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
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
                expect(resp.body.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
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
