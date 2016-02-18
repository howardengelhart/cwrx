describe('player service', function() {
    var Player;
    var BluebirdPromise;
    var q;
    var Promise;
    var request;
    var cheerio;
    var FunctionCache;
    var BrowserInfo;
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
    var fs;
    var MockReadable;
    var AppBuilder;
    var streamToPromise;
    var _;
    var VAST;

    var requestDeferreds;
    var fnCaches;
    var MockFunctionCache;
    var MockAdLoader;
    var MockAppBuilder;
    var MockBrowserInfo;
    var playerHTML;
    var builtPlayerHTML;
    var playerCSS;
    var playerJS;
    var log;
    var adLoader;
    var reporter;
    var built;

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
        fs = require('fs-extra');
        MockReadable = require('./helpers/MockReadable');
        streamToPromise = require('stream-to-promise');
        _ = require('lodash');
        VAST = require('vastacular').VAST;

        playerHTML = require('fs').readFileSync(require.resolve('./helpers/player.html')).toString();
        builtPlayerHTML = require('fs').readFileSync(require.resolve('./helpers/player--built.html')).toString();
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

        delete require.cache[require.resolve('rc-browser-info')];
        BrowserInfo = require('rc-browser-info');
        MockBrowserInfo = require.cache[require.resolve('rc-browser-info')].exports = jasmine.createSpy('BrowserInfo()').and.callFake(BrowserInfo);

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
            var add = cache.add;

            spyOn(cache, 'add').and.callFake(function() {
                var realFn = add.apply(this, arguments);
                var fn = jasmine.createSpy('cachedFn()').and.callFake(realFn);

                fn.clear = realFn.clear;

                return fn;
            });

            return fnCaches[fnCaches.push(cache) - 1];
        });

        MockFunctionCache = require('../../lib/functionCache');

        delete require.cache[require.resolve('rc-app-builder')];
        AppBuilder = require('rc-app-builder');
        require.cache[require.resolve('rc-app-builder')].exports = jasmine.createSpy('AppBuilder()').and.callFake(function(config) {
            var builder = new AppBuilder(config);

            spyOn(builder, 'build').and.callFake(function() {
                return (built = new MockReadable(builtPlayerHTML));
            });

            return builder;
        });

        MockAppBuilder = require('rc-app-builder');

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

    describe('static:', function() {
        describe('@public', function() {
            describe('methods:', function() {
                describe('startService()', function() {
                    var MockPlayer, mockExpress, expressApp, mockErrHandler;
                    var player, browser;
                    var ServiceError;

                    var expressRoutes;
                    var success, failure;

                    function whenIndentity(value) {
                        return q(value);
                    }

                    beforeEach(function(done) {
                        jasmine.clock().mockDate();

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
                        
                        mockErrHandler = jasmine.createSpy('handleError()');
                        spyOn(expressUtils, 'errorHandler').and.returnValue(mockErrHandler);

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
                        MockBrowserInfo.and.returnValue(browser);

                        delete require.cache[require.resolve('../../bin/player')];
                        Player = require('../../bin/player');
                        MockPlayer = require.cache[require.resolve('../../bin/player')].exports = jasmine.createSpy('MockPlayer()').and.callFake(function(config) {
                            player = new Player(config);
                            spyOn(player, 'middlewareify').and.callThrough();

                            return player;
                        });
                        MockPlayer.startService = Player.startService;

                        MockPlayer.startService().then(success, failure)
                            .then(function() {
                                // This is my hacktastic way to get hold of the ServiceError constructor.
                                // Maybe ServiceError should go in a lib soon?
                                return player.__getExperience__().catch(function(error) {
                                    expect(error.constructor.name).toBe('ServiceError');
                                    ServiceError = error.constructor;
                                });
                            })
                            .then(done, done.fail);
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
                                            'campaign', 'branding', 'preview'
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
                                            'preview'
                                        ],
                                        cacheTTLs: {
                                            fresh: 1,
                                            max: 5
                                        }
                                    },
                                    placement: {
                                        endpoint: 'api/public/placements/',
                                        validParams: [],
                                        cacheTTLs: {
                                            fresh: 1,
                                            max: 5
                                        }
                                    }
                                },
                                tracking: {
                                    pixel: '//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif'
                                },
                                vast: {
                                    js: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.min.js',
                                    swf: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.swf'
                                },
                                app: {
                                    version: 'master'
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
                            arrays: ['categories', 'playUrls', 'countUrls', 'clickUrls', 'launchUrls']
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
                    
                    it('should include an error handler', function() {
                        expect(expressUtils.errorHandler).toHaveBeenCalledWith();
                        expect(expressApp.use).toHaveBeenCalledWith(mockErrHandler);
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

                    describe('route: GET /api/players/meta', function() {
                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/players/meta', jasmine.any(Function));
                        });

                        describe('when invoked', function() {
                            var state;
                            var middleware;
                            var req, res;
                            var getVersionDeferred;

                            beforeEach(function(done) {
                                state = service.daemonize.calls.mostRecent().args[0];

                                state.config.appVersion = 'player-1.0.0';

                                req = {
                                    params: {},
                                    query: {},
                                    uuid: '8w94yr4389',
                                    get: function() {},
                                    secure: true
                                };
                                res = {
                                    send: jasmine.createSpy('response.send()'),
                                    redirect: jasmine.createSpy('response.redirect()')
                                };

                                middleware = expressRoutes.get['/api/players/meta'][0][expressRoutes.get['/api/players/meta'][0].length - 1];

                                player.getVersion.calls.reset();
                                getVersionDeferred = q.defer();
                                player.getVersion.and.returnValue(getVersionDeferred.promise);

                                middleware(req, res);
                                process.nextTick(done);
                            });

                            it('should get the player\'s version', function() {
                                expect(player.getVersion).toHaveBeenCalledWith();
                            });

                            describe('when the version is fetched', function() {
                                var playerVersion;

                                beforeEach(function(done) {
                                    playerVersion = 'v1.0.0-rc3';
                                    getVersionDeferred.fulfill(playerVersion);
                                    process.nextTick(done);
                                });

                                it('should send a response with metadata', function() {
                                    expect(res.send).toHaveBeenCalledWith(200, {
                                        serviceVersion: state.config.appVersion,
                                        playerVersion: playerVersion,
                                        started: new Date().toISOString(),
                                        status: 'OK'
                                    });
                                });
                            });

                            describe('if something goes wrong', function() {
                                var error;

                                beforeEach(function(done) {
                                    error = new TypeError('You suck at typing.');
                                    getVersionDeferred.reject(error);
                                    process.nextTick(done);
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });

                                it('should send a [500]', function() {
                                    expect(res.send).toHaveBeenCalledWith(500, require('util').inspect(error));
                                });
                            });
                        });
                    });

                    describe('route: GET /api/public/player', function() {
                        var middlewareify;

                        beforeEach(function() {
                            middlewareify = _.find(player.middlewareify.calls.all(), function(call) {
                                return call.args[0] === 'getViaPlacement';
                            });
                            expect(middlewareify).toBeDefined();
                        });

                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/public/player', expressUtils.parseQuery.calls.mostRecent().returnValue, expressUtils.cloudwatchMetrics.calls.mostRecent().returnValue, middlewareify.returnValue);
                        });
                    });

                    describe('route: GET /api/public/vast/2.0/tag', function() {
                        var middlewareify;

                        beforeEach(function() {
                            middlewareify = _.find(player.middlewareify.calls.all(), function(call) {
                                return call.args[0] === 'getVAST';
                            });
                            expect(middlewareify).toBeDefined();
                        });

                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/public/vast/2.0/tag', expressUtils.cloudwatchMetrics.calls.mostRecent().returnValue, jasmine.any(Function), middlewareify.returnValue);
                        });

                        describe('the headers middleware', function() {
                            var setHeaders;

                            beforeEach(function() {
                                setHeaders = expressRoutes.get['/api/public/vast/2.0/tag'][0][expressRoutes.get['/api/public/vast/2.0/tag'][0].length - 2];
                                expect(setHeaders).toEqual(jasmine.any(Function));
                            });

                            describe('when invoked', function() {
                                var req, res, next;

                                beforeEach(function() {
                                    req = {
                                        headers: {},
                                        query: {},

                                        get: jasmine.createSpy('req.get()').and.callFake(function(header) {
                                            return this.headers[header.toLowerCase()];
                                        })
                                    };
                                    res = {
                                        headers: {},

                                        set: jasmine.createSpy('res.set()').and.callFake(function(header, value) {
                                            if (Object(header) === header) {
                                                Object.keys(header).forEach(function(key) {
                                                    this.set(key, header[key]);
                                                }, this);
                                            } else {
                                                this.headers[header.toLowerCase()] = value;
                                            }
                                        })
                                    };
                                    next = jasmine.createSpy('next()');
                                });

                                describe('if there is a card id in the query', function() {
                                    beforeEach(function() {
                                        req.query.card = 'rc-a5c299a6330c6d';

                                        setHeaders(req, res, next);
                                    });

                                    it('should set the cache-control to the card freshTTL', function() {
                                        expect(res.headers).toEqual(jasmine.objectContaining({
                                            'cache-control': 'max-age=' + player.config.api.card.cacheTTLs.fresh * 60
                                        }));
                                    });

                                    it('should set the Content-Type to "application/xml"', function() {
                                        expect(res.headers).toEqual(jasmine.objectContaining({
                                            'content-type': 'application/xml'
                                        }));
                                    });

                                    it('should call next()', function() {
                                        expect(next).toHaveBeenCalled();
                                    });
                                });

                                describe('if there is no card id in the query', function() {
                                    beforeEach(function() {
                                        setHeaders(req, res, next);
                                    });

                                    it('should not set the cache-control to the card freshTTL', function() {
                                        expect(res.headers['cache-control']).not.toBeDefined();
                                    });

                                    it('should set the Content-Type to "application/xml"', function() {
                                        expect(res.headers).toEqual(jasmine.objectContaining({
                                            'content-type': 'application/xml'
                                        }));
                                    });

                                    it('should call next()', function() {
                                        expect(next).toHaveBeenCalled();
                                    });
                                });

                                describe('if there is no Origin request header', function() {
                                    beforeEach(function() {
                                        setHeaders(req, res, next);
                                    });

                                    it('should not set CORS headers', function() {
                                        expect(res.headers).not.toEqual(jasmine.objectContaining({
                                            'access-control-allow-origin': jasmine.anything(),
                                            'access-control-allow-credentials': jasmine.anything()
                                        }));
                                    });

                                    it('should call next()', function() {
                                        expect(next).toHaveBeenCalled();
                                    });
                                });

                                describe('if there is an Origin request header', function() {
                                    beforeEach(function() {
                                        req.headers.origin = 'https://console.pocketmath.com';

                                        setHeaders(req, res, next);
                                    });

                                    it('should set CORS headers', function() {
                                        expect(res.headers).toEqual(jasmine.objectContaining({
                                            'access-control-allow-origin': req.headers.origin,
                                            'access-control-allow-credentials': 'true'
                                        }));
                                    });

                                    it('should call next()', function() {
                                        expect(next).toHaveBeenCalled();
                                    });
                                });
                            });
                        });
                    });

                    describe('route: GET /api/public/players/:type', function() {
                        var middlewareify;

                        beforeEach(function() {
                            middlewareify = _.find(player.middlewareify.calls.all(), function(call) {
                                return call.args[0] === 'get';
                            });
                            expect(middlewareify).toBeDefined();
                        });

                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/public/players/:type', expressUtils.parseQuery.calls.mostRecent().returnValue, expressUtils.cloudwatchMetrics.calls.mostRecent().returnValue, jasmine.any(Function), middlewareify.returnValue);
                        });

                        describe('when invoked', function() {
                            var state;
                            var middleware;
                            var request, response, next;
                            var headers;

                            beforeEach(function() {
                                state = service.daemonize.calls.mostRecent().args[0];

                                middleware = expressRoutes.get['/api/public/players/:type'][0][expressRoutes.get['/api/public/players/:type'][0].length - 2];
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
                                next = jasmine.createSpy('next()');

                                middleware(request, response, next);
                            });

                            it('should call next()', function() {
                                expect(next).toHaveBeenCalled();
                            });

                            it('should not redirect', function() {
                                expect(response.redirect).not.toHaveBeenCalled();
                            });

                            [
                                'lightbox-playlist',
                                'full',
                                'solo-ads',
                                'swipe'
                            ].forEach(function(type) {
                                describe('if the type is ' + type, function() {
                                    var config;

                                    beforeEach(function() {
                                        next.calls.reset();
                                        config = service.daemonize.calls.mostRecent().args[0].config;

                                        request.params.type = type;
                                        middleware(request, response, next);
                                    });

                                    it('should not call next()', function() {
                                        expect(next).not.toHaveBeenCalled();
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
                                    next.calls.reset();
                                    browser.isMobile = true;
                                    browser.isDesktop = false;
                                });

                                describe('and a mobileType is specified', function() {
                                    beforeEach(function() {
                                        request.query.mobileType = 'swipe';

                                        middleware(request, response, next);
                                    });

                                    it('should redirect the agent to the mobileType', function() {
                                        expect(response.redirect).toHaveBeenCalledWith(303, request.query.mobileType + formatURL({
                                            query: request.query
                                        }));
                                    });

                                    it('should not call next()', function() {
                                        expect(next).not.toHaveBeenCalled();
                                    });

                                    describe('and the type is already the mobileType', function() {
                                        beforeEach(function() {
                                            response.redirect.calls.reset();
                                            next.calls.reset();

                                            request.params.type = request.query.mobileType;

                                            middleware(request, response, next);
                                        });

                                        it('should not redirect the agent', function() {
                                            expect(response.redirect).not.toHaveBeenCalled();
                                        });

                                        it('should call next()', function() {
                                            expect(next).toHaveBeenCalled();
                                        });
                                    });
                                });

                                describe('and a mobileType is not specified', function() {
                                    beforeEach(function() {
                                        delete request.query.mobileType;

                                        middleware(request, response, next);
                                    });

                                    it('should redirect the agent to the default mobileType', function() {
                                        expect(response.redirect).toHaveBeenCalledWith(303, state.config.defaults.mobileType + formatURL({
                                            query: request.query
                                        }));
                                    });

                                    it('should not call next()', function() {
                                        expect(next).not.toHaveBeenCalled();
                                    });

                                    describe('and the type is already the default mobileType', function() {
                                        beforeEach(function() {
                                            response.redirect.calls.reset();
                                            next.calls.reset();

                                            request.params.type = state.config.defaults.mobileType;

                                            middleware(request, response, next);
                                        });

                                        it('should not redirect the agent', function() {
                                            expect(response.redirect).not.toHaveBeenCalled();
                                        });

                                        it('should call next()', function() {
                                            expect(next).toHaveBeenCalled();
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
                appVersion: '2.0.0',
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
                            'campaign', 'branding', 'preview'
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
                            'preview'
                        ],
                        cacheTTLs: {
                            fresh: 1,
                            max: 5
                        }
                    },
                    placement: {
                        endpoint: 'api/public/placements/',
                        validParams: [],
                        cacheTTLs: {
                            fresh: 1,
                            max: 5
                        }
                    }
                },
                tracking: {
                    pixel: '//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif'
                },
                vast: {
                    js: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.min.js',
                    swf: 'https://s3.amazonaws.com/c6.dev/ext/c6embed/v1/vpaid.swf'
                },
                app: {
                    version: 'v2.4.1',
                    staticURL: 'static/player/',
                    entry: '/opt/sixxy/install/mini-reel-player/current/public/main.html',
                    config: require.resolve('./helpers/build.json')
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

        it('should populate the version cache', function() {
            expect(player.getVersion).toHaveBeenCalledWith();
        });

        it('should create a never-expiring FunctionCache for the player', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: Infinity,
                maxTTL: Infinity,
                gcInterval: Infinity,
                extractor: jasmine.any(Function)
            });
        });

        describe('the function used to clone Documents in the player Cache', function() {
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

        it('should create a FunctionCache for the version', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: Infinity,
                maxTTL: Infinity,
                gcInterval: Infinity
            });
        });

        it('should create a FunctionCache for the placements', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: config.api.placement.cacheTTLs.fresh,
                maxTTL: config.api.placement.cacheTTLs.max,
                extractor: clonePromise
            });
        });

        it('should create a FunctionCache for the VAST', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: Infinity,
                maxTTL: Infinity,
                gcInterval: Infinity
            });
        });

        it('should create 6 FunctionCaches', function() {
            expect(MockFunctionCache.calls.count()).toBe(6);
        });

        describe('@public', function() {
            describe('properties:', function() {
                describe('config', function() {
                    it('should equal the provided config object plus the builder config', function() {
                        expect(player.config).toEqual(extend({
                            app: {
                                builder: require(config.app.config)
                            }
                        }, config));
                    });

                    describe('if there is no "config" path', function() {
                        beforeEach(function() {
                            delete config.app.config;

                            player = new Player(config);
                        });

                        it('should make the builder null', function() {
                            expect(player.config.app.builder).toBeNull();
                        });
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
                            cardCacheTTLs: config.api.card.cacheTTLs,
                            trackingPixel: config.tracking.pixel
                        });
                    });
                });
            });

            describe('methods:', function() {
                describe('middlewareify(method)', function() {
                    var method;
                    var result;

                    beforeEach(function() {
                        method = 'get';

                        result = player.middlewareify(method);
                    });

                    it('should return a Function', function() {
                        expect(result).toEqual(jasmine.any(Function));
                    });

                    describe('when the returned function is called', function() {
                        var middleware;
                        var headers, browser;
                        var req, res, next;
                        var methodDeferred;

                        beforeEach(function(done) {
                            middleware = result;

                            headers = {
                                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.99 Safari/537.36',
                                'origin': 'https://github.com/cinema6/cwrx/pull/504/files?foo=bar&bar=foo#bleh'
                            };
                            req = {
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
                            res = {
                                send: jasmine.createSpy('res.send()'),
                                redirect: jasmine.createSpy('res.redirect()')
                            };
                            next = jasmine.createSpy('next()');

                            browser = { isMobile: false, isDesktop: true };
                            MockBrowserInfo.and.returnValue(browser);

                            methodDeferred = q.defer();
                            spyOn(player, method).and.returnValue(methodDeferred.promise);

                            middleware(req, res, next);
                            q().finally(done);
                        });

                        it('should create a BrowserInfo()', function() {
                            expect(MockBrowserInfo).toHaveBeenCalledWith(req.get('user-agent'));
                        });

                        it('should [method]() the player, passing in the req.query + some params it creates', function() {
                            expect(player[method]).toHaveBeenCalledWith(extend(extend({
                                reqUuid: req.uuid,
                                origin: 'https://github.com/cinema6/cwrx/pull/504/files',
                                desktop: browser.isDesktop,
                                mobile: browser.isMobile,
                                secure: req.secure,
                                $params: req.query
                            }, req.query), req.params));
                        });

                        describe('and the method call succeeds', function() {
                            beforeEach(function(done) {
                                methodDeferred.fulfill(playerHTML);
                                methodDeferred.promise.finally(done);
                            });

                            it('should send() the response', function() {
                                expect(res.send).toHaveBeenCalledWith(200, playerHTML);
                            });
                        });

                        describe('and the method call fails', function() {
                            describe('with no reason', function() {
                                beforeEach(function(done) {
                                    methodDeferred.reject();
                                    methodDeferred.promise.finally(done);
                                });

                                it('should send a 500', function() {
                                    expect(res.send).toHaveBeenCalledWith(500, 'Internal error');
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });
                            });

                            describe('with a non-Error reason', function() {
                                beforeEach(function(done) {
                                    methodDeferred.reject('I failed!');
                                    methodDeferred.promise.finally(done);
                                });

                                it('should send a 500', function() {
                                    expect(res.send).toHaveBeenCalledWith(500, 'Internal error');
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });
                            });

                            describe('with an Error reason', function() {
                                var error;

                                beforeEach(function(done) {
                                    error = new Error('I have a problem...');

                                    methodDeferred.reject(error);
                                    methodDeferred.promise.finally(done);
                                });

                                it('should send a 500', function() {
                                    expect(res.send).toHaveBeenCalledWith(500, error.message);
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });
                            });

                            describe('with a ServiceError', function() {
                                var ServiceError;
                                var error;

                                beforeEach(function(done) {
                                    player.__getExperience__().catch(function(error) {
                                        ServiceError = error.constructor;
                                        expect(ServiceError.name).toBe('ServiceError');
                                    }).then(function() {
                                        error = new ServiceError('Could not find something.', 404);

                                        methodDeferred.reject(error);
                                        return methodDeferred.promise.catch(function() {});
                                    }).then(done, done.fail);
                                });

                                it('should use the status', function() {
                                    expect(res.send).toHaveBeenCalledWith(404, error.message);
                                });

                                it('should not log an error', function() {
                                    expect(log.error).not.toHaveBeenCalled();
                                });
                            });
                        });

                        describe('if the request has no origin', function() {
                            beforeEach(function() {
                                player[method].calls.reset();
                                player[method].and.returnValue(q(playerHTML));

                                delete headers.origin;
                            });

                            describe('but has a referer', function() {
                                beforeEach(function(done) {
                                    headers.referer = 'https://nodejs.org/api/modules.html#modules_module_filename';

                                    middleware(req, res, next);
                                    q().finally(done);
                                });

                                it('should set the referer as the origin', function() {
                                    expect(player[method]).toHaveBeenCalledWith(jasmine.objectContaining({ origin: 'https://nodejs.org/api/modules.html' }));
                                });
                            });

                            describe('and no referer', function() {
                                beforeEach(function(done) {
                                    delete headers.referer;

                                    middleware(req, res, next);
                                    q().finally(done);
                                });

                                it('should set the origin to undefined', function() {
                                    expect(player[method]).toHaveBeenCalledWith(jasmine.objectContaining({ origin: undefined }));
                                });
                            });
                        });
                    });
                });

                describe('getVersion()', function() {
                    var success, failure;
                    var $;
                    var result;

                    beforeEach(function(done) {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        $ = cheerio.load(playerHTML);

                        result = player.getVersion();
                        result.then(success, failure);

                        process.nextTick(done);
                    });

                    it('should be cached', function() {
                        expect(fnCaches[3].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.getVersion);
                        fnCaches[3].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__getBranding__) {
                                expect(call.args).toEqual([jasmine.any(Function)]);
                            }
                        });
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should fulfill with config.app.version', function() {
                        expect(success).toHaveBeenCalledWith(player.config.app.version);
                    });
                });

                describe('resetCodeCache()', function() {
                    beforeEach(function() {
                        spyOn(player.__getPlayer__, 'clear').and.callThrough();
                        spyOn(player.getVersion, 'clear').and.callThrough();

                        player.resetCodeCache();
                    });

                    it('should call clear() on the __getPlayer__() method', function() {
                        expect(player.__getPlayer__.clear).toHaveBeenCalled();
                    });

                    it('should call clear() on the getVersion() method', function() {
                        expect(player.getVersion.clear).toHaveBeenCalled();
                    });
                });

                describe('get(options)', function() {
                    var success, failure;
                    var options;
                    var document, experience, sponsoredCards, normalCards;
                    var loadExperienceDeferred, getPlayerDeferred, loadCardDeferred;

                    beforeEach(function(done) {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        options = {
                            type: 'lightbox',
                            reqUuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo',
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
                            clickUrls: ['click1.gif', 'click2.gif'],
                            desktop: true,
                            secure: true,
                            standalone: true,
                            embed: false,
                            countdown: false,
                            prebuffer: true,
                            debug: false
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

                        player.__getPlayer__.and.returnValue((getPlayerDeferred = q.defer()).promise);

                        player.get(options).then(success, failure);
                        q().then(done);
                    });

                    it('should not get the player', function() {
                        expect(player.__getPlayer__).not.toHaveBeenCalled();
                    });

                    it('should load the experience', function() {
                        expect(player.__loadExperience__).toHaveBeenCalledWith(options);
                    });

                    it('should not load a card', function() {
                        expect(player.__loadCard__).not.toHaveBeenCalled();
                    });

                    describe('when the experience is loaded', function() {
                        var loadAdsDeferred;
                        var brandings;

                        beforeEach(function(done) {
                            brandings = [
                                { type: 'css', src: 'theme.css', contents: 'body { padding: 10px; }' },
                                { type: 'js', src: 'theme.css.domino.js', contents: 'window.__dominoCSSRules__=[".foo"];' },
                                { type: 'css', src: 'theme--hover.css', contents: 'body { margin: 20px; }' },
                                { type: 'js', src: 'theme--hover.css.domino.js', contents: 'window.__dominoCSSRules__=[".bar"];' }
                            ];
                            player.__getBranding__.and.returnValue(q(brandings));

                            spyOn(document, 'addCSS').and.callThrough();
                            spyOn(document, 'addJS').and.callThrough();
                            spyOn(MockAdLoader, 'addTrackingPixels').and.callThrough();

                            loadExperienceDeferred.fulfill(experience);
                            process.nextTick(done);
                        });

                        it('should fetch the player', function() {
                            expect(player.__getPlayer__).toHaveBeenCalledWith(player.__getBuildProfile__(experience, options), true, options.reqUuid);
                        });

                        it('should loading brandings for the player', function() {
                            expect(player.__getBranding__).toHaveBeenCalledWith(experience.data.branding, options.type, options.desktop, options.reqUuid);
                        });

                        it('should add the custom tracking pixels to each sponsored card', function() {
                            sponsoredCards.forEach(function(card) {
                                expect(MockAdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                    playUrls: options.playUrls,
                                    countUrls: options.countUrls,
                                    clickUrls: options.clickUrls,
                                    launchUrls: options.launchUrls
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

                        describe('when the player is fetched', function() {
                            beforeEach(function(done) {
                                getPlayerDeferred.resolve(document);
                                process.nextTick(done);
                            });

                            it('should add the brandings as a resource', function() {
                                expect(document.addCSS).toHaveBeenCalledWith(brandings[0].src, brandings[0].contents);
                                expect(document.addJS).toHaveBeenCalledWith(brandings[1].src, brandings[1].contents);
                                expect(document.addCSS).toHaveBeenCalledWith(brandings[2].src, brandings[2].contents);
                                expect(document.addJS).toHaveBeenCalledWith(brandings[3].src, brandings[3].contents);

                                expect(document.addCSS.calls.count()).toBe(2);
                                expect(document.addJS.calls.count()).toBe(2);
                            });

                            it('should add the options as a resource', function() {
                                expect(document.addResource).toHaveBeenCalledWith('options', 'application/json', options);
                            });

                            it('should add the experience as a resource', function() {
                                expect(document.addResource).toHaveBeenCalledWith('experience', 'application/json', experience);
                            });

                            it('should resolve to the player as a string of HTML', function() {
                                expect(success).toHaveBeenCalledWith(document.toString());
                            });
                        });
                    });

                    describe('if the countdown param is undefined', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();

                            player.__getBranding__.and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));
                            player.__getPlayer__.and.returnValue(q(document));

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

                                player.__getBranding__.and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));
                                player.__getPlayer__.and.returnValue(q(document));

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
                                    document.addResource.calls.reset();

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
                                    expect(player.__getPlayer__).toHaveBeenCalledWith(player.__getBuildProfile__(null, options), false, options.reqUuid);
                                });

                                it('should add the options as a resource', function() {
                                    expect(document.addResource).toHaveBeenCalledWith('options', 'application/json', options);
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
                                        spyOn(document, 'addJS').and.callThrough();

                                        brandings = [
                                            { type: 'css', src: 'theme.css', contents: 'body { padding: 10px; }' },
                                            { type: 'js', src: 'theme.css.domino.js', contents: 'console.log("Some JS")' },
                                            { type: 'css', src: 'theme--hover.css', contents: 'body { margin: 20px; }' },
                                            { type: 'js', src: 'theme--hover.css.domino.js', contents: 'console.log("Some CSS")' }
                                        ];
                                        player.__getBranding__.and.returnValue(q(brandings));

                                        options.branding = 'rcplatform';

                                        player.get(options).then(success, failure).finally(done);
                                    });

                                    it('should not call __loadExperience__() or __loadCard__()', function() {
                                        [player.__loadExperience__, player.__loadCard__].forEach(function(spy) {
                                            expect(spy).not.toHaveBeenCalled();
                                        });
                                    });

                                    it('should call __getPlayer__()', function() {
                                        expect(player.__getPlayer__).toHaveBeenCalledWith(player.__getBuildProfile__(null, options), false, options.reqUuid);
                                    });

                                    it('should loading brandings for the player', function() {
                                        expect(player.__getBranding__).toHaveBeenCalledWith(options.branding, options.type, options.desktop, options.reqUuid);
                                    });

                                    it('should add the brandings as a resource', function() {
                                        expect(document.addCSS).toHaveBeenCalledWith(brandings[0].src, brandings[0].contents);
                                        expect(document.addJS).toHaveBeenCalledWith(brandings[1].src, brandings[1].contents);
                                        expect(document.addCSS).toHaveBeenCalledWith(brandings[2].src, brandings[2].contents);
                                        expect(document.addJS).toHaveBeenCalledWith(brandings[3].src, brandings[3].contents);

                                        expect(document.addCSS.calls.count()).toBe(2);
                                        expect(document.addJS.calls.count()).toBe(2);
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

                            it('should not get the player', function() {
                                expect(player.__getPlayer__).not.toHaveBeenCalled();
                            });

                            it('should not load the experience', function() {
                                expect(player.__loadExperience__).not.toHaveBeenCalled();
                            });

                            it('should load the card', function() {
                                expect(player.__loadCard__).toHaveBeenCalledWith(options);
                            });

                            describe('when the card is loaded', function() {
                                var loadAdsDeferred;
                                var brandings;

                                beforeEach(function(done) {
                                    brandings = [
                                        { type: 'css', src: 'theme.css', contents: 'body { padding: 10px; }' },
                                        { type: 'js', src: 'theme.css.domino.js', contents: 'console.log("Some JS")' },
                                        { type: 'css', src: 'theme--hover.css', contents: 'body { margin: 20px; }' },
                                        { type: 'js', src: 'theme--hover.css.domino.js', contents: 'console.log("Some CSS")' }
                                    ];
                                    player.__getBranding__.and.returnValue(q(brandings));

                                    spyOn(document, 'addCSS').and.callThrough();
                                    spyOn(document, 'addJS').and.callThrough();
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

                                it('should load the player', function() {
                                    expect(player.__getPlayer__).toHaveBeenCalledWith(player.__getBuildProfile__(experience, options), true, options.reqUuid);
                                });

                                it('should loading brandings for the player', function() {
                                    expect(player.__getBranding__).toHaveBeenCalledWith(experience.data.branding, options.type, options.desktop, options.reqUuid);
                                });

                                it('should add the custom tracking pixels to each sponsored card', function() {
                                    expect(MockAdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                        playUrls: options.playUrls,
                                        countUrls: options.countUrls,
                                        clickUrls: options.clickUrls,
                                        launchUrls: options.launchUrls
                                    }, experience.data.deck[0]);
                                });

                                it('should set the skip value on the card', function() {
                                    expect(experience.data.deck[0].data.skip).toBe(options.countdown);
                                });

                                it('should set the prebuffer value on the card', function() {
                                    expect(experience.data.deck[0].data.prebuffer).toBe(options.prebuffer);
                                });

                                describe('when the player is fetched', function() {
                                    beforeEach(function(done) {
                                        getPlayerDeferred.resolve(document);
                                        process.nextTick(done);
                                    });

                                    it('should add the brandings as a resource', function() {
                                        expect(document.addCSS).toHaveBeenCalledWith(brandings[0].src, brandings[0].contents);
                                        expect(document.addJS).toHaveBeenCalledWith(brandings[1].src, brandings[1].contents);
                                        expect(document.addCSS).toHaveBeenCalledWith(brandings[2].src, brandings[2].contents);
                                        expect(document.addJS).toHaveBeenCalledWith(brandings[3].src, brandings[3].contents);

                                        expect(document.addCSS.calls.count()).toBe(2);
                                        expect(document.addJS.calls.count()).toBe(2);
                                    });

                                    it('should add the options as a resource', function() {
                                        expect(document.addResource).toHaveBeenCalledWith('options', 'application/json', options);
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
                    });

                    describe('if called without an origin', function() {
                        beforeEach(function(done) {
                            player.__getBranding__.and.returnValue(q([]));
                            player.__loadExperience__.calls.reset();
                            loadExperienceDeferred.fulfill(experience);
                            getPlayerDeferred.resolve(document);
                            options.origin = undefined;

                            player.get(options).finally(done);
                        });

                        it('should use the default origin', function() {
                            expect(player.__loadExperience__).toHaveBeenCalledWith(options);
                        });
                    });

                    describe('if the experience has no cards', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();
                            player.__getBranding__.and.returnValue(q([]));
                            player.__getPlayer__.and.returnValue(q(document));
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

                    describe('if called with vpaid: true', function() {
                        beforeEach(function() {
                            options.vpaid = true;
                        });

                        describe('if the experience has only one card', function() {
                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();
                                experience.data.deck.length = 1;
                                player.__getBranding__.and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));
                                player.__getPlayer__.and.returnValue(q(document));

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
                                player.__getBranding__.and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));
                                player.__getPlayer__.and.returnValue(q(document));

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
                                player.__getBranding__.and.returnValue(q([]));
                                player.__loadExperience__.and.returnValue(q(experience));
                                player.__getPlayer__.and.returnValue(q(document));

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
                            player.__getBranding__.and.returnValue(q([]));
                            player.__loadExperience__.and.returnValue(q(experience));
                            player.__getPlayer__.and.returnValue(q(document));
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

                        it('should add the options as a resource', function() {
                            expect(document.addResource).toHaveBeenCalledWith('options', 'application/json', options);
                        });

                        it('should fulfill with a String of HTML', function() {
                            expect(success).toHaveBeenCalledWith(document.toString());
                        });
                    });
                });

                describe('getViaPlacement(options)', function() {
                    var options;
                    var success, failure;
                    var result;
                    var getPlacementDeferred;

                    beforeEach(function(done) {
                        options = {
                            placement: 'pl-cc39777e109ea2',
                            reqUuid: 'efh7384ry43785t',
                            branding: 'cinema6',
                            origin: 'http://cinema6.com/solo',
                            preview: false,
                            playUrls: ['play1.gif', 'play2.gif'],
                            countUrls: ['count1.gif', 'count2.gif'],
                            launchUrls: ['launch1.gif', 'launch2.gif'],
                            clickUrls: ['click1.gif', 'click2.gif'],
                            desktop: true,
                            mobile: false,
                            secure: true,
                            debug: 2
                        };

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        getPlacementDeferred = q.defer();
                        player.__getPlacement__.and.returnValue(getPlacementDeferred.promise);

                        result = player.getViaPlacement(_.cloneDeep(options));
                        result.then(success, failure);
                        q().finally(done);
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should get the placement', function() {
                        expect(player.__getPlacement__).toHaveBeenCalledWith(options.placement, {}, options.reqUuid);
                    });

                    describe('when the placement is fetched', function() {
                        var placement;

                        beforeEach(function(done) {
                            placement = {
                                id: options.placement,
                                tagParams: {
                                    type: 'desktop-card',
                                    container: 'beeswax',
                                    campaign: 'cam-7d39e9bb3d4342',
                                    debug: true,
                                    prebuffer: true
                                }
                            };

                            spyOn(player, 'get').and.returnValue(q(playerHTML));

                            getPlacementDeferred.resolve(_.cloneDeep(placement));
                            result.finally(done);
                        });

                        it('should get() the player by extending the placement params with its own', function() {
                            expect(player.get).toHaveBeenCalledWith(_.defaults(_.assign(_.cloneDeep(placement.tagParams), options), player.config.defaults));
                        });

                        it('should fulfill with the result of calling player.get()', function() {
                            expect(success).toHaveBeenCalledWith(playerHTML);
                        });

                        describe('if the device is mobile', function() {
                            beforeEach(function(done) {
                                player.get.calls.reset();
                                player.__getPlacement__.calls.reset();
                                success.calls.reset();
                                failure.calls.reset();

                                options.mobile = true;
                                options.desktop = false;

                                player.getViaPlacement(options).then(success, failure).finally(done);
                            });

                            it('should set the type to the default mobileType', function() {
                                expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({ type: player.config.defaults.mobileType }));
                            });

                            describe('and there is a mobileType', function() {
                                beforeEach(function() {
                                    player.get.calls.reset();
                                    player.__getPlacement__.calls.reset();
                                    success.calls.reset();
                                    failure.calls.reset();
                                });

                                describe('in the request', function() {
                                    beforeEach(function(done) {
                                        options.mobileType = 'swipe';

                                        player.getViaPlacement(options).then(success, failure).finally(done);
                                    });

                                    it('should set the type to that mobileType', function() {
                                        expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({ type: options.mobileType }));
                                    });
                                });

                                describe('in the placement', function() {
                                    beforeEach(function(done) {
                                        placement.tagParams.mobileType = 'swipe';
                                        player.__getPlacement__.and.returnValue(q(_.cloneDeep(placement)));

                                        player.getViaPlacement(options).then(success, failure).finally(done);
                                    });

                                    it('should set the type to that mobileType', function() {
                                        expect(player.get).toHaveBeenCalledWith(jasmine.objectContaining({ type: placement.tagParams.mobileType }));
                                    });
                                });
                            });
                        });
                    });

                    describe('if a placement is not specified', function() {
                        beforeEach(function(done) {
                            success.calls.reset();
                            failure.calls.reset();

                            delete options.placement;

                            player.getViaPlacement(_.cloneDeep(options)).then(success, failure).finally(done);
                        });

                        it('should reject the promise', function() {
                            var error = failure.calls.mostRecent().args[0];

                            expect(error).toEqual(jasmine.any(Error));
                            expect(error.message).toBe('You must provide a placement.');
                            expect(error.status).toBe(400);
                            expect(error.constructor.name).toBe('ServiceError');
                        });
                    });
                });

                describe('getVAST(options)', function() {
                    var options;
                    var originalOptions;
                    var success, failure;
                    var getPlacementDeferred;
                    var result;

                    beforeEach(function() {
                        var params = {
                            placement: 'pl-2bc7b4091ffb10',
                            countUrls: 'http://www.tracking.com/1.gif,http://www.tracking.com/2.gif',
                            debug: 2
                        };

                        options = extend({
                            $params: params,
                            reqUuid: '283dj9',
                            origin: 'http://www.my-site.com/foo'
                        }, params);
                        originalOptions = JSON.parse(JSON.stringify(options));

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        player.__getPlacement__.and.returnValue((getPlacementDeferred = q.defer()).promise);

                        result = player.getVAST(options);
                        result.then(success, failure);
                    });

                    it('should get the placement', function() {
                        expect(player.__getPlacement__).toHaveBeenCalledWith(options.placement, {}, options.origin, options.reqUuid);
                    });

                    describe('when the placement is fetched', function() {
                        var placement;
                        var findCardDeferred, getCardDeferred;
                        var fullOptions;

                        beforeEach(function() {
                            placement = {
                                id: 'pl-2bc7b4091ffb10',
                                tagParams: {
                                    type: 'desktop-card',
                                    container: 'beeswax',
                                    debug: true,
                                    prebuffer: true,
                                    preview: false
                                }
                            };

                            spyOn(player.adLoader, 'findCard').and.returnValue((findCardDeferred = q.defer()).promise);
                            spyOn(player.adLoader, 'getCard').and.returnValue((getCardDeferred = q.defer()).promise);
                        });

                        describe('with a campaign', function() {
                            beforeEach(function(done) {
                                placement.tagParams.campaign = 'cam-1819dc636a0929';

                                fullOptions = _.assign({}, options, {
                                    $params: _.assign({}, placement.tagParams, options.$params)
                                });

                                getPlacementDeferred.fulfill(placement);
                                getPlacementDeferred.promise.finally(done);
                            });

                            it('should not get a card', function() {
                                expect(player.adLoader.getCard).not.toHaveBeenCalled();
                            });

                            it('should find a card with that campaign', function() {
                                expect(player.adLoader.findCard).toHaveBeenCalledWith(
                                    placement.tagParams.campaign,
                                    player.__apiParams__('card', fullOptions.$params),
                                    fullOptions,
                                    options.reqUuid
                                );
                            });

                            describe('if no card is found', function() {
                                var error;

                                beforeEach(function(done) {
                                    findCardDeferred.fulfill(null);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe('No card was found for campaign {' + placement.tagParams.campaign + '}.');
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if the call fails', function() {
                                var reason;
                                var error;

                                beforeEach(function(done) {
                                    reason = new Error('404 - Campaign not found.');
                                    reason.name = 'StatusCodeError';
                                    reason.statusCode = 404;

                                    findCardDeferred.reject(reason);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if a card is found', function() {
                                var card;
                                var expected;

                                beforeEach(function(done) {
                                    card = {
                                        id: 'rc-9c7601a608a42d',
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: placement.tagParams.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    player.__createVAST__.and.callThrough();

                                    findCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should create VAST for the card', function() {
                                    expect(player.__createVAST__).toHaveBeenCalledWith(
                                        card,
                                        _.assign({}, placement.tagParams, options.$params, { card: card.id }),
                                        options.origin,
                                        options.reqUuid
                                    );
                                });

                                it('should fulfill with VAST for the card', function() {
                                    expect(success).toHaveBeenCalledWith(player.__createVAST__.calls.mostRecent().returnValue);
                                });
                            });

                            describe('if creating the VAST fails', function() {
                                var card;
                                var reason;

                                beforeEach(function(done) {
                                    card = {
                                        id: 'rc-9c7601a608a42d',
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: 'cam-bba22919ac1d98',
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    reason = new Error('IT ALL WENT WRONG!');

                                    player.__createVAST__.and.throwError(reason);

                                    findCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should reject with the reason', function() {
                                    expect(failure).toHaveBeenCalledWith(reason);
                                    expect(failure.calls.mostRecent().args[0]).toBe(reason);
                                });
                            });
                        });

                        describe('with a card', function() {
                            beforeEach(function(done) {
                                placement.tagParams.campaign = 'cam-1819dc636a0929';
                                placement.tagParams.card = 'rc-ee624ab4f205cd';

                                fullOptions = _.assign({}, options, {
                                    $params: _.assign({}, placement.tagParams, options.$params)
                                });

                                getPlacementDeferred.fulfill(placement);
                                getPlacementDeferred.promise.finally(done);
                            });

                            it('should not find a card', function() {
                                expect(player.adLoader.findCard).not.toHaveBeenCalled();
                            });

                            it('should get the card', function() {
                                expect(player.adLoader.getCard).toHaveBeenCalledWith(
                                    placement.tagParams.card,
                                    player.__apiParams__('card', fullOptions.$params),
                                    fullOptions,
                                    options.reqUuid
                                );
                            });

                            describe('if the call fails', function() {
                                var reason;
                                var error;

                                beforeEach(function(done) {
                                    reason = new Error('404 - Card not found.');
                                    reason.name = 'StatusCodeError';
                                    reason.statusCode = 404;

                                    getCardDeferred.reject(reason);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if a card is found', function() {
                                var card;
                                var expected;

                                beforeEach(function(done) {
                                    card = {
                                        id: placement.tagParams.card,
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: placement.tagParams.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    player.__createVAST__.and.callThrough();

                                    getCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should create VAST for the card', function() {
                                    expect(player.__createVAST__).toHaveBeenCalledWith(
                                        card,
                                        _.assign({}, placement.tagParams, options.$params),
                                        options.origin,
                                        options.reqUuid
                                    );
                                });

                                it('should fulfill with VAST for the card', function() {
                                    expect(success).toHaveBeenCalledWith(player.__createVAST__.calls.mostRecent().returnValue);
                                });
                            });

                            describe('if creating the VAST fails', function() {
                                var card;
                                var reason;

                                beforeEach(function(done) {
                                    card = {
                                        id: placement.tagParams.card,
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: placement.tagParams.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    reason = new Error('IT ALL WENT WRONG!');

                                    player.__createVAST__.and.throwError(reason);

                                    getCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should reject with the reason', function() {
                                    expect(failure).toHaveBeenCalledWith(reason);
                                    expect(failure.calls.mostRecent().args[0]).toBe(reason);
                                });
                            });
                        });
                    });

                    describe('if there is no placement', function() {
                        var findCardDeferred, getCardDeferred;

                        beforeEach(function() {
                            player.__getPlacement__.calls.reset();
                            player.__getPlacement__.and.returnValue((getPlacementDeferred = q.defer()).promise);
                            success.calls.reset();
                            failure.calls.reset();

                            options.preview = true;
                            options.$params.preview = true;

                            spyOn(player.adLoader, 'findCard').and.returnValue((findCardDeferred = q.defer()).promise);
                            spyOn(player.adLoader, 'getCard').and.returnValue((getCardDeferred = q.defer()).promise);

                            delete options.placement;
                            delete options.$params.placement;
                        });

                        describe('but there is a campaign', function() {
                            beforeEach(function(done) {
                                options.campaign = 'cam-3127115904ffcd';
                                options.$params.campaign = options.campaign;

                                result = player.getVAST(options);
                                result.then(success, failure);
                                q({}).finally(done);
                            });

                            it('should not get a placement', function() {
                                expect(player.__getPlacement__).not.toHaveBeenCalled();
                            });

                            it('should not get a card', function() {
                                expect(player.adLoader.getCard).not.toHaveBeenCalled();
                            });

                            it('should find a card', function() {
                                expect(player.adLoader.findCard).toHaveBeenCalledWith(
                                    options.campaign,
                                    player.__apiParams__('card', options),
                                    options,
                                    options.reqUuid
                                );
                            });

                            describe('if no card is found', function() {
                                var error;

                                beforeEach(function(done) {
                                    findCardDeferred.fulfill(null);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe('No card was found for campaign {' + options.campaign + '}.');
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if the call fails', function() {
                                var reason;
                                var error;

                                beforeEach(function(done) {
                                    reason = new Error('404 - Campaign not found.');
                                    reason.name = 'StatusCodeError';
                                    reason.statusCode = 404;

                                    findCardDeferred.reject(reason);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if a card is found', function() {
                                var card;
                                var expected;

                                beforeEach(function(done) {
                                    card = {
                                        id: 'rc-9c7601a608a42d',
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: options.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    player.__createVAST__.and.callThrough();

                                    findCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should create VAST for the card', function() {
                                    expect(player.__createVAST__).toHaveBeenCalledWith(
                                        card,
                                        _.assign({}, options.$params, { card: card.id }),
                                        options.origin,
                                        options.reqUuid
                                    );
                                });

                                it('should fulfill with VAST for the card', function() {
                                    expect(success).toHaveBeenCalledWith(player.__createVAST__.calls.mostRecent().returnValue);
                                });
                            });

                            describe('if creating the VAST fails', function() {
                                var card;
                                var reason;

                                beforeEach(function(done) {
                                    card = {
                                        id: 'rc-9c7601a608a42d',
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: options.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    reason = new Error('IT ALL WENT WRONG!');

                                    player.__createVAST__.and.throwError(reason);

                                    findCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should reject with the reason', function() {
                                    expect(failure).toHaveBeenCalledWith(reason);
                                    expect(failure.calls.mostRecent().args[0]).toBe(reason);
                                });
                            });
                        });

                        describe('but there is a card', function() {
                            beforeEach(function(done) {
                                options.campaign = 'cam-50cf514f1d9212';
                                options.$params.campaign = options.campaign;
                                options.card = 'rc-f1c3193d76a44b';
                                options.$params.card = options.card;

                                result = player.getVAST(options);
                                result.then(success, failure);
                                q({}).finally(done);
                            });

                            it('should not find a card', function() {
                                expect(player.adLoader.findCard).not.toHaveBeenCalled();
                            });

                            it('should get the card', function() {
                                expect(player.adLoader.getCard).toHaveBeenCalledWith(
                                    options.card,
                                    player.__apiParams__('card', options),
                                    options,
                                    options.reqUuid
                                );
                            });

                            describe('if the call fails', function() {
                                var reason;
                                var error;

                                beforeEach(function(done) {
                                    reason = new Error('404 - Card not found.');
                                    reason.name = 'StatusCodeError';
                                    reason.statusCode = 404;

                                    getCardDeferred.reject(reason);
                                    result.catch(function(/*error*/) { error = arguments[0]; });
                                    result.finally(done);
                                });

                                it('should [404]', function() {
                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.constructor.name).toBe('ServiceError');
                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(404);
                                });
                            });

                            describe('if a card is found', function() {
                                var card;
                                var expected;

                                beforeEach(function(done) {
                                    card = {
                                        id: options.card,
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: options.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    player.__createVAST__.and.callThrough();

                                    getCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should create VAST for the card', function() {
                                    expect(player.__createVAST__).toHaveBeenCalledWith(
                                        card,
                                        options.$params,
                                        options.origin,
                                        options.reqUuid
                                    );
                                });

                                it('should fulfill with VAST for the card', function() {
                                    expect(success).toHaveBeenCalledWith(player.__createVAST__.calls.mostRecent().returnValue);
                                });
                            });

                            describe('if creating the VAST fails', function() {
                                var card;
                                var reason;

                                beforeEach(function(done) {
                                    card = {
                                        id: options.card,
                                        title: 'This is My Awesome Card!',
                                        note: 'Let me tell you a little something about this card.',
                                        campaignId: options.campaign,
                                        data: {
                                            duration: 176
                                        }
                                    };

                                    reason = new Error('IT ALL WENT WRONG!');

                                    player.__createVAST__.and.throwError(reason);

                                    getCardDeferred.fulfill(card);
                                    result.finally(done);
                                });

                                it('should reject with the reason', function() {
                                    expect(failure).toHaveBeenCalledWith(reason);
                                    expect(failure.calls.mostRecent().args[0]).toBe(reason);
                                });
                            });
                        });

                        describe('or campaign or card', function() {
                            var error;

                            beforeEach(function(done) {
                                success.calls.reset();
                                failure.calls.reset();

                                result = player.getVAST(options);
                                result.then(success, failure);
                                result.catch(function(/*error*/) { error = arguments[0]; });
                                result.finally(done);
                            });

                            it('should [400]', function() {
                                expect(error).toEqual(jasmine.any(Error));
                                expect(error.constructor.name).toBe('ServiceError');
                                expect(error.message).toBe('You must specify a placement, card or campaign.');
                                expect(error.status).toBe(400);
                            });
                        });
                    });
                });
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
                describe('__getBuildProfile__(experience, options)', function() {
                    var experience, options;

                    beforeEach(function() {
                        experience = {
                            id: 'e-00000000000000',
                            data: {
                                deck: []
                            }
                        };

                        options = {
                            context: 'mraid',
                            type: 'desktop-card',
                            secure: true,
                            debug: false
                        };
                    });

                    describe('if called with no experience', function() {
                        var result;

                        beforeEach(function() {
                            result = player.__getBuildProfile__(undefined, options);
                        });

                        it('should not include any experience data', function() {
                            expect(result).toEqual({
                                type: options.type,
                                context: options.context,

                                debug: false,
                                secure: options.secure,

                                isMiniReel: null,
                                card: {
                                    types: null,
                                    modules: null
                                }
                            });
                        });
                    });

                    describe('.isMiniReel', function() {
                        describe('if the experience has one card', function() {
                            beforeEach(function() {
                                experience.data.deck = [
                                    {
                                        id: 'rc-148031b2bc3c61',
                                        type: 'youtube',
                                        modules: [],
                                        data: {
                                            videoid: 'hfu3i4hf'
                                        }
                                    }
                                ];
                            });

                            it('should be false', function() {
                                expect(player.__getBuildProfile__(experience, options).isMiniReel).toBe(false);
                            });
                        });

                        describe('if the experience has more than one card', function() {
                            beforeEach(function() {
                                experience.data.deck = [
                                    {
                                        id: 'rc-148031b2bc3c61',
                                        type: 'youtube',
                                        modules: [],
                                        data: {
                                            videoid: 'hfu3i4hf'
                                        }
                                    },
                                    {
                                        id: 'rc-7454d33ced199d',
                                        type: 'adUnit',
                                        modules: [],
                                        data: {
                                            videoid: 'jfsdoifheiuw'
                                        }
                                    }
                                ];
                            });

                            it('should be true', function() {
                                expect(player.__getBuildProfile__(experience, options).isMiniReel).toBe(true);
                            });
                        });
                    });

                    describe('.type', function() {
                        it('should be the type from the options', function() {
                            expect(player.__getBuildProfile__(experience, options).type).toBe(options.type);
                        });
                    });

                    describe('.context', function() {
                        it('should be the context from the options', function() {
                            expect(player.__getBuildProfile__(experience, options).context).toBe(options.context);
                        });
                    });

                    describe('.card', function() {
                        beforeEach(function() {
                            experience.data.deck = [
                                {
                                    id: 'rc-148031b2bc3c61',
                                    type: 'youtube',
                                    modules: ['post'],
                                    data: {
                                        videoid: 'hfu3i4hf'
                                    }
                                },
                                {
                                    id: 'rc-7454d33ced199d',
                                    type: 'adUnit',
                                    modules: [],
                                    data: {
                                        videoid: 'jfsdoifheiuw'
                                    }
                                },
                                {
                                    id: 'rc-6572dd1dbecce3',
                                    type: 'instagram',
                                    modules: ['ballot', 'displayAd'],
                                    data: {
                                        videoid: 'jfsdoifheiuw'
                                    }
                                },
                                {
                                    id: 'rc-148031b2bc3c61',
                                    type: 'youtube',
                                    modules: [],
                                    data: {
                                        videoid: 'hfu3i4hf'
                                    }
                                },
                                {
                                    id: 'rc-8ffd5508fea20c',
                                    type: 'image',
                                    modules: ['displayAd', 'comments'],
                                    data: {
                                        videoid: 'hfu3i4hf'
                                    }
                                },
                                {
                                    id: 'rc-25a030a6c76a5a',
                                    type: 'instagram',
                                    modules: [],
                                    data: {
                                        videoid: 'jfsdoifheiuw'
                                    }
                                },
                                {
                                    id: 'rc-abb7fc0d3c8f0d',
                                    type: 'recap',
                                    modules: ['post'],
                                    data: {
                                        videoid: 'hfu3i4hf'
                                    }
                                }
                            ];
                        });

                        describe('.types', function() {
                            it('should be a list of all the card types without duplicates', function() {
                                expect(player.__getBuildProfile__(experience, options).card.types).toEqual([
                                    'adUnit',
                                    'image',
                                    'instagram',
                                    'recap',
                                    'youtube'
                                ]);
                            });
                        });

                        describe('.modules', function() {
                            it('should be a list of all the modules without duplicates', function() {
                                expect(player.__getBuildProfile__(experience, options).card.modules).toEqual([
                                    'ballot',
                                    'comments',
                                    'displayAd',
                                    'post'
                                ]);
                            });
                        });
                    });

                    describe('.debug', function() {
                        [undefined, null, false, 0, true, 1, 2].forEach(function(debug) {
                            describe('if options.debug is ' + debug, function() {
                                beforeEach(function() {
                                    options.debug = debug;
                                });

                                it('should be false', function() {
                                    expect(player.__getBuildProfile__(experience, options).debug).toBe(false);
                                });
                            });
                        });

                        [3, 4, 5, 6, 7, 8, 9].forEach(function(debug) {
                            describe('if options.debug is ' + debug, function() {
                                beforeEach(function() {
                                    options.debug = debug;
                                });

                                it('should be true', function() {
                                    expect(player.__getBuildProfile__(experience, options).debug).toBe(true);
                                });
                            });
                        });
                    });

                    describe('secure', function() {
                        it('should be options.secure', function() {
                            expect(player.__getBuildProfile__(experience, options).secure).toBe(options.secure);
                        });
                    });
                });

                describe('__apiParams__(type, params)', function() {
                    var type, params;
                    var result;

                    beforeEach(function() {
                        type = 'experience';
                        params = {
                            type: 'lightbox',
                            reqUuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo',
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

                describe('__loadCard__(params)', function() {
                    var params;
                    var getExperienceDeferred;
                    var success, failure;

                    beforeEach(function() {
                        params = {
                            type: 'lightbox',
                            reqUuid: 'efh7384ry43785t',
                            experience: 'e-92160a770b81d5',
                            branding: 'cinema6',
                            network: 'mopub',
                            origin: 'http://cinema6.com/solo',
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

                        getExperienceDeferred = q.defer();
                        player.__getExperience__.and.returnValue(getExperienceDeferred.promise);

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');
                    });

                    describe('with a card id and campaign', function() {
                        var experience;
                        var getCardDeferred;
                        var result;

                        beforeEach(function(done) {
                            getCardDeferred = q.defer();

                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(player.adLoader, 'getCard').and.returnValue(getCardDeferred.promise);
                            spyOn(player.adLoader, 'findCard').and.returnValue(q.defer().promise);
                            player.__getExperience__.calls.reset();

                            params.card = 'rc-4a51653fcd65ac';
                            params.campaign = 'cam-dd8f7c06153451';

                            experience = {
                                id: config.api.experience.default,
                                data: {
                                    wildCardPlacement: '475839475',
                                    title: null,
                                    deck: []
                                }
                            };
                            player.__getExperience__.and.returnValue(q(experience));

                            result = player.__loadCard__(params).then(success, failure);
                            setTimeout(done, 1);
                        });

                        it('should fetch the default experience', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(config.api.experience.default, player.__apiParams__('experience', params), params.origin, params.reqUuid);
                        });

                        it('should get the card', function() {
                            expect(player.adLoader.getCard).toHaveBeenCalledWith(params.card, player.__apiParams__('card', params), extend({ experience: experience.id }, params), params.reqUuid);
                        });

                        describe('if the card\'s campaign', function() {
                            var card;

                            beforeEach(function() {
                                card = {
                                    id: params.card,
                                    type: 'youtube',
                                    data: {}
                                };
                            });

                            describe('matches the specified campaign', function() {
                                beforeEach(function(done) {
                                    card.campaignId = params.campaign;
                                    getCardDeferred.resolve(card);

                                    result.finally(done);
                                });

                                it('should fulfill with the experience', function() {
                                    expect(success).toHaveBeenCalledWith(experience);
                                });
                            });

                            describe('does not match the specified campaign', function() {
                                beforeEach(function(done) {
                                    card.campaignId = 'cam-158d438def884c';
                                    getCardDeferred.resolve(card);

                                    result.finally(done);
                                });

                                it('should reject the promise', function() {
                                    var error = failure.calls.mostRecent().args[0];

                                    expect(failure).toHaveBeenCalledWith(jasmine.any(Error));
                                    expect(error.message).toBe('Card\'s campaign {' + card.campaignId + '} does not match specified campaign {' + params.campaign + '}.');
                                    expect(error.status).toBe(400);
                                });
                            });
                        });
                    });

                    describe('with a campaign id', function() {
                        beforeEach(function() {
                            params.campaign = 'cam-dd8f7c06153451';

                            player.__loadCard__(params).then(success, failure);
                        });

                        it('should fetch the default experience', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(config.api.experience.default, player.__apiParams__('experience', params), params.origin, params.reqUuid);
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
                                expect(player.adLoader.findCard).toHaveBeenCalledWith(params.campaign, player.__apiParams__('card', params), extend({ experience: experience.id }, params), params.reqUuid);
                            });

                            describe('and the card is fetched', function() {
                                var card;

                                beforeEach(function(done) {
                                    jasmine.clock().tick(250);

                                    card = {
                                        id: params.card,
                                        title: 'My Awesome Card!',
                                        data: {},
                                        campaign: {},
                                        campaignId: params.campaign
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

                    describe('with a card ID', function() {
                        beforeEach(function() {
                            params.card = 'rc-4a51653fcd65ac';

                            player.__loadCard__(params).then(success, failure);
                        });

                        it('should fetch the default experience', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(config.api.experience.default, player.__apiParams__('experience', params), params.origin, params.reqUuid);
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
                                expect(player.adLoader.getCard).toHaveBeenCalledWith(params.card, player.__apiParams__('card', params), extend({ experience: experience.id }, params), params.reqUuid);
                            });

                            describe('and the card is fetched', function() {
                                var card;

                                beforeEach(function(done) {
                                    jasmine.clock().tick(37);

                                    card = {
                                        id: params.card,
                                        title: 'My Awesome Card!',
                                        data: {},
                                        campaign: {},
                                        campaignId: 'cam-3855f65a9b64d0'
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
                    var params;
                    var experience;
                    var getExperienceDeferred;

                    var success, failure;

                    beforeEach(function() {
                        params = {
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom',
                            network: 'mopub',
                            experience: 'e-e2614b1f75c418',
                            mobileMode: 'swipe',
                            preview: false,
                            categories: ['foo', 'bar'],
                            origin: 'jsfiddle.net',
                            reqUuid: 'w9hf493rh8439r'
                        };

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
                        player.__getExperience__.and.returnValue(getExperienceDeferred.promise);

                        player.__loadExperience__(params).then(success, failure);
                    });

                    it('should get the experience', function() {
                        expect(player.__getExperience__).toHaveBeenCalledWith(params.experience, player.__apiParams__('experience', params), params.origin, params.reqUuid);
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
                            expect(player.adLoader.loadAds).toHaveBeenCalledWith(experience, params.campaign, params, params.reqUuid);
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

                            player.__loadExperience__(params).then(success, failure).finally(done);
                        });

                        it('should call the uncached version of __getExperience__()', function() {
                            expect(Player.prototype.__getExperience__).toHaveBeenCalledWith(params.experience, player.__apiParams__('experience', params), params.origin, params.reqUuid);
                            expect(Player.prototype.__getExperience__.calls.mostRecent().object).toBe(player);
                            expect(player.__getExperience__).not.toHaveBeenCalled();
                        });

                        it('should load ads for the experience', function() {
                            expect(player.adLoader.loadAds).toHaveBeenCalledWith(experience, params.campaign, params, params.reqUuid);
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

                            player.__loadExperience__(params).then(success, failure).finally(done);
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

                        request.get.calls.reset();

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
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css.domino.js'));

                            expect(request.get.calls.count()).toBe(4);
                        });

                        describe('when the requests fulfill', function() {
                            var themeCSS, coreCSS;
                            var themeJS, coreJS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                coreCSS = 'body { background: red; }';
                                themeJS = '(function(rules){rules.push({"rules":{"order":[],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';
                                coreJS = '(function(rules){rules.push({"rules":{"order":[{"selector":".foo","value":".bar"}],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js')].resolve(themeJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].resolve(coreCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css.domino.js')].resolve(coreJS);

                                result.finally(done);
                            });

                            it('should fulfill with an Array of css', function() {
                                expect(success).toHaveBeenCalledWith([jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object)]);
                                expect(success).toHaveBeenCalledWith(jasmine.arrayContaining([
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), contents: themeCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'), contents: themeJS },
                                    { type: 'css', src: resolveURL(base, branding + '/styles/core.css'), contents: coreCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/core.css.domino.js'), contents: coreJS },
                                ]));
                            });
                        });

                        describe('if a request rejects', function() {
                            var themeCSS;
                            var themeJS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                themeJS = '(function(rules){rules.push({"rules":{"order":[],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js')].resolve(themeJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css.domino.js')].reject({ statusCode: 404, message: 'NOT FOUND!' });

                                result.finally(done);
                            });

                            it('should fulfill with an Array of the css that was fetched', function() {
                                expect(success).toHaveBeenCalledWith([
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), contents: themeCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'), contents: themeJS }
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
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core.css.domino.js'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/' + type + '/theme--hover.css.domino.js'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core--hover.css'));
                            expect(request.get).toHaveBeenCalledWith(resolveURL(base, branding + '/styles/core--hover.css.domino.js'));
                            expect(request.get.calls.count()).toBe(8);
                        });

                        describe('when the requests fulfill', function() {
                            var themeCSS, coreCSS, themeHoverCSS, coreHoverCSS;
                            var themeJS, coreJS, themeHoverJS, coreHoverJS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                coreCSS = 'body { background: red; }';
                                themeHoverCSS = 'body { background: blue; }';
                                coreHoverCSS = 'body { background: green; }';
                                themeJS = '(function(rules){rules.push({"rules":{"order":[],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';
                                coreJS = '(function(rules){rules.push({"rules":{"order":[{"selector":".foo","value":".bar"}],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';
                                themeHoverJS = '(function(rules){rules.push({"rules":{"order":[{"selector":".bar","value":"#foo"}],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';
                                coreHoverJS = '(function(rules){rules.push({"rules":{"order":[{"selector":".foo","value":"body"}],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js')].resolve(themeJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].resolve(coreCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css.domino.js')].resolve(coreJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css')].resolve(themeHoverCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css.domino.js')].resolve(themeHoverJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css')].resolve(coreHoverCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css.domino.js')].resolve(coreHoverJS);

                                result.finally(done);
                            });

                            it('should fulfill with an Array of css', function() {
                                expect(success).toHaveBeenCalledWith([jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object), jasmine.any(Object)]);
                                expect(success).toHaveBeenCalledWith(jasmine.arrayContaining([
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), contents: themeCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'), contents: themeJS },
                                    { type: 'css', src: resolveURL(base, branding + '/styles/core.css'), contents: coreCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/core.css.domino.js'), contents: coreJS },
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'), contents: themeHoverCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css.domino.js'), contents: themeHoverJS },
                                    { type: 'css', src: resolveURL(base, branding + '/styles/core--hover.css'), contents: coreHoverCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/core--hover.css.domino.js'), contents: coreHoverJS }
                                ]));
                            });
                        });

                        describe('if a request rejects', function() {
                            var themeCSS, themeHoverCSS;
                            var themeJS, themeHoverJS;

                            beforeEach(function(done) {
                                themeCSS = 'body { background: black; }';
                                themeHoverCSS = 'body { background: blue; }';
                                themeJS = '(function(rules){rules.push({"rules":{"order":[],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';
                                themeHoverJS = '(function(rules){rules.push({"rules":{"order":[{"selector":".bar","value":"#foo"}],"container":[]},"mediaQueries":[]});}(window.__dominoCSSRules__||(window.__dominoCSSRules__=[])));';

                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css')].resolve(themeCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js')].resolve(themeJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });
                                requestDeferreds[resolveURL(base, branding + '/styles/core.css.domino.js')].reject({ statusCode: 404, message: 'NOT FOUND!' });
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css')].resolve(themeHoverCSS);
                                requestDeferreds[resolveURL(base, branding + '/styles/' + type + '/theme--hover.css.domino.js')].resolve(themeHoverJS);
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css')].reject({ statusCode: 404, message: 'NOT FOUND!' });
                                requestDeferreds[resolveURL(base, branding + '/styles/core--hover.css.domino.js')].reject({ statusCode: 404, message: 'NOT FOUND!' });

                                result.finally(done);
                            });

                            it('should fulfill with an Array of the css that was fetched', function() {
                                expect(success).toHaveBeenCalledWith([
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme.css'), contents: themeCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme.css.domino.js'), contents: themeJS },
                                    { type: 'css', src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css'), contents: themeHoverCSS },
                                    { type: 'js', src: resolveURL(base, branding + '/styles/' + type + '/theme--hover.css.domino.js'), contents: themeHoverJS }
                                ]);
                            });
                        });
                    });
                });

                describe('__getPlacement__(id, params, uuid)', function() {
                    var id, params, uuid;
                    var result;
                    var success, failure;

                    beforeEach(function(done) {
                        id = 'pl-cc39777e109ea2';
                        params = { foo: 'bar' };
                        uuid = 'u928yr4';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        result = player.__getPlacement__(id, params, uuid);
                        result.then(success, failure);
                        q().finally(done);
                    });

                    it('should cache the function', function() {
                        expect(fnCaches[4].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.__getPlacement__);
                        fnCaches[4].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__getPlacement__) {
                                expect(call.args).toEqual([jasmine.any(Function), -1]);
                            }
                        });
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should make a request for the placement', function() {
                        expect(request.get).toHaveBeenCalledWith('http://localhost/api/public/placements/pl-cc39777e109ea2', {
                            qs: params,
                            json: true
                        });
                    });

                    describe('if the request', function() {
                        var deferred;

                        beforeEach(function() {
                            deferred = requestDeferreds[request.get.calls.mostRecent().args[0]];
                        });

                        describe('fails', function() {
                            var reason;

                            describe('for some unknown reason', function() {
                                beforeEach(function(done) {
                                    reason = new Error('Something just went wrong...');

                                    deferred.reject(reason);
                                    result.finally(done);
                                });

                                it('should [500]', function() {
                                    var error = failure.calls.mostRecent().args[0];

                                    expect(error).toEqual(jasmine.any(Error));
                                    expect(error.message).toBe(reason.message);
                                    expect(error.status).toBe(500);
                                    expect(error.constructor.name).toBe('ServiceError');
                                });

                                it('should log an error', function() {
                                    expect(log.error).toHaveBeenCalled();
                                });
                            });

                            describe('because of a StatusCode', function() {
                                beforeEach(function() {
                                    reason = new Error('The page could not be loaded.');
                                    reason.name = 'StatusCodeError';
                                });

                                [400, 404, 409].forEach(function(statusCode) {
                                    describe('of ' + statusCode, function() {
                                        beforeEach(function(done) {
                                            reason.statusCode = statusCode;

                                            deferred.reject(reason);
                                            result.finally(done);
                                        });

                                        it('should adopt the status code of the placement response', function() {
                                            var error = failure.calls.mostRecent().args[0];

                                            expect(error).toEqual(jasmine.any(Error));
                                            expect(error.message).toBe(reason.message);
                                            expect(error.status).toBe(reason.statusCode);
                                            expect(error.constructor.name).toBe('ServiceError');
                                        });

                                        it('should not log an error', function() {
                                            expect(log.error).not.toHaveBeenCalled();
                                        });
                                    });
                                });

                                [500, 501, 503].forEach(function(statusCode) {
                                    describe('of ' + statusCode, function() {
                                        beforeEach(function(done) {
                                            reason.statusCode = statusCode;

                                            deferred.reject(reason);
                                            result.finally(done);
                                        });

                                        it('should adopt the status code of the placement response', function() {
                                            var error = failure.calls.mostRecent().args[0];

                                            expect(error).toEqual(jasmine.any(Error));
                                            expect(error.message).toBe(reason.message);
                                            expect(error.status).toBe(reason.statusCode);
                                            expect(error.constructor.name).toBe('ServiceError');
                                        });

                                        it('should log an error', function() {
                                            expect(log.error).toHaveBeenCalled();
                                        });
                                    });
                                });
                            });
                        });

                        describe('succeeds', function() {
                            var placement;

                            beforeEach(function(done) {
                                placement = {
                                    id: id,
                                    tagParams: {
                                        type: 'desktop-card',
                                        container: 'pocketmath',
                                        campaign: 'cam-6e3ca7443b7554'
                                    }
                                };

                                deferred.resolve(placement);
                                result.finally(done);
                            });

                            it('should fulfill with the placement', function() {
                                expect(success).toHaveBeenCalledWith(placement);
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
                            experience = {
                                id: 'e-92160a770b81d5',
                                data: {
                                    campaign: {
                                        launchUrls: ['some-pixel.gif']
                                    },
                                    deck: []
                                }
                            };

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

                describe('__getPlayer__(profile, conditional, uuid)', function() {
                    var success, failure;
                    var profile, conditional, uuid;
                    var result;

                    var entry, builder;

                    beforeEach(function() {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        profile = {
                            type: 'lightbox',
                            container: 'vpaid',

                            debug: false,
                            secure: false,

                            isMiniReel: false,
                            card: {
                                types: ['youtube'],
                                modules: ['post']
                            }
                        };
                        conditional = true;
                        uuid = 'ehfurihf43iu';

                        entry = new MockReadable(playerHTML);
                        spyOn(fs, 'createReadStream').and.returnValue(entry);

                        result = player.__getPlayer__(profile, conditional, uuid);
                        result.then(success, failure);

                        builder = MockAppBuilder.calls.mostRecent().returnValue;
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

                    it('should create a read stream for the entry', function() {
                        expect(fs.createReadStream).toHaveBeenCalledWith(config.app.entry);
                    });

                    it('should create an AppBuilder', function() {
                        var builder = _.assign(_.cloneDeep(player.config.app.builder), {
                            debug: profile.debug,
                            baseDir: require('path').dirname(config.app.entry),
                            baseURL: require('url').resolve(config.api.root, config.app.staticURL + config.app.version + '/')
                        });

                        expect(MockAppBuilder).toHaveBeenCalledWith(builder);
                    });

                    it('should use conditionalify', function() {
                        expect(builder.config.browserify.transforms[0]).toEqual([require.resolve('conditionalify'), {
                            ecmaVersion: 6,
                            context: profile
                        }]);
                        expect(builder.config.browserify.transforms.slice(1)).toEqual(player.config.app.builder.browserify.transforms);
                    });

                    it('should pass a stream to AppBuilder.prototype.build() that has the ${mode} macro replaced', function(done) {
                        expect(builder.build).toHaveBeenCalledWith(jasmine.any(Object));
                        streamToPromise(builder.build.calls.mostRecent().args[0]).then(function(data) {
                            expect(data.toString()).toBe(playerHTML.replace(/\${mode}/g, profile.type));
                        }).then(done, done.fail);
                    });

                    describe('if there is no error', function() {
                        beforeEach(function(done) {
                            result.finally(done);
                        });

                        it('should fulfill with an HTML document representing the built player', function() {
                            expect(success).toHaveBeenCalledWith(new HTMLDocument(builtPlayerHTML).addResource('build-profile', 'application/json', profile));
                        });
                    });

                    describe('if there is an error', function() {
                        var error;

                        beforeEach(function(done) {
                            error = new Error('I HAD A PROBLEM!');

                            builder.emit('error', error);
                            result.finally(done);
                        });

                        it('should reject with the error', function() {
                            expect(failure).toHaveBeenCalledWith(error);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });

                    describe('if secure is true', function() {
                        beforeEach(function(done) {
                            MockAppBuilder.calls.reset();
                            player.__getPlayer__.clear();
                            success.calls.reset();
                            failure.calls.reset();
                            profile.secure = true;

                            player.__getPlayer__(profile, conditional, uuid).then(success, failure).finally(done);
                        });

                        it('should make the baseURL secure', function() {
                            expect(MockAppBuilder).toHaveBeenCalledWith(jasmine.objectContaining({
                                baseURL: 'https://localhost/static/player/v2.4.1/'
                            }));
                        });
                    });

                    describe('if debug is true', function() {
                        beforeEach(function(done) {
                            MockAppBuilder.calls.reset();
                            player.__getPlayer__.clear();
                            success.calls.reset();
                            failure.calls.reset();
                            profile.debug = true;

                            player.__getPlayer__(profile, conditional, uuid).then(success, failure).finally(done);
                        });

                        it('should make debug true', function() {
                            expect(MockAppBuilder).toHaveBeenCalledWith(jasmine.objectContaining({
                                debug: true
                            }));
                        });
                    });

                    describe('if conditional is false', function() {
                        beforeEach(function(done) {
                            MockAppBuilder.calls.reset();
                            player.__getPlayer__.clear();
                            success.calls.reset();
                            failure.calls.reset();
                            conditional = false;

                            player.__getPlayer__(profile, conditional, uuid).then(success, failure).finally(done);
                            builder = MockAppBuilder.calls.mostRecent().returnValue;
                        });

                        it('should not add the conditionalify transform', function() {
                            expect(builder.config.browserify.transforms).toEqual(player.config.app.builder.browserify.transforms);
                        });
                    });

                    describe('if called with a valid player type', function() {
                        var builders;

                        beforeEach(function(done) {
                            MockAppBuilder.calls.reset();
                            player.__getPlayer__.clear();
                            config.validTypes.forEach(function(type) {
                                profile.type = type;

                                player.__getPlayer__(profile, conditional, uuid);
                            });
                            builders = MockAppBuilder.calls.all().map(function(call) {
                                return call.returnValue;
                            });
                            q().then(done);
                        });

                        it('should allow the build to happen', function() {
                            expect(builders.length).toBeGreaterThan(0);
                            builders.forEach(function(builder) {
                                expect(builder.build).toHaveBeenCalled();
                            });
                        });
                    });

                    describe('if passed an invalid type', function() {
                        var types;
                        var builders;

                        beforeEach(function(done) {
                            MockAppBuilder.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            types = ['foo', 'bar', 'fulls', 'lightboxy'];

                            types.forEach(function(type) {
                                profile.type = type;

                                player.__getPlayer__(profile, conditional, uuid).then(success, failure);
                            });
                            builders = MockAppBuilder.calls.all().map(function(call) {
                                return call.returnValue;
                            });
                            q().then(function() {}).then(done);
                        });

                        it('should not perform any builds', function() {
                            expect(builders.length).toBeGreaterThan(0);
                            builders.forEach(function(builder) {
                                expect(builder.build).not.toHaveBeenCalled();
                            });
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

                describe('__createVAST__(card, params, origin, uuid)', function() {
                    var card, params, origin, uuid;
                    var result;

                    beforeEach(function() {
                        card = {
                            id: 'rc-9c7601a608a42d',
                            title: 'This is My Awesome Card!',
                            note: 'Let me tell you a little something about this card.',
                            campaignId: 'cam-bba22919ac1d98',
                            data: {
                                duration: 176
                            }
                        };
                        params = {
                            card: card.id,
                            campaign: card.campaignId,
                            debug: 1,
                            container: 'adaptv'
                        };
                        origin = 'https://imasdk.googleapis.com';
                        uuid = 'fiu3hf489';

                        result = player.__createVAST__(card, params, origin, uuid);
                    });

                    it('should be cached', function() {
                        expect(fnCaches[5].add.calls.all().map(function(call) { return call.returnValue; })).toContain(player.__createVAST__);
                        fnCaches[5].add.calls.all().forEach(function(call) {
                            if (call.returnValue === player.__createVAST__) {
                                expect(call.args).toEqual([jasmine.any(Function), -1]);
                            }
                        });
                    });

                    it('should return some VAST representing the card', function() {
                        expect(result).toBe(new VAST({
                            version: '2.0',
                            ads: [
                                {
                                    id: card.id,
                                    type: 'inline',
                                    system: {
                                        name: 'Reelcontent Player Service',
                                        version: player.config.appVersion
                                    },
                                    title: card.title,
                                    description: card.note,
                                    impressions: [
                                        {
                                            uri: player.adLoader.pixelFactory(card, extend({ origin: origin }, params))('impression')
                                        }
                                    ],
                                    creatives: [
                                        {
                                            id: card.id,
                                            type: 'linear',
                                            duration: card.data.duration,
                                            parameters: require('querystring').stringify(extend({ apiRoot: player.config.api.root }, params)),
                                            mediaFiles: [
                                                {
                                                    id: card.id + '--swf',
                                                    delivery: 'progressive',
                                                    type: 'application/x-shockwave-flash',
                                                    uri: player.config.vast.swf + '?' + require('querystring').stringify(extend({ js: player.config.vast.js, apiRoot: player.config.api.root }, params)),
                                                    width: 640,
                                                    height: 480,
                                                    scalable: true,
                                                    maintainAspectRatio: true,
                                                    apiFramework: 'VPAID'
                                                },
                                                {
                                                    id: card.id + '--js',
                                                    delivery: 'progressive',
                                                    type: 'application/javascript',
                                                    uri: player.config.vast.js,
                                                    width: 640,
                                                    height: 480,
                                                    scalable: true,
                                                    maintainAspectRatio: true,
                                                    apiFramework: 'VPAID'
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        }).toXML());
                    });

                    describe('if the card\'s duration is unknown', function() {
                        var error;

                        beforeEach(function() {
                            card.data.duration = -1;

                            try {
                                result = player.__createVAST__(card, params, origin, uuid);
                            } catch(e) {
                                error = e;
                            }
                        });

                        it('should throw an error', function() {
                            expect(error).toEqual(jasmine.any(Error));
                            expect(error.constructor.name).toBe('ServiceError');
                            expect(error.message).toBe('The duration of card {' + card.id + '} is unknown.');
                            expect(error.status).toBe(409);
                        });
                    });
                });
            });
        });
    });
});
