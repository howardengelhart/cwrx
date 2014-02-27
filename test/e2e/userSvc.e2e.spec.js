var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        userSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/userSvc',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

jasmine.getEnv().defaultTimeoutInterval = 5000;

describe('user (E2E):', function() {
    var cookieJar, mockRequester;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            username : 'userSvcE2EUser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                users: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                username: 'userSvcE2EUser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockRequester).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/user/:id', function() {
        var mockUser;
        beforeEach(function() {
            mockUser = {
                id: 'e2e-getId1',
                username: 'test',
                password: 'thisisasecret',
                org: 'o-1234'
            };
        });
        
        it('should get a user by id', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockUser);
                expect(resp.body.id).toBe('e2e-getId1');
                expect(resp.body.username).toBe('test');
                expect(resp.body.password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if the requester cannot see the user', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId2', jar: cookieJar };
            mockUser.org = 'o-4567';
            mockUser.id = 'e2e-getId2';
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual({});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual({});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake1' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('GET /api/users', function() {
        var mockUsers;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'e2e-getOrg1', username: 'defg', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-getOrg2', username: 'abcd', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-getOrg3', username: 'hijk', password: 'thisisasecret', org: 'o-4567' }
            ];
            testUtils.resetCollection('users', mockUsers).done(done);
        });
        
        it('should get users by org', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-1234', jar: cookieJar };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getOrg1');
                expect(resp.body[0].username).toBe('defg');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getOrg2');
                expect(resp.body[1].username).toBe('abcd');
                expect(resp.body[1].password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                url: config.userSvcUrl + '/users?org=o-1234&sort=username,1&limit=1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getOrg2');
                expect(resp.body[0].username).toBe('abcd');
                expect(resp.body[0].password).not.toBeDefined();
                options.url += '&skip=1';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getOrg1');
                expect(resp.body[0].username).toBe('defg');
                expect(resp.body[0].password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not show users the requester cannot see', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-4567', jar: cookieJar };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-1234' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('POST /api/user', function() {
        var mockUser;
        beforeEach(function(done) {
            mockUser = {
                username: 'testPostUser',
                password: 'password'
            };
            testUtils.resetCollection('users').done(done);
        });
        
        it('should be able to create a user', function(done) {
            var options = { url: config.userSvcUrl + '/user', json: mockUser, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newUser = resp.body;
                expect(newUser).toBeDefined();
                expect(newUser.id).toBeDefined();
                expect(newUser.username).toBe('testPostUser');
                expect(newUser.password).not.toBeDefined();
                expect(new Date(newUser.created).toString()).not.toEqual('Invalid Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.org).toBe('o-1234');
                expect(newUser.status).toBe('active');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'own', create: 'own', edit: 'own', delete: 'own' },
                    users: { read: 'own', edit: 'own' },
                    orgs: { read: 'own' }
                });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to override default properties', function(done) {
            mockUser.status = 'pending';
            mockUser.permissions = {
                users: { read: 'org', edit: 'org' }
            };
            var options = { url: config.userSvcUrl + '/user', json: mockUser, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newUser = resp.body;
                expect(newUser).toBeDefined();
                expect(newUser.password).not.toBeDefined();
                expect(newUser.status).toBe('pending');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'own', create: 'own', edit: 'own', delete: 'own' },
                    users: { read: 'org', edit: 'org' },
                    orgs: { read: 'own' }
                });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error if the body is missing or incomplete', function(done) {
            var options = { url: config.userSvcUrl + '/user', json: {}, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New user object must have a username and password');
                options.json = { username: 'testPostUser' };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New user object must have a username and password');
                options.json = { password: 'password' };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New user object must have a username and password');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 409 error if a user with that username exists', function(done) {
            var options = { url: config.userSvcUrl + '/user', json: mockUser, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('A user with that username already exists');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 400 if the new user is not in the requester\'s org', function(done) {
            mockUser.org = 'o-4567';
            var options = { url: config.userSvcUrl + '/user', json: mockUser, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user' };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('PUT /api/user/:id', function() {
        var start = new Date(),
            mockUsers, updates;
        beforeEach(function(done) {
            mockUsers = [
                {
                    id: 'e2e-put1',
                    username: 'abcd',
                    password: 'secret',
                    org: 'o-1234',
                    tag: 'foo',
                    created: start
                },
                {
                    id: 'e2e-put2',
                    username: 'defg',
                    password: 'secret',
                    org: 'o-4567',
                    tag: 'baz',
                    created: start
                }
            ];
            testUtils.resetCollection('users', mockUsers).done(done);
            updates = { tag: 'bar' };
        });
        
        it('should successfully update a user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-put1',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var user = resp.body;
                expect(user.id).toBe('e2e-put1');
                expect(user.username).toBe('abcd');
                expect(user.password).not.toBeDefined();
                expect(user.tag).toBe('bar');
                expect(new Date(user.lastUpdated)).toBeGreaterThan(new Date(user.created));
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 404 if the user does not exist', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-fake',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to edit the user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-put2',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this user');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 if any of the update fields are illegal', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-put1',
                json: { password: 'newpass' },
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake' };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /api/user/:id', function() {
        var mockUsers;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'e2e-delete1', username: 'abcd', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-delete2', username: 'defg', password: 'thisisasecret', org: 'o-4567' }
            ];
            testUtils.resetCollection('users', mockUsers).done(done);
        });
        
        it('should successfully mark a user as deleted', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Success');
                options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('deleted');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the user does not exist', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake', jar: cookieJar };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Success');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the user has already been deleted', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Success');
                options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('del', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Success');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not allow a user to delete themselves', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-user', jar: cookieJar };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete yourself');
                options = { url: config.userSvcUrl + '/user/e2e-user', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to delete the user', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete2', jar: cookieJar };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this user');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake' };
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
});
