var q               = require('q'),
    braintree       = require('braintree'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        orgSvcUrl   : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account/orgs',
        paymentUrl  : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/payments',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'rz2pht7gyn6d266b',
        privateKey  : '0a150dac004756370706a195e2bde296'
    });

describe('orgSvc payments (E2E):', function() {
    var cookieJar, readOnlyJar, mockRequester, readOnlyUser, testPolicies, mockCust, mockOrgs, origCard, origPaypal;
    
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        if (cookieJar && cookieJar.cookies && readOnlyJar && readOnlyJar.cookies) {
            return done();
        }

        cookieJar = request.jar();
        readOnlyJar = request.jar();
        mockRequester = {
            id: 'u-e2e-payments',
            status: 'active',
            email: 'requester@c6.com',
            firstName: 'E2E',
            lastName: 'Tests',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-braintree1',
            policies: ['manageAllOrgs']
        };
        readOnlyUser = {
            id: 'u-e2e-readonly',
            status: 'active',
            email : 'read-only@c6.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-otherorg',
            policies: ['readOwnOrg']
        };
        testPolicies = [
            {
                id: 'p-e2e-writeOrg',
                name: 'manageAllOrgs',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-readOrg',
                name: 'readOwnOrg',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'own' }
                }
            }
        ];
        var logins = [
            {url: config.authUrl + '/login', json: {email: 'requester@c6.com', password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: 'read-only@c6.com', password: 'password'}, jar: readOnlyJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockRequester, readOnlyUser]),
            testUtils.resetCollection('policies', testPolicies)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            results.forEach(function(resp) {
                if (resp.response.statusCode !== 200) {
                    throw new Error('Failed login: ' + resp.response.statusCode + ', ' + util.inspect(resp.body));
                }
            });
            done();
        });
    });
    
    beforeEach(function(done) {
        if (mockCust && mockCust.id) {
            return done();
        }
        
        var custCfg = {
            company: 'e2eTests',
            paymentMethodNonce: 'fake-paypal-future-nonce'
        };
    
        q.npost(gateway.customer, 'create', [custCfg]).then(function(result) {
            if (!result.success) {
                return q.reject(result);
            }
            mockCust = result.customer;
            origPaypal = result.customer.paymentMethods[0];
            
            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: mockCust.id,
                paymentMethodNonce: 'fake-valid-visa-nonce',
                cardholderName: 'Johnny Testmonkey'
            }]);
        }).then(function(result) {
            if (!result.success) {
                return q.reject(result);
            }
            
            origCard = result.paymentMethod;
            
            mockOrgs = [
                {
                    id: 'o-braintree1',
                    status: 'active',
                    name: 'org w/ cust',
                    braintreeCustomer: mockCust.id
                },
                {
                    id: 'o-otherorg',
                    status: 'active',
                    name: 'org w/o cust',
                }
            ];
            
            return testUtils.resetCollection('orgs', mockOrgs);
        }).done(done);
    });
    
    describe('GET /api/payments/clientToken', function() {
        var options;
        beforeEach(function() {
            options = { url: config.paymentUrl + '/clientToken', jar: cookieJar };
        });

        it('should get a client token customized for the org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    clientToken: jasmine.any(String)
                });
                expect(resp.body.clientToken.length).toBeGreaterThan(1);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still get a client token if the org has no braintreeCustomer', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    clientToken: jasmine.any(String)
                });
                expect(resp.body.clientToken.length).toBeGreaterThan(1);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/payments/', function() {
        var paymentsCreated = false,
            options;
        beforeEach(function(done) {
            options = {
                url: config.paymentUrl + '/',
                jar: cookieJar
            };
        
            if (paymentsCreated) {
                return done();
            }

            q.all([
                {
                    amount: '10.00',
                    paymentMethodToken: origCard.token,
                    customFields: {
                        campaign: 'cam-1'
                    }
                },
                {
                    amount: '20.00',
                    paymentMethodToken: origCard.token,
                    customFields: {
                        campaign: 'cam-2'
                    },
                    options: {
                        submitForSettlement: true
                    }
                },
                {
                    amount: '30.00',
                    paymentMethodToken: origPaypal.token,
                    customFields: {
                        campaign: 'cam-3'
                    }
                }
            ].map(function(cfg) {
                return q.npost(gateway.transaction, 'sale', [cfg]).then(function(result) {
                    if (!result.success) {
                        return q.reject(result);
                    }
                });
            })).then(function() {
                paymentsCreated = true;
                
                testUtils.resetCollection('campaigns', [
                    { id: 'cam-1', status: 'active', name: 'campaign 1' },
                    { id: 'cam-3', status: 'expired', name: 'campaign 3' },
                ]);
            }).done(done);
        });
            
        it('should get all payments for an org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return parseInt(a.amount) - parseInt(b.amount); });

                var expectedCard = {
                    token: origCard.token,
                    imageUrl: origCard.imageUrl,
                    type: 'creditCard',
                    cardType: 'Visa',
                    cardholderName: 'Johnny Testmonkey',
                    expirationDate: '12/2020',
                    last4: '1881'
                };
                var expectedPaypal = {
                    token: origPaypal.token,
                    imageUrl: origPaypal.imageUrl,
                    type: 'paypal',
                    email: jasmine.any(String),
                };
                expect(resp.body).toEqual([
                    {
                        id: jasmine.any(String),
                        status: 'authorized',
                        type: 'sale',
                        amount: '10.00',
                        createdAt: jasmine.any(String),
                        updatedAt: jasmine.any(String),
                        method: expectedCard,
                        campaignId: 'cam-1',
                        campaignName: 'campaign 1'
                    },
                    {
                        id: jasmine.any(String),
                        status: 'submitted_for_settlement',
                        type: 'sale',
                        amount: '20.00',
                        createdAt: jasmine.any(String),
                        updatedAt: jasmine.any(String),
                        method: expectedCard,
                        campaignId: 'cam-2'
                    },
                    {
                        id: jasmine.any(String),
                        status: 'authorized',
                        type: 'sale',
                        amount: '30.00',
                        createdAt: jasmine.any(String),
                        updatedAt: jasmine.any(String),
                        method: expectedPaypal,
                        campaignId: 'cam-3',
                        campaignName: 'campaign 3'
                    }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return 200 and [] for an org with no braintreeCustomer', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user who can read all orgs to fetch other orgs\' payment methods', function(done) {
            options.qs = { org: 'o-otherorg' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent users from fetching payment methods for orgs they cannot see', function(done) {
            options.jar = readOnlyJar;
            options.qs = { org: 'o-braintree1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/payments/methods', function() {
        var options;
        beforeEach(function() {
            options = { url: config.paymentUrl + '/methods', jar: cookieJar };
        });
        
        it('should return all of the org\'s payment methods', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                resp.body.sort(function(a, b) { return a.type.localeCompare(b.type); });
                expect(resp.body).toEqual([
                    {
                        token: origCard.token,
                        createdAt: origCard.createdAt,
                        updatedAt: jasmine.any(String),
                        imageUrl: origCard.imageUrl,
                        default: false,
                        type: 'creditCard',
                        cardType: 'Visa',
                        cardholderName: 'Johnny Testmonkey',
                        expirationDate: '12/2020',
                        last4: '1881'
                    },
                    {
                        token: origPaypal.token,
                        createdAt: origPaypal.createdAt,
                        updatedAt: jasmine.any(String),
                        imageUrl: origPaypal.imageUrl,
                        default: true,
                        type: 'paypal',
                        email: 'jane.doe@example.com',
                    }
                ]);
                resp.body.forEach(function(method) {
                    expect(new Date(method.createdAt).toString()).not.toEqual('Invalid Date');
                    expect(new Date(method.updatedAt).toString()).not.toEqual('Invalid Date');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return 200 and [] for an org with no braintreeCustomer', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user who can read all orgs to fetch other orgs\' payment methods', function(done) {
            options.qs = { org: 'o-otherorg' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent users from fetching payment methods for orgs they cannot see', function(done) {
            options.jar = readOnlyJar;
            options.qs = { org: 'o-braintree1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/payments/methods', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.paymentUrl + '/methods',
                json: {
                    cardholderName: 'Jenny Testmonkey',
                    paymentMethodNonce: 'fake-valid-amex-nonce'
                },
                jar: cookieJar
            };
        });
        
        it('should be able to create a new payment method', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    token: jasmine.any(String),
                    createdAt: jasmine.any(String),
                    updatedAt: jasmine.any(String),
                    imageUrl: jasmine.any(String),
                    default: false,
                    type: 'creditCard',
                    cardType: 'American Express',
                    cardholderName: 'Jenny Testmonkey',
                    expirationDate: '12/2020',
                    last4: '0005'
                });
                expect(new Date(resp.body.createdAt).toString()).not.toEqual('Invalid Date');
                expect(new Date(resp.body.updatedAt).toString()).not.toEqual('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to set a new payment method as the default', function(done) {
            options.json.paymentMethodNonce = 'fake-valid-mastercard-nonce';
            options.json.makeDefault = true;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.default).toBe(true);
                expect(resp.body.cardType).toBe('MasterCard');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a new customer for an org with no braintreeCustomer', function(done) {
            var custId, token;
            mockRequester.org = 'o-otherorg';
            testUtils.resetCollection('users', [mockRequester, readOnlyUser]).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.default).toBe(true);
                expect(resp.body.cardType).toBe('American Express');
                token = resp.body.token;

                // check that braintreeCustomer set on the org
                return requestUtils.qRequest('get', {
                    url: config.orgSvcUrl + '/o-otherorg',
                    jar: cookieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.braintreeCustomer).toEqual(jasmine.any(String));
                custId = resp.body.braintreeCustomer;
                
                return q.npost(gateway.customer, 'find', [custId]);
            }).then(function(cust) {
                expect(cust.id).toBe(custId);
                expect(cust.firstName).toBe('E2E');
                expect(cust.lastName).toBe('Tests');
                expect(cust.email).toBe('requester@c6.com');
                expect(cust.company).toBe('org w/o cust');
                expect(cust.paymentMethods.length).toBe(1);
                expect(cust.paymentMethods[0].token).toBe(token);
                
                // cleanup: delete this new braintree customer
                return q.npost(gateway.customer, 'delete', [custId]);
            }).then(function() {
                // reset users and orgs
                mockRequester.org = 'o-braintree1';
                delete mockOrgs[1].braintreeCustomer;
                
                return q.all([
                    testUtils.resetCollection('orgs', mockOrgs),
                    testUtils.resetCollection('users', [mockRequester, readOnlyUser])
                ]).thenResolve();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the body has no paymentMethodNonce', function(done) {
            delete options.json.paymentMethodNonce;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must include a paymentMethodNonce');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the paymentMethodNonce is invalid', function(done) {
            options.json.paymentMethodNonce = 'evanjustmadethisnonceup';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the paymentMethodNonce has already been consumed', function(done) {
            options.json.paymentMethodNonce = 'fake-consumed-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the processor declines the card', function(done) {
            options.json.paymentMethodNonce = 'fake-processor-declined-visa-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Processor declined payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the gateway rejects the nonce', function(done) {
            options.json.paymentMethodNonce = 'fake-luhn-invalid-nonce';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/payments/methods/:token', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.paymentUrl + '/methods/' + origCard.token,
                json: {
                    paymentMethodNonce: 'fake-valid-discover-nonce',
                    cardholderName: 'Johnny Testmonkey Jr.'
                },
                jar: cookieJar
            };
        });
        
        it('should be able to edit a card with new details', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    token: origCard.token,
                    createdAt: origCard.createdAt,
                    updatedAt: jasmine.any(String),
                    imageUrl: jasmine.any(String),
                    default: false,
                    type: 'creditCard',
                    cardType: 'Discover',
                    cardholderName: 'Johnny Testmonkey Jr.',
                    expirationDate: '12/2020',
                    last4: '1117'
                });
                expect(new Date(resp.body.updatedAt)).toBeGreaterThan(new Date(origCard.updatedAt));
                expect(resp.body.imageUrl).not.toEqual(origCard.imageUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to switch which method is the default', function(done) {
            options.json = { makeDefault: true };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.token).toEqual(origCard.token);
                expect(resp.body.cardholderName).toBe('Johnny Testmonkey Jr.');
                expect(resp.body.default).toBe(true);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the body has no paymentMethodNonce', function(done) {
            delete options.json.paymentMethodNonce;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must include a paymentMethodNonce');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the paymentMethodNonce is invalid', function(done) {
            options.json.paymentMethodNonce = 'evanjustmadethisnonceup';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the paymentMethodNonce has already been consumed', function(done) {
            options.json.paymentMethodNonce = 'fake-consumed-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the processor declines the card', function(done) {
            options.json.paymentMethodNonce = 'fake-processor-declined-visa-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Processor declined payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the gateway rejects the nonce', function(done) {
            options.json.paymentMethodNonce = 'fake-luhn-invalid-nonce';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid payment method');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the payment method does not exist', function(done) {
            options.url = config.paymentUrl + '/method/evanmadeupthistoken';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That payment method does not exist for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org has no braintreeCustomer', function(done) {
            mockRequester.org = 'o-otherorg';
            testUtils.resetCollection('users', [mockRequester, readOnlyUser]).then(function() {
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No payment methods for this org');
                
                // reset users
                mockRequester.org = 'o-braintree1';
                return testUtils.resetCollection('users', [mockRequester, readOnlyUser]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/payments/methods/:token', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.paymentUrl + '/methods/' + origCard.token,
                jar: cookieJar
            };
        
            var mockCamps = [
                { id: 'cam-1', status: 'active', paymentMethod: origPaypal.token },
                { id: 'cam-2', status: 'canceled', paymentMethod: origCard.token },
                { id: 'cam-3', status: 'expired', paymentMethod: origCard.token },
                { id: 'cam-4', status: 'deleted', paymentMethod: origCard.token },
            ];

            return testUtils.resetCollection('campaigns', mockCamps).done(done);
        });
        
        it('should be able to delete a payment method', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                return q.npost(gateway.paymentMethod, 'find', [origCard.token])
                .then(function(method) {
                    expect(method).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.name).toBe('notFoundError');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the method has already been deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the method is still in use by running campaigns', function(done) {
            options.url = config.paymentUrl + '/methods/' + origPaypal.token;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Payment method still in use by campaigns');
                
                return q.npost(gateway.paymentMethod, 'find', [origPaypal.token]);
            }).then(function(method) {
                expect(method.token).toEqual(origPaypal.token);
                expect(method.email).toBe('jane.doe@example.com');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the payment method does not exist', function(done) {
            options.url = config.paymentUrl + '/method/evanmadeupthistoken';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org has no braintreeCustomer', function(done) {
            mockRequester.org = 'o-otherorg';
            testUtils.resetCollection('users', [mockRequester, readOnlyUser]).then(function() {
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No payment methods for this org');
                
                // reset users
                mockRequester.org = 'o-braintree1';
                return testUtils.resetCollection('delete', [mockRequester, readOnlyUser]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 403 if the user cannot edit their org', function(done) {
            options.jar = readOnlyJar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    
    describe('customer cleanup', function() {
        it('should delete the mock braintree customer', function(done) {
            q.npost(gateway.customer, 'delete', [mockCust.id]).done(function() {
                done();
            });
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
