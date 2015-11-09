/* jshint latedef:nofunc */

var ADTECHBannerClient = require('./adtechBannerClient');
var FunctionCache = require('./functionCache');
var q = require('q');
var request = require('request-promise');
var resolveURL = require('url').resolve;
var logger = require('./logger');
var inspect = require('util').inspect;
var clonePromise = require('./promise').clone;
var push = Array.prototype.push;

var CARD_BANNER_SIZE = '2x2';

function isPlaceholder(card) {
    return card.type === 'wildcard';
}

function isSponsored(card) {
    return typeof card.campaignId === 'string';
}

function addBannerData(banner, card) {
    return AdLoader.addTrackingPixels({
        playUrls: [banner.clickUrl],
        countUrls: [banner.countUrl]
    }, card);
}

function removeCard(experience, cardToRemove) {
    experience.data.deck = experience.data.deck.filter(function(card) {
        return card.id !== cardToRemove.id;
    });
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
 * @param {String} [config.server=adserver.adtechus.com] Host of ADTECH server.
 * @param {String} [config.network=5473.1] ADTECH network to use.
 * @param {Number} [config.maxSockets=250] The number of concurrent connections to ADTECH to keep
 *     open.
 * @param {Number} [config.timeout=3000] Number of MS to keep a connection to ADTECH open before
 *     aborting.
 * @param {String} [config.envRoot=http://localhost/] Root URL of Cinema6 API services.
 * @param {String} [config.cardEndpoint=/api/public/content/card/] Base URL of Cinema6 card
 *     endpoint.
 */
function AdLoader(/*config*/) {
    var config = arguments[0] || {};
    var cacheTTLs = config.cardCacheTTLs || {};
    var cache = new FunctionCache({
        freshTTL: cacheTTLs.fresh || 1,
        maxTTL: cacheTTLs.max || 4,
        extractor: clonePromise
    });

    this.client = new ADTECHBannerClient(config);
    this.envRoot = config.envRoot || 'http://localhost/';
    this.cardEndpoint = config.cardEndpoint || '/api/public/content/card/';

    // Memoize AdLoader.prototype.__getCard__() method.
    this.__getCard__ = cache.add(this.__getCard__.bind(this), 2);
}

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
        push.apply(campaign[type] || (campaign[type] = []), pixels[type]);
    });

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
        return isPlaceholder(card) || isSponsored(card);
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
    return experience.data.deck.filter(isSponsored);
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
        return !isSponsored(card);
    });

    return experience;
};

AdLoader.prototype.__getCard__ = function __getCard__(id, params, uuid) {
    var log = logger.getLog();
    var url = resolveURL(resolveURL(this.envRoot, this.cardEndpoint), id);

    log.trace('[%1] GETting card from endpoint {%2} with params: %3.', uuid, url, inspect(params));

    return q(request.get(url, { json: true, qs: params }));
};

/**
 * Decorates a Cinema6 Card with ADTECH data (tracking pixels, etc.)
 *
 * @method decorateWithCampaign
 * @param {Object} card Cinema6 card.
 * @param {Number/String} placement ADTECH placement.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will be fulfilled with the specified card after it has been
 *     decorated.
 */
AdLoader.prototype.decorateWithCampaign = function decorateWithCampaign(card, placement, uuid) {
    var log = logger.getLog();
    var campaignId = card.adtechId;
    var bannerId = card.bannerId;

    if (!campaignId) {
        log.warn('[%1] Card {%2} has no adtechId!', uuid, card.id);
        return q.reject(new Error('Card [' + card.id + '] has no adtechId.'));
    }

    log.trace(
        '[%1] Getting banner {%2} of campaign {%3} from ADTECH for card {%4}.',
        uuid, bannerId, campaignId, card.id
    );

    return this.client.getBanner(placement, campaignId, bannerId, uuid)
        .then(function addTrackingPixels(banner) {
            return addBannerData(banner, card);
        }).tap(function(card) {
            log.trace(
                '[%1] Succesfully decorated card {%2} with data from ADTECH banner {%3}.',
                uuid, card.id, bannerId
            );
        });
};

