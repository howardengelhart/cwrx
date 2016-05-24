(function() {
    'use strict';

    var request = require('request-promise').defaults({ json: true });
    var formatURL = require('url').format;
    var resolveURL = require('url').resolve;
    var querystring = require('querystring');
    var logger = require('../lib/logger');
    var inspect = require('util').inspect;
    var ld = require('lodash');
    var authUtils = require('../lib/authUtils');
    var q = require('q');

    var searchApps = {};

    function ServiceResponse(code, body) {
        this.code = code;
        this.body = body;
    }

    searchApps.findApps = function findApps(req, config) {
        var log = logger.getLog();
        var productDataEndpoint = resolveURL(config.api.root, config.api.productData.endpoint);
        var uuid = req.uuid;
        var params = req.query;
        var query = params.query;
        var limit = params.limit;

        if (!query) {
            return q(new ServiceResponse(400, 'A search query is required.'));
        }

        return q(request(formatURL({
            protocol: 'https',
            hostname: 'itunes.apple.com',
            pathname: '/search',
            query: ld.pickBy({
                entity: 'software',
                term: query,
                limit: limit
            })
        }))).then(function formatResponse(response) {
            return new ServiceResponse(200, response.results.map(function createItem(result) {
                return {
                    title: result.trackName,
                    developer: result.artistName,
                    thumbnail: result.artworkUrl100,
                    category: result.primaryGenreName,
                    price: result.formattedPrice,
                    rating: result.averageUserRating,
                    uri: result.trackViewUrl,
                    productDataURI: resolveURL(productDataEndpoint, '?' + querystring.stringify({
                        uri: result.trackViewUrl
                    }))
                };
            }));
        }).catch(function handleFailure(reason) {
            log.error('[%1] Failure from iTunes for query "%2": %3.', uuid, query, inspect(reason));

            return new ServiceResponse(500, reason.message);
        });
    };

    searchApps.setupEndpoints = function setupEndpoints(app, state, audit) {
        var requireAuth = authUtils.middlewarify({ allowApps: true });

        app.get('/api/search/apps', state.sessions, requireAuth, audit, function(req, res) {
            searchApps.findApps(req, state.config).then(function send(response) {
                res.send(response.code, response.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error searching for apps',
                    detail: inspect(error)
                });
            });
        });
        
        app.get('/api/public/search/apps', function(req, res) {
            res.header('cache-control', 'max-age=300');
            res.header('Access-Control-Allow-Origin', '*');

            searchApps.findApps(req, state.config).then(function send(response) {
                res.send(response.code, response.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error searching for apps',
                    detail: inspect(error)
                });
            });
        });
    };

    module.exports = searchApps;
}());
