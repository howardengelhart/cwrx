var q               = require('q'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        usersUrl    : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account/users',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('userSvc users (E2E):', function() {
    var cookieJar, adminJar, mockRequester, mockAdmin, testPolicies;

    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies && adminJar && adminJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        adminJar = request.jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'usersvce2euser@gmail.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['manageOrgUsers']
        };
        mockAdmin = {
            id: 'e2e-admin-user',
            status: 'active',
            email: 'admine2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-4567',
            policies: ['manageAllUsers']
        };
        testPolicies = [
            {
                id: 'p-e2e-orgUsers',
                name: 'manageOrgUsers',
                status: 'active',
                priority: 1,
                permissions: {
                    users: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
                },
                fieldValidation: {
                    users: {
                        policies: {
                            __allowed: true,
                            __entries: {
                                __acceptableValues: ['pol1', 'pol2', 'pol4']
                            }
                        },
                        roles: {
                            __allowed: true,
                            __entries: {
                                __acceptableValues: ['role1', 'role2', 'role4']
                            }
                        }
                    }
                }
            },
            {
                id: 'p-e2e-adminUsers',
                name: 'manageAllUsers',
                status: 'active',
                priority: 1,
                permissions: {
                    users: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                },
                fieldValidation: {
                    users: {
                        policies: {
                            __allowed: true,
                            __entries: {
                                __acceptableValues: '*'
                            }
                        },
                        roles: {
                            __allowed: true,
                            __entries: {
                                __acceptableValues: '*'
                            }
                        }
                    }
                }
            }
        ];
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'usersvce2euser@gmail.com',
                password: 'password'
            }
        };
        var adminLoginOpts = {
            url: config.authUrl + '/login',
            jar: adminJar,
            json: {
                email: 'admine2euser',
                password: 'password'
            }
        };
        q.all([
            testUtils.resetCollection('users', [mockRequester, mockAdmin]),
            testUtils.resetCollection('policies', testPolicies)
        ]).then(function(resp) {
            return q.all([
                requestUtils.qRequest('post', loginOpts),
                requestUtils.qRequest('post', adminLoginOpts)
            ]);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/account/users/:id', function() {
        var mockUsers, options;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'u-e2e-get1', status: 'active', org: 'o-1234', email: 'user1', password: 'pass1' },
                { id: 'u-e2e-get2', status: 'active', org: 'o-7890', email: 'user2', password: 'pass2' },
                { id: 'u-e2e-get3', status: 'deleted', org: 'o-1234', email: 'user3', password: 'pass3' }
            ];
            options = { url: config.usersUrl + '/u-e2e-get1', jar: cookieJar };
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(function(resp) {
                done();
            });
        });

        it('should get a user by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-e2e-get1', status: 'active', org: 'o-1234', email: 'user1'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
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
                expect(results[0].data).toEqual({route: 'GET /api/account/users/:id',
                                                 params: { id: 'u-e2e-get1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('if decorated=true', function() {
            beforeEach(function() {
                options.qs = { decorated: true };
            });

            it('should decorate the user with permissions', function(done) {
                options.url = config.usersUrl + '/e2e-user';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.permissions).toEqual({
                        users: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
                    });
                    expect(resp.body.fieldValidation).toEqual({
                        users: {
                            policies: {
                                __allowed: true,
                                __entries: {
                                    __acceptableValues: ['pol1', 'pol2', 'pol4']
                                }
                            },
                            roles: {
                                __allowed: true,
                                __entries: {
                                    __acceptableValues: ['role1', 'role2', 'role4']
                                }
                            }
                        }
                    });
                    delete options.qs;
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.permissions).not.toBeDefined();
                    expect(resp.body.fieldValidation).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not do anything for non-200 responses', function(done) {
                options.url = config.usersUrl + '/u-e2e-get2';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toEqual('Object not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 404 if the requester cannot see the user', function(done) {
            options.url = config.usersUrl + '/u-e2e-get2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
                options.jar = adminJar;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-e2e-get2', status: 'active', org: 'o-7890', email: 'user2'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.usersUrl + '/e2e-fake1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted users', function(done) {
            options.url = config.usersUrl + '/u-e2e-get3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/users', function() {
        var mockUsers, options;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'u-e2e-get1', status: 'active', password: 'pass1', org: 'o-1234', roles: ['role1'], policies: ['pol2'] },
                { id: 'u-e2e-get2', status: 'active', password: 'pass3', org: 'o-1234', roles: ['role2'] },
                { id: 'u-e2e-get3', status: 'active', password: 'pass4', org: 'o-1234', policies: ['pol1'] },
                { id: 'u-e2e-get4', status: 'active', password: 'pass5', org: 'o-4567', roles: ['role1', 'role2'], policies: ['pol1', 'pol2'] },
                { id: 'u-e2e-get5', status: 'deleted', password: 'pass6', org: 'o-1234', roles: ['role1', 'role2'], policies: ['pol1', 'pol2'] },
            ];
            options = { url: config.usersUrl + '/', qs: { sort: 'id,1' }, jar: cookieJar };
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(done);
        });

        it('should get users by org', function(done) {
            options.qs.org = 'o-1234';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-user');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1].id).toBe('u-e2e-get1');
                expect(resp.body[1].password).not.toBeDefined();
                expect(resp.body[2].id).toBe('u-e2e-get2');
                expect(resp.body[2].password).not.toBeDefined();
                expect(resp.body[3].id).toBe('u-e2e-get3');
                expect(resp.body[3].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            options.qs.org = 'o-1234';
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
                expect(results[0].data).toEqual({route: 'GET /api/account/users/',
                                                 params: {}, query: { org: 'o-1234', sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get users by a list of ids', function(done) {
            options.qs.ids = 'u-e2e-get1,u-e2e-get2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('u-e2e-get1');
                expect(resp.body[1].id).toBe('u-e2e-get2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get users by policy', function(done) {
            options.qs.policy = 'pol2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('u-e2e-get1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get users by role', function(done) {
            options.qs.role = 'role2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('u-e2e-get2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.org = 'o-1234';
            options.qs.limit = 2;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-user');
                expect(resp.body[1].id).toBe('u-e2e-get1');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('u-e2e-get2');
                expect(resp.body[1].id).toBe('u-e2e-get3');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent a non-admin user from getting all users', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Not authorized to read all users');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow admins to get all users', function(done) {
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(6);
                expect(resp.body[0].id).toBe('e2e-admin-user');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-user');
                expect(resp.body[1].password).not.toBeDefined();
                expect(resp.body[2].id).toBe('u-e2e-get1');
                expect(resp.body[2].password).not.toBeDefined();
                expect(resp.body[3].id).toBe('u-e2e-get2');
                expect(resp.body[3].password).not.toBeDefined();
                expect(resp.body[4].id).toBe('u-e2e-get3');
                expect(resp.body[4].password).not.toBeDefined();
                expect(resp.body[5].id).toBe('u-e2e-get4');
                expect(resp.body[5].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-6/6');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.org = 'o-fake';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent mongo query selector injection attacks', function(done) {
            q.all(['org', 'ids', 'policy', 'role'].map(function(field) {
                options.qs = {};
                options.qs[field] = { $gt: '' };
                return requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                });
            }))
            .catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            })
            .done(function() {
                done();
            });
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            options = { url: config.usersUrl + '/?org=o-1234' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/users', function() {
        var mockUser, mockRoles, mockPols, options;
        beforeEach(function(done) {
            mockUser = {
                email: 'testpostuser',
                password: 'password',
                roles: ['role1', 'role2'],
                policies: ['pol1', 'pol2']
            };
            mockRoles = [
                { id: 'r-1', name: 'role1', status: 'active' },
                { id: 'r-2', name: 'role2', status: 'active' },
                { id: 'r-3', name: 'role3', status: 'active' }
            ];
            mockPols = [
                { id: 'p-1', name: 'pol1', status: 'active', priority: 1 },
                { id: 'p-2', name: 'pol2', status: 'active', priority: 1 },
                { id: 'p-3', name: 'pol3', status: 'active', priority: 1 }
            ];
            options = { url: config.usersUrl + '/', json: mockUser, jar: cookieJar };
            q.all([
                testUtils.resetCollection('users', [mockRequester, mockAdmin]),
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('policies', mockPols.concat(testPolicies))
            ]).done(function() {
                done();
            });
        });

        it('should be able to create a user', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'active',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    email: 'testpostuser',
                    org: 'o-1234',
                    roles: ['role1', 'role2'],
                    policies: ['pol1', 'pol2'],
                    config: {}
                });
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
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
                expect(results[0].data).toEqual({route: 'POST /api/account/users/',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should lowercase the new email', function(done) {
            options.json.email = 'TestPostUser';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.email).toBe('testpostuser');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 error if the body is missing the email or password', function(done) {
            delete options.json.email;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: email');
                options.json.email = 'testpostuser';
                delete options.json.password;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 409 error if a user with that email exists', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that email already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if some of the roles or policies do not exist', function(done) {
            mockUser.roles.push('role4');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These roles were not found: [role4]');
                mockUser.roles.pop();
                mockUser.policies.push('pol4');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These policies were not found: [pol4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the user cannot pass some of the roles or policies', function(done) {
            mockUser.roles.push('role3');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('roles[2] is UNACCEPTABLE! acceptable values are: [role1,role2,role4]');
                mockUser.roles.pop();
                mockUser.policies.push('pol3');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('policies[2] is UNACCEPTABLE! acceptable values are: [pol1,pol2,pol4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should let some users pass any existent roles or policies', function(done) {
            options.jar = adminJar;
            options.json.roles = ['role1', 'role2', 'role3'];
            options.json.policies = ['pol1', 'pol2', 'pol3', 'manageAllUsers'];
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.roles).toEqual(['role1', 'role2', 'role3']);
                expect(resp.body.policies).toEqual(['pol1', 'pol2', 'pol3', 'manageAllUsers']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off forbidden fields', function(done) {
            mockUser.org = 'o-4567';
            mockUser.permissions = { cards: { read: 'all' } };
            mockUser.fieldValidation = { cards: { status: { __allowed: true } } };
            mockUser.applications = ['e-app1'];
            mockUser.entitlements = { doEverything: true };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.permissions).not.toBeDefined();
                expect(resp.body.fieldValidation).not.toBeDefined();
                expect(resp.body.applications).not.toBeDefined();
                expect(resp.body.entitlements).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/account/users/:id', function() {
        var mockUsers, mockRoles, mockPols, options;
        beforeEach(function(done) {
            mockUsers = [
                {
                    id: 'u-e2e-put1',
                    status: 'active',
                    org: 'o-1234',
                    created: new Date(),
                    lastUpdated: new Date(),
                    email: 'abcd',
                    password: 'secret',
                    roles: ['role1'],
                    policies: ['pol1'],
                },
                {
                    id: 'u-e2e-put2',
                    status: 'active',
                    org: 'o-4567',
                    created: new Date(),
                    lastUpdated: new Date(),
                    email: 'defg',
                    password: 'secret',
                    policies: ['pol1', 'pol2']
                },
                {
                    id: 'u-e2e-put3',
                    status: 'deleted',
                    org: 'o-1234',
                    email: 'hijk'
                }
            ];
            mockRoles = [
                { id: 'r-1', name: 'role1', status: 'active' },
                { id: 'r-2', name: 'role2', status: 'active' },
                { id: 'r-3', name: 'role3', status: 'active' }
            ];
            mockPols = [
                { id: 'p-1', name: 'pol1', status: 'active', priority: 1 },
                { id: 'p-2', name: 'pol2', status: 'active', priority: 1 },
                { id: 'p-3', name: 'pol3', status: 'active', priority: 1 }
            ];
            options = {
                url: config.usersUrl + '/u-e2e-put1',
                json: { roles: ['role2', 'role1'], policies: ['pol2', 'pol1'] },
                jar: cookieJar
            };
            q.all([
                testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])),
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('policies', mockPols.concat(testPolicies))
            ]).done(function() {
                done();
            });
        });

        it('should successfully update a user', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-e2e-put1',
                    status: 'active',
                    org: 'o-1234',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    email: 'abcd',
                    roles: ['role2', 'role1'],
                    policies: ['pol2', 'pol1'],
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(mockUsers[0].lastUpdated);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
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
                expect(results[0].data).toEqual({route: 'PUT /api/account/users/:id',
                                                 params: { id: 'u-e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if some of the roles or policies do not exist', function(done) {
            options.json.roles.push('role4');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These roles were not found: [role4]');
                options.json.roles.pop();
                options.json.policies.push('pol4');
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These policies were not found: [pol4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the user cannot pass some of the roles or policies', function(done) {
            options.json.roles.push('role3');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('roles[2] is UNACCEPTABLE! acceptable values are: [role1,role2,role4]');
                options.json.roles.pop();
                options.json.policies.push('pol3');
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('policies[2] is UNACCEPTABLE! acceptable values are: [pol1,pol2,pol4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should let some users pass any existent roles or policies', function(done) {
            options.jar = adminJar;
            options.json.roles = ['role1', 'role2', 'role3'];
            options.json.policies = ['pol1', 'pol2', 'pol3', 'manageAllUsers'];
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.roles).toEqual(['role1', 'role2', 'role3']);
                expect(resp.body.policies).toEqual(['pol1', 'pol2', 'pol3', 'manageAllUsers']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off forbidden fields', function(done) {
            options.json = mockUsers[0];
            options.json.email = 'newEmail';
            options.json.password = 'newPass';
            options.json.org = 'o-4567';
            options.json.permissions = { cards: { read: 'all' } };
            options.json.fieldValidation = { cards: { status: { __allowed: true } } };
            options.json.applications = ['e-app1'];
            options.json.entitlements = { doEverything: true };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-e2e-put1',
                    status: 'active',
                    org: 'o-1234',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    email: 'abcd',
                    roles: ['role1'],
                    policies: ['pol1'],
                });
                return testUtils.mongoFind('users', { id: 'u-e2e-put1' });
            }).then(function(accounts) {
                expect(accounts[0].password).toBe('secret');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the user does not exist', function(done) {
            options.url = config.usersUrl + '/u-e2e-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the requester is not authorized to edit the user', function(done) {
            options.url = config.usersUrl + '/u-e2e-put2';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this');
                options.jar = adminJar;
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.policies).toEqual(['pol2', 'pol1']);
                expect(resp.body.roles).toEqual(['role2', 'role1']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/users/:id', function() {
        var mockUsers;
        beforeEach(function(done) {
            mockUsers = [
                { id: 'u-e2e-del1', status: 'active', email: 'abcd', org: 'o-1234' },
                { id: 'u-e2e-del2', status: 'active', email: 'defg', org: 'o-7890' },
                { id: 'u-e2e-del3', status: 'deleted', email: 'hijk', org: 'o-1234' },
            ];
            testUtils.resetCollection('users', mockUsers.concat([mockRequester, mockAdmin])).done(done);
        });

        it('should successfully mark a user as deleted', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-del1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.usersUrl + '/u-e2e-del1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-del1', jar: cookieJar };
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
                expect(results[0].data).toEqual({route: 'DELETE /api/account/users/:id',
                                                 params: { id: 'u-e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the user does not exist', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-fake', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the user has already been deleted', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-del3', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a user to delete themselves', function(done) {
            var options = { url: config.usersUrl + '/e2e-user', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete yourself');
                options = { url: config.usersUrl + '/e2e-user', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the requester is not authorized to delete the user', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-del2', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this');
                options.jar = adminJar;
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.usersUrl + '/u-e2e-del2', jar: adminJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.usersUrl + '/e2e-fake' };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/users/email', function() {
        var mockUser, reqBody, options;
        beforeEach(function(done) {
            mockUser = {
                id: 'u-1',
                email: 'c6e2etester@gmail.com',
                status: 'active',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq'
            };
            reqBody = { email: 'c6e2etester@gmail.com', password: 'password', newEmail: 'mynewemail' };
            options = { url: config.usersUrl + '/email', json: reqBody };
            testUtils.resetCollection('users', [mockRequester, mockAdmin, mockUser]).done(done);
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
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the user\'s email is invalid', function(done) {
            reqBody.email = 'mynewemail';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the user\'s password is invalid', function(done) {
            reqBody.password = 'thisisnotapassword';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent mongo query selector injection attacks', function(done) {
            reqBody.email = { $gt: '' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if a user with that email already exists', function(done) {
            options.json.newEmail = 'usersvce2euser@gmail.com';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that email already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
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
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'POST /api/account/users/email',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(util.inspect(error)).not.toBeDefined();
                mailman.stop();
                done();
            });
        });
    });

    describe('POST /api/account/users/password', function() {
        var user, reqBody, options;
        beforeEach(function(done) {
            user = {
                id: 'u-1',
                email: 'c6e2etester@gmail.com',
                status: 'active',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq'
            };
            reqBody = { email: 'c6e2etester@gmail.com', password: 'password', newPassword: 'foobar' };
            options = { url: config.usersUrl + '/password', json: reqBody };
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
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the email is invalid', function(done) {
            reqBody.email = 'mynewemail';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the current password is invalid', function(done) {
            reqBody.password = 'thisisnotapassword';
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent mongo query selector injection attacks', function(done) {
            reqBody.email = { $gt: '' };
            options.json = reqBody;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide email and password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'POST /api/account/users/password',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(util.inspect(error)).not.toBeDefined();
                mailman.stop();
                done();
            });
        });
    });

    describe('POST /api/account/users/logout/:id', function() {
        afterEach(function() { // deletes cookies, forcing re-login in first beforeEach
            cookieJar = null;
            adminJar = null;
        });

        it('should logout another user\'s active sessions', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: cookieJar },
                logoutOpts = { url: config.usersUrl + '/logout/e2e-user', jar: adminJar };
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
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.usersUrl + '/u-e2e-del1', jar: cookieJar };
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
                expect(results[0].data).toEqual({route: 'DELETE /api/account/users/:id',
                                                 params: { id: 'u-e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should let a user log themselves out', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: adminJar },
                logoutOpts = { url: config.usersUrl + '/logout/e2e-admin-user', jar: adminJar };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a non-admin to logout another user', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: adminJar },
                logoutOpts = { url: config.usersUrl + '/logout/e2e-admin-user', jar: cookieJar };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to force logout users');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            var statusOpts = { url: config.authUrl + '/status', jar: cookieJar },
                logoutOpts = { url: config.usersUrl + '/logout/e2e-user' };
            requestUtils.qRequest('post', logoutOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                return requestUtils.qRequest('get', statusOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/user/validEmail', function() {
        it('should respond with information about if a given email address is valid', function(done) {
            var requestOpts = { url: config.usersUrl + '/validEmail', jar: cookieJar, qs: { email: 'JohnnyTestMonkey@gmail.com' } };
            requestUtils.qRequest('', requestOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe(true);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should respond with a status code of 400 if the provided email is taken', function(done) {
            var requestOpts = { url: config.usersUrl + '/validEmail', jar: cookieJar, qs: { email: 'usersvce2euser@gmail.com' } };
            requestUtils.qRequest('', requestOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('Invalid email address');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should respond with a status code of 400 if the required email query param is not specified', function(done) {
            var requestOpts = { url: config.usersUrl + '/validEmail', jar: cookieJar };
            requestUtils.qRequest('', requestOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.response.body).toBe('Must provide an email');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should respond with a status code of 400 if the provided email is not an email', function(done) {
            var testCases = ['not an email', 'StillNotAnEmail', 'AlmostAnEmail@NotQuite', 'DefinitelyAnEmail@justkidding.foo'];
            var promises = testCases.map(function(testCase) {
                var requestOpts = { url: config.usersUrl + '/validEmail', jar: cookieJar, qs: { email: testCase} };
                return requestUtils.qRequest('', requestOpts);
            });
            q.all(promises).then(function(responses) {
                responses.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.response.body).toBe("Invalid email address");
                });
            }).catch(function() {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
