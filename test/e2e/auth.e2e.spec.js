var q               = require('q'),
    testUtils       = require('./testUtils'),
    request         = require('request'),
    requestUtils    = require('../../lib/requestUtils'),
    enums           = require('../../lib/enums'),
    cacheLib        = require('../../lib/cacheLib'),
    cacheServer     = process.env.cacheServer || 'localhost:11211',
    Status          = enums.Status,
    host            = process.env.host || 'localhost',
    config = {
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('auth (E2E):', function() {
    var now, mockUser, mockPol, mailman, urlRegex;
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        now = new Date();
        urlRegex = /https:\/\/.*cinema6.com.*id=u-1.*token=[0-9a-f]{48}/;

        mockUser = {
            id : 'u-1',
            status: Status.Active,
            created : now,
            email : 'c6e2etester@gmail.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            policies: ['testPol']
        };
        mockPol = {
            id: 'p-1',
            name: 'testPol',
            status: Status.Active,
            priority: 1,
            permissions: {
                users: { read: 'all' }
            }
        };
        
        testUtils.resetCollection('policies', mockPol).done(done);
    });
    
    beforeEach(function(done) {
        if (mailman && mailman.state === 'authenticated') {
            return done();
        }
        
        mailman = new testUtils.Mailman();
        return mailman.start().then(function() {
            mailman.on('error', function(error) { throw new Error(error); });
        }).done(done);
    });
    
    afterEach(function() {
        mailman.removeAllListeners();
        mailman.on('error', function(error) { throw new Error(error); });
    });
    
    describe('/api/auth/login', function() {
        beforeEach(function(done) {
            testUtils.resetCollection('users', mockUser).done(done);
        });

        it('should succeed given valid credentials', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('u-1');
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
                expect(resp.body.password).not.toBeDefined();
                expect(new Date(resp.body.created)).toEqual(now);
                expect(resp.body.permissions).toEqual({ users: { read: 'all' } });
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.authUrl + '/login',
                            json: { email: 'c6e2etester@gmail.com', password: 'password' } };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-1');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('auth');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/auth/login',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should convert the request email to lowercase', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'c6E2ETester@gmail.com',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
                expect(resp.body.password).not.toBeDefined();
                expect(resp.body.permissions).toEqual({ users: { read: 'all' } });
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail for an invalid email', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'randomuser',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe('Invalid email or password');
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
                    email: 'c6e2etester@gmail.com',
                    password: 'notpassword'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.response.body).toBe('Invalid email or password');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: { $gt: '' },
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide an email and password in the body');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the user account is not active', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            mockUser.status = Status.Inactive;
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.response.body).toBe('Account not active or new');
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
                    email: 'c6e2etester@gmail.com'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide an email and password in the body');
                delete options.json.email;
                options.json.password = 'password';
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide an email and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if given an invalid target', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password',
                    target: 'INVALID'
                }
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('Invalid target');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('failed password attempts', function() {
            var cacheConn;
            
            beforeEach(function(done) {
                cacheConn = new cacheLib.Cache(cacheServer, { read: 5000, write: 5000 });
                cacheConn.checkConnection().then(function() {
                    return cacheConn.delete('loginAttempts:u-1');
                }).done(done);
            });
            
            afterEach(function(done) {
                cacheConn.checkConnection().then(function() {
                    return cacheConn.delete('loginAttempts:u-1');
                }).then(function() {
                    return cacheConn.close();
                }).done(done);
            });
            
            it('should email the holder of the account after 3 failed login attempts', function(done) {
                var attemptLogin = function() {
                    var options = {
                        url: config.authUrl + '/login',
                        json: {
                            email: 'c6e2etester@gmail.com',
                            password: 'notpassword',
                            target: 'portal'
                        }
                    };
                    return requestUtils.qRequest('post', options);
                };
                
                var getCacheValue = function() {
                    return cacheConn.checkConnection().then(function() {
                        return cacheConn.get('loginAttempts:u-1');
                    });
                };
                
                attemptLogin().then(function() {
                    return getCacheValue();
                }).then(function(value) {
                    expect(value).toBe(1);
                    return attemptLogin();
                }).then(function() {
                    return getCacheValue();
                }).then(function(value) {
                    expect(value).toBe(2);
                    return attemptLogin();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                var msgSubject = 'Need help logging in?';
                urlRegex = /https:\/\/.*cinema6.com.*/;
                mailman.once(msgSubject, function(msg) {
                    expect(msg.from[0].address).toBe('support@cinema6.com');
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    expect(msg.text).toMatch(urlRegex);
                    expect(msg.html).toMatch(urlRegex);
                    expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                    
                    getCacheValue().then(function(value) {
                        expect(value).toBe(3);
                        return attemptLogin();
                    }).then(function() {
                        return getCacheValue();
                    }).then(function(value) {
                        expect(value).toBe(4);
                    }).done(done);
                });
            });
        });
    });
    
    describe('/api/auth/logout', function() {
        beforeEach(function(done) {
            testUtils.resetCollection('users', mockUser).done(done);
        });

        it('should successfully log a user out', function(done) {
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: true,
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                var options = {
                    url: config.authUrl + '/logout',
                    jar: true
                };
                return requestUtils.qRequest('post', options);
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

        it('should write an entry to the audit collection', function(done) {
            var loginOpts = { url: config.authUrl + '/login', jar: true,
                              json: { email: 'c6e2etester@gmail.com', password: 'password' } };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = { url: config.authUrl + '/logout', jar: true };
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-1');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('auth');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/auth/logout',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still succeed if the user is not logged in', function(done) {
            var options = {
                url: config.authUrl + '/logout',
                jar: true
            };
            requestUtils.qRequest('post', options).then(function(resp) {
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
        beforeEach(function(done) {
            testUtils.resetCollection('users', mockUser).done(done);
        });

        it('should get the user if logged in', function(done) {
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: true,
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                var getUserOpts = {
                    url: config.authUrl + '/status',
                    jar: true
                };
                return requestUtils.qRequest('get', getUserOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
                expect(resp.body.permissions).toEqual({ users: { read: 'all' } });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to get a user with a status of new', function(done) {
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: true,
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            mockUser.status = Status.New;
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                var getUserOpts = {
                    url: config.authUrl + '/status',
                    jar: true
                };
                return requestUtils.qRequest('get', getUserOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
                expect(resp.body.permissions).toEqual({ users: { read: 'all' } });
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var loginOpts = { url: config.authUrl + '/login', jar: true,
                              json: { email: 'c6e2etester@gmail.com', password: 'password' } };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = { url: config.authUrl + '/status', jar: true };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return q.delay(3000);
            }).then(function() {
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-1');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('auth');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/auth/status',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the user becomes inactive', function(done) {
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: true,
                json: {
                    email: 'c6e2etester@gmail.com',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                mockUser.status = Status.Inactive;
                return testUtils.resetCollection('users', mockUser);
            }).then(function() {
                var getUserOpts = {
                    url: config.authUrl + '/status',
                    jar: true
                };
                return requestUtils.qRequest('get', getUserOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with a 401 if the user is not logged in', function(done) {
            requestUtils.qRequest('get', {url: config.authUrl + '/status'}).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/api/auth/password/forgot', function() {
        var options, msgSubject;
        beforeEach(function(done) {
            options = {
                url: config.authUrl + '/password/forgot',
                json: { email: 'c6e2etester@gmail.com', target: 'portal' }
            };
            msgSubject = 'Reset your Cinema6 Password';
            testUtils.resetCollection('users', mockUser).done(done);
        });

        it('should fail with a 400 if the request is incomplete', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            var bodies = [{email: 'c6e2etester@gmail.com'}, {target: 'portal'}];
            q.all(bodies.map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Need to provide email and target in the request');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            options.json.email = { $gt: '' };
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Need to provide email and target in the request');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 400 for an invalid target', function(done) {
            options.json.target = 'someFakeTarget';
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid target');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            options.json.email = 'somefakeemail';
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That user does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully generate and send a reset token', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('support@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toMatch(urlRegex);
                expect(msg.html).toMatch(urlRegex);
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-1');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toBe(null);
                expect(results[0].service).toBe('auth');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/auth/password/forgot',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should convert the request email to lowercase', function(done) {
            options.json.email = 'c6E2ETester@gmail.com';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
            mailman.once(msgSubject, function(msg) {
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });
        });
    });
    
    describe('/api/auth/password/reset', function() {
        var options, msgSubject;
        beforeEach(function() {
            options = {
                url: config.authUrl + '/password/reset',
                json: { id: 'u-1', token: 'fakeToken', newPassword: 'newPass', },
                jar: true
            };
            msgSubject = 'Your account password has been changed';
            mockUser.resetToken = {
                expires: new Date(new Date().valueOf() + 40000),
                token: '$2a$10$wP7fqLDue/lWc4eNQS9qCe0JNQGNzUTVQsUUEUi2SWHof3Xtf/PP2' // hash of fakeToken
            };
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            var bodies = [
                {id: 'u-1', token: 'fakeToken'},
                {id: 'u-1', newPassword: 'newPass'},
                {token: 'fakeToken', newPassword: 'newPass'}
            ];
            q.all(bodies.map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Must provide id, token, and newPassword');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.id = { $gt: '' };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide id, token, and newPassword');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully reset a user\'s password', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-1',
                    email: 'c6e2etester@gmail.com',
                    status: 'active',
                    created: now.toISOString(),
                    lastUpdated: jasmine.any(String),
                    policies: ['testPol'],
                    permissions: {
                        users: { read: 'all' }
                    },
                    fieldValidation: {},
                    entitlements: {},
                    applications: []
                });
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });

            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('support@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toBeDefined();
                expect(msg.html).toBeDefined();
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent

                var loginOpts = {
                    url: config.authUrl + '/login',
                    json: { email: 'c6e2etester@gmail.com', password: 'newPass' }
                };
                requestUtils.qRequest('post', loginOpts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                    expect(resp.response.headers['set-cookie'].length).toBe(1);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });
        });

        it('should write an entry to the audit collection', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-1');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('auth');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/auth/password/reset',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 404 if the user is not found', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.id = 'u-fake';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That user does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the user has no reset token', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            delete mockUser.resetToken;
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('No reset token found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the reset token has expired', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            mockUser.resetToken.expires = new Date(new Date().valueOf() - 10000);
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Reset token expired');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the reset token is invalid', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.token = 'theWrongToken';
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Invalid request token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if attempting to resend a valid request', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            });

            mailman.once(msgSubject, function(msg) {
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('No reset token found');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should work properly with /api/auth/password/forgot', function(done) {
            delete mockUser.resetToken;
            testUtils.resetCollection('users', mockUser).then(function() {
                var forgotOpts = {
                    url: config.authUrl + '/password/forgot',
                    json: {email: 'c6e2etester@gmail.com', target: 'portal'}
                };
                return requestUtils.qRequest('post', forgotOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });

            mailman.once('Reset your Cinema6 Password', function(msg) {
                var token = (msg.text.match(/[0-9a-f]{48}/) || [])[0];
                expect(token).toBeDefined();
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                
                options.json.token = token;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                    expect(resp.response.headers['set-cookie'].length).toBe(1);
                    expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should delete a user\'s other active login sessions', function(done) {
            var userSessionJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/login',
                json: { email: 'c6e2etester@gmail.com', password: 'password' },
                jar: userSessionJar
            };
            var statusOpts = {
                url: config.authUrl + '/status',
                jar: userSessionJar
            };
            testUtils.resetCollection('users', mockUser).then(function() {
                return requestUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                statusOpts.jar = true;
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
        
    afterAll(function(done) {
        mailman.stop();
        testUtils.closeDbs().done(done);
    });
});
