var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };
    

describe('ads customers endpoints (E2E):', function() {
    var cookieJar, nonAdminJar;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (cookieJar && cookieJar.cookies && nonAdminJar && nonAdminJar.cookies) {
            return done();
        }

        cookieJar = request.jar();
        nonAdminJar = request.jar();
        var mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['manageAllCusts']
        };
        var nonAdmin = {
            id: 'e2e-nonAdminUser',
            status: 'active',
            email : 'nonadminuser',
            advertiser: 'e2e-a-1',
            customer: 'e2e-cu-1',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['manageOwnCust']
        };
        testPolicies = [
            {
                id: 'p-e2e-allCusts',
                name: 'manageAllCusts',
                status: 'active',
                priority: 1,
                permissions: {
                    customers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-ownCust',
                name: 'manageOwnCust',
                status: 'active',
                priority: 1,
                permissions: {
                    customers: { read: 'own', edit: 'own', delete: 'own' }
                }
            }
        ];
        var logins = [
            {url: config.authUrl + '/login', json: {email: mockUser.email, password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: nonAdmin.email, password: 'password'}, jar: nonAdminJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockUser, nonAdmin]),
            testUtils.resetCollection('policies', testPolicies)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });
    
    describe('GET /api/account/customers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockCusts = [
                { id: 'e2e-cu-1', name: 'cust 1', status: 'active' },
                { id: 'e2e-cu-2', name: 'cust 2', status: 'active' },
                { id: 'e2e-deleted', name: 'cust deted', status: 'deleted' },
            ];
            options = {
                url: config.adsUrl + '/account/customers/e2e-cu-1',
                jar: cookieJar
            };
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should get a customer by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-cu-1', name: 'cust 1', status: 'active' });
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
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/customers/:id',
                                                 params: { 'id': 'e2e-cu-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'id,name' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-cu-1', name: 'cust 1' });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a non-admin to only retrieve their advertiser', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-cu-1', 'e2e-cu-2'].map(function(id) {
                options.url = config.adsUrl + '/account/customers/' + id;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body).toEqual({ id: 'e2e-cu-1', name: 'cust 1', status: 'active' });
                expect(results[1].response.statusCode).toBe(404);
                expect(results[1].body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted customers', function(done) {
            options.url = config.adsUrl + '/account/customers/e2e-deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.adsUrl + '/account/customers/e2e-cu-5678';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/customers', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/account/customers',
                qs: { sort: 'id,1' },
                jar: cookieJar
            };
            var mockCusts = [
                { id: 'e2e-cu-1', name: 'cust 1', status: 'active' },
                { id: 'e2e-cu-2', name: 'cust 2', status: 'active' },
                { id: 'e2e-cu-3', name: 'cust 3', status: 'inactive' },
                { id: 'e2e-getgone', name: 'cust deleted', status: 'deleted' }
            ];
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should get all customers', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-cu-1');
                expect(resp.body[1].id).toBe('e2e-cu-2');
                expect(resp.body[2].id).toBe('e2e-cu-3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
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
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/customers/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow specifying which fields to return', function(done) {
            options.qs.fields = 'name';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-cu-1', name: 'cust 1' },
                    { id: 'e2e-cu-2', name: 'cust 2' },
                    { id: 'e2e-cu-3', name: 'cust 3' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get customers by name', function(done) {
            options.qs.name = 'cust 2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-cu-2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get customers by id list', function(done) {
            options.qs.ids = 'e2e-cu-1,e2e-cu-3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-cu-1');
                expect(resp.body[1].id).toBe('e2e-cu-3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.name = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'name,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-cu-3');
                expect(resp.body[1].id).toBe('e2e-cu-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-cu-2');
                expect(resp.body[1].id).toBe('e2e-cu-1');
                expect(resp.response.headers['content-range']).toBe('items 2-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only show non-admins their own customer', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-cu-1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/customers', function() {
        var options, mockAdverts;
        beforeEach(function(done) {
            mockAdverts = [
                { id: 'a-1', name: 'advert 1', status: 'active' },
                { id: 'a-2', name: 'advert 2', status: 'active' },
                { id: 'a-3', name: 'advert 3', status: 'deleted' },
            ];
            options = {
                url: config.adsUrl + '/account/customers/',
                json: {
                    name: 'fake customer',
                    advertisers: ['a-1', 'a-2']
                },
                jar: cookieJar,
            };
            q.all([
                testUtils.resetCollection('advertisers', mockAdverts),
                testUtils.resetCollection('customers')
            ]).done(function() { done(); });
        });

        it('should be able to create a customer', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('fake customer');
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                expect(resp.body.advertisers).toEqual(['a-1', 'a-2']);
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
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/customers/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if linked advertisers are deleted or nonexistent', function(done) {
            q.all([['a-1', 'a-3'], ['a-1', 'a-fake']].map(function(adverts) {
                options.json.advertisers = adverts;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('These advertisers were not found: [a-3]');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('These advertisers were not found: [a-fake]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if no name is provided', function(done) {
            delete options.json.name;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the name is not unique', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.name).toBe('fake customer');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'cu-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('a-fake');
                expect(new Date(resp.body.created)).toBeGreaterThan(options.json.created);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/account/customers/:id', function() {
        var mockCusts, mockAdverts, options;
        beforeEach(function(done) {
            mockAdverts = [
                { id: 'a-1', name: 'advert 1', status: 'active' },
                { id: 'a-2', name: 'advert 2', status: 'active' },
                { id: 'a-3', name: 'advert 3', status: 'deleted' },
            ];
            mockCusts = [
                { id: 'e2e-cu-1', status: 'active', name: 'cust 1', advertisers: ['a-1'] },
                { id: 'e2e-cu-2', status: 'active', name: 'cust 2', advertisers: ['a-2'] },
                { id: 'e2e-deleted', status: 'deleted', name: 'deleted cust' }
            ];
            options = {
                url: config.adsUrl + '/account/customers/e2e-cu-1',
                json: { name: 'new name', advertisers: ['a-2', 'a-1'] },
                jar: cookieJar
            };
            q.all([
                testUtils.resetCollection('advertisers', mockAdverts),
                testUtils.resetCollection('customers', mockCusts)
            ]).done(function() { done(); });
        });

        it('should successfully update a customer', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-cu-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.advertisers).toEqual(['a-2', 'a-1']);
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
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/account/customers/:id',
                                                 params: { id: 'e2e-cu-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if linked advertisers are deleted or nonexistent', function(done) {
            q.all([['a-1', 'a-3'], ['a-1', 'a-fake']].map(function(adverts) {
                options.json.advertisers = adverts;
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('These advertisers were not found: [a-3]');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('These advertisers were not found: [a-fake]');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow changing the name to one already in use', function(done) {
            options.json.name = 'cust 2';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'a-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).toBe('e2e-cu-1');
                expect(resp.body.created).not.toEqual(options.json.created);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should only allow non-admins to edit their own customer', function(done) {
            options.jar = nonAdminJar;
            delete options.json.name;
            q.all(['e2e-cu-1', 'e2e-cu-2'].map(function(id) {
                options.url = config.adsUrl + '/account/customers/' + id;
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.id).toBe('e2e-cu-1');
                expect(results[0].body.name).toBe('cust 1');
                expect(results[0].body.advertisers).toEqual(['a-2', 'a-1']);
                
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to edit this');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a customer that has been deleted', function(done) {
            options.url = config.adsUrl + '/account/customers/e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a customer if they do not exist', function(done) {
            options.url = config.adsUrl + '/account/customers/e2e-cu-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/customers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockCusts = [
                { id: 'e2e-cu-1', status: 'active', name: 'cust 1' },
                { id: 'e2e-cu-2', status: 'active', name: 'cust 2' },
                { id: 'e2e-deleted', status: 'deleted', name: 'cust deleted' }
            ];
            options = {
                url: config.adsUrl + '/account/customers/e2e-cu-1',
                jar: cookieJar
            };
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should delete a customer from adtech and set its status to deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.adsUrl + '/account/customers/e2e-cu-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write to the audit collection', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/customers/:id',
                                                 params: { id: 'e2e-cu-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the customer has been deleted', function(done) {
            options.url = config.adsUrl + '/account/customers/e2e-deleted';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the customer does not exist', function(done) {
            options.url = config.adsUrl + '/account/customers/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow non-admins to edit their own advertiser', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-cu-1', 'e2e-cu-2'].map(function(id) {
                options.url = config.adsUrl + '/account/customers/' + id;
                return requestUtils.qRequest('delete', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(204);
                expect(results[0].body).toBe('');
                
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to delete this');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/account/customers/e2e-cu-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
