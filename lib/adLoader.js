/* jshint latedef:nofunc */

var FunctionCache = require('./functionCache');
var q = require('q');
var request = require('request-promise');
var resolveURL = require('url').resolve;
var parseURL = require('url').parse;
var querystring = require('querystring');
var logger = require('./logger');
var inspect = require('util').inspect;
var clonePromise = require('./promise').clone;
var push = Array.prototype.push;
var extend = require('./objUtils').extend;

function isPlaceholder(card) {
    return card.type === 'wildcard';
}

function addClickTracking(card, prop, urls) {
    Object.keys(card[prop] || (card[prop] = {})).forEach(function(type) {
        push.apply(card[prop][type].tracking, urls);
    });
}

function onRequestFail(callback) {
    return function checkForFailure(reason) {
        if (reason.statusCode >= 500 || !reason.statusCode) {
            callback(reason);
        }

        throw reason;
    };
}

/**
 * Library to load sponsored content into a MiniReel by replacing placeholder cards with content
 * from ADTECH and to decorate static sponsored cards with data from ADTECH banners.
 *
 * @class AdLoader
 * @constructor
 * @param {Object} [config] Configuration options.
 * @param {Object} [config.cardCacheTTLs] Cache configuration for sponsored cards.
 * @param {Number} [config.cardCacheTTLs.fresh=1] Number of seconds to wait before refreshing
 *     sponsored card cache entry.
 * @param {Number} [config.cardCacheTTLs.max=4] Number of seconds to wait before forcing a refresh
 *     of a sponsored card cache entry.
 * @param {String} [config.envRoot=http://localhost/] Root URL of Cinema6 API services.
 * @param {String} [config.cardEndpoint=/api/public/content/card/] Base URL of Cinema6 card
 *     endpoint.
 * @param {String} [config.trackingPixel=null] URL of a tracking pixel to add to all sponsored
 *     cards. If unspecified, no tracking pixels will be added.
 */
function AdLoader(/*config*/) {
    var config = arguments[0] || {};
    var cacheTTLs = config.cardCacheTTLs || {};
    var cache = new FunctionCache({
        freshTTL: cacheTTLs.fresh || 1,
        maxTTL: cacheTTLs.max || 4,
        extractor: clonePromise
    });

    this.envRoot = config.envRoot || 'http://localhost/';
    this.cardEndpoint = config.cardEndpoint || '/api/public/content/cards/';
    this.trackingPixel = config.trackingPixel || null;

    // Memoize AdLoader.prototype.__getCard__() method.
    this.__getCard__ = cache.add(this.__getCard__.bind(this), 2);
}

/** Returns a `Boolean` indicating if the card is sponsored or not.
 * @method isSponsored
 * @static
 * @param {Object} card A Reelcontent card
 * @return {Boolean} If the card is sponsored or not
 */
AdLoader.isSponsored = function isSponsored(card) {
    return typeof card.campaignId === 'string';
};

/**
 * Add tracking pixels to a sponsored card. If the specified card has no campaign object, it will be
 * created.
 *
 * @method addTrackingPixels
 * @static
 * @param {Object} pixels Pixels to add. The key should be the name of the pixels (playUrls,
 *     countUrls, etc.) and the value should be an Array of URLs.
 * @param {Object} card The Cinema6 card.
 * @return {Object} The specified card.
 */
AdLoader.addTrackingPixels = function addTrackingPixels(pixels, card) {
    var campaign = card.campaign || (card.campaign = {});

    Object.keys(pixels).forEach(function(type) {
        if (type === 'clickUrls') { return; }
        push.apply(campaign[type] || (campaign[type] = []), pixels[type]);
    });

    addClickTracking(card, 'links', pixels.clickUrls);
    addClickTracking(card, 'shareLinks', pixels.clickUrls);

    return card;
};

/** Function to check if an experience has any ads (sponsored cards or placeholders.)
 *
 * @method hasAds
 * @static
 * @param {Object} experience Cinema6 MiniReel experience.
 * @return {Boolean} `true` if the experience has a sponsored card or placeholder, `false` if it
 *     does not.
 */
AdLoader.hasAds = function hasAds(experience) {
    return experience.data.deck.some(function(card) {
        return isPlaceholder(card) || AdLoader.isSponsored(card);
    });
};

/**
 * Get all the placeholder cards in a MiniReel.
 *
 * @method getPlaceholders
 * @static
 * @param {Object} experience Cinema6 MiniReel experience.
 * @return {Array} Placeholder cards.
 */
AdLoader.getPlaceholders = function getPlaceholders(experience) {
    return experience.data.deck.filter(isPlaceholder);
};

/**
 * Get all the sponsored cards in a MiniReel.
 *
 * @method getSponsoredCards
 * @static
 * @param {Object} experience Cinema6 MiniReel experience.
 * @return {Array} Sponsored cards.
 */