/**
 * Replaces placeholder cards in a MiniReel with Cinema6 sponsored cards by looking them up in
 * ADTECH. If, after calling ADTECH, there are still placeholders left in the MiniReel, they will be
 * removed.
 *
 * @method fillPlaceholders
 * @param {Object} experience Cinema6 MiniReel experience.
 * @param {String[]} categories Array of ADTECH categories to look in.
 * @param {String} [campaign] Cinema6 campaign ID.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will fulfill with the specified experience after its placeholders
 *     have been filled.
 */
AdLoader.prototype.fillPlaceholders = function fillPlaceholders(
    experience,
    categories,
    campaign,
    uuid
) {
    var self = this;
    var log = logger.getLog();
    var placement = experience.data.wildCardPlacement;
    var placeholders = AdLoader.getPlaceholders(experience);
    var experienceCardIds = experience.data.deck.map(function(card) { return card.id; });
    var experienceParams = experience.$params;
    var preview = experienceParams.preview;

    function getCard() {
        // If in preview mode, call the uncached version of __getCard__().
        var method = preview ? AdLoader.prototype.__getCard__ : self.__getCard__;

        return method.apply(self, arguments);
    }

    log.trace(
        '[%1] Attempting to fill %2 placeholders in experience {%3}' +
            ' with categories {%4} and campaign {%5}.',
        uuid, placeholders.length, experience.id, inspect(categories), campaign
    );

    return this.client.findBanners(placeholders.length, placement, [CARD_BANNER_SIZE], {
        kwlp1: campaign,
        kwlp3: categories.slice(0, 4).join('+')
    }, uuid).then(function getCards(banners) {
        var bannerCardIds = banners.map(function(banner) { return banner.externalId; });
        var usefulBanners = banners.filter(function(banner, index) {
            return bannerCardIds.indexOf(banner.externalId) === index &&
                experienceCardIds.indexOf(banner.externalId) < 0;
        });

        log.trace('[%1] Got %2 banners that are usable.', uuid, usefulBanners.length);

        return q.all(usefulBanners.map(function fetchCard(banner) {
            var id = banner.externalId;
            var params = {
                container: experienceParams.container,
                hostApp: experienceParams.hostApp,
                network: experienceParams.network,
                pageUrl: experienceParams.pageUrl,
                experience: experience.id,
                preview: experienceParams.preview
            };

            log.trace('[%1] Getting card {%2} with params: %3.', uuid, id, inspect(params));

            return getCard(id, params, uuid).then(function addTrackingPixels(card) {
                return addBannerData(banner, card);
            });
        })).then(function replaceWildcards(cards) {
            experience.data.deck = experience.data.deck.map(function replaceWildcard(card) {
                return isPlaceholder(card) ? (cards.shift() || card) : card;
            });

            log.trace('[%1] Replaced placeholders with sponsored cards.', uuid);

            return AdLoader.removePlaceholders(experience);
        });
    });
};

/**
 * Loads ads for a MiniReel experience by replacing its placeholder cards with sponsored cards
 * and decorating its statically-mapped cards with ADTECH banner data.
 *
 * @method loadAds
 * @param {Object} experience Cinema6 MiniReel experience.
 * @param {String[]} [categories=experience.categories] ADTECH categories to look in. If not
 *     specified, MiniReel's categories will be used.
 * @param {String} [campaignId] Cinema6 campaign ID.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} Promise that will be fulfilled with the specified experience after its ads have
 *     been loaded.
 */
