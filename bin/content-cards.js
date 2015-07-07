(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        Status          = require('../lib/enums').Status,

        cardModule = {};

        
    cardModule.setupCardSvc = function(cardColl, cardCache) {
        var opts = { allowPublic: true },
            cardSvc = new CrudSvc(cardColl, 'rc', opts);
        
        cardSvc._cardCache = cardCache;
            
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));
        
        cardSvc.getPublicCard = cardModule.getPublicCard.bind(cardModule, cardSvc);
        
        return cardSvc;
    };

    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'],
            query = {id: id};

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return cardSvc._cardCache.getPromise(query).then(function(results) {
            if (!results[0] || results[0].status !== Status.Active) { // only show active cards
                return q();
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);

            privateFields.forEach(function(key) { delete results[0][key]; });

            return q(cardSvc.formatOutput(results[0]));
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
