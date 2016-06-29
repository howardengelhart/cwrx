var request = require('request');
var createUuid = require('rc-uuid').createUuid;
var q = require('q');
var testUtils = require('./testUtils');
var requestUtils = require('../../lib/requestUtils');
var clone = require('lodash').cloneDeep;
var find = require('lodash').find;
var reject = require('lodash').reject;
var assign = require('lodash').assign;
var _ = require('lodash');

var HOST = (process.env.host || 'localhost');
var config = {
    paymentPlansUrl: 'http://' + (HOST === 'localhost' ? HOST + ':3700' : HOST) + '/api/payment-plans',
    authUrl: 'http://' + (HOST === 'localhost' ? HOST + ':3200' : HOST) + '/api/auth'
};


describe('orgSvc payment-plans endpoints', function() {
    var jar, app, appCreds, user, policy;
    var options;
    var success, failure, apiResponse;

    beforeEach(function(done) {
        apiResponse = null;

        jar = request.jar();

        app = {
            id: 'app-' + createUuid(),
            key: 'e2e-payment-plans',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                paymentPlans: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: app.key, secret: app.secret };

        user = {
            id: 'u-' + createUuid(),
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o' + createUuid(),
            policies: ['managePaymentPlans']
        };
        policy = {
            id: 'p-' + createUuid(),
            name: 'managePaymentPlans',
            status: 'active',
            priority: 1,
            permissions: {
                paymentPlans: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };

        options = {
            url: config.paymentPlansUrl,
            jar: jar,
            qs: {}
        };

        success = jasmine.createSpy('success()').and.callFake(function(/*apiResponse*/) {
            apiResponse = arguments[0];
        });

        q.all([
            testUtils.resetCollection('users', user),
            testUtils.resetCollection('policies', policy),
            testUtils.mongoUpsert('applications', { key: app.key }, app)
        ]).then(done, done.fail);
    });

    afterEach(function() {
        apiResponse = null;
    });

    describe('GET /api/payment-plans/:id', function() {
        var paymentPlans;

        beforeEach(function(done) {
            paymentPlans = [
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: '--canceled--',
                    price: 0,
                    maxCampaigns: 0,
                    viewsPerMonth: 0
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Starter',
                    price: 49.99,
                    maxCampaigns: 1,
                    viewsPerMonth: 2000
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Pro',
                    price: 149.99,
                    maxCampaigns: 3,
                    viewsPerMonth: 7500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Business',
                    price: 499.99,
                    maxCampaigns: 10,
                    viewsPerMonth: 25500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'deleted',
                    label: 'Enterprise',
                    price: 2000,
                    maxCampaigns: 500,
                    viewsPerMonth: 1000000
                }
            ];

            testUtils.resetCollection('paymentPlans', clone(paymentPlans)).then(done, done.fail);
        });

        describe('if authenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                }).then(done, done.fail);
            });

            describe('as an app', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    delete options.jar;

                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;

                    requestUtils.makeSignedRequest(appCreds, 'get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.response.headers['content-range']).not.toBeDefined();
                    expect(apiResponse.body).toEqual(paymentPlan);
                });

                describe('with a bad secret', function() {
                    beforeEach(function(done) {
                        appCreds.secret = 'WRONG';

                        requestUtils.makeSignedRequest(appCreds, 'get', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            });

            describe('and the object exists', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.response.headers['content-range']).not.toBeDefined();
                    expect(apiResponse.body).toEqual(paymentPlan);
                });

                it('should write an entry to the audit collection', function(done) {
                    testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'}).then(function(results) {
                        expect(results[0].user).toBe(user.id);
                        expect(results[0].created).toEqual(jasmine.any(Date));
                        expect(results[0].host).toEqual(jasmine.any(String));
                        expect(results[0].pid).toEqual(jasmine.any(Number));
                        expect(results[0].uuid).toEqual(jasmine.any(String));
                        expect(results[0].sessionID).toEqual(jasmine.any(String));
                        expect(results[0].service).toBe('orgSvc');
                        expect(results[0].version).toEqual(jasmine.any(String));
                        expect(results[0].data).toEqual({route: 'GET /api/payment-plans/:id', params: { id: paymentPlan.id }, query: {} });
                    }).then(done, done.fail);
                });

                describe('and fields are specified', function() {
                    beforeEach(function(done) {
                        apiResponse = null;

                        options.qs = { fields: 'label' };

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should only return the id + those fields', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.body).toEqual({ id: paymentPlan.id, label: paymentPlan.label });
                    });
                });
            });

            describe('and the Object was deleted', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    paymentPlan = find(paymentPlans, { status: 'deleted' });

                    options.url += '/' + paymentPlan.id;

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [404]', function() {
                    expect(apiResponse.response.statusCode).toBe(404);
                    expect(apiResponse.body).toBe('Object not found');
                });
            });

            describe('and the Object is not found', function() {
                beforeEach(function(done) {
                    options.url += '/pp-' + createUuid();

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [404]', function() {
                    expect(apiResponse.response.statusCode).toBe(404);
                    expect(apiResponse.body).toBe('Object not found');
                });
            });
        });

        describe('if unauthenticated', function() {
            var paymentPlan;

            beforeEach(function(done) {
                paymentPlan = paymentPlans[1];

                options.url += '/' + paymentPlan.id;

                requestUtils.qRequest('get', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });
    });

    describe('GET /api/payment-plans', function() {
        var paymentPlans;

        beforeEach(function(done) {
            paymentPlans = [
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: '--canceled--',
                    price: 0,
                    maxCampaigns: 0,
                    viewsPerMonth: 0
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Starter',
                    price: 49.99,
                    maxCampaigns: 1,
                    viewsPerMonth: 2000
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Pro',
                    price: 149.99,
                    maxCampaigns: 3,
                    viewsPerMonth: 7500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Business',
                    price: 499.99,
                    maxCampaigns: 10,
                    viewsPerMonth: 25500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'deleted',
                    label: 'Enterprise',
                    price: 2000,
                    maxCampaigns: 500,
                    viewsPerMonth: 1000000
                }
            ];

            testUtils.resetCollection('paymentPlans', clone(paymentPlans)).then(done, done.fail);
        });

        describe('if authenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                }).then(done, done.fail);
            });

            describe('as an app', function() {
                beforeEach(function(done) {
                    delete options.jar;

                    requestUtils.makeSignedRequest(appCreds, 'get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.response.headers['content-range']).toBe('items 1-4/4');
                    expect(apiResponse.body).toEqual(reject(paymentPlans, { status: 'deleted' }));
                });

                describe('with a bad secret', function() {
                    beforeEach(function(done) {
                        appCreds.secret = 'WRONG';

                        requestUtils.makeSignedRequest(appCreds, 'get', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            });

            describe('when requested', function() {
                beforeEach(function(done) {
                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.response.headers['content-range']).toBe('items 1-4/4');
                    expect(apiResponse.body).toEqual(reject(paymentPlans, { status: 'deleted' }));
                });

                it('should write an entry to the audit collection', function(done) {
                    testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'}).then(function(results) {
                        expect(results[0].user).toBe(user.id);
                        expect(results[0].created).toEqual(jasmine.any(Date));
                        expect(results[0].host).toEqual(jasmine.any(String));
                        expect(results[0].pid).toEqual(jasmine.any(Number));
                        expect(results[0].uuid).toEqual(jasmine.any(String));
                        expect(results[0].sessionID).toEqual(jasmine.any(String));
                        expect(results[0].service).toBe('orgSvc');
                        expect(results[0].version).toEqual(jasmine.any(String));
                        expect(results[0].data).toEqual({route: 'GET /api/payment-plans/', params: {}, query: {} });
                    }).then(done, done.fail);
                });

                describe('and fields are specified', function() {
                    beforeEach(function(done) {
                        apiResponse = null;

                        options.qs = { fields: 'label' };

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should only return the id + those fields', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.response.headers['content-range']).toBe('items 1-4/4');
                        expect(apiResponse.body).toEqual(reject(paymentPlans, { status: 'deleted' }).map(function(paymentPlan) {
                            return {
                                id: paymentPlan.id,
                                label: paymentPlan.label
                            };
                        }));
                    });
                });

                describe('and ids are specified', function() {
                    beforeEach(function(done) {
                        options.qs.ids = paymentPlans.slice(0, 2).map(function(paymentPlan) { return paymentPlan.id; }).join(',');

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should only return the objects with those ids', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.response.headers['content-range']).toBe('items 1-2/2');
                        expect(apiResponse.body).toEqual(paymentPlans.slice(0, 2));
                    });

                    describe('and nothing is found', function() {
                        beforeEach(function(done) {
                            options.qs.ids = 'pp-' + createUuid();

                            requestUtils.qRequest('get', options).then(success, failure).finally(done);
                        });

                        it('should return []', function() {
                            expect(apiResponse.response.statusCode).toBe(200);
                            expect(apiResponse.response.headers['content-range']).toBe('items 0-0/0');
                            expect(apiResponse.body).toEqual([]);
                        });
                    });
                });

                describe('if a limit is specified', function() {
                    beforeEach(function(done) {
                        options.qs.limit = 2;

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should limit the amount of results', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.response.headers['content-range']).toBe('items 1-2/4');
                        expect(apiResponse.body).toEqual(paymentPlans.slice(0, 2));
                    });
                });

                describe('if a skip is specified', function() {
                    beforeEach(function(done) {
                        options.qs.skip = 2;

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should skip results', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.response.headers['content-range']).toBe('items 3-4/4');
                        expect(apiResponse.body).toEqual(paymentPlans.slice(2, 4));
                    });
                });

                describe('if a sort is specified', function() {
                    beforeEach(function(done) {
                        options.qs.sort = 'label,1';

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should sort the results', function() {
                        expect(apiResponse.response.statusCode).toBe(200);
                        expect(apiResponse.response.headers['content-range']).toBe('items 1-4/4');
                        expect(apiResponse.body).toEqual(_(paymentPlans).reject({ status: 'deleted' }).sortBy('label').value());
                    });
                });
            });
        });

        describe('if unauthenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('get', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });
    });

    describe('POST /api/payment-plans', function() {
        var paymentPlan;

        beforeEach(function(done) {
            paymentPlan = {
                label: 'Starter',
                price: 49.99,
                maxCampaigns: 1,
                viewsPerMonth: 2000
            };

            options.json = paymentPlan;

            testUtils.resetCollection('paymentPlans', []).then(done, done.fail);
        });

        describe('if authenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                }).then(done, done.fail);
            });

            describe('as an app', function() {
                beforeEach(function(done) {
                    delete options.jar;

                    requestUtils.makeSignedRequest(appCreds, 'post', options).then(success, failure).finally(done);
                });

                it('should [201]', function() {
                    expect(apiResponse.response.statusCode).toBe(201);
                    expect(apiResponse.body).toEqual(assign({}, paymentPlan, {
                        id: jasmine.stringMatching(/^pp-/),
                        status: 'active',
                        created: jasmine.any(String),
                        lastUpdated: jasmine.any(String)
                    }));
                    expect(new Date(apiResponse.body.created).toString()).not.toBe('Invalid Date');
                    expect(new Date(apiResponse.body.lastUpdated).toString()).not.toBe('Invalid Date');
                });

                describe('with a bad secret', function() {
                    beforeEach(function(done) {
                        appCreds.secret = 'WRONG';

                        requestUtils.makeSignedRequest(appCreds, 'post', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            });

            describe('when requested', function() {
                beforeEach(function(done) {
                    requestUtils.qRequest('post', options).then(success, failure).finally(done);
                });

                it('should [201]', function() {
                    expect(apiResponse.response.statusCode).toBe(201);
                    expect(apiResponse.body).toEqual(assign({}, paymentPlan, {
                        id: jasmine.stringMatching(/^pp-/),
                        status: 'active',
                        created: jasmine.any(String),
                        lastUpdated: jasmine.any(String)
                    }));
                    expect(new Date(apiResponse.body.created).toString()).not.toBe('Invalid Date');
                    expect(new Date(apiResponse.body.lastUpdated).toString()).not.toBe('Invalid Date');
                });

                it('should be GETtable', function(done) {
                    requestUtils.qRequest('get', { url: config.paymentPlansUrl + '/' + apiResponse.body.id, jar: jar }).then(function(response) {
                        expect(response.response.statusCode).toBe(200);
                        expect(response.body).toEqual(apiResponse.body);
                    }).then(done, done.fail);
                });

                it('should write an entry to the audit collection', function(done) {
                    testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'}).then(function(results) {
                        expect(results[0].user).toBe(user.id);
                        expect(results[0].created).toEqual(jasmine.any(Date));
                        expect(results[0].host).toEqual(jasmine.any(String));
                        expect(results[0].pid).toEqual(jasmine.any(Number));
                        expect(results[0].uuid).toEqual(jasmine.any(String));
                        expect(results[0].sessionID).toEqual(jasmine.any(String));
                        expect(results[0].service).toBe('orgSvc');
                        expect(results[0].version).toEqual(jasmine.any(String));
                        expect(results[0].data).toEqual({route: 'POST /api/payment-plans/', params: {}, query: {} });
                    }).then(done, done.fail);
                });

                ['label', 'price', 'maxCampaigns', 'viewsPerMonth'].forEach(function(field) {
                    describe('without a ' + field + ' field', function() {
                        beforeEach(function(done) {
                            delete paymentPlan[field];

                            requestUtils.qRequest('post', options).then(success, failure).finally(done);
                        });

                        it('should 400', function() {
                            expect(apiResponse.response.statusCode).toBe(400);
                            expect(apiResponse.body).toBe('Missing required field: ' + field);
                        });
                    });
                });

                ['maxCampaigns', 'viewsPerMonth'].forEach(function(field) {
                    describe('with a ' + field + ' that is too low', function() {
                        beforeEach(function(done) {
                            paymentPlan[field] = -1;

                            requestUtils.qRequest('post', options).then(success, failure).finally(done);
                        });

                        it('should 400', function() {
                            expect(apiResponse.response.statusCode).toBe(400);
                            expect(apiResponse.body).toBe(field + ' must be greater than the min: 0');
                        });
                    });
                });
            });
        });

        describe('if unauthenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });
    });

    describe('PUT /api/payment-plans/:id', function() {
        var paymentPlans;

        beforeEach(function(done) {
            paymentPlans = [
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: '--canceled--',
                    price: 0,
                    maxCampaigns: 0,
                    viewsPerMonth: 0
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Starter',
                    price: 49.99,
                    maxCampaigns: 1,
                    viewsPerMonth: 2000
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Pro',
                    price: 149.99,
                    maxCampaigns: 3,
                    viewsPerMonth: 7500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Business',
                    price: 499.99,
                    maxCampaigns: 10,
                    viewsPerMonth: 25500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'deleted',
                    label: 'Enterprise',
                    price: 2000,
                    maxCampaigns: 500,
                    viewsPerMonth: 1000000
                }
            ];

            testUtils.resetCollection('paymentPlans', clone(paymentPlans)).then(done, done.fail);
        });

        describe('if authenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                }).then(done, done.fail);
            });

            describe('as an app', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    delete options.jar;

                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;
                    options.json = {
                        label: 'Beginner',
                        price: 29.99,
                        maxCampaigns: 2,
                        viewsPerMonth: 4000
                    };

                    requestUtils.makeSignedRequest(appCreds, 'put', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.body).toEqual(assign({}, paymentPlan, options.json, { lastUpdated: jasmine.any(String) }));
                    expect(new Date(apiResponse.body.lastUpdated).toString()).not.toBe('Invalid Date');
                });

                describe('with a bad secret', function() {
                    beforeEach(function(done) {
                        appCreds.secret = 'WRONG';

                        requestUtils.makeSignedRequest(appCreds, 'put', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            });

            describe('when requested', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;
                    options.json = {
                        label: 'Beginner',
                        price: 29.99,
                        maxCampaigns: 2,
                        viewsPerMonth: 4000
                    };

                    requestUtils.qRequest('put', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.body).toEqual(assign({}, paymentPlan, options.json, { lastUpdated: jasmine.any(String) }));
                    expect(new Date(apiResponse.body.lastUpdated).toString()).not.toBe('Invalid Date');
                });

                it('should write an entry to the audit collection', function(done) {
                    testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'}).then(function(results) {
                        expect(results[0].user).toBe(user.id);
                        expect(results[0].created).toEqual(jasmine.any(Date));
                        expect(results[0].host).toEqual(jasmine.any(String));
                        expect(results[0].pid).toEqual(jasmine.any(Number));
                        expect(results[0].uuid).toEqual(jasmine.any(String));
                        expect(results[0].sessionID).toEqual(jasmine.any(String));
                        expect(results[0].service).toBe('orgSvc');
                        expect(results[0].version).toEqual(jasmine.any(String));
                        expect(results[0].data).toEqual({route: 'PUT /api/payment-plans/:id', params: { id: paymentPlan.id }, query: {} });
                    }).then(done, done.fail);
                });

                ['label', 'price', 'maxCampaigns', 'viewsPerMonth'].forEach(function(field) {
                    describe('if unsetting the ' + field + ' field', function() {
                        var original;

                        beforeEach(function(done) {
                            original = options.json[field];
                            options.json[field] = null;

                            requestUtils.qRequest('put', options).then(success, failure).finally(done);
                        });

                        it('should not change the value', function() {
                            expect(apiResponse.response.statusCode).toBe(200);
                            expect(apiResponse.body[field]).toBe(original);
                        });
                    });
                });

                ['maxCampaigns', 'viewsPerMonth'].forEach(function(field) {
                    describe('with a ' + field + ' that is too low', function() {
                        beforeEach(function(done) {
                            options.json[field] = -1;

                            requestUtils.qRequest('put', options).then(success, failure).finally(done);
                        });

                        it('should 400', function() {
                            expect(apiResponse.response.statusCode).toBe(400);
                            expect(apiResponse.body).toBe(field + ' must be greater than the min: 0');
                        });
                    });
                });

                describe('if the promotion has been deleted', function() {
                    beforeEach(function(done) {
                        paymentPlan = find(paymentPlans, { status: 'deleted' });

                        options.url = config.paymentPlansUrl + '/' + paymentPlan.id;

                        requestUtils.qRequest('put', options).then(success, failure).finally(done);
                    });

                    it('should [404]', function() {
                        expect(apiResponse.response.statusCode).toBe(404);
                        expect(apiResponse.body).toBe('That has been deleted');
                    });
                });

                describe('if the promotion never existed', function() {
                    beforeEach(function(done) {
                        options.url = config.paymentPlansUrl + '/pp-' + createUuid();

                        requestUtils.qRequest('put', options).then(success, failure).finally(done);
                    });

                    it('should [404]', function() {
                        expect(apiResponse.response.statusCode).toBe(404);
                        expect(apiResponse.body).toBe('That does not exist');
                    });
                });
            });
        });

        describe('if unauthenticated', function() {
            var paymentPlan;

            beforeEach(function(done) {
                paymentPlan = paymentPlans[1];

                options.url += '/' + paymentPlan.id;

                requestUtils.qRequest('put', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });
    });

    describe('DELETE /api/payment-plans/:id', function() {
        var paymentPlans;

        beforeEach(function(done) {
            paymentPlans = [
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: '--canceled--',
                    price: 0,
                    maxCampaigns: 0,
                    viewsPerMonth: 0
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Starter',
                    price: 49.99,
                    maxCampaigns: 1,
                    viewsPerMonth: 2000
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Pro',
                    price: 149.99,
                    maxCampaigns: 3,
                    viewsPerMonth: 7500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'active',
                    label: 'Business',
                    price: 499.99,
                    maxCampaigns: 10,
                    viewsPerMonth: 25500
                },
                {
                    id: 'pp-' + createUuid(),
                    status: 'deleted',
                    label: 'Enterprise',
                    price: 2000,
                    maxCampaigns: 500,
                    viewsPerMonth: 1000000
                }
            ];

            testUtils.resetCollection('paymentPlans', clone(paymentPlans)).then(done, done.fail);
        });

        describe('if authenticated', function() {
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                }).then(done, done.fail);
            });

            describe('as an app', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    delete options.jar;

                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;

                    requestUtils.makeSignedRequest(appCreds, 'delete', options).then(success, failure).finally(done);
                });

                it('should [204]', function() {
                    expect(apiResponse.response.statusCode).toBe(204);
                    expect(apiResponse.body).toBe('');
                });

                describe('with a bad secret', function() {
                    beforeEach(function(done) {
                        appCreds.secret = 'WRONG';

                        requestUtils.makeSignedRequest(appCreds, 'delete', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            });

            describe('when requested', function() {
                var paymentPlan;

                beforeEach(function(done) {
                    paymentPlan = paymentPlans[1];

                    options.url += '/' + paymentPlan.id;

                    requestUtils.qRequest('delete', options).then(success, failure).finally(done);
                });

                it('should [204]', function() {
                    expect(apiResponse.response.statusCode).toBe(204);
                    expect(apiResponse.body).toBe('');
                });

                it('should write an entry to the audit collection', function(done) {
                    testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'}).then(function(results) {
                        expect(results[0].user).toBe(user.id);
                        expect(results[0].created).toEqual(jasmine.any(Date));
                        expect(results[0].host).toEqual(jasmine.any(String));
                        expect(results[0].pid).toEqual(jasmine.any(Number));
                        expect(results[0].uuid).toEqual(jasmine.any(String));
                        expect(results[0].sessionID).toEqual(jasmine.any(String));
                        expect(results[0].service).toBe('orgSvc');
                        expect(results[0].version).toEqual(jasmine.any(String));
                        expect(results[0].data).toEqual({route: 'DELETE /api/payment-plans/:id', params: { id: paymentPlan.id }, query: {} });
                    }).then(done, done.fail);
                });

                it('should not be GETtable', function(done) {
                    requestUtils.qRequest('get', { url: config.paymentPlansUrl + '/' + paymentPlan.id, jar: jar }).then(function(response) {
                        expect(response.response.statusCode).toBe(404);
                    }).then(done, done.fail);
                });

                describe('if the promotion has been deleted', function() {
                    beforeEach(function(done) {
                        paymentPlan = find(paymentPlans, { status: 'deleted' });

                        options.url = config.paymentPlansUrl + '/' + paymentPlan.id;

                        requestUtils.qRequest('delete', options).then(success, failure).finally(done);
                    });

                    it('should [204]', function() {
                        expect(apiResponse.response.statusCode).toBe(204);
                        expect(apiResponse.body).toBe('');
                    });
                });

                describe('if the promotion never existed', function() {
                    beforeEach(function(done) {
                        options.url = config.paymentPlansUrl + '/pp-' + createUuid();

                        requestUtils.qRequest('delete', options).then(success, failure).finally(done);
                    });

                    it('should [204]', function() {
                        expect(apiResponse.response.statusCode).toBe(204);
                        expect(apiResponse.body).toBe('');
                    });
                });

                describe('if there is an org with that paymentPlan', function() {
                    var org;

                    beforeEach(function(done) {
                        paymentPlan = paymentPlans[0];

                        org = {
                            id: 'o-' + createUuid(),
                            paymentPlanId: paymentPlan.id
                        };

                        options.url = config.paymentPlansUrl + '/' + paymentPlan.id;

                        testUtils.resetCollection('orgs', [org]).then(function() {
                            return requestUtils.qRequest('delete', options).then(success, failure);
                        }).then(done, done.fail);
                    });

                    it('should [400]', function() {
                        expect(apiResponse.response.statusCode).toBe(400);
                        expect(apiResponse.body).toBe('Payment Plan is still in use');
                    });
                });

                describe('if there is an org with that paymentPlan as its nextPaymentPlanId', function() {
                    var org;

                    beforeEach(function(done) {
                        paymentPlan = paymentPlans[0];

                        org = {
                            id: 'o-' + createUuid(),
                            nextPaymentPlanId: paymentPlan.id
                        };

                        options.url = config.paymentPlansUrl + '/' + paymentPlan.id;

                        testUtils.resetCollection('orgs', [org]).then(function() {
                            return requestUtils.qRequest('delete', options).then(success, failure);
                        }).then(done, done.fail);
                    });

                    it('should [400]', function() {
                        expect(apiResponse.response.statusCode).toBe(400);
                        expect(apiResponse.body).toBe('Payment Plan is still in use');
                    });
                });
            });
        });

        describe('if unauthenticated', function() {
            var paymentPlan;

            beforeEach(function(done) {
                paymentPlan = paymentPlans[1];

                options.url += '/' + paymentPlan.id;

                requestUtils.qRequest('delete', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });
    });
});
