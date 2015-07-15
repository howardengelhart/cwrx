var q               = require('q'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        userSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('user (E2E):', function() {
    var cookieJar, mockRequester, mockAdmin;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'usersvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                users: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
            }
        };
        mockAdmin = {
            id: 'e2e-admin-user',
            status: 'active',
            email: 'admine2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-4567',
            permissions: {
                users: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'usersvce2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', [mockRequester, mockAdmin]).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/account/user/:id', function() {
        var mockUser;
        beforeEach(function() {
            mockUser = {
                id: 'e2e-getId1',
                email: 'test',
                password: 'thisisasecret',
                org: 'o-1234'
            };
        });
        
        it('should get a user by id', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockUser);
                expect(resp.body.id).toBe('e2e-getId1');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('test');
                expect(resp.body.password).not.toBeDefined();
                expect(resp.response.headers['content-range']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/user/:id',
                                                 params: { id: 'e2e-getId1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the requester cannot see the user', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-getId2', jar: cookieJar };
            mockUser.org = 'o-4567';
            mockUser.id = 'e2e-getId2';
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake1', jar: cookieJar };
            testUtils.resetCollection('users', [mockUser, mockRequester]).then(function() {
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('GET /api/account/users', function() {
        var mockUsers;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'e2e-getOrg1', email: 'defg', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-getOrg2', email: 'abcd', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-getOrg3', email: 'hijk', password: 'thisisasecret', org: 'o-4567' }
            ];
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(done);
        });
        
        it('should get users by org', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-1234&sort=id,1', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(3);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('e2e-getOrg1');
                expect(resp.body[0].email).toBe('defg');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getOrg2');
                expect(resp.body[1].email).toBe('abcd');
                expect(resp.body[1].password).not.toBeDefined();
                expect(resp.body[2]._id).not.toBeDefined();
                expect(resp.body[2].id).toBe('e2e-user');
                expect(resp.body[2].email).toBe('usersvce2euser');
                expect(resp.body[2].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-1234&sort=id,1', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/users',
                                                 params: {}, query: { org: 'o-1234', sort: 'id,1' } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should get users by a list of ids', function(done) {
            var options = { url: config.userSvcUrl + '/users?ids=e2e-getOrg1,e2e-getOrg2&sort=id,1', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('e2e-getOrg1');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getOrg2');
                expect(resp.body[1].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                url: config.userSvcUrl + '/users?org=o-1234&sort=email,1&limit=1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getOrg2');
                expect(resp.body[0].email).toBe('abcd');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-1/3');
                options.url += '&skip=1';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getOrg1');
                expect(resp.body[0].email).toBe('defg');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 2-2/3');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not show users the requester cannot see', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-4567', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/users?org=o-1234' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent a non-admin user from getting all users', function(done) {
            var options = { url: config.userSvcUrl + '/users', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Not authorized to read all users');
                expect(resp.response.headers['content-range']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should allow admins to get all users', function(done) {
            var options = { url: config.userSvcUrl + '/users?sort=id,1', jar: cookieJar };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: { email: 'admine2euser', password: 'password' }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].id).toBe('e2e-admin-user');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getOrg1');
                expect(resp.body[1].password).not.toBeDefined();
                expect(resp.body[2].id).toBe('e2e-getOrg2');
                expect(resp.body[2].password).not.toBeDefined();
                expect(resp.body[3].id).toBe('e2e-getOrg3');
                expect(resp.body[3].password).not.toBeDefined();
                expect(resp.body[4].id).toBe('e2e-user');
                expect(resp.body[4].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-5/5');
                delete cookieJar.cookies; // force reset and re-login of mockRequester in beforeEach
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            var options = { url: config.userSvcUrl + '/users?org[$gt]=', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('POST /api/account/user', function() {
        var mockUser, options;
        beforeEach(function(done) {
            mockUser = {
                email: 'testpostuser',
                password: 'password',
                org: 'o-1234'
            };
            options = { url: config.userSvcUrl + '/user', json: mockUser, jar: cookieJar };
            testUtils.resetCollection('users', [mockRequester, mockAdmin]).done(done);
        });
        
        it('should be able to create a user', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newUser = resp.body;
                expect(newUser).toBeDefined();
                expect(newUser._id).not.toBeDefined();
                expect(newUser.id).toBeDefined();
                expect(newUser.email).toBe('testpostuser');
                expect(newUser.password).not.toBeDefined();
                expect(new Date(newUser.created).toString()).not.toEqual('Invalid Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.applications).toEqual(['e-51ae37625cb57f']);
                expect(newUser.config).toEqual({});
                expect(newUser.org).toBe('o-1234');
                expect(newUser.status).toBe('active');
                expect(newUser.type).toBe('Publisher');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    elections: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    users: { read: 'org', edit: 'own' },
                    orgs: { read: 'own', edit: 'own' },
                    sites: { read: 'org' }
                });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/user',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should lowercase the new email', function(done) {
            options.json.email = 'TestPostUser';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('testpostuser');
                expect(resp.body.password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to override default properties', function(done) {
            mockUser.status = 'pending';
            mockUser.permissions = {
                users: { edit: 'org', delete: 'org' }
            };
            mockUser.applications = ['e-1234'];
            mockUser.config = {foo: 'bar'};
            mockUser.type = 'ContentProvider';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newUser = resp.body;
                expect(newUser).toBeDefined();
                expect(newUser.password).not.toBeDefined();
                expect(newUser.status).toBe('pending');
                expect(newUser.applications).toEqual(['e-1234']);
                expect(newUser.config).toEqual({foo: 'bar'});
                expect(newUser.type).toBe('ContentProvider');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    elections: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    users: { read: 'org', edit: 'org', delete: 'org' },
                    orgs: { read: 'own', edit: 'own' },
                    sites: { read: 'org' }
                });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error if the body is missing or incomplete', function(done) {
            options.json = {};
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                options.json = { email: 'testpostuser' };
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                options.json = { password: 'password' };
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 409 error if a user with that email exists', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that email already exists');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 400 if the new user is not in the requester\'s org', function(done) {
            mockUser.org = 'o-4567';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('PUT /api/account/user/:id', function() {
        var start = new Date(),
            mockUsers, updates;
        beforeEach(function(done) {
            mockUsers = [
                {
                    id: 'e2e-put1',
                    email: 'abcd',
                    password: 'secret',
                    org: 'o-1234',
                    tag: 'foo',
                    created: start
                },
                {
                    id: 'e2e-put2',
                    email: 'defg',
                    password: 'secret',
                    org: 'o-4567',
                    tag: 'baz',
                    created: start
                }
            ];
            updates = { tag: 'bar' };
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(done);
        });
        
        it('should successfully update a user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-put1',
                json: updates,
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var user = resp.body;
                expect(user._id).not.toBeDefined();
                expect(user.id).toBe('e2e-put1');
                expect(user.email).toBe('abcd');
                expect(user.password).not.toBeDefined();
                expect(user.tag).toBe('bar');
                expect(new Date(user.lastUpdated)).toBeGreaterThan(new Date(user.created));
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-put1', json: updates, jar: cookieJar };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/account/user/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 404 if the user does not exist', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-fake',
                json: updates,
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
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
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this');
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
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 400 if the user is trying to update their own permissions', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-user',
                json: { permissions: { experiences: { read: 'org' } } },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should let a user PUT their own permissions if there\'s no change', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/e2e-user',
                json: { permissions: mockRequester.permissions },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-user');
                expect(resp.body.permissions).toEqual(mockRequester.permissions);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /api/account/user/:id', function() {
        var mockUsers;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'e2e-delete1', email: 'abcd', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-delete2', email: 'defg', password: 'thisisasecret', org: 'o-4567' }
            ];
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(done);
        });
        
        it('should successfully mark a user as deleted', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/user/:id',
                                                 params: { id: 'e2e-delete1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still succeed if the user does not exist', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the user has already been deleted', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not allow a user to delete themselves', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-user', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete yourself');
                options = { url: config.userSvcUrl + '/user/e2e-user', jar: cookieJar };
                return requestUtils.qRequest('get', options);
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
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-fake' };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('POST /api/account/user/email', function() {
        var user, reqBody, options;
        beforeEach(function(done) {
            user = {
                id: 'u-1',
                email: 'c6e2etester@gmail.com',
                status: 'active',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq'
            };
            reqBody = { email: 'c6e2etester@gmail.com', password: 'password', newEmail: 'mynewemail' };
            options = { url: config.userSvcUrl + '/user/email', json: reqBody };
            testUtils.resetCollection('users', [mockRequester, mockAdmin, user]).done(done);
        });

        it('should fail if email, password, or newEmail are not provided', function(done) {
            reqBody = { password: 'password', newEmail: 'mynewemail' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
                reqBody = { email: 'c6e2etester@gmail.com', newEmail: 'mynewemail' };
                options.json = reqBody;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
                reqBody = { email: 'c6e2etester@gmail.com', password: 'password' };
                options.json = reqBody;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide a new email');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the user\'s email is invalid', function(done) {
            reqBody.email = 'mynewemail';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the user\'s password is invalid', function(done) {
            reqBody.password = 'thisisnotapassword';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            reqBody.email = { $gt: '' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if a user with that email already exists', function(done) {
            var altUser = { id: 'u-2', email: 'mynewemail' };
            testUtils.resetCollection('users', [user, altUser]).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that email already exists');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should change the user\'s email successfully', function(done) {
            var mailman = new testUtils.Mailman();
            mailman.start().then(function() {
                mailman.once('message', function(msg) {
                    expect(msg.from[0].address).toBe('support@cinema6.com');
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    expect(msg.subject).toBe('Your Account Email Address Has Changed');
                    expect(msg.text.match(/mynewemail/)).toBeTruthy();
                    expect(msg.html.match(/mynewemail/)).toBeTruthy();
                    expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                    mailman.stop();
                    done();
                });
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
                var optionsA = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'password'}};
                var optionsB = {url:config.authUrl + '/login', json:{email:'mynewemail',password:'password'}};
                return q.all([requestUtils.qRequest('post', optionsA), requestUtils.qRequest('post', optionsB)]);
            }).then(function(resps) {
                expect(resps[0].response.statusCode).toBe(401);
                expect(resps[0].body).toBe('Invalid email or password');
                expect(resps[1].response.statusCode).toBe(200);
                expect(resps[1].body).toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                mailman.stop();
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
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/user/email',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should lowercase the new and old emails in the request', function(done) {
            options.json.email = 'c6E2ETester@gmail.com';
            options.json.newEmail = 'MyNewEmail';
            var mailman = new testUtils.Mailman();
            mailman.start().then(function() {
                mailman.once('message', function(msg) {
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    expect(msg.subject).toBe('Your Account Email Address Has Changed');
                    expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                    mailman.stop();
                    done();
                });
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
                var optionsA = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'password'}};
                var optionsB = {url:config.authUrl + '/login', json:{email:'mynewemail',password:'password'}};
                return q.all([requestUtils.qRequest('post', optionsA), requestUtils.qRequest('post', optionsB)]);
            }).then(function(resps) {
                expect(resps[0].response.statusCode).toBe(401);
                expect(resps[0].body).toBe('Invalid email or password');
                expect(resps[1].response.statusCode).toBe(200);
                expect(resps[1].body).toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                mailman.stop();
                done();
            });
        });
    });
    
    describe('POST /api/account/user/password', function() {
        var user, reqBody, options;
        beforeEach(function(done) {
            user = {
                id: 'u-1',
                email: 'c6e2etester@gmail.com',
                status: 'active',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq'
            };
            reqBody = { email: 'c6e2etester@gmail.com', password: 'password', newPassword: 'foobar' };
            options = { url: config.userSvcUrl + '/user/password', json: reqBody };
            testUtils.resetCollection('users', [mockRequester, mockAdmin, user]).done(done);
        });

        it('should fail if email, password, or newPassword are not provided', function(done) {
            reqBody = { password: 'password', newPassword: 'foobar' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
                reqBody = { email: 'c6e2etester@gmail.com', newPassword: 'foobar' };
                options.json = reqBody;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
                reqBody = { email: 'c6e2etester@gmail.com', password: 'password' };
                options.json = reqBody;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('newPassword is missing/not valid.');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should fail if the email is invalid', function(done) {
            reqBody.email = 'mynewemail';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the current password is invalid', function(done) {
            reqBody.password = 'thisisnotapassword';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should prevent mongo query selector injection attacks', function(done) {
            reqBody.email = { $gt: '' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should change the user\'s password successfully', function(done) {
            var mailman = new testUtils.Mailman();
            mailman.start().then(function() {
                mailman.once('message', function(msg) {
                    expect(msg.from[0].address).toBe('support@cinema6.com');
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    expect(msg.subject).toBe('Your account password has been changed');
                    expect(msg.text).toBeDefined();
                    expect(msg.html).toBeDefined();
                    expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                    mailman.stop();
                    done();
                });
                return requestUtils.qRequest('post', options)
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
                var loginOpts = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'foobar'}};
                return requestUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                mailman.stop();
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
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/user/password',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should lowercase the request email', function(done) {
            options.json.email = 'c6E2ETester@gmail.com';
            var mailman = new testUtils.Mailman();
            mailman.start().then(function() {
                mailman.once('message', function(msg) {
                    expect(msg.from[0].address).toBe('support@cinema6.com');
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    mailman.stop();
                    done();
                });
                return requestUtils.qRequest('post', options)
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
                var loginOpts = {url:config.authUrl + '/login', json:{email:'c6E2etester@gmail.com',password:'foobar'}};
                return requestUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                mailman.stop();
                done();
            });
        });
    });
    
    describe('POST /api/account/user/logout/:id', function() {
        var adminJar;
        beforeEach(function(done) {
            adminJar = require('request').jar();
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: adminJar,
                json: {
                    email: 'admine2euser',
                    password: 'password'
                }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                loginOpts.jar = cookieJar;
                loginOpts.json.email = 'usersvce2euser';
                return requestUtils.qRequest('post', loginOpts);
            }).done(function(resp) {
                done();
            });
        });
        
        it('should logout another user\'s active sessions', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: cookieJar },
                logoutOpts = { url: config.userSvcUrl + '/user/logout/e2e-user', jar: adminJar };
            requestUtils.qRequest('get', statusOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('post', logoutOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.userSvcUrl + '/user/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('userSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/user/:id',
                                                 params: { id: 'e2e-delete1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should let a user log themselves out', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: adminJar },
                logoutOpts = { url: config.userSvcUrl + '/user/logout/e2e-admin-user', jar: adminJar };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow a non-admin to logout another user', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: adminJar },
                logoutOpts = { url: config.userSvcUrl + '/user/logout/e2e-admin-user', jar: cookieJar };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to force logout users');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: cookieJar },
                logoutOpts = { url: config.userSvcUrl + '/user/logout/e2e-user' };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
