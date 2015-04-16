(function(){
    'use strict';

    var q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        FieldValidator  = require('../lib/fieldValidator'),
        CrudSvc         = require('../lib/crudSvc'),
        Status          = require('../lib/enums').Status,
        cache           = require('../lib/cache'),

        cardModule = {};

        
    cardModule.setupCardSvc = function(cardColl, cache) {
        // var cardSvc = new CrudSvc(cardColl, 'rc', {allowPublic: true}); //TODO
        var cardSvc = new CrudSvc(cardColl, 'rc', {
            allowPublic: true,
            reqTimeout: 2000,
            reqCacheTTL: 20*1000
        });
        
        cardSvc._cache = cache; //TODO: this might be confusingly named now...
            
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.createValidator._condForbidden.user = FieldValidator.userFunc('cards', 'create');
        cardSvc.createValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'create');
        cardSvc.editValidator._condForbidden.user = FieldValidator.userFunc('cards', 'edit');
        cardSvc.editValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'edit');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));

        cardSvc.use('read', function delay(req, next, done) { //TODO
            var log = logger.getLog(),
                deferred = q.defer();

            if (req.query.delay) {
                log.info('[%1] delaying...', req.uuid);
                setTimeout(function() {
                    log.info('[%1] proceeding...', req.uuid);
                    deferred.resolve();
                }, cardSvc.reqTimeout + 10*1000);
            } else {
                return q(next());
            }
            
            return deferred.promise.then(function() {
                next();
                // done({code: 400, body: 'I HATE YOU'});
                //throw new Error('I GOT A PROBLEM CROSBY');
            });
        });
        
        cardSvc.getPublicCard = cardModule.getPublicCard.bind(cardModule, cardSvc);
        
        return cardSvc;
    };

    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'],
            query = {id: id};

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return cardSvc._cache.getPromise(query).then(function(results) {
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
            return card ? q({ code: 200, body: card }) : q({ code: 404, body: 'Card not found' });
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };

    //TODO: ???? PERMISSIONS ON THE GET RESULT ENDPOINT ????
    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config) {
        app.get('/api/content/result/:reqId', function(req, res) { //TODO
            cache.get('req:' + req.params.reqId).then(function(resp) {
                if (!resp) {
                    res.send(404, 'No job with that id found');
                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving status', detail: error });
            });
        });

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
            cardSvc.getObjs({id: req.params.id}, req, res, false).then(function(resp) {
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

            cardSvc.getObjs(query, req, res, true).then(function(resp) {
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
