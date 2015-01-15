(function(){
    'use strict';

    var authUtils       = require('../lib/authUtils'),
        FieldValidator  = require('../lib/fieldValidator'),
        CrudSvc         = require('../lib/crudSvc'),

        cardModule = {};

        
    cardModule.setupCardSvc = function(cardColl) {
        var cardSvc = new CrudSvc(cardColl, 'rc', {allowPublic: true});
        cardSvc.createValidator._required.push('campaignId');
        cardSvc.createValidator._condForbidden.user = FieldValidator.userFunc('cards', 'create');
        cardSvc.createValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'create');
        cardSvc.editValidator._condForbidden.user = FieldValidator.userFunc('cards', 'edit');
        cardSvc.editValidator._condForbidden.org = FieldValidator.orgFunc('cards', 'edit');
        cardSvc.use('read', cardSvc.preventGetAll.bind(cardSvc));
        //TODO: implement public card endpoint
        
        return cardSvc;
    };
    
    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit) {
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
