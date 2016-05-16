var q               = require('q'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    BeeswaxClient   = require('../../lib/BeeswaxClient'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

var beeswax = new BeeswaxClient({
    creds: {
        email: 'ops@cinema6.com',
        password: '07743763902206f2b511bead2d2bf12292e2af82'
    }
});

var impressionRatio = 1.3333; // Update if this is changed in defaults/test env

describe('ads - Beeswax external campaigns endpoints (E2E):', function() {
    var cookieJar, nonAdminJar, mockApp, appCreds, createdAdvert, mockCamps;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
    });

    beforeAll(function(done) {
        cookieJar = request.jar();
        nonAdminJar = request.jar();
        var mockUser = {
            id: 'u-admin',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['manageAllCamps']
        };
        var nonAdmin = {
            id: 'u-selfie',
            status: 'active',
            email : 'nonadminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['manageOrgCamps']
        };
        var testPolicies = [
            {
                id: 'p-e2e-allCamps',
                name: 'manageAllCamps',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'all', create: 'all' },
                    orgs: { read: 'all' },
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-orgCamps',
                name: 'manageOrgCamps',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'org' },
                    orgs: { read: 'org' },
                    cards: { read: 'all', create: 'org', edit: 'org', delete: 'org' },
                    campaigns: { read: 'all', create: 'org', edit: 'org', delete: 'org' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-camps-beeswax',
            key: 'e2e-camps-beeswax',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                advertisers: { read: 'all', create: 'all' },
                orgs: { read: 'all' },
                cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            {url: config.authUrl + '/login', json: {email: mockUser.email, password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: nonAdmin.email, password: 'password'}, jar: nonAdminJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockUser, nonAdmin]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });
    
    // POST new advertiser that will have beeswax representation for testing
    beforeAll(function(done) {
        requestUtils.qRequest('post', {
            url: config.adsUrl + '/account/advertisers',
            json: { name: Date.now() + ' - campaigns.beeswax.e2e' },
            jar: cookieJar
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 201) {
                return q.reject('Failed creating test advert - ' + util.inspect({
                    code: resp.response.statusCode,
                    body: resp.body
                }));
            }
            createdAdvert = resp.body;
        })
        .then(done, done.fail);
    });
    
    // Init set of mockCamps to be used by all endpoints
    beforeEach(function() {
        mockCamps = [
            {
                id: 'cam-e2e-post-1',
                name: 'E2E - Post beeswax camp 1',
                user: 'u-selfie',
                org: 'o-selfie',
                advertiserId: createdAdvert.id,
                status: 'draft',
                pricing: {
                    budget: 1000,
                    dailyLimit: 100
                }
            },
            {
                id: 'cam-e2e-post-cards',
                name: 'E2E - Post beeswax camp w/ cards',
                user: 'u-selfie',
                org: 'o-selfie',
                advertiserId: createdAdvert.id,
                status: 'draft',
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-05-16T20:05:57.163Z' } },
                    { id: 'rc-2', campaign: {} },
                    { id: 'rc-3', campaign: { startDate: '2016-05-10T20:05:57.163Z' } }
                ],
                pricing: {
                    budget: 1000,
                    dailyLimit: 100
                }
            },
            {
                id: 'cam-e2e-no-dl',
                name: 'E2E - No dailyLimit',
                user: 'u-selfie',
                org: 'o-selfie',
                advertiserId: createdAdvert.id,
                status: 'draft',
                pricing: {
                    budget: 1000
                }
            },
            {
                id: 'cam-e2e-admin-1',
                name: 'E2E - Admin beeswax camp 1',
                user: 'u-admin',
                org: 'o-admin',
                advertiserId: createdAdvert.id,
                status: 'draft'
            }
        ];
    });
    
    // Check that `externalCampaigns.beeswax` is set to correct object
    function checkExternCampProp(campId, beesExternCamp) {
        return testUtils.mongoFind('campaigns', { id: campId }).spread(function(campaign) {
            expect(campaign.externalCampaigns).toEqual(jasmine.objectContaining({
                beeswax: beesExternCamp
            }));
        })
        .catch(function(error) {
            expect(util.inspect(error)).not.toBeDefined();
        });
    }
    

    describe('POST /api/campaigns/:id/external/beeswax', function() {
        var options, beesCampIds;
        beforeEach(function(done) {
            beesCampIds = [];
            options = {
                url: config.adsUrl + '/campaigns/cam-e2e-post-1/external/beeswax',
                json: {
                    budget: 600,
                    dailyLimit: 60
                },
                jar: cookieJar
            };
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });
        
        afterEach(function(done) {
            q.all(beesCampIds.map(function(id) {
                return beeswax.campaigns.delete(id);
            })).then(function(results) {
                done();
            }).catch(done.fail);
        });
        
        it('should create a campaign in Beeswax for a C6 campaign', function(done) {
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 600,
                    dailyLimit: 60
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-post-1', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload).toEqual(jasmine.objectContaining({
                    campaign_id     : beesId,
                    advertiser_id   : createdAdvert.beeswaxIds.advertiser,
                    alternative_id  : 'cam-e2e-post-1',
                    campaign_name   : 'E2E - Post beeswax camp 1',
                    start_date      : jasmine.any(String),
                    end_date        : null,
                    budget_type     : 1,
                    campaign_budget : jasmine.any(Number),
                    daily_budget    : jasmine.any(Number),
                    active          : false
                }));
                expect(resp.payload.campaign_budget).toEqual(Number((600 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toEqual(Number((60 * impressionRatio).toFixed(2)));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should cap the budget + dailyLimit to the campaign\'s totals', function(done) {
            options.json.budget = 99999999;
            options.json.dailyLimit = 99999999;
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 1000,
                    dailyLimit: 100
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-post-1', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload.campaign_budget).toEqual(Number((1000 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toEqual(Number((100 * impressionRatio).toFixed(2)));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should default the budget + dailyLimit if unset', function(done) {
            options.json = {};
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 1000,
                    dailyLimit: 100
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-post-1', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload.campaign_budget).toEqual(Number((1000 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toEqual(Number((100 * impressionRatio).toFixed(2)));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should set the start date if there are cards with dates', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-e2e-post-cards/external/beeswax';
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 600,
                    dailyLimit: 60
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-post-cards', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload).toEqual(jasmine.objectContaining({
                    campaign_id     : beesId,
                    alternative_id  : 'cam-e2e-post-cards',
                    campaign_name   : 'E2E - Post beeswax camp w/ cards',
                    start_date      : '2016-05-10 16:05:57',
                    end_date        : null,
                }));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow setting a null dailyLimit if the campaign has no dailyLimit', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-e2e-no-dl/external/beeswax';
            options.json = { budget: 600 };
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 600,
                    dailyLimit: null
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-no-dl', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload.campaign_budget).toEqual(Number((600 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toBe(null);
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle campaigns with no pricing config', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-e2e-admin-1/external/beeswax';
            var beesId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 1,
                    dailyLimit: 1
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-admin-1', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload.campaign_budget).toEqual(Number((1 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toEqual(Number((1 * impressionRatio).toFixed(2)));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign already has a Beeswax campaign', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 600,
                    dailyLimit: 60
                });
                beesCampIds.push(resp.body.externalId);
                
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Campaign already has beeswax campaign');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign does not exist', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-FLKWJEOI/external/beeswax';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot fetch this campaign');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        xit('should return a 403 if the user cannot edit the given campaign', function(done) {
            options.jar = nonAdminJar;
            //TODO: need to add middleware to check perms, move checkScope out of CrudSvc?
        });
        
        it('should return a 401 error if no one is authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to create a campaign', function(done) {
            delete options.jar;
            var beesId;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    externalId: jasmine.any(Number),
                    budget: 600,
                    dailyLimit: 60
                });
                beesId = resp.body.externalId;
                beesCampIds.push(beesId);
                return checkExternCampProp('cam-e2e-post-1', resp.body);
            }).then(function() {
                // check that campaign created in Beeswax successfully
                return beeswax.campaigns.find(beesId);
            }).then(function(resp) {
                expect(resp.success).toBe(true);
                expect(resp.payload).toEqual(jasmine.objectContaining({
                    campaign_id     : beesId,
                    advertiser_id   : createdAdvert.beeswaxIds.advertiser,
                    alternative_id  : 'cam-e2e-post-1',
                    campaign_name   : 'E2E - Post beeswax camp 1',
                    start_date      : jasmine.any(String),
                    end_date        : null,
                    budget_type     : 1,
                    campaign_budget : jasmine.any(Number),
                    daily_budget    : jasmine.any(Number),
                    active          : false
                }));
                expect(resp.payload.campaign_budget).toEqual(Number((600 * impressionRatio).toFixed(2)));
                expect(resp.payload.daily_budget).toEqual(Number((60 * impressionRatio).toFixed(2)));
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            delete options.jar;
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/campaigns/:id/external/beeswax', function() {
        var options, beesCampIds;
        beforeEach(function(done) {
            beesCampIds = [];
            options = {
                url: config.adsUrl + '/campaigns/cam-e2e-post-1/external/beeswax',
                json: {
                    budget: 500,
                    dailyLimit: 50
                },
                jar: cookieJar
            };
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });
        
        afterEach(function(done) {
            q.all(beesCampIds.map(function(id) {
                return beeswax.campaigns.delete(id);
            })).then(function(results) {
                done();
            }).catch(done.fail);
        });
        
        // Call this in each test spec for the campaign(s) to test with
        function createBeeswaxCampaign(id, body) {
            body = body || {};
            return requestUtils.qRequest('post', {
                url: config.adsUrl + '/campaigns/' + id + '/external/beeswax',
                json: body,
                jar: cookieJar
            })
            .then(function(resp) {
                if (resp.response.statusCode !== 201) {
                    return q.reject('Failed creating beeswax campaign - ' + util.inspect({
                        code: resp.response.statusCode,
                        body: resp.body
                    }));
                }
                beesCampIds.push(resp.body.externalId);
                return q(resp.body);
            });
        }
        
        it('should edit a campaign in Beeswax', function(done) {
            createBeeswaxCampaign('cam-e2e-post-1', { budget: 1000, dailyLimit: 100 })
            .then(function(beesExtCamp) {
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 500,
                        dailyLimit: 50
                    });
                    return checkExternCampProp('cam-e2e-post-1', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload).toEqual(jasmine.objectContaining({
                        campaign_id     : beesExtCamp.externalId,
                        advertiser_id   : createdAdvert.beeswaxIds.advertiser,
                        alternative_id  : 'cam-e2e-post-1',
                        campaign_name   : 'E2E - Post beeswax camp 1',
                        campaign_budget : jasmine.any(Number),
                        daily_budget    : jasmine.any(Number)
                    }));
                    expect(resp.payload.campaign_budget).toEqual(Number((500 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toEqual(Number((50 * impressionRatio).toFixed(2)));
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should cap the budget + dailyLimit to the campaign\'s totals', function(done) {
            options.json.budget = 99999999;
            options.json.dailyLimit = 99999999;

            createBeeswaxCampaign('cam-e2e-post-1', { budget: 600, dailyLimit: 60 })
            .then(function(beesExtCamp) {
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 1000,
                        dailyLimit: 100
                    });
                    return checkExternCampProp('cam-e2e-post-1', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload.campaign_budget).toEqual(Number((1000 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toEqual(Number((100 * impressionRatio).toFixed(2)));
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should preserve the budget + dailyLimit if unset', function(done) {
            options.json = {};
            createBeeswaxCampaign('cam-e2e-post-1', { budget: 600, dailyLimit: 60 })
            .then(function(beesExtCamp) {
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 600,
                        dailyLimit: 60
                    });
                    return checkExternCampProp('cam-e2e-post-1', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload.campaign_budget).toEqual(Number((600 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toEqual(Number((60 * impressionRatio).toFixed(2)));
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow setting a null dailyLimit if the campaign has no dailyLimit', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-e2e-no-dl/external/beeswax';
            options.json = { budget: 600, dailyLimit: null };

            createBeeswaxCampaign('cam-e2e-no-dl', { budget: 1000, dailyLimit: 100 })
            .then(function(beesExtCamp) {
                expect(beesExtCamp.dailyLimit).toBe(100);
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 600,
                        dailyLimit: null
                    });
                    return checkExternCampProp('cam-e2e-no-dl', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload.campaign_budget).toEqual(Number((600 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toBe(null);
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle campaigns with no pricing config', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-e2e-admin-1/external/beeswax';
            options.json = { budget: 1000, dailyLimit: 100 };

            createBeeswaxCampaign('cam-e2e-admin-1', {})
            .then(function(beesExtCamp) {
                expect(beesExtCamp.budget).toBe(1);
                expect(beesExtCamp.dailyLimit).toBe(null);
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 1,
                        dailyLimit: 1
                    });
                    return checkExternCampProp('cam-e2e-admin-1', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload.campaign_budget).toEqual(Number((1 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toEqual(Number((1 * impressionRatio).toFixed(2)));
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign has no Beeswax campaign', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Campaign has no beeswax campaign');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign does not exist', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-FLKWJEOI/external/beeswax';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot fetch this campaign');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        xit('should return a 403 if the user cannot edit the given campaign', function(done) {
            options.jar = nonAdminJar;
            //TODO: need to add middleware to check perms, move checkScope out of CrudSvc?
        });
        
        it('should return a 401 error if no one is authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to edit a campaign', function(done) {
            createBeeswaxCampaign('cam-e2e-post-1', { budget: 1000, dailyLimit: 100 })
            .then(function(beesExtCamp) {
                delete options.jar;
                return requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        externalId: beesExtCamp.externalId,
                        budget: 500,
                        dailyLimit: 50
                    });
                    return checkExternCampProp('cam-e2e-post-1', resp.body);
                }).then(function() {
                    // check that campaign updated in Beeswax successfully
                    return beeswax.campaigns.find(beesExtCamp.externalId);
                }).then(function(resp) {
                    expect(resp.success).toBe(true);
                    expect(resp.payload).toEqual(jasmine.objectContaining({
                        campaign_id     : beesExtCamp.externalId,
                        advertiser_id   : createdAdvert.beeswaxIds.advertiser,
                        alternative_id  : 'cam-e2e-post-1',
                        campaign_name   : 'E2E - Post beeswax camp 1',
                        campaign_budget : jasmine.any(Number),
                        daily_budget    : jasmine.any(Number)
                    }));
                    expect(resp.payload.campaign_budget).toEqual(Number((500 * impressionRatio).toFixed(2)));
                    expect(resp.payload.daily_budget).toEqual(Number((50 * impressionRatio).toFixed(2)));
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    // clean up created Beeswax advertiser
    // Note: this will actually fail if any campaigns are not cleaned up!
    afterAll(function(done) {
        beeswax.advertisers.delete(createdAdvert.beeswaxIds.advertiser)
        .then(done, done.fail);
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
