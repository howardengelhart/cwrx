(function() {
    'use strict';

    var q = require('q');
    var logger = require('../lib/logger');
    var spidey = require('spidey.js');
    var util = require('util');
    var authUtils = require('../lib/authUtils');

    var scraper = {};

    function ServiceResponse(code, body) {
        this.code = code;
        this.body = body;
    }

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

    scraper.setupEndpoints = function setupEndpoints(app, state, audit, jobManager) {
        var setJobTimeout = jobManager.setJobTimeout.bind(jobManager);
        var requireAuth = authUtils.middlewarify({ allowApps: true });

        app.get(
            '/api/collateral/website-data',
            setJobTimeout, state.sessions, requireAuth, audit, function(req, res) {
            var promise = q.when(scraper.getWebsiteData(req, state.config));

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect())
                    .catch(function(error) {
                        res.send(500, {
                            error: 'Error uploading files',
                            detail: error
                        });
                    });
            });
        });
    };

    module.exports = scraper;
}());
