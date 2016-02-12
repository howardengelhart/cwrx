var q               = require('q'),
    braintree       = require('braintree'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api/content',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'rz2pht7gyn6d266b',
        privateKey  : '0a150dac004756370706a195e2bde296'
    });

jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

describe('ads campaignUpdates endpoints (E2E):', function() {
    var selfieJar, adminJar, testPolicies, createdCamp, createdCampDecorated,
        mailman, selfieCredit, selfiePaypal, adminCredit, mockOrgs;

    beforeAll(function(done) {

        if (selfieJar && adminJar) {
            return done();
        }
        selfieJar = request.jar();
        var selfieUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'c6e2etester@gmail.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            company: 'Heinz',
            policies: ['selfieCampPolicy']
        };
        adminJar = request.jar();
        var adminUser = {
            id: 'admin-e2e-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['adminCampPolicy']
        };

        testPolicies = [
            {
                id: 'p-e2e-selfie',
                name: 'selfieCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'own', edit: 'own' },
                    cards: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' },
                    campaignUpdates: { read: 'org', create: 'org', edit: 'org' }
                },
                fieldValidation: {
                    campaigns: {
                        application: {
                            __allowed: false,
                            __default: 'selfie'
                        }
                    }
                }
            },
            {
                id: 'p-e2e-admin',
                name: 'adminCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all', edit: 'all', delete: 'all' },
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    experiences: { read: 'all', delete: 'all' },
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    campaignUpdates: { read: 'all', create: 'all', edit: 'all' }
                },
                fieldValidation: {
                    campaigns: {
                        status: { __allowed: true },
                        advertiserId : { __allowed: true },
                        pricing: {
                            model: { __allowed: true },
                            cost: { __allowed: true }
                        },
                        staticCardMap: { __allowed: true },
                        cards: {
                            __unchangeable: false,
                            __length: 10,
                        },
                        miniReels: { __allowed: true }
                    },
                    campaignUpdates: {
                        status: { __allowed: true },
                        rejectionReason: { __allowed: true }
                    }
                },
                entitlements: {
                    directEditCampaigns: true,
                    autoApproveUpdates: true
                }
            },
        ];
        
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: selfieJar,
            json: {
                email: selfieUser.email,
                password: 'password'
            }
        };
        var adminLoginOpts = {
            url: config.authUrl + '/login',
            jar: adminJar,
            json: {
                email: adminUser.email,
                password: 'password'
            }
        };
        q.all([
            testUtils.resetCollection('users', [selfieUser, adminUser]),
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
    
    // Initialize orgs with Braintree customers + payment methods
    beforeAll(function(done) {
        mockOrgs = [
            { id: 'o-selfie', name: 'test selfie org', status: 'active' },
            { id: 'o-admin', name: 'test admin org', status: 'active' }
        ];
        
        q.all([
            q.npost(gateway.customer, 'create', [{ company: mockOrgs[0].name, paymentMethodNonce: 'fake-valid-visa-nonce' }]),
            q.npost(gateway.customer, 'create', [{ company: mockOrgs[1].name, paymentMethodNonce: 'fake-valid-amex-nonce' }])
        ]).spread(function(selfieResp, adminResp) {
            if (!selfieResp.success) return q.reject(selfieResp);
            if (!adminResp.success) return q.reject(adminResp);

            mockOrgs[0].braintreeCustomer = selfieResp.customer.id;
            mockOrgs[1].braintreeCustomer = adminResp.customer.id;
            selfieCredit = selfieResp.customer.paymentMethods[0];
            adminCredit = adminResp.customer.paymentMethods[0];
            
            return testUtils.resetCollection('orgs', mockOrgs);
        }).then(function() {
            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: mockOrgs[0].braintreeCustomer,
                paymentMethodNonce: 'fake-paypal-future-nonce'
            }]);
        }).then(function(resp) {
            if (!resp.success) return q.reject(resp);
            selfiePaypal = resp.paymentMethod;
        
        }).done(done, done.fail);
    });
    
    // Setup a card to test with
    beforeAll(function(done) {
        requestUtils.qRequest('post', {
            url: config.adsUrl + '/campaigns/',
            jar: selfieJar,
            json: {
                name: 'camp with card',
                advertiserId: 'e2e-a-keepme',
                targeting: { interests: ['cat-1'] },
                cards: [{
                    title: 'my test card'
                }]
            }
        }).then(function(resp) {
            if (resp.response.statusCode !== 201) {
                done.fail(util.inspect({ code: resp.response.statusCode, body: resp.body }));
            }
            createdCampDecorated = resp.body;
            
            return testUtils.mongoFind('campaigns', { id: createdCampDecorated.id });
        }).then(function(results) {
            // As long as createdCamp is used in resetCollection, changes to this campaign will not persist
            createdCamp = results[0];
        }).done(done, done.fail);
    });
    
    // Setup mailman for receiving email messages
    beforeEach(function(done) {
        if (mailman && mailman.state === 'authenticated') {
            mailman.on('error', function(error) { throw new Error(error); });
            return done();
        }
        
        mailman = new testUtils.Mailman();
        return mailman.start().then(function() {
            mailman.on('error', function(error) { throw new Error(error); });
        }).done(done);
    });

    afterEach(function() {
        mailman.removeAllListeners();
    });
    
    
    // Performs some checks on a "New update request" email sent to support
    function testNewUpdateMsg(msg, camp) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        [
            new RegExp('created\\s*by\\s*c6e2etester@gmail.com\\s*for\\s*campaign.*' + camp.name),
            new RegExp('review\\s*the\\s*campaign.*\\s*http.*' + camp.id + '\/admin')
        ].forEach(function(regex) {
            expect(msg.text).toMatch(regex);
            expect(msg.html).toMatch(regex);
        });
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }

    function testApprovalMsg(msg, camp, isInitial) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        
        var regex = new RegExp('Your\\s*' + (!isInitial ? 'change\\s*request\\s*to\\s*' : '') +
                               'campaign.*' + camp.name + '.*has\\s*been\\s*approved');
        expect(msg.text).toMatch(regex);
        expect(msg.html).toMatch(regex);
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }
    
    function testRejectMsg(msg, camp, reason, isInitial) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        [
            new RegExp('Your\\s*' + (!isInitial ? 'change\\s*request\\s*to\\s*' : '') +
                       'campaign.*' + camp.name + '.*has\\s*been\\s*rejected'),
            new RegExp(reason)
        ].forEach(function(regex) {
            expect(msg.text).toMatch(regex);
            expect(msg.html).toMatch(regex);
        });
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }


    describe('GET /api/campaigns/:campId/updates/:id', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-getId1/updates/ur-getId1',
                qs: {},
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getId2', campaign: 'cam-getId1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });
        
        it('should get a campaign update by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending',
                    user: 'e2e-user', org: 'o-selfie', data: {} });
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/:campId/updates?/:id',
                                                 params: { campId: 'cam-getId1', id: 'ur-getId1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,campaign';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show updates a user cannot see', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getId1/updates/ur-getId2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
                options.jar = adminJar;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId2', campaign: 'cam-getId1', status: 'pending',
                    user: 'not-e2e-user', org: 'o-admin', data: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the update is not for the given campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getId2/updates/ur-getId1';
            options.jar = adminJar;
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
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/campaigns/:campId/updates/', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-getQry1/updates/',
                qs: { sort: 'id,1' },
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getQry1', campaign: 'cam-getQry1', status: 'pending', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry2', campaign: 'cam-getQry1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} },
                { id: 'ur-getQry3', campaign: 'cam-getQry1', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry4', campaign: 'cam-getQry1', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry5', campaign: 'cam-getQry1', status: 'rejected', user: 'e2e-user', org: 'o-selfie', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });

        it('should get all updates a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.body[2].id).toBe('ur-getQry4');
                expect(resp.body[3].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/:campId/updates?/',
                                                 params: { campId: 'cam-getQry1' }, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,user';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual({ id: 'ur-getQry1', status: 'pending', user: 'e2e-user' });
                expect(resp.body[1]).toEqual({ id: 'ur-getQry3', status: 'approved', user: 'e2e-user' });
                expect(resp.body[2]).toEqual({ id: 'ur-getQry4', status: 'approved', user: 'e2e-user' });
                expect(resp.body[3]).toEqual({ id: 'ur-getQry5', status: 'rejected', user: 'e2e-user' });
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of statuses', function(done) {
            options.qs.statuses = 'pending,rejected';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of ids', function(done) {
            options.qs.ids = 'ur-getQry1,ur-getQry4';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        ['ids', 'statuses'].forEach(function(param) {
            it('should get no campaigns if the ' + param + ' param is empty', function(done) {
                options.qs[param] = '';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.ids = 'ur-getFake';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if there are no updates for the campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getQry2/updates/';
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
            options.qs.sort = 'status,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry5');
                expect(resp.body[1].id).toBe('ur-getQry1');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry3');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/campaigns/updates/', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/updates/',
                qs: { sort: 'id,1' },
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getQry1', campaign: 'cam-getQry1', status: 'pending', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry2', campaign: 'cam-getQry1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} },
                { id: 'ur-getQry3', campaign: 'cam-getQry2', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry4', campaign: 'cam-getQry2', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry5', campaign: 'cam-getQry3', status: 'rejected', user: 'e2e-user', org: 'o-selfie', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });

        it('should get all updates a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.body[2].id).toBe('ur-getQry4');
                expect(resp.body[3].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/updates?/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,user';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual({ id: 'ur-getQry1', status: 'pending', user: 'e2e-user' });
                expect(resp.body[1]).toEqual({ id: 'ur-getQry3', status: 'approved', user: 'e2e-user' });
                expect(resp.body[2]).toEqual({ id: 'ur-getQry4', status: 'approved', user: 'e2e-user' });
                expect(resp.body[3]).toEqual({ id: 'ur-getQry5', status: 'rejected', user: 'e2e-user' });
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of statuses', function(done) {
            options.qs.statuses = 'pending,rejected';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of ids', function(done) {
            options.qs.ids = 'ur-getQry1,ur-getQry4';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get updates by list of campaign ids', function(done) {
            options.qs.campaigns = 'cam-getQry1,cam-getQry3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        ['ids', 'statuses', 'campaigns'].forEach(function(param) {
            it('should get no updates if the ' + param + ' param is empty', function(done) {
                options.qs[param] = '';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.ids = 'ur-getFake';
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
            options.qs.sort = 'status,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry5');
                expect(resp.body[1].id).toBe('ur-getQry1');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry3');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/campaigns/:campId/updates', function() {
        var options, mockCamps, msgSubject;
        beforeEach(function(done) {
            msgSubject = 'New update request from Heinz for campaign "e2e test 1"';
            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/',
                json: { data: {
                    name: 'updated name',
                    pricing: { budget: 500 },
                    targeting: {
                        geo: { dmas: ['princeton'] },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    }
                } },
                jar: selfieJar
            };
            mockCamps = [
                {
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'draft',
                    application: 'selfie',
                    paymentMethod: selfieCredit.token,
                    pricing: { budget: 1000, dailyLimit: 200, cost: 0.07, model: 'cpv' },
                    targeting: {
                        geo: { states: ['new jersey' ] },
                        interests: ['cat-1', 'cat-2']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                },
                { id: 'cam-active', advertiserId: 'e2e-a-keepme', status: 'active', user: 'e2e-user', org: 'o-selfie' },
                { id: 'cam-other', status: 'draft', user: 'not-e2e-user', org: 'o-admin' },
                { id: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie' },
                createdCamp
            ];
            q.all([
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.resetCollection('campaignUpdates'),
            ]).done(function() { done(); });
        });
        
        it('should create an update and email support', function(done) {
            var createdUpdate;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.autoApproved).toBe(false);
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    name: 'updated name',
                    application: 'selfie',
                    status: 'draft',
                    paymentMethod: selfieCredit.token,
                    pricing: { budget: 500, dailyLimit: 200, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['princeton']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
                createdUpdate = resp.body;
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mailman.once(msgSubject, function(msg) {
                testNewUpdateMsg(msg, mockCamps[0]);
                
                // test that updateRequest is set successfully on campaign
                requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).toBe(createdUpdate.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should fail if changing the paymentMethod and it is invalid or owned by another org', function(done) {
            q.all(['someFakeToken', adminCredit.token].map(function(token) {
                options.json.data.paymentMethod = token;
                return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('paymentMethod someFakeToken does not exist for o-selfie');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('paymentMethod ' + adminCredit.token + ' does not exist for o-selfie');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if only changing the paymentMethod', function(done) {
            beforeEach(function() {
                options.json.data = { paymentMethod: selfiePaypal.token };
            });

            it('should immediately apply', function(done) {
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe('cam-1');
                    expect(resp.body.autoApproved).toBe(true);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual({
                        paymentMethod: selfiePaypal.token,
                    });
                
                    // test campaign updated successfully
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.paymentMethod).toBe(selfiePaypal.token);
                    expect(resp.body.targeting).toEqual(mockCamps[0].targeting);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should still succeed if the campaign is active', function(done) {
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                options.url = config.adsUrl + '/campaigns/cam-active/updates/';
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe('cam-active');
                    expect(resp.body.autoApproved).toBe(true);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual({
                        paymentMethod: selfiePaypal.token,
                    });
                
                    // test campaign updated successfully
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-active',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('active');
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.paymentMethod).toBe(selfiePaypal.token);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should fail if the paymentMethod is invalid or owned by another org', function(done) {
                q.all(['someFakeToken', adminCredit.token].map(function(token) {
                    options.json.data.paymentMethod = token;
                    return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('paymentMethod someFakeToken does not exist for o-selfie');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('paymentMethod ' + adminCredit.token + ' does not exist for o-selfie');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should immediately apply if the requester has the autoApproveUpdates entitlement', function(done) {
            options.jar = adminJar;
            options.json.data = { name: 'auto-approved yo' };
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('approved');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.autoApproved).toBe(true);
                expect(resp.body.user).toBe('admin-e2e-user');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.data.name).toEqual('auto-approved yo');
            
                // test campaign updated successfully
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).not.toBeDefined();
                expect(resp.body.name).toEqual('auto-approved yo');
                expect(resp.body.targeting).toEqual(mockCamps[0].targeting);
                expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('if sending an initial submit request', function(done) {
            beforeEach(function() {
                options.json.data = { status: 'active' };
            });

            it('should set the status of the campaign to pending', function(done) {
                var createdUpdate;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe('cam-1');
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.data.status).toBe('active');
                    createdUpdate = resp.body;
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    testNewUpdateMsg(msg, mockCamps[0]);
                    
                    // test campaign updated successfully
                    requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.status).toBe('pending');
                        expect(resp.body.updateRequest).toBe(createdUpdate.id);
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            describe('and no paymentMethod is set yet', function() {
                beforeEach(function(done) {
                    delete mockCamps[0].paymentMethod;
                    testUtils.resetCollection('campaigns', mockCamps).done(done);
                });
                
                it('should return a 400 if the user does not have the paymentOptional entitlement', function(done) {
                    mailman.once(msgSubject, function(msg) {
                        expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                    });
                    
                    requestUtils.qRequest('post', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe('Missing required field: paymentMethod');
                        
                        // test campaign not locked
                        return requestUtils.qRequest('get', {
                            url: config.adsUrl + '/campaigns/cam-1',
                            jar: selfieJar
                        });
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.status).toBe('draft');
                        expect(resp.body.updateRequest).not.toBeDefined();
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
                
                it('should succeed if the user has the paymentOptional entitlement', function(done) {
                    testPolicies[0].entitlements = testPolicies[0].entitlements || {};
                    testPolicies[0].entitlements.paymentOptional = true;
                    testUtils.resetCollection('policies', testPolicies).then(function() {
                        var deferred = q.defer();
                        
                        var createdUpdate;
                        requestUtils.qRequest('post', options).then(function(resp) {
                            expect(resp.response.statusCode).toBe(201);
                            if (resp.response.statusCode !== 201) {
                                return q.reject({ code: resp.response.statusCode, body: resp.body });
                            }
                            
                            expect(resp.body.id).toEqual(jasmine.any(String));
                            expect(resp.body.status).toBe('pending');
                            expect(resp.body.campaign).toBe('cam-1');
                            expect(resp.body.autoApproved).toBe(false);
                            expect(resp.body.data.status).toBe('active');
                            expect(resp.body.data.paymentMethod).not.toBeDefined();
                            createdUpdate = resp.body;
                        }).catch(function(error) {
                            expect(util.inspect(error)).not.toBeDefined();
                            deferred.resolve();
                        });
                        
                        mailman.once(msgSubject, function(msg) {
                            testNewUpdateMsg(msg, mockCamps[0]);
                            
                            // test campaign updated successfully
                            requestUtils.qRequest('get', {
                                url: config.adsUrl + '/campaigns/cam-1',
                                jar: selfieJar
                            }).then(function(resp) {
                                expect(resp.response.statusCode).toBe(200);
                                expect(resp.body.status).toBe('pending');
                                expect(resp.body.updateRequest).toBe(createdUpdate.id);
                                expect(resp.body.paymentMethod).not.toBeDefined();
                            }).catch(function(error) {
                                expect(util.inspect(error)).not.toBeDefined();
                            }).done(deferred.resolve);
                        });
                        
                        return deferred.promise;
                    })
                    .then(function() {
                        delete testPolicies[0].entitlements.paymentOptional;
                        return testUtils.resetCollection('policies', testPolicies);
                    })
                    .done(done);
                });
            });
        });
        
        describe('if creating an update for a campaign with cards', function() {
            beforeEach(function() {
                options = {
                    url: config.adsUrl + '/campaigns/' + createdCampDecorated.id + '/updates/',
                    json: { data: {
                        name: 'updated name',
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            title: 'Brand New Title!'
                        }]
                    } },
                    jar: selfieJar
                };
                msgSubject = 'New update request from Heinz for campaign "' + createdCamp.name + '"';
            });
            
            it('should allow editing card attributes', function(done) {
                var createdUpdate;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe(createdCamp.id);
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual(jasmine.objectContaining({
                        id: createdCamp.id,
                        name: 'updated name',
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            campaignId: createdCampDecorated.id,
                            title: 'Brand New Title!'
                        }]
                    }));
                    createdUpdate = resp.body;
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    testNewUpdateMsg(msg, createdCampDecorated);
                    
                    // test that updateRequest is set successfully on campaign
                    requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCamp.id,
                        jar: selfieJar
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.status).toBe('draft');
                        expect(resp.body.updateRequest).toBe(createdUpdate.id);
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            it('should trim forbidden card fields', function(done) {
                options.json.data.cards[0].data = {
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true
                };
                options.json.data.cards[0].campaign = {
                    minViewTime: 55,
                    reportingId: createdCampDecorated.cards[0].campaign.reportingId
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe(createdCamp.id);
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual(jasmine.objectContaining({
                        id: createdCampDecorated.id,
                        name: 'updated name',
                        cards: [ jasmine.objectContaining({
                            id: createdCampDecorated.cards[0].id,
                            campaignId: createdCampDecorated.id,
                            title: 'Brand New Title!',
                            campaign: createdCampDecorated.cards[0].campaign,
                            data: createdCampDecorated.cards[0].data
                        }) ]
                    }));
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    done();
                });
            });

            it('should prevent selfie users from adding a second card', function(done) {
                options.json.data = { cards: [{ id: createdCampDecorated.cards[0].id }, { title: 'my new card' }] };
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('cards must have at most 1 entries');
                    
                    // test campaign not locked
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return a 400 for invalid pricing opts', function(done) {
            options.json.data = { pricing: { budget: 999999999999999999999999999999 } };
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toMatch(/pricing.budget must be less than the max: \d+/);
                
                // test campaign not locked
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields from the data', function(done) {
            var createdUpdate;
            options.json.data = {
                name: 'updated name',
                miniReels: [{ id: 'e-1' }],
                staticCardMap: { foo: 'bar' },
                rejectionReason: 'i am a bad selfie user',
            };
            
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('pending');
                expect(resp.body.data.name).toBe('updated name');
                expect(resp.body.data.miniReels).not.toBeDefined();
                expect(resp.body.data.staticCardMap).not.toBeDefined();
                expect(resp.body.data.rejectionReason).not.toBeDefined();
                createdUpdate = resp.body;
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mailman.once(msgSubject, function(msg) {
                testNewUpdateMsg(msg, mockCamps[0]);
                
                // test that updateRequest is set successfully on campaign
                requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).toBe(createdUpdate.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should prevent creating updates for a campaign the user cannot see', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-other/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent creating updates for a deleted campaign', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-deleted/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent creating updates for a nonexistent campaign', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-fake/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/campaigns/:campId/updates/:id', function() {
        var options, mockCamps, mockUpdates, approveSubject, rejectSubject;
        beforeEach(function(done) {
            approveSubject = 'Your Campaign Change Request Has Been Approved';
            rejectSubject = 'Your Campaign Change Request Has Been Rejected';
            mockUpdates = [
                {
                    id: 'ur-1', 
                    campaign: 'cam-1',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    data: {
                        name: 'updated name',
                        paymentMethod: selfiePaypal.token,
                        pricing: { budget: 500 },
                        targeting: {
                            geo: { dmas: ['princeton'] },
                            interests: ['cat-3']
                        }
                    }
                },
                { id: 'ur-deletedCamp', campaign: 'cam-deleted', status: 'pending', data: { foo: 'bar' } }
            ];
            mockCamps = [
                {
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'draft',
                    application: 'selfie',
                    paymentMethod: selfieCredit.token,
                    pricing: { budget: 1000, dailyLimit: 200, cost: 0.07, model: 'cpv' },
                    targeting: {
                        geo: { states: ['new jersey' ] },
                        interests: ['cat-1', 'cat-2']
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                },
                { id: 'cam-2', name: 'camp 2', status: 'draft', user: 'e2e-user', org: 'o-selfie' },
                { id: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie' }
            ];
            if (createdCamp) {
                mockCamps.push(createdCamp);
            }

            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/ur-1',
                json: { data: {
                    name: 'fernando',
                    pricing: { dailyLimit: 100 },
                    targeting: {
                        geo: { dmas: ['new york city', 'newark'] },
                        demographics: { gender: ['male'] }
                    }
                } },
                jar: adminJar
            };
            q.all([
                testUtils.resetCollection('campaignUpdates', mockUpdates),
                testUtils.resetCollection('campaigns', mockCamps),
            ]).done(function() { done(); });
        });

        it('should be able to edit the data of an update', function(done) {
            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'draft',
                    application: 'selfie',
                    name: 'fernando',
                    paymentMethod: selfiePaypal.token,
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to approve an update and notify the campaign owner', function(done) {
            options.json.status = 'approved';
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('approved');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'draft',
                    application: 'selfie',
                    name: 'fernando',
                    paymentMethod: selfiePaypal.token,
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mailman.once(approveSubject, function(msg) {
                testApprovalMsg(msg, mockCamps[0], false);
                
                // test that campaign successfully edited
                requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.name).toBe('fernando');
                    expect(resp.body.paymentMethod).toBe(selfiePaypal.token);
                    expect(resp.body.pricing).toEqual({ budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' });
                    expect(resp.body.targeting).toEqual({
                        geo: {
                            states: ['new jersey'],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should be able to reject an update and notify the campaign owner', function(done) {
            options.json = { status: 'rejected', rejectionReason: 'yo campaign stinks' };
            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('rejected');
                expect(resp.body.rejectionReason).toBe('yo campaign stinks');
                expect(resp.body.campaign).toBe('cam-1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mailman.once(rejectSubject, function(msg) {
                testRejectMsg(msg, mockCamps[0], 'yo campaign stinks', false);
                
                // test that campaign successfully unlocked
                requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.rejectionReason).toBe('yo campaign stinks');
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.name).toBe(mockCamps[0].name);
                    expect(resp.body.paymentMethod).toBe(mockCamps[0].paymentMethod);
                    expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
                    expect(resp.body.targeting).toEqual(mockCamps[0].targeting);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return a 400 if attempting to reject an update without a reason', function(done) {
            options.json = { status: 'rejected' };
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot reject update without a reason');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if an update is an inital request for approval', function() {
            beforeEach(function(done) {
                approveSubject = 'Reelcontent Campaign Approved';
                rejectSubject = 'Reelcontent Campaign Rejected';
                var mockUpdate = {
                    id: 'ur-1',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    campaign: 'cam-1',
                    initialSubmit: true,
                    data: { status: 'active' }
                };
                mockCamps[0].status = 'pending';
                options.json = {};
                q.all([
                    testUtils.resetCollection('campaignUpdates', mockUpdate),
                    testUtils.resetCollection('campaigns', mockCamps),
                ]).done(function() { done(); });
            });
            
            it('should switch the campaign to active if approving the update', function(done) {
                options.json.status = 'approved';
                mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual('ur-1');
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe('cam-1');
                    expect(resp.body.data.status).toBe('active');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(approveSubject, function(msg) {
                    testApprovalMsg(msg, mockCamps[0], true);
                    
                    // test that campaign successfully edited
                    requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.updateRequest).not.toBeDefined();
                        expect(resp.body.name).toBe(mockCamps[0].name);
                        expect(resp.body.status).toBe('active');
                        expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });

            it('should switch the campaign back to draft if rejecting the update', function(done) {
                options.json.status = 'rejected';
                options.json.rejectionReason = 'I got a problem with YOU';
                mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual('ur-1');
                    expect(resp.body.status).toBe('rejected');
                    expect(resp.body.campaign).toBe('cam-1');
                    expect(resp.body.data.status).toBe('active');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(rejectSubject, function(msg) {
                    testRejectMsg(msg, mockCamps[0], 'I got a problem with YOU', true);
                    
                    // test that campaign successfully edited
                    requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.updateRequest).not.toBeDefined();
                        expect(resp.body.name).toBe(mockCamps[0].name);
                        expect(resp.body.status).toBe('draft');
                        expect(resp.body.rejectionReason).toBe('I got a problem with YOU');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
        });
        
        describe('if the update was modifying the campaign\'s cards', function(done) {
            beforeEach(function(done) {
                var mockUpdate = {
                    id: 'ur-cards',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    campaign: createdCampDecorated.id,
                    data: {
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            title: 'test card 2.0',
                            data: createdCampDecorated.cards[0].data
                        }]
                    }
                };
                mockUpdate.data.cards[0].data.videoid = 'v123';
                
                createdCamp.updateRequest = 'ur-cards';
                
                return q.all([
                    testUtils.resetCollection('campaignUpdates', mockUpdate),
                    testUtils.resetCollection('campaigns', createdCamp),
                ]).done(function() { done(); });
            });

            it('should apply edits to the cards as well', function(done) {
                mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

                options = {
                    url: config.adsUrl + '/campaigns/' + createdCampDecorated.id + '/updates/ur-cards',
                    json: { status: 'approved' },
                    jar: adminJar
                };

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    if (resp.response.statusCode !== 200) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }

                    expect(resp.body.id).toEqual('ur-cards');
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe(createdCampDecorated.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(approveSubject, function(msg) {
                    testApprovalMsg(msg, createdCampDecorated, false);
                    
                    // test that campaign successfully edited
                    requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCampDecorated.id,
                        jar: selfieJar
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.updateRequest).not.toBeDefined();
                        expect(resp.body.cards[0].title).toBe('test card 2.0');
                        expect(resp.body.cards[0].campaign).toEqual(createdCampDecorated.cards[0].campaign);
                        expect(resp.body.cards[0].data).toEqual({
                            skip: 5,
                            controls: true,
                            autoplay: true,
                            autoadvance: false,
                            moat: createdCampDecorated.cards[0].data.moat,
                            videoid: 'v123'
                        });
                        
                        createdCampDecorated = resp.body;
                        return testUtils.checkCardEntities(createdCampDecorated, adminJar, config.contentUrl);
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
        });
        
        it('should allow a selfie user to edit their update request but not approve it', function(done) {
            options.jar = selfieJar;
            options.json.status = 'approved';
            options.json.data.pricing.cost = 0.000000001;

            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'draft',
                    application: 'selfie',
                    name: 'fernando',
                    paymentMethod: selfiePaypal.token,
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3'],
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
                
                // test that campaign not edited yet
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.updateRequest).toBe('ur-1');
                expect(resp.body.name).toBe(mockCamps[0].name);
                expect(resp.body.paymentMethod).toBe(mockCamps[0].paymentMethod);
                expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent editing updates for a different campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-2/updates/ur-1';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Update request does not apply to this campaign');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent editing updates for a deleted campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-deleted/updates/ur-deletedCamp';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a nonexistent update', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-1/updates/ur-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.mongoFind('campaigns', {}).then(function(camps) {
            return q.all(camps.map(function(camp) {
                return requestUtils.qRequest('delete', {
                    url: config.adsUrl + '/campaigns/' + camp.id,
                    jar: adminJar
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                });
            }));
        }).then(function() {
            // cleanup created braintree customers
            return q.all(mockOrgs.map(function(org) {
                return q.npost(gateway.customer, 'delete', [org.braintreeCustomer]);
            }));
        }).then(function() {
            return testUtils.closeDbs();
        }).done(done);
    });
});

