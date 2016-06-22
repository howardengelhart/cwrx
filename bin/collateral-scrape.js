(function() {
    'use strict';

    var q = require('q');
    var logger = require('../lib/logger');
    var spidey = require('spidey.js');
    var util = require('util');
    var authUtils = require('../lib/authUtils');
    var parseURL = require('url').parse;
    var request = require('request-promise').defaults({
        json: true
    });
    var inspect = util.inspect;
    var inherits = util.inherits;
    var ld = require('lodash');
    var formatURL = require('url').format;
    var resolveURL = require('url').resolve;
    var HtmlEntities = require('html-entities').AllHtmlEntities;
    var html = new HtmlEntities();
    var getSymbolFromCurrency = require('currency-symbol-map').getSymbolFromCurrency;

    var PRODUCT_TYPES = {
        APP_STORE: 'APP_STORE',
        ETSY: 'ETSY'
    };

    var ERROR_CODES = {
        NOT_FOUND: 'ENOTFOUND',
        INVALID: 'EINVAL'
    };

    var scraper = {};

    function ServiceResponse(code, body) {
        this.code = code;
        this.body = body;
    }

    function NotFoundError(message) {
        Error.apply(this, arguments);

        this.message = message;
        this.code = ERROR_CODES.NOT_FOUND;
    }
    inherits(NotFoundError, Error);

    function InvalidError(message) {
        Error.apply(this, arguments);

        this.message = message;
        this.code = ERROR_CODES.INVALID;
    }
    inherits(InvalidError, Error);

    scraper.getWebsiteData = function getWebsiteData(req, config) {
        return q().then(function callSpidey() {
            var log = logger.getLog();
            var uuid = req.uuid;
            var uri = req.query.uri;

            if (!uri) {
                log.info('[%1] Client did not specify a URI.', uuid);
                return new ServiceResponse(
                    400,
                    'Must specify a URI.'
                );
            }

            log.info('[%1] Attempting to scrape "%2."', uuid, uri);

            return spidey(uri, {
                timeout: config.scraper.timeout,
                gzip: true,
                headers: { 'User-Agent': config.scraper.agent }
            }).then(function createResponse(data) {
                log.info('[%1] Successfully scraped data for "%2."', uuid, uri);
                return new ServiceResponse(200, data);
            }).catch(function handleRejection(reason) {
                var name = reason.name;
                var cause = reason.cause;

                if (name === 'StatusCodeError') {
                    log.info('[%1] Upstream server responded with [%2].', uuid, reason.statusCode);
                    return new ServiceResponse(
                        400,
                        'Upstream server responded with status code [' + reason.statusCode + '].'
                    );
                }

                if (name === 'RequestError') {
                    if (cause.code === 'ETIMEDOUT') {
                        log.warn('[%1] Timed out GETting "%2."', uuid, uri);
                        return new ServiceResponse(
                            408,
                            'Timed out scraping website [' + uri + '].'
                        );
                    }

                    if (cause.code === 'ENOTFOUND') {
                        log.info('[%1] No server found at address "%2."', uuid, uri);
                        return new ServiceResponse(
                            400,
                            'Upstream server not found.'
                        );
                    }

                    if (/Invalid URI/.test(cause.message)) {
                        log.info('[%1] URI is not valid: %2.', uuid, uri);
                        return new ServiceResponse(
                            400,
                            'URI [' + uri + '] is not valid.'
                        );
                    }

                    log.warn('[%1] Unexpected Error from request: %2.', uuid, util.inspect(cause));
                    return new ServiceResponse(
                        500,
                        'Unexpected error fetching website: ' + util.inspect(reason)
                    );
                }

                log.error(
                    '[%1] Unexpected Error scraping URI [%2]: %3.',
                    uuid, uri, util.inspect(reason)
                );
                return new ServiceResponse(
                    500,
                    'Internal error: ' + util.inspect(reason)
                );
            });
        });
    };

    scraper.productDataFrom = {};
    scraper.productDataFrom[PRODUCT_TYPES.ETSY] = function getEtsyData(id, config, secrets) {
        /* jshint camelcase: false */

        function requetsy(pathname, query) {
            return request(formatURL({
                protocol: 'https',
                hostname: 'openapi.etsy.com',
                pathname: resolveURL('/v2/', pathname),
                query: ld.merge({}, query || {}, { api_key: secrets.etsyKey })
            }));
        }

        return q.all([
            requetsy('shops/' + id),
            requetsy('shops/' + id + '/listings/featured', { includes: 'Images' })
        ]).spread(function getImages(shops, listings) {
            var shop = shops.results[0];

            return {
                type: 'ecommerce',
                platform: 'etsy',
                name: shop.shop_name,
                description: shop.announcement,
                uri: shop.url,
                extID: shop.shop_id,
                products: listings.results.map(function(listing) {
                    return {
                        name: listing.title,
                        description: html.decode(listing.description),
                        uri: listing.url,
                        categories: listing.category_path,
                        price: getSymbolFromCurrency(listing.currency_code) + listing.price,
                        extID: listing.listing_id,
                        images: listing.Images.map(function(image) {
                            return {
                                uri: image.url_570xN,
                                averageColor: image.hex_code
                            };
                        })
                    };
                })
            };
        }).catch(function handleFailure(reason) {
            if (reason.statusCode === 404) {
                throw new NotFoundError('No store found with that name.');
            }

            throw reason;
        });
    };
    scraper.productDataFrom[PRODUCT_TYPES.APP_STORE] = function getAppStoreData(
        id/*,
        config,
        secrets*/
    ) {
        return q().then(function sendRequest() {
            return request('https://itunes.apple.com/lookup?id=' + id);
        }).then(function createData(response) {
            var app = response.results[0];

            if (!app) {
                throw new NotFoundError('No app found with that ID.');
            }

            if (app.kind !== 'software') {
                throw new InvalidError('URI is not for an app.');
            }

            return {
                type: 'app',
                platform: 'iOS',
                name: app.trackCensoredName,
                description: app.description,
                developer: app.artistName,
                uri: app.trackViewUrl,
                categories: app.genres,
                price: app.formattedPrice,
                rating: app.averageUserRating,
                extID: app.trackId,
                ratingCount : app.userRatingCount,
                bundleId: app.bundleId,
                images: [].concat(
                    app.screenshotUrls.map(function(uri) {
                        return { uri: uri, type: 'screenshot', device: 'phone' };
                    }),
                    app.ipadScreenshotUrls.map(function(uri) {
                        return { uri: uri, type: 'screenshot', device: 'tablet' };
                    }),
                    [{ uri: app.artworkUrl512, type: 'thumbnail' }]
                )
            };
        });
    };

    scraper.parseProductURI = function parseProductURI(uri) {
        var url, id;

        if (!uri) {
            throw new InvalidError('URI is required.');
        }

        url = parseURL(uri);

        if (!url.hostname) {
            throw new InvalidError('URI is invalid.');
        }

        switch (url.hostname) {
        case 'itunes.apple.com':
            id = (url.pathname.match(/\d+$/) || [])[0];

            if (!id) {
                throw new InvalidError('URI has no ID.');
            }

            return {
                type: PRODUCT_TYPES.APP_STORE,
                id: id
            };
        case 'www.etsy.com':
            id = (url.pathname.match(/\/shop\/([^\/]+)/) || [])[1];

            if (!id) {
                throw new InvalidError('URI is not for a shop.');
            }

            return {
                type: PRODUCT_TYPES.ETSY,
                id: id
            };
        default:
            throw new InvalidError('URI is not from a valid platform.');
        }
    };

    scraper.getProductData = function getProductData(req, config, secrets) {
        var log = logger.getLog();
        var uuid = req.uuid;
        var uri = req.query.uri;

        return q().then(function parseProductURI() {
            log.info('[%1] Getting data for product: "%2."', uuid, uri);

            return scraper.parseProductURI(uri);
        }).then(function getProductData(meta) {
            log.trace('[%1] Parsed product URI: %2.', uuid, inspect(meta));
            return scraper.productDataFrom[meta.type](meta.id, config, secrets);
        }).then(function createServiceReponse(data) {
            log.info('[%1] Successfully fetched product data.', uuid);

            return new ServiceResponse(200, data);
        }).catch(function handleFailure(reason) {
            log.info('[%1] Failed to get product data: %2', uuid, reason.message);

            switch (reason.code) {
            case ERROR_CODES.NOT_FOUND:
                return new ServiceResponse(404, reason.message);
            case ERROR_CODES.INVALID:
                return new ServiceResponse(400, reason.message);
            default:
                log.error('[%1] Unknown error getting product data: %2', uuid,inspect(reason));

                return new ServiceResponse(500, reason.message);
            }
        });
    };

    scraper.getMetadata = function(req, metagetta) {

        var uuid = req.uuid,
            log = logger.getLog(),
            opts = {
                uri: req.query.uri,
                type: req.query.type,
                id: req.query.id
            };


        if (!req.query.uri && !req.query.id) {
            log.info('[%1]- Must specify either a URI or id.', uuid);
            return q(new ServiceResponse(400, 'Must specify either a URI or id.'));
        }


        return metagetta(opts)
        .then(function (data) {
                log.info('[%1] Successfully fetched metadata.', uuid);
                return q(new ServiceResponse(200, data));
            }).catch(function (error) {
                log.warn('[%1] Failed to get metadata. [%2]', uuid, inspect(error));
                return q(new ServiceResponse(400, 'Error getting metadata'));
            });
    };

    scraper.setupEndpoints = function setupEndpoints(app, state, audit, jobManager, metagetta) {
        var setJobTimeout = jobManager.setJobTimeout.bind(jobManager);
        var requireAuth = authUtils.middlewarify({ allowApps: true });

        app.get(
            '/api/collateral/website-data',
            setJobTimeout, state.sessions, requireAuth, audit,
            function(req, res) {
                var promise = q.when(scraper.getWebsiteData(req, state.config));

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error getting website data',
                                detail: error
                            });
                        });
                });
            }
        );

        app.get(
            '/api/collateral/product-data',
            setJobTimeout, state.sessions, requireAuth, audit,
            function(req, res) {
                var promise = q.when(scraper.getProductData(req, state.config, state.secrets));

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error getting product data',
                                detail: error
                            });
                        });
                });
            }
        );

        app.get(
            '/api/collateral/video-data',
            setJobTimeout, state.sessions, requireAuth, audit,
            function(req, res) {
                var promise = q.when(scraper.getMetadata(req, metagetta));

                promise.finally(function() {
                    return jobManager.endJob(req, res, promise.inspect())
                        .catch(function(error) {
                            res.send(500, {
                                error: 'Error getting video metadata',
                                detail: error
                            });
                        });
                });
            }
        );

        // public endpoints

        app.get('/api/public/collateral/website-data', function(req, res) {
            res.header('cache-control', 'max-age=300');
            res.header('Access-Control-Allow-Origin', '*');

            var promise = q.when(scraper.getWebsiteData(req, state.config));
            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect())
                    .catch(function(error) {
                        res.send(500, {
                            error: 'Error getting website data',
                            detail: error
                        });
                    });
            });
        });

        app.get('/api/public/collateral/product-data', function(req, res) {
            res.header('cache-control', 'max-age=300');
            res.header('Access-Control-Allow-Origin', '*');

            var promise = q.when(scraper.getProductData(req, state.config, state.secrets));
            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect())
                    .catch(function(error) {
                        res.send(500, {
                            error: 'Error getting product data',
                            detail: error
                        });
                    });
            });
        });


    };

    module.exports = scraper;
}());
