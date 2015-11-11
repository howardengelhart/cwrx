#!/usr/bin/env node

var q = require('q');
var request = require('request-promise');
var cheerio = require('cheerio');
var HTMLDocument = require('../lib/htmlDocument');
var rebaseCSS = HTMLDocument.rebaseCSS;
var rebaseJS = HTMLDocument.rebaseJS;
var resolveURL = require('url').resolve;
var parseURL = require('url').parse;
var formatURL = require('url').format;
var FunctionCache = require('../lib/functionCache');
var service = require('../lib/service');
var express = require('express');
var logger = require('../lib/logger');
var inherits = require('util').inherits;
var inspect = require('util').inspect;
var BrowserInfo = require('../lib/browserInfo');
var resolvePath = require('path').resolve;
var inspect = require('util').inspect;
var filterObject = require('../lib/objUtils').filter;
var extend = require('../lib/objUtils').extend;
var clonePromise = require('../lib/promise').clone;
var AdLoader = require('../lib/adLoader');
var parseQuery = require('../lib/expressUtils').parseQuery;
var AWS = require('aws-sdk');
var CloudWatchReporter = require('../lib/cloudWatchReporter');
var cloudwatchMetrics = require('../lib/expressUtils').cloudwatchMetrics;
var setUuid = require('../lib/expressUtils').setUuid;
var setBasicHeaders = require('../lib/expressUtils').setBasicHeaders;
var handleOptions = require('../lib/expressUtils').handleOptions;
var logRequest = require('../lib/expressUtils').logRequest;

var push = Array.prototype.push;

var staticCache = new FunctionCache({
    freshTTL: Infinity,
    maxTTL: Infinity,
    gcInterval: Infinity,

    extractor: function cloneDocument(promise) {
        return promise.then(function(document) { return document.clone(); });
    }
});

function stripURL(url) {
    var parsed = parseURL(url);

    return formatURL({
        protocol: parsed.protocol,
        host: parsed.host,
        pathname: parsed.pathname
    });
}

function ServiceError(message, status) {
    Error.call(this, message);

    this.message = message;
    this.status = status;
}
inherits(ServiceError, Error);

ServiceError.prototype.toString = function toString() {
    return '[' + this.status + '] ' + this.message;
};

function Player(config) {
    var log = logger.getLog();
    var contentCache = new FunctionCache({
        freshTTL: config.api.experience.cacheTTLs.fresh,
        maxTTL: config.api.experience.cacheTTLs.max,
        extractor: clonePromise
    });
    var brandingCache = new FunctionCache({
        freshTTL: config.api.branding.cacheTTLs.fresh,
        maxTTL: config.api.branding.cacheTTLs.max
    });

    this.config = config;
    this.adLoader = new AdLoader({
        envRoot: config.api.root,
        cardEndpoint: config.api.card.endpoint,
        cardCacheTTLs: config.api.card.cacheTTLs,
        protocol: config.adtech.protocol,
        server: config.adtech.server,
        network: config.adtech.network,
        maxSockets: config.adtech.request.maxSockets,
        timeout: config.adtech.request.timeout,
        keepAlive: config.adtech.request.keepAlive
    });
    this.adLoadTimeReporter = new CloudWatchReporter(config.cloudwatch.namespace, {
        MetricName: 'AdLoadTime',
        Unit: 'Milliseconds',
        Dimensions: config.cloudwatch.dimensions
    });
    this.adLoadTimeReporter.on('flush', function(data) {
        log.info('Sending AdLoadTime metrics to CloudWatch: %1', inspect(data));
    });

    this.adLoadTimeReporter.autoflush(config.cloudwatch.sendInterval);

    // Memoize Player.prototype.__getPlayer__() method.
    this.__getPlayer__ = staticCache.add(this.__getPlayer__.bind(this), -1);
    // Memoize Player.prototype.__getExperience__() method.
    this.__getExperience__ = contentCache.add(this.__getExperience__.bind(this), -1);
    // Memoize Player.prototype.__getBranding__() method.
    this.__getBranding__ = brandingCache.add(this.__getBranding__.bind(this), -1);
}

/***************************************************************************************************
 * @private methods * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 **************************************************************************************************/

Player.prototype.__apiParams__ = function __apiParams__(type, params) {
    var validParams = this.config.api[type].validParams;
    var predicate = validParams ? function(value, key) {
        return validParams.indexOf(key) > -1;
    } : function() { return true; };

    return filterObject(params, predicate);
};

