(function(){
    'use strict';

    var q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        FieldValidator  = require('../lib/fieldValidator'),
        CrudSvc         = require('../lib/crudSvc'),
        Status          = require('../lib/enums').Status,

        cardModule = { config: {} };

        
    cardModule.setupCardSvc = function(cardColl, config, caches) {
        cardModule.config.clickCommands = config.clickCommands;

        var cardSvc = new CrudSvc(cardColl, 'rc', {allowPublic: true});
        cardSvc._caches = caches;
            
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.createValidator._condForbidden.user = FieldValidator.userFunc('cards', 'create');
        cardSvc.createValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'create');
        cardSvc.editValidator._condForbidden.user = FieldValidator.userFunc('cards', 'edit');
        cardSvc.editValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'edit');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));
        
        cardSvc.getPublicCard = cardModule.getPublicCard.bind(cardModule, cardSvc);
        
        return cardSvc;
    };
    
    cardModule.createAdtechLink = function(linkObj, campId, placementId) {
        return 'http://adserver.adtechus.com/?adlink|3.0|' +
               cardModule.config.clickCommands.adServerId + '|' +
               placementId + '|1|16|' + 
               'AdId=' + campId +
               ';BnId=' + linkObj.bannerNumber +
               ';link=' + linkObj.targetLink;
    };
    
    // look up a campaign, 
    cardModule.substituteLinks = function(cardSvc, card, req) {
        var log = logger.getLog();
        
        if (!card.campaignId) {
            log.warn('[%1] No campaignId on card %2', req.uuid, card.id);
            return q(card);
        }
        
        return cardSvc._caches.campaigns.getPromise({id: card.campaignId}).then(function(results) {
            var camp = results && results[0] || null;
            if (!camp || camp.status !== Status.Active) { // only show active camps
                log.warn('[%1] Campaign %2 not found for card %3',req.uuid,card.campaignId,card.id);
                return q(card);
            }
            if (!camp.clickCommands || !camp.clickCommands[card.id]) {
                log.trace('[%1] Campaign has no clickCommands for card %2', req.uuid, card.id);
                return q(card);
            }

            var clickCamp = camp.clickCommands[card.id];
            
            (clickCamp.links || []).forEach(function(linkObj) {
                if (!linkObj.slideLink) {
                    if (!card.links || !card.links[linkObj.description]) {
                        log.warn('[%1] No link for %2 on card %3',
                                 req.uuid, linkObj.description, card.id);
                        return;
                    }
                    
                    card.links[linkObj.description] = cardModule.createAdtechLink(
                        linkObj,
                        clickCamp.adtechId,
                        camp.clickPlacementId
                    );
                }
                else {
                    if (!card.data || !card.data.slides) {
                        log.warn('[%1] No slides in card %2 for slide link %3',
                                 req.uuid, card.id, linkObj.id);
                        return;
                    }
                    
                    card.data.slides.forEach(function(slide) {
                        if (!slide.data || slide.data.url !== linkObj.targetLink) {
                            return;
                        }
                        
                        slide.url = cardModule.createAdtechLink(
                            linkObj,
                            clickCamp.adtechId,
                            camp.clickPlacementId
                        );
                    });
                }
            });
            
            return q(card);
        })
        .catch(function(error) {
            log.error('[%1] Error getting campaign %2: %3', req.uuid, card.campaignId, error && error.stack || error    );
            return q(card);
        });
    };

    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'],
            query = {id: id};

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return cardSvc._caches.cards.getPromise(query).then(function(results) {
            if (!results[0] || results[0].status !== Status.Active) { // only show active cards
                return q();
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);

            privateFields.forEach(function(key) { delete results[0][key]; });

            return cardModule.substituteLinks(cardSvc, cardSvc.formatOutput(results[0]), req);
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
            return card ? q({ code: 200, body: card }) : q({ code: 404, body: 'Card not found' });
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };

    
    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config) {
        // Retrieve a json representation of a card
        app.get('/api/public/content/card/:id.json', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        // Retrieve a CommonJS style representation of a card
        app.get('/api/public/content/card/:id.js', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                if (resp.code < 200 || resp.code >= 300) {
                    res.send(resp.code, resp.body);
                } else {
                    res.header('content-type', 'application/javascript');
                    res.send(resp.code, 'module.exports = ' + JSON.stringify(resp.body) + ';');
                }
            });
        });

        // Default for retrieving a card, which returns JSON
        app.get('/api/public/content/card/:id', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });


        var authGetCard = authUtils.middlewarify({cards: 'read'});
        app.get('/api/content/card/:id', sessions, authGetCard, audit, function(req, res) {
            cardSvc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving card', detail: error });
            });
        });

        app.get('/api/content/cards', sessions, authGetCard, audit, function(req, res) {
            var query = {};
            ['org', 'user', 'campaignId'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            cardSvc.getObjs(query, req, true).then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving cards', detail: error });
            });
        });

        var authPostCard = authUtils.middlewarify({cards: 'create'});
        app.post('/api/content/card', sessions, authPostCard, audit, function(req, res) {
            cardSvc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating card', detail: error });
            });
        });

        var authPutCard = authUtils.middlewarify({cards: 'edit'});
        app.put('/api/content/card/:id', sessions, authPutCard, audit, function(req, res) {
            cardSvc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating card', detail: error });
            });
        });

        var authDelCard = authUtils.middlewarify({cards: 'delete'});
        app.delete('/api/content/card/:id', sessions, authDelCard, audit, function(req, res) {
            cardSvc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting card', detail: error });
            });
        });
    };
    
    module.exports = cardModule;
}());
