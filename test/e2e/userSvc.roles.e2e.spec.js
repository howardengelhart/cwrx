var q               = require('q'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        rolesUrl    : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account/roles',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('userSvc roles endpoints (E2E):', function() {
    var cookieJar, mockRequester, roleAdminPol;
        
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

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
            policies: ['e2eRoleAdmin']
        };
        roleAdminPol = {
            id: 'p-e2e-roles',
            name: 'e2eRoleAdmin',
            status: 'active',
            priority: 1,
            permissions: {
                roles: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
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
            testUtils.resetCollection('policies', roleAdminPol),
            testUtils.resetCollection('roles')
        ]).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/account/roles/:id', function() {
        beforeEach(function(done) {
            var mockRoles = [
                { id: 'r-e2e-get1', name: 'role1', status: 'active' },
                { id: 'r-e2e-get2', name: 'role2', status: 'deleted' }
            ];
            testUtils.resetCollection('roles', mockRoles).done(done);
        });
        
        it('should get a role by id', function(done) {
            var options = {url: config.rolesUrl + '/r-e2e-get1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'r-e2e-get1', name: 'role1', status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.rolesUrl + '/r-e2e-get1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/account/roles/:id',
                                                 params: { 'id': 'r-e2e-get1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted roles', function(done) {
            var options = {url: config.rolesUrl + '/r-e2e-get2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.rolesUrl + '/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            var options = { url: config.rolesUrl + '/r-e2e-get1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/roles/', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.rolesUrl + '/', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockRoles = [
                { id: 'r-e2e-getQry1', name: 'role1', status: 'active', policies: ['pol1', 'pol2'] },
                { id: 'r-e2e-getQry2', name: 'role2', status: 'inactive', policies: ['pol2'] },
                { id: 'r-e2e-getQry3', name: 'role3', status: 'active', policies: ['pol1'] },
                { id: 'r-e2e-getgone', name: 'roleGone', status: 'deleted', policies: ['pol1', 'pol2'] }
            ];
            testUtils.resetCollection('roles', mockRoles).done(done);
        });

        it('should get all roles', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('r-e2e-getQry1');
                expect(resp.body[1].id).toBe('r-e2e-getQry2');
                expect(resp.body[2].id).toBe('r-e2e-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
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
                expect(results[0].data).toEqual({route: 'GET /api/account/roles/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get roles by name', function(done) {
            options.qs.name = 'role3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('r-e2e-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get roles by policy', function(done) {
            options.qs.policy = 'pol1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('r-e2e-getQry1');
                expect(resp.body[1].id).toBe('r-e2e-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
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
                expect(resp.body[0].id).toBe('r-e2e-getQry3');
                expect(resp.body[1].id).toBe('r-e2e-getQry2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('r-e2e-getQry2');
                expect(resp.body[1].id).toBe('r-e2e-getQry1');
                expect(resp.response.headers['content-range']).toBe('items 2-3/3');
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

    describe('POST /api/account/roles/', function() {
        var mockRole, mockPolicies, options;
        beforeEach(function(done) {
            mockRole = { name: 'e2eCreatedRole', policies: ['testPol1', 'testPol2'] };
            mockPolicies = [
                { id: 'p-1', name: 'testPol1', status: 'active' },
                { id: 'p-2', name: 'testPol2', status: 'active' },
                { id: 'p-3', name: 'testPol3', status: 'active' }
            ];
            options = {
                url: config.rolesUrl + '/',
                jar: cookieJar,
                json: mockRole
            };
            q.all([
                testUtils.resetCollection('roles'),
                testUtils.resetCollection('policies', mockPolicies.concat([roleAdminPol]))
            ]).done(function() {
                done();
            });
        });

        it('should be able to create a role', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'active',
                    name: 'e2eCreatedRole',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    policies: ['testPol1', 'testPol2']
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
                expect(results[0].data).toEqual({route: 'POST /api/account/roles/', params: {}, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 409 if a role exists with the same name', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.name).toBe('e2eCreatedRole');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 for an invalid name', function(done) {
            mockRole.name = 'a test role';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid name');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if no name is provided', function(done) {
            delete mockRole.name;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if some of the policies do not exist', function(done) {
            mockRole.policies.push('someOtherPol');
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These policies were not found: [someOtherPol]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json = {
                id: 'myId',
                created: '2015-08-18T19:02:43.251Z',
                name: 'e2eCreatedRole',
                createdBy: 'me',
                lastUpdatedBy: 'you'
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).not.toBe('myId');
                expect(resp.body.created).not.toBe('2015-08-18T19:02:43.251Z');
                expect(resp.body.name).toBe('e2eCreatedRole');
                expect(resp.body.createdBy).toBe('e2e-user');
                expect(resp.body.lastUpdatedBy).toBe('e2e-user');
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

    describe('PUT /api/account/roles/:id', function() {
        var mockRoles, mockPolicies, options;
        beforeEach(function(done) {
            mockRoles = [
                {
                    id: 'r-e2e-put1',
                    name: 'testRole1',
                    created: new Date(),
                    lastUpdated: new Date(),
                    status: 'active',
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'not-e2e-user',
                    policies: ['testPol1', 'testPol2']
                },
                {
                    id: 'r-e2e-put2',
                    name: 'testRole2',
                    status: 'active',
                },
                {
                    id: 'r-e2e-deleted',
                    name: 'testRoleDeleted',
                    status: 'deleted',
                },
            ];
            mockPolicies = [
                { id: 'p-1', name: 'testPol1', status: 'active' },
                { id: 'p-2', name: 'testPol2', status: 'active' },
                { id: 'p-3', name: 'testPol3', status: 'active' }
            ];
            options = {
                url: config.rolesUrl + '/r-e2e-put1',
                jar: cookieJar,
                json: { policies: ['testPol3', 'testPol2'] }
            };
            q.all([
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('policies', mockPolicies.concat([roleAdminPol]))
            ]).done(function() {
                done();
            });
        });
        
        it('should successfully update a role', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'r-e2e-put1',
                    name: 'testRole1',
                    status: 'active',
                    created: mockRoles[0].created.toISOString(),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    policies: ['testPol3', 'testPol2']
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(mockRoles[0].lastUpdated);
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
                expect(results[0].data).toEqual({route: 'PUT /api/account/roles/:id',
                                                 params: { id: 'r-e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off any forbidden fields', function(done) {
            options.json = mockRoles[0];
            options.json.name = 'someNewName';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'r-e2e-put1',
                    name: 'testRole1',
                    status: 'active',
                    created: mockRoles[0].created.toISOString(),
                    lastUpdated: jasmine.any(String),
                    createdBy: 'not-e2e-user',
                    lastUpdatedBy: 'e2e-user',
                    policies: ['testPol1', 'testPol2']
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(mockRoles[0].lastUpdated);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if some of the policies do not exist', function(done) {
            options.json.policies.push('someOtherPol');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('These policies were not found: [someOtherPol]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a role that has been deleted', function(done) {
            options.url = config.rolesUrl + '/r-e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a role if it does not exist', function(done) {
            options.url = config.rolesUrl + '/e2e-putfake';
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

    describe('DELETE /api/account/roles/:id', function() {
        var mockRoles, mockUsers, options;
        beforeEach(function(done) {
            mockRoles = [
                { id: 'r-e2e-del1', name: 'testRole1', status: 'active' },
                { id: 'r-e2e-del2', name: 'testRole2', status: 'active' },
                { id: 'r-e2e-del3', name: 'testRole3', status: 'deleted' }
            ];
            mockUsers = [
                { id: 'u-1', status: 'active', roles: ['testRole2'] },
                { id: 'u-2', status: 'active', roles: ['testRole2', 'testRole3'] },
                { id: 'u-3', status: 'deleted', roles: ['testRole1'] }
            ];
            options = {
                url: config.rolesUrl + '/r-e2e-del1',
                jar: cookieJar,
            };
            q.all([
                testUtils.resetCollection('roles', mockRoles),
                testUtils.resetCollection('users', mockUsers.concat([mockRequester]))
            ]).done(function() {
                done();
            });
        });
        

        it('should delete a role', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.rolesUrl + '/r-e2e-del1', jar: cookieJar };
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
                expect(results[0].data).toEqual({route: 'DELETE /api/account/roles/:id',
                                                 params: { id: 'r-e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the role has been deleted', function(done) {
            options.url = config.rolesUrl + '/r-e2e-del3';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the role does not exist', function(done) {
            options.url = config.rolesUrl + '/SLDKFJWEO';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the role is in use', function(done) {
            options.url = config.rolesUrl + '/r-e2e-del2';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Role still in use by users');
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
