var q           = require('q'),
    testUtils   = require('./testUtils'),
    enums       = require('../../lib/enums'),
    Status      = enums.Status,
    host        = process.env['host'] || 'localhost',
    config      = {
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('auth (E2E):', function() {
    var now, mockUser, mailman, urlRegex;
    beforeEach(function(done) {
        now = new Date();
        mockUser = {
            id : "u-1",
            status: Status.Active,
            created : now,
            email : "c6e2etester@gmail.com",
            password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq" // hash of 'password'
        };
        urlRegex = /https:\/\/.*cinema6.com.*id=u-1.*token=[0-9a-f]{48}/;
        if (!mailman || mailman.state !== 'authenticated') {
            mailman = new testUtils.Mailman();
            mailman.start().done(function() {
                mailman.on('error', function(error) { throw new Error(error); });
                done();
            });
        } else {
            done();
        }
    });
    
    afterEach(function() {
        mailman.removeAllListeners('message');
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
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe("u-1");
                expect(resp.body.email).toBe("c6e2etester@gmail.com");
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
        
        it('should convert the request email to lowercase', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'c6E2ETester@gmail.com',
                    password: 'password'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe("c6e2etester@gmail.com");
                expect(resp.body.password).not.toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail for an invalid email', function(done) {
            var options = {
                url: config.authUrl + '/login',
                json: {
                    email: 'randomuser',
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
                    email: 'c6e2etester@gmail.com',
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
                    email: 'c6e2etester@gmail.com',
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
                    email: 'c6e2etester@gmail.com'
                }
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide an email and password in the body');
                delete options.json.email;
                options.json.password = 'password';
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('You need to provide an email and password in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
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
            testUtils.qRequest('post', loginOpts).then(function(resp) {
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
            testUtils.qRequest('post', loginOpts).then(function(resp) {
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
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
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
    
    describe('/api/auth/password/forgot', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.authUrl + '/password/forgot',
                json: { email: 'c6e2etester@gmail.com', target: 'portal' }
            };
            testUtils.resetCollection('users', mockUser).done(done);
        });

        it('should fail with a 400 if the request is incomplete', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            var bodies = [{email: 'c6e2etester@gmail.com'}, {target: 'portal'}];
            q.all(bodies.map(function(body) {
                options.json = body;
                return testUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Need to provide email and target in the request');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 400 for an invalid target', function(done) {
            options.json.target = 'someFakeTarget';
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid target');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            options.json.email = 'somefakeemail';
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That user does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should successfully generate and send a reset token', function(done) {
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
            mailman.once('message', function(msg) {
                expect(msg.from[0].address).toBe('support@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.subject).toBe('Reset your Cinema6 Password');
                expect(msg.text.match(urlRegex)).toBeTruthy();
                expect(msg.html.match(urlRegex)).toBeTruthy();
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });
        });
        
        it('should convert the request email to lowercase', function(done) {
            options.json.email = 'c6E2ETester@gmail.com';
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
            mailman.once('message', function(msg) {
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.subject).toBe('Reset your Cinema6 Password');
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });
        });
    });
    
    describe('/api/auth/password/reset', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.authUrl + '/password/reset',
                json: { id: 'u-1', token: 'fakeToken', newPassword: 'newPass', },
                jar: true
            };
            mockUser.resetToken = {
                expires: new Date(new Date().valueOf() + 40000),
                token: '$2a$10$wP7fqLDue/lWc4eNQS9qCe0JNQGNzUTVQsUUEUi2SWHof3Xtf/PP2' // hash of fakeToken
            };
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            var bodies = [
                {id: 'u-1', token: 'fakeToken'},
                {id: 'u-1', newPassword: 'newPass'},
                {token: 'fakeToken', newPassword: 'newPass'}
            ];
            q.all(bodies.map(function(body) {
                options.json = body;
                return testUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Must provide id, token, and newPassword');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should successfully reset a user\'s password', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', email: 'c6e2etester@gmail.com', status: 'active',
                                           lastUpdated: jasmine.any(String), created: now.toISOString()});
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });

            mailman.once('message', function(msg) {
                expect(msg.from[0].address).toBe('support@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.subject).toBe('Your account password has been changed');
                expect(msg.text).toBeDefined();
                expect(msg.html).toBeDefined();
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent

                var loginOpts = {
                    url: config.authUrl + '/login',
                    json: { email: 'c6e2etester@gmail.com', password: 'newPass' }
                };
                testUtils.qRequest('post', loginOpts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                    expect(resp.response.headers['set-cookie'].length).toBe(1);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });
        
        it('should fail with a 404 if the user is not found', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.id = 'u-fake';
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That user does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if the user has no reset token', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            delete mockUser.resetToken;
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('No reset token found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if the reset token has expired', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            mockUser.resetToken.expires = new Date(new Date().valueOf() - 10000);
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Reset token expired');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if the reset token is invalid', function(done) {
            mailman.once('message', function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.token = 'theWrongToken';
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Invalid request token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if attempting to resend a valid request', function(done) {
            testUtils.resetCollection('users', mockUser).then(function() {
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.response.headers['set-cookie'].length).toBe(1);
                expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            });

            mailman.once('message', function(msg) {
                expect(msg.subject).toBe('Your account password has been changed');
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                testUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('No reset token found');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });
        
        it('should work properly with /api/auth/password/forgot', function(done) {
            delete mockUser.resetToken;
            testUtils.resetCollection('users', mockUser).then(function() {
                var forgotOpts = {
                    url: config.authUrl + '/password/forgot',
                    json: {email: 'c6e2etester@gmail.com', target: 'portal'}
                };
                return testUtils.qRequest('post', forgotOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });

            mailman.once('message', function(msg) {
                expect(msg.subject).toBe('Reset your Cinema6 Password');
                var token = (msg.text.match(/[0-9a-f]{48}/) || [])[0];
                expect(token).toBeDefined();
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                
                options.json.token = token;
                testUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                    expect(resp.response.headers['set-cookie'].length).toBe(1);
                    expect(resp.response.headers['set-cookie'][0].match(/^c6Auth=.+/)).toBeTruthy('cookie match');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });
    });  // end describe /api/auth/password/reset
    
    // THIS SHOULD ALWAYS GO AT THE END OF ALL TESTS
    describe('mailman cleanup', function() {
        it('stops the mailman', function() {
            mailman.stop();
        });
    });
});  // end describe auth (E2E)
