describe('player service', function() {
    var Player;
    var BluebirdPromise;
    var q;
    var Promise;
    var request;
    var cheerio;
    var FunctionCache;
    var service;
    var express;
    var formatURL;
    var logger;
    var resolveURL;
    var extend;
    var clonePromise;
    var AdLoader;
    var expressUtils;
    var AWS;
    var CloudWatchReporter;
    var HTMLDocument;

    var requestDeferreds;
    var fnCaches;
    var MockFunctionCache;
    var MockAdLoader;
    var playerHTML;
    var playerCSS;
    var playerJS;
    var log;
    var adLoader;
    var reporter;

    var setTimeout;

    beforeEach(function() {
        setTimeout = global.setTimeout;
        jasmine.clock().install();

        BluebirdPromise = require('bluebird');
        q = require('q');
        Promise = q.defer().promise.constructor;
        request = require('request-promise');
        cheerio = require('cheerio');
        service = require('../../lib/service');
        express = require('express');
        formatURL = require('url').format;
        logger = require('../../lib/logger');
        resolveURL = require('url').resolve;
        extend = require('../../lib/objUtils').extend;
        clonePromise = require('../../lib/promise').clone;
        AWS = require('aws-sdk');
        HTMLDocument = require('../../lib/htmlDocument');

        playerHTML = require('fs').readFileSync(require.resolve('./helpers/player.html')).toString();
        playerCSS = require('fs').readFileSync(require.resolve('./helpers/lightbox.css')).toString();
        playerJS = require('fs').readFileSync(require.resolve('./helpers/lightbox.js')).toString();

        requestDeferreds = {};
        spyOn(request, 'get').and.callFake(function(url) {
            var deferred = {};
            var req = new BluebirdPromise(function(resolve, reject) {
                deferred.resolve = resolve;
                deferred.reject = reject;
            });

            requestDeferreds[url] = deferred;
            deferred.request = req;

            return req;
        });

        delete require.cache[require.resolve('../../lib/cloudWatchReporter')];
        CloudWatchReporter = require('../../lib/cloudWatchReporter');
        require.cache[require.resolve('../../lib/cloudWatchReporter')].exports = jasmine.createSpy('CloudWatchReporter()').and.callFake(function(namespace, data) {
            reporter = new CloudWatchReporter(namespace, data);
            spyOn(reporter, 'autoflush');

            return reporter;
        });

        delete require.cache[require.resolve('../../lib/expressUtils')];
        expressUtils = require('../../lib/expressUtils');
        spyOn(expressUtils, 'parseQuery').and.callThrough();
        spyOn(expressUtils, 'cloudwatchMetrics').and.callThrough();

        delete require.cache[require.resolve('../../lib/adLoader')];
        AdLoader = require('../../lib/adLoader');
        require.cache[require.resolve('../../lib/adLoader')].exports = jasmine.createSpy('AdLoader()').and.callFake(function(config) {
            return (adLoader = new AdLoader(config));
        });

        MockAdLoader = require('../../lib/adLoader');
        Object.keys(AdLoader).forEach(function(key) {
            if (typeof AdLoader[key] === 'function') {
                MockAdLoader[key] = AdLoader[key];
            }
        });

        delete require.cache[require.resolve('../../lib/functionCache')];
        FunctionCache = require('../../lib/functionCache');
        fnCaches = [];
        require.cache[require.resolve('../../lib/functionCache')].exports = jasmine.createSpy('FunctionCache()').and.callFake(function(config) {
            var cache = new FunctionCache(config);

            spyOn(cache, 'add').and.callThrough();

            return fnCaches[fnCaches.push(cache) - 1];
        });

        MockFunctionCache = require('../../lib/functionCache');

        log = {
            info: jasmine.createSpy('log.info()'),
            trace: jasmine.createSpy('log.trace()'),
            warn: jasmine.createSpy('log.warn()'),
            error: jasmine.createSpy('log.error()')
        };
        spyOn(logger, 'getLog').and.returnValue(log);

        delete require.cache[require.resolve('../../bin/player')];
        Player = require('../../bin/player');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should exist', function() {
        expect(Player).toEqual(jasmine.any(Function));
        expect(Player.name).toBe('Player');
    });

    it('should create a never-expiring FunctionCache', function() {
        expect(MockFunctionCache).toHaveBeenCalledWith(jasmine.objectContaining({
            freshTTL: Infinity,
            maxTTL: Infinity,
            gcInterval: Infinity
        }));
    });

    describe('the function used to clone Documents in the Static Cache', function() {
        var cloneDocument;
        var success, failure;
        var promise, document;
        var result;

        beforeEach(function(done) {
            cloneDocument = fnCaches[0].extractor;
            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            document = new HTMLDocument(playerHTML);
            promise = q(document);

            spyOn(document, 'clone').and.callThrough();
            result = cloneDocument(promise);

            result.then(success, failure).finally(done);
        });

        it('should return a new Promise', function() {
            expect(result).not.toBe(promise);
        });

        it('should fulfill with a clone of the HTMLDocument', function() {
            expect(success.calls.mostRecent().args[0]).toBe(document.clone.calls.mostRecent().returnValue);
        });
    });

    describe('static:', function() {
        describe('@public', function() {
            describe('methods:', function() {
                describe('startService()', function() {
                    var MockPlayer, MockBrowserInfo, mockExpress, expressApp;
                    var player, browser;

                    var expressRoutes;
                    var success, failure;

                    function whenIndentity(value) {
                        return q(value);
                    }

                    beforeEach(function(done) {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        spyOn(service, 'start').and.callFake(whenIndentity);
                        spyOn(service, 'parseCmdLine').and.callFake(function(state) {
                            state.cmdl = { port: 6100 };

                            return q(state);
                        });
                        spyOn(service, 'configure').and.callFake(function(state) {
                            state.config = state.defaultConfig;

                            return q(state);
                        });
                        spyOn(service, 'prepareServer').and.callFake(whenIndentity);
                        spyOn(service, 'daemonize').and.callFake(whenIndentity);
                        spyOn(service, 'cluster').and.callFake(whenIndentity);

                        spyOn(AWS.config, 'update').and.callThrough();

                        expressRoutes = {
                            get: {}
                        };
                        mockExpress = require.cache[require.resolve('express')].exports = jasmine.createSpy('express()').and.callFake(function() {
                            expressApp = express.apply(null, arguments);

                            spyOn(expressApp, 'listen');
                            spyOn(expressApp, 'use');
                            spyOn(expressApp, 'get').and.callFake(function(route/*, middleware*/) {
                                var middleware = Array.prototype.slice.call(arguments, 1);

                                (expressRoutes.get[route] || (expressRoutes.get[route] = [])).push(middleware);
                            });
                            spyOn(expressApp, 'set');

                            return expressApp;
                        });

                        browser = { isMobile: false, isDesktop: true };
                        MockBrowserInfo = require.cache[require.resolve('../../lib/browserInfo')].exports = jasmine.createSpy('BrowserInfo()').and.returnValue(browser);

                        delete require.cache[require.resolve('../../bin/player')];
                        Player = require('../../bin/player');
                        MockPlayer = require.cache[require.resolve('../../bin/player')].exports = jasmine.createSpy('MockPlayer()').and.callFake(function(config) {
                            return (player = new Player(config));
                        });
                        MockPlayer.startService = Player.startService;

                        MockPlayer.startService().then(success, failure).finally(done);
                    });

                    afterEach(function() {
                        process.removeAllListeners('SIGUSR2');
                        process.removeAllListeners('message');
                        delete require.cache[require.resolve('express')];
                        delete require.cache[require.resolve('../../lib/browserInfo')];
                    });

                    it('should start the service', function() {
                        expect(service.start).toHaveBeenCalledWith(jasmine.objectContaining({
                            defaultConfig: {
                                pidDir: require('path').resolve(__dirname, '../../pids'),
                                appName: 'player',
                                appDir: require('path').dirname(require.resolve('../../bin/player')),
                                api: {
                                    root: 'http://localhost/',
                                    branding: {
                                        endpoint: 'collateral/branding/',
                                        cacheTTLs: {
                                            fresh: 15,
                                            max: 30
                                        }
                                    },
                                    player: {
                                        endpoint: 'apps/mini-reel-player/index.html'
                                    },
                                    experience: {
                                        endpoint: 'api/public/content/experience/',
                                        validParams: [
                                            'campaign', 'branding', 'placementId',
                                            'container', 'wildCardPlacement',
                                            'pageUrl', 'hostApp', 'network',
                                            'preview'
                                        ],
                                        cacheTTLs: {
                                            fresh: 1,
                                            max: 5
                                        },
                                        default: 'e-00000000000000'
                                    },
                                    card: {
                                        endpoint: 'api/public/content/cards/',
                                        validParams: [
                                            'container', 'pageUrl',
                                            'hostApp', 'network', 'experience',
                                            'preview'
                                        ],
                                        cacheTTLs: {
                                            fresh: 1,
                                            max: 5
                                        }
                                    }
                                },
                                cloudwatch: {
                                    namespace: 'C6/Player',
                                    region: 'us-east-1',
                                    sendInterval: (5 * 60 * 1000),
                                    dimensions: [{ Name: 'Environment', Value: 'Development' }]
                                },
                                defaults: {
                                    origin: 'http://www.cinema6.com/',
                                    context: 'standalone',
                                    container: 'standalone',
                                    mobileType: 'mobile',
                                    standalone: true
                                },
                                validTypes: [
                                    'full-np', 'solo', 'desktop-card',
                                    'light',
                                    'lightbox',
                                    'mobile'
                                ],
                                typeRedirects: {
                                    'lightbox-playlist': 'lightbox',
                                    'full': 'full-np',
                                    'solo-ads': 'solo',
                                    'swipe': 'mobile'
                                }
                            }
                        }));
                        expect(service.parseCmdLine).toHaveBeenCalledWith(service.start.calls.mostRecent().args[0]);
                        expect(service.configure).toHaveBeenCalledWith(service.parseCmdLine.calls.mostRecent().args[0]);
                        expect(service.prepareServer).toHaveBeenCalledWith(service.configure.calls.mostRecent().args[0]);
                        expect(service.daemonize).toHaveBeenCalledWith(service.prepareServer.calls.mostRecent().args[0]);
                        expect(service.cluster).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0]);
                    });

                    it('should set the AWS region', function() {
                        expect(AWS.config.update).toHaveBeenCalledWith({ region: service.daemonize.calls.mostRecent().args[0].config.cloudwatch.region });
                    });

                    it('should create an express app', function() {
                        expect(mockExpress).toHaveBeenCalledWith();
                    });

                    it('should create some middleware for parsing query params', function() {
                        expect(expressUtils.parseQuery).toHaveBeenCalledWith({
                            arrays: ['categories', 'playUrls', 'countUrls', 'launchUrls']
                        });
                    });

                    it('should create some middleware for reporting request times to CloudWatch', function() {
                        var config = service.daemonize.calls.mostRecent().args[0].config;

                        expect(expressUtils.cloudwatchMetrics).toHaveBeenCalledWith(config.cloudwatch.namespace, config.cloudwatch.sendInterval, jasmine.objectContaining({
                            Dimensions: config.cloudwatch.dimensions
                        }));
                    });

                    it('should create a Player instance', function() {
                        expect(MockPlayer).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0].config);
                    });

                    it('should make express trust the 1st proxy', function() {
                        expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
                    });

                    it('should make the server listen on the port', function() {
                        expect(expressApp.listen).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0].cmdl.port);
                    });

                    it('should fulfill with the express app', function() {
                        expect(success).toHaveBeenCalledWith(expressApp);
                    });

                    describe('if started as a clusterMaster', function() {
                        var kids;

                        function Worker() {
                            this.send = jasmine.createSpy('child.send()');
                        }

                        beforeEach(function(done) {
                            mockExpress.calls.reset();
                            MockPlayer.calls.reset();
                            success.calls.reset();

                            service.cluster.and.callFake(function(state) {
                                state.clusterMaster = true;
                                kids = state.kids = [new Worker(), new Worker()];

                                return q(state);
                            });

                            MockPlayer.startService().finally(done);
                        });

                        it('should not create an express server', function() {
                            expect(mockExpress).not.toHaveBeenCalled();
                        });

                        it('should not create a Player instance', function() {
                            expect(MockPlayer).not.toHaveBeenCalled();
                        });

                        describe('signal: SIGUSR2', function() {
                            beforeEach(function() {
                                process.emit('SIGUSR2');
                            });

                            it('should send each kid the refresh command', function() {
                                kids.forEach(function(kid) {
                                    expect(kid.send).toHaveBeenCalledWith({ cmd: 'refresh' });
                                });
                            });
                        });
                    });

                    describe('signal: SIGUSR2', function() {
                        beforeEach(function() {
                            spyOn(player, 'resetCodeCache').and.callThrough();

                            process.emit('SIGUSR2');
                        });

                        it('should call player.resetCodeCache()', function() {
                            expect(player.resetCodeCache).toHaveBeenCalled();
                        });
                    });

                    describe('message: { cmd: "refresh" }', function() {
                        beforeEach(function() {
                            spyOn(player, 'resetCodeCache').and.callThrough();

                            process.emit('message', { cmd: 'hup' });
                            expect(player.resetCodeCache).not.toHaveBeenCalled();

                            process.emit('message', { cmd: 'refresh' });
                        });

                        it('should call player.resetCodeCache()', function() {
                            expect(player.resetCodeCache).toHaveBeenCalled();
                        });
                    });

                    describe('route: GET /api/public/players/:type', function() {
                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/public/players/:type', expressUtils.parseQuery.calls.mostRecent().returnValue, expressUtils.cloudwatchMetrics.calls.mostRecent().returnValue, jasmine.any(Function));
                        });

                        describe('when invoked', function() {
                            var state;
                            var middleware;
                            var request, response;
                            var headers;
                            var getDeferred;

                            beforeEach(function(done) {
                                state = service.daemonize.calls.mostRecent().args[0];

                                middleware = expressRoutes.get['/api/public/players/:type'][0][expressRoutes.get['/api/public/players/:type'][0].length - 1];
                                headers = {
                                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.99 Safari/537.36',
                                    'origin': 'https://github.com/cinema6/cwrx/pull/504/files'
                                };
                                request = {
                                    params: { type: 'lightbox' },
                                    query: {
                                        foo: 'bar',
                                        bleh: 'hey'
                                    },
                                    uuid: '8w94yr4389',
                                    get: function(header) {
                                        return headers[header.toLowerCase()];
                                    },
                                    secure: true
                                };
                                response = {
                                    send: jasmine.createSpy('response.send()'),
                                    redirect: jasmine.createSpy('response.redirect()')
                                };

                                getDeferred = q.defer();
                                spyOn(player, 'get').and.returnValue(getDeferred.promise);

                                middleware(request, response);
                                q().then(done);
                            });

                            it('should create a BrowserInfo()', function() {
                                expect(MockBrowserInfo).toHaveBeenCalledWith(request.get('user-agent'));
                            });

                            it('should get() the player', function() {
                                expect(player.get).toHaveBeenCalledWith(extend({
                                    type: request.params.type,
                                    uuid: request.uuid,
                                    origin: request.get('origin'),
                                    desktop: browser.isDesktop,
                                    secure: request.secure
                                }, request.query));
                            });

                            describe('and the get() succeeds', function() {
                                beforeEach(function(done) {
                                    getDeferred.fulfill(playerHTML);
                                    getDeferred.promise.finally(done);
                                });

                                it('should send() the response', function() {
                                    expect(response.send).toHaveBeenCalledWith(200, playerHTML);
                                });
                            });

                            describe('and the get() fails', function() {
                                describe('with no reason', function() {
                                    beforeEach(function(done) {
                                        getDeferred.reject();
                                        getDeferred.promise.finally(done);
                                    });

                                    it('should send a 500', function() {
                                        expect(response.send).toHaveBeenCalledWith(500, 'Internal error');
                                    });
                                });

                                describe('with a non-Error reason', function() {
                                    beforeEach(function(done) {
                                        getDeferred.reject('I failed!');
                                        getDeferred.promise.finally(done);
                                    });

                                    it('should send a 500', function() {
                                        expect(response.send).toHaveBeenCalledWith(500, 'Internal error');
                                    });
                                });

                                describe('with an Error reason', function() {
                                    var error;

                                    beforeEach(function(done) {
                                        error = new Error('I have a problem...');

                                        getDeferred.reject(error);
                                        getDeferred.promise.finally(done);
                                    });

                                    it('should send a 500', function() {
                                        expect(response.send).toHaveBeenCalledWith(500, error.message);
                                    });
                                });

                                describe('with an Error with a status', function() {
                                    var error;

                                    beforeEach(function() {
                                        error = new Error('It did not work.');
                                    });

                                    describe('below 500', function() {
                                        beforeEach(function(done) {
                                            error.status = 404;

                                            getDeferred.reject(error);
                                            getDeferred.promise.finally(done);
                                        });

                                        it('should use the status', function() {
                                            expect(response.send).toHaveBeenCalledWith(404, error.message);
                                        });
                                    });

                                    describe('above or equal to 500', function() {
                                        beforeEach(function(done) {
                                            error.status = 502;

                                            getDeferred.reject(error);
                                            getDeferred.promise.finally(done);
                                        });

                                        it('should use the status', function() {
                                            expect(response.send).toHaveBeenCalledWith(502, error.message);
                                        });
                                    });

                                    describe('and a logLevel', function() {
                                        beforeEach(function(done) {
                                            error.logLevel = 'info';
                                            error.status = 404;

                                            getDeferred.reject(error);
                                            getDeferred.promise.finally(done);
                                        });

                                        it('should use the status', function() {
                                            expect(response.send).toHaveBeenCalledWith(404, error.message);
                                        });
                                    });
                                });
                            });

                            describe('if the request has no origin', function() {
                                beforeEach(function() {
                                    player.get.calls.reset();
                                    player.get.and.returnValue(q(playerHTML));
                                    delete headers.origin;
                                });

                                describe('but has a referer', function() {
                                    beforeEach(function(done) {
                                        headers.referer = 'https://nodejs.org/api/modules.html#modules_module_filename';

                                        middleware(request, response).finally(done);
                                    });

                                    it('should set the referer as the origin', function() {
                                        expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({ origin: request.get('referer') }));
                                    });
                                });
                            });

                            [
                                'lightbox-playlist',
                                'full',
                                'solo-ads',
                                'swipe'
                            ].forEach(function(type) {
                                describe('if the type is ' + type, function() {
                                    var config;

                                    beforeEach(function(done) {
                                        response.send.calls.reset();
                                        player.get.calls.reset();
                                        player.get.and.returnValue(q(playerHTML));

                                        config = service.daemonize.calls.mostRecent().args[0].config;

                                        request.params.type = type;
                                        middleware(request, response).finally(done);
                                    });

                                    it('should not get() the player', function() {
                                        expect(player.get).not.toHaveBeenCalled();
                                    });

                                    it('should redirect the agent to the configured type', function() {
                                        expect(response.redirect).toHaveBeenCalledWith(301, config.typeRedirects[type] + formatURL({
                                            query: request.query
                                        }));
                                    });
                                });
                            });

                            describe('if the device is mobile', function() {
                                var config;

                                beforeEach(function() {
                                    config = service.daemonize.calls.mostRecent().args[0].config;

                                    delete config.typeRedirects.swipe;
                                    response.send.calls.reset();
                                    player.get.calls.reset();
                                    browser.isMobile = true;
                                    browser.isDesktop = false;
                                    player.get.and.returnValue(q(playerHTML));
                                });

                                describe('and a mobileType is specified', function() {
                                    beforeEach(function(done) {
                                        request.query.mobileType = 'swipe';

                                        middleware(request, response).finally(done);
                                    });

                                    it('should redirect the agent to the mobileType', function() {
                                        expect(response.redirect).toHaveBeenCalledWith(303, request.query.mobileType + formatURL({
                                            query: request.query
                                        }));
                                    });

                                    it('should not get() the player', function() {
                                        expect(player.get).not.toHaveBeenCalled();
                                        expect(response.send).not.toHaveBeenCalled();
                                    });

                                    describe('and the type is already the mobileType', function() {
                                        beforeEach(function(done) {
                                            response.redirect.calls.reset();
                                            player.get.calls.reset();
                                            response.send.calls.reset();

                                            request.params.type = request.query.mobileType;

                                            middleware(request, response).finally(done);
                                        });

                                        it('should not redirect the agent', function() {
                                            expect(response.redirect).not.toHaveBeenCalled();
                                        });

                                        it('should get() the player and send the response', function() {
                                            expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({
                                                desktop: browser.isDesktop
                                            }));
                                            expect(response.send).toHaveBeenCalledWith(200, jasmine.any(String));
                                        });
                                    });
                                });

                                describe('and a mobileType is not specified', function() {
                                    beforeEach(function(done) {
                                        delete request.query.mobileType;

                                        middleware(request, response).finally(done);
                                    });

                                    it('should redirect the agent to the default mobileType', function() {
                                        expect(response.redirect).toHaveBeenCalledWith(303, state.config.defaults.mobileType + formatURL({
                                            query: request.query
                                        }));
                                    });

                                    it('should not get() the player', function() {
                                        expect(player.get).not.toHaveBeenCalled();
                                        expect(response.send).not.toHaveBeenCalled();
                                    });

                                    describe('and the type is already the default mobileType', function() {
                                        beforeEach(function(done) {
                                            response.redirect.calls.reset();
                                            player.get.calls.reset();
                                            response.send.calls.reset();

                                            request.params.type = state.config.defaults.mobileType;

                                            middleware(request, response).finally(done);
                                        });

                                        it('should not redirect the agent', function() {
                                            expect(response.redirect).not.toHaveBeenCalled();
                                        });

                                        it('should get() the player and send the response', function() {
                                            expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({
                                                desktop: browser.isDesktop
                                            }));
                                            expect(response.send).toHaveBeenCalledWith(200, jasmine.any(String));
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    describe('instance:', function() {
        var config;
        var player;

        beforeEach(function() {
            config = {
                api: {
                    root: 'http://localhost/',
                    branding: {
                        endpoint: 'collateral/branding/',
                        cacheTTLs: {
                            fresh: 15,
                            max: 30
                        }
                    },
                    player: {
                        endpoint: 'apps/mini-reel-player/index.html'
                    },
                    experience: {
                        endpoint: 'api/public/content/experience/',
                        validParams: [
                            'campaign', 'branding', 'placementId',
                            'container', 'wildCardPlacement',
                            'pageUrl', 'hostApp', 'network',
                            'preview'
                        ],
                        cacheTTLs: {
                            fresh: 1,
                            max: 5
                        },
                        default: 'e-00000000000000'
                    },
                    card: {
                        endpoint: 'api/public/content/cards/',
                        validParams: [
                            'container', 'pageUrl',
                            'hostApp', 'network', 'experience',
                            'preview'
                        ],
                        cacheTTLs: {
                            fresh: 1,
                            max: 5
                        }
                    }
                },
                cloudwatch: {
                    namespace: 'C6/Player',
                    region: 'us-east-1',
                    sendInterval: 5 * 60 * 1000,
                    dimensions: [{ Name: 'Environment', Value: 'Development' }]
                },
                defaults: {
                    origin: 'http://www.cinema6.com/',
                    context: 'standalone',
                    container: 'standalone',
                    mobileType: 'mobile',
                    standalone: true
                },
                validTypes: [
                    'full-np', 'full', 'solo-ads', 'solo',
                    'light',
                    'lightbox-playlist', 'lightbox',
                    'mobile',  'swipe'
                ]
            };
            player = new Player(config);
        });

        it('should create a FunctionCache for experiences', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: config.api.experience.cacheTTLs.fresh,
                maxTTL: config.api.experience.cacheTTLs.max,
                extractor: clonePromise
            });
        });

        it('should create a FunctionCache for branding', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: config.api.branding.cacheTTLs.fresh,
                maxTTL: config.api.branding.cacheTTLs.max
            });
        });

        describe('@public', function() {
            describe('properties:', function() {
                describe('config', function() {
                    it('should be the provided config object', function() {
                        expect(player.config).toBe(config);
                    });
                });

                describe('adLoadTimeReporter', function() {
                    it('should be a CloudWatchReporter instance', function() {
                        expect(player.adLoadTimeReporter).toEqual(jasmine.any(CloudWatchReporter));
                        expect(player.adLoadTimeReporter.namespace).toBe(config.cloudwatch.namespace);
                        expect(player.adLoadTimeReporter.metricData).toEqual({
                            MetricName: 'AdLoadTime',
                            Unit: 'Milliseconds',
                            Dimensions: config.cloudwatch.dimensions
                        });
                        expect(player.adLoadTimeReporter.autoflush).toHaveBeenCalledWith(config.cloudwatch.sendInterval);
                    });
                });

                describe('adLoader', function() {
                    it('should be an AdLoader', function() {
                        expect(player.adLoader).toEqual(jasmine.any(AdLoader));
                        expect(player.adLoader).toBe(adLoader);
                    });

                    it('should be instantiated with values from the config', function() {
                        expect(MockAdLoader).toHaveBeenCalledWith({
                            envRoot: config.api.root,
                            cardEndpoint: config.api.card.endpoint,
                            cardCacheTTLs: config.api.card.cacheTTLs
                        });
                    });
                });
            });

            describe('methods:', function() {
                describe('resetCodeCache()', function() {
                    beforeEach(function() {
                        spyOn(player.__getPlayer__, 'clear').and.callThrough();

                        player.resetCodeCache();
                    });

                    it('should call clear() on the __getPlayer__() method', function() {
                        expect(player.__getPlayer__.clear).toHaveBeenCalled();
                    });
                });

                describe('get(options)', function() {
                    var success, failure;
                    var options;
                    var document, experience, sponsoredCards, normalCards;
                    var loadExperienceDeferred, loadCardDeferred;

                    beforeEach(function(done) {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        options = {
                            type: 'lightbox',
                            uuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo?id=e-92160a770b81d5&cb=fu92yr483r76472&foo=wer89437r83947r#foofurief',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            mobileMode: 'swipe',
                            preview: false,
                            categories: ['food', 'tech'],
                            playUrls: ['play1.gif', 'play2.gif'],
                            countUrls: ['count1.gif', 'count2.gif'],
                            launchUrls: ['launch1.gif', 'launch2.gif'],
                            desktop: true,
                            secure: true,
                            standalone: true,
                            embed: false,
                            countdown: false,
                            prebuffer: true
                        };

                        document = new HTMLDocument(playerHTML);
                        spyOn(document, 'addResource').and.callThrough();

                        loadExperienceDeferred = q.defer();
                        loadCardDeferred = q.defer();

                        experience = {
                            id: 'e-92160a770b81d5',
                            data: {
                                branding: 'elitedaily',
                                campaign: { launchUrls: ['launch.gif'] },
                                deck: [null, 'cam-2955fce737e487', null, null, 'cam-1e05bbe2a3ef74', 'cam-8a2f40a0344018', null]
                                    .map(function(campaignId, index) {
                                        return { id: 'rc-' + index, type: 'youtube', campaignId: campaignId, data: { skip: 30 } };
                                    })
                            }
                        };
                        sponsoredCards = AdLoader.getSponsoredCards(experience);
                        normalCards = experience.data.deck.filter(function(card) { return sponsoredCards.indexOf(card) < 0; });
                        spyOn(player, '__loadExperience__').and.returnValue(loadExperienceDeferred.promise);
                        spyOn(player, '__loadCard__').and.returnValue(loadCardDeferred.promise);

                        spyOn(player, '__getPlayer__').and.returnValue(q(document));

                        player.get(options).then(success, failure);
                        q().then(done);
                    });

                    it('should get the player', function() {
                        expect(player.__getPlayer__).toHaveBeenCalledWith(options.type, options.secure, options.uuid);
                    });

                    it('should load the experience', function() {
                        expect(player.__loadExperience__).toHaveBeenCalledWith(options.experience, options, 'http://cinema6.com/solo', options.uuid);
                    });

                    it('should not load a card', function() {
                        expect(player.__loadCard__).not.toHaveBeenCalled();
                    });

                    describe('when the experience is loaded', function() {
                        var loadAdsDeferred;
                        var brandings;

                        beforeEach(function(done) {
                            brandings = [
                                { src: 'theme.css', styles: 'body { padding: 10px; }' },
                                { src: 'theme--hover.css', styles: 'body { margin: 20px; }' }
                            ];
                            spyOn(player, '__getBranding__').and.returnValue(q(brandings));

                            spyOn(document, 'addCSS').and.callThrough();
                            spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();

                            loadExperienceDeferred.fulfill(experience);
                            process.nextTick(done);
                        });

                        it('should loading brandings for the player', function() {
                            expect(player.__getBranding__).toHaveBeenCalledWith(experience.data.branding, options.type, options.desktop, options.uuid);
                        });

                        it('should add the launchUrls to the experience', function() {
                            expect(experience.data.campaign.launchUrls).toEqual(['launch.gif'].concat(options.launchUrls));
                        });

                        it('should add the custom tracking pixels to each sponsored card', function() {
                            sponsoredCards.forEach(function(card) {
                                expect(MockAdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                    playUrls: options.playUrls,
                                    countUrls: options.countUrls
                                }, card);
                            });
                            expect(MockAdLoader.addTrackingPixels.calls.count()).toBe(sponsoredCards.length);
                        });

                        it('should set the skip value on each sponsored card', function() {
                            sponsoredCards.forEach(function(card) {
                                expect(card.data.skip).toBe(options.countdown, card.id);
                            });
                            normalCards.forEach(function(card) {
                                expect(card.data.skip).toBe(30, card.id);
                            });

                            expect(sponsoredCards.length).toBeGreaterThan(0);
                            expect(normalCards.length).toBeGreaterThan(0);
                        });

                        it('should set the prebuffer property on each card', function() {
                            experience.data.deck.forEach(function(card) {
                                expect(card.data.prebuffer).toBe(options.prebuffer);
                            });
                        });

                        it('should add the brandings as a resource', function() {
                            expect(brandings.length).toBeGreaterThan(0);
                            brandings.forEach(function(branding) {
                                expect(document.addCSS).toHaveBeenCalledWith(branding.src, branding.styles);
                            });
                        });

                        it('should add the experience as a resource', function() {
                            expect(document.addResource).toHaveBeenCalledWith('experience', 'application/json', experience);
                        });

                        it('should resolve to the player as a string of HTML', function() {
                            expect(success).toHaveBeenCalledWith(document.toString());
                        });
                    });

                    describe('if the countdown param is undefined', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();

                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));

                            options.countdown = undefined;

                            player.get(options).then(success, failure).finally(done);
                        });

                        it('should not set the skip value on any of the cards', function() {
                            experience.data.deck.forEach(function(card) {
                                expect(card.data.skip).toBe(30);
                            });
                        });
                    });

                    [false, undefined, null, ''].forEach(function(value) {
                        describe('if the prebuffer param is ' + value, function() {
                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();

                                spyOn(player, '__getBranding__').and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));

                                options.prebuffer = value;

                                player.get(options).then(success, failure).finally(done);
                            });

                            it('should set the prebuffer property on each card to false', function() {
                                experience.data.deck.forEach(function(card) {
                                    expect(card.data.prebuffer).toBe(false);
                                });
                            });
                        });
                    });

                    describe('if called with a card', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();
                            player.__loadExperience__.calls.reset();
                            player.__loadCard__.calls.reset();
                            player.__getPlayer__.calls.reset();

                            options.card = 'rc-82f93f7e3bc236';
                            player.get(options).then(success, failure).finally(done);
                        });

                        it('should reject the promise', function() {
                            var error = failure.calls.mostRecent().args[0];

                            expect(error.message).toBe('You may specify an experience or card, not both.');
                            expect(error.status).toBe(400);
                        });

                        it('should not call __loadExperience__(), __loadCard__() or __getPlayer__()', function() {
                            [player.__loadExperience__, player.__loadCard__, player.__getPlayer__].forEach(function(spy) {
                                expect(spy).not.toHaveBeenCalled();
                            });
                        });
                    });

                    describe('if called without an experience', function() {
                        beforeEach(function() {
                            success.calls.reset();
                            failure.calls.reset();
                            player.__loadExperience__.calls.reset();
                            player.__loadCard__.calls.reset();
                            player.__getPlayer__.calls.reset();

                            delete options.experience;
                        });

                        describe('and no card or campaign', function() {
                            beforeEach(function(done) {
                                delete options.card;
                                delete options.campaign;

                                player.get(options).then(success, failure).finally(done);
                            });

                            it('should reject the promise', function() {
                                var error = failure.calls.mostRecent().args[0];

                                expect(error.message).toBe('You must specify either an experience, card or campaign.');
                                expect(error.status).toBe(400);
                            });

                            it('should not call __loadExperience__(), __loadCard__() or __getPlayer__()', function() {
                                [player.__loadExperience__, player.__loadCard__, player.__getPlayer__].forEach(function(spy) {
                                    expect(spy).not.toHaveBeenCalled();
                                });
                            });

                            describe('but with embed: true', function() {
                                beforeEach(function(done) {
                                    success.calls.reset();
                                    failure.calls.reset();
                                    player.__loadExperience__.calls.reset();
                                    player.__loadCard__.calls.reset();
                                    player.__getPlayer__.calls.reset();

                                    player.__getPlayer__.and.returnValue(q(document));

                                    options.embed = true;
                                    delete options.branding;
                                    player.get(options).then(success, failure).finally(done);
                                });

                                it('should not call __loadExperience__() or __loadCard__()', function() {
                                    [player.__loadExperience__, player.__loadCard__].forEach(function(spy) {
                                        expect(spy).not.toHaveBeenCalled();
                                    });
                                });

                                it('should call __getPlayer__()', function() {
                                    expect(player.__getPlayer__).toHaveBeenCalledWith(options.type, options.secure, options.uuid);
                                });

                                it('should fulfill with the document as a String', function() {
                                    expect(success).toHaveBeenCalledWith(document.toString());
                                });

                                describe('and a branding', function() {
                                    var brandings;

                                    beforeEach(function(done) {
                                        success.calls.reset();
                                        failure.calls.reset();
                                        player.__loadExperience__.calls.reset();
                                        player.__loadCard__.calls.reset();
                                        player.__getPlayer__.calls.reset();
                                        spyOn(document, 'addCSS').and.callThrough();

                                        brandings = [
                                            { src: 'theme.css', styles: 'body { padding: 10px; }' },
                                            { src: 'theme--hover.css', styles: 'body { margin: 20px; }' }
                                        ];
                                        spyOn(player, '__getBranding__').and.returnValue(q(brandings));

                                        options.branding = 'rcplatform';

                                        player.get(options).then(success, failure).finally(done);
                                    });

                                    it('should not call __loadExperience__() or __loadCard__()', function() {
                                        [player.__loadExperience__, player.__loadCard__].forEach(function(spy) {
                                            expect(spy).not.toHaveBeenCalled();
                                        });
                                    });

                                    it('should call __getPlayer__()', function() {
                                        expect(player.__getPlayer__).toHaveBeenCalledWith(options.type, options.secure, options.uuid);
                                    });

                                    it('should loading brandings for the player', function() {
                                        expect(player.__getBranding__).toHaveBeenCalledWith(options.branding, options.type, options.desktop, options.uuid);
                                    });

                                    it('should add the brandings as a resource', function() {
                                        expect(brandings.length).toBeGreaterThan(0);
                                        brandings.forEach(function(branding) {
                                            expect(document.addCSS).toHaveBeenCalledWith(branding.src, branding.styles);
                                        });
                                    });

                                    it('should resolve to the player as a string of HTML', function() {
                                        expect(success).toHaveBeenCalledWith(document.toString());
                                    });
                                });
                            });
                        });

                        describe('and a card and campaign', function() {
                            beforeEach(function() {
                                options.card = 'rc-815770d013a72c';
                                options.campaign = 'cam-d702b101d0a046';
                                options.secure = false;

                                player.get(options).then(success, failure);
                            });

                            it('should get the player', function() {
                                expect(player.__getPlayer__).toHaveBeenCalledWith(options.type, options.secure, options.uuid);
                            });

                            it('should not load the experience', function() {
                                expect(player.__loadExperience__).not.toHaveBeenCalled();
                            });

                            it('should load the card', function() {
                                expect(player.__loadCard__).toHaveBeenCalledWith(options, 'http://cinema6.com/solo', options.uuid);
                            });

                            describe('when the card is loaded', function() {
                                var loadAdsDeferred;
                                var brandings;

                                beforeEach(function(done) {
                                    brandings = [
                                        { src: 'theme.css', styles: 'body { padding: 10px; }' },
                                        { src: 'theme--hover.css', styles: 'body { margin: 20px; }' }
                                    ];
                                    spyOn(player, '__getBranding__').and.returnValue(q(brandings));

                                    spyOn(document, 'addCSS').and.callThrough();
                                    spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();

                                    experience.data.deck = [
                                        {
                                            id: options.card,
                                            type: 'youtube',
                                            campaignId: options.campaign,
                                            data: {}
                                        }
                                    ];

                                    loadCardDeferred.fulfill(experience);
                                    process.nextTick(done);
                                });

                                it('should loading brandings for the player', function() {
                                    expect(player.__getBranding__).toHaveBeenCalledWith(experience.data.branding, options.type, options.desktop, options.uuid);
                                });

                                it('should add the launchUrls to the experience', function() {
                                    expect(experience.data.campaign.launchUrls).toEqual(['launch.gif'].concat(options.launchUrls));
                                });

                                it('should add the custom tracking pixels to each sponsored card', function() {
                                    expect(MockAdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                        playUrls: options.playUrls,
                                        countUrls: options.countUrls
                                    }, experience.data.deck[0]);
                                });

                                it('should set the skip value on the card', function() {
                                    expect(experience.data.deck[0].data.skip).toBe(options.countdown);
                                });

                                it('should set the prebuffer value on the card', function() {
                                    expect(experience.data.deck[0].data.prebuffer).toBe(options.prebuffer);
                                });

                                it('should add the brandings as a resource', function() {
                                    expect(brandings.length).toBeGreaterThan(0);
                                    brandings.forEach(function(branding) {
                                        expect(document.addCSS).toHaveBeenCalledWith(branding.src, branding.styles);
                                    });
                                });

                                it('should add the experience as a resource', function() {
                                    expect(document.addResource).toHaveBeenCalledWith('experience', 'application/json', experience);
                                });

                                it('should resolve to the player as a string of HTML', function() {
                                    expect(success).toHaveBeenCalledWith(document.toString());
                                });
                            });
                        });
                    });

                    describe('if called without an origin', function() {
                        beforeEach(function(done) {
                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.calls.reset();
                            loadExperienceDeferred.fulfill(experience);
                            options.origin = undefined;

                            player.get(options).finally(done);
                        });

                        it('should use the default origin', function() {
                            expect(player.__loadExperience__).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Object), config.defaults.origin, jasmine.any(String));
                        });
                    });

                    describe('if the experience has no launchUrls', function() {
                        beforeEach(function(done) {
                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));
                            delete experience.data.campaign.launchUrls;

                            player.get(options).finally(done);
                        });

                        it('should copy the launchUrls', function() {
                            expect(experience.data.campaign.launchUrls).toEqual(options.launchUrls);
                        });
                    });

                    describe('if the experience has no cards', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.and.callFake(function() {
                                experience.data.deck.length = 0;

                                return q(experience);
                            });

                            player.get(options).then(success, failure).finally(done);
                        });

                        it('should fail', function() {
                            var error = failure.calls.mostRecent().args[0];
                            expect(failure).toHaveBeenCalledWith(jasmine.any(Error));

                            expect(error.constructor.name).toBe('ServiceError');
                            expect(error.message).toBe('Experience {' + experience.id + '} has no cards.');
                            expect(error.status).toBe(409);
                        });
                    });

                    describe('if called with no launchUrls', function() {
                        beforeEach(function(done) {
                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));
                            options.launchUrls = null;

                            player.get(options).finally(done);
                        });

                        it('should leave the experience\'s launchUrls alone', function() {
                            expect(experience.data.campaign.launchUrls).toEqual(['launch.gif']);
                        });
                    });

                    describe('if called with vpaid: true', function() {
                        beforeEach(function() {
                            options.vpaid = true;
                        });

                        describe('if the experience has only one card', function() {
                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();
                                experience.data.deck.length = 1;
                                spyOn(player, '__getBranding__').and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));

                                player.get(options).then(success, failure).finally(done);
                            });

                            it('should succeed', function() {
                                expect(success).toHaveBeenCalledWith(document.toString());
                            });
                        });

                        describe('if the experience has more than one card', function() {
                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();
                                experience.data.deck.length = 2;
                                spyOn(player, '__getBranding__').and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));

                                player.get(options).then(success, failure).finally(done);
                            });

                            it('should fail', function() {
                                var error = failure.calls.mostRecent().args[0];
                                expect(failure).toHaveBeenCalledWith(jasmine.any(Error));

                                expect(error.constructor.name).toBe('ServiceError');
                                expect(error.message).toBe('VPAID does not support MiniReels.');
                                expect(error.status).toBe(400);
                            });
                        });
                    });

                    ['mraid', 'standalone', 'vpaid', 'embed'].forEach(function(context) {
                        describe('if the context is "' + context + '"', function() {
                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();
                                spyOn(player, '__getBranding__').and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));

                                options.context = context;

                                player.get(options).then(success, failure).finally(done);
                            });

                            it('should preload the first card', function() {
                                expect(experience.data.deck[0].data.preload).not.toBe(false);
                            });

                            it('should succeed', function() {
                                expect(success).toHaveBeenCalledWith(document.toString());
                            });
                        });
                    });

                    describe('if the experience has no branding', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(player, '__getBranding__').and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));
                            player.__getBranding__.calls.reset();
                            player.__loadExperience__.calls.reset();
                            delete experience.data.branding;

                            player.get(options).then(success, failure).finally(done);
                        });

                        it('should not __getBranding__()', function() {
                            expect(player.__getBranding__).not.toHaveBeenCalled();
                        });

                        it('should add the experience as a resource', function() {
                            expect(document.addResource).toHaveBeenCalledWith('experience', 'application/json', experience);
                        });

                        it('should fulfill with a String of HTML', function() {
                            expect(success).toHaveBeenCalledWith(document.toString());
                        });
                    });
                });
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
                describe('__apiParams__(type, params)', function() {
                    var type, params;
                    var result;

                    beforeEach(function() {
                        type = 'experience';
                        params = {
                            type: 'lightbox',
                            uuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo?id=e-92160a770b81d5&cb=fu92yr483r76472&foo=wer89437r83947r#foofurief',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            mobileMode: 'swipe',
                            preview: false,
                            categories: ['food', 'tech'],
                            playUrls: ['play1.gif', 'play2.gif'],
                            countUrls: ['count1.gif', 'count2.gif'],
                            launchUrls: ['launch1.gif', 'launch2.gif'],
                            desktop: true
                        };

                        result = player.__apiParams__(type, params);
                    });

                    it('should return an object that only contains the allowed params', function() {
                        expect(result).toEqual({
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            preview: false
                        });
                    });

                    describe('if an api node has no validParams', function() {
                        beforeEach(function() {
                            type = 'player';

                            result = player.__apiParams__(type, params);
                        });

                        it('should return a copy of the params', function() {
                            expect(result).toEqual(params);
                            expect(result).not.toBe(params);
                        });
                    });
                });

                describe('__loadCard__(params, origin, uuid)', function() {
                    var params, origin, uuid;
                    var getExperienceDeferred;
                    var success, failure;

                    beforeEach(function() {
                        params = {
                            type: 'lightbox',
                            uuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo?id=e-92160a770b81d5&cb=fu92yr483r76472&foo=wer89437r83947r#foofurief',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            mobileMode: 'swipe',
                            preview: false,
                            playUrls: ['play1.gif', 'play2.gif'],
                            countUrls: ['count1.gif', 'count2.gif'],
                            launchUrls: ['launch1.gif', 'launch2.gif'],
                            desktop: true
                        };
                        origin = 'http://cinema6.com/solo';
                        uuid = params.uuid;

                        getExperienceDeferred = q.defer();
                        spyOn(player, '__getExperience__').and.returnValue(getExperienceDeferred.promise);

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');
                    });

                    describe('with a card id and campaign', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(player.adLoader, 'getCard').and.returnValue(q.defer().promise);
                            spyOn(player.adLoader, 'findCard').and.returnValue(q.defer().promise);
                            player.__getExperience__.calls.reset();

                            params.card = 'rc-4a51653fcd65ac';
                            params.campaign = 'cam-dd8f7c06153451';

                            player.__loadCard__(params, origin, uuid).then(success, failure).finally(done);
                        });

                        it('should do nothing', function() {
                            expect(player.__getExperience__).not.toHaveBeenCalled();
                            expect(player.adLoader.findCard).not.toHaveBeenCalled();
                            expect(player.adLoader.getCard).not.toHaveBeenCalled();
                        });

                        it('should reject the promise', function() {
                            var error = failure.calls.mostRecent().args[0];

                            expect(error.message).toBe('Cannot specify campaign with card.');
                            expect(error.status).toBe(400);
                        });
                    });

                    describe('with a campaign id or categories', function() {
                        beforeEach(function() {
                            params.campaign = 'cam-dd8f7c06153451';
                            params.categories = ['food', 'tech'];

                            player.__loadCard__(params, origin, uuid).then(success, failure);
                        });

                        it('should fetch the default experience', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(config.api.experience.default, player.__apiParams__('experience', params), origin, uuid);
                        });

                        describe('when the default experience is fetched', function() {
                            var experience;
                            var findCardDeferred;

                            beforeEach(function(done) {
                                findCardDeferred = q.defer();
                                spyOn(player.adLoader, 'findCard').and.returnValue(findCardDeferred.promise);

                                jasmine.clock().mockDate();
                                spyOn(player.adLoadTimeReporter, 'push');

                                experience = {
                                    id: config.api.experience.default,
                                    data: {
                                        wildCardPlacement: '475839475',
                                        title: null,
                                        deck: []
                                    }
                                };
                                getExperienceDeferred.fulfill(experience);

                                process.nextTick(done);
                            });

                            it('should find the card', function() {
                                expect(player.adLoader.findCard).toHaveBeenCalledWith({
                                    campaign: params.campaign,
                                    categories: params.categories
                                }, extend({ experience: experience.id }, player.__apiParams__('card', params)), uuid);
                            });

                            describe('and the card is fetched', function() {
                                var card;

                                beforeEach(function(done) {
                                    jasmine.clock().tick(250);

                                    card = {
                                        id: params.card,
                                        title: 'My Awesome Card!',
                                        data: {},
                                        campaign: {}
                                    };
                                    findCardDeferred.fulfill(card);

                                    process.nextTick(done);
                                });

                                it('should set the experience\'s title to the card\'s', function() {
                                    expect(experience.data.title).toBe(card.title);
                                });

                                it('should put the card in the deck', function() {
                                    expect(experience.data.deck).toEqual([card]);
                                });

                                it('should report the time it took to load the ad', function() {
                                    expect(player.adLoadTimeReporter.push).toHaveBeenCalledWith(250);
                                });

                                it('should fulfill with the experience', function() {
                                    expect(success).toHaveBeenCalledWith(experience);
                                });
                            });

                            describe('and no card is found', function() {
                                beforeEach(function(done) {
                                    findCardDeferred.fulfill(null);

                                    process.nextTick(done);
                                });

                                it('should reject the promise', function() {
                                    var error = failure.calls.mostRecent().args[0];

                                    expect(error.message).toBe('No cards found.');
                                    expect(error.status).toBe(404);
                                });

                                it('should not log an error', function() {
                                    expect(log.error).not.toHaveBeenCalled();
                                });
                            });

                            describe('and the card fails to be fetched', function() {
                                var reason;

                                beforeEach(function(done) {
                                    reason = new Error('Something went wrong!');
                                    findCardDeferred.reject(reason);

                                    process.nextTick(done);
                                });

                                it('should reject the promise', function() {
                                    var error = failure.calls.mostRecent().args[0];

                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });
                            });
                        });

                        describe('if getting the experience fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something is awful.');
                                getExperienceDeferred.reject(reason);

                                process.nextTick(done);
                            });

                            it('should reject the promise', function() {
                                expect(failure).toHaveBeenCalledWith(reason);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });
                        });
                    });

                    describe('with a card ID', function() {
                        beforeEach(function() {
                            params.card = 'rc-4a51653fcd65ac';

                            player.__loadCard__(params, origin, uuid).then(success, failure);
                        });

                        it('should fetch the default experience', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(config.api.experience.default, player.__apiParams__('experience', params), origin, uuid);
                        });

                        describe('when the default experience is fetched', function() {
                            var experience;
                            var getCardDeferred;

                            beforeEach(function(done) {
                                getCardDeferred = q.defer();
                                spyOn(player.adLoader, 'getCard').and.returnValue(getCardDeferred.promise);

                                jasmine.clock().mockDate();
                                spyOn(player.adLoadTimeReporter, 'push');

                                experience = {
                                    id: config.api.experience.default,
                                    data: {
                                        wildCardPlacement: '475839475',
                                        title: null,
                                        deck: []
                                    }
                                };
                                getExperienceDeferred.fulfill(experience);

                                process.nextTick(done);
                            });

                            it('should find the card', function() {
                                expect(player.adLoader.getCard).toHaveBeenCalledWith(params.card, extend({
                                    experience: experience.id
                                }, player.__apiParams__('card', params)), uuid);
                            });

                            describe('and the card is fetched', function() {
                                var card;

                                beforeEach(function(done) {
                                    jasmine.clock().tick(37);

                                    card = {
                                        id: params.card,
                                        title: 'My Awesome Card!',
                                        data: {},
                                        campaign: {}
                                    };
                                    getCardDeferred.fulfill(card);

                                    process.nextTick(done);
                                });

                                it('should set the experience\'s title to the card\'s', function() {
                                    expect(experience.data.title).toBe(card.title);
                                });

                                it('should put the card in the deck', function() {
                                    expect(experience.data.deck).toEqual([card]);
                                });

                                it('should report the time it took to load the ad', function() {
                                    expect(player.adLoadTimeReporter.push).toHaveBeenCalledWith(37);
                                });

                                it('should fulfill with the experience', function() {
                                    expect(success).toHaveBeenCalledWith(experience);
                                });
                            });

                            describe('and the card fails to be fetched', function() {
                                var reason;

                                beforeEach(function(done) {
                                    reason = new Error('Something went wrong!');
                                    getCardDeferred.reject(reason);

                                    process.nextTick(done);
                                });

                                it('should reject the promise', function() {
                                    var error = failure.calls.mostRecent().args[0];

                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });

                                it('should not log an error', function() {
                                    expect(log.error).not.toHaveBeenCalled();
                                });
                            });
                        });

                        describe('if getting the experience fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something is awful.');
                                getExperienceDeferred.reject(reason);

                                process.nextTick(done);
                            });

                            it('should reject the promise', function() {
                                expect(failure).toHaveBeenCalledWith(reason);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });
                        });
                    });
                });

                describe('__loadExperience__(id, params, origin, uuid)', function() {
                    var id, params, origin, uuid;
                    var experience;
                    var getExperienceDeferred;

                    var success, failure;

                    beforeEach(function() {
                        id = 'e-e2614b1f75c418';
                        params = {
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            network: 'mopub',
                            id: id,
                            mobileMode: 'swipe',
                            preview: false,
                            categories: ['foo', 'bar']
                        };
                        origin = 'jsfiddle.net';
                        uuid = 'w9hf493rh8439r';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        experience = {
                            id: 'e-92160a770b81d5',
                            data: {
                                branding: 'elitedaily',
                                campaign: { launchUrls: ['launch.gif'] },
                                deck: [null, 'cam-2955fce737e487', null, null, 'cam-1e05bbe2a3ef74', 'cam-8a2f40a0344018', null]
                                    .map(function(campaignId, index) {
                                        return { id: 'rc-' + index, type: 'youtube', campaignId: campaignId, data: {} };
                                    })
                            }
                        };
                        getExperienceDeferred = q.defer();
                        spyOn(player, '__getExperience__').and.returnValue(getExperienceDeferred.promise);

                        player.__loadExperience__(id, params, origin, uuid).then(success, failure);
                    });

                    it('should get the experience', function() {
                        expect(player.__getExperience__).toHaveBeenCalledWith(id, player.__apiParams__('experience', params), origin, uuid);
                    });

                    describe('when the experience is fetched', function() {
                        var loadAdsDeferred;
                        var sponsoredCards;

                        beforeEach(function(done) {
                            jasmine.clock().mockDate();

                            loadAdsDeferred = q.defer();
                            spyOn(player.adLoader, 'loadAds').and.returnValue(loadAdsDeferred.promise);

                            sponsoredCards = AdLoader.getSponsoredCards(experience);

                            getExperienceDeferred.fulfill(experience);
                            getExperienceDeferred.promise.finally(done);
                        });

                        it('should load ads for the experience', function() {
                            expect(player.adLoader.loadAds).toHaveBeenCalledWith(experience, params.categories, params.campaign, uuid);
                        });

                        describe('if loading the ads', function() {
                            beforeEach(function() {
                                jasmine.clock().tick(650);

                                spyOn(player.adLoadTimeReporter, 'push').and.callThrough();
                                spyOn(MockAdLoader, 'removePlaceholders').and.callThrough();
                                spyOn(MockAdLoader, 'removeSponsoredCards').and.callThrough();
                                spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();
                            });

                            describe('succeeds', function() {
                                beforeEach(function(done) {
                                    loadAdsDeferred.fulfill(experience);
                                    process.nextTick(done);
                                });

                                it('should send metrics to CloudWatch', function() {
                                    expect(player.adLoadTimeReporter.push).toHaveBeenCalledWith(650);
                                });

                                it('should not removePlaceholders() or removeSponsoredCards()', function() {
                                    expect(MockAdLoader.removePlaceholders).not.toHaveBeenCalled();
                                    expect(MockAdLoader.removeSponsoredCards).not.toHaveBeenCalled();
                                });

                                it('should fulfill with the experience', function() {
                                    expect(success).toHaveBeenCalledWith(experience);
                                });
                            });

                            describe('fails', function() {
                                beforeEach(function(done) {
                                    loadAdsDeferred.reject(new Error('ADTECH id shitty. Who knew?'));
                                    process.nextTick(done);
                                });

                                it('should removePlaceholders() and removeSponsoredCards()', function() {
                                    expect(MockAdLoader.removePlaceholders).toHaveBeenCalledWith(experience);
                                    expect(MockAdLoader.removeSponsoredCards).toHaveBeenCalledWith(experience);
                                });

                                it('should fulfill with the experience', function() {
                                    expect(success).toHaveBeenCalledWith(experience);
                                });
                            });
                        });
                    });

                    describe('if called with preview: true', function() {
                        beforeEach(function(done) {
                            player.__getExperience__.and.returnValue(q(experience));
                            spyOn(Player.prototype, '__getExperience__').and.returnValue(q(experience));
                            spyOn(player.adLoader, 'loadAds').and.returnValue(q(experience));
                            player.__getExperience__.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(MockAdLoader, 'removePlaceholders').and.callThrough();
                            spyOn(MockAdLoader, 'removeSponsoredCards').and.callThrough();
                            spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();
                            params.preview = true;

                            player.__loadExperience__(id, params, origin, uuid).then(success, failure).finally(done);
                        });

                        it('should call the uncached version of __getExperience__()', function() {
                            expect(Player.prototype.__getExperience__).toHaveBeenCalledWith(id, player.__apiParams__('experience', params), origin, uuid);
                            expect(Player.prototype.__getExperience__.calls.mostRecent().object).toBe(player);
                            expect(player.__getExperience__).not.toHaveBeenCalled();
                        });

                        it('should load ads for the experience', function() {
                            expect(player.adLoader.loadAds).toHaveBeenCalledWith(experience, params.categories, params.campaign, uuid);
                        });

                        it('should not removePlaceholders() from the experience', function() {
                            expect(MockAdLoader.removePlaceholders).not.toHaveBeenCalled();
                        });

                        it('should not removeSponsoredCards() from the experience', function() {
                            expect(MockAdLoader.removeSponsoredCards).not.toHaveBeenCalled();
                        });

                        it('should fulfill with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });

                    describe('if the experience has no ads', function() {
                        beforeEach(function(done) {
                            player.__getExperience__.and.returnValue(q(experience));
                            spyOn(player.adLoader, 'loadAds').and.returnValue(q(experience));
                            player.__getExperience__.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(MockAdLoader, 'removePlaceholders').and.callThrough();
                            spyOn(MockAdLoader, 'removeSponsoredCards').and.callThrough();
                            spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();
                            experience.data.deck = experience.data.deck.map(function(card) {
                                return !(card.type === 'wildcard' || typeof card.campaignId === 'string');
                            });

                            player.__loadExperience__(id, params, origin, uuid).then(success, failure).finally(done);
                        });

                        it('should not loadAds()', function() {
                            expect(player.adLoader.loadAds).not.toHaveBeenCalled();
                        });

                        it('should fulfill with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });
                });

                describe('__getBranding__(branding, type, hover, uuid)', function() {
                    var branding, type, hover, uuid;
                    var result;
                    var base;
                    var success, failure;

                    beforeEach(function() {
                        branding = 'cinema6';
                        type = 'full-np';
                        uuid = 'ru8493ry438r';

                        base = resolveURL(config.api.root, config.api.branding.endpoint);

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');
                    });

                    afterEach(function() {
                        player.__getBranding__.clear();
                    });

                    it('should be cached', function() {
                        expect(fnCaches[2].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.__getBranding__);
                        fnCaches[2].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__getBranding__) {
                                expect(call.args).toEqual([jasmine.any(Function), -1]);
                            }
                        });
                    });

                    describe('if hover is false', function() {
                        beforeEach(function(done) {
                            hover = false;

                            result = player.__getBranding__(branding, type, hover, uuid);
                            result.then(success, failure);
                            q().then(done);
                        });

                        it('should make a request for just the base branding stylesheets', function() {
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css'));
                            expect(request.get.calls.count()).toBe(2);
                        });

                        describe('when the requests fulfill', function() {
                            var themeCSS, coreCSS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                coreCSS = 'body { background: red; }';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].resolve(coreCSS);

                                result.finally(done);
                            });

                            it('should fulfill with an Array of css', function() {
                                expect(success).toHaveBeenCalledWith([jasmine.any(Object), jasmine.any(Object)]);
                                expect(success).toHaveBeenCalledWith(jasmine.arrayContaining([
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), styles: themeCSS },
                                    { src: resolveURL(base, branding + '/styles/core.css'), styles: coreCSS }
                                ]));
                            });
                        });

                        describe('if a request rejects', function() {
                            var themeCSS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });

                                result.finally(done);
                            });

                            it('should fulfill with an Array of the css that was fetched', function() {
                                expect(success).toHaveBeenCalledWith([
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), styles: themeCSS }
                                ]);
                            });
                        });
                    });

                    describe('if hover is true', function() {
                        beforeEach(function(done) {
                            hover = true;

                            result = player.__getBranding__(branding, type, hover, uuid);
                            result.then(success, failure);
                            q().then(done);
                        });

                        it('should make a request for the base and hover branding stylesheets', function() {
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core--hover.css'));
                            expect(request.get.calls.count()).toBe(4);
                        });

                        describe('when the requests fulfill', function() {
                            var themeCSS, coreCSS, themeHoverCSS, coreHoverCSS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                coreCSS = 'body { background: red; }';
                                themeHoverCSS = 'body { background: blue; }';
                                coreHoverCSS = 'body { background: green; }';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].resolve(coreCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css')].resolve(themeHoverCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css')].resolve(coreHoverCSS);

                                result.finally(done);
                            });

                            it('should fulfill with an Array of css', function() {
                                expect(success).toHaveBeenCalledWith([jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object)]);
                                expect(success).toHaveBeenCalledWith(jasmine.arrayContaining([
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), styles: themeCSS },
                                    { src: resolveURL(base, branding + '/styles/core.css'), styles: coreCSS },
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'), styles: themeHoverCSS },
                                    { src: resolveURL(base, branding + '/styles/core--hover.css'), styles: coreHoverCSS }
                                ]));
                            });
                        });

                        describe('if a request rejects', function() {
                            var themeCSS, themeHoverCSS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                themeHoverCSS = 'body { background: blue; }';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css')].resolve(themeHoverCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });

                                result.finally(done);
                            });

                            it('should fulfill with an Array of the css that was fetched', function() {
                                expect(success).toHaveBeenCalledWith([
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), styles: themeCSS },
                                    { src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'), styles: themeHoverCSS }
                                ]);
                            });
                        });
                    });
                });

                describe('__getExperience__(id, params, origin, uuid)', function() {
                    var id, params, origin, uuid;
                    var result;
                    var success, failure;
                    var contentURL;

                    beforeEach(function(done) {
                        id = 'e-92160a770b81d5';
                        params = {
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'elitedaily',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            network: 'mopub',
                            id: id,
                            mobileMode: 'swipe',
                            preview: true
                        };
                        origin = 'http://cinema6.com/solo';
                        uuid = 'fuweyhrf84yr3';

                        contentURL = 'http://localhost/api/public/content/experience/e-92160a770b81d5';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        result = player.__getExperience__(id, params, origin);
                        result.then(success, failure);
                        q().then(done);
                    });

                    it('should cache the function', function() {
                        expect(fnCaches[1].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.__getExperience__);
                        fnCaches[1].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__getExperience__) {
                                expect(call.args).toEqual([jasmine.any(Function), -1]);
                            }
                        });
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should make a request to the content service', function() {
                        expect(request.get).toHaveBeenCalledWith(contentURL, {
                            qs: params,
                            headers: { origin: origin },
                            json: true
                        });
                    });

                    describe('when the request succeeds', function() {
                        var experience;

                        beforeEach(function(done) {
                            experience = { id: 'e-92160a770b81d5' };

                            requestDeferreds[request.get.calls.mostRecent().args[0]].resolve(experience);
                            result.finally(done);
                        });

                        it('should fulfill with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });

                        it('should decorate the experience with params', function() {
                            expect(experience.$params).toEqual(params);
                        });
                    });

                    describe('when the request fails', function() {
                        describe('with a 4xx status', function() {
                            beforeEach(function(done) {
                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject({
                                    statusCode: 404,
                                    message: '404 - experience not found'
                                });

                                result.finally(done);
                            });

                            it('should not log an error', function() {
                                expect(log.error).not.toHaveBeenCalled();
                            });

                            it('should return a ServiceError', function() {
                                var error = failure.calls.mostRecent().args[0];

                                expect(error.constructor.name).toBe('ServiceError');
                                expect(error.message).toBe('404 - experience not found');
                                expect(error.status).toBe(404);
                            });
                        });

                        describe('with a 5xx status', function() {
                            beforeEach(function(done) {
                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject({
                                    statusCode: 500,
                                    message: 'Internal error'
                                });

                                result.finally(done);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });

                            it('should return a ServiceError', function() {
                                var error = failure.calls.mostRecent().args[0];

                                expect(error.constructor.name).toBe('ServiceError');
                                expect(error.message).toBe('Internal error');
                                expect(error.status).toBe(500);
                            });
                        });
                    });

                    describe('if called with no id', function() {
                        beforeEach(function(done) {
                            failure.calls.reset();
                            success.calls.reset();
                            request.get.calls.reset();

                            player.__getExperience__(undefined, params, origin).then(success, failure).finally(done);
                        });

                        it('should reject the promise', function() {
                            var error = failure.calls.mostRecent().args[0];

                            expect(error.constructor.name).toBe('ServiceError');
                            expect(error.status).toBe(400);
                            expect(error.message).toBe('experience must be specified');
                        });

                        it('should not get anything', function() {
                            expect(request.get).not.toHaveBeenCalled();
                        });
                    });
                });

                describe('__getPlayer__(mode, secure, uuid)', function() {
                    var success, failure;
                    var mode, secure, uuid;
                    var result;

                    beforeEach(function() {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');
                        mode = 'lightbox';
                        secure = false;
                        uuid = 'ehfurihf43iu';

                        result = player.__getPlayer__(mode, secure, uuid);
                        result.then(success, failure);
                    });

                    it('should be cached', function() {
                        expect(fnCaches[0].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.__getPlayer__);
                        fnCaches[0].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__getPlayer__) {
                                expect(call.args).toEqual([jasmine.any(Function), -1]);
                            }
                        });
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should make a request for the player', function() {
                        expect(request.get).toHaveBeenCalledWith(resolveURL(config.api.root, config.api.player.endpoint), { gzip: true });
                    });

                    describe('when the player fails to be fetched', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Could not download stuff.');
                            requestDeferreds[resolveURL(config.api.root, config.api.player.endpoint)].reject(reason);

                            result.finally(done);
                        });

                        it('should reject the promsise', function() {
                            expect(failure).toHaveBeenCalledWith(reason);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });

                    describe('when the player is fetched', function() {
                        beforeEach(function(done) {
                            q().then(function() {
                                request.get.calls.reset();
                                requestDeferreds[resolveURL(config.api.root, config.api.player.endpoint)].resolve(playerHTML);
                            }).then(function() {
                                return requestDeferreds[resolveURL(config.api.root, config.api.player.endpoint)].promise;
                            }).then(function() {
                                return new q.Promise(function(resolve) {
                                    setTimeout(resolve, 0);
                                });
                            }).done(done);
                        });

                        it('should make requests for the local CSS/JS files', function() {
                            expect(request.get).toHaveBeenCalledWith('http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css', { gzip: true });
                            expect(request.get).toHaveBeenCalledWith('http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js', { gzip: true });
                            expect(request.get.calls.count()).toBe(2);
                        });

                        describe('if a sub-resource fails to be fetched', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Could not download stuff.');
                                requestDeferreds['http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js'].reject(reason);

                                result.finally(done);
                            });

                            it('should reject the promsise', function() {
                                expect(failure).toHaveBeenCalledWith(reason);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });
                        });

                        describe('and the sub-resources are fetched', function() {
                            beforeEach(function(done) {
                                requestDeferreds['http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css'].resolve(playerCSS);
                                requestDeferreds['http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js'].resolve(playerJS);

                                result.then(function() {}).then(done, done);
                            });

                            it('should fulfill with an HTMLDocument where the external resources are replaced with inline ones', function() {
                                var $orig = cheerio.load(playerHTML);
                                var $result = cheerio.load(success.calls.mostRecent().args[0].toString());

                                expect(success).toHaveBeenCalledWith(jasmine.any(HTMLDocument));

                                expect($result('*').length).toBe($orig('*').length);
                                expect($result('script[src="${mode}.js"]').length).toBe(0);
                                expect($result('script[src="lightbox.js"]').length).toBe(0);
                                expect($result('link[href="css/${mode}.css"]').length).toBe(0);
                                expect($result('link[href="css/lightbox.css"]').length).toBe(0);

                                expect($result('script[data-src="http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js"]').text()).toBe(HTMLDocument.rebaseJS(playerJS, 'http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js').replace(/<\/script>/g, '<\\/script>'));
                                expect($result('style[data-href="http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css"]').text()).toBe(HTMLDocument.rebaseCSS(playerCSS, 'http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css'));
                                expect($result('base').attr('href')).toBe('http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/');
                            });
                        });
                    });

                    describe('if secure is true', function() {
                        beforeEach(function(done) {
                            request.get.calls.reset();
                            player.__getPlayer__.clear();
                            success.calls.reset();
                            failure.calls.reset();
                            secure = true;

                            jasmine.clock().uninstall();

                            player.__getPlayer__(mode, secure, uuid).then(success, failure).finally(done);
                            q.delay(1).then(function() {
                                requestDeferreds[resolveURL(config.api.root, config.api.player.endpoint)].resolve(playerHTML);
                            }).delay(1).then(function() {
                                requestDeferreds['https://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css'].resolve(playerCSS);
                                requestDeferreds['https://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js'].resolve(playerJS);
                            }).delay(1).catch(function(error) { console.error(error); });
                        });

                        afterEach(function() {
                            jasmine.clock().install();
                        });

                        it('should make the base tag secure', function() {
                            var $result = cheerio.load(success.calls.mostRecent().args[0].toString());

                            expect($result('base').attr('href')).toBe('https://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/');
                        });
                    });

                    describe('if called with a valid player type', function() {
                        beforeEach(function(done) {
                            request.get.calls.reset();
                            player.__getPlayer__.clear();
                            config.validTypes.forEach(function(type) {
                                player.__getPlayer__(type, undefined);
                            });
                            q().then(done);
                        });

                        it('should allow the request to happen', function() {
                            expect(request.get.calls.count()).toBe(config.validTypes.length);
                        });
                    });

                    describe('if passed an invalid type', function() {
                        var types;

                        beforeEach(function(done) {
                            request.get.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            types = ['foo', 'bar', 'fulls', 'lightboxy'];

                            types.forEach(function(type) {
                                player.__getPlayer__(type, undefined).then(success, failure);
                            });
                            q().then(function() {}).then(done);
                        });

                        it('should not make any requests', function() {
                            expect(request.get).not.toHaveBeenCalled();
                        });

                        it('should reject the promise', function() {
                            expect(failure.calls.count()).toBe(4);
                            failure.calls.all().forEach(function(call, index) {
                                var error = call.args[0];
                                var type = types[index];

                                expect(error).toEqual(jasmine.any(Error));
                                expect(error.constructor.name).toBe('ServiceError');
                                expect(error.message).toBe('Unknown player type: ' + type);
                                expect(error.status).toBe(404);
                                expect(error.toString()).toBe('[404] Unknown player type: ' + type);
                            });
                        });
                    });
                });
            });
        });
    });
});