Player.prototype.__loadExperience__ = function __loadExperience__(id, params, origin, uuid) {
    var self = this;
    var log = logger.getLog();
    var preview = params.preview;
    var categories = params.categories;
    var campaign = params.campaign;
    var validParams = this.__apiParams__('experience', params);
    var adLoader = this.adLoader;
    var adLoadTimeReporter = this.adLoadTimeReporter;

    function getExperience() {
        // If in preview mode, call the uncached version of __getExperience__().
        var method = preview ? Player.prototype.__getExperience__ : self.__getExperience__;

        return method.apply(self, arguments);
    }

    function loadAds(experience) {
        var start = Date.now();

        if (preview || !AdLoader.hasAds(experience)) {
            log.trace('[%1] Skipping ad calls.', uuid);
            return AdLoader.removePlaceholders(experience);
        }

        return adLoader.loadAds(experience, categories, campaign, uuid)
            .tap(function sendMetrics() {
                var end = Date.now();

                adLoadTimeReporter.push(end - start);
            })
            .catch(function trimCards(reason) {
                log.warn('[%1] Unexpected failure loading ads: %2', uuid, inspect(reason));

                AdLoader.removePlaceholders(experience);
                AdLoader.removeSponsoredCards(experience);
            })
            .thenResolve(experience);
    }

    return getExperience(id, validParams, origin, uuid).then(loadAds);
};

Player.prototype.__getExperience__ = function __getExperience__(id, params, origin, uuid) {
    var log = logger.getLog();
    var config = this.config;
    var contentLocation = resolveURL(config.api.root, config.api.experience.endpoint);
    var url = resolveURL(contentLocation, id || '');

    if (!id) {
        return q.reject(new ServiceError('experience must be specified', 400));
    }

    log.trace(
        '[%1] Fetching experience from "%2" with params (%3) as "%4."',
        uuid, url, inspect(params), origin
    );

    return q(request.get(url, {
        qs: params,
        headers: { origin: origin },
        json: true
    })).then(function decorate(experience) {
        return extend(experience, {
            data: { adServer: { server: config.adtech.server, network: config.adtech.network } },
            $params: params
        });
    }).catch(function convertError(reason) {
        var message = reason.message;
        var statusCode = reason.statusCode;

        if (statusCode >= 500) {
            log.error('[%1] Error fetching experience: [%2] {%3}.', uuid, statusCode, message);
        }

        throw new ServiceError(message, statusCode);
    });
};

Player.prototype.__getBranding__ = function __getBranding__(branding, type, hover, uuid) {
    var log = logger.getLog();
    var base = resolveURL(this.config.api.root, this.config.api.branding.endpoint);
    var directory = resolveURL(base, branding + '/styles/');
    var typeDirectory = resolveURL(directory, type + '/');

    log.info(
        '[%1] Fetching {%2} branding for player {%3} with hover: %4.',
        uuid, branding, type, hover
    );

    var stylesheets = [
        resolveURL(directory, 'core.css'),
        resolveURL(typeDirectory, 'theme.css')
    ].concat(hover ? [
        resolveURL(directory, 'core--hover.css'),
        resolveURL(typeDirectory, 'theme--hover.css')
    ] : []);

    return q.all(stylesheets.map(function(src) {
        return request.get(src).then(function createData(css) {
            log.trace('[%1] Got stylesheet "%2".', uuid, src);

            return { src: src, styles: css };
        }).catch(function returnNull(reason) {
            log.trace('[%1] Failed to get stylesheet: %2.', uuid, reason.message);

            return null;
        });
    })).then(function filterNulls(brandings) {
        var result = brandings.filter(function(branding) { return branding; });

        log.info('[%1] Successfully got %2 branding stylesheets.', uuid, result.length);

        return result;
    });
};

/**
 * Given a player "mode," this method will fetch the player's HTML file, replace any ${mode} macros
 * with the give mode and fetch an inline any HTML or CSS resources referenced in the file, and
 * return a cheerio document.
 */
