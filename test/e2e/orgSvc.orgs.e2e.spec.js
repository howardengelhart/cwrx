var q               = require('q'),
    braintree       = require('braintree'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        orgSvcUrl   : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account/orgs',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'jpqghw7xgc5jh8tf',
        privateKey  : '32de5ae191d10ffdc374b3232520ef7c'
    });
    
describe('orgSvc orgs (E2E):', function() {
    var cookieJar, nonAdminJar, mockRequester, nonAdminUser, testPolicies, mockApp, appCreds;
    
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        if (cookieJar && nonAdminJar) {
            return done();
        }

        cookieJar = request.jar();
        nonAdminJar = request.jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'orgsvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['manageAllOrgs']
        };
        nonAdminUser = {
            id: 'e2e-nonAdminUser',
            status: 'active',
            email : 'orgsvce2enonadminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['manageOwnOrg']
        };
        testPolicies = [
            {
                id: 'p-e2e-allOrgs',
                name: 'manageAllOrgs',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                },
                fieldValidation: {
                    orgs: {
                        adConfig: { __allowed: true }
                    }
                }
            },
            {
                id: 'p-e2e-ownOrg',
                name: 'manageOwnOrg',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'own', create: 'own', edit: 'own', delete: 'own' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-orgs',
            key: 'e2e-orgs',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            {url: config.authUrl + '/login', json: {email: 'orgsvce2euser', password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: 'orgsvce2enonadminuser', password: 'password'}, jar: nonAdminJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockRequester, nonAdminUser]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });
    

    describe('GET /api/account/orgs/:id', function() {
        var mockOrgs, options;
        beforeEach(function(done) {
            mockOrgs = [
                { id: 'o-1234', name: 'e2e-getId1', status: 'active' },
                { id: 'o-4567', name: 'e2e-getId2', status: 'active' },
                { id: 'o-deleted', name: 'e2e-getId1', status: 'deleted' }
            ];
            options = { url: config.orgSvcUrl + '/o-1234', jar: cookieJar };
            testUtils.resetCollection('orgs', mockOrgs).done(done);
        });
        
        it('should get an org by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'o-1234',
                    name: 'e2e-getId1',
                    status: 'active'
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/orgs/:id',
                                                 params: { id: 'o-1234' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'name' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'o-1234',
                    name: 'e2e-getId1'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not be able to get a deleted org', function(done) {
            options.url = config.orgSvcUrl + '/o-deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the requester cannot see the org', function(done) {
            options.url = config.orgSvcUrl + '/o-4567';
            options.jar = nonAdminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an admin to get other orgs besides their own', function(done) {
            options.url = config.orgSvcUrl + '/o-4567';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'o-4567',
                    name: 'e2e-getId2',
                    status: 'active'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if nothing is found', function(done) {
            options.url = config.orgSvcUrl + '/e2e-fake1';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/e2e-fake1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get an org', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'o-1234',
                    name: 'e2e-getId1',
                    status: 'active'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/orgs', function() {
        var mockOrgs, options;
        beforeEach(function(done) {
            mockOrgs = [
                { id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                { id: 'o-4567', name: 'e2e-getOrg2', status: 'active' },
                { id: 'o-7890', name: 'e2e-getOrg1', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                { id: 'o-deleted', name: 'e2e-getOrg1', status: 'deleted' }
            ];
            options = { url: config.orgSvcUrl + '/', qs: { sort: 'id,1' }, jar: cookieJar };
            testUtils.resetCollection('orgs', mockOrgs).done(done);
        });
        
        it('should get orgs', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                    { id: 'o-4567', name: 'e2e-getOrg2', status: 'active' },
                    { id: 'o-7890', name: 'e2e-getOrg1', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' }
                ]);
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/orgs/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'name';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1234', name: 'e2e-getOrg3' },
                    { id: 'o-4567', name: 'e2e-getOrg2' },
                    { id: 'o-7890', name: 'e2e-getOrg1' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get orgs by list of ids', function(done) {
            options.qs.ids = 'o-1234,o-4567';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                    { id: 'o-4567', name: 'e2e-getOrg2', status: 'active' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get no orgs if the ids param is empty', function(done) {
            options.qs.ids = '';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get all orgs with a payment plan', function(done) {
            options.qs.hasPaymentPlan = true;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                    { id: 'o-7890', name: 'e2e-getOrg1', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).then(done, done.fail);
        });
        
        it('should get orgs with a given promotion', function(done) {
            testUtils.resetCollection('orgs', [
                { id: 'o-1', status: 'active', promotions: [{ id: 'pro-1' }, { id: 'pro-2' }] },
                { id: 'o-2', status: 'active', promotions: [{ id: 'pro-2' }] },
                { id: 'o-3', status: 'active', promotions: [{ id: 'pro-3' }, { id: 'pro-1' }] }
            ]).then(function() {
                options.qs.promotion = 'pro-1';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1', status: 'active', promotions: [{ id: 'pro-1' }, { id: 'pro-2' }] },
                    { id: 'o-3', status: 'active', promotions: [{ id: 'pro-3' }, { id: 'pro-1' }] }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).then(done, done.fail);
        });

        it('should get all orgs without a payment plan', function(done) {
            options.qs.hasPaymentPlan = false;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-4567', name: 'e2e-getOrg2', status: 'active' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).then(done, done.fail);
        });
        
        it('should be able to sort and paginate the results', function(done) {
            options.qs.sort = 'name,1';
            options.qs.limit = 1;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{ id: 'o-7890', name: 'e2e-getOrg1', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' }]);
                expect(resp.response.headers['content-range']).toBe('items 1-1/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{ id: 'o-4567', name: 'e2e-getOrg2', status: 'active' }]);
                expect(resp.response.headers['content-range']).toBe('items 2-2/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.ids = 'alweuroaidadslkfj';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow non-admins to see their own org', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{ id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' }]);
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
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

        it('should allow an app to get orgs', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'o-1234', name: 'e2e-getOrg3', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' },
                    { id: 'o-4567', name: 'e2e-getOrg2', status: 'active' },
                    { id: 'o-7890', name: 'e2e-getOrg1', status: 'active', paymentPlanId: 'pp-0Ek1iM02uYGNaLIL' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/orgs', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.orgSvcUrl + '/',
                json: { name: 'e2e-org' },
                jar: cookieJar
            };
            testUtils.resetCollection('orgs').done(done);
        });
        
        it('should be able to create an org', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id: jasmine.any(String),
                    status: 'active',
                    created: jasmine.any(String),
                    lastUpdated: jasmine.any(String),
                    name: 'e2e-org',
                    config: {},
                    waterfalls: { video: ['cinema6'], display: ['cinema6'] }
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/orgs/',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to override default properties', function(done) {
            options.json.status = 'pending';
            options.json.waterfalls = { video: ['cinema6'] };
            options.json.config = { foo: 'bar' };
            options.json.adConfig = { ads: 'yes' };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.status).toBe('pending');
                expect(resp.body.waterfalls).toEqual({video: ['cinema6'], display: ['cinema6']});
                expect(resp.body.config).toEqual({foo: 'bar'});
                expect(resp.body.adConfig).toEqual({ ads: 'yes' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off forbidden fields', function(done) {
            options.json.id = 'myfakeid';
            options.json.braintreeCustomer = 'fakecust';
            options.json.referralCode = 'fwuei9fhrue9if';
            options.json.promotions = [{ type: 'foo' }];
            options.json.paymentPlanId = 'pp-u8w394hru4';
            options.json.paymentPlanStart = new Date().toISOString();
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).not.toBe('myfakeid');
                expect(resp.body.braintreeCustomer).not.toBeDefined();
                expect(resp.body.referralCode).toBeUndefined();
                expect(resp.body.promotions).toBeUndefined();
                expect(resp.body.paymentPlanId).toBeUndefined();
                expect(resp.body.paymentPlanStart).toBeUndefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 error if the body is missing the name', function(done) {
            options.json = { config: { foo: 'bar' } };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 409 error if an org with that name exists', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 error if the user is not authenticated for creating orgs', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to create orgs');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow the adConfig to be set by users with permission', function(done) {
            options.json.adConfig = { ads: 'good' };
            delete testPolicies[0].fieldValidation.orgs.adConfig;

            testUtils.resetCollection('policies', testPolicies).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.adConfig).not.toBeDefined();
                testPolicies[0].fieldValidation.orgs.adConfig = { __allowed: true };
                return testUtils.resetCollection('policies', testPolicies);
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

        it('should allow an app to create an org', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    id: jasmine.any(String),
                    name: 'e2e-org',
                    waterfalls: { video: ['cinema6'], display: ['cinema6'] }
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/account/orgs/:id', function() {
        var start = new Date(),
            mockOrgs, options;
        beforeEach(function(done) {
            mockOrgs = [
                {
                    id: 'o-1234',
                    name: 'e2e-put1',
                    status: 'active',
                    tag: 'foo',
                    created: start,
                    adConfig: { ads: 'good' },
                    waterfalls: {
                        video: ['cinema6', 'publisher'],
                        display: ['cinema6', 'publisher']
                    }
                },
                {
                    id: 'o-4567',
                    name: 'e2e-put2',
                    status: 'active',
                    tag: 'baz',
                    adConfig: { ads: 'ok' },
                    created: start
                }
            ];
            options = {
                url: config.orgSvcUrl + '/o-1234',
                json: {
                    tag: 'bar',
                    waterfalls: { video: ['cinema6'], display: ['cinema6'] }
                },
                jar: cookieJar
            };
            testUtils.resetCollection('orgs', mockOrgs).done(done);
        });
        
        it('should successfully update an org', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'o-1234',
                    name: 'e2e-put1',
                    status: 'active',
                    created: start.toISOString(),
                    lastUpdated: jasmine.any(String),
                    tag: 'bar',
                    adConfig: { ads: 'good' },
                    waterfalls: { video: ['cinema6'], display: ['cinema6'] }
                });
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(resp.body.created));
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/account/orgs/:id',
                                                 params: { id: 'o-1234' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the org does not exist', function(done) {
            options.url = config.orgSvcUrl + '/org-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 403 if the requester is not authorized to edit the org', function(done) {
            options.url = config.orgSvcUrl + '/o-4567';
            options.jar = nonAdminJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not let users edit orgs\' adConfig if they lack permission', function(done) {
            options.json = { adConfig: { ads: 'bad' } };
            options.jar = nonAdminJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.adConfig).toEqual({ ads: 'good' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should let users edit orgs\' adConfig if they have permission', function(done) {
            options.json = { adConfig: { ads: 'bad' } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.adConfig).toEqual({ads: 'bad'});
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 409 if an org exists with the new name', function(done) {
            options.json = { name: 'e2e-put2' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim out forbidden fields', function(done) {
            options.json.id = 'qwer';
            options.json.created = 'new_created';
            options.json.braintreeCustomer = 'your mom';
            options.json.referralCode = 'fwuei9fhrue9if';
            options.json.promotions = [{ type: 'foo' }];
            options.json.paymentPlanId = 'pp-u8w394hru4';
            options.json.paymentPlanStart = new Date().toISOString();
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('o-1234');
                expect(resp.body.created).toBe(start.toISOString());
                expect(resp.body.braintreeCustomer).toBeUndefined();
                expect(resp.body.referralCode).toBeUndefined();
                expect(resp.body.promotions).toBeUndefined();
                expect(resp.body.paymentPlanId).toBeUndefined();
                expect(resp.body.paymentPlanStart).toBeUndefined();
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

        it('should allow an app to edit an org', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('o-1234');
                expect(resp.body.tag).toBe('bar');
                expect(resp.body.waterfalls).toEqual({ video: ['cinema6'], display: ['cinema6'] });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/orgs/:id', function() {
        var mockOrgs, options;
        beforeEach(function(done) {
            mockOrgs = [
                { id: 'org1', name: 'e2e-delete1', status: 'active'},
                { id: 'org2', name: 'e2e-delete2', status: 'active' },
                { id: 'o-1234', name: 'e2e-delete3', status: 'active' }
            ];
            options = {
                url: config.orgSvcUrl + '/org1',
                jar: cookieJar
            };
            q.all([
                testUtils.resetCollection('users', [mockRequester, nonAdminUser]),
                testUtils.resetCollection('orgs', mockOrgs),
                testUtils.resetCollection('campaigns')
            ]).done(function() { done(); });
        });
        
        it('should successfully mark an org as deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/e2e-delete1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: config.orgSvcUrl + '/org1', jar: cookieJar };
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/orgs/:id',
                                                 params: { id: 'org1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still succeed if the org does not exist', function(done) {
            options.url = config.orgSvcUrl + '/org-fake';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still succeed if the org has already been deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the org has a braintreeCustomer', function() {
            var mockCust, mockOrg;
            beforeEach(function(done) {
                options.url = config.orgSvcUrl + '/o-braintree1';
                q.npost(gateway.customer, 'create', [{company: 'e2eDeleteOrgTest'}]).then(function(result) {
                    if (!result.success) {
                        return q.reject(result);
                    }
                    mockCust = result.customer;
                    
                    mockOrg = {
                        id: 'o-braintree1',
                        status: 'active',
                        name: 'org w/ cust',
                        braintreeCustomer: mockCust.id
                    };
                    
                    return testUtils.resetCollection('orgs', mockOrg);
                }).done(done);
            });
            
            afterEach(function(done) {
                if (!mockCust || !mockCust.id) {
                    return done();
                }
                
                q.npost(gateway.customer, 'delete', [mockCust.id]).done(function() {
                    done();
                });
            });
            
            it('should also delete the braintree customer', function(done) {
                requestUtils.qRequest('delete', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    options = { url: config.orgSvcUrl + '/' + mockOrg.id, jar: cookieJar };
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');

                    return q.npost(gateway.customer, 'find', [mockOrg.braintreeCustomer])
                    .then(function(result) {
                        expect(result).not.toBeDefined();
                    })
                    .catch(function(error) {
                        expect(error.name).toBe('notFoundError');
                        mockCust = null;
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should not fail if the braintree customer is non-existent', function(done) {
                mockOrg.braintreeCustomer = 'asdf1234';
                testUtils.resetCollection('orgs', mockOrg).then(function() {
                    return requestUtils.qRequest('delete', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    options = { url: config.orgSvcUrl + '/' + mockOrg.id, jar: cookieJar };
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should not allow a user to delete their own org', function(done) {
            options.url = config.orgSvcUrl + '/o-1234';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete your own org');
                options = { url: config.orgSvcUrl + '/o-1234', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 403 if the requester is not authorized to delete the org', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent deleting an org with active users', function(done) {
            var org = {id: 'o-del-1', status: 'active'},
                user = {id: 'u-del-1', status: 'active', org: 'o-del-1'},
                options = { url: config.orgSvcUrl + '/o-del-1', jar: cookieJar };
            testUtils.resetCollection('orgs', org).then(function() {
                return testUtils.resetCollection('users', [mockRequester, user]);
            }).then(function() {
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Org still has active users');
                options = { url: config.orgSvcUrl + '/o-del-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow deleting an org with inactive users', function(done) {
            var org = {id: 'o-del-1', status: 'active'},
                user = {id: 'u-del-1', status: 'deleted', org: 'o-del-1'},
                options = { url: config.orgSvcUrl + '/o-del-1', jar: cookieJar };
            testUtils.resetCollection('orgs', org).then(function() {
                return testUtils.resetCollection('users', [mockRequester, user]);
            }).then(function() {
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/o-del-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent deleting an org with unfinished campaigns', function(done) {
            var camps = [
                { id: 'cam-e2e-1', status: 'active', org: 'org1' },
                { id: 'cam-e2e-2', status: 'canceled', org: 'org2' },
                { id: 'cam-e2e-3', status: 'expired', org: 'org2' },
                { id: 'cam-e2e-4', status: 'outOfBudget', org: 'org2' },
            ];
            testUtils.resetCollection('campaigns', camps).then(function() {
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Org still has unfinished campaigns');
                
                options.url = config.orgSvcUrl + '/org2';
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    
        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to delete an org', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
