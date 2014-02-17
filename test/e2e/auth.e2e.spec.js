var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    config      = {
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth',
        maintUrl    : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint'
    },
    startedTail = false;

jasmine.getEnv().defaultTimeoutInterval = 5000;

describe('auth (E2E):', function() {
    var testNum = 0;
    
    beforeEach(function(done) {
        if (startedTail || !process.env['getLogs']) {
            return done();
        }
        testUtils.qRequest('post', {url: config.maintUrl + '/logtail/start/auth.log'})
        .then(function(resp) {
            startedTail = true;
            done();
        }).catch(function(error) {
            console.log("Error starting tail on auth.log: " + JSON.stringify(error));
            done();
        });
    });
    afterEach(function(done) {
        if (!startedTail || !process.env['getLogs']) return done();
        testUtils.getLog('auth.log', config.maintUrl, jasmine.getEnv().currentSpec, 'auth', ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
    describe('/api/auth/login', function() {
        var mockUser,
            now = new Date();
        
        beforeEach(function(done) {
            mockUser = {
                id : "u-1234567890abcd",
                created : now,
                username : "authE2EUser",
                password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq" // hash of 'password'
            };
            testUtils.resetCollection('users', mockUser).done(done);
        });
        
        it('should succeed given valid credentials', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'authE2EUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBe("u-1234567890abcd");
                expect(resp.body.user.username).toBe("authE2EUser");
                expect(resp.body.user.password).not.toBeDefined();
                expect(new Date(resp.body.user.created)).toEqual(now);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail for an invalid username', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'randomUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid username or password");
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
                    username: 'authE2EUser',
                    password: 'notpassword'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe("Invalid username or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if not given both a username and password', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    username: 'authE2EUser'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                delete options.json.username;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/signup', function() {
        var mockUser;
        beforeEach(function() {
            mockUser = {
                username: 'authE2EUser',
                password: 'password'
            };
        });
        
        it('should succeed given valid credentials', function(done) {
            testUtils.resetCollection('users').then(function() {
                var options = {
                    url: config.authUrl + '/signup',
                    json: mockUser
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBeDefined();
                expect(resp.body.user.username).toBe("authE2EUser");
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
        
        it('should fail if given a username already tied to an account', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                var options = {
                    url: config.authUrl + '/signup',
                    json: mockUser
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('A user with that username already exists');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if not given both a username and password', function(done) {
            var options = {
                url: config.authUrl + '/signup',
                json: {
                    username: 'authE2EUser'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                delete options.json.username;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide a username and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/logout', function() {
        it('should successfully log a user out', function(done) {
            testUtils.resetCollection('users').then(function() {
                var signupOpts = {
                    url: config.authUrl + '/signup',
                    jar: true,
                    json: {
                        username: 'authE2EUser',
                        password: 'password'
                    }
                };
                return testUtils.qRequest('post', signupOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = {
                    url: config.authUrl + '/logout',
                    jar: true
                };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Success");
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
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Success");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/delete_account', function() {
        it('should successfully delete a user account', function(done) {
            var options = {
                url: config.authUrl + '/signup',
                jar: true,
                json: {
                    username: 'authE2EUser',
                    password: 'password'
                }
            };
            testUtils.resetCollection('users').then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var deleteOpts = {
                    url: config.authUrl + '/delete_account',
                    jar: true
                };
                return testUtils.qRequest('del', deleteOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Successfully deleted account");
                expect(resp.response.headers['set-cookie']).not.toBeDefined();
                options.url = config.authUrl + '/login';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Invalid username or password");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the user is not logged in', function(done) {
            var options = {
                url: config.authUrl + '/delete_account',
                jar: true
            };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe("You are not logged in");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/status', function() {
        it('should get the user if logged in', function(done) {
            var signupOpts = {
                url: config.authUrl + '/signup',
                jar: true,
                json: {
                    username: 'authE2EUser',
                    password: 'password'
                }
            };
            testUtils.resetCollection('users').then(function() {
                return testUtils.qRequest('post', signupOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var getUserOpts = {
                    url: config.authUrl + '/status',
                    jar: true
                };
                return testUtils.qRequest('get', getUserOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.username).toBe('authE2EUser');
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
    });  // end describe /api/auth/get_user
});  // end describe auth (E2E)

// putting the cleanup in another describe block ensures it will always be called
describe('cleanup', function() {
    it('calls /maint/logtail/stop', function(done) {
        if (startedTail && process.env['getLogs']) {
            testUtils.qRequest('post', {url: config.maintUrl + '/logtail/stop/auth.log'})
            .done(function() {
                done();
            });
        }
    });
});