AdLoader.getSponsoredCards = function getSponsoredCards(experience) {
    return experience.data.deck.filter(AdLoader.isSponsored);
};

/**
 * Replaces the MiniReel's deck with a new one containing no placeholder cards.
 *
 * @method removePlaceholders
 * @static
 * @param {Object} experience Cinema6 MiniReel experience.
 * @return {Object} The specified experience.
 */
AdLoader.removePlaceholders = function removePlaceholders(experience) {
    experience.data.deck = experience.data.deck.filter(function isNotPlaceholder(card) {
        return !isPlaceholder(card);
    });

    return experience;
};

/**
 * Replaces the MiniReel's deck with a new one containing no sponsored cards.
 *
 * @method removeSponsoredCards
 * @static
 * @param {Object} experience Cinema6 MiniReel experience.
 * @return {Object} The specified experience.
 */
AdLoader.removeSponsoredCards = function removeSponsoredCards(experience) {
    experience.data.deck = experience.data.deck.filter(function isNotSponsored(card) {
        return !AdLoader.isSponsored(card);
    });

    return experience;
};

AdLoader.prototype.__addTrackingPixels__ = function __addTrackingPixels__(card, meta) {
    var trackingPixel = this.trackingPixel;
    var campaign = card.campaign || (card.campaign = {});
    var getPixelUrl = this.pixelFactory(card, meta);

    function addPixels(prop, event) {
        (campaign[prop] || (campaign[prop] = [])).push(getPixelUrl(event));
    }

    if (meta.preview || !trackingPixel) { return card; }

    addPixels('bufferUrls', 'buffer');
    addPixels('viewUrls', 'cardView');
    addPixels('playUrls', 'play');
    addPixels('loadUrls', 'load');
    addPixels('launchUrls', 'launch');
    addPixels('countUrls', 'completedView');
    addPixels('q1Urls', 'q1');
    addPixels('q2Urls', 'q2');
    addPixels('q3Urls', 'q3');
    addPixels('q4Urls', 'q4');

    Object.keys(card.links || (card.links = {})).forEach(function(type) {
        card.links[type].tracking.push(getPixelUrl('link.' + type));
    });
    Object.keys(card.shareLinks || (card.shareLinks = {})).forEach(function(type) {
        card.shareLinks[type].tracking.push(getPixelUrl('shareLink.' + type));
    });

    return card;
};

AdLoader.prototype.__getCard__ = function __getCard__(id, params, origin, uuid) {
    var log = logger.getLog();
    var url = resolveURL(resolveURL(this.envRoot, this.cardEndpoint), id);

    log.trace('[%1] GETting card from endpoint {%2} with params: %3.', uuid, url, inspect(params));

    return q(request.get(url, { json: true, qs: params, headers: { origin: origin } }))
        .catch(onRequestFail(function logError(reason) {
            log.error(
                '[%1] Failed to GET card from {%2} with params (%3): %4',
                uuid, url, inspect(params), inspect(reason)
            );
        }));
};

AdLoader.prototype.__findCards__ = function __findCards__(campaign, params, amount, origin, uuid) {
    var log = logger.getLog();
    var url = resolveURL(this.envRoot, this.cardEndpoint);
    var qs = extend({ campaign: campaign, limit: amount, random: true }, params);

    if (amount < 1) { return q([]); }

    log.trace('[%1] GETting cards from endpoint {%2} with params: %3.', uuid, url, inspect(qs));

    return q(request.get(url, { qs: qs, json: true, headers: { origin: origin } }))
        .catch(onRequestFail(function logError(reason) {
            log.error(
                '[%1] Failed to GET cards from {%2} with params (%3): %4',
                uuid, url, inspect(qs), inspect(reason)
            );
        }));
};

AdLoader.prototype.pixelFactory = function pixelFactory(card, meta) {
    var self = this;
    var base = this.trackingPixel + '?' + querystring.stringify({
        campaign: card.campaignId,
        card: card.id,
        experience: meta.experience,
        container: meta.container,
        placement: meta.placement,
        host: parseURL(meta.origin || '').host,
        hostApp: meta.hostApp,
        network: meta.network,
        sessionId: meta.reqUuid,
        extSessionId: meta.uuid,
        branding: meta.branding,
        ex: meta.ex,
        vr: meta.vr
    });

    return function getPixel(event) {
        return self.trackingPixel && (base + '&event=' + event + '&d={delay}&cb={cachebreaker}');
    };
};

