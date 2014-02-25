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
                users: {
                    read: 'org',
                    create: 'org',
                    edit: 'org',
                    delete: 'org'
                }
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
        
        it('should not get a user the requester cannot see', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId2', jar: cookieJar };
            mockUser.org = 'o-4567';
            mockUser.id = 'e2e-getId2';
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Not authorized to get this user');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not return an error if nothing is found', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
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
                {
                    id: 'e2e-getOrg1',
                    username: 'defg',
                    password: 'thisisasecret',
                    org: 'o-1234'
                },
                {
                    id: 'e2e-getOrg2',
                    username: 'abcd',
                    password: 'thisisasecret',
                    org: 'o-1234'
                },
                {
                    id: 'e2e-getOrg3',
                    username: 'hijk',
                    password: 'thisisasecret',
                    org: 'o-4567'
                }
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
        
        xit('should be able to create a user', function(done) {
        
        });
        
        xit('should be able to override default properties', function(done) {
        
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
    
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake' };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /api/user/:id', function() {
   
   
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
