var q               = require('q'),
    adtech          = require('adtech'),
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

describe('ads campaigns endpoints (E2E):', function() {
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
                    campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' }
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
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
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
                        miniReels: {
                            __allowed: true,
                        }
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

    // only do this once, so their state is preserved in between tests
    describe('setting up experiences and cards', function() {
        it('creates some mock experiences and cards', function(done) {
            var mockCards = [
                {id: 'e2e-rc-1', title: 'test card 1', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'e2e-org'},
                {id: 'e2e-rc-2', title: 'test card 2', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'e2e-org'},
                {id: 'e2e-rc-3', title: 'test card 3', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'not-e2e-org'}
            ];
            var mockExps = [
                {id: 'e2e-e-1', status: [{status: 'active'}], user: 'not-e2e-user', org: 'not-e2e-org'},
                {id: 'e2e-e-2', status: [{status: 'active'}], user: 'not-e2e-user', org: 'e2e-org'}
            ];

            q.all([
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('experiences', mockExps)
            ]).done(function(results) { done(); });
        });
    });


    describe('GET /api/campaign/:id', function() {
        beforeEach(function(done) {
            var mockCamps = [
                { id: 'e2e-getid1', name: 'camp 1', status: 'active', user: 'not-e2e-user', org: 'e2e-org' },
                { id: 'e2e-getid2', name: 'camp 2', status: 'deleted', user: 'e2e-user', org: 'e2e-org' },
                { id: 'e2e-getid3', name: 'camp 2', status: 'active', user: 'not-e2e-user', org: 'not-e2e-org' },
                { id: 'e2e-getCards', name: 'camp w/ cards', status: 'active', user: 'e2e-user', org: 'e2e-org', cards: [{ id: 'e2e-rc-1' }, { id: 'e2e-rc-2' }] }
            ];
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });

        it('should get a campaign by id', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid1', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-getid1', name: 'camp 1', status: 'active',
                    user: 'not-e2e-user', org: 'e2e-org' });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid1', jar: selfieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/campaign/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should decorate a campaign with cards if defined', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getCards', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getCards',
                    name: 'camp w/ cards',
                    status: 'active',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    cards: [
                        {id: 'e2e-rc-1', title: 'test card 1', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'e2e-org'},
                        {id: 'e2e-rc-2', title: 'test card 2', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'e2e-org'}
                    ]
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            var options = {
                url: config.adsUrl + '/campaign/e2e-getid1',
                qs: { fields: 'name,status' },
                jar: selfieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    name: 'camp 1',
                    status: 'active'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted campaigns', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid2', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show campaigns the user does not have permission to see', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid3', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/campaign/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid5678', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/campaigns', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/campaigns', qs: {sort: 'id,1'}, jar: selfieJar };
            var mockCamps = [
                {
                    id: 'e2e-getquery1',
                    name: 'camp 1',
                    advertiserDisplayName: 'Heinz',
                    status: 'active',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    application: 'studio'
                },
                {
                    id: 'e2e-getquery2',
                    name: 'camp 2 is great',
                    advertiserDisplayName: 'Heinz Ketchup',
                    status: 'inactive',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                    application: 'studio'
                },
                {
                    id: 'e2e-getquery3',
                    name: 'camp 3',
                    advertiserDisplayName: 'Heinz is great',
                    status: 'active',
                    updateRequest: 'ur-1',
                    user: 'e2e-user',
                    org: 'not-e2e-org',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getquery4',
                    name: 'camp 4 is great',
                    status: 'active',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getquery5',
                    name: 'camp 5 is great',
                    advertiserDisplayName: 'Hunts',
                    status: 'active',
                    updateRequest: 'ur-2',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getgone',
                    name: 'camp deleted',
                    status: 'deleted',
                    user: 'e2e-user',
                    org: 'e2e-org'
                }
            ];
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });

        it('should get all campaigns a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
                expect(resp.body[3].id).toBe('e2e-getquery5');
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'name,application';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1', name: 'camp 1', application: 'studio' },
                    { id: 'e2e-getquery2', name: 'camp 2 is great', application: 'studio' },
                    { id: 'e2e-getquery3', name: 'camp 3', application: 'selfie' },
                    { id: 'e2e-getquery5', name: 'camp 5 is great', application: 'selfie' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should guard against invalid fields params', function(done) {
            options.qs.fields = { foo: 'bar' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1' },
                    { id: 'e2e-getquery2' },
                    { id: 'e2e-getquery3' },
                    { id: 'e2e-getquery5' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns by name', function(done) {
            options.qs.name = 'camp 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns by text search', function(done) {
            options.qs.text = 'camp is great';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should match the advertiserDisplayName field with a text search', function(done) {
            options.qs.text = 'is great';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.body[2].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns with pending update requests', function(done) {
            options.qs.pendingUpdate = 'true';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.body[1].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns by list of ids', function(done) {
            options.qs.ids = 'e2e-getquery1,e2e-getquery5';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery5');
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
        
        it('should get campaigns by statuses', function(done) {
            options.qs.statuses = 'active';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.body[2].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
                options.qs.statuses = 'active,inactive';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.body.length).toBe(4);
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow querying for campaigns that are deleted', function(done) {
            options.qs.statuses = 'inactive,deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns by user', function(done) {
            options.qs.user = 'e2e-user';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get campaigns by org', function(done) {
            options.qs.org = 'e2e-org';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get campaigns by application', function(done) {
            options.qs.application = 'selfie';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.body[1].id).toBe('e2e-getquery5');
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
                expect(resp.body[0].id).toBe('e2e-getquery5');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
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

    describe('POST /api/campaign', function() {
        var name = 'e2e_test-' + new Date().toISOString(),
            start = new Date(new Date().valueOf() + 2*60*60*1000),
            end = new Date(new Date().valueOf() + 3*60*60*1000),
            mockCamp, options;
        beforeEach(function() {
            mockCamp = {
                name: name,
                targeting: {
                    interests: ['cat-1', 'cat-2']
                },
                advertiserId: keptAdvert.id,
                customerId: keptCust.id,
                miniReels: [{ id: 'e2e-e-1' }],
                cards: [
                    { id: 'e2e-rc-1', campaign:  { startDate: start.toISOString(), adtechName: null, reportingId: 'report me' } },
                    { title: 'my new card', campaign: { adtechName: 'card 2', startDate: start.toISOString(), endDate: end.toISOString() } }
                ],
                staticCardMap: { 'e2e-fake': { 'rc-pl1': 'e2e-rc-1' } }
            };
            options = {
                url: config.adsUrl + '/campaign',
                jar: adminJar,
                json: mockCamp
            };
        });

        it('should be able to create a campaign, creating/updating cards as necessary', function(done) {
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.user).toBe('admin-e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.status).toBe('draft');
                expect(resp.body.statusHistory).toEqual([
                    { status: 'draft', userId: 'admin-e2e-user', user: 'adminuser', date: jasmine.any(String) }
                ]);
                expect(resp.body.name).toBe(mockCamp.name);
                expect(resp.body.targeting).toEqual({ interests: ['cat-1', 'cat-2'] });
                expect(resp.body.miniReels).toEqual([{ id: 'e2e-e-1' }]);
                expect(resp.body.staticCardMap).toEqual({'e2e-fake':{'rc-pl1': 'e2e-rc-1'}});
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);

                expect(resp.body.cards.length).toBe(2);
                expect(resp.body.cards[0].id).toEqual('e2e-rc-1');
                expect(resp.body.cards[0].title).toEqual('test card 1');
                expect(resp.body.cards[0].campaign.adtechName).toEqual('card_e2e-rc-1');
                expect(resp.body.cards[0].campaign.reportingId).toEqual('report me');
                expect(resp.body.cards[0].campaign.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.bannerId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.bannerNumber).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.startDate).toEqual(start.toISOString());
                expect(resp.body.cards[0].campaign.endDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].status).toEqual('active');
                expect(resp.body.cards[0].user).toEqual('not-e2e-user');
                expect(resp.body.cards[0].org).toEqual('e2e-org');

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('my new card');
                expect(resp.body.cards[1].campaign.adtechName).toEqual('card 2');
                expect(resp.body.cards[1].campaign.reportingId).toEqual(mockCamp.name);
                expect(resp.body.cards[1].campaign.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerNumber).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.startDate).toEqual(start.toISOString());
                expect(resp.body.cards[1].campaign.endDate).toEqual(end.toISOString());
                expect(resp.body.cards[1].status).toEqual('active');
                expect(resp.body.cards[1].user).toEqual('admin-e2e-user');
                expect(resp.body.cards[1].org).toEqual('e2e-org');

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);

            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('created campaign', function() {
            it('should have a sponsored campaign for each entry in cards', function(done) {
                q.all(adminCreatedCamp.cards.map(function(card) {
                    return adtech.campaignAdmin.getCampaignByExtId(card.id).catch(adtechErr).then(function(camp) {
                        // these keyword ids for the category ids should never change, so we can hardcode
                        testUtils.checkCardCampaign(camp, adminCreatedCamp, card, [keywords['cat-1'], keywords['cat-2']], keptAdvert, keptCust);
                        return testUtils.getCampaignBanners(camp.id);
                    }).then(function(banners) {
                        testUtils.compareBanners(banners, [card.id], 'card');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(function(results) { done(); });
            });
        });
        
        it('should be able to create a campaign with multiple new sponsored cards', function(done) {
            delete mockCamp.miniReels;
            mockCamp.name = 'multi cards';
            mockCamp.cards = [{ title: 'dogs are cool' }, { title: 'and so are cats' }];
            
            var newCamp;
            
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('multi cards');

                expect(resp.body.cards.length).toBe(2);
                expect(resp.body.cards[0].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].campaign.adtechName).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].campaign.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.bannerId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.bannerNumber).toEqual(jasmine.any(Number));
                expect(resp.body.cards[0].campaign.startDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].campaign.endDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].status).toEqual('active');

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('and so are cats');
                expect(resp.body.cards[1].campaign.adtechName).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].campaign.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerNumber).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.startDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].campaign.endDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].status).toEqual('active');
                
                newCamp = resp.body;

                return testUtils.checkCardEntities(newCamp, adminJar, config.contentUrl);
            }).then(function() {
                return requestUtils.qRequest('delete', {
                    url: config.adsUrl + '/campaigns/' + newCamp.id,
                    jar: adminJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a campaign without sponsored sub-campaigns', function(done) {
            options.json = { name: 'empty camp', targeting: { interests: ['cat-1', 'cat-2'] },
                             advertiserId: keptAdvert.id, customerId: keptCust.id };
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.targeting).toEqual({
                    interests: ['cat-1', 'cat-2']
                });
                expect(resp.body.miniReels).not.toBeDefined();
                expect(resp.body.cards).not.toBeDefined();
                expect(resp.body.pricingHistory).not.toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('draft');
                
                // check that it wrote an entry to the audit collection
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('admin-e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/campaign/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should initialize pricingHistory when creating a campaign with pricing', function(done) {
            options.json = {
                name: 'withPricing',
                advertiserId: keptAdvert.id,
                customerId: keptCust.id,
                pricing: {
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpm',
                    cost: 0.1234
                }
            };
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('withPricing');
                expect(resp.body.pricing).toEqual({
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpm',
                    cost: 0.1234
                });
                expect(resp.body.pricingHistory).toEqual([{
                    date: jasmine.any(String),
                    userId: 'admin-e2e-user',
                    user: 'adminuser',
                    pricing: {
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpm',
                        cost: 0.1234
                    }
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the body is incomplete', function(done) {
            q.all([{advertiserId: 'fake'}, {customerId: 'fake'}].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Must provide advertiserId + customerId');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if any of the lists are not distinct', function(done) {
            q.all([
                { cards: [{id: 'e2e-rc-1'}, {id: 'e2e-rc-1'}] },
                { miniReels: [{id: 'e2e-e-1'}, {id: 'e2e-e-1'}] }
            ].map(function(obj) {
                obj.advertiserId = keptAdvert.id;
                obj.customerId = keptCust.id;
                options.json = obj;
                return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('cards must be distinct');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('miniReels must be distinct');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if multiple sub-campaigns have the same name', function(done) {
            mockCamp.cards[0].campaign.adtechName = 'card 2';
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('cards[1] has a non-unique name: "card 2"');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if dates are invalid', function(done) {
            var mockCamps = [{}, {}, {}, {}].map(function() { return JSON.parse(JSON.stringify(mockCamp)); });
            mockCamps[0].cards[0].campaign.startDate = 'foo';
            mockCamps[1].cards[1].campaign.endDate = 'bar';
            mockCamps[2].cards[0].campaign.startDate = end;
            mockCamps[2].cards[0].campaign.endDate = start;
            mockCamps[3].cards[0].campaign.startDate = new Date(new Date().valueOf() - 5000);
            mockCamps[3].cards[0].campaign.endDate = new Date(new Date().valueOf() - 4000);

            q.all(mockCamps.map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('cards[0] has invalid dates');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('cards[1] has invalid dates');
                expect(results[2].response.statusCode).toBe(400);
                expect(results[2].body).toBe('cards[0] has invalid dates');
                expect(results[3].response.statusCode).toBe(400);
                expect(results[3].body).toBe('cards[0] has invalid dates');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the advertiser or customer don\'t exist', function(done) {
            q.all([
                {name: 'test', advertiserId: 'fake', customerId: mockCamp.customerId},
                {name: 'test', advertiserId: mockCamp.advertiserId, customerId: 'fake'}
            ].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('advertiser fake does not exist');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('customer fake does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('for selfie users', function(done) {
            beforeEach(function() {
                mockCamp = {
                    name: 'Always On Dollars',
                    cards: [{ title: 'dolla dolla billz' }],
                    targeting: {
                        interests: []
                    }
                };
                options = {
                    url: config.adsUrl + '/campaign',
                    jar: selfieJar,
                    json: mockCamp
                };
            });
            
            it('should allow creating campaigns with one sponsored card', function(done) {
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.user).toEqual('e2e-user');
                    expect(resp.body.org).toEqual('e2e-org');
                    expect(resp.body.advertiserId).toEqual('e2e-a-keepme');
                    expect(resp.body.customerId).toEqual('e2e-cu-keepme');
                    expect(resp.body.created).toEqual(jasmine.any(String));
                    expect(resp.body.lastUpdated).toEqual(jasmine.any(String));
                    expect(resp.body.status).toEqual('draft');
                    expect(resp.body.statusHistory).toEqual([
                        { status: 'draft', userId: 'e2e-user', user: 'selfieuser', date: jasmine.any(String) }
                    ]);
                    expect(resp.body.application).toEqual('selfie');
                    expect(resp.body.targeting).toEqual({ interests: [] });
                    expect(resp.body.name).toBe('Always On Dollars');
                    expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                    expect(resp.body.lastUpdated).toEqual(resp.body.created);

                    expect(resp.body.cards.length).toBe(1);
                    expect(resp.body.cards[0].id).toEqual(jasmine.any(String));
                    expect(resp.body.cards[0].title).toEqual('dolla dolla billz');
                    expect(resp.body.cards[0].campaign.adtechName).toEqual('card_' + resp.body.cards[0].id);
                    expect(resp.body.cards[0].campaign.reportingId).toEqual(mockCamp.name);
                    expect(resp.body.cards[0].campaign.adtechId).toEqual(jasmine.any(Number));
                    expect(resp.body.cards[0].campaign.bannerId).toEqual(jasmine.any(Number));
                    expect(resp.body.cards[0].campaign.bannerNumber).toEqual(jasmine.any(Number));
                    expect(resp.body.cards[0].campaign.startDate).toEqual(jasmine.any(String));
                    expect(resp.body.cards[0].campaign.endDate).toEqual(jasmine.any(String));
                    expect(resp.body.cards[0].status).toEqual('active');
                    expect(resp.body.cards[0].user).toEqual('e2e-user');
                    expect(resp.body.cards[0].org).toEqual('e2e-org');

                    selfieCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(selfieCreatedCamp, selfieJar, config.contentUrl);

                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            describe('created campaign', function() {
                it('should have a sponsored campaign for each entry in cards', function(done) {
                    q.all(selfieCreatedCamp.cards.map(function(card) {
                        return adtech.campaignAdmin.getCampaignByExtId(card.id).catch(adtechErr).then(function(camp) {
                            testUtils.checkCardCampaign(camp, selfieCreatedCamp, card, [keywords['*']], keptAdvert, keptCust);
                            return testUtils.getCampaignBanners(camp.id);
                        }).then(function(banners) {
                            testUtils.compareBanners(banners, [card.id], 'card');
                        });
                    })).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(function(results) { done(); });
                });
            });
            
            it('should be able to create a campaign with some pricing opts', function(done) {
                options.json = {
                    name: 'withPricing',
                    pricing: {
                        budget: 2000,
                        dailyLimit: 500,
                        model: 'never charge me',   // should get overriden
                        cost: 0.0000000001          // should 
                    }
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toBeDefined();
                    expect(resp.body.pricing).toEqual({
                        budget: 2000,
                        dailyLimit: 500,
                        model: 'cpv',
                        cost: 0.09
                    });
                    expect(resp.body.pricingHistory).toEqual([{
                        userId: 'e2e-user',
                        user: 'selfieuser',
                        date: jasmine.any(String),
                        pricing: resp.body.pricing
                    }]);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the user sends up invalid pricing opts', function(done) {
                q.all([
                    { budget: 9999999999999999999999 },
                    { budget: -1234 },
                    { budget: 1000, dailyLimit: 2000 },
                    { budget: 1000, dailyLimit: 1 }
                ].map(function(pricing) {
                    options.json = { pricing: pricing };
                    return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toMatch(/pricing\.budget must be less than the max: \d+/);
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toMatch(/pricing\.budget must be greater than the min: \d+/);
                    expect(results[2].response.statusCode).toBe(400);
                    expect(results[2].body).toMatch(/dailyLimit must be between \d+\.?\d* and \d+\.?\d* of budget/);
                    expect(results[3].response.statusCode).toBe(400);
                    expect(results[2].body).toMatch(/dailyLimit must be between \d+\.?\d* and \d+\.?\d* of budget/);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to create a campaign with other targeting options', function(done) {
                options.json = {
                    name: 'withTargeting',
                    targeting: {
                        geo: {
                            states: ['ohio', 'iowa'],
                            dmas: ['princeton']
                        },
                        demographics: {
                            gender: [],
                            age: ['0-18', '18-24'],
                            income: ['1000-2000']
                        },
                        interests: ['cat-1', 'cat-2']
                    }
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toBeDefined();
                    expect(resp.body.name).toBe('withTargeting');
                    expect(resp.body.targeting).toEqual({
                        geo: {
                            states: ['ohio', 'iowa'],
                            dmas: ['princeton']
                        },
                        demographics: {
                            gender: [],
                            age: ['0-18', '18-24'],
                            income: ['1000-2000']
                        },
                        interests: ['cat-1', 'cat-2']
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the user tries to create multiple sponsored cards', function(done) {
                options.json = {
                    cards: [{ id: 'e2e-rc-selfie1' }, { id: 'e2e-rc-1' }]
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 })
                .then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('cards must have at most 1 entries');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should trim off other forbidden properties', function(done) {
                options.json = {
                    name: 'hax',
                    advertiserId: 'a-fake',
                    customerId: 'cu-fake',
                    application: 'proshop',
                    minViewTime: 999,
                    statusHistory: ['foo'],
                    pricingHistory: ['bar'],
                    staticCardMap: { 'e2e-fake': { 'rc-pl1': 'e2e-rc-1' } },
                    miniReels: [{ id: 'e-1' }]
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual({
                        id: jasmine.any(String),
                        user: 'e2e-user',
                        org: 'e2e-org',
                        advertiserId: 'e2e-a-keepme',
                        customerId: 'e2e-cu-keepme',
                        created: jasmine.any(String),
                        lastUpdated: jasmine.any(String),
                        status: 'draft',
                        statusHistory: [
                            { status: 'draft', userId: 'e2e-user', user: 'selfieuser', date: jasmine.any(String) }
                        ],
                        name: 'hax',
                        application: 'selfie'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    describe('PUT /api/campaign/:id', function() {
        var mockCamps, options, origPricing, oldDate;
        beforeEach(function(done) {
            oldDate = new Date(new Date().valueOf() - 5000);
            origPricing = {
                budget: 1000,
                dailyLimit: 400,
                model: 'cpv',
                cost: 0.1
            };
            mockCamps = [
                {
                    id: 'e2e-put1', status: 'active', advertiserId: keptAdvert.id, customerId: keptCust.id,
                    name: 'fake camp', user: 'not-e2e-user', org: 'e2e-org'
                },
                {
                    id: 'e2e-put2', status: 'active', advertiserId: keptAdvert.id, customerId: keptCust.id,
                    name: 'fake camp 2', user: 'not-e2e-user', org: 'not-e2e-org'
                },
                {
                    id: 'e2e-put3', status: 'active', advertiserId: keptAdvert.id, customerId: keptCust.id,
                    name: 'fake camp 3', updateRequest: 'e2e-ur-1', user: 'e2e-user', org: 'e2e-org'
                },
                {
                    id: 'e2e-deleted', status: 'deleted', advertiserId: keptAdvert.id, customerId: keptCust.id,
                    name: 'deleted camp'
                },
                {
                    id: 'e2e-withPricing',
                    name: 'withPricing',
                    status: 'active',
                    advertiserId: keptAdvert.id,
                    customerId: keptCust.id,
                    user: 'e2e-user',
                    org: 'e2e-org',
                    pricing: origPricing,
                    pricingHistory: [{
                        date: oldDate,
                        userId: 'u-otheruser',
                        user: 'otheruser@c6.com',
                        pricing: origPricing
                    }]
                }
            ];
            return testUtils.mongoFind(
                'campaigns',
                { id: { $in: [adminCreatedCamp.id, selfieCreatedCamp.id] } }
            ).then(function(results) {
                mockCamps = mockCamps.concat(results);
                return testUtils.resetCollection('campaigns', mockCamps);
            }).done(done);
        });
        
        it('should successfully update a campaign in our database', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-put1',
                json: { name: 'updated fake camp' },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.user).toBe('not-e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.name).toBe('updated fake camp');
                expect(resp.body.pricing).not.toBeDefined();
                expect(resp.body.pricingHistory).not.toBeDefined();
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('admin-e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/campaign/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should update the pricingHistory if the pricing changes', function(done) {
            var newPricing = {
                budget: 1000,
                dailyLimit: 200,
                model: 'cpcv',
                cost: 0.666
            };
            options = {
                url: config.adsUrl + '/campaign/e2e-withPricing',
                json: { pricing: newPricing },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('withPricing');
                expect(resp.body.pricing).toEqual(newPricing);
                expect(resp.body.pricingHistory).toEqual([
                    {
                        date: jasmine.any(String),
                        userId: 'admin-e2e-user',
                        user: 'adminuser',
                        pricing: newPricing
                    },
                    {
                        date: oldDate.toISOString(),
                        userId: 'u-otheruser',
                        user: 'otheruser@c6.com',
                        pricing: origPricing
                    }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not update the pricingHistory if the pricing stays the same', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-withPricing',
                json: {
                    name: 'withPricing-updated',
                    pricing: {
                        budget: 1000,
                        dailyLimit: 400,
                        model: 'cpv',
                        cost: 0.1
                    }
                },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('withPricing-updated');
                expect(resp.body.pricing).toEqual(origPricing);
                expect(resp.body.pricingHistory).toEqual([{
                    date: oldDate.toISOString(),
                    userId: 'u-otheruser',
                    user: 'otheruser@c6.com',
                    pricing: origPricing
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to initialize the pricing + pricingHistory on an existing campaign', function(done) {
            var newPricing = {
                budget: 1000,
                dailyLimit: 200,
                model: 'cpv',
                cost: 0.1
            };
            options = {
                url: config.adsUrl + '/campaign/e2e-put1',
                json: { pricing: newPricing },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('fake camp');
                expect(resp.body.pricing).toEqual(newPricing);
                expect(resp.body.pricingHistory).toEqual([{
                    date: jasmine.any(String),
                    userId: 'admin-e2e-user',
                    user: 'adminuser',
                    pricing: newPricing
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to add+remove sponsored cards', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: [{ id: adminCreatedCamp.cards[1].id }, { title: 'card numba 3' }] },
                jar: adminJar
            };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.created).toBe(adminCreatedCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(adminCreatedCamp.lastUpdated));
                expect(resp.body.cards[0].campaign).toEqual(adminCreatedCamp.cards[1].campaign);

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('card numba 3');
                expect(resp.body.cards[1].campaign.adtechName).toEqual('card_' + resp.body.cards[1].id);
                expect(resp.body.cards[1].campaign.reportingId).toEqual(resp.body.name);
                expect(resp.body.cards[1].campaign.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerId).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.bannerNumber).toEqual(jasmine.any(Number));
                expect(resp.body.cards[1].campaign.startDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].campaign.endDate).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].status).toEqual('active');
                expect(resp.body.cards[1].user).toEqual('admin-e2e-user');
                expect(resp.body.cards[1].org).toEqual('e2e-org');

                expect(resp.body.staticCardMap).toEqual({ 'e2e-fake': {} });
                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).then(function() {
                return q.allSettled([
                    adtech.campaignAdmin.getCampaignByExtId(adminCreatedCamp.cards[0].id),
                    adtech.campaignAdmin.getCampaignByExtId('e2e-rc-1'),
                    adtech.campaignAdmin.getCampaignByExtId(adminCreatedCamp.cards[1].id)
                ]);
            }).then(function(results) {
                // just check that first camp still exists
                expect(results[0].state).toBe('fulfilled');
                expect(results[0].value).toBeDefined();

                // e2e-rc-1 campaign should no longer exist
                expect(results[1].state).toBe('rejected');
                expect(results[1].reason && results[1].reason.message).toMatch(/^Unable to locate object: /);

                // check that new campaign created properly
                expect(results[2].state).toBe('fulfilled');
                testUtils.checkCardCampaign(results[2].value, adminCreatedCamp, adminCreatedCamp.cards[1],
                    [keywords['cat-2'], keywords['cat-1']], keptAdvert, keptCust);

                return testUtils.getCampaignBanners(results[2].value.id);
            }).then(function(banners) {
                testUtils.compareBanners(banners, [adminCreatedCamp.cards[1].id], 'card');
                
                return testUtils.mongoFind('cards', {id: 'e2e-rc-1'});
            }).then(function(results) {
                expect(results[0].status).toBe('deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be ale to add + remove sponsored miniReels', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { miniReels: [{ id: 'e2e-e-2' }] },
                jar: adminJar
            };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.created).toBe(adminCreatedCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(adminCreatedCamp.lastUpdated));
                expect(resp.body.miniReels).toEqual([{ id: 'e2e-e-2' }]);

                adminCreatedCamp = resp.body;
                return requestUtils.qRequest('get', {
                    url: config.contentUrl + '/experiences/e2e-e-1',
                    jar: adminJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Experience not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should edit sponsored campaigns\' keywords if the interests change', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: {
                    cards: adminCreatedCamp.cards,
                    targeting: { interests: ['cat-1', 'cat-3'] }
                },
                jar: adminJar
            };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.targeting).toEqual({
                    interests: ['cat-1', 'cat-3']
                });
                adminCreatedCamp = resp.body;
                
                return q.all(adminCreatedCamp.cards.map(function(card) {
                    return adtech.campaignAdmin.getCampaignByExtId(card.id).then(function(camp) {
                        testUtils.checkCardCampaign(camp, adminCreatedCamp, card, [keywords['cat-3'], keywords['cat-1']], keptAdvert, keptCust);
                        return q();
                    });
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(function(results) { done(); });
        });
        
        it('should switch to using * as kwlp3 if no interests are set', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: {
                    targeting: { interests: [] }
                },
                jar: adminJar
            };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.targeting).toEqual({ interests: [] });
                adminCreatedCamp = resp.body;
                
                return q.all(adminCreatedCamp.cards.map(function(card) {
                    return adtech.campaignAdmin.getCampaignByExtId(card.id).then(function(camp) {
                        testUtils.checkCardCampaign(camp, adminCreatedCamp, card, [keywords['*']], keptAdvert, keptCust);
                        return q();
                    });
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(function(results) { done(); });
        });

        it('should be able to edit cards\' campaigns\' names', function(done) {
            adminCreatedCamp.cards[0].campaign.adtechName = 'humphrey';
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: adminCreatedCamp.cards },
                jar: adminJar
            };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.cards[0].campaign.adtechName).toEqual('humphrey');
                expect(resp.body.cards[1].campaign).toEqual(adminCreatedCamp.cards[1].campaign);

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).then(function() {
                return adtech.campaignAdmin.getCampaignByExtId(adminCreatedCamp.cards[0].id);
            }).then(function(camp) {
                testUtils.checkCardCampaign(camp, adminCreatedCamp, adminCreatedCamp.cards[0], [keywords['*']], keptAdvert, keptCust);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit cards\' campaigns\' start + end dates', function(done) {
            var now = new Date();
            adminCreatedCamp.cards[1].campaign.startDate = new Date(now.valueOf() + 20*24*60*60*1000).toISOString();
            adminCreatedCamp.cards[1].campaign.endDate = new Date(now.valueOf() + 30*24*60*60*1000).toISOString();
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: adminCreatedCamp.cards },
                jar: adminJar
            };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.cards[0].campaign).toEqual(adminCreatedCamp.cards[0].campaign);
                expect(resp.body.cards[1].campaign.startDate).toEqual(new Date(now.valueOf() + 20*24*60*60*1000).toISOString());
                expect(resp.body.cards[1].campaign.endDate).toEqual(new Date(now.valueOf() + 30*24*60*60*1000).toISOString());

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).then(function() {
                return adtech.campaignAdmin.getCampaignByExtId(adminCreatedCamp.cards[1].id);
            }).then(function(camp) {
                testUtils.checkCardCampaign(camp, adminCreatedCamp, adminCreatedCamp.cards[1], [keywords['*']], keptAdvert, keptCust);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit other props on cards', function(done) {
            adminCreatedCamp.cards[0].title = 'Grand Magister';
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: adminCreatedCamp.cards },
                jar: adminJar
            };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.cards[0].title).toBe('Grand Magister');
                expect(resp.body.cards[1].campaign).toEqual(adminCreatedCamp.cards[1].campaign);

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a campaign that has an updateRequest', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-put3',
                json: { name: 'sneaky edit' },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Campaign locked until existing update request resolved');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a campaign that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-deleted',
                json: { name: 'resurrected' },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a campaign if they do not exist', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-putfake',
                json: { name: 'the best thing' },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if any of the lists are not distinct', function(done) {
            options = { url: config.adsUrl + '/campaign/e2e-put1', jar: adminJar };

            q.all([
                { cards: [{id: adminCreatedCamp.cards[0].id}, {id: adminCreatedCamp.cards[0].id}] },
                { miniReels: [{id: 'e2e-e-1'}, {id: 'e2e-e-1'}] }
            ].map(function(obj) {
                options.json = obj;
                return requestUtils.qRequest('put', options, null, { maxAttempts: 30 });
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('cards must be distinct');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('miniReels must be distinct');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if multiple sub-campaigns have the same name', function(done) {
            var cards = JSON.parse(JSON.stringify(adminCreatedCamp.cards));
            cards[0].campaign.adtechName = cards[1].campaign.adtechName;
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: cards },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('cards[1] has a non-unique name: "' + cards[1].campaign.adtechName + '"');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if dates are invalid', function(done) {
            var cards = JSON.parse(JSON.stringify(adminCreatedCamp.cards));
            cards[0].campaign.startDate = 'foo';
            options = {
                url: config.adsUrl + '/campaign/' + adminCreatedCamp.id,
                json: { cards: cards },
                jar: adminJar
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('cards[0] has invalid dates');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-put1',
                json: { name: 'mine now' }
            };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('for selfie users', function(done) {
            beforeEach(function() {
                options = {
                    url: config.adsUrl + '/campaign/' + selfieCreatedCamp.id,
                    json: {},
                    jar: selfieJar
                };
            });

            it('should be able to edit the sponsored card', function(done) {
                selfieCreatedCamp.cards[0].title = 'Funkmaster General';
                options.json = {
                    cards: selfieCreatedCamp.cards,
                    pricing: {
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpcctv',
                        cost: 0.0000001
                    }
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.cards[0].title).toBe('Funkmaster General');
                    expect(resp.body.pricing).toEqual({
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.09
                    });
                    expect(resp.body.pricingHistory).toEqual([{
                        userId: 'e2e-user',
                        user: 'selfieuser',
                        date: jasmine.any(String),
                        pricing: resp.body.pricing
                    }]);

                    selfieCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(selfieCreatedCamp, selfieJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to edit targeting options', function(done) {
                options.json.targeting = {
                    demographics: { age: ['0-18'] },
                    interests: ['cat-3']
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.targeting).toEqual({
                        interests: ['cat-3'],
                        demographics: { age: ['0-18'] }
                    });
                    selfieCreatedCamp = resp.body;

                    return q.all(
                        selfieCreatedCamp.cards.map(function(card) {
                            return adtech.campaignAdmin.getCampaignByExtId(card.id).then(function(camp) {
                                testUtils.checkCardCampaign(camp, selfieCreatedCamp, card, [keywords['cat-3']], keptAdvert, keptCust);
                                return q();
                            });
                        })
                    );
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(function(results) { done(); });
            });
            
            it('should be able to edit pricing', function(done) {
                options.json.pricing = { budget: 4000 };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.pricing).toEqual({
                        budget: 4000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.09
                    });
                    expect(resp.body.pricingHistory).toEqual([
                        {
                            userId: 'e2e-user',
                            user: 'selfieuser',
                            date: jasmine.any(String),
                            pricing: resp.body.pricing
                        },
                        {
                            userId: 'e2e-user',
                            user: 'selfieuser',
                            date: jasmine.any(String),
                            pricing: {
                                budget: 1000,
                                dailyLimit: 200,
                                model: 'cpv',
                                cost: 0.09
                            }
                        }
                    ]);
                    selfieCreatedCamp = resp.body;
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should trim off other forbidden fields', function(done) {
                options.json = {
                    advertiserId: 'a-fake',
                    customerId: 'cu-fake',
                    application: 'proshop',
                    staticCardMap: { 'e2e-fake': { 'rc-pl1': 'e2e-rc-1' } },
                    miniReels: [{ id: 'e-1' }]
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.advertiserId).toEqual('e2e-a-keepme');
                    expect(resp.body.customerId).toEqual('e2e-cu-keepme');
                    expect(resp.body.application).toEqual('selfie');
                    expect(resp.body.staticCardMap).not.toBeDefined();
                    expect(resp.body.miniReels).not.toBeDefined();
                    selfieCreatedCamp = resp.body;
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not edit a campaign the user does not own', function(done) {
                options = {
                    url: config.adsUrl + '/campaign/e2e-put2',
                    json: { name: 'mine now' },
                    jar: selfieJar
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('Not authorized to edit this');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    describe('DELETE /api/campaign/:id', function() {
        beforeEach(function(done) {
            var mockCamps = [
                { id: 'e2e-del1', status: 'deleted' },
                { id: 'e2e-del2', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'e2e-del3', status: 'active', user: 'not-e2e-user', org: 'e2e-org' }
            ];
            
            return testUtils.mongoFind(
                'campaigns',
                { id: { $in: [adminCreatedCamp.id, selfieCreatedCamp.id] } }
            ).then(function(results) {
                mockCamps = mockCamps.concat(results);
                return testUtils.resetCollection('campaigns', mockCamps);
            }).done(done);
        });

        it('should delete campaigns from adtech and set the parent campaign\'s status to deleted', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaign/' + adminCreatedCamp.id};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/campaign/' + adminCreatedCamp.id, jar: adminJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('campaign deletion', function() {
            it('should delete all adtech campaigns', function(done) {
                q.allSettled(
                    adminCreatedCamp.cards.map(function(card) {
                        return adtech.campaignAdmin.getCampaignByExtId(card.id).catch(adtechErr);
                    })
                ).then(function(results) {
                    results.forEach(function(result) {
                        expect(result.state).toBe('rejected');
                        expect(result.reason && result.reason.message).toMatch(/^Unable to locate object: /);
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should delete all cards + minireels', function(done) {
                testUtils.mongoFind(
                    'experiences',
                    { id: { $in: ['e2e-e-1', 'e2e-e-2'] } },
                    { id: 1 }
                ).then(function(results) {
                    expect(results[0].id).toBe('e2e-e-1');
                    expect(results[0].status[0].status).toBe('deleted');
                    expect(results[1].id).toBe('e2e-e-2');
                    expect(results[1].status[0].status).toBe('deleted');
                    
                    return testUtils.mongoFind(
                        'cards',
                        { id: { $in: adminCreatedCamp.cards.map(function(card) { return card.id; }) } },
                        { id: 1 }
                    );
                }).then(function(results) {
                    expect(results.length).toBe(2);
                    results.forEach(function(result) {
                        expect(result.status).toBe('deleted');
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should handle campaigns that have no sub-campaigns', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaign/e2e-del2'};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                // Check that it's writing to the audit collection
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('admin-e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/campaign/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/campaign/e2e-del2' + adminCreatedCamp.id, jar: selfieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign has been deleted', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaign/e2e-del1'};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign does not exist', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaign/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/campaign/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('for selfie users', function() {
            it('should allow a user to delete campaigns they own', function(done) {
                var options = {jar: selfieJar, url: config.adsUrl + '/campaign/' + selfieCreatedCamp.id};
                requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    options = {url: config.adsUrl + '/campaign/' + selfieCreatedCamp.id, jar: selfieJar};
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            describe('campaign deletion', function() {
                it('should delete the card campaign', function(done) {
                    q.allSettled(
                        selfieCreatedCamp.cards.map(function(card) {
                            return adtech.campaignAdmin.getCampaignByExtId(card.id).catch(adtechErr);
                        })
                    ).then(function(results) {
                        results.forEach(function(result) {
                            expect(result.state).toBe('rejected');
                            expect(result.reason && result.reason.message).toMatch(/^Unable to locate object: /);
                        });
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
                
                it('should delete the C6 card', function(done) {
                    testUtils.mongoFind('cards', { id: selfieCreatedCamp.cards[0].id }).then(function(results) {
                        expect(results[0].status).toBe('deleted');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
        
            it('should not allow a user to delete campaigns they do not own', function(done) {
                var options = {jar: selfieJar, url: config.adsUrl + '/campaign/e2e-del3'};
                requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('Not authorized to delete this');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });
    
    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});

