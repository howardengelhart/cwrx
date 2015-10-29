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

describe('content card endpoints (E2E):', function() {
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
                permissions: {
                    cards: {
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
                permissions: {
                    cards: {
                        read: 'all',
                        create: 'all'
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
    
    describe('public endpoints', function() {
        var mockCards, mockCamp, options;
        beforeEach(function(done) {
            mockCards = [
                { id: 'e2e-pubget1', campaignId: 'cam-1', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'e2e-pubget2', campaignId: 'cam-2', status: 'inactive', user: 'e2e-user', org: 'e2e-org' },
                { id: 'e2e-pubget3', campaignId: 'cam-3', status: 'deleted', user: 'e2e-user', org: 'e2e-org' }
            ];
            mockCamp = {
                id: 'cam-1',
                status: 'active',
                advertiserId: 'a-1',
                cards: [{ id: 'e2e-pubget1', adtechId: 10, bannerNumber: 1 }]
            };
            options = {
                url: config.contentUrl + '/public/content/card/e2e-pubget1',
                headers: { origin: 'http://test.com' },
                qs: {
                    container: 'embed',
                    hostApp: 'Mapsaurus',
                    network: 'pocketmath'
                }
            };
            q.all([
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('campaigns', mockCamp),
            ]).done(function() { done(); });
        });
    
        describe('GET /api/public/content/card/:id', function() {
            it('should get an active card by id', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e2e-pubget1',
                        status: 'active',
                        campaignId: 'cam-1',
                        advertiserId: 'a-1',
                        adtechId: 10,
                        bannerId: 1,
                        campaign: {
                            viewUrls: [jasmine.any(String)],
                            playUrls: [jasmine.any(String)],
                            loadUrls: [jasmine.any(String)],
                            countUrls: [jasmine.any(String)],
                            q1Urls: [jasmine.any(String)],
                            q2Urls: [jasmine.any(String)],
                            q3Urls: [jasmine.any(String)],
                            q4Urls: [jasmine.any(String)]
                        }
                    });
                    
                    [
                        { prop: 'viewUrls', event: 'cardView' },
                        { prop: 'playUrls', event: 'play' },
                        { prop: 'loadUrls', event: 'load' },
                        { prop: 'countUrls', event: 'completedView' },
                        { prop: 'q1Urls', event: 'q1' },
                        { prop: 'q2Urls', event: 'q2' },
                        { prop: 'q3Urls', event: 'q3' },
                        { prop: 'q4Urls', event: 'q4' }
                    ].forEach(function(obj) {
                        var parsed = urlUtils.parse(resp.body.campaign[obj.prop][0], true, true);
                        expect(parsed.host).toBeDefined();
                        expect(parsed.pathname).toBeDefined();

                        var expectedQuery = {
                            campaign    : 'cam-1',
                            card        : 'e2e-pubget1',
                            experience  : '',
                            container   : 'embed',
                            host        : 'test.com',
                            hostApp     : 'Mapsaurus',
                            network     : 'pocketmath',
                            cb          : '{cachebreaker}',
                            event       : obj.event
                        };
                        if (obj.prop === 'playUrls') {
                            expectedQuery.pd = '{playDelay}';
                        } else if (obj.prop === 'loadUrls') {
                            expectedQuery.ld = '{loadDelay}';
                        }
                        expect(parsed.query).toEqual(expectedQuery);
                    });

                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should allow passing an experience id as a query param', function(done) {
                options.qs.experience = 'e-1';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e2e-pubget1',
                        status: 'active',
                        campaignId: 'cam-1',
                        advertiserId: 'a-1',
                        adtechId: 10,
                        bannerId: 1,
                        campaign: jasmine.any(Object)
                    });
                    
                    ['viewUrls', 'playUrls', 'loadUrls', 'countUrls', 'q1Urls', 'q2Urls', 'q3Urls', 'q4Urls'].forEach(function(prop) {
                        var parsed = urlUtils.parse(resp.body.campaign[prop][0], true, true);
                        expect(parsed.query.experience).toBe('e-1');
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            describe('if retrieving a card with links', function() {
                beforeEach(function(done) {
                    mockCards.push({
                        id: 'e2e-pubgetlinks',
                        campaignId: 'cam-links',
                        status: 'active',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        links: {
                            Facebook: 'http://facebook.com/foo',
                            Twitter: 'http://twitter.com/bar'
                        }
                    });
                    mockCamp.cards.push({ id: 'e2e-pubgetlinks', adtechId: 14, bannerNumber: 2 });
                    mockCamp.id = 'cam-links';
                    options.url = config.contentUrl + '/public/content/card/e2e-pubgetlinks';
                    q.all([
                        testUtils.resetCollection('cards', mockCards),
                        testUtils.resetCollection('campaigns', mockCamp)
                    ]).done(function() { done(); });
                });
                
                it('should add tracking pixels for the card\'s links', function(done) {
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toEqual({
                            id: 'e2e-pubgetlinks',
                            status: 'active',
                            campaignId: 'cam-links',
                            advertiserId: 'a-1',
                            adtechId: 14,
                            bannerId: 2,
                            campaign: jasmine.any(Object),
                            links: {
                                Facebook: {
                                    uri: 'http://facebook.com/foo',
                                    tracking: [jasmine.any(String)]
                                },
                                Twitter: {
                                    uri: 'http://twitter.com/bar',
                                    tracking: [jasmine.any(String)]
                                }
                            }
                        });

                        ['Facebook', 'Twitter'].forEach(function(prop) {
                            var parsed = urlUtils.parse(resp.body.links[prop].tracking[0], true, true);
                            expect(parsed.host).toBeDefined();
                            expect(parsed.pathname).toBeDefined();
                            expect(parsed.query).toEqual({
                                campaign    : 'cam-links',
                                card        : 'e2e-pubgetlinks',
                                experience  : '',
                                container   : 'embed',
                                host        : 'test.com',
                                hostApp     : 'Mapsaurus',
                                network     : 'pocketmath',
                                cb          : '{cachebreaker}',
                                event       : 'link.' + prop
                            });
                        });
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            it('should not show inactive or deleted cards', function(done) {
                q.all(['e2e-pubget2', 'e2e-pubget3'].map(function(id) {
                    options.url = options.url.replace('e2e-pubget1', id);
                    return requestUtils.qRequest('get', options);
                }))
                .then(function(results) {
                    results.forEach(function(resp) {
                        expect(resp.response.statusCode).toBe(404);
                        expect(resp.body).toBe('Card not found');
                        expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                        expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 404 for nonexistent cards', function(done) {
                options.url = options.url.replace('e2e-pubget1', 'e2e-fake');
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Card not found');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not cache if the origin is staging.cinema6.com or portal.cinema6.com', function(done) {
                q.all(['http://staging.cinema6.com', 'http://portal.cinema6.com'].map(function(origin) {
                    options.headers.origin = origin;
                    return requestUtils.qRequest('get', options);
                })).then(function(results) {
                    results.forEach(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.response.headers['cache-control']).toBe('max-age=0');
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        /* Currently, this endpoint is identical to GET /api/public/card/:id, so only one test is
         * included here as a sanity check. If the endpoints diverge, additional tests should be written. */
        describe('GET /api/public/card/:id.json', function() {
            it('should get a card by id', function(done) {
                options.url = config.contentUrl + '/public/content/card/e2e-pubget1.json';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e2e-pubget1',
                        status: 'active',
                        campaignId: 'cam-1',
                        advertiserId: 'a-1',
                        adtechId: 10,
                        bannerId: 1,
                        campaign: jasmine.any(Object)
                    });
                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        /* Currently this endpoint is mostly identical to GET /api/public/card/:id, so two tests
         * are included to verify that the output is formatted correctly. If the endpoints diverge,
         * additional tests should be written. */
        describe('GET /api/public/card/:id.js', function() {
            var mockCard, mockOrg, options;
            beforeEach(function(done) {
                options = { url: config.contentUrl + '/public/content/card/e2e-pubgetjs1.js' };
                mockCard = { id: 'e2e-pubgetjs1', status: 'active', campaignId: 'cam-1' };
                testUtils.resetCollection('cards', mockCard).done(done);
            });

            it('should get a card by id', function(done) {
                options.url = config.contentUrl + '/public/content/card/e2e-pubget1.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toMatch(/module\.exports = {.*"id":"e2e-pubget1".*};/);
                    expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should return errors in normal format', function(done) {
                options.url = config.contentUrl + '/public/content/card/e2e-fake.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Card not found');
                    expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    describe('GET /api/content/card/:id', function() {
        beforeEach(function(done) {
            var mockCards = [
                {
                    id: 'e2e-getid1',
                    campaignId: 'cam-1',
                    status: 'inactive',
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-getid2',
                    campaignId: 'cam-2',
                    status: 'active',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-getid3',
                    campaignId: 'cam-3',
                    status: 'inactive',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should get a card by id', function(done) {
            var options = {url: config.contentUrl + '/content/card/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-getid1');
                expect(resp.body.campaignId).toBe('cam-1');
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.contentUrl + '/content/card/e2e-getid1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/content/card/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            var options = {
                url: config.contentUrl + '/content/card/e2e-getid1',
                qs: { fields: 'campaignId,status' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    campaignId: 'cam-1',
                    status: 'inactive'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should let the user see active cards they do not own', function(done) {
            var options = {url: config.contentUrl + '/content/card/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                options.url = config.contentUrl + '/content/card/e2e-getid3';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.contentUrl + '/content/card/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.contentUrl + '/content/card/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/content/cards', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/content/cards', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockCards = [
                {
                    id: 'e2e-getquery1',
                    status: 'inactive',
                    campaignId: 'cam-123',
                    user: 'e2e-user',
                    org: 'e2e-org',
                },
                {
                    id: 'e2e-getquery2',
                    status: 'inactive',
                    campaignId: 'cam-234',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                },
                {
                    id: 'e2e-getquery3',
                    status: 'active',
                    campaignId: 'cam-345',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                },
                {
                    id: 'e2e-getquery4',
                    status: 'inactive',
                    campaignId: 'cam-456',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                },
                {
                    id: 'e2e-getquery5',
                    status: 'deleted',
                    campaignId: 'cam-567',
                    user: 'e2e-user',
                    org: 'e2e-org',
                }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should get cards by user', function(done) {
            options.qs.user = 'e2e-user';
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

        it('should write an entry to the audit collection', function(done) {
            options.qs.user = 'e2e-user';
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
                expect(results[0].data).toEqual({route: 'GET /api/content/cards/',
                                                 params: {}, query: { user: 'e2e-user', sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.user = 'e2e-user';
            options.qs.fields = 'campaignId,status';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1', campaignId: 'cam-123', status: 'inactive' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get cards by id list', function(done) {
            options.qs.ids = 'e2e-getquery1,e2e-getquery3';
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

        it('should get cards by org', function(done) {
            options.qs.org = 'e2e-org';
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

        it('should get cards by campaignId', function(done) {
            options.qs.campaignId = 'cam-123';
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
        
        it('should be able to combine query params', function(done) {
            options.qs.org = 'e2e-org';
            options.qs.campaignId = 'cam-234';
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

        it('should not get cards by any other query param', function(done) {
            options.qs.tag = 'foo';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to read all cards');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should let a user get active cards they do not own', function(done) {
            options.qs.campaignId = 'cam-345';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow non-admins to retrieve all cards', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to read all cards');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an admin to see any non-deleted cards', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                options.jar = altJar;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
                expect(resp.body[3].id).toBe('e2e-getquery4');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
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
            options.qs.org = 'e2e-org';
            options.qs.limit = 1;
            options.qs.sort = 'campaignId,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/2');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 2-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            options.url = config.contentUrl + '/content/cards?user[$gt]=';
            delete options.qs;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            options.qs.user = 'e2e-user';
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

    describe('POST /api/content/card', function() {
        var mockCard, options;
        beforeEach(function(done) {
            mockCard = { data: { foo: 'bar' }, campaignId: 'cam-1', org: 'e2e-org' };
            options = {
                url: config.contentUrl + '/content/card',
                jar: cookieJar,
                json: mockCard
            };
            testUtils.resetCollection('cards').done(done);
        });

        it('should be able to create a card', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.campaignId).toBe('cam-1');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a VAST card with meta data', function(done) {
            mockCard.data = { 
                vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml'
            };
            mockCard.type = 'adUnit';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(32);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create a youtube card with meta data', function(done) {
            mockCard.data = { 
                videoId: 'OQ83Wz_mrD0'
            };
            mockCard.type = 'youtube';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(12);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
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
                expect(results[0].data).toEqual({route: 'POST /api/content/card/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create an inactive card', function(done) {
            mockCard.status = 'inactive';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.status).toBe('inactive');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the requester provides no campaignid', function(done) {
            delete mockCard.campaignId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an admin to set a different user and org for the card', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                mockCard.user = 'another-user';
                mockCard.org = 'another-org';
                options.jar = altJar;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a regular user to set a different user and org for the card', function(done) {
            mockCard.user = 'another-user';
            mockCard.org = 'another-org';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
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

    describe('PUT /api/content/card/:id', function() {
        var mockCards, now, options;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            options = {
                url: config.contentUrl + '/content/card/e2e-put1',
                json: { data: { foo: 'baz' } },
                jar: cookieJar
            };
            mockCards = [
                {
                    id: 'e2e-put1',
                    data: { foo: 'bar' },
                    status: 'active',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-put2',
                    data: { foo: 'buz' },
                    status: 'active',
                    created: now,
                    lastUpdated: now,
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-put3',
                    data : { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1
                    },
                    type : 'adUnit',
                    status: 'active',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-put4',
                    data : { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1
                    },
                    type : 'adUnit',
                    status: 'active',
                    created: new Date(),
                    lastUpdated: new Date(),
                    user: 'e2e-user',
                    org: 'e2e-org'
                }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should successfully update a card', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockCards[0]);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.data).toEqual({foo: 'baz'});
                expect(new Date(resp.body.created)).toEqual(now);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(now);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should successfully update video duration if age > 1 min', function(done) {
            options = {
                url: config.contentUrl + '/content/card/e2e-put3',
                json: { 
                    data: { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1
                    },
                    type : 'adUnit'
                },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockCards[2]);
                expect(resp.body.id).toBe('e2e-put3');
                expect(resp.body.data.duration).toEqual(32);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should skip update video duration if age < 1 min', function(done) {
            options = {
                url: config.contentUrl + '/content/card/e2e-put4',
                json: { 
                    data: { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1
                    },
                    type : 'adUnit'
                },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockCards[3]);
                expect(resp.body.id).toBe('e2e-put4');
                expect(resp.body.data.duration).toEqual(1);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
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
                expect(results[0].data).toEqual({route: 'PUT /api/content/card/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not create a card if it does not exist', function(done) {
            options.url = options.url.replace('e2e-put1', 'e2e-putfake');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not edit a card that has been deleted', function(done) {
            var deleteOpts = { url: options.url, jar: cookieJar };
            requestUtils.qRequest('delete', deleteOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not update a card the user does not own', function(done) {
            options.url = options.url.replace('e2e-put1', 'e2e-put2');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this');
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

    describe('DELETE /api/content/card/:id', function() {
        beforeEach(function(done) {
            var mockCards = [
                { id: 'e2e-del1', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'e2e-del2', status: 'active', user: 'not-e2e-user', org: 'e2e-org' }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should set the status of a card to deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/card/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/card/e2e-del1', jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/card/e2e-del1'};
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
                expect(results[0].data).toEqual({route: 'DELETE /api/content/card/:id',
                                                 params: { id: 'e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not delete a card the user does not own', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/card/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the card was already deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/card/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the card does not exist', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/card/fake'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.contentUrl + '/content/card/e2e-del1'})
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
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
