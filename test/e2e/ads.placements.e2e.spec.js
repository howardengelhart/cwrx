var q               = require('q'),
    path            = require('path'),
    urlUtils        = require('url'),
    util            = require('util'),
    ld              = require('lodash'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('ads placements endpoints (E2E):', function() {
    var cookieJar, nonAdminJar, mockCons, mockCards, mockCamps, mockExps, createdAdvert, mockApp, appCreds;

    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
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
            policies: ['manageAllPlacements']
        };
        var nonAdmin = {
            id: 'u-selfie',
            status: 'active',
            email : 'nonadminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['manageOrgPlacements']
        };
        var testPolicies = [
            {
                id: 'p-e2e-allPlaces',
                name: 'manageAllPlacements',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'all', create: 'all' },
                    placements: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-orgPlaces',
                name: 'manageOrgPlacements',
                status: 'active',
                priority: 1,
                permissions: {
                    placements: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-placements',
            key: 'e2e-placements',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                placements: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
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

    
    // Setup beeswax advert that creatives can be tied to
    beforeAll(function(done) {
        requestUtils.qRequest('post', {
            url: config.adsUrl + '/account/advertisers',
            json: { name: Date.now() + ' - placements.e2e' },
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
    
    // Setup other entities
    beforeAll(function(done) {
        mockCons = [
            { id: 'con-1', status: 'active', name: 'box-active', defaultTagParams: {} },
            { id: 'con-2', status: 'inactive', name: 'box-inactive', defaultTagParams: {} },
            { id: 'con-3', status: 'deleted', name: 'box-deleted', defaultTagParams: {} },
            { id: 'con-beeswax', status: 'active', name: 'beeswax', defaultTagParams: {} }
        ];
        mockCamps = [
            { id: 'cam-active', advertiserId: createdAdvert.id, status: 'active', cards: [{ id: 'rc-active' }], user: 'e2e-user', org: 'e2e-org',
              product : {   
                uri: 'https://itunes.apple.com/us/app/count-coins/id595124272?mt=8&uo=4',
                categories: ['Education','Lifestyle'],
                images: [
                  {
                    uri: 'http://a1.mzstatic.com/us/r30/Purple/v4/c2/ec/6b/c2ec6b9a-d47b-20e4-d1f7-2f42fffcb58f/screen1136x1136.jpeg',
                    type: 'screenshot', device: 'phone'
                  },
                  {
                    uri: 'http://a5.mzstatic.com/us/r30/Purple/v4/fc/4b/e3/fc4be397-6865-7011-361b-59f78c789e62/screen1136x1136.jpeg',
                    type: 'screenshot', device: 'phone'
                  },
                  {
                    uri: 'http://a5.mzstatic.com/us/r30/Purple/v4/f9/02/63/f902630c-3969-ab9f-07b4-2c91bd629fd0/screen1136x1136.jpeg',
                    type: 'screenshot', device: 'phone'
                  },
                  {
                    uri: 'http://a3.mzstatic.com/us/r30/Purple/v4/f8/21/0e/f8210e8f-a75a-33c0-9e86-e8c65c9faa54/screen1136x1136.jpeg',
                    type: 'screenshot', device: 'phone'
                  },
                  {
                    uri: 'http://is5.mzstatic.com/image/thumb/Purple/v4/ef/a0/f3/efa0f340-225e-e512-1616-8f223c6202ea/source/512x512bb.jpg',
                    type: 'thumbnail'
                  }
                ]
              }
            },
            { id: 'cam-paused', advertiserId: createdAdvert.id, status: 'paused', cards: [{ id: 'rc-paused' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-deleted', advertiserId: createdAdvert.id, status: 'deleted', cards: [{ id: 'rc-deleted' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-canceled', advertiserId: createdAdvert.id, status: 'canceled', cards: [], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-outOfBudget', advertiserId: createdAdvert.id, status: 'outOfBudget', cards: [], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-expired', advertiserId: createdAdvert.id, status: 'expired', cards: [], user: 'e2e-user', org: 'e2e-org' },
        ];
        mockExps = [
            { id: 'e-active', status: [{ status: 'active' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'e-inactive', status: [{ status: 'inactive' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'e-deleted', status: [{ status: 'deleted' }], user: 'e2e-user', org: 'e2e-org' },
        ];
        mockCards = [
            { id: 'rc-active', campaignId: 'cam-active', status: 'active', user: 'e2e-user', org: 'e2e-org' },
            { id: 'rc-paused', campaignId: 'cam-paused', status: 'paused', user: 'e2e-user', org: 'e2e-org' },
            { id: 'rc-deleted', campaignId: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'e2e-org' }
        ];

        q.all([
            testUtils.resetCollection('containers', mockCons),
            testUtils.resetCollection('campaigns', mockCamps),
            testUtils.resetCollection('cards', mockCards),
            testUtils.resetCollection('experiences', mockExps)
        ])
        .done(function() { done(); });
    });
    
    
    function getMraidOpts(creative, placement) {
        var tag = creative.creative_content.TAG;
        expect(tag).toEqual(jasmine.any(String));
        expect(tag).toMatch(/src = .*c6mraid\.min\.js/);
        var mraidMatch = tag.match(/window.c6mraid\(([^\(]+)\)/),
            mraidOpts;
        
        try {
            mraidOpts = JSON.parse(mraidMatch[1]);
        } catch(e) {}
        mraidOpts = mraidOpts || {};
        return mraidOpts;
    }

    function validateCreativePixel(creative, placement) {
        expect(creative.creative_content.ADDITIONAL_PIXELS).toEqual([{
            PIXEL_URL: jasmine.stringMatching('pixel.gif')
        }]);
        var pixelUrl = creative.creative_content.ADDITIONAL_PIXELS[0].PIXEL_URL,
            pixelQuery = urlUtils.parse(pixelUrl, true).query;
        
        expect(pixelQuery.placement).toBe(placement.id);
        expect(pixelQuery.campaign).toBe(placement.tagParams.campaign);
        expect(pixelQuery.container).toBe(placement.tagParams.container);
        expect(pixelQuery.event).toBe('impression');
        expect(pixelQuery.hostApp).toBe(placement.tagParams.hostApp);
        expect(pixelQuery.network).toBe(placement.tagParams.network);
        expect(pixelQuery.extSessionId).toBe(placement.tagParams.uuid);
        expect(pixelQuery.branding).toBe(placement.tagParams.branding);
        expect(pixelQuery.ex).toBe(placement.tagParams.ex);
        expect(pixelQuery.vr).toBe(placement.tagParams.vr);
        expect(pixelQuery.domain).toBe(placement.tagParams.domain);
        expect(pixelQuery.cb).toBe('{{CACHEBUSTER}}');
    }
    
    
    describe('GET /api/placements/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockPlacements = [
                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-1', campaign: 'cam-1' }
                },
                {
	                id: 'e2e-pl-2',
	                status: 'active',
	                user: 'u-admin',
	                org: 'o-admin',
	                tagParams: { type: 'full', container: 'box-2', campaign: 'cam-2' }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-gone', campaign: 'cam-gone' }
                }
            ];

            options = {
                url: config.adsUrl + '/placements/e2e-pl-1',
                jar: cookieJar
            };
            testUtils.resetCollection('placements', mockPlacements).done(done);
        });

        it('should get a placement by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-1', campaign: 'cam-1' }
                });
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
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/placements/:id',
                                                 params: { 'id': 'e2e-pl-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'status' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-pl-1',
                    status: 'active'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a non-admin to only retrieve their placements', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-pl-1', 'e2e-pl-2'].map(function(id) {
                options.url = config.adsUrl + '/placements/' + id;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.id).toBe('e2e-pl-1');
                expect(results[1].response.statusCode).toBe(404);
                expect(results[1].body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted placements', function(done) {
            options.url = config.adsUrl + '/placements/e2e-deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.adsUrl + '/placements/e2e-pl-5678';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get a placement', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-1', campaign: 'cam-1' }
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            delete options.jar;
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/placements', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/placements', qs: { sort: 'id,1' }, jar: cookieJar };
            var mockPlacements = [
                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'typeA', container: 'box-1', campaign: 'cam-1' }
                },
                {
	                id: 'e2e-pl-2',
	                status: 'active',
	                user: 'u-admin',
	                org: 'o-admin',
	                tagParams: { type: 'typeB', container: 'box-1', campaign: 'cam-1' }
                },
                {
	                id: 'e2e-pl-3',
	                status: 'active',
	                user: 'u-other',
	                org: 'o-selfie',
	                tagParams: { type: 'typeC', container: 'box-2', campaign: 'cam-1', experience: 'e-1' }
                },
                {
	                id: 'e2e-pl-4',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'typeD', container: 'box-1', campaign: 'cam-2', card: 'rc-1' }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'typeE', container: 'box-gone', campaign: 'cam-gone' }
                }
            ];
            testUtils.resetCollection('placements', mockPlacements).done(done);
        });

        it('should get all placements', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-pl-1');
                expect(resp.body[1].id).toBe('e2e-pl-2');
                expect(resp.body[2].id).toBe('e2e-pl-3');
                expect(resp.body[3].id).toBe('e2e-pl-4');
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
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/placements/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-pl-1', status: 'active' },
                    { id: 'e2e-pl-2', status: 'active' },
                    { id: 'e2e-pl-3', status: 'active' },
                    { id: 'e2e-pl-4', status: 'active' },
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get placements by user', function(done) {
            options.qs.user = 'u-selfie';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pl-1');
                expect(resp.body[1].id).toBe('e2e-pl-4');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
            
        });

        it('should get placements by org', function(done) {
            options.qs.org = 'o-selfie';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-pl-1');
                expect(resp.body[1].id).toBe('e2e-pl-3');
                expect(resp.body[2].id).toBe('e2e-pl-4');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get placements by link props in the tagParams', function(done) {
            q.all([
                { 'tagParams.container': 'box-1', sort: 'id,1', fields: 'id' },
                { 'tagParams.campaign': 'cam-1', sort: 'id,1', fields: 'id' },
                { 'tagParams.experience': 'e-1', sort: 'id,1', fields: 'id' },
                { 'tagParams.card': 'rc-1', sort: 'id,1', fields: 'id' },
            ].map(function(obj) {
                options.qs = obj;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body).toEqual([{ id: 'e2e-pl-1' }, { id: 'e2e-pl-2' }, { id: 'e2e-pl-4' }]);
                expect(results[1].response.statusCode).toBe(200);
                expect(results[1].body).toEqual([{ id: 'e2e-pl-1' }, { id: 'e2e-pl-2' }, { id: 'e2e-pl-3' }]);
                expect(results[2].response.statusCode).toBe(200);
                expect(results[2].body).toEqual([{ id: 'e2e-pl-3' }]);
                expect(results[3].response.statusCode).toBe(200);
                expect(results[3].body).toEqual([{ id: 'e2e-pl-4' }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.user = 'hamboneHarry';
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
            options.qs.sort = 'tagParams.type,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pl-4');
                expect(resp.body[1].id).toBe('e2e-pl-3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pl-2');
                expect(resp.body[1].id).toBe('e2e-pl-1');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should only show non-admins placements they can see', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-pl-1');
                expect(resp.body[1].id).toBe('e2e-pl-3');
                expect(resp.body[2].id).toBe('e2e-pl-4');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
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

        it('should allow an app to get placements', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-pl-1');
                expect(resp.body[1].id).toBe('e2e-pl-2');
                expect(resp.body[2].id).toBe('e2e-pl-3');
                expect(resp.body[3].id).toBe('e2e-pl-4');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/placements', function() {
        var options, start, end;
        beforeEach(function(done) {
            start = new Date(Date.now() + 24*60*60*1000);
            end = new Date(Date.now() + 30*24*60*60*1000);
            options = {
                url: config.adsUrl + '/placements/',
                jar: nonAdminJar,
                json: {
                    label: 'totally legit placement',
                    tagType: 'vpaid',
                    budget: { daily: 100, total: 1000 },
                    startDate: start,
                    endDate: end,
                    tagParams: {
                        type: 'full',
                        container: 'box-active',
                        campaign: 'cam-active',
                        branding: 'elitedaily'
                    }
                }
            };
            testUtils.resetCollection('placements').then(done, done.fail);
        });

        it('should be able to create a placement', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id          : jasmine.any(String),
                    status      : 'active',
                    created     : jasmine.any(String),
                    lastUpdated : resp.body.created,
                    user        : 'u-selfie',
                    org         : 'o-selfie',
                    label       : 'totally legit placement',
                    tagType     : 'vpaid',
                    budget      : { daily: 100, total: 1000 },
                    startDate   : start.toISOString(),
                    endDate     : end.toISOString(),
                    tagParams : {
                        container   : 'box-active',
                        campaign    : 'cam-active',
                        type        : 'full',
                        branding    : 'elitedaily'
                    },
                    showInTag: {}
                });
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-selfie');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/placements/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the container, campaign or type are not defined', function(done) {
            q.all(['container', 'campaign', 'type'].map(function(field) {
                var newOpts = JSON.parse(JSON.stringify(options));
                newOpts.jar = nonAdminJar;
                delete newOpts.json.tagParams[field];
                
                return requestUtils.qRequest('post', newOpts).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Missing required field: tagParams.' + field );
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should initialize the costHistory if setting the externalCost', function(done) {
            options.json.externalCost = { event: 'click', cost: 0.12 };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    externalCost: { event: 'click', cost: 0.12 },
                    costHistory: [{
                        userId: 'u-selfie',
                        user: 'nonadminuser',
                        date: jasmine.any(String),
                        externalCost: { event: 'click', cost: 0.12 }
                    }]
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('when providing links to other entities in tagParams', function() {
            it('should succeed if all linked entities are active', function(done) {
                options.json.tagParams = {
                    type: 'full',
                    container: 'box-active',
                    campaign: 'cam-active',
                    card: 'rc-active',
                    experience: 'e-active'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.tagParams).toEqual({
                        type: 'full',
                        container: 'box-active',
                        campaign: 'cam-active',
                        card: 'rc-active',
                        experience: 'e-active'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should succeed if all linked entities are inactive/paused', function(done) {
                options.json.tagParams = {
                    type: 'full',
                    container: 'box-inactive',
                    campaign: 'cam-paused',
                    card: 'rc-paused',
                    experience: 'e-inactive'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.tagParams).toEqual({
                        type: 'full',
                        container: 'box-inactive',
                        campaign: 'cam-paused',
                        card: 'rc-paused',
                        experience: 'e-inactive'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are deleted', function(done) {
                q.all([
                    ['campaign', 'cam-deleted'],
                    ['card', 'rc-deleted'],
                    ['experience', 'e-deleted'],
                    ['container', 'box-deleted'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('post', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are non-existent', function(done) {
                q.all([
                    ['campaign', 'cam-boople'],
                    ['card', 'rc-snoots'],
                    ['experience', 'e-floofle'],
                    ['container', 'box-poofs'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('post', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign and card do not match', function(done) {
                options.json.tagParams = {
                    type: 'full',
                    container: 'box-active',
                    campaign: 'cam-active',
                    card: 'rc-paused'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('card rc-paused not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign is canceled, outOfBudget, or expired', function(done) {
                q.all([
                    ['campaign', 'cam-expired'],
                    ['campaign', 'cam-outOfBudget'],
                    ['campaign', 'cam-canceled'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('post', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('when creating a beeswax placement', function() {
            var nowStr;
            beforeEach(function() {
                nowStr = Date.now() + ' - ';
                delete options.qs;
                options.json = {
                    label: nowStr + 'e2e beeswax placement',
                    tagType: 'mraid',
                    tagParams: {
                        type: 'full',
                        container: 'beeswax',
                        campaign: 'cam-active',
                        clickUrls: [
                            '{{CLICK_URL}}'
                        ],
                    },
                    showInTag: {
                        clickUrls: true
                    }
                };
            });
            it('should not create a creative in beeswax', function(done) {
                options.json.label= nowStr + 'e2e beeswax placement';
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual(jasmine.objectContaining({
                        id          : jasmine.any(String),
                        status      : 'active',
                        label       : nowStr + 'e2e beeswax placement',
                        tagType     : 'mraid',
                        tagParams : {
                            container   : 'beeswax',
                            campaign    : 'cam-active',
                            type        : 'full',
                            clickUrls: [
                                '{{CLICK_URL}}'
                            ]
                        },
                        showInTag: {
                            clickUrls: true
                        }
                    }));
                    expect(resp.body.beeswaxIds).not.toBeDefined();
                    expect(resp.body.thumbnailSourceUrl).not.toBeDefined();
                }).then(done,done.fail);
            });
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'pl-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.user = 'me';
            options.json.org = 'us';
            options.json.costHistory = [{ yesterday: 'expensive' }];
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('pl-fake');
                expect(resp.body.user).toBe('u-selfie');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.costHistory).not.toBeDefined();
                expect(new Date(resp.body.created)).toBeGreaterThan(options.json.created);
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

        it('should allow an app to create a placement', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    id          : jasmine.any(String),
                    label       : 'totally legit placement',
                    tagType     : 'vpaid',
                    budget      : { daily: 100, total: 1000 },
                    tagParams : {
                        container   : 'box-active',
                        campaign    : 'cam-active',
                        type        : 'full',
                        branding    : 'elitedaily'
                    }
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/placements/:id', function() {
        var mockPlacements, options;
        beforeEach(function(done) {
            mockPlacements = [
               {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-active', campaign: 'cam-active' }
                },
                {
	                id: 'e2e-pl-2',
	                status: 'active',
	                user: 'u-admin',
	                org: 'o-admin',
	                tagParams: { type: 'full', container: 'box-active', campaign: 'cam-active' }
                },
                {
	                id: 'e2e-pl-3',
	                status: 'active',
	                user: 'u-other',
	                org: 'o-selfie',
	                externalCost: { event: 'click', cost: 0.12 },
	                costHistory: [{
	                    userId: 'u-other',
	                    user: 'otheruser',
	                    date: new Date('2016-01-20T15:43:02.370Z'),
	                    externalCost: { event: 'click', cost: 0.12 }
	                }],
	                tagParams: { type: 'full', container: 'box-active', campaign: 'cam-active' }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-deleted', campaign: 'cam-deleted' }
                }
            ];
            options = {
                url: config.adsUrl + '/placements/e2e-pl-1',
                json: {
                    label: 'foo bar',
                    tagType: 'mraid',
                    tagParams: { type: 'mobile', container: 'box-active', campaign: 'cam-active' }
                },
                jar: cookieJar
            };
            return testUtils.resetCollection('placements', mockPlacements).done(done);
        });

        it('should successfully update a placement', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pl-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.tagParams).toEqual({ type: 'mobile', container: 'box-active', campaign: 'cam-active' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/placements/:id',
                                                 params: { id: 'e2e-pl-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should update the costHistory if the cost changes', function(done) {
            options.url = config.adsUrl + '/placements/e2e-pl-3';
            options.json = { label: 'foo bar', externalCost: { event: 'view', cost: 0.12 } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pl-3');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.externalCost).toEqual({ event: 'view', cost: 0.12 });
                expect(resp.body.costHistory).toEqual([
                    {
	                    userId: 'u-admin',
	                    user: 'adminuser',
	                    date: jasmine.any(String),
	                    externalCost: { event: 'view', cost: 0.12 }
                    },
                    {
	                    userId: 'u-other',
	                    user: 'otheruser',
	                    date: '2016-01-20T15:43:02.370Z',
	                    externalCost: { event: 'click', cost: 0.12 }
                    }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update the costHistory if the cost does not change', function(done) {
            options.url = config.adsUrl + '/placements/e2e-pl-3';
            options.json = { label: 'foo bar', externalCost: { event: 'click', cost: 0.12 } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pl-3');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.externalCost).toEqual({ event: 'click', cost: 0.12 });
                expect(resp.body.costHistory).toEqual([{
                    userId: 'u-other',
                    user: 'otheruser',
                    date: '2016-01-20T15:43:02.370Z',
                    externalCost: { event: 'click', cost: 0.12 }
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to initialize the costHistory on an existing campaign', function(done) {
            options.json = { label: 'foo bar', externalCost: { event: 'click', cost: 0.18 } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pl-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.externalCost).toEqual({ event: 'click', cost: 0.18 });
                expect(resp.body.costHistory).toEqual([{
                    userId: 'u-admin',
                    user: 'adminuser',
                    date: jasmine.any(String),
                    externalCost: { event: 'click', cost: 0.18 }
                }]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('when providing links to other entities in tagParams', function() {
            it('should succeed if all linked entities are active', function(done) {
                options.json.tagParams = {
                    container: 'box-active',
                    campaign: 'cam-active',
                    card: 'rc-active',
                    experience: 'e-active'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.tagParams).toEqual({
                        type: 'full',
                        container: 'box-active',
                        campaign: 'cam-active',
                        card: 'rc-active',
                        experience: 'e-active'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should succeed if all linked entities are inactive/paused', function(done) {
                options.json.tagParams = {
                    container: 'box-inactive',
                    campaign: 'cam-paused',
                    card: 'rc-paused',
                    experience: 'e-inactive'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.tagParams).toEqual({
                        type: 'full',
                        container: 'box-inactive',
                        campaign: 'cam-paused',
                        card: 'rc-paused',
                        experience: 'e-inactive'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are deleted', function(done) {
                q.all([
                    ['campaign', 'cam-deleted'],
                    ['card', 'rc-deleted'],
                    ['experience', 'e-deleted'],
                    ['container', 'box-deleted'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('put', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are non-existent', function(done) {
                q.all([
                    ['campaign', 'cam-boople'],
                    ['card', 'rc-snoots'],
                    ['experience', 'e-floofle'],
                    ['container', 'box-poofs'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('put', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign and card do not match', function(done) {
                options.json.tagParams = {
                    container: 'box-active',
                    campaign: 'cam-active',
                    card: 'rc-paused'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('card rc-paused not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign is canceled or expired', function(done) {
                q.all([
                    ['campaign', 'cam-expired'],
                    ['campaign', 'cam-canceled'],
                ].map(function(arr) {
                    var newOpts = JSON.parse(JSON.stringify(options));
                    newOpts.jar = nonAdminJar;
                    newOpts.json.tagParams[arr[0]] = arr[1];
                    
                    return requestUtils.qRequest('put', newOpts).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        expect(resp.body).toBe(arr[0] + ' ' + arr[1] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should preserve the tagParams.container and tagParams.campaign properties', function(done) {
            options.json.tagParams = { branding: 'c7', type: 'mobile' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pl-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.tagParams).toEqual({ container: 'box-active', campaign: 'cam-active', branding: 'c7', type: 'mobile' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('when editing a beeswax placement', function() {
            var nowStr = Date.now() + ' - ',
                createdPlacement;
            beforeEach(function(done) {
                requestUtils.qRequest('post', {
                    url: config.adsUrl + '/placements',
                    json: {
                        label: nowStr + 'e2e placement',
                        tagType: 'mraid',
                        thumbnail: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg',
                        tagParams: {
                            type: 'full',
                            container: 'beeswax',
                            campaign: 'cam-active'
                        }
                    },
                    jar: cookieJar
                })
                .then(function(resp) {
                    if (resp.response.statusCode !== 201) {
                        return q.reject('Failed creating test placement - ' + util.inspect({
                            code: resp.response.statusCode,
                            body: resp.body
                        }));
                    }
                    createdPlacement = resp.body;

                    options.url = config.adsUrl + '/placements/' + createdPlacement.id;
                    options.json = {
                        label: nowStr + 'e2e placement - updated',
                        tagType: 'mraid',
                        thumbnail: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample2.jpg',
                        tagParams: {
                            container: 'beeswax',
                            campaign: 'cam-active',
                            network: 'the social network'
                        },
                        showInTag: {
                            network: true
                        }
                    };
                }).then(done, done.fail);
            });
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'pl-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.user = 'me';
            options.json.org = 'us';
            options.json.costHistory = [{ yesterday: 'expensive' }];
            options.json.lastUpdated = new Date(Date.now() - 99999999);
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('pl-fake');
                expect(resp.body.user).toBe('u-selfie');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.costHistory).not.toBeDefined();
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(options.json.lastUpdated);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should only allow a non-admin to edit their own placements', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-pl-1', 'e2e-pl-2'].map(function(id) {
                options.url = config.adsUrl + '/placements/' + id;
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.id).toBe('e2e-pl-1');
                expect(results[0].body.label).toBe('foo bar');
                expect(results[0].body.tagParams).toEqual({ type: 'mobile', container: 'box-active', campaign: 'cam-active' });
                
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to edit this');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a placement that has been deleted', function(done) {
            options.url = config.adsUrl + '/placements/e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a placement if it does not exist', function(done) {
            options.url = config.adsUrl + '/placements/e2e-pl-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
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

        it('should allow an app to edit a placement', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-pl-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.tagParams).toEqual({ type: 'mobile', container: 'box-active', campaign: 'cam-active' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/placements/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockPlacements = [
                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-1', campaign: 'cam-1' }
                },
                {
	                id: 'e2e-pl-2',
	                status: 'active',
	                user: 'u-admin',
	                org: 'o-admin',
	                tagParams: { type: 'full', container: 'box-2', campaign: 'cam-2' }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagParams: { type: 'full', container: 'box-gone', campaign: 'cam-gone' }
                }
            ];
            options = {
                url: config.adsUrl + '/placements/e2e-pl-1',
                jar: cookieJar
            };
            testUtils.resetCollection('placements', mockPlacements).done(done);
        });

        it('should delete a placement', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.adsUrl + '/placements/e2e-pl-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                return q.delay(2000).then(function() {
                    return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
                });
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/placements/:id',
                                                 params: { id: 'e2e-pl-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow non-admins to delete their own placements', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-pl-1', 'e2e-pl-2'].map(function(id) {
                options.url = config.adsUrl + '/placements/' + id;
                return requestUtils.qRequest('delete', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(204);
                expect(results[0].body).toBe('');
                
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to delete this');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the placement has been deleted', function(done) {
            options.url = config.adsUrl + '/placements/e2e-deleted';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the placement does not exist', function(done) {
            options.url = config.adsUrl + '/placements/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/placements/e2e-pl-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to delete a placement', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'delete', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
