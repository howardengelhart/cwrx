var q               = require('q'),
    adtech          = require('adtech'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    adtechErr       = testUtils.handleAdtechError,
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };
    
jasmine.getEnv().defaultTimeoutInterval = 90000;

describe('ads minireelGroups endpoints (E2E):', function() {
    var cookieJar, mockUser, createdGroup, keptAdvert, keptCust;

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
                minireelGroups: {
                    read: 'all',
                    create: 'all',
                    edit: 'all',
                    delete: 'all'
                }
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

    describe('GET /api/minireelGroup/:id', function() {
        beforeEach(function(done) {
            var mockGroups = [
                { id: 'e2e-getid1', name: 'group 1', adtechId: 123, status: 'active' },
                { id: 'e2e-getid2', name: 'group 2', adtechId: 456, status: 'deleted' }
            ];
            testUtils.resetCollection('minireelGroups', mockGroups).done(done);
        });

        it('should get a group by id', function(done) {
            var options = {url: config.adsUrl + '/minireelGroup/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-getid1', name: 'group 1', adtechId: 123, status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/minireelGroup/e2e-getid1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/minireelGroup/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted groups', function(done) {
            var options = {url: config.adsUrl + '/minireelGroup/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/minireelGroup/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/minireelGroup/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/minireelGroups', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/minireelGroups', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockGroups = [
                { id: 'e2e-getquery1', name: 'group 1', adtechId: 123, status: 'active' },
                { id: 'e2e-getquery2', name: 'group 2', adtechId: 456, status: 'inactive' },
                { id: 'e2e-getquery3', name: 'group 3', adtechId: 789, status: 'active' },
                { id: 'e2e-getgone', name: 'group deleted', adtechId: 666, status: 'deleted' }
            ];
            testUtils.resetCollection('minireelGroups', mockGroups).done(done);
        });

        it('should get all groups', function(done) {
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
                expect(results[0].data).toEqual({route: 'GET /api/minireelGroups',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get groups by name', function(done) {
            options.qs.name = 'group 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get groups by adtechId', function(done) {
            options.qs.adtechId = '456';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
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

    describe('POST /api/minireelGroup', function() {
        var name = 'e2e_test-' + new Date().toISOString(),
            mockGroup, options;
        beforeEach(function() {
            mockGroup = {
                name: name,
                categories: ['food', 'sports'],
                advertiserId: keptAdvert.id,
                customerId: keptCust.id,
                miniReels: ['e-1', 'e-2']
            };
            options = {
                url: config.adsUrl + '/minireelGroup',
                jar: cookieJar,
                json: mockGroup
            };
        });

        it('should be able to create a group', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(mockGroup.name);
                expect(resp.body.categories).toEqual(['food', 'sports']);
                expect(resp.body.miniReels).toEqual(['e-1', 'e-2']);
                expect(resp.body.adtechId).toEqual(jasmine.any(Number));
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                
                createdGroup = resp.body;
                return adtech.campaignAdmin.getCampaignById(createdGroup.adtechId).catch(adtechErr);
            }).then(function(group)  {
                expect(group.name).toBe(createdGroup.name);
                expect(group.extId).toBe(createdGroup.id);
                expect(group.priorityLevelOneKeywordIdList).toEqual([]);
                // the keyword ids for 'food' and 'sports' should never change, so we can hardcode them
                expect(group.priorityLevelThreeKeywordIdList.sort()).toEqual(['1002744', '1003562']);
                expect(group.priority).toBe(3);
                expect(group.advertiserId).toBe(keptAdvert.adtechId);
                expect(group.customerId).toBe(keptCust.adtechId);
                return testUtils.getCampaignBanners(createdGroup.adtechId);
            }).then(function(banners) {
                testUtils.compareBanners(banners, createdGroup.miniReels, 'contentMiniReel');
            
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
                expect(results[0].data).toEqual({route: 'POST /api/minireelGroup', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a group with that name exists', function(done) {
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            q.all([{foo: 'bar'}, {name: 'test', adtechId: 1234}, {name: 'test', miniReels: [123]}].map(function(body) {
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
        
        it('should throw a 400 if the advertiser or customer don\'t exist', function(done) {
            q.all([
                {name: 'test', advertiserId: 'fake', customerId: mockGroup.customerId},
                {name: 'test', advertiserId: mockGroup.advertiserId, customerId: 'fake'}
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

    describe('PUT /api/minireelGroup/:id', function() {
        var mockGroups, options;
        beforeEach(function(done) {
            mockGroups = [
                { id: 'e2e-put1', status: 'active', advertiserId: keptAdvert.id, customerId: keptCust.id,
                  adtechId: 12345, name: 'fake group' },
                { id: 'e2e-deleted', status: 'deleted', advertiserId: keptAdvert.id, customerId: keptCust.id,
                  adtechId: 1234, name: 'deleted group' }
            ];
            return testUtils.mongoFind('minireelGroups', {id: createdGroup.id}).then(function(results) {
                mockGroups.push(results[0]);
                return testUtils.resetCollection('minireelGroups', mockGroups);
            }).done(done);
        });

        it('should successfully update a group in mongo and adtech', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/' + createdGroup.id,
                json: { name: 'e2e_test_updated', categories: ['food'] },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(createdGroup);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe(createdGroup.id);
                expect(resp.body.name).toBe('e2e_test_updated');
                expect(resp.body.categories).toEqual(['food']);
                expect(resp.body.created).toBe(createdGroup.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdGroup.lastUpdated));
                expect(resp.body.miniReels).toEqual(createdGroup.miniReels);
                createdGroup = resp.body;
                
                return adtech.campaignAdmin.getCampaignById(createdGroup.adtechId).catch(adtechErr);
            }).then(function(group) {
                expect(group.name).toBe('e2e_test_updated');
                expect(group.priorityLevelThreeKeywordIdList).toEqual(['1003562']);
                expect(group.extId).toBe(createdGroup.id);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/e2e-put1',
                json: { foo: 'baz' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.foo).toBe('baz');
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
                expect(results[0].data).toEqual({route: 'PUT /api/minireelGroup/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit the miniReels list', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/' + createdGroup.id,
                json: { miniReels: ['e-1', 'e-3'] },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe(createdGroup.name);
                expect(resp.body.miniReels).toEqual(['e-1', 'e-3']);
                expect(resp.body.adtechId).toEqual(createdGroup.adtechId);
                expect(resp.body.created).toBe(createdGroup.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdGroup.lastUpdated));
                createdGroup = resp.body;

                return testUtils.getCampaignBanners(createdGroup.adtechId);
            }).then(function(banners) {
                testUtils.compareBanners(banners, createdGroup.miniReels, 'contentMiniReel');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a group that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/e2e-deleted',
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
        
        it('should not create a group if they do not exist', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/e2e-putfake',
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
            options = { url: config.adsUrl + '/minireelGroup/' + createdGroup.id, jar: cookieJar };
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
        
        it('should throw a 409 if a group with that name exists', function(done) {
            options = {
                url: config.adsUrl + '/minireelGroup/e2e-put1',
                json: { name: createdGroup.name },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
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

    describe('DELETE /api/minireelGroup/:id', function() {
        beforeEach(function(done) {
            mockGroups = [
                { id: 'e2e-del1', status: 'deleted', adtechId: 1234 },
                { id: 'e2e-del2', status: 'active' }
            ];
            return testUtils.mongoFind('minireelGroups', {id: createdGroup.id}).then(function(results) {
                mockGroups.push(results[0]);
                return testUtils.resetCollection('minireelGroups', mockGroups);
            }).done(done);
        });

        it('should delete a group from adtech and set its status to deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/minireelGroup/' + createdGroup.id};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/minireelGroup/' + createdGroup.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                
                return q.allSettled([adtech.campaignAdmin.getCampaignById(createdGroup.adtechId).catch(adtechErr)]);
            }).then(function(results) {
                expect(results[0].state).toBe('rejected');
                expect(results[0].reason && results[0].reason.message).toMatch(/^Unable to locate object: /);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should handle groups that have no adtechId', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/minireelGroup/e2e-del2'};
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
                expect(results[0].data).toEqual({route: 'DELETE /api/minireelGroup/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/minireelGroup/e2e-del2' + createdGroup.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the group has been deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/minireelGroup/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the group does not exist', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/minireelGroup/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/minireelGroup/e2e-del1'})
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
