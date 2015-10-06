var keys = Object.keys;
var formatURL = require('url').format;
var extend = require('./objUtils').extend;
var q = require('q');
var request = require('request-promise');
var logger = require('./logger');

function arrayOf(value, length) {
    var array = [];

    while (length--) {
        array[length] = value;
    }

    return array;
}

/**
 * Utility for fetching and parsing Cinema6 sponsored card banners for ADTECH.
 *
 * @class ADTECHBannerClient
 * @constructor
 * @param {Object} [config] Configuration options for the instance.
 * @param {String} [config.server=adserver.adtechus.com] Host of ADTECH server.
 * @param {String} [config.network=5473.1] ADTECH network to use.
 * @param {Number} [config.maxSockets=250] The number of concurrent connections to ADTECH to keep
 *     open.
 * @param {Number} [config.timeout=3000] Number of MS to keep a connection to ADTECH open before
 *     aborting.
 */
function ADTECHBannerClient(/*config*/) {
    var config = arguments[0] || {};

    this.server = config.server || 'adserver.adtechus.com';
    this.network = config.network || '5491.1';
    this.maxSockets = config.maxSockets || 250;
    this.timeout = config.timeout || 3000;

    this.__private__ = {
        request: request.defaults({ pool: { maxSockets: this.maxSockets }, timeout: this.timeout })
    };
}

ADTECHBannerClient.__parseBanner__ = (function() {
    var FN_REGEX = (/window\.c6\.addSponsoredCard\(([^)]+)\)/);
    var ARG_REGEX = (/^['"]|['"]\s*,\s*['"]|['"]$/g);

    return function __parseBanner__(string) {
        var parts;

        if (!FN_REGEX.test(string)) {
            throw new Error('Banner is not a sponsored card banner.');
        }

        parts = string.match(FN_REGEX)[1].split(ARG_REGEX).slice(1);

        return {
            placementId: parts[0],
            campaignId: parts[1],
            externalId: parts[2],
            clickUrl: parts[3],
            countUrl: parts[4]
        };
    };
}());

ADTECHBannerClient.prototype.__makeURL__ = function __makeURL__(type, placement, params) {
    extend(params, {
        target: '_blank',
        misc: Date.now(),
        cfp: 1
    });

    if (type === 'multiad') {
        placement = 0;
    }

    return formatURL({
        protocol: 'https:',
        host: this.server,
        pathname: [type, '3.0', this.network, placement, 0, -1, keys(params).filter(function(key) {
            return params[key] !== undefined;
        }).map(function(key) {
            var value = params[key] === null ? '' : params[key];

            return key + '=' + value;
        }).join(';')].join('/')
    });
};

/**
 * Makes an HTTP GET request using the request-promise library with the configured network settings.
 *
 * @method get
 * @param {any} [...args] Arguments to pass to request.get().
 * @return {Promise} Promise from request-promise
 */
ADTECHBannerClient.prototype.get = function get(/*...args*/) {
    var request = this.__private__.request;

    return q(request.get.apply(request, arguments));
};

/**
 * Fetches a specific banner from ADTECH.
 *
 * @method getBanner
 * @param {Number/String} placement ADTECH placement ID
 * @param {Number/String} campaignId ADTECH campaign ID
 * @param {Number/String} bannerId ADTECH banner ID
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will be fulfilled with an ADTECH banner containing:
 *     * placementId: ADTECH placement ID
 *     * campaignId: ADTECH campaign ID
 *     * externalId: Cinema6 card ID
 *     * clickUrl: ADTECH click tracking pixel
 *     * countUrl: ADTECH ad count tracking pixel
 */
ADTECHBannerClient.prototype.getBanner = function getBanner(placement, campaignId, bannerId, uuid) {
    var log = logger.getLog();
    var url = this.__makeURL__('addyn', placement, {
        adid: campaignId,
        bnid: bannerId
    });

    log.trace('[%1] Getting single ADTECH banner: "%2."', uuid, url);

    return q(this.get(url)).then(ADTECHBannerClient.__parseBanner__);
};

/**
 * Fetches multiple banners from ADTECH using keywords.
 *
 * @method getBanners
 * @param {Number} amount Number of banners to get. It is possible for fewer banners to be returned.
 * @param {Number/String} placement ADTECH placement ID.
 * @param {String[]} sizes Banner sizes to fetch, e.g. "2x2".
 * @param {Object} keywords Map of keywords to send with request.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will be fulfilled with an Array of ADTECH banners containing:
 *     * placementId: ADTECH placement ID
 *     * campaignId: ADTECH campaign ID
 *     * externalId: Cinema6 card ID
 *     * clickUrl: ADTECH click tracking pixel
 *     * countUrl: ADTECH ad count tracking pixel
 */
ADTECHBannerClient.prototype.getBanners = function getBanners(
    amount,
    placement,
    sizes,
    keywords,
    uuid
) {
    var log = logger.getLog();

    if (amount < 1) { return q([]); }

    var url = this.__makeURL__('multiad', 0, extend(keywords, {
        mode: 'json',
        plcids: arrayOf(placement, amount).join(','),
        Allowedsizes: sizes.join(',')
    }));

    log.trace('[%1] Getting multiple (%2) ADTECH banners: "%3."', uuid, amount, url);

    return q(this.get(url, { json: true })).then(function parseBanners(response) {
        /* jshint camelcase:false */
        return response.ADTECH_MultiAd.map(function parseBanner(banner) {
            try {
                return ADTECHBannerClient.__parseBanner__(banner.Ad.AdCode);
            } catch(e) {
                return null;
            }
        }).filter(function(banner) { return !!banner; });
    }).tap(function(banners) {
        log.trace('[%1] Successfully got %2 banners.', uuid, banners.length);
    });
};

module.exports = ADTECHBannerClient;
