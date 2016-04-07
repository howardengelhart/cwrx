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
        geoUrl      : 'http://' + (host === 'localhost' ? host + ':4200' : host) + '/api/geo',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'rz2pht7gyn6d266b',
        privateKey  : '0a150dac004756370706a195e2bde296'
    });

describe('ads campaigns endpoints (E2E):', function() {
    var selfieJar, adminJar, mockOrgs, mockCards, mockExps, mockApp, appCreds, mockman;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (selfieJar && adminJar) {
            return done();
        }
        selfieJar = request.jar();
        var selfieUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'selfieuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            advertiser: 'e2e-a-keepme',
            customer: 'e2e-cu-keepme',
            policies: ['selfieCampPolicy']
        };
        adminJar = request.jar();
        var adminUser = {
            id: 'admin-e2e-user',
            status: 'active',
            email : 'c6e2etester@gmail.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['adminCampPolicy']
        };

        var testPolicies = [
            {
                id: 'p-e2e-selfie',
                name: 'selfieCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'own', edit: 'own' },
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
                id: 'p-e2e-admin',
                name: 'adminCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all', edit: 'all', delete: 'all' },
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    experiences: { read: 'all', delete: 'all' },
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                },
                fieldValidation: {
                    campaigns: {
                        status: { __allowed: true },
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
                    },
                    cards: {
                        campaign: {
                            minViewTime: { __allowed: true }
                        },
                        data: {
                            skip: { __allowed: true },
                            controls: { __allowed: true },
                            autoplay: { __allowed: true },
                            autoadvance: { __allowed: true }
                        }
                    }
                },
                entitlements: {
                    directEditCampaigns: true
                }
            },
        ];
        mockApp = {
            id: 'app-e2e-campaigns',
            key: 'e2e-campaigns',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            },
            fieldValidation: JSON.parse(JSON.stringify(testPolicies[1].fieldValidation)),
            entitlements: {
                directEditCampaigns: true
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
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
                email: 'c6e2etester@gmail.com',
                password: 'password'
            }
        };
        q.all([
            testUtils.resetCollection('users', [selfieUser, adminUser]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(resp) {
            return q.all([
                requestUtils.qRequest('post', loginOpts),
                requestUtils.qRequest('post', adminLoginOpts)
            ]);
        }).done(function(resp) {
            done();
        });
    });
    
    afterEach(function() {
        mockman.removeAllListeners();
    });
    
    // Ensure exps + cards
    beforeAll(function(done) {
        mockCards = [
            { id: 'e2e-rc-1', title: 'test card 1', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie' },
            { id: 'e2e-rc-2', title: 'test card 2', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie' },
            { id: 'e2e-rc-3', title: 'test card 3', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-admin' }
        ];
        mockExps = [
            { id: 'e2e-e-1', status: [{status: 'active'}], user: 'not-e2e-user', org: 'o-admin' },
            { id: 'e2e-e-2', status: [{status: 'active'}], user: 'not-e2e-user', org: 'o-selfie' }
        ];
        mockman = new testUtils.Mockman();

        q.all([
            testUtils.resetCollection('cards', mockCards),
            testUtils.resetCollection('experiences', mockExps),
            mockman.start()
        ]).done(function(results) { done(); });
    });

    describe('GET /api/campaigns/:id', function() {
        beforeEach(function(done) {
            var mockCamps = [
                { id: 'e2e-getid1', name: 'camp 1', status: 'active', user: 'not-e2e-user', org: 'o-selfie' },
                { id: 'e2e-getid2', name: 'camp 2', status: 'deleted', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-getid3', name: 'camp 2', status: 'active', user: 'not-e2e-user', org: 'o-admin' },
                { id: 'e2e-getCards', name: 'camp w/ cards', status: 'active', user: 'e2e-user', org: 'o-selfie', cards: [{ id: 'e2e-rc-1' }, { id: 'e2e-rc-2' }] }
            ];
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });

        it('should get a campaign by id', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getid1', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-getid1', name: 'camp 1', status: 'active',
                    user: 'not-e2e-user', org: 'o-selfie' });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getid1', jar: selfieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should decorate a campaign with cards if defined', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getCards', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getCards',
                    name: 'camp w/ cards',
                    status: 'active',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    cards: [
                        {id: 'e2e-rc-1', title: 'test card 1', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie'},
                        {id: 'e2e-rc-2', title: 'test card 2', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie'}
                    ]
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            var options = {
                url: config.adsUrl + '/campaigns/e2e-getid1',
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
            var options = {url: config.adsUrl + '/campaigns/e2e-getid2', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show campaigns the user does not have permission to see', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getid3', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/campaigns/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getid5678', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get a campaign', function(done) {
            var options = {url: config.adsUrl + '/campaigns/e2e-getid1' };
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-getid1', name: 'camp 1', status: 'active',
                    user: 'not-e2e-user', org: 'o-selfie' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var options = { url: config.adsUrl + '/campaigns/e2e-getid1' };
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
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
                    cards: [{ id: 'e2e-rc-1' }],
                    status: 'active',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    application: 'studio'
                },
                {
                    id: 'e2e-getquery2',
                    name: 'camp 2 is great',
                    advertiserDisplayName: 'Heinz Ketchup',
                    cards: [{ id: 'e2e-rc-2' }],
                    rejectionReason: 'you got a problem crosby',
                    status: 'inactive',
                    user: 'not-e2e-user',
                    org: 'o-selfie',
                    application: 'studio'
                },
                {
                    id: 'e2e-getquery3',
                    name: 'camp 3',
                    advertiserDisplayName: 'Heinz is great',
                    status: 'active',
                    updateRequest: 'ur-1',
                    user: 'e2e-user',
                    org: 'o-admin',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getquery4',
                    name: 'camp 4 is great',
                    status: 'active',
                    user: 'not-e2e-user',
                    org: 'o-other',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getquery5',
                    name: 'camp 5 is great',
                    advertiserDisplayName: 'Hunts',
                    status: 'active',
                    updateRequest: 'ur-2',
                    user: 'not-e2e-user',
                    org: 'o-selfie',
                    application: 'selfie'
                },
                {
                    id: 'e2e-getgone',
                    name: 'camp deleted',
                    status: 'deleted',
                    user: 'e2e-user',
                    org: 'o-selfie'
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
                
                expect(resp.body[0].cards).toEqual([
                    { id: 'e2e-rc-1', title: 'test card 1', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie' },
                ]);
                expect(resp.body[1].cards).toEqual([
                    { id: 'e2e-rc-2', title: 'test card 2', campaign: {}, status: 'active', user: 'not-e2e-user', org: 'o-selfie' },
                ]);
                expect(resp.body[2].cards).not.toBeDefined();
                expect(resp.body[3].cards).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', { service: 'ads' }, {$natural: -1}, 1, 0, {db: 'c6Journal'});
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

        it('should get campaigns with a rejection reason', function(done) {
            options.qs.hasRejection = 'true';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
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
            options.qs.org = 'o-selfie';
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
        
        it('should get campaigns by org exclusion list', function(done) {
            options.jar = adminJar;
            options.qs.excludeOrgs = 'o-selfie,o-admin';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery4');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should use the org query param over the excludeOrgs param', function(done) {
            options.jar = adminJar;
            options.qs.org = 'o-admin';
            options.qs.excludeOrgs = 'o-selfie,o-admin';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
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

        it('should allow an app to get campaigns', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
                expect(resp.body[3].id).toBe('e2e-getquery4');
                expect(resp.body[4].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-5/5');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/campaign', function() {
        var start = new Date(new Date().valueOf() + 2*60*60*1000),
            end = new Date(new Date().valueOf() + 3*60*60*1000),
            options;
        beforeEach(function() {
            options = {
                url: config.adsUrl + '/campaigns',
                jar: adminJar,
                json: {
                    name: 'my test campaign',
                    targeting: {
                        interests: ['cat-1', 'cat-2']
                    },
                    advertiserId: 'e2e-a-1',
                    miniReels: [{ id: 'e2e-e-1' }],
                    cards: [
                        { id: 'e2e-rc-1', campaign:  { startDate: start.toISOString(), reportingId: 'report me' } },
                        { title: 'my new card', campaign: { startDate: start.toISOString(), endDate: end.toISOString() } }
                    ],
                    staticCardMap: { 'e2e-fake': { 'rc-pl1': 'e2e-rc-1' } }
                }
            };
        });

        it('should be able to create a campaign, creating/updating cards as necessary', function(done) {
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.user).toBe('admin-e2e-user');
                expect(resp.body.org).toBe('o-admin');
                expect(resp.body.status).toBe('draft');
                expect(resp.body.statusHistory).toEqual([
                    { status: 'draft', userId: 'admin-e2e-user', user: 'c6e2etester@gmail.com', date: jasmine.any(String) }
                ]);
                expect(resp.body.name).toBe('my test campaign');
                expect(resp.body.targeting).toEqual({ interests: ['cat-1', 'cat-2'] });
                expect(resp.body.miniReels).toEqual([{ id: 'e2e-e-1' }]);
                expect(resp.body.staticCardMap).toEqual({'e2e-fake':{'rc-pl1': 'e2e-rc-1'}});
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);

                expect(resp.body.cards.length).toBe(2);
                expect(resp.body.cards[0].id).toEqual('e2e-rc-1');
                expect(resp.body.cards[0].title).toEqual('test card 1');
                expect(resp.body.cards[0].campaign.reportingId).toEqual('report me');
                expect(resp.body.cards[0].campaign.startDate).toEqual(start.toISOString());
                expect(resp.body.cards[0].campaign.endDate).not.toBeDefined();
                expect(resp.body.cards[0].status).toEqual('active');
                expect(resp.body.cards[0].user).toEqual('not-e2e-user');
                expect(resp.body.cards[0].org).toEqual('o-selfie');

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('my new card');
                expect(resp.body.cards[1].campaign.reportingId).toEqual('my test campaign');
                expect(resp.body.cards[1].campaign.startDate).toEqual(start.toISOString());
                expect(resp.body.cards[1].campaign.endDate).toEqual(end.toISOString());
                expect(resp.body.cards[1].status).toEqual('active');
                expect(resp.body.cards[1].user).toEqual('admin-e2e-user');
                expect(resp.body.cards[1].org).toEqual('o-admin');

                return testUtils.checkCardEntities(resp.body, adminJar, config.contentUrl);

            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a campaign with multiple new sponsored cards', function(done) {
            delete options.json.miniReels;
            options.json.name = 'multi cards';
            options.json.cards = [{ title: 'dogs are cool' }, { title: 'and so are cats' }];
            var newCamp;
            
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('multi cards');

                expect(resp.body.cards.length).toBe(2);
                expect(resp.body.cards[0].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[0].campaign.startDate).not.toBeDefined();
                expect(resp.body.cards[0].campaign.endDate).not.toBeDefined();
                expect(resp.body.cards[0].status).toEqual('active');

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('and so are cats');
                expect(resp.body.cards[1].campaign.startDate).not.toBeDefined();
                expect(resp.body.cards[1].campaign.endDate).not.toBeDefined();
                expect(resp.body.cards[1].status).toEqual('active');
                
                newCamp = resp.body;
                return testUtils.checkCardEntities(newCamp, adminJar, config.contentUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            options.json = { name: 'empty camp', advertiserId: 'e2e-a-1' };
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
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
                expect(results[0].data).toEqual({route: 'POST /api/campaigns/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should initialize pricingHistory when creating a campaign with pricing', function(done) {
            options.json = {
                name: 'withPricing',
                advertiserId: 'e2e-a-1',
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
                    user: 'c6e2etester@gmail.com',
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

        it('should return a 400 if no advertiserId is provided', function(done) {
            delete options.json.advertiserId;
            requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: advertiserId');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if any of the lists are not distinct', function(done) {
            q.all([
                { cards: [{id: 'e2e-rc-1'}, {id: 'e2e-rc-1'}] },
                { miniReels: [{id: 'e2e-e-1'}, {id: 'e2e-e-1'}] }
            ].map(function(obj) {
                obj.advertiserId = 'e2e-a-1';
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
        
        it('should return a 400 if dates are invalid', function(done) {
            var mockCamps = [{}, {}, {}, {}].map(function() { return JSON.parse(JSON.stringify(options.json)); });
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
                options = {
                    url: config.adsUrl + '/campaigns',
                    jar: selfieJar,
                    json: {
                        name: 'Always On Dollars',
                        advertiserId: 'e2e-a-1',
                        cards: [{ title: 'dolla dolla billz' }],
                        targeting: {
                            interests: []
                        }
                    }
                };
            });
            
            it('should allow creating campaigns with one sponsored card', function(done) {
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.user).toEqual('e2e-user');
                    expect(resp.body.org).toEqual('o-selfie');
                    expect(resp.body.advertiserId).toEqual('e2e-a-1');
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
                    expect(resp.body.cards[0].campaign.reportingId).toEqual('Always On Dollars');
                    expect(resp.body.cards[0].campaign.startDate).not.toBeDefined();
                    expect(resp.body.cards[0].campaign.endDate).not.toBeDefined();
                    expect(resp.body.cards[0].campaign.minViewTime).toBe(3);
                    expect(resp.body.cards[0].status).toEqual('active');
                    expect(resp.body.cards[0].user).toEqual('e2e-user');
                    expect(resp.body.cards[0].org).toEqual('o-selfie');

                    return testUtils.checkCardEntities(resp.body, selfieJar, config.contentUrl);

                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to create a campaign with some pricing opts', function(done) {
                options.json = {
                    name: 'withPricing',
                    advertiserId: 'e2e-a-1',
                    pricing: {
                        budget: 2000,
                        dailyLimit: 500,
                        model: 'never charge me',   // should get overriden
                        cost: 0.0000000001          // should get overriden
                    }
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toBeDefined();
                    expect(resp.body.pricing).toEqual({
                        budget: 2000,
                        dailyLimit: 500,
                        model: 'cpv',
                        cost: 0.05
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
            
            it('should increase the cost appropriately for additional targeting', function(done) {
                options.json = {
                    name: 'pricing & targeting',
                    advertiserId: 'e2e-a-1',
                    pricing: { budget: 2000, dailyLimit: 500 },
                    targeting: {
                        geo: {
                            states: ['new jersey'],
                            dmas: ['new york', 'chicago'],
                            zipcodes: { radius: 40, codes: ['08540'] }
                        },
                        demographics: {
                            age: ['18-24'],
                            gender: ['male'],
                            income: ['1000', '2000']
                        },
                        interests: ['cat-1', 'cat-2']
                    }
                };
                requestUtils.qRequest('post', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.id).toBeDefined();
                    expect(resp.body.pricing).toEqual({
                        budget: 2000,
                        dailyLimit: 500,
                        model: 'cpv',
                        cost: 0.08
                    });
                    expect(resp.body.targeting).toEqual(options.json.targeting);
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
                    options.json = { pricing: pricing, advertiserId: 'e2e-a-1' };
                    return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toMatch(/pricing\.budget must be less than the max: \d+/);
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toMatch(/pricing\.budget must be greater than the min: \d+/);
                    expect(results[2].response.statusCode).toBe(400);
                    expect(results[2].body).toMatch(/dailyLimit must be between \d+\.?\d* and \d+\.?\d* of budget/);
                    expect(results[3].response.statusCode).toBe(400);
                    expect(results[3].body).toMatch(/dailyLimit must be between \d+\.?\d* and \d+\.?\d* of budget/);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should return a 400 if the user sends up invalid zipcode radius targeting', function(done) {
                q.all([
                    { radius: 9999999999999999999999 },
                    { radius: -1234 },
                    { codes: new Array(1000).join(',').split(',').map(function() { return 'a'; }) },
                    { codes: ['66666'] },
                    { codes: ['yo mommas house'] }
                ].map(function(zipcodeTarg) {
                    options.json = {
                        targeting: { geo: { zipcodes: zipcodeTarg } },
                        advertiserId: 'e2e-a-1'
                    };
                    return requestUtils.qRequest('post', options, null, { maxAttempts: 30 });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toMatch(/targeting.geo.zipcodes.radius must be less than the max: \d+/);
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toMatch(/targeting.geo.zipcodes.radius must be greater than the min: \d+/);
                    expect(results[2].response.statusCode).toBe(400);
                    expect(results[2].body).toMatch(/targeting.geo.zipcodes.codes must have at most \d+ entries/);
                    expect(results[3].response.statusCode).toBe(400);
                    expect(results[3].body).toBe('These zipcodes were not found: [66666]');
                    expect(results[4].response.statusCode).toBe(400);
                    expect(results[4].body).toBe('These zipcodes were not found: [yo mommas house]');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to create a campaign with other targeting options', function(done) {
                options.json = {
                    name: 'withTargeting',
                    advertiserId: 'e2e-a-1',
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
                    cards: [{ id: 'e2e-rc-selfie1' }, { id: 'e2e-rc-1' }],
                    advertiserId: 'e2e-a-1'
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
                    advertiserId: 'e2e-a-1',
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
                        org: 'o-selfie',
                        advertiserId: 'e2e-a-1',
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

        it('should allow an app to create a campaign', function(done) {
            delete options.jar;
            options.json = { name: 'empty camp', advertiserId: 'e2e-a-1' };
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.status).toBe('draft');
                expect(resp.body.statusHistory).toEqual([
                    { status: 'draft', appId: 'app-e2e-campaigns', appKey: 'e2e-campaigns', date: jasmine.any(String) }
                ]);
                expect(resp.body.name).toBe('empty camp');
                expect(resp.body.advertiserId).toBe('e2e-a-1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/campaigns/:id', function() {
        var mockCamps, options, origPricing, oldDate, adminCreatedCamp, selfieCreatedCamp;
        beforeEach(function(done) {
            oldDate = new Date(new Date().valueOf() - 5000);
            origPricing = {
                budget: 1000,
                dailyLimit: 400,
                model: 'cpv',
                cost: 0.1
            };
            mockCamps = [
                { id: 'e2e-put1', status: 'active', name: 'fake camp', user: 'e2e-user', org: 'o-selfie', advertiserId: 'e2e-a-1' },
                { id: 'e2e-put2', status: 'active', name: 'fake camp 2', user: 'admin-e2e-user', org: 'o-admin', advertiserId: 'e2e-a-1' },
                { id: 'e2e-update', status: 'active', updateRequest: 'e2e-ur-1', user: 'e2e-user', org: 'o-selfie', advertiserId: 'e2e-a-1' },
                { id: 'e2e-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie', advertiserId: 'e2e-a-1' },
                {
                    id: 'e2e-withPricing',
                    name: 'withPricing',
                    status: 'active',
                    advertiserId: 'e2e-a-1',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    pricing: origPricing,
                    pricingHistory: [{
                        date: oldDate,
                        userId: 'u-otheruser',
                        user: 'otheruser@c6.com',
                        pricing: origPricing
                    }]
                }
            ];
            options = {
                url: config.adsUrl + '/campaigns/e2e-put1',
                json: {},
                jar: adminJar
            };

            var promise;
            if (selfieCreatedCamp && adminCreatedCamp) {
                promise = q();
            } else {
                promise = q.all([
                    requestUtils.qRequest('post', {
                        url: config.adsUrl + '/campaigns/',
                        jar: adminJar,
                        json: {
                            name: 'admin created campaign',
                            advertiserId: 'e2e-a-1',
                            cards: [{ title: 'admin card 1' }, { title: 'admin card 2' }],
                            miniReels: [{ id: 'e2e-e-1' }]
                        }
                    }),
                    requestUtils.qRequest('post', {
                        url: config.adsUrl + '/campaigns/',
                        jar: selfieJar,
                        json: {
                            name: 'selfie created campaign',
                            advertiserId: 'e2e-a-1',
                            cards: [{ title: 'selfie card 1' }]
                        }
                    }),
                ]).spread(function(adminResp, selfieResp) {
                    if (adminResp.response.statusCode !== 201) {
                        return q.reject({ code: adminResp.response.statusCode, body: adminResp.body });
                    }
                    if (selfieResp.response.statusCode !== 201) {
                        return q.reject({ code: selfieResp.response.statusCode, body: selfieResp.body });
                    }
                    adminCreatedCamp = adminResp.body;
                    selfieCreatedCamp = selfieResp.body;
                });
            }
            
            promise.then(function() {
                return testUtils.mongoFind(
                    'campaigns',
                    { id: { $in: [adminCreatedCamp.id, selfieCreatedCamp.id] } }
                ).then(function(results) {
                    mockCamps = mockCamps.concat(results);
                    return testUtils.resetCollection('campaigns', mockCamps);
                }).done(done);
            });
        });
        
        it('should successfully update a campaign in our database', function(done) {
            options.json = { name: 'updated fake camp' };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.name).toBe('updated fake camp');
                expect(resp.body.pricing).not.toBeDefined();
                expect(resp.body.pricingHistory).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            options.json = { name: 'updated fake camp' };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
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
                expect(results[0].data).toEqual({route: 'PUT /api/campaigns/:id',
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
            options.url = config.adsUrl + '/campaigns/e2e-withPricing';
            options.json = { pricing: newPricing };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('withPricing');
                expect(resp.body.pricing).toEqual(newPricing);
                expect(resp.body.pricingHistory).toEqual([
                    {
                        date: jasmine.any(String),
                        userId: 'admin-e2e-user',
                        user: 'c6e2etester@gmail.com',
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
            options.url = config.adsUrl + '/campaigns/e2e-withPricing';
            options.json = {
                name: 'withPricing-updated',
                pricing: {
                    budget: 1000,
                    dailyLimit: 400,
                    model: 'cpv',
                    cost: 0.1
                }
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
            options.url = config.adsUrl + '/campaigns/e2e-put1';
            options.json = { pricing: newPricing };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('fake camp');
                expect(resp.body.pricing).toEqual(newPricing);
                expect(resp.body.pricingHistory).toEqual([{
                    date: jasmine.any(String),
                    userId: 'admin-e2e-user',
                    user: 'c6e2etester@gmail.com',
                    pricing: newPricing
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit properties on cards', function(done) {
            adminCreatedCamp.cards[0].title = 'Grand Magister';
            adminCreatedCamp.cards[1].data.skip = true;
            adminCreatedCamp.cards[1].campaign.minViewTime = 55;
            options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
            options.json = { cards: adminCreatedCamp.cards };
            
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.cards[0].title).toBe('Grand Magister');
                expect(resp.body.cards[0].campaign).toEqual(adminCreatedCamp.cards[0].campaign);
                expect(resp.body.cards[0].data).toEqual(adminCreatedCamp.cards[0].data);

                expect(resp.body.cards[1].title).toBe('admin card 2');
                expect(resp.body.cards[1].campaign).toEqual({ minViewTime: 55, reportingId: 'admin created campaign' });
                expect(resp.body.cards[1].data).toEqual(jasmine.objectContaining({ skip: true }));

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should set the startDate on cards if first starting the campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
            options.json = { status: 'pending' };
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('pending');
                
                options.json.status = 'active';
                return requestUtils.qRequest('put', options, null, { maxAttempts: 30 });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
                
                expect(new Date(resp.body.cards[0].campaign.startDate).toString()).not.toBe('Invalid Date');
                expect(resp.body.cards[1].campaign.startDate).toEqual(resp.body.cards[0].campaign.startDate);

                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if ending the campaign', function() {
            var mailman;
            beforeEach(function(done) {
                options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
                options.json = { status: 'expired' };
                
                function ensureMailman() {
                    if (mailman && mailman.state === 'authenticated') {
                        mailman.on('error', function(error) { throw new Error(error); });
                        return q();
                    }
                    
                    mailman = new testUtils.Mailman();
                    return mailman.start().then(function() {
                        mailman.on('error', function(error) { throw new Error(error); });
                    });
                }

                ensureMailman().then(function() {
                    adminCreatedCamp.status = 'active';
                    adminCreatedCamp.cards[0].campaign.endDate = undefined;
                    adminCreatedCamp.cards[1].campaign.endDate = undefined;
                    return requestUtils.qRequest('put', {
                        url: options.url,
                        json: {
                            status: adminCreatedCamp.status,
                            cards: adminCreatedCamp.cards
                        },
                        jar: options.jar
                    });
                }).done(function() { done(); });
            });

            afterEach(function() {
                mailman.removeAllListeners();
            });
        
            it('should set the endDate on cards and email the owner', function(done) {
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('expired');

                    expect(resp.body.cards[0].campaign.endDate).toBeDefined();
                    expect(new Date(resp.body.cards[0].campaign.endDate).toString()).not.toBe('Invalid Date');
                    expect(resp.body.cards[1].campaign.endDate).toEqual(resp.body.cards[0].campaign.endDate);
                    
                    adminCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                });
                
                mailman.once('Your Campaign Has Ended', function(msg) {
                    expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
                    expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');

                    var regex = new RegExp('Your\\s*campaign.*' + adminCreatedCamp.name + '.*\\s*reached\\s*its\\s*end\\s*date');
                    expect(msg.html).toMatch(regex);
                    expect(msg.text).toMatch(regex);
                    expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                    done();
                });
            });
            
            it('should send a different message but not set endDates if the campaign is outOfBudget', function(done) {
                options.json.status = 'outOfBudget';
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('outOfBudget');

                    expect(resp.body.cards[0].campaign.endDate).not.toBeDefined();
                    expect(resp.body.cards[1].campaign.endDate).not.toBeDefined();
                    
                    adminCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                });
                
                mailman.once('Your Campaign is Out of Budget', function(msg) {
                    expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
                    expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
                    
                    var regex = new RegExp('Your\\s*campaign.*' + adminCreatedCamp.name + '.*is\\s*out\\s*of\\s*budget');
                    expect(msg.html).toMatch(regex);
                    expect(msg.text).toMatch(regex);
                    expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
                    done();
                });
            });
            
            it('should set endDates but not send a message if the campaign is canceled', function(done) {
                mailman.once('Your Campaign is Out of Budget', function(msg) { expect(msg).not.toBeDefined(); });
                mailman.once('Your Campaign has Ended', function(msg) { expect(msg).not.toBeDefined(); });

                options.json.status = 'canceled';
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('canceled');

                    expect(resp.body.cards[0].campaign.endDate).toBeDefined();
                    expect(new Date(resp.body.cards[0].campaign.endDate).toString()).not.toBe('Invalid Date');
                    expect(resp.body.cards[1].campaign.endDate).toEqual(resp.body.cards[0].campaign.endDate);
                    
                    adminCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to produce a campaignStateChange event', function(done) {
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    adminCreatedCamp = resp.body;
                    return q.Promise(function(resolve) {
                        mockman.on('campaignStateChange', function(record) {
                            if(record.data.campaign.lastUpdated === resp.body.lastUpdated) {
                                resolve(record);
                            }
                        });
                    });
                }).then(function(record) {
                    expect(record.data.previousState).toBe('active');
                    expect(record.data.currentState).toBe('expired');
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toEqual(adminCreatedCamp);
                    return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
                }).then(done, done.fail);
            });
        });
        
        it('should be able to add+remove sponsored cards', function(done) {
            var cardToDelete = adminCreatedCamp.cards[0].id;
            options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
            options.json = { staticCardMap: { 'e2e-fake': { 'rc-pl1': cardToDelete } } };

            // initialize staticCardMap so we can test auto-updating it when cards removed
            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.staticCardMap).toEqual({ 'e2e-fake': { 'rc-pl1': adminCreatedCamp.cards[0].id } });
                
                options.json = { cards: [{ id: adminCreatedCamp.cards[1].id }, { title: 'card numba 3' }] };
                return requestUtils.qRequest('put', options, null, { maxAttempts: 30 });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.created).toBe(adminCreatedCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(adminCreatedCamp.lastUpdated));
                expect(resp.body.cards[0].campaign).toEqual(adminCreatedCamp.cards[1].campaign);

                expect(resp.body.cards[1].id).toEqual(jasmine.any(String));
                expect(resp.body.cards[1].title).toEqual('card numba 3');
                expect(resp.body.cards[1].campaign.reportingId).toEqual(resp.body.name);
                expect(resp.body.cards[1].campaign.startDate).not.toBeDefined();
                expect(resp.body.cards[1].campaign.endDate).not.toBeDefined();
                expect(resp.body.cards[1].status).toEqual('active');
                expect(resp.body.cards[1].user).toEqual('admin-e2e-user');
                expect(resp.body.cards[1].org).toEqual('o-admin');

                expect(resp.body.staticCardMap).toEqual({ 'e2e-fake': {} });
                adminCreatedCamp = resp.body;
                return testUtils.checkCardEntities(adminCreatedCamp, adminJar, config.contentUrl);
            }).then(function() {
                return testUtils.mongoFind('cards', { id: cardToDelete });
            }).then(function(results) {
                expect(results[0].status).toBe('deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to add + remove sponsored miniReels', function(done) {
            options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
            options.json = { miniReels: [{ id: 'e2e-e-2' }] };

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
        
        it('should not edit a campaign that has an updateRequest', function(done) {
            options.url = config.adsUrl + '/campaigns/e2e-update';
            options.json = { name: 'sneaky edit' };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Campaign locked until existing update request resolved');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a campaign that has been deleted', function(done) {
            options.url = config.adsUrl + '/campaigns/e2e-deleted';
            options.json = { name: 'resurrected' };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a campaign if they do not exist', function(done) {
            options.url = config.adsUrl + '/campaigns/e2e-putfake';
            options.json = { name: 'the best thing' };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if any of the lists are not distinct', function(done) {
            q.all([
                { cards: [{ id: 'e2e-rc-1' }, { id: 'e2e-rc-1' }] },
                { miniReels: [{ id: 'e2e-e-1' }, { id: 'e2e-e-1' }] }
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

        it('should return a 400 if dates are invalid', function(done) {
            var cards = JSON.parse(JSON.stringify(adminCreatedCamp.cards));
            cards[0].campaign.startDate = 'foo';
            options.url = config.adsUrl + '/campaigns/' + adminCreatedCamp.id;
            options.json = { cards: cards };

            requestUtils.qRequest('put', options, null, { maxAttempts: 30 })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('cards[0] has invalid dates');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 error if the user is not authenticated', function(done) {
            options.json = { name: 'mine now' };
            delete options.jar;
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
                    url: config.adsUrl + '/campaigns/' + selfieCreatedCamp.id,
                    json: {},
                    jar: selfieJar
                };
            });

            it('should be able to edit the sponsored card', function(done) {
                selfieCreatedCamp.cards[0].title = 'Funkmaster General';
                options.json = { cards: selfieCreatedCamp.cards };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.cards[0].title).toBe('Funkmaster General');

                    selfieCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(selfieCreatedCamp, selfieJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to intialize dates on the card', function(done) {
                var start = new Date(Date.now() + 4*60*60*1000).toISOString(),
                    end = new Date(Date.now() + 8*60*60*1000).toISOString();
                selfieCreatedCamp.cards[0].campaign.startDate = start;
                selfieCreatedCamp.cards[0].campaign.endDate = end;
                options.json = { cards: selfieCreatedCamp.cards };

                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.cards[0].campaign.startDate).toEqual(start);
                    expect(resp.body.cards[0].campaign.endDate).toEqual(end);

                    selfieCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(selfieCreatedCamp, selfieJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to unset dates on the card', function(done) {
                delete selfieCreatedCamp.cards[0].campaign.startDate;
                delete selfieCreatedCamp.cards[0].campaign.endDate;
                options.json = { cards: selfieCreatedCamp.cards };

                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.cards[0].startDate).not.toBeDefined();
                    expect(resp.body.cards[0].endDate).not.toBeDefined();

                    selfieCreatedCamp = resp.body;
                    return testUtils.checkCardEntities(selfieCreatedCamp, selfieJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should be able to initialize and edit pricing', function(done) {
                options.json = { pricing: {
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpcctv',
                    cost: 0.0000001
                } };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.pricing).toEqual({
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.05
                    });
                    expect(resp.body.pricingHistory).toEqual([{
                        userId: 'e2e-user',
                        user: 'selfieuser',
                        date: jasmine.any(String),
                        pricing: resp.body.pricing
                    }]);

                    options.json.pricing = { budget: 4000 };
                    
                    return requestUtils.qRequest('put', options, null, { maxAttempts: 30 });
                }).then(function(resp) {
                    expect(resp.body.pricing).toEqual({
                        budget: 4000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.05
                    });
                    expect(resp.body.pricingHistory).toEqual([{
                        userId: 'e2e-user',
                        user: 'selfieuser',
                        date: jasmine.any(String),
                        pricing: resp.body.pricing
                    }]);

                    selfieCreatedCamp = resp.body;
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
                    expect(resp.body.pricing).toEqual({
                        budget: 4000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.07
                    });
                    expect(resp.body.pricingHistory).toEqual([{
                        userId: 'e2e-user',
                        user: 'selfieuser',
                        date: jasmine.any(String),
                        pricing: resp.body.pricing
                    }]);
                    
                    selfieCreatedCamp = resp.body;
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(function(results) { done(); });
            });
            
            it('should trim off other forbidden fields', function(done) {
                options.json = {
                    application: 'proshop',
                    staticCardMap: { 'e2e-fake': { 'rc-pl1': 'e2e-rc-1' } },
                    miniReels: [{ id: 'e-1' }]
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
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
                    url: config.adsUrl + '/campaigns/e2e-put2',
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
            
            it('should not edit a campaign not in draft mode', function(done) {
                options = {
                    url: config.adsUrl + '/campaigns/e2e-put1',
                    json: { name: 'mine now' },
                    jar: selfieJar
                };
                requestUtils.qRequest('put', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Action not permitted on active campaign');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should allow an app to edit a campaign', function(done) {
            delete options.jar;
            options.json = { name: 'updated fake camp' };

            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('updated fake camp');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/campaigns/:id', function() {
        beforeEach(function(done) {
            var mockCamps = [
                {
                    id: 'e2e-withContent',
                    status: 'active',
                    user: 'admin-e2e-user',
                    org: 'o-admin',
                    cards: [{ id: 'e2e-rc-1' }, { id: 'e2e-rc-2' }],
                    miniReels: [{ id: 'e2e-e-1' }, { id: 'e2e-e-2' }]
                },
                {
                    id: 'e2e-selfieContent',
                    status: 'draft',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    cards: [{ id: 'e2e-rc-1' }]
                },
                { id: 'e2e-del2', status: 'active', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-active', status: 'active', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-paused', status: 'paused', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-error', status: 'error', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-pending', status: 'pending', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-canceled', status: 'canceled', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-expired', status: 'expired', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-completed', status: 'completed', user: 'e2e-user', org: 'o-selfie' },
                { id: 'e2e-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie' }
            ];
            
            q.all([
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('experiences', mockExps)
            ]).done(function(results) { done(); });
        });

        it('should delete campaigns and all their content', function(done) {
            var options = { jar: adminJar, url: config.adsUrl + '/campaigns/e2e-withContent' };
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                return q.all([
                    config.adsUrl + '/campaigns/e2e-withContent',
                    config.contentUrl + '/cards?ids=e2e-rc-1,e2e-rc-2',
                    config.contentUrl + '/experiences?ids=e2e-e-1,e2e-e-2',
                ].map(function(url) {
                    return requestUtils.qRequest('get', { url: url, jar: adminJar });
                }));
            }).spread(function(campResp, cardResp, expResp) {
                expect(campResp.response.statusCode).toBe(404);
                expect(campResp.body).toBe('Object not found');
                expect(cardResp.response.statusCode).toBe(200);
                expect(cardResp.body).toEqual([]);
                expect(expResp.response.statusCode).toBe(200);
                expect(expResp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write to the audit collection', function(done) {
            var options = { jar: adminJar, url: config.adsUrl + '/campaigns/e2e-del2' };
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
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
                expect(results[0].data).toEqual({route: 'DELETE /api/campaigns/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign has been deleted', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaigns/e2e-del1'};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign does not exist', function(done) {
            var options = {jar: adminJar, url: config.adsUrl + '/campaigns/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/campaigns/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('for selfie users', function() {
            it('should allow a user to delete campaigns they own', function(done) {
                var options = { jar: selfieJar, url: config.adsUrl + '/campaigns/e2e-selfieContent' };
                requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    
                    return q.all([
                        config.adsUrl + '/campaigns/e2e-selfieContent',
                        config.contentUrl + '/cards/e2e-rc-1'
                    ].map(function(url) {
                        return requestUtils.qRequest('get', { url: url, jar: adminJar });
                    }));
                }).spread(function(campResp, cardResp) {
                    expect(campResp.response.statusCode).toBe(404);
                    expect(campResp.body).toBe('Object not found');
                    expect(cardResp.response.statusCode).toBe(404);
                    expect(cardResp.body).toBe('Object not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should not allow a user to delete campaigns they do not own', function(done) {
                var options = {jar: selfieJar, url: config.adsUrl + '/campaigns/e2e-withContent'};
                requestUtils.qRequest('delete', options, null, { maxAttempts: 30 }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('Not authorized to delete this');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should not allow a user to delete a running campaign', function(done) {
                q.all(['e2e-active', 'e2e-paused', 'e2e-error'].map(function(id) {
                    return requestUtils.qRequest('delete', { url: config.adsUrl + '/campaigns/' + id, jar: selfieJar });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('Action not permitted on active campaign');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('Action not permitted on paused campaign');
                    expect(results[2].response.statusCode).toBe(400);
                    expect(results[2].body).toBe('Action not permitted on error campaign');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should allow a user to delete pending, canceled, expired, or completed campaigns', function(done) {
                q.all(['e2e-pending', 'e2e-canceled', 'e2e-expired', 'e2e-completed'].map(function(id) {
                    return requestUtils.qRequest('delete', { url: config.adsUrl + '/campaigns/' + id, jar: selfieJar });
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(204);
                    expect(results[1].response.statusCode).toBe(204);
                    expect(results[2].response.statusCode).toBe(204);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should allow an app to delete a campaign', function(done) {
            requestUtils.makeSignedRequest(appCreds, 'delete', { url: config.adsUrl + '/campaigns/e2e-del2' })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/campaigns/schema', function() {
        var selfieOpts, adminOpts, campModule;
        beforeEach(function() {
            selfieOpts = { url: config.adsUrl + '/campaigns/schema', qs: {}, jar: selfieJar };
            adminOpts = { url: config.adsUrl + '/campaigns/schema', qs: {}, jar: adminJar };
            campModule = require('../../bin/ads-campaigns');
        });

        it('should get the base campaign schema', function(done) {
            q.all([
                requestUtils.qRequest('get', selfieOpts),
                requestUtils.qRequest('get', adminOpts),
            ]).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual(jasmine.any(Object));
                    expect(resp.body.cards).toEqual(JSON.parse(JSON.stringify(campModule.campSchema.cards)));
                    expect(resp.body.pricing).toEqual(JSON.parse(JSON.stringify(campModule.campSchema.pricing)));
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to get a campaign schema customized to each user', function(done) {
            selfieOpts.qs.personalized = 'true';
            adminOpts.qs.personalized = 'true';
            q.all([
                requestUtils.qRequest('get', selfieOpts),
                requestUtils.qRequest('get', adminOpts),
            ]).spread(function(selfieResult, adminResult) {
                expect(selfieResult.response.statusCode).toBe(200);
                expect(adminResult.response.statusCode).toBe(200);
                
                expect(selfieResult.body.pricing).toEqual(JSON.parse(JSON.stringify(campModule.campSchema.pricing)));
                expect(selfieResult.body.application).toEqual({ __allowed: false, __type: 'string', __unchangeable: true, __default: 'selfie' });
                
                expect(adminResult.body.miniReels).toEqual({ __allowed: true, __type: 'objectArray' });
                expect(adminResult.body.staticCardMap).toEqual({ __allowed: true, __type: 'object' });
                expect(adminResult.body.pricing).toEqual({
                    budget: JSON.parse(JSON.stringify(campModule.campSchema.pricing.budget)),
                    dailyLimit: JSON.parse(JSON.stringify(campModule.campSchema.pricing.dailyLimit)),
                    model: { __allowed: true, __type: 'string', __default: 'cpv' },
                    cost: {
                        __allowed: true,
                        __type: 'number',
                        __base: campModule.campSchema.pricing.cost.__base,
                        __pricePerGeo: campModule.campSchema.pricing.cost.__pricePerGeo,
                        __pricePerDemo: campModule.campSchema.pricing.cost.__pricePerDemo,
                        __priceForGeoTargeting: campModule.campSchema.pricing.cost.__priceForGeoTargeting,
                        __priceForDemoTargeting: campModule.campSchema.pricing.cost.__priceForDemoTargeting,
                        __priceForInterests: campModule.campSchema.pricing.cost.__priceForInterests
                    }
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get its schema', function(done) {
            var options = {
                url: config.adsUrl + '/campaigns/schema',
                qs: { personalized: 'true' }
            };
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.miniReels).toEqual({ __allowed: true, __type: 'objectArray' });
                expect(resp.body.staticCardMap).toEqual({ __allowed: true, __type: 'object' });
                expect(resp.body.status).toEqual(jasmine.objectContaining({ __allowed: true }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    afterAll(function(done) {
        mockman.stop();
        testUtils.closeDbs().done(done);
    });
});
