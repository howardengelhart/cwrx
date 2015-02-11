var q               = require('q'),
    adtech          = require('adtech'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    adtechErr       = testUtils.handleAdtechError,
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };
    
jasmine.getEnv().defaultTimeoutInterval = 90000;

describe('ads campaigns endpoints (E2E):', function() {
    var cookieJar, mockUser, createdCamp, keptAdvert, keptCust;

    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'adsvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                cards: { delete: 'org' },
                experiences: { delete: 'org' },
                campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'adsvce2euser',
                password: 'password'
            }
        };
        return testUtils.resetCollection('users', mockUser).then(function() {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) { done(); });
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

    // Helper method to validate a campaign for a sponsored card
    function checkCardCampaign(camp, parentCamp, cardId, catKeys) {
        expect(camp).toBeDefined();
        if (!camp) return;

        expect(camp.extId).toBe(cardId);
        expect(camp.name).toMatch(new RegExp(parentCamp.id + '_card_' + cardId));
        expect(camp.priorityLevelOneKeywordIdList).toEqual([jasmine.any(String)]);
        expect(camp.priorityLevelThreeKeywordIdList.sort()).toEqual(catKeys.sort());
        expect(camp.priority).toBe(2);
        expect(camp.advertiserId).toBe(keptAdvert.adtechId);
        expect(camp.customerId).toBe(keptCust.adtechId);
    }

    // Helper method to validate a campaign for a sponsored minireel
    function checkMinireelCampaign(camp, parentCamp, mrId, catKeys) {
        expect(camp).toBeDefined();
        if (!camp) return;

        expect(camp.extId).toBe(mrId);
        expect(camp.name).toMatch(new RegExp(parentCamp.id + '_miniReel_' + mrId));
        expect(camp.priorityLevelOneKeywordIdList).toEqual([]);
        expect(camp.priorityLevelThreeKeywordIdList.sort()).toEqual(catKeys.sort());
        expect(camp.priority).toBe(2);
        expect(camp.advertiserId).toBe(keptAdvert.adtechId);
        expect(camp.customerId).toBe(keptCust.adtechId);
    }

    // Helper method to validate a campaign for a target group
    function checkTargetCampaign(camp, parentCamp, cardKeys) {
        expect(camp).toBeDefined();
        if (!camp) return;

        expect(camp.extId).toBe(parentCamp.id);
        expect(camp.name).toMatch(new RegExp(parentCamp.id + '_group_\\w+'));
        expect(camp.priorityLevelOneKeywordIdList.sort()).toEqual(cardKeys.sort());
        expect(camp.priorityLevelThreeKeywordIdList).toEqual([]);
        expect(camp.priority).toBe(3);
        expect(camp.advertiserId).toBe(keptAdvert.adtechId);
        expect(camp.customerId).toBe(keptCust.adtechId);
    }

    // only do this once, so their state is preserved in between tests
    describe('setting up experiences and cards', function() {
        it('creates some mock experiences and cards', function(done) {
            mockCards = [
                {id: 'rc-1', status: 'active', user: 'not-e2e-user', org: 'e2e-org'},
                {id: 'rc-2', status: 'active', user: 'not-e2e-user', org: 'e2e-org'},
                {id: 'rc-3', status: 'active', user: 'not-e2e-user', org: 'not-e2e-org'}
            ];
            mockExps = [
                {id: 'e-1', status: [{status: 'active'}], user: 'not-e2e-user', org: 'not-e2e-org'},
                {id: 'e-2', status: [{status: 'active'}], user: 'not-e2e-user', org: 'e2e-org'},
                {id: 'e-3', status: [{status: 'active'}], user: 'not-e2e-user', org: 'e2e-org'}
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
                { id: 'e2e-getid1', name: 'camp 1', status: 'active' },
                { id: 'e2e-getid2', name: 'camp 2', status: 'deleted' }
            ];
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });

        it('should get a campaign by id', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-getid1', name: 'camp 1', status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid1', jar: cookieJar};
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

        it('should not show deleted campaigns', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/campaign/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/campaign/e2e-getid5678', jar: cookieJar};
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
            options = { url: config.adsUrl + '/campaigns', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockCamps = [
                { id: 'e2e-getquery1', name: 'camp 1', status: 'active' },
                { id: 'e2e-getquery2', name: 'camp 2', status: 'inactive' },
                { id: 'e2e-getquery3', name: 'camp 3', status: 'active' },
                { id: 'e2e-getgone', name: 'camp deleted', status: 'deleted' }
            ];
            testUtils.resetCollection('campaigns', mockCamps).done(done);
        });

        it('should get all campaigns', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
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
                expect(results[0].data).toEqual({route: 'GET /api/campaigns',
                                                 params: {}, query: { sort: 'id,1' } });
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
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 2-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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

    describe('POST /api/campaign', function() {
        var name = 'e2e_test-' + new Date().toISOString(),
            mockCamp, options;
        beforeEach(function() {
            mockCamp = {
                name: name,
                categories: ['food', 'sports'],
                advertiserId: keptAdvert.id,
                customerId: keptCust.id,
                miniReels: ['e-1', 'e-2'],
                cards: ['rc-1', 'rc-2'],
                miniReelGroups: [{cards: ['rc-1'], miniReels: ['e-1', 'e-2']}]
            };
            options = {
                url: config.adsUrl + '/campaign',
                jar: cookieJar,
                json: mockCamp
            };
        });

        it('should be able to create a campaign', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(mockCamp.name);
                expect(resp.body.categories).toEqual(['food', 'sports']);
                expect(resp.body.miniReels).toEqual(['e-1', 'e-2']);
                expect(resp.body.cards).toEqual(['rc-1', 'rc-2']);
                expect(resp.body.miniReelGroups).toEqual([{adtechId: jasmine.any(Number),
                                                           cards: ['rc-1'], miniReels: ['e-1', 'e-2']}]);
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                createdCamp = resp.body;
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('created campaign', function() {
            it('should have a sponsored campaign for each entry in cards', function(done) {
                q.all(createdCamp.cards.map(function(cardId) {
                    return adtech.campaignAdmin.getCampaignByExtId(cardId).catch(adtechErr).then(function(camp) {
                        // these keyword ids for the category names should never change, so we can hardcode
                        checkCardCampaign(camp, createdCamp, cardId, ['1002744', '1003562']);
                        return testUtils.getCampaignBanners(camp.id);
                    }).then(function(banners) {
                        testUtils.compareBanners(banners, [cardId], 'card');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(function(results) { done(); });
            });
            
            it('should have a sponsored campaign for each entry in miniReels', function(done) {
                q.all(createdCamp.miniReels.map(function(mrId) {
                    return adtech.campaignAdmin.getCampaignByExtId(mrId).catch(adtechErr).then(function(camp) {
                        checkMinireelCampaign(camp, createdCamp, mrId, ['1002744', '1003562']);
                        return testUtils.getCampaignBanners(camp.id);
                    }).then(function(banners) {
                        testUtils.compareBanners(banners, [mrId], 'miniReel');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(function(results) { done(); });
            });
            
            it('should have a target group campaign or each entry miniReelGroups', function(done) {
                adtech.campaignAdmin.getCampaignById(createdCamp.miniReelGroups[0].adtechId).catch(adtechErr)
                .then(function(camp)  {
                    checkTargetCampaign(camp, createdCamp, ['3174551']);
                    return testUtils.getCampaignBanners(camp.id);
                }).then(function(banners) {
                    testUtils.compareBanners(banners, createdCamp.miniReelGroups[0].miniReels, 'contentMiniReel');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should be able to create a campaign without sponsored or target sub-campaigns', function(done) {
            options.json = { name: 'empty camp', categories: ['food', 'sports'],
                             advertiserId: keptAdvert.id, customerId: keptCust.id };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.categories).toEqual(['food', 'sports']);
                expect(resp.body.miniReels).not.toBeDefined();
                expect(resp.body.cards).not.toBeDefined();
                expect(resp.body.miniReelGroups).not.toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                
                // check that it wrote an entry to the audit collection
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
                expect(results[0].data).toEqual({route: 'POST /api/campaign', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 400 if the body is incomplete', function(done) {
            q.all([{advertiserId: 'fake'}, {customerId: 'fake'}].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if any of the lists are in the wrong format', function(done) {
            q.all(['cards', 'miniReels', 'miniReelGroups', 'categories'].map(function(key) {
                options.json = { advertiserId: keptAdvert.id, customerId: keptCust.id };
                options.json[key] = [123, 456];
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the advertiser or customer don\'t exist', function(done) {
            q.all([
                {name: 'test', advertiserId: 'fake', customerId: mockCamp.customerId},
                {name: 'test', advertiserId: mockCamp.advertiserId, customerId: 'fake'}
            ].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('advertiser fake does not exist');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('customer fake does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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

    describe('PUT /api/campaign/:id', function() {
        var mockCamps, options;
        beforeEach(function(done) {
            mockCamps = [
                { id: 'e2e-put1', status: 'active', advertiserId: keptAdvert.id, customerId: keptCust.id,
                  name: 'fake camp' },
                { id: 'e2e-deleted', status: 'deleted', advertiserId: keptAdvert.id, customerId: keptCust.id,
                  name: 'deleted camp' }
            ];
            return testUtils.mongoFind('campaigns', {id: createdCamp.id}).then(function(results) {
                mockCamps.push(results[0]);
                return testUtils.resetCollection('campaigns', mockCamps);
            }).done(done);
        });

        it('should successfully update a campaign in our database', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-put1',
                json: { name: 'updated fake camp' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('updated fake camp');
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
                expect(results[0].data).toEqual({route: 'PUT /api/campaign/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to add+remove sponsored cards', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { cards: ['rc-1', 'rc-3'] },
                jar: cookieJar
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe(createdCamp.name);
                expect(resp.body.cards).toEqual(['rc-1', 'rc-3']);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;
                
                return q.allSettled([
                    adtech.campaignAdmin.getCampaignByExtId('rc-1'),
                    adtech.campaignAdmin.getCampaignByExtId('rc-2'),
                    adtech.campaignAdmin.getCampaignByExtId('rc-3')
                ]);
            }).then(function(results) {
                // just check that rc-1 camp still exists
                expect(results[0].state).toBe('fulfilled');
                expect(results[0].value).toBeDefined();

                // rc-2 campaign should no longer exist
                expect(results[1].state).toBe('rejected');
                expect(results[1].reason && results[1].reason.message).toMatch(/^Unable to locate object: /);

                // check that rc-3 campaign created properly
                expect(results[2].state).toBe('fulfilled');
                checkCardCampaign(results[2].value, createdCamp, 'rc-3', ['1002744', '1003562']);

                return testUtils.getCampaignBanners(results[2].value.id);
            }).then(function(banners) {
                testUtils.compareBanners(banners, ['rc-3'], 'card');
                
                return testUtils.mongoFind('cards', {id: 'rc-2'});
            }).then(function(results) {
                expect(results[0].status).toBe('deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to add+remove sponsored minireels', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { miniReels: ['e-1', 'e-3'] },
                jar: cookieJar
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe(createdCamp.name);
                expect(resp.body.miniReels).toEqual(['e-1', 'e-3']);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;
                
                return q.allSettled([
                    adtech.campaignAdmin.getCampaignByExtId('e-1'),
                    adtech.campaignAdmin.getCampaignByExtId('e-2'),
                    adtech.campaignAdmin.getCampaignByExtId('e-3')
                ]);
            }).then(function(results) {
                // just check that e-1 camp still exists
                expect(results[0].state).toBe('fulfilled');
                expect(results[0].value).toBeDefined();

                // e-2 campaign should no longer exist
                expect(results[1].state).toBe('rejected');
                expect(results[1].reason && results[1].reason.message).toMatch(/^Unable to locate object: /);

                // check that e-3 campaign created properly
                expect(results[2].state).toBe('fulfilled');
                checkMinireelCampaign(results[2].value, createdCamp, 'e-3', ['1002744', '1003562']);

                return testUtils.getCampaignBanners(results[2].value.id);
            }).then(function(banners) {
                testUtils.compareBanners(banners, ['e-3'], 'miniReel');

                return testUtils.mongoFind('experiences', {id: 'e-2'});
            }).then(function(results) {
                expect(results[0].status[0].status).toBe('deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should edit sponsored campaigns\' keywords if the categories change', function(done) {
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { categories: ['bacon', 'food'] },
                jar: cookieJar
            };
            
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.categories).toEqual(['bacon', 'food']);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;
                
                return q.all([
                    createdCamp.cards.map(function(id) {
                        return adtech.campaignAdmin.getCampaignByExtId(id).then(function(camp) {
                            checkCardCampaign(camp, createCamp, id, ['1002744', '1003562']);
                        });
                    }).concat(createdCamp.miniReels.map(function(id) {
                        return adtech.campaignAdmin.getCampaignByExtId(id).then(function(camp) {
                            checkMinireelCampaign(camp, createCamp, id, ['1002744', '1003562']);
                        });
                    }))
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(function(results) { done(); });
        });
        
        it('should be able to add+remove miniReelGroups', function(done) {
            var oldAdtechId = createdCamp.miniReelGroups[0].adtechId;
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { miniReelGroups: [{cards: ['rc-4', 'rc-5'], miniReels: ['e-4', 'e-5']}] },
                jar: cookieJar
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe(createdCamp.name);
                expect(resp.body.miniReelGroups).toEqual([{adtechId: jasmine.any(Number),
                    cards: ['rc-4', 'rc-5'], miniReels: ['e-4', 'e-5']}]);
                expect(resp.body.miniReelGroups[0].adtechId).not.toBe(oldAdtechId);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;
                
                return q.allSettled([
                    adtech.campaignAdmin.getCampaignById(oldAdtechId),
                    adtech.campaignAdmin.getCampaignById(createdCamp.miniReelGroups[0].adtechId)
                ]);
            }).then(function(results) {
                // old target campaign should no longer exist
                expect(results[0].state).toBe('rejected');
                expect(results[0].reason && results[0].reason.message).toMatch(/^Unable to locate object: /);

                // check that new target campaign created properly
                expect(results[1].state).toBe('fulfilled');
                checkTargetCampaign(results[1].value, createdCamp, ['3181311', '3198765']);
                return testUtils.getCampaignBanners(results[1].value.id);
            }).then(function(banners) {
                testUtils.compareBanners(banners, createdCamp.miniReelGroups[0].miniReels, 'contentMiniReel');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit the miniReels list for a miniReelGroup', function(done) {
            var currentAdtechId = createdCamp.miniReelGroups[0].adtechId;
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { miniReelGroups: [{
                    adtechId: createdCamp.miniReelGroups[0].adtechId,
                    cards: createdCamp.miniReelGroups[0].cards,
                    miniReels: ['e-4', 'e-6']
                }] },
                jar: cookieJar
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.miniReelGroups).toEqual([{adtechId: jasmine.any(Number),
                    cards: ['rc-4', 'rc-5'], miniReels: ['e-4', 'e-6']}]);
                expect(resp.body.miniReelGroups[0].adtechId).toBe(currentAdtechId);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;
                
                return testUtils.getCampaignBanners(createdCamp.miniReelGroups[0].adtechId);
            }).then(function(banners) {
                testUtils.compareBanners(banners, ['e-4', 'e-6'], 'contentMiniReel');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit the cards list for a miniReelGroup', function(done) {
            var currentAdtechId = createdCamp.miniReelGroups[0].adtechId;
            options = {
                url: config.adsUrl + '/campaign/' + createdCamp.id,
                json: { miniReelGroups: [{
                    adtechId: createdCamp.miniReelGroups[0].adtechId,
                    cards: ['rc-4', 'rc-6'],
                    miniReels: createdCamp.miniReelGroups[0].miniReels
                }] },
                jar: cookieJar
            };

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.miniReelGroups).toEqual([{adtechId: jasmine.any(Number),
                    cards: ['rc-4', 'rc-6'], miniReels: ['e-4', 'e-6']}]);
                expect(resp.body.miniReelGroups[0].adtechId).toBe(currentAdtechId);
                expect(resp.body.created).toBe(createdCamp.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCamp.lastUpdated));
                createdCamp = resp.body;

                return adtech.campaignAdmin.getCampaignById(createdCamp.miniReelGroups[0].adtechId);
            }).then(function(camp) {
                checkTargetCampaign(camp, createdCamp, ['3181311', '3198790']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not edit a campaign that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/campaign/e2e-deleted',
                json: { name: 'resurrected' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
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
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            options = { url: config.adsUrl + '/campaign/' + createdCamp.id, jar: cookieJar };
            q.all([{advertiserId: 'fake'}, {customerId: 'fake'}, {miniReels: [123, 234]}].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                });
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

    describe('DELETE /api/campaign/:id', function() {
        beforeEach(function(done) {
            mockCamps = [
                { id: 'e2e-del1', status: 'deleted' },
                { id: 'e2e-del2', status: 'active' }
            ];
            
            testUtils.mongoFind('campaigns', {id: createdCamp.id}).then(function(results) {
                mockCamps.push(results[0]);
                return testUtils.resetCollection('campaigns', mockCamps);
            }).done(done);
        });

        it('should delete a campaign from adtech and set its status to deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/campaign/' + createdCamp.id};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/campaign/' + createdCamp.id, jar: cookieJar};
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
                    createdCamp.cards.map(function(id) {
                        return adtech.campaignAdmin.getCampaignByExtId(id).catch(adtechErr);
                    }).concat(createdCamp.miniReels.map(function(id) {
                        return adtech.campaignAdmin.getCampaignByExtId(id).catch(adtechErr);
                    })).concat(createdCamp.miniReelGroups.map(function(group) {
                        return adtech.campaignAdmin.getCampaignById(group.adtechId).catch(adtechErr);
                    }))
                ).then(function(results) {
                    results.forEach(function(result) {
                        expect(result.state).toBe('rejected');
                        expect(result.reason && result.reason.message).toMatch(/^Unable to locate object: /);
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should delete all cards+minireels the user had permission to delete', function(done) {
                testUtils.mongoFind('experiences', {}, {id: 1}).then(function(results) {
                    expect(results[0].id).toBe('e-1');
                    expect(results[0].status[0].status).toBe('active');
                    expect(results[1].id).toBe('e-2');
                    expect(results[1].status[0].status).toBe('deleted');
                    expect(results[2].id).toBe('e-3');
                    expect(results[2].status[0].status).toBe('deleted');
                    
                    return testUtils.mongoFind('cards', {}, {id: 1});
                }).then(function(results) {
                    expect(results[0].id).toBe('rc-1');
                    expect(results[0].status).toBe('deleted');
                    expect(results[1].id).toBe('rc-2');
                    expect(results[1].status).toBe('deleted');
                    expect(results[2].id).toBe('rc-3');
                    expect(results[2].status).toBe('active');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should handle campaigns that have no sub-campaigns', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/campaign/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                // Check that it's writing to the audit collection
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
                expect(results[0].data).toEqual({route: 'DELETE /api/campaign/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/campaign/e2e-del2' + createdCamp.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign has been deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/campaign/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the campaign does not exist', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/campaign/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/campaign/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function() {
        testUtils.closeDbs();
    });
});