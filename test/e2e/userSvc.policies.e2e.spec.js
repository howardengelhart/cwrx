var q               = require('q'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        polsUrl     : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account/policies',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

jasmine.getEnv().defaultTimeoutInterval = 10000;

describe('userSvc policies endpoints (E2E):', function() {
    var cookieJar, mockRequester, polAdminPol;
        
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
            policies: ['e2ePolAdmin']
        };
        polAdminPol = {
            id: 'p-e2e-admin',
            name: 'e2ePolAdmin',
            status: 'active',
            priority: 1,
            permissions: {
                policies: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            },
            fieldValidation: {
                policies: {
                    applications: {
                        _allowed: true,
                        _entries: {
                            _acceptableValues: ['e-app1', 'e-app2', 'e-app4']
                        }
                    },
                    entitlements: {
                        _allowed: true
                    },
                    permissions: {
                        cards: {
                            _allowed: true
                        },
                        policies: {
                            _allowed: true
                        }
                    },
                    fieldValidation: {
                        cards: {
                            _allowed: true
                        },
                        policies: {
                            _allowed: true
                        }
                    }
                }
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
        q.all([
            testUtils.resetCollection('users', mockRequester),
            testUtils.resetCollection('policies', polAdminPol)
        ]).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/account/policies/:id', function() {
        beforeEach(function(done) {
            var mockPols = [
                { id: 'p-e2e-get1', name: 'pol1', priority: 1, status: 'active' },
                { id: 'p-e2e-get2', name: 'pol2', priority: 1, status: 'deleted' }
            ];
            testUtils.resetCollection('policies', mockPols.concat([polAdminPol])).done(done);
        });
        
        it('should get a policy by id', function(done) {
            var options = {url: config.polsUrl + '/p-e2e-get1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'p-e2e-get1', name: 'pol1', priority: 1, status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.polsUrl + '/p-e2e-get1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/account/policies/:id',
                                                 params: { 'id': 'p-e2e-get1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted policies', function(done) {
            var options = {url: config.polsUrl + '/p-e2e-get2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.polsUrl + '/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            var options = { url: config.polsUrl + '/p-e2e-get1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/policies/', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.polsUrl + '/', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockPols = [
                { id: 'p-e2e-getQry1', name: 'pol1', priority: 1, status: 'active' },
                { id: 'p-e2e-getQry2', name: 'pol2', priority: 1, status: 'inactive' },
                { id: 'p-e2e-getQry3', name: 'pol3', priority: 1, status: 'active' },
                { id: 'p-e2e-getgone', name: 'polGone', priority: 1, status: 'deleted' }
            ];
            testUtils.resetCollection('policies', mockPols.concat([polAdminPol])).done(done);
        });

        it('should get all policies', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('p-e2e-admin');
                expect(resp.body[1].id).toBe('p-e2e-getQry1');
                expect(resp.body[2].id).toBe('p-e2e-getQry2');
                expect(resp.body[3].id).toBe('p-e2e-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'GET /api/account/policies/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get policies by name', function(done) {
            options.qs.name = 'pol3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('p-e2e-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.name = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'name,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('p-e2e-getQry3');
                expect(resp.body[1].id).toBe('p-e2e-getQry2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('p-e2e-getQry1');
                expect(resp.body[1].id).toBe('p-e2e-admin');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/policies/', function() {
        var mockPol, mockApps, options;
        beforeEach(function(done) {
            mockPol = {
                name: 'e2eCreatedPol',
                priority: 3,
                permissions: {
                    cards: { read: 'own', create: 'own', edit: 'own', delete: 'deny' },
                    policies: { read: 'all' },
                },
                fieldValidation: {
                    cards: { status: { _allowed: true } }
                },
                entitlements: {
                    editActiveCards: true
                },
                applications: ['e-app2', 'e-app1']
            };
            mockApps = [
                { id: 'e-app1', status: [{ status: 'active' }] },
                { id: 'e-app2', status: [{ status: 'active' }] },
                { id: 'e-app3', status: [{ status: 'active' }] }
            ];
            options = {
                url: config.polsUrl + '/',
                jar: cookieJar,
                json: mockPol
            };
            q.all([
                testUtils.resetCollection('experiences', mockApps),
                testUtils.resetCollection('policies', polAdminPol)
            ]).done(function() {
                done();
            });
        });

        it('should be able to create a policy', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'active',
                    name: 'e2eCreatedPol',
                    priority: 3,
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    permissions: {
                        cards: { read: 'own', create: 'own', edit: 'own', delete: 'deny' },
                        policies: { read: 'all' },
                    },
                    fieldValidation: {
                        cards: { status: { _allowed: true } }
                    },
                    entitlements: {
                        editActiveCards: true
                    },
                    applications: ['e-app2', 'e-app1']
                });
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'POST /api/account/policies/', params: {}, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 409 if a policy exists with the same name', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.name).toBe('e2eCreatedPol');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 for an invalid name', function(done) {
            mockPol.name = 'a test policy';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid name');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if no name is provided', function(done) {
            delete mockPol.name;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim out invalid permissions verbs and scopes', function(done) {
            mockPol.permissions.cards = { read: 'all', eat: 'all', edit: 'some' };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.permissions.cards).toEqual({ read: 'all' });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if some of the applications do not exist', function(done) {
            mockPol.applications.push('e-app4');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These applications were not found: [e-app4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the user cannot pass some of the applications', function(done) {
            mockPol.applications.push('e-app3');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('applications[2] is not one of the acceptable values: [e-app1,e-app2,e-app4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.permissions.users = { read: 'all' };
            options.json.fieldValidation.orgs = { name: { _allowed: false } };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.name).toBe('e2eCreatedPol');
                expect(resp.body.permissions).toEqual({
                    cards: { read: 'own', create: 'own', edit: 'own', delete: 'deny' },
                    policies: { read: 'all' },
                });
                expect(resp.body.fieldValidation).toEqual({
                    cards: { status: { _allowed: true } }
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/account/policies/:id', function() {
        var mockApps, mockPolicies, options;
        beforeEach(function(done) {
            mockPolicies = [
                {
                    id: 'p-e2e-put1',
                    name: 'testPol1',
                    created: new Date(),
                    lastUpdated: new Date(),
                    status: 'active',
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'not-e2e-user',
                    priority: 1,
                    permissions: {
                        cards: { read: 'all', create: 'own' }
                    }
                },
                {
                    id: 'p-e2e-put2',
                    name: 'testPol2',
                    status: 'active',
                    priority: 2, 
                },
                {
                    id: 'p-e2e-deleted',
                    name: 'testPolDeleted',
                    status: 'deleted',
                    priority: 3
                },
            ];
            mockApps = [
                { id: 'e-app1', status: [{ status: 'active' }] },
                { id: 'e-app2', status: [{ status: 'active' }] },
                { id: 'e-app3', status: [{ status: 'active' }] }
            ];
            options = {
                url: config.polsUrl + '/p-e2e-put1',
                jar: cookieJar,
                json: { entitlements: { editActiveCards: true }, priority: 10 }
            };
            q.all([
                testUtils.resetCollection('policies', mockPolicies.concat([polAdminPol])),
                testUtils.resetCollection('experiences', mockApps)
            ]).done(function() {
                done();
            });
        });
        
        it('should successfully update a policy', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'p-e2e-put1',
                    name: 'testPol1',
                    status: 'active',
                    created: mockPolicies[0].created.toISOString(),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    priority: 10,
                    permissions: {
                        cards: { read: 'all', create: 'own' }
                    },
                    entitlements: {
                        editActiveCards: true
                    }
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(mockPolicies[0].lastUpdated);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'PUT /api/account/policies/:id',
                                                 params: { id: 'p-e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off any forbidden fields', function(done) {
            options.json = mockPolicies[0];
            options.json.name = 'someNewName';
            options.json.permissions.experiences = { read: 'all' };
            options.json.fieldValidation = {
                cards: {
                    status: { _allowed: true }
                },
                categories: {
                    status: { _allowed: true }
                }
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'p-e2e-put1',
                    name: 'testPol1',
                    status: 'active',
                    created: mockPolicies[0].created.toISOString(),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    priority: 1,
                    permissions: {
                        cards: { read: 'all', create: 'own' }
                    },
                    fieldValidation: {
                        cards: {
                            status: { _allowed: true }
                        }
                    }
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(mockPolicies[0].lastUpdated);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should trim out invalid permissions verbs and scopes', function(done) {
            options.json.permissions = { cards: { read: 'all', eat: 'all', edit: 'some' } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.permissions.cards).toEqual({ read: 'all' });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if some of the applications do not exist', function(done) {
            options.json.applications = ['e-app4'];
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These applications were not found: [e-app4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the user cannot pass some of the applications', function(done) {
            options.json.applications = ['e-app3'];
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('applications[0] is not one of the acceptable values: [e-app1,e-app2,e-app4]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a policy that has been deleted', function(done) {
            options.url = config.polsUrl + '/p-e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a policy if it does not exist', function(done) {
            options.url = config.polsUrl + '/e2e-putfake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/policies/:id', function() {
        var mockPolicies, mockUsers, mockRoles, options;
        beforeEach(function(done) {
            mockPolicies = [
                { id: 'p-e2e-del1', name: 'testPol1', status: 'active' },
                { id: 'p-e2e-del2', name: 'testPol2', status: 'active' },
                { id: 'p-e2e-del3', name: 'testPol3', status: 'active' },
                { id: 'p-e2e-del4', name: 'testPol4', status: 'deleted' }
            ];
            mockUsers = [
                { id: 'u-1', status: 'active', policies: ['testPol2'] },
                { id: 'u-2', status: 'deleted', policies: ['testPol1'] }
            ];
            mockRoles = [
                { id: 'r-1', name: 'testRole1', status: 'active', policies: ['testPol3'] },
                { id: 'r-2', name: 'testRole2', status: 'deleted', policies: ['testPol1'] }
            ];
            options = {
                url: config.polsUrl + '/p-e2e-del1',
                jar: cookieJar,
            };
            q.all([
                testUtils.resetCollection('policies', mockPolicies.concat([polAdminPol])),
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('users', mockUsers.concat([mockRequester]))
            ]).done(function() {
                done();
            });
        });
        

        it('should delete a policy', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.polsUrl + '/p-e2e-del1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
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
                expect(results[0].data).toEqual({route: 'DELETE /api/account/policies/:id',
                                                 params: { id: 'p-e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the policy has been deleted', function(done) {
            options.url = config.polsUrl + '/p-e2e-del4';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the policy does not exist', function(done) {
            options.url = config.polsUrl + '/SLDKFJWEO';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the policy is in use', function(done) {
            options.url = config.polsUrl + '/p-e2e-del2';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Policy still in use by users or roles');
                options.url = config.polsUrl + '/p-e2e-del3';
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Policy still in use by users or roles');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
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