Player.prototype.__getPlayer__ = function __getPlayer__(mode, uuid) {
    var log = logger.getLog();
    var config = this.config;
    var playerLocation = resolveURL(config.api.root, config.api.player.endpoint);

    var sameHostAsPlayer = (function() {
        var playerHost = parseURL(playerLocation).host;

        return function sameHostAsPlayer(resource) {
            return parseURL(resource.url).host === playerHost;
        };
    }());

    function fetchResource(resource) {
        log.trace('[%1] Fetching sub-resource from "%2."', uuid, resource.url);

        return q(request.get(resource.url, { gzip: true })).then(function(response) {
            log.trace('[%1] Fetched "%2."', uuid, resource.url);

            return { $node: resource.$node, text: response, url: resource.url };
        });
    }

    if (this.config.validTypes.indexOf(mode) < 0) {
        return q.reject(new ServiceError('Unknown player type: ' + mode, 404, 'info'));
    }

    log.trace('[%1] Fetching player template from "%2."', uuid, playerLocation);

    return q(request.get(playerLocation, { gzip: true })).then(function parseHTML(response) {
        log.trace('[%1] Fetched player template.', uuid);
        return cheerio.load(response.replace(/\${mode}/g, mode));
    }).then(function fetchSubResources($) {
        var $base = $('base');
        var baseURL = resolveURL(playerLocation, $base.attr('href'));
        var jsResources = $('script[src]').get().map(function(script) {
            var $script = $(script);

            return { $node: $script, url: resolveURL(baseURL, $script.attr('src')) };
        }).filter(sameHostAsPlayer);
        var cssResources = $('link[rel=stylesheet]').get().map(function(link) {
            var $link = $(link);

            return { $node: $link, url: resolveURL(baseURL, $link.attr('href')) };
        }).filter(sameHostAsPlayer);
        var baseConfig = { $node: $base, url: baseURL };

        log.trace(
            '[%1] Player has %2 CSS file(s) and %3 JS file(s) that can be inlined.',
            uuid, cssResources.length, jsResources.length
        );

        return q.all([
            q.all(jsResources.map(fetchResource)),
            q.all(cssResources.map(fetchResource))
        ]).spread(function(js, css) {
            return [$, baseConfig, js, css];
        });
    }).spread(function createDocument($, base, scripts, stylesheets) {
        scripts.forEach(function(script) {
            var $inlineScript = $('<script></script>');
            var url = script.url;
            var text = script.text;

            $inlineScript.attr('data-src', url);
            $inlineScript.text(rebaseJS(text, url).replace(/<\/script>/g, '<\\/script>'));

            script.$node.replaceWith($inlineScript);
        });
        stylesheets.forEach(function(stylesheet) {
            var $inlineStyles = $('<style></style>');
            var url = stylesheet.url;
            var text = stylesheet.text;

            $inlineStyles.attr('data-href', url);
            $inlineStyles.text(rebaseCSS(text, url));

            stylesheet.$node.replaceWith($inlineStyles);
        });
        base.$node.attr('href', base.url);

        log.trace('[%1] Successfully inlined JS and CSS.', uuid);

        return new HTMLDocument($.html());
    }).catch(function logRejection(reason) {
        log.error('[%1] Error getting %2 player template: %3.', uuid, mode, inspect(reason));
        throw reason;
    });
};

/***************************************************************************************************
 * @public methods * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 **************************************************************************************************/

module.exports = Player;

Player.startService = function startService() {
    var Player = this;
    var state = {
        defaultConfig: {
            appName: 'player',
            appDir: __dirname,
            pidDir: resolvePath(__dirname, '../pids'),
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
                    }
                },
                card: {
                    endpoint: 'api/public/content/card/',
                    cacheTTLs: {
                        fresh: 1,
                        max: 5
                    }
                }
            },
            adtech: {
                protocol: 'https:',
                server: 'adserver.adtechus.com',
                network: '5491.1',
                request: {
                    maxSockets: 250,
                    timeout: 3000,
                    keepAlive: true
                }
            },
            cloudwatch: {
                namespace: 'C6/Player',
                region: 'us-east-1',
                sendInterval: (5 * 60 * 1000), // 5 mins
                dimensions: [{ Name: 'Environment', Value: 'Development' }]
            },
            defaults: {
                origin: 'http://www.cinema6.com/',
                context: 'standalone',
                container: 'standalone',
                mobileType: 'mobile'
            },
            validTypes: [
                'full-np', 'full', 'solo-ads', 'solo',
                'light',
                'lightbox-playlist', 'lightbox',
                'mobile',  'swipe'
            ]
        }
    };

    function route(state) {
        var log = logger.getLog();
        var started = new Date();
        var app = express();
        var player = new Player(state.config);
        var parsePlayerQuery = parseQuery({
            arrays: ['categories', 'playUrls', 'countUrls', 'launchUrls']
        });
        var sendRequestMetrics = cloudwatchMetrics(
            state.config.cloudwatch.namespace,
            state.config.cloudwatch.sendInterval,
            { Dimensions: state.config.cloudwatch.dimensions }
        );

        function resetCodeCache() {
            log.info('Got refresh command. Resetting code cache.');

            return player.resetCodeCache();
        }

        app.use(setUuid());
        app.use(setBasicHeaders());
        app.use(handleOptions());
        app.use(logRequest('trace'));

        app.get('/api/players/meta', function(req, res) {
            res.send(200, {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            });
        });

        app.get('/api/players/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.get('/api/public/players/:type', parsePlayerQuery, sendRequestMetrics, function route(req, res) { // jshint ignore:line
            var config = state.config;
            var type = req.params.type;
            var uuid = req.uuid;
            var query = req.query;
            var mobileType = query.mobileType || config.defaults.mobileType;
            var origin = req.get('origin') || req.get('referer');
            var agent = req.get('user-agent');
            var browser = new BrowserInfo(agent);

            if (browser.isMobile && type !== mobileType) {
                log.trace('[%1] Redirecting agent to mobile player: %2.', uuid, mobileType);
                return q(res.redirect(303, mobileType + formatURL({ query: req.query })));
            }

            return player.get(extend({
                type: type,
                uuid: uuid,
                origin: origin,
                desktop: browser.isDesktop
            }, query)).then(function sendResponse(html) {
                log.info('[%1] {GET %2} Response Length: %3.', uuid, req.url, html.length);
                return res.send(200, html);
            }).catch(function handleRejection(reason) {
                var status = (reason && reason.status) || 500;
                var message = (reason && reason.message) || 'Internal error';

                log.info('[%1] Failure: {%2} %3', uuid, status, message);
                res.send(status, message);
            });
        });

        app.use(function(err, req, res, next) {
            if (err) {
                if (err.status && err.status < 500) {
                    log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                    res.send(err.status, err.message || 'Bad Request');
                } else {
                    log.error('[%1] Internal Error: %2', req.uuid, err && err.message || err);
                    res.send(err.status || 500, err.message || 'Internal error');
                }
            } else {
                next();
            }
        });

        process.on('SIGUSR2', resetCodeCache);
        process.on('message', function(message) {
            switch (message.cmd) {
            case 'refresh':
                return resetCodeCache();
            default:
                return;
            }
        });

        app.listen(state.cmdl.port);
        log.info('Service is listening on port: %1', state.cmdl.port);

        return app;
    }

    return service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(function init(state) {
            var log = logger.getLog();

            if (state.clusterMaster) {
                log.info('Cluster master, not a worker');

                process.on('SIGUSR2', function refreshKids() {
                    log.info('Cluster master got SIGUSR2. Refreshing kids.');

                    state.kids.forEach(function refreshKid(kid) {
                        kid.send({ cmd: 'refresh' });
                    });
                });

                return state;
            }

            AWS.config.update({ region: state.config.cloudwatch.region });

            return route(state);
        });
};

