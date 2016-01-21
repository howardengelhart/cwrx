var q               = require('q'),
    util            = require('util'),
    urlUtils        = require('url'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('content experience endpoints (E2E):', function() {
    var cookieJar, mockUsers;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;

        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUsers = [
            {
                id: 'e2e-user',
                status: 'active',
                email : 'contente2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'e2e-org',
                applications: ['e2e-app1'],
                permissions: {
                    experiences: {
                        read: 'org',
                        create: 'own',
                        edit: 'own',
                        delete: 'own'
                    }
                }
            },
            {
                id: 'admin-e2e-user',
                status: 'active',
                email : 'admine2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'admin-e2e-org',
                applications: ['e2e-app1'],
                permissions: {
                    experiences: {
                        read: 'all',
                        create: 'all',
                        edit: 'all',
                        delete: 'all'
                    }
                }
            },
        ];
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'contente2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUsers).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/public/content/experiences/:id', function() {
        var start = new Date(),
            mockExps, mockCampaigns, mockCards, options;
        
        describe('basic tests:', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e-pubget1',
                    qs: {
                        campaign: 'cam-qp1',
                        container: 'embed',
                        placement: 'pl-1',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
                mockExps = [
                    {
                        id: 'e-pubget1',
                        data: [{ data: { foo: 'bar', title: 'test exp' }, versionId: 'a5e744d0' }],
                        access: 'public',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        status: [{ status: 'active', date: start }]
                    },
                    {
                        id: 'e-deleted',
                        data: [{ data: { foo: 'bar', title: 'test exp' }, versionId: 'a5e744d0' }],
                        access: 'public',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        status: [{ status: 'deleted', date: start }]
                    }
                ];
                q.all([
                    testUtils.resetCollection('experiences', mockExps)
                ]).done(function() { done(); });
            });

            it('should get an experience by id', function(done) {
                options.qs.pageUrl = 'clickhole.com';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.id).toBe('e-pubget1');
                    expect(resp.body.title).toBe('test exp');
                    expect(resp.body.data).toEqual({
                        foo: 'bar',
                        title: 'test exp',
                        campaign: { launchUrls: [ jasmine.any(String) ] },
                        branding: jasmine.any(String)
                    });

                    var parsed = urlUtils.parse(resp.body.data.campaign.launchUrls[0], true, true);
                    expect(parsed.host).toBeDefined();
                    expect(parsed.pathname).toBeDefined();
                    expect(parsed.query).toEqual({
                        campaign    : 'cam-qp1',
                        experience  : 'e-pubget1',
                        container   : 'embed',
                        placement   : 'pl-1',
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

            it('should not get tracking pixels if the request is in preview mode',function(done){
                options.qs.preview = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.data.campaign).toEqual({ });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
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
                options.url = config.contentUrl + '/public/content/experiences/e-SDFUWEORILDJ';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toEqual('Experience not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should return a 404 if the experience is deleted', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e-deleted';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toEqual('Experience not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            describe('if the url extension is .js', function() {
                it('should return the experience as a CommonJS module if the extension is .js', function(done) {
                    options.url = config.contentUrl + '/public/content/experiences/e-pubget1.js';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toMatch(/module\.exports = {.*"id":"e-pubget1".*};/);
                        expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
                
                it('should return errors in normal format', function(done) {
                    options = { url: config.contentUrl + '/public/content/experiences/e-deleted.js' };
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(404);
                        expect(resp.body).toBe('Experience not found');
                        expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            describe('if the url extension is .json', function() {
                it('should return the experience as JSON normally', function(done) {
                    options.url = config.contentUrl + '/public/content/experiences/e-pubget1.json';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.id).toBe('e-pubget1');
                        expect(resp.body.title).toBe('test exp');
                        expect(resp.body.data).toEqual({
                            foo: 'bar',
                            title: 'test exp',
                            campaign: { launchUrls: [ jasmine.any(String) ] },
                            branding: jasmine.any(String)
                        });
                        expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                        expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                        expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
        });
        
        describe('when handling branding', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e-withBranding',
                    headers: { origin: 'http://test.c6.com' },
                    qs: { branding: 'qpBrand' }
                };
                mockExps = [
                    {
                        id: 'e-withBranding',
                        data: [{ data: { foo: 'bar', branding: 'expBrand' } }],
                        access: 'public',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        status: [{ status: 'active' }]
                    },
                    {
                        id: 'e-noBranding',
                        data: [ { data: {foo: 'baz' } } ],
                        access: 'public',
                        status: [{ status: 'active' }],
                        user: 'e2e-user',
                        org: 'e2e-org'
                    }
                ];
                testUtils.resetCollection('experiences', mockExps).done(done);
            });
            
            it('should prefer branding from the experience', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e-withBranding');
                    expect(resp.body.data.branding).toBe('expBrand');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should fall back to branding from query params', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e-noBranding';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e-noBranding');
                    expect(resp.body.data.branding).toBe('qpBrand');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should finally fall back to some defaults', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e-noBranding';
                delete options.qs.branding;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e-noBranding');
                    expect(resp.body.data.branding).toBe('default');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('when handling campaigns', function() {
            beforeEach(function(done) {
                options = {
                    url: config.contentUrl + '/public/content/experiences/e-getcamps1',
                    qs: {
                        campaign: 'cam-pubexp1',
                        container: 'embed',
                        placement: 'pl-1',
                        pageUrl: 'clickhole.com',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
                mockExps = [{
                    id: 'e-getcamps1',
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
                    { id: 'rc-sp1', campaign: { minViewTime: 1 }, campaignId: 'cam-pubexp1', status: 'active', foo: 'baz' },
                    { id: 'rc-sp2', campaign: { minViewTime: 2 }, campaignId: 'cam-pubexp1', status: 'active', foo: 'buz' },
                    { id: 'rc-sp3', campaign: { minViewTime: 3 }, campaignId: 'cam-pubexp1', status: 'inactive', foo: 'boz' },
                    { id: 'rc-sp4', campaign: { minViewTime: 4 }, campaignId: 'cam-pubexp2', status: 'active', foo: 'buz' },
                    { id: 'rc-sp5', campaign: { minViewTime: 5 }, campaignId: 'cam-canceled', status: 'active', foo: 'buz' },
                    { id: 'rc-sp6', campaign: { minViewTime: 6 }, campaignId: 'cam-expired', status: 'active', foo: 'buz' },
                    { id: 'rc-sp7', campaign: { minViewTime: 7 }, campaignId: 'cam-deleted', status: 'active', foo: 'buz' },
                ];
                mockCampaigns = [
                    {
                        id: 'cam-pubexp1',
                        status: 'active',
                        advertiserId: 'a-1',
                        advertiserDisplayName: 'Heinz',
                        cards: [{ id: 'rc-sp1' }, { id: 'rc-sp2' }, { id: 'rc-sp3' }],
                        staticCardMap: {
                            'e-getcamps1': {
                                'rc-p1': 'rc-sp1',
                                'rc-p2': 'rc-sp2',
                                'rc-p3': 'rc-sp3',
                            }
                        }
                    },
                    { id: 'cam-pubexp2', status: 'active', cards: [{ id: 'rc-sp4' }], staticCardMap: { 'e-getcamps2': { 'rc-p1': 'rc-sp1' } } },
                    { id: 'cam-canceled', status: 'canceled', cards: [{ id: 'rc-sp5' }], staticCardMap: { 'e-getcamps1': { 'rc-p1': 'rc-sp5' } } },
                    { id: 'cam-expired', status: 'expired', cards: [{ id: 'rc-sp6' }], staticCardMap: { 'e-getcamps1': { 'rc-p1': 'rc-sp6' } } },
                    { id: 'cam-deleted', status: 'deleted', cards: [{ id: 'rc-sp7' }], staticCardMap: { 'e-getcamps1': { 'rc-p1': 'rc-sp7' } } },
                ];
                q.all([testUtils.resetCollection('experiences', mockExps),
                       testUtils.resetCollection('cards', mockCards),
                       testUtils.resetCollection('campaigns', mockCampaigns)
                ]).done(function() { done(); });
            });
            
            it('should fetch a campaign and insert active sponsored cards specified in the staticCardMap', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e-getcamps1');
                    expect(resp.body.data.deck).toEqual([
                        { id: 'rc-1', foo: 'bar' },
                        {
                            id: 'rc-sp1',
                            campaignId: 'cam-pubexp1',
                            params: { sponsor: 'Heinz' },
                            status: 'active',
                            foo: 'baz',
                            campaign: jasmine.any(Object)
                        },
                        {
                            id: 'rc-sp2',
                            campaignId: 'cam-pubexp1',
                            params: { sponsor: 'Heinz' },
                            status: 'active',
                            foo: 'buz',
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
                                experience  : 'e-getcamps1',
                                container   : 'embed',
                                placement   : 'pl-1',
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
                    expect(resp.body.id).toBe('e-getcamps1');
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
                    expect(resp.body.id).toBe('e-getcamps1');
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
                        expect(resp.body.id).toBe('e-getcamps1');
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
        
        describe('when controlling access to experiences', function() {
            beforeEach(function(done) {
                options = { headers: { origin: 'http://fake.com' } };
                mockExps = [
                    { id: 'e-access-1', status: [{ status: 'pending' }], access: 'public' },
                    { id: 'e-access-2', status: [{ status: 'active' }], access: 'private' }
                ];
                testUtils.resetCollection('experiences', mockExps).done(function() { done(); });
            });

            it('should only get pending, public experiences if the origin is cinema6.com', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e-access-1';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Experience not found');
                    options.headers.origin = 'https://staging.cinema6.com';
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e-access-1', data: jasmine.any(Object), status: 'pending', access: 'public'});
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should only get active, private experiences if the origin is not cinema6.com', function(done) {
                options.url = config.contentUrl + '/public/content/experiences/e-access-2';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e-access-2', data: jasmine.any(Object), status: 'active', access: 'private'});
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
                options.url = config.contentUrl + '/public/content/experiences/e-access-1';
                options.headers = { referer: 'https://staging.cinema6.com' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({id: 'e-access-1', data: jasmine.any(Object), status: 'pending', access: 'public'});
                    options.url = config.contentUrl + '/public/content/experiences/e-access-2';
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


    describe('GET /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: 'e2e-getid1',
                    access: 'public',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-getid2',
                    access: 'public',
                    status: [{status: 'active', date: new Date()}],
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-getid3',
                    access: 'public',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-app1',
                    access: 'private',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'admin',
                    org: 'admin'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });

        it('should get an experience by id', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-getid1');
                expect(resp.body.data).not.toBeDefined();
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid1', jar: cookieJar};
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/content/experience/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should let a user specify which fields to return', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-getid1',
                qs: { fields: 'id,user' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    user: 'e2e-user'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should treat the user as a guest for experiences they do not own', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                options.url = config.contentUrl + '/content/experience/e2e-getid3';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should let a user get a private experience in their applications list', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-app1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-app1');
                expect(resp.body.user).toBe('admin');
                expect(resp.body.org).toBe('admin');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.contentUrl + '/content/experience/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Experience not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/content/experiences', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: 'e2e-getquery1',
                    status: [{status: 'inactive', date: new Date()}],
                    data: [{ data: { foo: 'bar', title: 'foo bar Baz' } }],
                    categories: ['food', 'sports'],
                    campaignId: 'cam-1',
                    access: 'private',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery2',
                    status: [{status: 'inactive', date: new Date()}],
                    data: [{ data: { foo: 'bar', title: 'bar Foo baz' } }],
                    categories: ['baseball', 'food'],
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                    type: 'bar'
                },
                {
                    id: 'e2e-getquery3',
                    status: [{status: 'active', date: new Date()}],
                    data: [{ data: { foo: 'bar', title: 'foo Bar' } }],
                    categories: ['soccer'],
                    campaignId: 'cam-2',
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery4',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery5',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'public',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery6',
                    status: [{status: 'deleted', date: new Date()}],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery7',
                    status: [{status: 'active', date: new Date()}],
                    categories: ['baseball', 'yankees'],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });

        it('should get multiple experiences by id', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery3&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[0].data).toEqual({foo: 'bar', title: 'foo bar Baz'});
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.body[1].data).toEqual({foo: 'bar', title: 'foo Bar'});
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.contentUrl + '/content/experiences?ids=e2e-getquery1&sort=id,1', jar: cookieJar};
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/content/experiences/',
                                                 params: {}, query: { ids: 'e2e-getquery1', sort: 'id,1' } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should let a user specifiy which fields to return', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences',
                qs: {
                    ids: 'e2e-getquery1,e2e-getquery3',
                    fields: 'user,data.foo',
                    sort: 'id,1'
                },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    {
                        id: 'e2e-getquery1',
                        user: 'e2e-user',
                        data: { foo: 'bar' }
                    },
                    {
                        id: 'e2e-getquery3',
                        user: 'not-e2e-user',
                        data: { foo: 'bar' }
                    }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should guard against invalid fields params', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences',
                qs: {
                    ids: 'e2e-getquery1,e2e-getquery3',
                    fields: { foo: 'bar' },
                    sort: 'id,1'
                },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1' },
                    { id: 'e2e-getquery3' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get experiences by user', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery7');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get experiences by type', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get experiences by org', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?org=e2e-org&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery7');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get experiences by status', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?status=inactive&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get experiences by text search', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences',
                qs: { text: 'foo bar', sort: 'id,1' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');

                options.qs.text = 'baz';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).finally(done);
        });
        
        it('should get experiences by categories', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?categories=baseball,food&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery7');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        ['ids', 'categories'].forEach(function(param) {
            it('should get no experiences if the ' + param + ' param is empty', function(done) {
                var options = {
                    url: config.contentUrl + '/content/experiences',
                    qs: { sort: 'id,1' },
                    jar: cookieJar
                };
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
        
        it('should get sponsored experiences', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?sponsored=true&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get non-sponsored experiences', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?sponsored=false&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery7');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a user to query for deleted experiences', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?status=deleted&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot get deleted experiences');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to combine query params', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&org=e2e-org&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not get experiences by any other query param', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?tag=foo&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must specify at least one supported query param');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only get private or inactive experiences the user owns', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery2,e2e-getquery4',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should use the origin header for access control', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                headers: { origin: 'https://staging.cinema6.com' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and empty array if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=hamboneHarry',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            var options = {
                jar: cookieJar,
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery2,e2e-getquery3' +
                                         '&limit=2&sort=id,-1'
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.url += '&skip=2';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 3-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user[$gt]=',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user'
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/content/experience', function() {
        var mockExp, options;
        beforeEach(function(done) {
            mockExp = {
                tag: 'testExp',
                data: { foo: 'bar' },
                org: 'e2e-org'
            };
            options = {
                url: config.contentUrl + '/content/experience',
                jar: cookieJar,
                json: mockExp
            };
            testUtils.resetCollection('experiences').done(done);
        });

        it('should be able to create an experience', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.versionId).toBe('a5e744d0');
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('pending');
                expect(resp.body.access).toBe('public');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/content/experience/', params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create an active, private experience', function(done) {
            mockExp.status = 'active';
            mockExp.access = 'private';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.status).toBe('active');
                expect(new Date(resp.body.lastStatusChange).toString()).not.toEqual('Invalid Date');
                expect(resp.body.access).toBe('private');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off certain fields not allowed on the top level', function(done) {
            mockExp.title = 'bad title location';
            mockExp.versionId = 'tha best version';
            mockExp.data.title = 'data title';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe('data title');
                expect(resp.body.versionId).toBe('14eb66c8');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an admin to set a different user and org for the experience', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                mockExp.user = 'another-user';
                mockExp.org = 'another-org';
                options.jar = altJar;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a regular user to set a different user and org for the experience', function(done) {
            mockExp.user = 'another-user';
            mockExp.org = 'another-org';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

    });

    describe('PUT /api/content/experience/:id', function() {
        var mockExps, now, updatedExp;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            mockExps = [
                {
                    id: 'e2e-put1',
                    data: [ { data: { foo: 'bar', adConfig: { ads: 'good' } }, versionId: 'a5e744d0' } ],
                    tag: 'origTag',
                    status: 'active',
                    access: 'public',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-put2',
                    status: 'active',
                    access: 'public',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });

        it('should successfully update an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { tag: 'newTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockExps[0]);
                expect(updatedExp).toBeDefined();
                expect(updatedExp._id).not.toBeDefined();
                expect(updatedExp.id).toBe('e2e-put1');
                expect(updatedExp.tag).toBe('newTag');
                expect(updatedExp.user).toBe('e2e-user');
                expect(updatedExp.versionId).toBe('a5e744d0');
                expect(updatedExp.data).toEqual({foo: 'bar', adConfig: {ads: 'good'}});
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { tag: 'newTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/content/experience/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly update the data and versionId together', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { data: { foo: 'baz' } }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockExps[0]);
                expect(updatedExp).toBeDefined();
                expect(updatedExp._id).not.toBeDefined();
                expect(updatedExp.data).toEqual({foo: 'baz'});
                expect(updatedExp.versionId).toBe('4c5c9754');
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should not create an experience if it does not exist', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-putfake',
                jar: cookieJar,
                json: { tag: 'fakeTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should not edit an experience that has been deleted', function(done) {
            var url = config.contentUrl + '/content/experience/e2e-put1',
                putOpts = { url: url, jar: cookieJar, json: { tag: 'fakeTag' } },
                deleteOpts = { url: url, jar: cookieJar };
            requestUtils.qRequest('delete', deleteOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('put', putOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should not update an experience the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put2',
                jar: cookieJar,
                json: { tag: 'newTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this experience');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should allow an admin to set a different user and org for the experience', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = {
                    url: config.contentUrl + '/content/experience/e2e-put1',
                    json: { user: 'another-user', org: 'another-org' },
                    jar: altJar
                };
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a regular user to set a different user and org for the experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                json: { user: 'another-user', org: 'another-org' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                json: { tag: 'newTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });
    });

    describe('DELETE /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: 'e2e-del1',
                    status: 'active',
                    access: 'public',
                    user: 'e2e-user'
                },
                {
                    id: 'e2e-del2',
                    status: 'active',
                    access: 'public',
                    user: 'not-e2e-user'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });

        it('should set the status of an experience to deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/experience/e2e-del1', jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/content/experience/:id',
                                                 params: { id: 'e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not delete an experience the user does not own', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this experience');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should still return a 204 if the experience was already deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should still return a 204 if the experience does not exist', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/fake'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.contentUrl + '/content/experience/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
