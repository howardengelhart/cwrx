(function(){
    'use strict';

    var q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        QueryCache      = require('../lib/queryCache'),
        FieldValidator  = require('../lib/fieldValidator'),
        CrudSvc         = require('../lib/crudSvc'),
        Status          = require('../lib/enums').Status,

        cardModule = {};

        
    cardModule.setupCardSvc = function(cardColl) {
        var cardSvc = new CrudSvc(cardColl, 'rc', {allowPublic: true});
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.createValidator._condForbidden.user = FieldValidator.userFunc('cards', 'create');
        cardSvc.createValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'create');
        cardSvc.editValidator._condForbidden.user = FieldValidator.userFunc('cards', 'edit');
        cardSvc.editValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'edit');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));
        
        return cardSvc;
    };

    // Handle request from public endpoint for card, using internal cache
    cardModule.getPublicCard = function(req, cardCache, cardSvc) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'],
            id = req.params.id,
            query = {id: id};

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return cardCache.getPromise(query).then(function(results) {
            if (!results[0] || results[0].status !== Status.Active) { // only show active cards
                return q({code: 404, body: 'Card not found'});
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);

            privateFields.forEach(function(key) { delete results[0][key]; });

            return q({ code: 200, body: cardSvc.formatOutput(results[0]) });
        })
        .catch(function(error) {
            log.error('[%1] Error getting cards: %2', req.uuid, error);
            return q.reject('Mongo error');
        });
    };

    
    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config) {
        var cardTTLs = config.cacheTTLs.cards,
            cardCache = new QueryCache(cardTTLs.freshTTL, cardTTLs.maxTTL, cardSvc._coll);

        // Used for handling public requests for cards by id methods:
        function handlePublicGet(req, res) {
            return cardModule.getPublicCard(req, cardCache, cardSvc)
            .then(function(resp) {
                if (!req.originHost.match(/(portal|staging).cinema6.com/)) {
                    res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
                }
                return q(resp);
            }).catch(function(error) {
                res.header('cache-control', 'max-age=60');
                return q({code: 500, body: { error: 'Error retrieving content', detail: error }});
            });
        }

        // Retrieve a json representation of a card
        app.get('/api/public/content/card/:id.json', function(req, res) {
            handlePublicGet(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        // Retrieve a CommonJS style representation of a card
        app.get('/api/public/content/card/:id.js', function(req, res) {
            handlePublicGet(req, res).then(function(resp) {
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
            handlePublicGet(req, res).then(function(resp) {
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