AdLoader.prototype.loadAds = function loadAds(experience, _categories_, campaignId, uuid) {
    var removeSponsoredCards = AdLoader.removeSponsoredCards;
    var removePlaceholders = AdLoader.removePlaceholders;
    var self = this;
    var log = logger.getLog();
    var sponsoredCards = AdLoader.getSponsoredCards(experience);
    var placement = experience.data.wildCardPlacement;
    var categories = _categories_ || experience.categories || [];

    if (!AdLoader.hasAds(experience)) {
        log.trace('[%1] Experience {%2} has no ads. Skipping ad load.', uuid, experience.id);
        return q(experience);
    }

    if (!placement) {
        log.trace('[%1] Experience {%2} has no wildCardPlacement. Aborting.', uuid, experience.id);
        return q(removeSponsoredCards(removePlaceholders(experience)));
    }

    log.trace(
        '[%1] Loading ads for experience {%2} from campaign {%3}. ' +
            'Experience has %4 sponsored cards.',
        uuid, experience.id, campaignId, sponsoredCards.length
    );

    return q.all([
        q.all(sponsoredCards.map(function decorateWithCampaign(card) {
            log.trace('[%1] Attempting to get ADTECH banner for card {%2}.', uuid, card.id);
            return self.decorateWithCampaign(card, placement, uuid).catch(function trimCard() {
                log.trace(
                    '[%1] Failed to get ADTECH banner for card {%2}. Trimming.',
                    uuid, card.id
                );
                return removeCard(experience, card);
            });
        })).tap(function(cards) {
            log.trace('[%1] Successfully got ADTECH banners for %2 cards.', uuid, cards.length);
        }),
        this.fillPlaceholders(experience, categories, campaignId, uuid)
    ]).thenResolve(experience).tap(function(experience) {
        log.trace('[%1] Successfully loaded ads for experience {%2}.', uuid, experience.id);
    });
};

/**
 * Finds a sponsored card via campaign ID/keywords.
 *
 * @method findCard
 * @param {Object} params Parameters used to find a card.
 * @param {String} params.placement ADTECH placement id.
 * @param {String} [params.campaign] ID of Cinema6 campaign to look in.
 * @param {String[]} [params.categories] Array of categories to look in. Will only use the first
 *     four specified.
 * @param {Object} [context] Parameters to send to the content service when fetching the card.
 * @return {Promise} A Promise that will be fulfilled with the found card (or null if no card is
 *     found.)
 */
AdLoader.prototype.findCard = function findCard(params, context, uuid) {
    var self = this;
    var log = logger.getLog();
    var placement = params.placement;
    var campaign = params.campaign;
    var categories = params.categories || [];

    log.trace(
        '[%1] Finding card with params (%2) and context (%3).',
        uuid, inspect(params), inspect(context)
    );

    return this.client.findBanner(placement, CARD_BANNER_SIZE, {
        kwlp1: campaign,
        kwlp3: categories.slice(0, 4).join('+')
    }, uuid).then(function getCard(banner) {
        if (!banner) {
            log.trace('[%1] No banner was found.', uuid);
            return null;
        }

        log.trace(
            '[%1] Fetching card {%2} with params: %3.',
            uuid, banner.externalId, inspect(context)
        );
        return self.__getCard__(banner.externalId, context, uuid).then(function decorate(card) {
            return addBannerData(banner, card);
        });
    });
};

/**
 * Gets a sponsored card by ID.
 *
 * @method getCard
 * @param {String} id The id of the sponsored card.
 * @param {String} placement An ADTECH placement ID for the card.
 * @param {Object} [params] Parameters to send to the content service when fetching the card.
 * @param {String} [uuid] Contextual UUID (used for logging)
 * @return {Promise} A Promise that will be fulfilled with the card.
 */
AdLoader.prototype.getCard = function getCard(id, placement, params, uuid) {
    var self = this;
    var log = logger.getLog();
    var preview = params.preview;

    log.trace(
        '[%1] Getting card {%2} with placement {%3} and params: %4.',
        uuid, id, placement, inspect(params)
    );

    return this.__getCard__(id, params, uuid).then(function decorateWithCampaign(card) {
        if (preview) { return card; }

        return self.decorateWithCampaign(card, placement, uuid).catch(function fail() {
            throw new Error('Card not found in the specified placement.');
        });
    });
};

module.exports = AdLoader;
