var q               = require('q'),
    util            = require('util'),
    fs              = require('fs-extra'),
    path            = require('path'),
    formatURL       = require('url').format,
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    request         = require('request'),
    host            = process.env.host || 'localhost',
    bucket          = process.env.bucket || 'c6.dev',
    config = {
        searchUrl   : 'http://' + (host === 'localhost' ? host + ':3800' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('search (E2E):', function() {
    var cookieJar, mockUser, mockApp, appCreds;
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        if (cookieJar) {
            return done();
        }
        cookieJar = require('request').jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'searche2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {}
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: { email: 'searche2euser', password: 'password' }
        };
        mockApp = {
            id: 'app-e2e-search',
            key: 'e2e-searchsvc',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {}
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        q.all([
            testUtils.resetCollection('users', mockUser),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/search/apps', function() {
        var options;
        var success, failure;
        var apiResponse;

        beforeEach(function() {
            options = {
                url: config.searchUrl + '/search/apps',
                qs: {},
                json: true,
                jar: cookieJar
            };

            success = jasmine.createSpy('success()').and.callFake(function(response) {
                apiResponse = response;
            });
            failure = jasmine.createSpy('failure()').and.callFake(function(error) {
                console.error(error);
            });

            apiResponse = null;
        });

        describe('unauthenticated', function() {
            beforeEach(function(done) {
                options.jar = false;

                requestUtils.qRequest('get', options).then(success, failure).finally(done);
            });

            it('should [401]', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });

        describe('with no query', function() {
            beforeEach(function(done) {
                delete options.qs.query;

                requestUtils.qRequest('get', options).then(success, failure).finally(done);
            });

            it('should [400]', function() {
                expect(apiResponse.response.statusCode).toBe(400);
                expect(apiResponse.body).toBe('A search query is required.');
            });
        });

        describe('with a search query', function() {
            beforeEach(function(done) {
                options.qs.query = 'coin counter';

                requestUtils.qRequest('get', options).then(success, failure).finally(done);
            });

            it('should return results from the app store', function() {
                expect(apiResponse.response.statusCode).toBe(200);
                expect(apiResponse.body).toEqual(jasmine.any(Array));
                expect(apiResponse.body.length).toBeGreaterThan(0, 'Response has no results');
                apiResponse.body.forEach(function(result, index) {
                    expect(result).toEqual(jasmine.objectContaining({
                        title: jasmine.any(String),
                        developer: jasmine.any(String),
                        thumbnail: jasmine.stringMatching(/^https?:\/\/is\d\.mzstatic\.com\/image\/thumb/),
                        category: jasmine.any(String),
                        uri: jasmine.stringMatching(/^https:\/\/itunes\.apple\.com\//),
                        productDataURI: formatURL({
                            protocol: 'http',
                            hostname: 'localhost',
                            pathname: '/api/collateral/product-data',
                            query: {
                                uri: result.uri
                            }
                        })
                    }), 'Failure for results[' + index + ']');

                    if ('rating' in result) {
                        expect(result.rating).toMatch(/^[0-5]\.?\d*$/, 'Bad rating for results[' + index + ']');
                    }
                });
            });

            describe('and a limit', function() {
                var unlimitedResults;

                beforeEach(function(done) {
                    unlimitedResults = apiResponse.body;
                    options.qs.limit = 10;

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should get a subset of results', function() {
                    expect(apiResponse.body).toEqual(unlimitedResults.slice(0, 10));
                });
            });
        });
    });

    describe('GET /api/search/videos', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.searchUrl + '/search/videos',
                qs: { query: 'cats' },
                jar: cookieJar
            };
        });

        it('should search for videos with a text query', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.meta.totalResults <= 100).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.title).toBeDefined();
                    expect(item.description).toBeDefined();
                    expect(item.site).toMatch(/^((youtube)|(vimeo)|(dailymotion))$/);
                    expect(item.siteLink).toMatch(item.site);
                    expect(item.link).toMatch(item.site);
                    expect(item.hd).toBeDefined();
                    expect(item.videoid).toBeDefined();
                    expect(item.duration).toBeDefined();
                    expect(item.thumbnail).toBeDefined();
                    expect(item.thumbnail.src).toBeDefined();
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
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
                expect(results[0].service).toBe('search');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/search/videos',
                                                 params: {}, query: { query: 'cats' } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to only hd videos', function(done) {
            options.qs.hd = 'true';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.title).toBeDefined();
                    expect(item.link).toBeDefined();
                    expect(item.hd).toBe(true);
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to non-hd videos', function(done) {
            options.qs.hd = 'false';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.title).toBeDefined();
                    expect(item.link).toBeDefined();
                    expect(item.hd).toBe(false);
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to restrict results to certain sites', function(done) {
            options.qs.sites = 'vimeo,dailymotion';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.site).toMatch(/^((vimeo)|(dailymotion))$/);
                    expect(item.siteLink).toMatch(item.site);
                    expect(item.link).toMatch(item.site);
                    expect(item.description).toBeDefined();
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to paginate through results', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.meta.totalResults <= 100).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                options.qs.skip = 10;
                options.qs.limit = 5;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(10);
                expect(resp.body.meta.numResults).toBe(5);
                expect(resp.body.meta.totalResults >= 15).toBeTruthy();
                expect(resp.body.meta.totalResults <= 100).toBeTruthy();
                expect(resp.body.items.length).toBe(5);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should impose sensible defaults on the skip and limit params', function(done) {
            options.qs.skip = '-3';
            options.qs.limit = '1000000000000000000';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return an empty array if nothing is found', function(done) {
            options.qs.query = 'fhoenfaefoajhweoucaeirycvnbaksdoiur' + Math.random() * 10000000;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(0);
                expect(resp.body.meta.totalResults).toBe(0);
                expect(resp.body.items).toEqual([]);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if no query is provided', function(done) {
            delete options.qs.query;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No query in request');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if attempting to query past the 100th result', function(done) {
            q.all([{skip: 91}, {limit: 1, skip: 100}].map(function(params) {
                options.qs.skip = params.skip;
                options.qs.limit = params.limit;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Cannot query past first 100 results');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if no user is logged in', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get videos', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.meta.totalResults <= 100).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
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
