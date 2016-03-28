describe('collateralScrape-scraper (UT)', function() {
    var q, logger, util;
    var spidey, mockLog;
    var collateralScrape;

    beforeAll(function() {
        for (var m in require.cache){ delete require.cache[m]; }

        require('spidey.js');
    });

    beforeEach(function() {
        q = require('q');
        logger = require('../../lib/logger');
        util = require('util');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        spidey = spyOn(require.cache[require.resolve('spidey.js')], 'exports');

        delete require.cache[require.resolve('../../bin/collateral-scrape')];
        collateralScrape  = require('../../bin/collateral-scrape');
    });

    describe('getWebsiteData(req, config)', function() {
        var req, config;
        var success, failure;
        var spideyDeferred;

        beforeEach(function(done) {
            req = {
                user: { id: 'u-0507ebe9b5dc5d' },
                requester: { id: 'u-0507ebe9b5dc5d', permissions: {} },
                body: null,
                query: {
                    uri: 'http://www.toyota.com/'
                },
                uuid: 'uieyrf7834rg'
            };

            config = {
                scraper: {
                    timeout: 5000,
                    agent: 'Reelcontent Web Scraper'
                }
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            spideyDeferred = q.defer();
            spidey.and.returnValue(spideyDeferred.promise);

            collateralScrape.getWebsiteData(req, config).then(success, failure);
            process.nextTick(done);
        });

        it('should make a request with spidey.js', function() {
            expect(spidey).toHaveBeenCalledWith(req.query.uri, {
                timeout: config.scraper.timeout,
                gzip: true,
                headers: {
                    'User-Agent': config.scraper.agent
                }
            });
        });

        describe('when the spidey() call succeeds', function() {
            var data;

            beforeEach(function(done) {
                data = {
                    links: {
                        website: 'http://www.toyota.com/',
                        facebook: 'http://www.facebook.com/toyota',
                        twitter: 'http://twitter.com/toyota',
                        instagram: 'http://instagram.com/toyotausa/',
                        youtube: 'http://www.youtube.com/user/ToyotaUSA',
                        pinterest: null,
                        google: 'https://plus.google.com/+toyotausa/',
                        tumblr: null
                    },
                    images: {
                        profile: 'https://fbcdn-profile-a.akamaihd.net/hprofile-ak-xaf1/v/t1.0-1/c124.57.712.712/s200x200/399266_10151276650434201_443074649_n.jpg?oh=e6b8cc83da86e05e312beab0daad0d95&oe=56EA86EA&__gda__=1458601243_4b4d11415406f734644c00dd8898c10f'
                    }
                };

                spideyDeferred.fulfill(data);
                process.nextTick(done);
            });

            it('should fulfill with a [200]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 200,
                    body: data
                }));
            });
        });

        describe('if the request times out', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: ETIMEDOUT');
                error.name = 'RequestError';
                error.cause = new Error('ETIMEDOUT');
                error.cause.code = 'ETIMEDOUT';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [408]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 408,
                    body: 'Timed out scraping website [' + req.query.uri + '].'
                }));
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if there is no server at that address', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: getaddrinfo ENOTFOUND');
                error.name = 'RequestError';
                error.cause = new Error('getaddrinfo ENOTFOUND');
                error.cause.code = 'ENOTFOUND';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [400]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Upstream server not found.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if something else goes wrong in request', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: BLEH');
                error.name = 'RequestError';
                error.cause = new Error('BLEH');
                error.cause.code = 'EBLEH';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a 500', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 500,
                    body: 'Unexpected error fetching website: ' + util.inspect(error)
                }));
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if the upstream server responds with a failing status code', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('404 - The page could not be found.');
                error.name = 'StatusCodeError';
                error.statusCode = 404;

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [400]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Upstream server responded with status code [404].'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if there is some unknown error', function() {
            var error;

            beforeEach(function(done) {
                error = new SyntaxError('You can\'t type.');

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [500]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 500,
                    body: 'Internal error: ' + util.inspect(error)
                }));
            });

            it('should log an error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            });
        });

        describe('if the request uri is not valid', function() {
            beforeEach(function(done) {
                spidey.and.callThrough();
                req.query.uri = 'fiurwehrfui4th';

                collateralScrape.getWebsiteData(req, config).then(success, failure).finally(done);
            });

            it('should succeed with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'URI [' + req.query.uri + '] is not valid.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if a request uri is not specified', function() {
            beforeEach(function(done) {
                spidey.and.callThrough();
                spidey.calls.reset();
                delete req.query.uri;

                collateralScrape.getWebsiteData(req, config).then(success, failure).finally(done);
            });

            it('should not attempt to scrape anything', function() {
                expect(spidey).not.toHaveBeenCalled();
            });

            it('should succeed with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Must specify a URI.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });
    });
});
