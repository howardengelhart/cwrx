var q               = require('q'),
    util            = require('util'),
    urlUtils        = require('url'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('content card endpoints (E2E):', function() {
    var selfieJar, adminJar, mockApp, appCreds;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 15000;

        if (selfieJar && adminJar) {
            return done();
        }
        selfieJar = request.jar();
        adminJar = request.jar();
        var selfieUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'selfieuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            policies: ['selfieCardPolicy']
        };
        var adminUser = {
            id: 'admin-e2e-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'admin-e2e-org',
            policies: ['adminCardPolicy']
        };
        var testPolicies = [
            {
                id: 'p-e2e-selfie',
                name: 'selfieCardPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    cards: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                }
            },
            {
                id: 'p-e2e-admin',
                name: 'adminCardPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                },
                fieldValidation: {
                    cards: {
                        user: { __allowed: true },
                        org: { __allowed: true },
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
            id: 'app-e2e-cards',
            key: 'e2e-cards',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            },
            fieldValidation: JSON.parse(JSON.stringify(testPolicies[1].fieldValidation))
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: selfieJar,
            json: {
                email: selfieUser.email,
                password: 'password'
            }
        };
        var adminLoginOpts = {
            url: config.authUrl + '/login',
            jar: adminJar,
            json: {
                email: adminUser.email,
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

    describe('public endpoints', function() {
        var mockCards, mockCamps, options;
        beforeEach(function(done) {
            mockCards = [
                { id: 'rc-pubget1', campaign: { minViewTime: 3 }, campaignId: 'cam-pub-e2e1', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-pubget2', campaign: { minViewTime: 3 }, campaignId: 'cam-pub-multi', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-pubget3', campaign: { minViewTime: 3 }, campaignId: 'cam-pub-multi', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-pubget4', campaign: { minViewTime: 3 }, campaignId: 'cam-pub-multi', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-pubgetInactive', campaignId: 'cam-pub-e2e1', status: 'inactive', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-pubgetDeleted', campaignId: 'cam-pub-e2e1', status: 'deleted', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-draftCamp', campaign: { minViewTime: 3 }, campaignId: 'cam-cards-e2e2', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-deletedCamp', campaign: { minViewTime: 3 }, campaignId: 'cam-cards-deleted', status: 'active', user: 'e2e-user', org: 'e2e-org' },
            ];
            mockCamps = [
                {
                    id: 'cam-pub-e2e1',
                    status: 'active',
                    advertiserId: 'a-1',
                    advertiserDisplayName: 'Heinz',
                    cards: [{ id: 'rc-pubget1' }]
                },
                {
                    id: 'cam-pub-multi',
                    status: 'active',
                    advertiserDisplayName: 'Skippy',
                    cards: [{ id: 'rc-pubget2' }, { id: 'rc-pubget3' }, { id: 'rc-pubget4' }]
                },
                { id: 'cam-cards-empty', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-cards-e2e2', status: 'draft', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-cards-deleted', status: 'deleted', user: 'e2e-user', org: 'e2e-org' }
            ];
            
            q.all([
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('campaigns', mockCamps),
            ]).done(function() { done(); });
        });
    
        describe('GET /api/public/content/cards/:id', function() {
            beforeEach(function() {
                options = {
                    url: config.contentUrl + '/public/content/cards/rc-pubget1',
                    headers: { origin: 'http://test.com' },
                    qs: {
                        container: 'embed',
                        placement: 'pl-1',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
            });

            it('should get an active card by id', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'rc-pubget1',
                        status: 'active',
                        campaignId: 'cam-pub-e2e1',
                        params: { sponsor: 'Heinz' },
                        campaign: {
                            minViewTime: 3
                        }
                    });
                    
                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not get tracking pixels on a preview GET',function(done){
                options.qs.preview = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.campaign).toEqual({ minViewTime: 3 });
                }).then(done,done.fail);
            });

            it('should get tracking pixels on a non-preview GET', function(done) {
                options.qs.preview = false;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.campaign).toEqual({
                        minViewTime: 3
                    });
                }).then(done,done.fail);
            });
            
            it('should allow passing an experience id as a query param', function(done) {
                options.qs.experience = 'e-1';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'rc-pubget1',
                        status: 'active',
                        campaignId: 'cam-pub-e2e1',
                        params: { sponsor: 'Heinz' },
                        campaign: jasmine.any(Object)
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            describe('if retrieving a card with links and shareLinks', function() {
                beforeEach(function(done) {
                    mockCards.push({
                        id: 'rc-pubgetlinks',
                        campaign: { minViewTime: 1 },
                        campaignId: 'cam-links',
                        status: 'active',
                        user: 'e2e-user',
                        org: 'e2e-org',
                        links: {
                            Facebook: 'http://facebook.com/foo',
                            Twitter: 'http://twitter.com/bar'
                        },
                        shareLinks: {
                            facebook: 'http://fb.com',
                            twitter: 'http://twttr.com',
                            pinterest: 'http://pntrst.com'
                        }
                    });
                    mockCamps[0].cards.push({ id: 'rc-pubgetlinks' });
                    mockCamps[0].id = 'cam-links';
                    options.url = config.contentUrl + '/public/content/cards/rc-pubgetlinks';
                    q.all([
                        testUtils.resetCollection('cards', mockCards),
                        testUtils.resetCollection('campaigns', mockCamps)
                    ]).done(function() { done(); });
                });
                
                it('should Object-ify the card\'s links', function(done) {
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toEqual({
                            id: 'rc-pubgetlinks',
                            status: 'active',
                            campaignId: 'cam-links',
                            params: { sponsor: 'Heinz' },
                            campaign: jasmine.any(Object),
                            links: {
                                Facebook: {
                                    uri: 'http://facebook.com/foo',
                                    tracking: []
                                },
                                Twitter: {
                                    uri: 'http://twitter.com/bar',
                                    tracking: []
                                }
                            },
                            shareLinks: {
                                facebook: {
                                    uri: 'http://fb.com',
                                    tracking: []
                                },
                                twitter: {
                                    uri: 'http://twttr.com',
                                    tracking: []
                                },
                                pinterest: {
                                    uri: 'http://pntrst.com',
                                    tracking: []
                                }
                            }
                        });
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
                
                it('should still objectify the link entries if the request is in preview mode', function(done) {
                    options.qs.preview = 'true';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toEqual(jasmine.objectContaining({
                            links: {
                                Facebook: {
                                    uri: 'http://facebook.com/foo',
                                    tracking: []
                                },
                                Twitter: {
                                    uri: 'http://twitter.com/bar',
                                    tracking: []
                                }
                            },
                            shareLinks: {
                                facebook: {
                                    uri: 'http://fb.com',
                                    tracking: []
                                },
                                twitter: {
                                    uri: 'http://twttr.com',
                                    tracking: []
                                },
                                pinterest: {
                                    uri: 'http://pntrst.com',
                                    tracking: []
                                }
                            }
                        }));
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });

            it('should not show inactive or deleted cards', function(done) {
                q.all(['rc-pubgetInactive', 'rc-pubgetDeleted'].map(function(id) {
                    options.url = options.url.replace('rc-pubget1', id);
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
            
            it('should not show cards with deleted campaigns', function(done) {
                options.url = options.url.replace('rc-pubget1', 'rc-deletedCamp');
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Card not found');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should show cards with draft campaigns', function(done) {
                options.url = options.url.replace('rc-pubget1', 'rc-draftCamp');
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual(jasmine.objectContaining({
                        id: 'rc-draftCamp',
                        status: 'active',
                        campaignId: 'cam-cards-e2e2',
                        campaign: jasmine.objectContaining({
                            minViewTime: 3
                        })
                    }));
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 404 for nonexistent cards', function(done) {
                options.url = options.url.replace('rc-pubget1', 'rc-SDLJFWOIEU');
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Card not found');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
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
            
            describe('if the url extension is .js', function() {
                it('should get a card by id', function(done) {
                    options.url = config.contentUrl + '/public/content/cards/rc-pubget1.js';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toMatch(/module\.exports = {.*"id":"rc-pubget1".*};/);
                        expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });

                it('should return errors in normal format', function(done) {
                    options.url = config.contentUrl + '/public/content/cards/rc-LSKFJWOI.js';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(404);
                        expect(resp.body).toBe('Card not found');
                        expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            describe('if the url extension is .json', function() {
                it('should return the card as JSON normally', function(done) {
                    options.url = config.contentUrl + '/public/content/cards/rc-pubget1.json';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toEqual({
                            id: 'rc-pubget1',
                            status: 'active',
                            campaignId: 'cam-pub-e2e1',
                            params: { sponsor: 'Heinz' },
                            campaign: jasmine.any(Object),
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
        
        describe('GET /api/public/content/cards/', function() {
            beforeEach(function() {
                options = {
                    url: config.contentUrl + '/public/content/cards/',
                    headers: { origin: 'http://test.com' },
                    qs: {
                        campaign: 'cam-pub-multi',
                        container: 'embed',
                        placement: 'pl-1',
                        hostApp: 'Mapsaurus',
                        network: 'pocketmath'
                    }
                };
            });
            
            it('should get all of a campaign\'s cards', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.length).toBe(3);
                    expect(resp.body[0]).toEqual(jasmine.objectContaining({ id: 'rc-pubget2', campaign: jasmine.any(Object) }));
                    expect(resp.body[1]).toEqual(jasmine.objectContaining({ id: 'rc-pubget3', campaign: jasmine.any(Object) }));
                    expect(resp.body[2]).toEqual(jasmine.objectContaining({ id: 'rc-pubget4', campaign: jasmine.any(Object) }));
                    
                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['content-range']).toBe('items 1-3/3');
                    expect(resp.response.headers['cache-control']).toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if no campaign parameter is provided', function(done) {
                delete options.qs.campaign;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Must provide campaign id');
                    expect(resp.response.headers['content-range']).not.toBeDefined();
                    expect(resp.response.headers['cache-control']).toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should use the limit param to select a subset of cards', function(done) {
                options.qs.limit = 2;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.length).toBe(2);
                    expect(resp.body[0]).toEqual(jasmine.objectContaining({ id: 'rc-pubget2', campaign: jasmine.any(Object) }));
                    expect(resp.body[1]).toEqual(jasmine.objectContaining({ id: 'rc-pubget3', campaign: jasmine.any(Object) }));
                    expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            describe('if the random parameter is set', function() {
                beforeEach(function() {
                    options.qs.random = 'true';
                });
                
                it('should return all cards in a random order if limit is not set', function(done) {
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.length).toBe(3);
                        expect(resp.body).toContain(jasmine.objectContaining({ id: 'rc-pubget2', campaign: jasmine.any(Object) }));
                        expect(resp.body).toContain(jasmine.objectContaining({ id: 'rc-pubget3', campaign: jasmine.any(Object) }));
                        expect(resp.body).toContain(jasmine.objectContaining({ id: 'rc-pubget4', campaign: jasmine.any(Object) }));
                        expect(resp.response.headers['content-range']).not.toBeDefined();
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });

                it('should return a random subset of cards if limit is set', function(done) {
                    options.qs.limit = '2';
                    requestUtils.qRequest('get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body.length).toBe(2);
                        var optionalMatcher = { asymmetricMatch: function(actual) {
                            return actual.id === 'rc-pubget2' || actual.id === 'rc-pubget3' || actual.id === 'rc-pubget4';
                        } };
                        expect(resp.body[0]).toEqual(optionalMatcher);
                        expect(resp.body[1]).toEqual(optionalMatcher);
                        expect(resp.body[1]).not.toEqual(resp.body[0]);
                        expect(resp.response.headers['content-range']).not.toBeDefined();
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            });
            
            it('should return a 200 and [] if the campaign has no cards', function(done) {
                options.qs.campaign = 'cam-cards-empty';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should handle weird parameter values', function(done) {
                options = { url: config.contentUrl + '/public/content/cards?campaign[$gt]=' };
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Campaign not found');
                    expect(resp.response.headers['content-range']).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 404 if the campaign is not found', function(done) {
                options.qs.campaign = 'cam-flakjdfoiwer';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Campaign not found');
                    expect(resp.response.headers['content-range']).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign is deleted', function(done) {
                options.qs.campaign = 'cam-cards-deleted';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Campaign not found');
                    expect(resp.response.headers['content-range']).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });
    
    describe('GET /api/content/cards/:id', function() {
        beforeEach(function(done) {
            var mockCards = [
                {
                    id: 'e2e-getid1',
                    campaignId: 'cam-cards-e2e1',
                    status: 'inactive',
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-getid2',
                    campaignId: 'cam-cards-e2e2',
                    status: 'active',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-getid3',
                    campaignId: 'cam-cards-e2e3',
                    status: 'inactive',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should get a card by id', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid1', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-getid1');
                expect(resp.body.campaignId).toBe('cam-cards-e2e1');
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid1', jar: selfieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/content/cards/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            var options = {
                url: config.contentUrl + '/content/cards/e2e-getid1',
                qs: { fields: 'campaignId,status' },
                jar: selfieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    campaignId: 'cam-cards-e2e1',
                    status: 'inactive'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should let the user see active cards they do not own', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid2', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                options.url = config.contentUrl + '/content/cards/e2e-getid3';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.contentUrl + '/content/cards/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid5678', jar: selfieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get a card', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid1'};
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-getid1');
                expect(resp.body.campaignId).toBe('cam-cards-e2e1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var options = {url: config.contentUrl + '/content/cards/e2e-getid1'};
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/content/cards', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/content/cards', qs: {sort: 'id,1'}, jar: selfieJar };
            var mockCards = [
                {
                    id: 'e2e-getquery1',
                    status: 'inactive',
                    campaignId: 'cam-cards-e2e123',
                    user: 'e2e-user',
                    org: 'e2e-org',
                },
                {
                    id: 'e2e-getquery2',
                    status: 'inactive',
                    campaignId: 'cam-cards-e2e234',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                },
                {
                    id: 'e2e-getquery3',
                    status: 'active',
                    campaignId: 'cam-cards-e2e345',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                },
                {
                    id: 'e2e-getquery4',
                    status: 'inactive',
                    campaignId: 'cam-cards-e2e456',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                },
                {
                    id: 'e2e-getquery5',
                    status: 'deleted',
                    campaignId: 'cam-cards-e2e567',
                    user: 'e2e-user',
                    org: 'e2e-org',
                }
            ];
            testUtils.resetCollection('cards', mockCards).done(done);
        });

        it('should get all cards a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
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

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.user = 'e2e-user';
            options.qs.fields = 'campaignId,status';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1', campaignId: 'cam-cards-e2e123', status: 'inactive' }
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
            options.qs.campaignId = 'cam-cards-e2e123';
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
            options.qs.campaignId = 'cam-cards-e2e234';
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
        
        it('should let a user get active cards they do not own', function(done) {
            options.qs.campaignId = 'cam-cards-e2e345';
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

        it('should allow an admin to see any non-deleted cards', function(done) {
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
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

        it('should allow an app to get cards', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
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
    });

    describe('POST /api/content/cards', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.contentUrl + '/content/cards',
                jar: selfieJar,
                json: {
                    data: { foo: 'bar' },
                    campaignId: 'cam-cards-e2e1',
                    advertiserId: 'a-1'
                }
            };
            testUtils.resetCollection('cards').done(done);
        });

        it('should be able to create a card', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.campaignId).toBe('cam-cards-e2e1');
                expect(resp.body.campaign).toEqual({ minViewTime: 3 });
                expect(resp.body.data).toEqual({
                    foo: 'bar',
                    skip: 5,
                    controls: true,
                    autoplay: true,
                    autoadvance: false,
                    moat: { campaign: 'cam-cards-e2e1', advertiser: 'a-1', creative: resp.body.id }
                });
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
            options.json.data = { 
                vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml',
                duration: 666
            };
            options.json.type = 'adUnit';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(32);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create a VAST card with protocol relative url', function(done) {
            options.json.data = { 
                vast: '//s3.amazonaws.com/c6.dev/e2e/vast_test.xml',
                duration: 666
            };
            options.json.type = 'adUnit';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(32);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create a youtube card with meta data', function(done) {
            options.json.data = {
                videoid: 'OQ83Wz_mrD0',
                duration: 666,
                thumbs: {
                    small: 'small.jpg',
                    large: 'large.jpg'
                }
            };
            options.json.type = 'youtube';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(12);
                expect(resp.body.data.thumbs).toEqual({
                    small: 'https://i.ytimg.com/vi/OQ83Wz_mrD0/default.jpg',
                    large: 'https://i.ytimg.com/vi/OQ83Wz_mrD0/maxresdefault.jpg'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create a facebook card with meta data', function(done) {
            options.json.data = {
                href: 'https://www.facebook.com/FacebookDevelopers/videos/10152454700553553/',
                duration: 666,
                thumbs: {
                    small: 'small.jpg',
                    large: 'large.jpg'
                }
            };
            options.json.type = 'facebook';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(62.51);
                expect(resp.body.data.thumbs.small).toMatch(/^https:\/\/scontent\.xx\.fbcdn\.net\/.+\.jpg.*$/);
                expect(resp.body.data.thumbs.large).toMatch(/^https:\/\/scontent\.xx\.fbcdn\.net\/.+\.jpg.*$/);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to set custom meta data for a video that has no duration', function(done) {
            options.json.data = { 
                videoid: 'probablynotarealyoutubevideo',
                duration: 666,
                thumbs: {
                    small: 'small.jpg',
                    large: 'large.jpg'
                }
            };
            options.json.type = 'youtube';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.data.duration).toEqual(666);
                expect(resp.body.data.thumbs).toEqual({
                    small: 'small.jpg',
                    large: 'large.jpg'
                });
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
                expect(results[0].data).toEqual({route: 'POST /api/content/cards/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create an inactive card', function(done) {
            options.json.status = 'inactive';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.status).toBe('inactive');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the requester provides no campaignid', function(done) {
            delete options.json.campaignId;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: campaignId');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow admins to set certain fields', function(done) {
            options.json = {
                campaignId: 'cam-cards-e2e1',
                advertiserId: 'a-1',
                user: 'another-user',
                org: 'another-org',
                campaign: { minViewTime: 55 },
                data: {
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true
                }
            };
            q.all([selfieJar, adminJar].map(function(jar) {
                options.jar = jar;
                return requestUtils.qRequest('post', options);
            })).spread(function(selfieResp, adminResp) {
                expect(selfieResp.response.statusCode).toBe(201);
                expect(selfieResp.body.id).toBeDefined();
                expect(selfieResp.body.user).toBe('e2e-user');
                expect(selfieResp.body.org).toBe('e2e-org');
                expect(selfieResp.body.campaign).toEqual({ minViewTime: 3 });
                expect(selfieResp.body.data).toEqual({
                    skip: 5,
                    controls: true,
                    autoplay: true,
                    autoadvance: false,
                    moat: { campaign: 'cam-cards-e2e1', advertiser: 'a-1', creative: selfieResp.body.id }
                });
                
                expect(adminResp.response.statusCode).toBe(201);
                expect(adminResp.body.id).toBeDefined();
                expect(adminResp.body.user).toBe('another-user');
                expect(adminResp.body.org).toBe('another-org');
                expect(adminResp.body.campaign).toEqual({ minViewTime: 55 });
                expect(adminResp.body.data).toEqual({
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true,
                    moat: { campaign: 'cam-cards-e2e1', advertiser: 'a-1', creative: adminResp.body.id }
                });
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

        it('should allow an app to create a card', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.campaignId).toBe('cam-cards-e2e1');
                expect(resp.body.campaign).toEqual({ minViewTime: 3 });
                expect(resp.body.data).toEqual({
                    foo: 'bar',
                    skip: 5,
                    controls: true,
                    autoplay: true,
                    autoadvance: false,
                    moat: { campaign: 'cam-cards-e2e1', advertiser: 'a-1', creative: resp.body.id }
                });
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/content/cards/:id', function() {
        var mockCards, mockCamps, now, options;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            options = {
                url: config.contentUrl + '/content/cards/rc-put1',
                json: { title: 'best card' },
                jar: selfieJar
            };
            mockCards = [
                {
                    id: 'rc-put1',
                    title: 'okay card',
                    campaignId: 'cam-draft',
                    advertiserId: 'a-1',
                    status: 'active',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org',
                    campaign: {
                        minViewTime: 3
                    },
                    data: {
                        skip: 30,
                        controls: true,
                        autoplay: true,
                        autoadvance: false,
                        moat: { campaign: 'cam-draft', advertiser: 'a-1', creative: 'rc-put1' }
                    }
                },
                {
                    id: 'rc-putDur1',
                    campaignId: 'cam-draft',
                    advertiserId: 'a-1',
                    campaign: { minViewTime: 3 },
                    data : { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1,
                        skip: 30,
                        controls: true,
                        autoplay: true,
                        autoadvance: false,
                        moat: { campaign: 'cam-draft', advertiser: 'a-1', creative: 'rc-putDur1' }
                    },
                    type : 'adUnit',
                    status: 'active',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'rc-putDur2',
                    campaignId: 'cam-draft',
                    advertiserId: 'a-1',
                    campaign: { minViewTime: 3 },
                    data : { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 1,
                        skip: 30,
                        controls: true,
                        autoplay: true,
                        autoadvance: false,
                        moat: { campaign: 'cam-draft', advertiser: 'a-1', creative: 'rc-putDur2' }
                    },
                    type : 'adUnit',
                    status: 'active',
                    created: new Date(),
                    lastUpdated: new Date(),
                    user: 'e2e-user',
                    org: 'e2e-org'
                }
            ];
            mockCamps = [
                { id: 'cam-draft', status: 'draft', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-active', status: 'active', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-pending', status: 'pending', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-canceled', status: 'canceled', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-update', status: 'active', updateRequest: 'ur-1', user: 'e2e-user', org: 'e2e-org' }
            ];
            
            // add cards linked to active, pending, canceled, and pending-update campaigns
            mockCards = mockCards.concat(['cam-active', 'cam-pending', 'cam-canceled', 'cam-update'].map(function(campId) {
                var card = JSON.parse(JSON.stringify(mockCards[0]));
                card.campaignId = campId;
                card.data.moat.campaign = campId;
                card.id = 'rc-' + campId;
                card.data.moat.creative = card.id;
                return card;
            }));
            
            // add card linked to other user/org
            var otherCard = JSON.parse(JSON.stringify(mockCards[0]));
            otherCard.user = 'not-e2e-user';
            otherCard.org = 'not-e2e-org';
            otherCard.id = 'rc-put2';
            otherCard.data.moat.creative = 'rc-put2';
            mockCards.push(otherCard);
            
            q.all([
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('campaigns', mockCamps)
            ]).done(function(resp) { done(); });
        });

        it('should successfully update a card', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('rc-put1');
                expect(resp.body.title).toBe('best card');
                expect(resp.body.data).toEqual(mockCards[0].data);
                expect(resp.body.campaign).toEqual(mockCards[0].campaign);
                expect(new Date(resp.body.created)).toEqual(now);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(now);
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
                expect(results[0].data).toEqual({route: 'PUT /api/content/cards/:id',
                                                 params: { id: 'rc-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not lose important data properties', function(done) {
            options.json = { data: { foo: 'bar' } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('rc-put1');
                expect(resp.body.data).toEqual({
                    foo: 'bar',
                    skip: 30,
                    controls: true,
                    autoplay: true,
                    autoadvance: false,
                    moat: { campaign: 'cam-draft', advertiser: 'a-1', creative: 'rc-put1' }
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should successfully update video duration if age > 1 min', function(done) {
            options = {
                url: config.contentUrl + '/content/cards/rc-putDur1',
                json: { 
                    data: { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 666
                    },
                    type : 'adUnit'
                },
                jar: selfieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockCards[2]);
                expect(resp.body.id).toBe('rc-putDur1');
                expect(resp.body.data.duration).toEqual(32);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should skip update video duration if age < 1 min', function(done) {
            options = {
                url: config.contentUrl + '/content/cards/rc-putDur2',
                json: { 
                    data: { 
                        vast: 'https://s3.amazonaws.com/c6.dev/e2e/vast_test.xml' ,
                        duration : 666
                    },
                    type : 'adUnit'
                },
                jar: selfieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockCards[3]);
                expect(resp.body.id).toBe('rc-putDur2');
                expect(resp.body.data.duration).toEqual(666);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow editing cards with non-draft campaigns', function(done) {
            q.all(['rc-cam-active', 'rc-cam-pending', 'rc-cam-canceled'].map(function(id) {
                options.url = config.contentUrl + '/content/cards/' + id;
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Action not permitted on ' + id.replace('rc-cam-', '') + ' campaign');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow admins to edit non-draft campaigns', function(done) {
            options.jar = adminJar;
            q.all(['rc-cam-active', 'rc-cam-pending', 'rc-cam-canceled'].map(function(id) {
                options.url = config.contentUrl + '/content/cards/' + id;
                return requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe(id);
                    expect(resp.body.title).toBe('best card');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow anyone to edit cards with campaigns that have a pending update request', function(done) {
            options.url = config.contentUrl + '/content/cards/rc-cam-update';
            options.jar = adminJar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Campaign + cards locked until existing update request resolved');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json = {
                title: 'best card',
                user: 'another-user',
                org: 'another-org',
                campaign: {
                    minViewTime: 55
                },
                data: {
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true
                }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('rc-put1');
                expect(resp.body.title).toBe('best card');
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.campaign).toEqual(mockCards[0].campaign);
                expect(resp.body.data).toEqual(mockCards[0].data);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow admins to set some forbidden fields', function(done) {
            options.jar = adminJar;
            options.json = {
                title: 'best card',
                user: 'another-user',
                org: 'another-org',
                campaign: {
                    minViewTime: 55
                },
                data: {
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true
                }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('rc-put1');
                expect(resp.body.title).toBe('best card');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
                expect(resp.body.campaign).toEqual({
                    minViewTime: 55
                });
                expect(resp.body.data).toEqual({
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true,
                    moat: { campaign: 'cam-draft', advertiser: 'a-1', creative: resp.body.id }
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a card if it does not exist', function(done) {
            options.url = options.url.replace('rc-put1', 'rc-putfake');
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not edit a card that has been deleted', function(done) {
            var deleteOpts = { url: options.url, jar: selfieJar };
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
            options.url = options.url.replace('rc-put1', 'rc-put2');
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

        it('should allow an app to edit a card', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('rc-put1');
                expect(resp.body.title).toBe('best card');
                expect(resp.body.data).toEqual(mockCards[0].data);
                expect(resp.body.campaign).toEqual(mockCards[0].campaign);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/content/cards/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockCards = [
                { id: 'rc-del1', status: 'active', campaignId: 'cam-draft', user: 'e2e-user', org: 'e2e-org' },
                { id: 'rc-del2', status: 'active', campaignId: 'cam-draft', user: 'not-e2e-user', org: 'not-e2e-org' },
                { id: 'rc-cam-update', status: 'active', campaignId: 'cam-update', user: 'e2e-user', org: 'e2e-org' }
            ];
            var mockCamps = [
                { id: 'cam-draft', status: 'draft', user: 'e2e-user', org: 'e2e-org' },
                { id: 'cam-update', status: 'active', updateRequest: 'ur-1', user: 'e2e-user', org: 'e2e-org' }
            ];
            
            // add cards + campaigns for other statuses
            ['pending', 'canceled', 'expired', 'outOfBudget', 'active', 'paused'].forEach(function(status) {
                var camp = { id: 'cam-' + status, status: status, user: 'e2e-user', org: 'e2e-org' };
                var card = { id: 'rc-' + camp.id, status: 'active', campaignId: camp.id, user: 'e2e-user', org: 'e2e-org' };
                mockCamps.push(camp);
                mockCards.push(card);
            });
            
            options = {
                url: config.contentUrl + '/content/cards/rc-del1',
                jar: selfieJar
            };
            
            q.all([
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('campaigns', mockCamps)
            ]).done(function(resp) { done(); });
        });

        it('should set the status of a card to deleted', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/cards/rc-del1', jar: selfieJar};
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
                expect(results[0].data).toEqual({route: 'DELETE /api/content/cards/:id',
                                                 params: { id: 'rc-del1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow deleting cards whose campaign is canceled, expired, or pending', function(done) {
            q.all(['canceled', 'expired', 'pending'].map(function(status) {
                options.url = config.contentUrl + '/content/cards/rc-cam-' + status;
                return requestUtils.qRequest('delete', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    options = {
                        url: config.contentUrl + '/content/cards/rc-cam-' + status,
                        jar: selfieJar
                    };
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow deleting cards with running campaigns', function(done) {
            q.all(['active', 'paused', 'outOfBudget'].map(function(status) {
                options.url = config.contentUrl + '/content/cards/rc-cam-' + status;
                return requestUtils.qRequest('delete', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Action not permitted on ' + status + ' campaign');
                    options = {
                        url: config.contentUrl + '/content/cards/rc-cam-' + status,
                        jar: selfieJar
                    };
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual(jasmine.objectContaining({ id: 'rc-cam-' + status }));
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow admins to delete cards with running campaigns', function(done) {
            options.jar = adminJar;
            q.all(['active', 'paused'].map(function(status) {
                options.url = config.contentUrl + '/content/cards/rc-cam-' + status;
                return requestUtils.qRequest('delete', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                    expect(resp.body).toBe('');
                    options = {
                        url: config.contentUrl + '/content/cards/rc-cam-' + status,
                        jar: selfieJar
                    };
                    return requestUtils.qRequest('get', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow anyone to delete a card from a campaign with a pending update request', function(done) {
            options.jar = adminJar;
            options.url = config.contentUrl + '/content/cards/rc-cam-update';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/cards/rc-cam-update', jar: selfieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not delete a card the user does not own', function(done) {
            options.url = config.contentUrl + '/content/cards/rc-del2';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the card was already deleted', function(done) {
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
            options.url = config.contentUrl + '/content/cards/fake';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.contentUrl + '/content/cards/rc-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to delete a card', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/campaigns/schema', function() {
        var selfieOpts, adminOpts, cardModule;
        beforeEach(function() {
            selfieOpts = { url: config.contentUrl + '/content/cards/schema', qs: {}, jar: selfieJar };
            adminOpts = { url: config.contentUrl + '/content/cards/schema', qs: {}, jar: adminJar };
            cardModule = require('../../bin/content-cards');
        });

        it('should get the base card schema', function(done) {
            q.all([
                requestUtils.qRequest('get', selfieOpts),
                requestUtils.qRequest('get', adminOpts),
            ]).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual(jasmine.any(Object));
                    expect(resp.body.user).toEqual({ __allowed: false, __type: 'string' });
                    expect(resp.body.org).toEqual({ __allowed: false, __type: 'string' });
                    expect(resp.body.campaignId).toEqual({
                        __allowed: true,
                        __type: 'string',
                        __unchangeable: true,
                        __required: true
                    });
                    expect(resp.body.data).toEqual(JSON.parse(JSON.stringify(cardModule.cardSchema.data)));
                    expect(resp.body.campaign).toEqual(JSON.parse(JSON.stringify(cardModule.cardSchema.campaign)));
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to get a card schema customized to each user', function(done) {
            selfieOpts.qs.personalized = 'true';
            adminOpts.qs.personalized = 'true';
            q.all([
                requestUtils.qRequest('get', selfieOpts),
                requestUtils.qRequest('get', adminOpts),
            ]).spread(function(selfieResult, adminResult) {
                expect(selfieResult.response.statusCode).toBe(200);
                expect(adminResult.response.statusCode).toBe(200);
    
                expect(selfieResult.body.data).toEqual(JSON.parse(JSON.stringify(cardModule.cardSchema.data)));
                expect(selfieResult.body.campaign).toEqual(JSON.parse(JSON.stringify(cardModule.cardSchema.campaign)));
                
                expect(adminResult.body.user).toEqual({ __allowed: true, __type: 'string' });
                expect(adminResult.body.org).toEqual({ __allowed: true, __type: 'string' });
                expect(adminResult.body.campaign).toEqual(jasmine.objectContaining({
                    minViewTime: {
                        __type: 'number',
                        __allowed: true,
                        __default: 3
                    }
                }));
                expect(adminResult.body.data).toEqual(jasmine.objectContaining({
                    skip: {
                        __allowed: true,
                        __required: true,
                        __default: 5
                    },
                    controls: {
                        __allowed: true,
                        __type: 'boolean',
                        __required: true,
                        __default: true
                    },
                    autoplay: {
                        __allowed: true,
                        __type: 'boolean',
                        __required: true,
                        __default: true
                    },
                    autoadvance: {
                        __allowed: true,
                        __type: 'boolean',
                        __required: true,
                        __default: false
                    },
                    moat: JSON.parse(JSON.stringify(cardModule.cardSchema.data.moat))
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get its schema', function(done) {
            var options = {
                url: config.contentUrl + '/content/cards/schema',
                qs: { personalized: 'true' }
            };
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.user).toEqual({ __allowed: true, __type: 'string' });
                expect(resp.body.org).toEqual({ __allowed: true, __type: 'string' });
                expect(resp.body.campaign).toEqual(jasmine.objectContaining({
                    minViewTime: {
                        __type: 'number',
                        __allowed: true,
                        __default: 3
                    }
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    afterAll(function(done) {
        testUtils.closeDbs().done(done, done.fail);
    });
});
