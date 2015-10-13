#!/usr/bin/env node

var q = require('q');
var request = require('request-promise');
var cheerio = require('cheerio');
var HTMLDocument = require('../lib/htmlDocument');
var resolveURL = require('url').resolve;
var parseURL = require('url').parse;
var formatURL = require('url').format;
var FunctionCache = require('../lib/functionCache');
var service = require('../lib/service');
var express = require('express');
var logger = require('../lib/logger');
var uuid = require('../lib/uuid');
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
}

/***************************************************************************************************
 * @private methods * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 **************************************************************************************************/

Player.__rebaseCSS__ = function __rebaseCSS__(css, base) {
    return css.replace(/url\(['"]?(.+?)['"]?\)/g, function(match, url) {
        return 'url(' + resolveURL(base, url) + ')';
    });
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

/**
 * Given a player "mode," this method will fetch the player's HTML file, replace any ${mode} macros
 * with the give mode and fetch an inline any HTML or CSS resources referenced in the file, and
 * return a cheerio document.
 */
Player.prototype.__getPlayer__ = function __getPlayer__(mode, uuid) {
    var log = logger.getLog();
    var config = this.config;
    var playerLocation = resolveURL(config.api.root, config.api.player.endpoint);
    var rebaseCSS = Player.__rebaseCSS__;

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
            $inlineScript.attr('data-src', script.url);
            $inlineScript.text(script.text);

            script.$node.replaceWith($inlineScript);
        });
        stylesheets.forEach(function(stylesheet) {
            var $inlineStyles = $('<style></style>');
            $inlineStyles.attr('data-href', stylesheet.url);
            $inlineStyles.text(rebaseCSS(stylesheet.text, stylesheet.url));

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
                root: 'https://staging.cinema6.com/',
                player: {
                    endpoint: 'apps/mini-reel-player/index.html'
                },
                experience: {
                    endpoint: 'api/public/content/experience/',
                    validParams: [
                        'campaign', 'branding', 'placementId',
                        'container', 'wildCardPlacement',
                        'pageUrl', 'hostApp', 'network'
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

        app.use(function(req, res, next) {
            res.header(
                'Access-Control-Allow-Origin', '*'
            );
            res.header(
                'Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept'
            );
            res.header(
                'Cache-Control', 'max-age=0'
            );

            if (req.method.toLowerCase() === 'options') { res.send(200); } else { next(); }
        });

        app.use(function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);

            log.trace(
                'REQ: [%1] %2 %3 %4 %5',
                req.uuid, JSON.stringify(req.headers), req.method, req.url, req.httpVersion
            );

            next();
        });

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

            if (new BrowserInfo(agent).isMobile && type !== mobileType) {
                log.trace('[%1] Redirecting agent to mobile player: %2.', uuid, mobileType);
                return q(res.redirect(303, mobileType + formatURL({ query: req.query })));
            }

            return player.get(extend({
                type: type,
                uuid: uuid,
                origin: origin
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
                return state;
            }

            AWS.config.update({ region: state.config.cloudwatch.region });

            return route(state);
        });
};

Player.prototype.get = function get(/*options*/) {
    var options = extend(arguments[0], this.config.defaults);

    var log = logger.getLog();
    var config = this.config;
    var adLoader = this.adLoader;
    var adLoadTimeReporter = this.adLoadTimeReporter;
    var type = options.type;
    var experience = options.experience;
    var params = filterObject(options, function(value, key) {
        return config.api.experience.validParams.indexOf(key) > -1;
    });
    var origin = stripURL(options.origin);
    var uuid = options.uuid;
    var categories = options.categories;
    var campaign = options.campaign;
    var preview = options.preview;
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

    return q.all([
        this.__getPlayer__(type, uuid),
        this.__getExperience__(experience, params, origin, uuid).then(function loadAds(experience) {
            var start = Date.now();

            if (preview || !AdLoader.hasAds(experience)) {
                log.trace('[%1] Skipping ad calls.', uuid);
                return addTrackingPixels(AdLoader.removePlaceholders(experience));
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
                .thenResolve(experience)
                .then(addTrackingPixels);
        })
    ]).spread(function inlineResources(document, experience) {
        log.trace('[%1] Inlining experience (%2) to %3 player HTML.', uuid, experience.id, type);
        document.addResource('experience', 'application/json', experience);

        log.trace('[%1] Stringifying document.', uuid);
        return document.toString();
    });
};

module.exports = Player;

if (require.main === module) {
    Player.startService();
}
