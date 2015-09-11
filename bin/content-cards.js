(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        querystring     = require('querystring'),
        path            = require('path'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        Status          = require('../lib/enums').Status,

        cardModule = { config: {} };

        
    cardModule.setupCardSvc = function(cardColl, caches, config) {
        cardModule.config.trackingPixel = config.trackingPixel;
    
        var opts = { allowPublic: true },
            cardSvc = new CrudSvc(cardColl, 'rc', opts);
        
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));
        
        cardSvc.getPublicCard = cardModule.getPublicCard.bind(cardModule, cardSvc, caches);
        
        return cardSvc;
    };
    
    // Format a tracking pixel link, pulling data from query params.
    cardModule.formatUrl = function(card, req, event) {
        req.query = req.query || {};
        
        // get experience id from path if request for experience; else from query param
        var expId = (/experience/.test(path.join(req.baseUrl, req.route.path)) && req.params.id) ||
                    req.query.experience || '';

        var qps = {
            campaign    : card.campaignId,
            card        : card.id,
            experience  : expId,
            container   : req.query.container,
            host        : req.query.pageUrl || req.originHost,
            hostApp     : req.query.hostApp,
            network     : req.query.network,
            event       : event
        };
        
        return cardModule.config.trackingPixel + '?' + querystring.stringify(qps) +
                                                       '&cb={cachebreaker}';
    };
    
    // Adds tracking pixels to card.campaign, initializing arrays if needed
    cardModule.setupTrackingPixels = function(card, req) {
        card.campaign = card.campaign || {};
        
        function ensureList(prop) {
            return card.campaign[prop] || (card.campaign[prop] = []);
        }
        
        ensureList('clickUrls').push(cardModule.formatUrl(card, req, 'click'));
        ensureList('loadUrls').push(cardModule.formatUrl(card, req, 'load'));
        ensureList('countUrls').push(cardModule.formatUrl(card, req, 'completedView'));
        ensureList('q1Urls').push(cardModule.formatUrl(card, req, 'q1'));
        ensureList('q2Urls').push(cardModule.formatUrl(card, req, 'q2'));
        ensureList('q3Urls').push(cardModule.formatUrl(card, req, 'q3'));
        ensureList('q4Urls').push(cardModule.formatUrl(card, req, 'q4'));
        
        if (typeof card.links !== 'object') {
            return;
        }
        
        Object.keys(card.links).forEach(function(linkName) {
            var origVal = card.links[linkName];

            if (typeof origVal === 'string') {
                card.links[linkName] = {
                    uri: origVal,
                    tracking: []
                };
            }
            
            card.links[linkName].tracking.push(cardModule.formatUrl(card, req, 'link.' + linkName));
        });
    };

    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, caches, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'];

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return caches.cards.getPromise({ id: id })
        .spread(function(card) {
            // only show active cards
            if (!card || card.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);
            
            privateFields.forEach(function(key) { delete card[key]; });
            card = cardSvc.formatOutput(card);
            cardModule.setupTrackingPixels(card, req);
            
            // fetch card's campaign so important props can be copied over
            return caches.campaigns.getPromise({ id: card.campaignId })
            .spread(function(camp) {
                // only show cards with active campaigns
                if (!camp || camp.status !== Status.Active) {
                    log.warn('[%1] Campaign %2 not found for card %3',
                             req.uuid, card.campaignId, card.id);
                    return q();
                }
                
                card.advertiserId = camp.advertiserId;
                
                var campEntry = (camp.cards || []).filter(function(cardObj) {
                    return cardObj.id === card.id;
                })[0] || {};

                card.advertiserId = camp.advertiserId;
                card.adtechId = campEntry.adtechId;
                card.bannerId = campEntry.bannerNumber;

                // don't show card without an adtechId
                if (!card.adtechId) {
                    log.warn('[%1] No adtechId for %2 in cards list of %3',
                             req.uuid, card.id, camp.id);
                    return q();
                }
                
                return card;
            });
        })
        .catch(function(error) {
            log.error('[%1] Error getting card %2: %3', req.uuid, id, error);
            return q.reject('Mongo error');
        });
    };
    
    // Handle requests for cards from /api/public/content/card/:id endpoints
    cardModule.handlePublicGet = function(req, res, cardSvc, config) {
        return cardSvc.getPublicCard(req.params.id, req)
        .then(function(card) {
            if (!req.originHost.match(/(portal|staging).cinema6.com/)) {
                res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
            }
            
            if (!card) {
                return q({ code: 404, body: 'Card not found' });
            }
            
            // if ext === 'js', return card as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(card) + ';' });
            } else {
                return q({ code: 200, body: card });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };


    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config, jobManager) {
        // Public get card; regex at end allows client to optionally specify extension (js|json)
        app.get('/api/public/content/card/:id([^.]+).?:ext?', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });


        // Setup router for non-public card endpoints
        var router      = express.Router(),
            mountPath   = '/api/content/cards?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetCard = authUtils.middlewarify({cards: 'read'});
        router.get('/:id', sessions, authGetCard, audit, function(req, res) {
            var promise = cardSvc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving card', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCard, audit, function(req, res) {
            var query = {};
            ['org', 'user', 'campaignId'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = cardSvc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving cards', detail: error });
                });
            });
        });

        var authPostCard = authUtils.middlewarify({cards: 'create'});
        router.post('/', sessions, authPostCard, audit, function(req, res) {
            var promise = cardSvc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating card', detail: error });
                });
            });
        });

        var authPutCard = authUtils.middlewarify({cards: 'edit'});
        router.put('/:id', sessions, authPutCard, audit, function(req, res) {
            var promise = cardSvc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating card', detail: error });
                });
            });
        });

        var authDelCard = authUtils.middlewarify({cards: 'delete'});
        router.delete('/:id', sessions, authDelCard, audit, function(req, res) {
            var promise = cardSvc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting card', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = cardModule;
}());
