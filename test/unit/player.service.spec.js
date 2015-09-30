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

    var requestDeferreds;
    var fnCaches;
    var MockFunctionCache;
    var playerHTML;
    var playerCSS;
    var playerJS;
    var log;

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

    describe('static:', function() {
        describe('@private', function() {
            describe('methods:', function() {
                describe('__rebaseCSS__(css, base)', function() {
                    var result;
                    var base;

                    beforeEach(function() {
                        base = 'https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css';
                        result = Player.__rebaseCSS__(playerCSS, base);
                    });

                    it('should replace URLs with no quotes', function() {
                        expect(result).toContain('.player__playIcon{height:45%;width:100%;background:url(https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/img/play-icon.svg) 56% 50%/contain no-repeat}');
                    });

                    it('should replace URLs with single quotes', function() {
                        expect(result).toContain('.recap__imgBox{width:8em;height:5em;background:url(https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/img/default_square.jpg) 50% 50%/cover no-repeat;float:left;margin:0 1em 0 3em}');
                    });

                    it('should replace URLs with double quotes', function() {
                        expect(result).toContain('.instag____profileDesc__logo{background:url(https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/img/social-card-sprites.png) -1em -1em/19em no-repeat;width:5em;height:1.5em;margin:1em 0 0;display:block}');
                    });
                });

                describe('__addResource__($document, src, type, contents)', function() {
                    var data;
                    var $orig;
                    var $document, src, type, contents;
                    var result;

                    beforeEach(function() {
                        data = { hello: 'world' };

                        $orig = cheerio.load(playerHTML);
                        $document = cheerio.load(playerHTML);
                        src = 'http://portal.cinema6.com/api/public/content/experience/e-92160a770b81d5';
                        type = 'application/json';
                    });

                    describe('if contents is a String', function() {
                        beforeEach(function() {
                            contents = JSON.stringify(data);

                            result = Player.__addResource__($document, src, type, contents);
                        });

                        it('should return the $document', function() {
                            expect(result).toBe($document);
                        });

                        it('should add a node to the $document', function() {
                            expect($document('*').length).toBe($orig('*').length + 1);
                        });

                        it('should create a <script> for the resource', function() {
                            var $script = $document('head > script[data-src="' + src + '"]');

                            expect($script.length).toBe(1);
                            expect($script.text()).toBe(contents);
                            expect($script.attr('type')).toBe(type);
                        });
                    });

                    describe('if contents is an Object', function() {
                        beforeEach(function() {
                            contents = data;

                            result = Player.__addResource__($document, src, type, contents);
                        });

                        it('should return the $document', function() {
                            expect(result).toBe($document);
                        });

                        it('should add a node to the $document', function() {
                            expect($document('*').length).toBe($orig('*').length + 1);
                        });

                        it('should create a <script> for the resource', function() {
                            var $script = $document('head > script[data-src="' + src + '"]');

                            expect($script.length).toBe(1);
                            expect($script.text()).toBe(JSON.stringify(contents));
                            expect($script.attr('type')).toBe(type);
                        });
                    });
                });
            });
        });

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

                        expressRoutes = {
                            get: {}
                        };
                        mockExpress = require.cache[require.resolve('express')].exports = jasmine.createSpy('express()').and.callFake(function() {
                            expressApp = express.apply(null, arguments);

                            spyOn(expressApp, 'listen');
                            spyOn(expressApp, 'use');
                            spyOn(expressApp, 'get').and.callFake(function(route, middleware) {
                                (expressRoutes.get[route] || (expressRoutes.get[route] = [])).push(middleware);
                            });

                            return expressApp;
                        });

                        browser = { isMobile: false };
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
                        delete require.cache[require.resolve('express')];
                        delete require.cache[require.resolve('../../lib/browserInfo')];
                    });

                    it('should start the service', function() {
                        expect(service.start).toHaveBeenCalledWith(jasmine.objectContaining({
                            defaultConfig: {
                                pidDir: require('path').resolve(__dirname, '../../pids'),
                                appName: 'player',
                                appDir: require('path').dirname(require.resolve('../../bin/player')),
                                envRoot: 'https://portal.cinema6.com/',
                                playerLocation: 'apps/mini-reel-player/index.html',
                                contentLocation: 'api/public/content/experience/',
                                contentParams: [
                                    'campaign', 'branding', 'placementId',
                                    'container', 'wildCardPlacement',
                                    'pageUrl', 'hostApp', 'network'
                                ],
                                defaultOrigin: 'http://www.cinema6.com/',
                                mobileType: 'mobile',
                                playerVersion: 'v0.25.0-0-g8b946d4',
                                validTypes: [
                                    'full-np', 'full', 'solo-ads', 'solo',
                                    'light',
                                    'lightbox-playlist', 'lightbox',
                                    'mobile',  'swipe'
                                ],
                                cacheTTLs: {
                                    content: {
                                        fresh: 1,
                                        max: 5
                                    }
                                }

                            }
                        }));
                        expect(service.parseCmdLine).toHaveBeenCalledWith(service.start.calls.mostRecent().args[0]);
                        expect(service.configure).toHaveBeenCalledWith(service.parseCmdLine.calls.mostRecent().args[0]);
                        expect(service.prepareServer).toHaveBeenCalledWith(service.configure.calls.mostRecent().args[0]);
                        expect(service.daemonize).toHaveBeenCalledWith(service.prepareServer.calls.mostRecent().args[0]);
                        expect(service.cluster).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0]);
                    });

                    it('should create an express app', function() {
                        expect(mockExpress).toHaveBeenCalledWith();
                    });

                    it('should create a Player instance', function() {
                        expect(MockPlayer).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0].config);
                    });

                    it('should make the server listen on the port', function() {
                        expect(expressApp.listen).toHaveBeenCalledWith(service.daemonize.calls.mostRecent().args[0].cmdl.port);
                    });

                    it('should fulfill with the express app', function() {
                        expect(success).toHaveBeenCalledWith(expressApp);
                    });

                    describe('if started as a clusterMaster', function() {
                        beforeEach(function(done) {
                            mockExpress.calls.reset();
                            MockPlayer.calls.reset();
                            success.calls.reset();

                            service.cluster.and.callFake(function(state) {
                                state.clusterMaster = true;

                                return q(state);
                            });

                            MockPlayer.startService().finally(done);
                        });

                        it('should not create an express server', function() {
                            expect(mockExpress).not.toHaveBeenCalled();
                        });
                    });

                    describe('route: GET /api/public/players/:type', function() {
                        it('should exist', function() {
                            expect(expressApp.get).toHaveBeenCalledWith('/api/public/players/:type', jasmine.any(Function));
                        });

                        describe('when invoked', function() {
                            var state;
                            var middleware;
                            var request, response;
                            var headers;
                            var getDeferred;

                            beforeEach(function(done) {
                                state = service.daemonize.calls.mostRecent().args[0];

                                middleware = expressRoutes.get['/api/public/players/:type'][0];
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
                                    }
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
                                    origin: request.get('origin')
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

                            describe('if the device is mobile', function() {
                                beforeEach(function() {
                                    response.send.calls.reset();
                                    player.get.calls.reset();
                                    browser.isMobile = true;
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
                                            expect(player.get).toHaveBeenCalled();
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
                                        expect(response.redirect).toHaveBeenCalledWith(303, state.config.mobileType + formatURL({
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

                                            request.params.type = state.config.mobileType;

                                            middleware(request, response).finally(done);
                                        });

                                        it('should not redirect the agent', function() {
                                            expect(response.redirect).not.toHaveBeenCalled();
                                        });

                                        it('should get() the player and send the response', function() {
                                            expect(player.get).toHaveBeenCalled();
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
                envRoot: 'https://portal.cinema6.com/',
                playerLocation: 'apps/mini-reel-player/index.html',
                contentLocation: 'api/public/content/experience/',
                playerVersion: 'v0.25.0-0-g8b946d4',
                validTypes: ['full-np', 'full', 'light', 'lightbox-playlist', 'lightbox', 'mobile', 'solo-ads', 'solo', 'swipe'],
                contentParams: [
                    'campaign', 'branding', 'placementId',
                    'container', 'wildCardPlacement',
                    'pageUrl', 'hostApp', 'network'
                ],
                defaultOrigin: 'http://www.cinema6.com/',
                cacheTTLs: {
                    content: {
                        fresh: 1,
                        max: 5
                    }
                }
            };
            player = new Player(config);
        });

        it('should create a FunctionCache for experiences', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: config.cacheTTLs.content.fresh,
                maxTTL: config.cacheTTLs.content.max,
                extractor: clonePromise
            });
        });

        describe('@public', function() {
            describe('properties:', function() {
                describe('config', function() {
                    it('should be the provided config object', function() {
                        expect(player.config).toBe(config);
                    });
                });
            });

            describe('methods:', function() {
                describe('get(options)', function() {
                    var success, failure;
                    var options;
                    var $document, experience;

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
                            preview: true
                        };

                        var load = cheerio.load;
                        spyOn(cheerio, 'load').and.callFake(function() {
                            return ($document = load.apply(cheerio, arguments));
                        });

                        experience = { id: 'e-92160a770b81d5', data: { deck: [] } };
                        spyOn(player, '__getExperience__').and.returnValue(q(experience));

                        spyOn(player, '__getPlayer__').and.returnValue(q(playerHTML));

                        spyOn(Player, '__addResource__').and.callThrough();

                        player.get(options).then(success, failure).finally(done);
                    });

                    it('should get the player', function() {
                        expect(player.__getPlayer__).toHaveBeenCalledWith(options.type, options.uuid);
                    });

                    it('should get the experience', function() {
                        expect(player.__getExperience__).toHaveBeenCalledWith(options.experience, {
                            campaign: 'cam-c3de383f7e37ce',
                            branding: 'cinema6',
                            network: 'mopub',
                            placementId: '1673285684',
                            container: 'mopub',
                            wildCardPlacement: '238974285',
                            pageUrl: 'http://www.foo.com/bar',
                            hostApp: 'My Talking Tom'
                        }, 'http://cinema6.com/solo', options.uuid);
                    });

                    it('should add the experience as a resource', function() {
                        expect(Player.__addResource__).toHaveBeenCalledWith($document, 'experience', 'application/json', experience);
                    });

                    it('should resolve to the player as a string of HTML', function() {
                        expect(success).toHaveBeenCalledWith($document.html());
                    });

                    describe('if called without an origin', function() {
                        beforeEach(function(done) {
                            player.__getExperience__.calls.reset();
                            options.origin = undefined;

                            player.get(options).finally(done);
                        });

                        it('should use the default origin', function() {
                            expect(player.__getExperience__).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Object), config.defaultOrigin, jasmine.any(String));
                        });
                    });
                });
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
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

                        contentURL = 'https://portal.cinema6.com/api/public/content/experience/e-92160a770b81d5';

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

                describe('__getPlayer__(mode)', function() {
                    var success, failure;
                    var mode;
                    var result;

                    beforeEach(function() {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');
                        mode = 'lightbox';

                        result = player.__getPlayer__(mode);
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
                        expect(request.get).toHaveBeenCalledWith(resolveURL(config.envRoot, config.playerLocation), { gzip: true });
                    });

                    describe('when the player fails to be fetched', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Could not download stuff.');
                            requestDeferreds[resolveURL(config.envRoot, config.playerLocation)].reject(reason);

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
                                requestDeferreds[resolveURL(config.envRoot, config.playerLocation)].resolve(playerHTML);
                            }).then(function() {
                                return requestDeferreds[resolveURL(config.envRoot, config.playerLocation)].promise;
                            }).then(function() {
                                return new q.Promise(function(resolve) {
                                    setTimeout(resolve, 0);
                                });
                            }).done(done);
                        });

                        it('should make requests for the local CSS/JS files', function() {
                            expect(request.get).toHaveBeenCalledWith('https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css', { gzip: true });
                            expect(request.get).toHaveBeenCalledWith('https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js', { gzip: true });
                            expect(request.get.calls.count()).toBe(2);
                        });

                        describe('if a sub-resource fails to be fetched', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Could not download stuff.');
                                requestDeferreds['https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js'].reject(reason);

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
                                requestDeferreds['https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css'].resolve(playerCSS);
                                requestDeferreds['https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js'].resolve(playerJS);

                                result.then(function() {}).then(done, done);
                            });

                            it('should fulfill with a cheerio document where the external resources are replaced with inline ones', function() {
                                var $orig = cheerio.load(playerHTML);
                                var $result = cheerio.load(success.calls.mostRecent().args[0]);

                                expect(success).toHaveBeenCalledWith(jasmine.any(String));
                                expect($result('*').length).toBe($orig('*').length);
                                expect($result('script[src="${mode}.js"]').length).toBe(0);
                                expect($result('script[src="lightbox.js"]').length).toBe(0);
                                expect($result('link[href="css/${mode}.css"]').length).toBe(0);
                                expect($result('link[href="css/lightbox.css"]').length).toBe(0);

                                expect($result('script[data-src="https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js"]').text()).toBe(playerJS);
                                expect($result('style[data-href="https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css"]').text()).toBe(Player.__rebaseCSS__(playerCSS, 'https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css'));
                                expect($result('base').attr('href')).toBe('https://portal.cinema6.com/apps/mini-reel-player/v0.25.0-0-g8b946d4/');
                            });
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
                            q().then(done);
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
