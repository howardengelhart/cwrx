describe('search-apps (UT)', function() {
    'use strict';

    var searchApps;
    var formatURL, resolveURL, q, querystring;
    var log, request;
    var requestDeferreds;

    beforeAll(function() {
        Object.keys(require.cache).forEach(function(dep) {
            delete require.cache[dep];
        });

        formatURL = require('url').format;
        resolveURL = require('url').resolve;
        q = require('q');
        querystring = require('querystring');

        log = {
            trace : jasmine.createSpy('log.trace()'),
            error : jasmine.createSpy('log.error()'),
            warn  : jasmine.createSpy('log.warn()'),
            info  : jasmine.createSpy('log.info()'),
            fatal : jasmine.createSpy('log.fatal()'),
            log   : jasmine.createSpy('log.log()')
        };
        spyOn(require('../../lib/logger'), 'getLog').and.returnValue(log);

        requestDeferreds = {};
        spyOn(require('request-promise'), 'defaults').and.returnValue(jasmine.createSpy('request()').and.callFake(function(uri) {
            return (requestDeferreds[uri] = q.defer()).promise;
        }));

        searchApps = require('../../bin/search-apps');

        request = require('request-promise').defaults.calls.mostRecent().returnValue;
        expect(require('request-promise').defaults).toHaveBeenCalledWith({ json: true });
    });

    describe('findApps(req, config)', function() {
        var req, config;
        var success, failure;

        beforeEach(function(done) {
            req = {
                uuid: 'nwe89thfrt',
                query: {
                    query: 'coin counter',
                    limit: 10
                }
            };
            config = {
                api: {
                    root: 'http://localhost/',
                    productData: {
                        endpoint: '/api/collateral/product-data'
                    }
                }
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            searchApps.findApps(req, config).then(success, failure);
            process.nextTick(done);
        });

        it('should search the App Store', function() {
            expect(request).toHaveBeenCalledWith(formatURL({
                protocol: 'https',
                hostname: 'itunes.apple.com',
                pathname: '/search',
                query: {
                    entity: 'software',
                    term: req.query.query,
                    limit: req.query.limit
                }
            }));
        });

        describe('when the results are fetched', function() {
            var results;

            beforeEach(function(done) {
                results = require('./helpers/itunes_search_results.json');

                requestDeferreds[request.calls.mostRecent().args[0]].fulfill(results);
                process.nextTick(done);
            });

            it('should fulfill with some results', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 200,
                    body: results.results.map(function(result) {
                        return {
                            title: result.trackName,
                            developer: result.artistName,
                            thumbnail: result.artworkUrl100,
                            category: result.primaryGenreName,
                            price: result.formattedPrice,
                            rating: result.averageUserRating,
                            uri: result.trackViewUrl,
                            productDataURI: resolveURL(config.api.root, config.api.productData.endpoint) + '?' + querystring.stringify({
                                uri: result.trackViewUrl
                            })
                        };
                    })
                }));
            });
        });

        describe('if there is a problem', function() {
            var reason;

            beforeEach(function(done) {
                reason = new Error('Something bad happened!');

                requestDeferreds[request.calls.mostRecent().args[0]].reject(reason);
                process.nextTick(done);
            });

            it('should log an error', function() {
                expect(log.error).toHaveBeenCalled();
            });

            it('should fulfill with a 500', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 500,
                    body: reason.message
                }));
            });
        });

        describe('if no limit is provided', function() {
            beforeEach(function(done) {
                request.calls.reset();

                req.query.limit = null;

                searchApps.findApps(req, config).then(success, failure);
                process.nextTick(done);
            });

            it('should not include a limit', function() {
                expect(request).toHaveBeenCalledWith(formatURL({
                    protocol: 'https',
                    hostname: 'itunes.apple.com',
                    pathname: '/search',
                    query: {
                        entity: 'software',
                        term: req.query.query
                    }
                }));
            });
        });

        describe('if no query is provided', function() {
            beforeEach(function(done) {
                request.calls.reset();

                req.query.query = null;

                searchApps.findApps(req, config).then(success, failure);
                process.nextTick(done);
            });

            it('should [400]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'A search query is required.'
                }));
            });

            it('should not make a request', function() {
                expect(request).not.toHaveBeenCalled();
            });
        });
    });
});
