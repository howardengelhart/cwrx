var q               = require('q'),
    util            = require('util'),
    urlUtils        = require('url'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
    };

describe('content public endpoints (E2E):', function() {
    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;
    });

    describe('GET /api/public/content/experiences/:id', function() {
        var dateStr = String(new Date().valueOf()), // used for cache busting on site with csv branding
            start = new Date(),
            mockExps, mockOrgs, mockSites, mockCampaigns, mockCards, options;
        
        describe('basic tests:', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e2e-pubget1',
                    qs: {
                        campaign: 'cam-qp1',
                        container: 'embed',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
                mockExps = [{
                    id: 'e2e-pubget1',
                    data: [{ data: { foo: 'bar', title: 'test exp' }, versionId: 'a5e744d0' }],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    status: [{ status: 'active', date: start }]
                }];
                mockSites = [{
                    id: 'e2e-cinema6',
                    status: 'active',
                    host: 'cinema6.com',
                    branding: 'siteBrand',
                    placementId: 456,
                    wildCardPlacement: 654,
                    containers: [
                        { id: 'veeseo', contentPlacementId: 1337, displayPlacementId: 7331 },
                        { id: 'connatix', contentPlacementId: 246, displayPlacementId: 864 }
                    ]
                }];
                q.all([
                    testUtils.resetCollection('experiences', mockExps),
                    testUtils.resetCollection('sites', mockSites)
                ]).done(function() { done(); });
            });

            it('should get an experience by id', function(done) {
                options.qs.pageUrl = 'clickhole.com';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.id).toBe('e2e-pubget1');
                    expect(resp.body.title).toBe('test exp');
                    expect(resp.body.data.foo).toBe('bar');
                    expect(resp.body.data.title).toBe('test exp');

                    expect(resp.body.data.campaign).toEqual({
                        launchUrls: [ jasmine.any(String) ]
                    });
                    var parsed = urlUtils.parse(resp.body.data.campaign.launchUrls[0], true, true);
                    expect(parsed.host).toBeDefined();
                    expect(parsed.pathname).toBeDefined();
                    expect(parsed.query).toEqual({
                        campaign    : 'cam-qp1',
                        experience  : 'e2e-pubget1',
                        container   : 'embed',
                        host        : 'clickhole.com',
                        hostApp     : 'Mapsaurus',
                        network     : 'pocketmath',
                        cb          : '{cachebreaker}',
                        event       : 'launch',
                        ld          : '{launchDelay}',
                        d           : '{delay}'
                    });

                    expect(new Date(resp.body.lastStatusChange)).not.toEqual('Invalid Date');
                    expect(resp.body.user).not.toBeDefined();
                    expect(resp.body.org).not.toBeDefined();
                    expect(resp.body.versionId).toBe('a5e744d0');
                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not get tracking pixels if its a preview',function(done){
                options.qs.preview = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.data.campaign).toEqual({ });
                }).then(done,done.fail);
            });

            it('should not cache if the request is in preview mode', function(done) {
                options.qs.preview = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers['cache-control']).toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should return a 404 if nothing is found', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e2e-getid5678';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toEqual('Experience not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('setting adConfig:', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e2e-org-adConfig'
                };
                mockExps = [
                    {
                        id: 'e2e-org-adConfig',
                        data: [ { data: {foo: 'bar' }, versionId: 'a5e744d0' } ],
                        access: 'public',
                        status: [{ status: 'active' }],
                        user: 'e2e-user',
                        org: 'e2e-adCfg-org'
                    },
                    {
                        id: 'e2e-adConfig',
                        data: [{data: { foo: 'bar', adConfig: {foo: 'baz'}}, versionId: 'a5e744d0'}],
                        access: 'public',
                        status: [{ status: 'active' }],
                        user: 'e2e-user',
                        org: 'e2e-adCfg-org'
                    }
                ];
                mockOrgs = [{ id: 'e2e-adCfg-org', status: 'active', adConfig: { foo: 'bar' } }];
                q.all([
                    testUtils.resetCollection('experiences', mockExps),
                    testUtils.resetCollection('orgs', mockOrgs)
                ]).done(function() { done(); });
            });

            it('should properly get the experience\'s org\'s adConfig if it exists', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.id).toBe('e2e-org-adConfig');
                    expect(resp.body.data.adConfig).toEqual({foo: 'bar'});
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should override the org\'s adConfig if it\'s defined on the experience', function(done) {
                options.url = options.url.replace('e2e-org-adConfig', 'e2e-adConfig');
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.id).toBe('e2e-adConfig');
                    expect(resp.body.data.adConfig).toEqual({foo: 'baz'});
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('setting branding + placement ids:', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e2e-noProps',
                    headers: { origin: 'http://test.c6.com' }
                };
                mockExps = [
                    {
                        id: 'e2e-expProps',
                        data: [{ data: { foo: 'bar', branding: 'expBrand', placementId: 123,
                                         wildCardPlacement: 321 } }],
                        access: 'public',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        status: [{ status: 'active' }]
                    },
                    {
                        id: 'e2e-noProps',
                        data: [ { data: {foo: 'bar' } } ],
                        access: 'public',
                        status: [{ status: 'active' }],
                        user: 'e2e-user',
                        org: 'e2e-active-org'
                    },
                    {
                        id: 'e2e-noOrg',
                        data: [ { data: {foo: 'bar' } } ],
                        access: 'public',
                        status: [{ status: 'active' }],
                        user: 'e2e-user',
                        org: 'e2e-fake-org'
                    }
                ];
                mockOrgs = [{ id: 'e2e-active-org', status: 'active', adConfig: { foo: 'bar' }, branding: 'orgBrand' }];
                q.all([
                    testUtils.resetCollection('experiences', mockExps),
                    testUtils.resetCollection('orgs', mockOrgs)
                ]).done(function() { done(); });
            });
            
            it('should use the props from the exp if defined', function(done) {
                options.url = options.url.replace('e2e-noProps', 'e2e-expProps');
                options.qs = {branding: 'reqBrand', placementId: '789', wildCardPlacement: '987'};
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-expProps');
                    expect(resp.body.data.branding).toBe('expBrand');
                    expect(resp.body.data.placementId).toBe(123);
                    expect(resp.body.data.wildCardPlacement).toBe(321);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should use the request config props if not on the exp', function(done) {
                options.qs = {branding: 'reqBrand', placementId: '789', wildCardPlacement: '987'};
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-noProps');
                    expect(resp.body.data.branding).toBe('reqBrand');
                    expect(resp.body.data.placementId).toBe('789');
                    expect(resp.body.data.wildCardPlacement).toBe('987');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should fall back to the current site\'s config props', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-noProps');
                    expect(resp.body.data.branding).toBe('siteBrand');
                    expect(resp.body.data.placementId).toBe(456);
                    expect(resp.body.data.wildCardPlacement).toBe(654);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('handling containers', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e2e-pubget1',
                    headers: { origin: 'http://someblog.com' }
                };
                mockExps = [{
                    id: 'e2e-pubget1',
                    data: [{ data: { foo: 'bar' } }],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    status: [{ status: 'active' }]
                }];
                mockOrgs = [{ id: 'e2e-active-org', status: 'active', adConfig: { foo: 'bar' }, branding: 'orgBrand' }];
                q.all([testUtils.resetCollection('experiences', mockExps),
                       testUtils.resetCollection('orgs', mockOrgs),
                ]).done(function() { done(); });
            });

            it('should use the cinema6 site if the container is veeseo', function(done) {
                options.qs = { container: 'veeseo' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pubget1');
                    expect(resp.body.data.branding).toBe('siteBrand');
                    expect(resp.body.data.placementId).toBe(7331);
                    expect(resp.body.data.wildCardPlacement).toBe(1337);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should use the cinema6 site if the container is connatix', function(done) {
                options.qs = { container: 'connatix' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pubget1');
                    expect(resp.body.data.branding).toBe('siteBrand');
                    expect(resp.body.data.placementId).toBe(864);
                    expect(resp.body.data.wildCardPlacement).toBe(246);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should use defaults if the request\'s container is not in the site', function(done) {
                options.qs = { container: 'taboola' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pubget1');
                    expect(resp.body.data.branding).toBe('siteBrand');
                    expect(resp.body.data.placementId).toBe(456);
                    expect(resp.body.data.wildCardPlacement).toBe(654);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('handling campaigns:', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e2e-getcamps1',
                    qs: {
                        campaign: 'cam-pubexp1',
                        container: 'embed',
                        pageUrl: 'clickhole.com',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
                mockExps = [{
                    id: 'e2e-getcamps1',
                    data: [{ data: { deck: [
                        { id: 'rc-1', foo: 'bar' },
                        { id: 'rc-p1' },
                        { id: 'rc-p2' },
                        { id: 'rc-p3' },
                    ] } }],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    status: [{ status: 'active' }]
                }];
                mockCards = [
                    { id: 'rc-sp1', campaign: { adtechId: 101, bannerNumber: 11 }, campaignId: 'cam-pubexp1', status: 'active', foo: 'baz' },
                    { id: 'rc-sp2', campaign: { adtechId: 202, bannerNumber: 22 }, campaignId: 'cam-pubexp1', status: 'active', foo: 'buz' },
                    { id: 'rc-sp3', campaign: { adtechId: 303, bannerNumber: 33 }, campaignId: 'cam-pubexp1', status: 'inactive', foo: 'boz' },
                    { id: 'rc-sp4', campaign: { adtechId: 404, bannerNumber: 44 }, campaignId: 'cam-pubexp2', status: 'active', foo: 'buz' },
                    { id: 'rc-sp5', campaign: { adtechId: 505, bannerNumber: 55 }, campaignId: 'cam-canceled', status: 'active', foo: 'buz' },
                    { id: 'rc-sp6', campaign: { adtechId: 606, bannerNumber: 66 }, campaignId: 'cam-expired', status: 'active', foo: 'buz' },
                    { id: 'rc-sp7', campaign: { adtechId: 707, bannerNumber: 77 }, campaignId: 'cam-deleted', status: 'active', foo: 'buz' },
                ];
                mockCampaigns = [
                    {
                        id: 'cam-pubexp1',
                        status: 'active',
                        advertiserId: 'a-1',
                        advertiserDisplayName: 'Heinz',
                        cards: [{ id: 'rc-sp1' }, { id: 'rc-sp2' }, { id: 'rc-sp3' }],
                        staticCardMap: {
                            'e2e-getcamps1': {
                                'rc-p1': 'rc-sp1',
                                'rc-p2': 'rc-sp2',
                                'rc-p3': 'rc-sp3',
                            }
                        }
                    },
                    {
                        id: 'cam-pubexp2',
                        status: 'active',
                        cards: [{ id: 'rc-sp4', status: 'active', adtechId: 14, bannerId: 4321, bannerNumber: 1 }],
                        staticCardMap: { 'e2e-getcamps2': { 'rc-p1': 'rc-sp1' } }
                    },
                    { id: 'cam-canceled', status: 'canceled', cards: [{ id: 'rc-sp5' }], staticCardMap: { 'e2e-getcamps1': { 'rc-p1': 'rc-sp5' } } },
                    { id: 'cam-expired', status: 'expired', cards: [{ id: 'rc-sp6' }], staticCardMap: { 'e2e-getcamps1': { 'rc-p1': 'rc-sp6' } } },
                    { id: 'cam-deleted', status: 'deleted', cards: [{ id: 'rc-sp7' }], staticCardMap: { 'e2e-getcamps1': { 'rc-p1': 'rc-sp7' } } },
                ];
                q.all([testUtils.resetCollection('experiences', mockExps),
                       testUtils.resetCollection('cards', mockCards),
                       testUtils.resetCollection('campaigns', mockCampaigns)
                ]).done(function() { done(); });
            });
            
            it('should fetch a campaign and insert active sponsored cards specified in the staticCardMap', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-getcamps1');
                    expect(resp.body.data.deck).toEqual([
                        { id: 'rc-1', foo: 'bar' },
                        {
                            id: 'rc-sp1',
                            campaignId: 'cam-pubexp1',
                            params: { sponsor: 'Heinz' },
                            status: 'active',
                            foo: 'baz',
                            adtechId: 101,
                            bannerId: 11,
                            campaign: jasmine.any(Object)
                        },
                        {
                            id: 'rc-sp2',
                            campaignId: 'cam-pubexp1',
                            params: { sponsor: 'Heinz' },
                            status: 'active',
                            foo: 'buz',
                            adtechId: 202,
                            bannerId: 22,
                            campaign: jasmine.any(Object)
                        },
                        { id: 'rc-p3' }
                    ]);
                    
                    ['rc-sp1', 'rc-sp2'].forEach(function(cardId) {
                        var card = resp.body.data.deck.filter(function(deckCard) { return deckCard.id === cardId; })[0];
                        if (!card) {
                            expect(card).toBeDefined();
                            return;
                        }

                        [
                            { prop: 'bufferUrls', event: 'buffer' },
                            { prop: 'viewUrls', event: 'cardView' },
                            { prop: 'playUrls', event: 'play' },
                            { prop: 'loadUrls', event: 'load' },
                            { prop: 'countUrls', event: 'completedView' },
                            { prop: 'q1Urls', event: 'q1' },
                            { prop: 'q2Urls', event: 'q2' },
                            { prop: 'q3Urls', event: 'q3' },
                            { prop: 'q4Urls', event: 'q4' }
                        ].forEach(function(obj) {
                            var parsed = urlUtils.parse(card.campaign[obj.prop][0], true, true);
                            expect(parsed.host).toBeDefined();
                            expect(parsed.pathname).toBeDefined();

                            var expectedQuery = {
                                campaign    : 'cam-pubexp1',
                                card        : cardId,
                                experience  : 'e2e-getcamps1',
                                container   : 'embed',
                                host        : 'clickhole.com',
                                hostApp     : 'Mapsaurus',
                                network     : 'pocketmath',
                                cb          : '{cachebreaker}',
                                event       : obj.event,
                                d           : '{delay}'
                            };
                            if (obj.prop === 'playUrls') {
                                expectedQuery.pd = '{playDelay}';
                            } else if (obj.prop === 'loadUrls') {
                                expectedQuery.ld = '{loadDelay}';
                            }
                            expect(parsed.query).toEqual(expectedQuery);
                        });
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter the deck if the campaign has no staticCardMap for this experience', function(done) {
                options.qs.campaign = 'cam-pubexp2';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-getcamps1');
                    expect(resp.body.data.deck).toEqual([
                        { id: 'rc-1', foo: 'bar' },
                        { id: 'rc-p1' },
                        { id: 'rc-p2' },
                        { id: 'rc-p3' }
                    ]);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not alter the deck if the campaign is not found', function(done) {
                options.qs.campaign = 'cam-fake';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-getcamps1');
                    expect(resp.body.data.deck).toEqual([
                        { id: 'rc-1', foo: 'bar' },
                        { id: 'rc-p1' },
                        { id: 'rc-p2' },
                        { id: 'rc-p3' }
                    ]);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter the deck if the campaign is not running', function(done) {
                q.all(['cam-canceled', 'cam-expired', 'cam-deleted'].map(function(campId) {
                    options.qs.campaign = campId;
                    return requestUtils.qRequest('get', options);
                })).then(function(results) {
                    results.forEach(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.id).toBe('e2e-getcamps1');
                        expect(resp.body.data.deck).toEqual([
                            { id: 'rc-1', foo: 'bar' },
                            { id: 'rc-p1' },
                            { id: 'rc-p2' },
                            { id: 'rc-p3' }
                        ]);
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('access control:', function() {
            beforeEach(function(done) {
                options = { headers: { origin: 'http://fake.com' } };
                mockExps = [
                    { id: 'e2e-pubget2', status: [{status: 'pending'}], access: 'public' },
                    { id: 'e2e-pubget3', status: [{status: 'active'}], access: 'private' }
                ];
                testUtils.resetCollection('experiences', mockExps).done(function() { done(); });
            });

            it('should only get pending, public experiences if the origin is cinema6.com', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e2e-pubget2';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Experience not found');
                    options.headers.origin = 'https://staging.cinema6.com';
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e2e-pubget2', data: jasmine.any(Object), status: 'pending', access: 'public'});
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should only get active, private experiences if the origin is not cinema6.com', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e2e-pubget3';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e2e-pubget3', data: jasmine.any(Object), status: 'active', access: 'private'});
                    options.headers.origin = 'https://staging.cinema6.com';
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Experience not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should use the referer header for access control if origin is not defined', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e2e-pubget2';
                options.headers = { referer: 'https://staging.cinema6.com' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e2e-pubget2', data: jasmine.any(Object), status: 'pending', access: 'public'});
                    options.url = config.contentUrl + '/public/content/experiences/e2e-pubget3';
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Experience not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    /* Currently, this endpoint is identical to GET /api/public/experiences/:id, so only one test is
     * included here as a sanity check. If the endpoints diverge, additional tests should be written. */
    describe('GET /api/public/experiences/:id.json', function() {
        var mockExp, mockOrg, options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/public/content/experiences/e2e-pubgetjson1.json' };
            mockExp = { id: 'e2e-pubgetjson1', access: 'public', status: 'active' };
            testUtils.resetCollection('experiences', mockExp).done(done);
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pubgetjson1');
                expect(resp.body.status).toBe('active');
                expect(resp.body.access).toBe('public');
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    // Sanity check that singular version of endpoint works too
    describe('GET /api/public/experience/:id', function() {
        var mockExp, mockOrg, options;
        beforeEach(function() {
            options = { url: config.contentUrl + '/public/content/experience/e2e-pubget1' };
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pubget1');
                expect(resp.body.status).toBe('active');
                expect(resp.body.access).toBe('public');
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    /* Currently this endpoint is mostly identical to GET /api/public/experiences/:id, so two tests
     * are included to verify that the output is formatted correctly. If the endpoints diverge,
     * additional tests should be written. */
    describe('GET /api/public/experiences/:id.js', function() {
        var mockExp, mockOrg, options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/public/content/experiences/e2e-pubgetjs1.js' };
            mockExp = { id: 'e2e-pubgetjs1', access: 'public', status: 'active' };
            testUtils.resetCollection('experiences', mockExp).done(done);
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.match(/module\.exports = {.*"id":"e2e-pubgetjs1".*};/)).toBeTruthy();
                expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return errors in normal format', function(done) {
            options = { url: config.contentUrl + '/public/content/experiences/e2e-fake.js' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});