Player.prototype.get = function get(/*options*/) {
    var options = extend(arguments[0], this.config.defaults);

    var log = logger.getLog();
    var self = this;
    var type = options.type;
    var experience = options.experience;
    var desktop = options.desktop;
    var origin = stripURL(options.origin);
    var uuid = options.uuid;
    var playUrls = options.playUrls;
    var countUrls = options.countUrls;
    var launchUrls = options.launchUrls;

    log.trace('[%1] Getting player with options (%2.)', uuid, inspect(options));

    function addTrackingPixels(experience) {
        var campaign = experience.data.campaign;

        push.apply(campaign.launchUrls || (campaign.launchUrls = []), launchUrls);

        AdLoader.getSponsoredCards(experience).forEach(function addPixels(card) {
            AdLoader.addTrackingPixels({
                playUrls: playUrls,
                countUrls: countUrls
            }, card);
        });

        return experience;
    }

    function loadBranding(experience) {
        var branding = experience.data.branding;

        if (!branding) {
            log.trace(
                '[%1] Experience {%2} has no branding. Skipping branding load.',
                uuid, experience.id
            );

            return q([]);
        }

        return self.__getBranding__(branding, type, desktop, uuid);
    }

    return q.all([
        this.__getPlayer__(type, uuid),
        this.__loadExperience__(experience, options, origin, uuid)
    ]).spread(function processExperience(document, experience) {
        if (experience.data.deck.length < 1) {
            throw new ServiceError('Experience {' + experience.id + '} has no cards.', 409);
        }

        if (options.vpaid && experience.data.deck.length > 1) {
            throw new ServiceError('VPAID does not support MiniReels.', 400);
        }

        addTrackingPixels(experience);

        return loadBranding(experience).then(function inlineResources(brandings) {
            brandings.forEach(function addBrandingCSS(branding) {
                var src = branding.src;
                var contents = branding.styles;

                log.trace('[%1] Inlining branding CSS (%2) into %3 player HTML.', uuid, src, type);

                document.addCSS(src, contents);
            });

            log.trace('[%1] Adding experience (%2) to %3 player HTML.', uuid, experience.id, type);
            document.addResource('experience', 'application/json', experience);

            log.trace('[%1] Stringifying document.', uuid);
            return document.toString();
        });
    });
};

Player.prototype.resetCodeCache = function resetCodeCache() {
    return this.__getPlayer__.clear();
};

module.exports = Player;

if (require.main === module) {
    Player.startService();
}
