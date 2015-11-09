var q               = require('q'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    adtech          = require('adtech'),
    host            = process.env.host || 'localhost',
    config = {
        usersUrl    : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account/users',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth',
        orgsUrl     : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account/orgs',
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api'
    };

describe('userSvc users (E2E):', function() {
    var cookieJar, adminJar, mockRequester, mockAdmin, mockServiceUser, testPolicies, mailman, urlRegex;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        urlRegex = /https?:\/\/.*id=u-[0-9a-z]+.*token=[0-9a-f]{48}/;

        if (cookieJar && cookieJar.cookies && adminJar && adminJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        adminJar = request.jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'usersvce2euser',
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
                    users: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    orgs: { delete: 'all' },
                    customers: { read: 'all', delete: 'all' },
                    advertisers: { delete: 'all' }
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
                email: 'usersvce2euser',
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
        }).done(function() { done(); });
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

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'email,status,password' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'u-e2e-get1',
                    email: 'user1',
                    status: 'active'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
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

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.org = 'o-1234';
            options.qs.fields = 'status,password';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-user', status: 'active' },
                    { id: 'u-e2e-get1', status: 'active' },
                    { id: 'u-e2e-get2', status: 'active' },
                    { id: 'u-e2e-get3', status: 'active' }
                ]);
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

        it('should get no users if the ids param is empty', function(done) {
            options.qs.ids = '';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
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
                expect(resp.body.length).toBe(7);
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
                expect(resp.response.headers['content-range']).toBe('items 1-7/7');
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
        var mockUser, reqBody, options, msgSubject;
        beforeEach(function(done) {
            msgSubject = 'Your Email Has Been Changed';
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.newEmail = 'usersvce2euser';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that email already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should change the user\'s email successfully', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toMatch(/mynewemail/);
                expect(msg.html).toMatch(/mynewemail/);
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                
                var optionsA = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'password'}};
                var optionsB = {url:config.authUrl + '/login', json:{email:'mynewemail',password:'password'}};
                return q.all([requestUtils.qRequest('post', optionsA), requestUtils.qRequest('post', optionsB)])
                .then(function(resps) {
                    expect(resps[0].response.statusCode).toBe(401);
                    expect(resps[0].body).toBe('Invalid email or password');
                    expect(resps[1].response.statusCode).toBe(200);
                    expect(resps[1].body).toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            mailman.once(msgSubject, function(msg) {
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'})
                .then(function(results) {
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
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should lowercase the new and old emails in the request', function(done) {
            mailman.once(msgSubject, function(msg) {
                var optionsA = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'password'}};
                var optionsB = {url:config.authUrl + '/login', json:{email:'mynewemail',password:'password'}};
                return q.all([requestUtils.qRequest('post', optionsA), requestUtils.qRequest('post', optionsB)])
                .then(function(resps) {
                    expect(resps[0].response.statusCode).toBe(401);
                    expect(resps[0].body).toBe('Invalid email or password');
                    expect(resps[1].response.statusCode).toBe(200);
                    expect(resps[1].body).toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            options.json.email = 'c6E2ETester@gmail.com';
            options.json.newEmail = 'MyNewEmail';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed email');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });
    });

    describe('POST /api/account/users/password', function() {
        var user, reqBody, options, msgSubject;
        beforeEach(function(done) {
            user = {
                id: 'u-1',
                email: 'c6e2etester@gmail.com',
                status: 'active',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq'
            };
            msgSubject = 'ReelContent Password Change Notice';
            reqBody = { email: 'c6e2etester@gmail.com', password: 'password', newPassword: 'foobar' };
            options = { url: config.usersUrl + '/password', json: reqBody };
            testUtils.resetCollection('users', [mockRequester, mockAdmin, user]).done(done);
        });

        it('should fail if email, password, or newPassword are not provided', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toMatch(/password\s*was\s*changed\s*on.*at.*/);
                expect(msg.html).toMatch(/password\s*was\s*changed\s*on.*at.*/);
                expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent

                var loginOpts = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'foobar'}};
                return requestUtils.qRequest('post', loginOpts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            mailman.once(msgSubject, function(msg) {
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'})
                .then(function(results) {
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

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should lowercase the request email', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');

                var loginOpts = {url:config.authUrl + '/login', json:{email:'c6e2etester@gmail.com',password:'foobar'}};
                return requestUtils.qRequest('post', loginOpts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            options.json.email = 'c6E2ETester@gmail.com';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('Successfully changed password');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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

    describe('POST /api/account/users/signup', function() {
        var mockUser, mockRoles, mockPols, options, msgSubject;
        beforeEach(function(done) {
            msgSubject = 'Welcome to ReelContent Video Ads!';
            mockUser = {
                email: 'c6e2etester@gmail.com',
                password: 'password',
                roles: ['role1', 'role2'],
                policies: ['pol1', 'pol2']
            };
            mockRoles = [
                { id: 'r-1', name: 'role1', status: 'active' },
                { id: 'r-2', name: 'role2', status: 'active' },
                { id: 'r-3', name: 'role3', status: 'active' },
                { id: 'r-4', name: 'newUserRole', status: 'active'}
            ];
            mockPols = [
                { id: 'p-1', name: 'pol1', status: 'active', priority: 1 },
                { id: 'p-2', name: 'pol2', status: 'active', priority: 1 },
                { id: 'p-3', name: 'pol3', status: 'active', priority: 1 },
                { id: 'p-4', name: 'newUserPolicy', status: 'active', priority: 1}
            ];
            options = { url: config.usersUrl + '/signup', json: mockUser };
            q.all([
                testUtils.resetCollection('users', [mockRequester, mockAdmin]),
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('policies', mockPols.concat(testPolicies))
            ]).done(function() {
                done();
            });
        });

        it('should create a new user account', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toMatch(urlRegex);
                expect(msg.html).toMatch(urlRegex);
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });
        
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'new',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    email: 'c6e2etester@gmail.com',
                    roles: ['newUserRole'],
                    policies: ['newUserPolicy'],
                    external: true,
                    config: {}
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should lowercase the new email', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                done();
            });        
        
            options.json.email = 'c6E2ETester@gmail.com';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.email).toBe('c6e2etester@gmail.com');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should return a 400 error if the body is missing the email or password', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
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

        it('should 400 if the activation email cannot send because of a malformed email', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            options.json.email = 'malformed email';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid email address');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 409 error if a user with that email exists', function(done) {
            mailman.once(msgSubject, function(msg) {
                // first req should succeed + send email, but second should not
                mailman.once(msgSubject, function(msg) {
                    expect(msg).not.toBeDefined();
                });

                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(409);
                    expect(resp.body).toBe('An object with that email already exists');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        
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

        it('should trim off forbidden fields', function(done) {
            mailman.once(msgSubject, function(msg) {
                done();
            });

            mockUser.org = 'o-4567';
            mockUser.customer = 'some customer';
            mockUser.advertiser = 'some advertiser';
            mockUser.permissions = { cards: { read: 'all' } };
            mockUser.fieldValidation = { cards: { status: { __allowed: true } } };
            mockUser.applications = ['e-app1'];
            mockUser.entitlements = { doEverything: true };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.customer).not.toBeDefined();
                expect(resp.body.advertiser).not.toBeDefined();
                expect(resp.body.permissions).not.toBeDefined();
                expect(resp.body.fieldValidation).not.toBeDefined();
                expect(resp.body.applications).not.toBeDefined();
                expect(resp.body.entitlements).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should save an activation token', function(done) {
            mailman.once(msgSubject, function(msg) {
                done();
            });

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('users', { id: resp.body.id });
            }).then(function(results) {
                var user = results[0];
                expect(user.activationToken.token).toEqual(jasmine.any(String));
                expect(user.activationToken.expires).toEqual(jasmine.any(Date));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });
    });

    describe('POST /api/account/users/confirm/:id', function() {
        var mockNewUser, msgSubject;

        beforeEach(function(done) {
            mockNewUser = {
                id: 'u-12345',
                email: 'c6e2etester@gmail.com',
                password: 'password',
                activationToken: {
                    token: '$2a$10$Az4jCmrU0teH1pPj8zgWSOgZszAM0O9qbvtqOWCCVfujBx2gGlOFC', // hash of "valid-token"
                    expires: new Date(99999, 11, 25)
                },
                lastUpdated: new Date(0, 11, 25),
                status: 'new',
                company: 'e2e-tests-company'
            };
            msgSubject = 'Your Account is Now Active';

            var mockRoles = [
                { id: 'r-4', name: 'newUserRole', status: 'active'}
            ];
            var mockPols = [
                { id: 'p-4', name: 'newUserPolicy', status: 'active', priority: 1}
            ];
            q.all([
                testUtils.resetCollection('users', [mockNewUser, mockAdmin]),
                testUtils.resetCollection('orgs', [{name:'someOrg'}]),
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('policies', mockPols.concat(testPolicies))
            ]).then(function() {
                if (!adtech.customerAdmin) {
                    return adtech.createCustomerAdmin();
                }
            }).done(done);
        });

        function cleanupCustomers(customerName) {
            if(!customerName) { return; }
            var equalsCustAove = new adtech.AOVE();
            equalsCustAove.addExpression(new adtech.AOVE.StringExpression('name', customerName));
            return adtech.customerAdmin.getCustomerList(null, null, equalsCustAove).then(function(response) {
                return q.allSettled(response.map(function(item) {
                    return adtech.customerAdmin.deleteCustomer(item.id);
                }));
            }).catch(function(error) {
                console.log('Error removing e2e customers:');
                console.log(error);
            });
        }

        function cleanupAdvertisers(advertiserName) {
            if(!advertiserName) { return; }
            var equalsAdvertiserAove = new adtech.AOVE();
            equalsAdvertiserAove.addExpression(new adtech.AOVE.StringExpression('name', advertiserName));
            return adtech.customerAdmin.getAdvertiserList(null, null, equalsAdvertiserAove).then(function(response) {
                return q.allSettled(response.map(function(item) {
                    return adtech.customerAdmin.deleteAdvertiser(item.id);
                }));
            }).catch(function(error) {
                console.log('Error removing e2e advertisers:');
                console.log(error);
            });
        }

        afterEach(function(done) {
            cleanupCustomers('e2e-tests-company (u-12345)')
                .then(function() {
                    return cleanupAdvertisers('e2e-tests-company (u-12345)');
                })
                .done(done);
        });

        it('should 400 concurrent requests', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).toBeDefined();
                done();
            });

            var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
            var requests = [null, null].map(function() {
                return requestUtils.qRequest('post', options);
            });
            q.all(requests).then(function(resps) {
                var statusCodes = resps.map(function(resp) {
                    return resp.response.statusCode;
                }).sort();
                expect(statusCodes[0]).toBe(200);
                statusCodes.splice(1).forEach(function(statusCode) {
                    expect(statusCode).toBe(400);
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should 400 if a token is not provided on the request body', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });

            var options = { url: config.usersUrl + '/confirm/u-12345' };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must provide a token');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should 404 if no user exists with the id specified in the url', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });

            var options = { url: config.usersUrl + '/confirm/u-non-existant', json: { token: 'valid-token' } };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('User not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should 403 if the activation token has expired', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });

            mockNewUser.activationToken.expires = new Date(0, 11, 25);
            testUtils.resetCollection('users', mockNewUser).then(function() {
                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Activation token has expired');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should 403 if the provided activation token is invalid', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });

            var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'invalid-token' } };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Confirmation failed');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('when given a valid activation token', function() {

            it('should 200 and return the saved object as the body of the response ', function(done) {
                mailman.once(msgSubject, function(msg) {
                    expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                    expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                    expect(msg.html).toMatch(/account\s*is\s*now\s*active/);
                    expect(msg.text).toMatch(/account\s*is\s*now\s*active/);
                    expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                    done();
                });

                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                requestUtils.qRequest('post', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'u-12345',
                        email: 'c6e2etester@gmail.com',
                        lastUpdated: jasmine.any(String),
                        status: 'active',
                        company: 'e2e-tests-company',
                        org: jasmine.any(String),
                        customer: jasmine.any(String),
                        advertiser: jasmine.any(String)
                    });
                    expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(0, 11, 25));
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
            });

            it('should create an org for the user', function(done) {
                mailman.once(msgSubject, function(msg) {
                    done();
                });

                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                requestUtils.qRequest('post', options)
                .then(function(resp) {
                    var orgId = resp.body.org;
                    expect(orgId).toEqual(jasmine.any(String));
                    return testUtils.mongoFind('orgs', {id: orgId});
                })
                .then(function(results) {
                    var org = results[0];
                    expect(org.name).toBe('e2e-tests-company (u-12345)');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
            });

            it('should create a customer for the user (linked to the advertiser)', function(done) {
                mailman.once(msgSubject, function(msg) {
                    done();
                });

                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                var advertiserId = null;
                requestUtils.qRequest('post', options)
                .then(function(resp) {
                    var customerId = resp.body.customer;
                    advertiserId = resp.body.advertiser;
                    expect(customerId).toEqual(jasmine.any(String));
                    expect(advertiserId).toBeDefined();
                    var options = {url: config.adsUrl + '/account/customer/' + customerId, jar: adminJar};
                    return requestUtils.qRequest('get', options);
                })
                .then(function(resp) {
                    var customer = resp.body;
                    expect(customer.name).toBe('e2e-tests-company (u-12345)');
                    expect(customer.advertisers).toContain(advertiserId);
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
            });

            it('should create an advertiser for the user', function(done) {
                mailman.once(msgSubject, function(msg) {
                    done();
                });

                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                requestUtils.qRequest('post', options)
                .then(function(resp) {
                    var advertiserId = resp.body.advertiser;
                    expect(advertiserId).toEqual(jasmine.any(String));
                    return testUtils.mongoFind('advertisers', {id: advertiserId});
                })
                .then(function(results) {
                    var advertiser = results[0];
                    expect(advertiser.name).toBe('e2e-tests-company (u-12345)');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
            });

            it('should login the new user', function(done) {
                mailman.once(msgSubject, function(msg) {
                    done();
                });

                var options = { url: config.usersUrl + '/confirm/u-12345', json: { token: 'valid-token' } };
                requestUtils.qRequest('post', options)
                .then(function(resp) {
                    expect(resp.response.headers['set-cookie'].length).toBe(1);
                    expect(resp.response.headers['set-cookie'][0]).toMatch(/^c6Auth=.+/);
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
            });
        });
        
        describe('working with the signup endpoint', function() {
            var createdCustomer, createdAdvertiser;
            
            beforeEach(function() {
                createdCustomer = null;
                createdAdvertiser = null;
            });
            
            afterEach(function(done) {
                cleanupCustomers(createdCustomer)
                    .then(function() {
                        return cleanupAdvertisers(createdAdvertiser);
                    })
                    .done(done);
            });

            it('should work properly with /api/account/users/signup', function(done) {
                var userId;

                mailman.once('Welcome to ReelContent Video Ads!', function(msg) {
                    var match = msg.html.match(/href="https?:\/\/.*id=(u-[0-9a-z]+).*token=([0-9a-f]{48})(?=")/);
                    if (!match || match.length === 0) {
                        return done.fail('No url with token + user id found in message');
                    }
                    
                    var userId = match[1],
                        token = match[2],
                        confirmOptions = { url: config.usersUrl + '/confirm/' + userId, json: { token: token } };

                    requestUtils.qRequest('post', confirmOptions)
                        .then(function(resp) {
                            expect(resp.response.statusCode).toBe(200);

                            // For cleaning up linked entities
                            createdCustomer = 'newCustomer (' + resp.body.id + ')';
                            createdAdvertiser = 'newAdvertiser (' + resp.body.id + ')';

                            mailman.once(msgSubject, function(msg) {
                                expect(resp.body.id).toBe(userId);
                                expect(resp.body.status).toBe('active');
                                done();
                            });

                        })
                        .catch(function(error) {
                            expect(util.inspect(error)).not.toBeDefined();
                            done();
                        });
                });

                testUtils.resetCollection('users')
                    .then(function() {
                        var signupOptions = { url: config.usersUrl + '/signup', json: { email: 'c6e2etester@gmail.com', password: 'password' }};
                        return requestUtils.qRequest('post', signupOptions);
                    })
                    .then(function(resp) {
                        expect(resp.response.statusCode).toBe(201);
                        expect(resp.body.status).toBe('new');
                    })
                    .catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                        done();
                    });
            });
        });        
    });

    describe('POST /api/accounts/users/resendActivation', function() {
        var loginOpts, resendOpts, newUserCookieJar, newUser, msgSubject;
        
        beforeEach(function(done) {
            msgSubject = 'Welcome to ReelContent Video Ads!';
            newUserCookieJar = request.jar();
            loginOpts = { url: config.authUrl + '/login', json: { email: 'c6e2etester@gmail.com', password: 'password' }, jar: newUserCookieJar };
            resendOpts = { url: config.usersUrl + '/resendActivation', jar: newUserCookieJar };
            newUser = {
                id: 'u-12345',
                status: 'new',
                email: 'c6e2etester@gmail.com',
                password: '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                activationToken: {
                    token: 'token'
                }
            };
            testUtils.resetCollection('users', newUser)
                .then(function() {
                    return requestUtils.qRequest('post', loginOpts);
                })
                .done(done);
        });
        
        it('should 401 if the user is not authenticated', function(done) {
            delete resendOpts.jar;
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            requestUtils.qRequest('post', resendOpts)
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(401);
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                })
                .done(done);
        });
        
        it('should 403 if the user status is not new', function(done) {
            resendOpts.jar = cookieJar;
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            return requestUtils.qRequest('post', resendOpts)
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                })
                .done(done);
        });
        
        it('should 403 if the user does not have an existing activation token', function(done) {
            delete newUser.activationToken;
            mailman.once(msgSubject, function(msg) {
                expect(msg).not.toBeDefined();
            });
            testUtils.resetCollection('users', newUser)
                .then(function() {
                    return requestUtils.qRequest('post', resendOpts);
                })
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                })
                .done(done);
        });
        
        it('should generate a new activation token and save it on the user', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(msg.from[0].address).toBe('no-reply@cinema6.com');
                expect(msg.to[0].address).toBe('c6e2etester@gmail.com');
                expect(msg.text).toMatch(urlRegex);
                expect(msg.html).toMatch(urlRegex);
                expect(new Date() - msg.date).toBeLessThan(30000); // message should be recent
                done();
            });

            requestUtils.qRequest('post', resendOpts)
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toEqual('');
                    return testUtils.mongoFind('users', { id: 'u-12345' });
                })
                .then(function(results) {
                    var user = results[0];
                    expect(user.activationToken.token).toEqual(jasmine.any(String));
                    expect(user.activationToken.expires).toEqual(jasmine.any(Date));
                    expect(user.activationToken.token).not.toBe('token');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
        });
    });

    // This test will ONLY run on localhost
    describe('POST /__internal/sixxyUserSession', function() {
        var runTest, opts;
        
        beforeEach(function() {
            runTest = (host === 'localhost');
            opts = {url: 'http://localhost:3500/__internal/sixxyUserSession', json: {uuid: 'uuid', nonce: 'invalid nonce'}};
        });
        
        it('should not work when called directly', function(done) {
            if(runTest) {
                requestUtils.qRequest('post', opts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.response.headers.c6Auth).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefiened();
                }).done(done);
            } else {
                done();
            }
        });
    });

    afterAll(function(done) {
        mailman.stop();
        testUtils.closeDbs().done(done);
    });
});
