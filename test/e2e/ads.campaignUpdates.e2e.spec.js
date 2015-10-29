var q               = require('q'),
    adtech          = require('adtech'),
    kCamp           = adtech.constants.ICampaign,
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    adtechErr       = testUtils.handleAdtechError,
    keywords        = testUtils.keyMap,
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api/content',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('ads campaignUpdates endpoints (E2E):', function() {
    var selfieJar, selfieUser, adminJar, adminUser, testPolicies, adminCreatedCamp, selfieCreatedCamp, keptAdvert, keptCust;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 90000;

        if (selfieJar && selfieJar.cookies && adminJar && adminJar.cookies) {
            return done();
        }
        selfieJar = request.jar();
        selfieUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'selfieuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            advertiser: 'e2e-a-keepme',
            customer: 'e2e-cu-keepme',
            policies: ['selfieCampPolicy']
        };
        adminJar = request.jar();
        adminUser = {
            id: 'admin-e2e-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            policies: ['adminCampPolicy']
        };

        testPolicies = [
            {
                id: 'p-e2e-selfie',
                name: 'selfieCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    cards: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' },
                    campaignUpdates: { read: 'org', create: 'org' }
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
                id: 'p-e2e-selfie',
                name: 'adminCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    experiences: { read: 'all', delete: 'all' },
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    campaignUpdates: { read: 'all', create: 'all', edit: 'all' }
                },
                fieldValidation: {
                    campaigns: {
                        advertiserId : { __allowed: true },
                        customerId : { __allowed: true },
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
                }
            },
        ];
        
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: selfieJar,
            json: {
                email: 'selfieuser',
                password: 'password'
            }
        };
        var adminLoginOpts = {
            url: config.authUrl + '/login',
            jar: adminJar,
            json: {
                email: 'adminuser',
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
    
    beforeEach(function(done) {
        if (adtech.campaignAdmin && adtech.bannerAdmin) {
            return done();
        }
        adtech.createClient().catch(adtechErr).done(function(resp) { done(); });
    });

    // Setup an advertiser + customer in mongo so we can use them to create campaigns.
    beforeEach(function(done) {
        if (keptCust && keptAdvert) {
            return done();
        } else {
            q.all([
                adtech.customerAdmin.getCustomerByExtId('e2e-cu-keepme').catch(adtechErr),
                adtech.customerAdmin.getAdvertiserByExtId('e2e-a-keepme').catch(adtechErr)
            ]).spread(function(customer, advertiser) {
                keptCust = { id: 'e2e-cu-keepme', status: 'active', name: customer.name, adtechId: customer.id };
                keptAdvert = { id: 'e2e-a-keepme', status: 'active', name: advertiser.name, adtechId: advertiser.id };
                return q.all([
                    testUtils.resetCollection('advertisers', keptAdvert),
                    testUtils.resetCollection('customers', keptCust)
                ]);
            }).done(function(results) { done(); });
        }
    });

    describe('GET /api/campaigns/:campId/updates/:id', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-getId1/updates/ur-getId1',
                qs: {},
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending', user: 'e2e-user', org: 'e2e-org', data: {} },
                { id: 'ur-getId2', campaign: 'cam-getId1', status: 'pending', user: 'not-e2e-user', org: 'not-e2e-org', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });
        
        it('should get a campaign update by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending',
                    user: 'e2e-user', org: 'e2e-org', data: {} });
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/cam-getId1/updates/:id',
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
                    user: 'not-e2e-user', org: 'not-e2e-org', data: {} });
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
                { id: 'ur-getQry1', campaign: 'cam-getQry1', status: 'pending', user: 'e2e-user', org: 'e2e-org', data: {} },
                { id: 'ur-getQry2', campaign: 'cam-getQry1', status: 'pending', user: 'not-e2e-user', org: 'not-e2e-org', data: {} },
                { id: 'ur-getQry3', campaign: 'cam-getQry1', status: 'approved', user: 'e2e-user', org: 'e2e-org', data: {} },
                { id: 'ur-getQry4', campaign: 'cam-getQry1', status: 'approved', user: 'e2e-user', org: 'e2e-org', data: {} },
                { id: 'ur-getQry5', campaign: 'cam-getQry1', status: 'rejected', user: 'e2e-user', org: 'e2e-org', data: {} }
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/cam-getQry1/updates/',
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
            options.url = config.adsUrl + '/campaigns/cam-getQry2/updates/'
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
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/',
                json: {},
                jar: selfieJar
            };
            done(); //TODO
        });


        it('should return a 401 if the user is not authenticated', function(done) {
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
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/ur-1',
                json: {},
                jar: adminJar
            };
            done(); //TODO
        });
        

        it('should return a 403 if the user does not have permission to edit updates', function(done) {
            options.jar = selfieJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Forbidden');
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
        testUtils.closeDbs().done(done);
    });
});