/**
 * Replaces placeholder cards in a MiniReel with Cinema6 sponsored cards by looking them up with
 * the content service. If, after calling the content service, there are still placeholders left
 * in the MiniReel, they will be removed.
 *
 * @method fillPlaceholders
 * @param {Object} experience Cinema6 MiniReel experience.
 * @param {String} campaign Cinema6 campaign ID.
 * @param {Object} meta Metadata associated with the ad request.
 * @param {String} [meta.origin] Origin of the page that the ads will be loaded on.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will fulfill with the specified experience after its placeholders
 *     have been filled.
 */
AdLoader.prototype.fillPlaceholders = function fillPlaceholders(
    experience,
    campaign,
    meta,
    uuid
) {
    var log = logger.getLog();
    var placeholders = AdLoader.getPlaceholders(experience);
    var cardIds = experience.data.deck.map(function(card) { return card.id; });

    log.trace(
        '[%1] Attempting to fill %2 placeholders in experience {%3} with campaign {%4}.',
        uuid, placeholders.length, experience.id, campaign
    );

    return this.__findCards__(
        campaign, {}, placeholders.length, meta.origin, uuid
    ).then(function replaceWildcards(/*cards*/) {
        var cards = arguments[0].filter(function(card) { return cardIds.indexOf(card.id) < 0; });

        experience.data.deck = experience.data.deck.map(function replaceWildcard(card) {
            return isPlaceholder(card) ? (cards.shift() || card) : card;
        });

        log.trace('[%1] Replaced placeholders with sponsored cards.', uuid);

        return AdLoader.removePlaceholders(experience);
    });
};

/**
 * Loads ads for a MiniReel experience by replacing its placeholder cards with sponsored cards.
 *
 * @method loadAds
 * @param {Object} experience Cinema6 MiniReel experience.
 * @param {String} campaign Cinema6 campaign ID.
 * @param {Object} meta Metadata associated with the ad request.
 * @param {String} [meta.origin] Origin of the page that the ads will be loaded on.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will be fulfilled with the specified experience after its ads have
 *     been loaded.
 */
AdLoader.prototype.loadAds = function loadAds(experience, campaign, meta, uuid) {
    var self = this;
    var log = logger.getLog();
    var pixelData = extend({ experience: experience.id }, meta);

    if (!AdLoader.hasAds(experience)) {
        log.trace('[%1] Experience {%2} has no ads. Skipping ad load.', uuid, experience.id);
        return q(experience);
    }

    log.trace(
        '[%1] Loading ads for experience {%2} from campaign {%3}.',
        uuid, experience.id, campaign
    );

    return this.fillPlaceholders(
        experience, campaign, meta, uuid
    ).then(function addTrackingPixels(experience) {
        AdLoader.getSponsoredCards(experience).forEach(function(card) {
            return self.__addTrackingPixels__(card, pixelData);
        });

        log.trace('[%1] Successfully loaded ads for experience {%2}.', uuid, experience.id);

        return experience;
    });
};

/**
 * Finds a sponsored card via campaign ID/keywords.
 *
 * @method findCard
 * @param {String} campaign Reelcontent campaign id.
 * @param {Object} [context] Parameters to send to the content service when fetching the card.
 * @param {Object} meta Metadata associated with the ad request.
 * @param {String} [meta.origin] Origin of the page that the ads will be loaded on.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} A Promise that will be fulfilled with the found card (or null if no card is
 *     found.)
 */
AdLoader.prototype.findCard = function findCard(campaign, context, meta, uuid) {
    var self = this;
    var log = logger.getLog();

    log.trace(
        '[%1] Finding card with campaign (%2) and context (%3).',
        uuid, campaign, inspect(context)
    );

    return this.__findCards__(campaign, context, 1, meta.origin, uuid).then(function getAd(cards) {
        var card = cards[0];

        if (!card) { return null; }

        log.trace('[%1] Got card {%2}.', uuid, card.id);
        return self.__addTrackingPixels__(card, meta);
    });
};

/**
 * Gets a sponsored card by ID.
 *
 * @method getCard
 * @param {String} id The id of the sponsored card.
 * @param {Object} [params] Parameters to send to the content service when fetching the card.
 * @param {Object} meta Metadata associated with the ad request.
 * @param {String} [meta.origin] Origin of the page that the ads will be loaded on.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} A Promise that will be fulfilled with the card.
 */
AdLoader.prototype.getCard = function getCard(id, params, meta, uuid) {
    var self = this;
    var log = logger.getLog();
    var method = !params.preview ? this.__getCard__ : AdLoader.prototype.__getCard__;

    log.trace('[%1] Getting card {%2} with params: %4.', uuid, id, inspect(params));

    return method.call(this, id, params, meta.origin, uuid).then(function addTrackingPixels(card) {
        return self.__addTrackingPixels__(card, meta);
    }).tap(function(card) {
        log.trace('[%1] Got card {%2}.', uuid, card.id);
    });
};

module.exports = AdLoader;
