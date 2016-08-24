var request = require('request');
var createUuid = require('rc-uuid').createUuid;
var q = require('q');
var testUtils = require('./testUtils');
var requestUtils = require('../../lib/requestUtils');
var clone = require('lodash').cloneDeep;
var find = require('lodash').find;
var reject = require('lodash').reject;
var assign = require('lodash').assign;
var moment = require('moment');
var _ = require('lodash');

var HOST = (process.env.host || 'localhost');
var config = {
    paymentPlansUrl: 'http://' + (HOST === 'localhost' ? HOST + ':3700' : HOST) + '/api/payment-plans',
    authUrl: 'http://' + (HOST === 'localhost' ? HOST + ':3200' : HOST) + '/api/auth',
    orgUrl: 'http://' + (HOST === 'localhost' ? HOST + ':3700' : HOST) + '/api/account/orgs'
};

describe('orgSvc payment-plans endpoints', function() {
    var jar, app, appCreds, user, policy, mockman;
    var options;
    var success, failure, apiResponse;

    beforeAll(function (done) {
        mockman = new testUtils.Mockman();
        mockman.start().then(done, done.fail);
    });

    afterAll(function() {
        mockman.stop();
    });

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

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
                paymentPlans: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                transactions: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        this.mockOrg = {
            id: 'o-' + createUuid(),
            status: 'active',
            name: 'cybOrg'
        };

        this.isCloseToNow = function(date) {
            return moment(date).diff(moment(), 'days') === 0;
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

    // Mock relevent Postgres data
    beforeEach(function(done) {
        var transCounter = 9999,
            transFields = ['rec_ts','transaction_id','transaction_ts','org_id','amount','sign',
                           'units','campaign_id','braintree_id','promotion_id','description',
                           'view_target','paymentplan_id','application',
                           'cycle_start','cycle_end'];

        function creditRecordShowcase(org, amount, braintreeId, promotion, desc,
                viewTarget,paymentPlan, app, transTs, cycleStart, cycleEnd ) {
            var recKey = transCounter++,
                id = 't-e2e-' + String(recKey);

            var s =  testUtils.stringifyRecord({
                rec_ts: transTs,
                transaction_id: id,
                transaction_ts: transTs,
                org_id: org,
                amount: amount,
                sign: 1,
                units: 1,
                campaign_id: null,
                braintree_id: braintreeId,
                promotion_id: promotion,
                description: desc,
                view_target : viewTarget,
                paymentplan_id : paymentPlan,
                application: app,
                cycle_start: cycleStart,
                cycle_end: cycleEnd
            }, transFields);
            return s;
        }

        var testTransactions = [
            creditRecordShowcase(this.mockOrg.id, 49.99, 'pay13',null,null,2000,'plan9','showcase',
                    'current_timestamp - \'30 days\'::interval',
                    'current_timestamp - \'30 days\'::interval',
                    'current_timestamp'),
            creditRecordShowcase(this.mockOrg.id, 59.99, 'pay14',null,null,3000,'plan9','showcase',
                    'current_timestamp','current_timestamp',
                    'current_timestamp + \'30 days\'::interval'),
            creditRecordShowcase(this.mockOrg.id, 59.99, 'pay14','promo1',null,400,null,'showcase',
                    'current_timestamp - \'10 days\'::interval'),
            creditRecordShowcase(this.mockOrg.id, 59.99, 'pay14','promo1',null,500,null,'showcase',
                    'current_timestamp + \'10 days\'::interval'),
            creditRecordShowcase(this.mockOrg.id, 59.99, 'pay14','promo1',null,600,null,'showcase',
                    'current_timestamp + \'15 days\'::interval'),
            creditRecordShowcase(this.mockOrg.id, 59.99, 'pay14','promo1',null,500,null,'showcase',
                    'current_timestamp + \'10 days\'::interval')
        ];

        q.all([
            testUtils.resetPGTable('fct.billing_transactions', testTransactions, null, transFields)
        ]).then(done, done.fail);
    });

    afterEach(function(done) {
        apiResponse = null;
        mockman.removeAllListeners();
        testUtils.closeDbs().then(done, done.fail);
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

    describe('GET /:id/payment-plan', function() {
        beforeEach(function() {
            this.endpoint = config.orgUrl + '/' + this.mockOrg.id + '/payment-plan';
            this.login = function () {
                return requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                });
            };
            this.mockOrg.paymentPlanId = 'pp-' + createUuid();
            this.mockOrg.nextPaymentPlanId = 'pp-' + createUuid();
        });

        it('should 401 if unauthenticated', function(done) {
            requestUtils.qRequest('get', _.assign(options, {
                url: this.endpoint
            })).then(function(response) {
                expect(response.response.statusCode).toBe(401);
                expect(response.body).toBe('Unauthorized');
            }).then(done, done.fail);
        });

        it('should 404 if no such org exists', function(done) {
            var self = this;
            this.login().then(function () {
                return requestUtils.qRequest('get', _.assign(options, {
                    url: self.endpoint
                }));
            }).then(function(response) {
                expect(response.response.statusCode).toBe(404);
                expect(response.body).toBe('Object not found');
            }).then(done, done.fail);
        });

        it('should be able to 200 with the proper response body', function(done) {
            var self = this;
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return requestUtils.qRequest('get', _.assign(options, {
                    url: self.endpoint
                }));
            }).then(function(response) {
                var date = new Date(response.body.effectiveDate);

                expect(response.response.statusCode).toBe(200);
                expect(response.body).toEqual({
                    id: self.mockOrg.id,
                    paymentPlanId: self.mockOrg.paymentPlanId,
                    nextPaymentPlanId: self.mockOrg.nextPaymentPlanId,
                    effectiveDate: jasmine.any(String)
                });
                expect(self.isCloseToNow(moment(date).subtract(30, 'days'))).toBe(true);
            }).then(done, done.fail);
        });
    });

    describe('POST /:id/payment-plan', function() {
        // Initialize payment plans
        beforeEach(function(done) {
            var self = this;

            self.paymentPlans = [
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

            testUtils.resetCollection('paymentPlans', self.paymentPlans).then(function () {
                self.paymentPlans.forEach(function (paymentPlan) {
                    delete paymentPlan._id;
                });
            }).then(done, done.fail);
        });

        beforeEach(function () {
            this.endpoint = config.orgUrl + '/' + this.mockOrg.id + '/payment-plan';
            this.login = function () {
                return requestUtils.qRequest('post', {
                    url: config.authUrl + '/login',
                    json: {
                        email: user.email,
                        password: 'password'
                    },
                    jar: jar
                });
            };
            this.mockOrg.paymentPlanId = this.paymentPlans[2].id;
            this.mockOrg.nextPaymentPlanId = null;
        });


        it('should 401 if unauthenticated', function(done) {
            requestUtils.qRequest('post', _.assign(options, {
                url: this.endpoint
            })).then(function(response) {
                expect(response.response.statusCode).toBe(401);
                expect(response.body).toBe('Unauthorized');
            }).then(done, done.fail);
        });

        it('should 400 if the payment plan id is not provided in the request body', function(done) {
            var self = this;
            this.login().then(function () {
                return requestUtils.qRequest('post', _.assign(options, {
                    url: self.endpoint
                }));
            }).then(function(response) {
                expect(response.response.statusCode).toBe(400);
                expect(response.body).toBe('Must provide the id of the payment plan');
            }).then(done, done.fail);
        });

        it('should 404 if no such org exists', function(done) {
            var self = this;
            this.login().then(function () {
                return requestUtils.qRequest('post', _.assign(options, {
                    url: self.endpoint,
                    json: {
                        id: self.mockOrg.paymentPlanId
                    }
                }));
            }).then(function(response) {
                expect(response.response.statusCode).toBe(404);
                expect(response.body).toBe('Object not found');
            }).then(done, done.fail);
        });

        it('should 400 if the given payment plan does not exist', function(done) {
            var self = this;
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return requestUtils.qRequest('post', _.assign(options, {
                    url: self.endpoint,
                    json: {
                        id: 'pp-' + createUuid()
                    }
                }));
            }).then(function(response) {
                expect(response.response.statusCode).toBe(400);
                expect(response.body).toEqual('that payment plan does not exist');
            }).then(done, done.fail);
        });

        it('should be able to 200 when setting the existing payment plan', function(done) {
            var self = this;
            mockman.on('paymentPlanChanged', done.fail);
            mockman.on('pendingPaymentPlanChanged', done.fail);
            self.mockOrg.nextPaymentPlanId = this.paymentPlans[1].id;
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return requestUtils.qRequest('post', _.assign(options, {
                    url: self.endpoint,
                    json: {
                        id: self.mockOrg.paymentPlanId
                    }
                }));
            }).then(function(response) {
                expect(response.response.statusCode).toBe(200);
                expect(response.body).toEqual({
                    id: self.mockOrg.id,
                    paymentPlanId: self.mockOrg.paymentPlanId,
                    nextPaymentPlanId: null,
                    effectiveDate: jasmine.any(String)
                });
            }).then(done, done.fail);
        });

        it('should be able to 200 when upgrading the payment plan', function(done) {
            var self = this;
            mockman.on('pendingPaymentPlanChanged', done.fail);
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return q.all([
                    requestUtils.qRequest('post', _.assign(options, {
                        url: self.endpoint,
                        json: {
                            id: self.paymentPlans[3].id
                        }
                    })),
                    q.Promise(function (resolve) {
                        mockman.on('paymentPlanChanged', function (event) {
                            resolve(event);
                        });
                    })
                ]);
            }).then(function (results) {
                var response = results[0];
                var event = results[1];

                var date = new Date(response.body.effectiveDate);
                expect(response.response.statusCode).toBe(200);
                expect(response.body).toEqual({
                    id: self.mockOrg.id,
                    paymentPlanId: self.paymentPlans[3].id,
                    nextPaymentPlanId: null,
                    effectiveDate: jasmine.any(String)
                });
                expect(self.isCloseToNow(date)).toBe(true);

                expect(event.data).toEqual({
                    date: jasmine.any(String),
                    org: {
                        id: self.mockOrg.id,
                        status: 'active',
                        name: 'cybOrg',
                        paymentPlanId: self.paymentPlans[3].id,
                        nextPaymentPlanId: null,
                        lastUpdated: jasmine.any(String)
                    },
                    previousPaymentPlanId: self.paymentPlans[2].id,
                    currentPaymentPlanId: self.paymentPlans[3].id
                });
            }).then(done).catch(function (error) {
                done.fail(util.inspect(error));
            });
        });

        it('should be able to 200 when downgrading the payment plan', function(done) {
            var self = this;
            mockman.on('paymentPlanChanged', done.fail);
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return q.all([
                    requestUtils.qRequest('post', _.assign(options, {
                        url: self.endpoint,
                        json: {
                            id: self.paymentPlans[1].id
                        }
                    })),
                    q.Promise(function (resolve) {
                        mockman.on('pendingPaymentPlanChanged', function (event) {
                            resolve(event);
                        });
                    })
                ]);
            }).then(function(results) {
                var response = results[0];
                var event = results[1];

                var date = new Date(response.body.effectiveDate);
                expect(response.response.statusCode).toBe(200);
                expect(response.body).toEqual({
                    id: self.mockOrg.id,
                    paymentPlanId: self.paymentPlans[2].id,
                    nextPaymentPlanId: self.paymentPlans[1].id,
                    effectiveDate: jasmine.any(String)
                });
                expect(self.isCloseToNow(moment(date).subtract(30, 'days'))).toBe(true);

                expect(event.data).toEqual({
                    date: jasmine.any(String),
                    org: {
                        id: self.mockOrg.id,
                        status: 'active',
                        name: 'cybOrg',
                        paymentPlanId: self.paymentPlans[2].id,
                        nextPaymentPlanId: self.paymentPlans[1].id,
                        lastUpdated: jasmine.any(String)
                    },
                    currentPaymentPlan: self.paymentPlans[2],
                    pendingPaymentPlan: self.paymentPlans[1],
                    effectiveDate: jasmine.any(String)
                });
            }).then(done, done.fail);
        });

        it('should not produce a pending payment plan changed event if the pending payment plan did not change', function (done) {
            var self = this;
            mockman.on('paymentPlanChanged', done.fail);
            mockman.on('pendingPaymentPlanChanged', done.fail);
            self.mockOrg.nextPaymentPlanId = self.paymentPlans[1].id;
            testUtils.resetCollection('orgs', [self.mockOrg]).then(function () {
                return self.login();
            }).then(function () {
                return requestUtils.qRequest('post', _.assign(options, {
                    url: self.endpoint,
                    json: {
                        id: self.paymentPlans[1].id
                    }
                }));
            }).then(function(response) {
                // Wait to check if any events have been produced
                return q.delay(5000).thenResolve(response);
            }).then(function (response) {
                expect(response.response.statusCode).toBe(200);
                expect(response.body.nextPaymentPlanId).toBe(self.paymentPlans[1].id);
            }).then(done, done.fail);
        });
    });
});
