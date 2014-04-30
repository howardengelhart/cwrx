var q           = require('q'),
    testUtils   = require('./testUtils'),
    enums       = require('../../lib/enums'),
    Status      = enums.Status,
    host        = process.env['host'] || 'localhost',
    config      = {
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('auth (E2E):', function() {
    var now, mockUser;
    beforeEach(function() {
        now = new Date();
        mockUser = {
            id : "u-1234567890abcd",
            status: Status.Active,
            created : now,
            email : "authE2EUser",
            password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq" // hash of 'password'
        };
    });
    
    describe('/api/auth/login', function() {
        beforeEach(function(done) {
            testUtils.resetCollection('users', mockUser).done(done);
        });
        
        it('should succeed given valid credentials', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'authE2EUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe("u-1234567890abcd");
                expect(resp.body.email).toBe("authE2EUser");
                expect(resp.body.password).not.toBeDefined();
                expect(new Date(resp.body.created)).toEqual(now);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail for an invalid email', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'randomUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid email or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail for an invalid password', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'authE2EUser',
                    password: 'notpassword'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid email or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the user account is not active', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'authE2EUser',
                    password: 'password'
                }
            };
            mockUser.status = Status.Inactive;
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.response.body).toBe("Account not active");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if not given both a email and password', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'authE2EUser'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a email and password in the body');
                delete options.json.email;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a email and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/logout', function() {
        it('should successfully log a user out', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                var loginOpts = {
                    url: config.authUrl + '/login',
                    jar: true,
                    json: {
                        email: 'authE2EUser',
                        password: 'password'
                    }
                };
                return testUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                var options = {
                    url: config.authUrl + '/logout',
                    jar: true
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                expect(resp.response.headers['set-cookie']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the user is not logged in', function(done) {
            var options = {
                url: config.authUrl + '/logout',
                jar: true
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/status', function() {
        it('should get the user if logged in', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                var loginOpts = {
                    url: config.authUrl + '/login',
                    jar: true,
                    json: {
                        email: 'authE2EUser',
                        password: 'password'
                    }
                };
                return testUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                var getUserOpts = {
                    url: config.authUrl + '/status',
                    jar: true
                };
                return testUtils.qRequest('get', getUserOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.email).toBe('authE2EUser');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with a 401 if the user is not logged in', function(done) {
            testUtils.qRequest('get', {url: config.authUrl + '/status'}).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});  // end describe auth (E2E)
