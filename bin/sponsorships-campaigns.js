(function(){
    'use strict';

    var q               = require('q'),
        adtech          = require('adtech'),
        adtechUtils     = require('../lib/adtechUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        
        campModule = {};


    campModule.setupSvc = function(db) {
        var campColl = db.collection('campaigns'),
            cardColl = db.collection('cards'),
            expColl = db.collection('experiences'),
            campSvc = new CrudSvc(campColl, 'cam', { userProp: false, orgProp: false });
        campSvc._cardColl = cardColl;
        campSvc._expColl = expColl;
        
        campSvc.createValidator._required.push('name', 'advertiserId', 'customerId');
        campSvc.createValidator._forbidden.push('adtechId');
        campSvc.editValidator._forbidden.push('campaignId', 'customerId');
        campSvc.use('create', campSvc.validateUniqueProp.bind(campSvc, 'name', null));
        campSvc.use('edit', campSvc.validateUniqueProp.bind(campSvc, 'name', null));
        campSvc.use('read', campSvc.preventGetAll.bind(campSvc));
        campSvc.use('create', campModule.adtechCreate);
        campSvc.use('create', campModule.createBanners);
        campSvc.use('edit', campModule.createBanners);
        campSvc.use('delete', campModule.deleteContent.bind(campModule, campSvc));
        
        return campSvc;
    };
    
    campModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog();
            
        return adtech.campaignAdmin.createCampaign(adtechUtils.formatCampaign(req.body))
        .then(function(resp) {
            log.info('[%1] Created Adtech campaign %2 for C6 campaign %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech campaign for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    //TODO: delete unused banners for PUTs? need to decide what source of truth is...
    campModule.createBanners = function(req, next, done) {
        var log = logger.getLog(),
            banners = [],
            id, adtechId;
            
        req.origObj = req.origObj || {}; //TODO: this feels like a bad hack
        adtechId = req.body.adtechId || req.origObj.adtechId;
        id = req.body.id || req.origObj.id;
        
        //TODO: merge arrays more intelligently?
        req.body.minViewTime = req.body.minViewTime || req.origObj.minViewTime || -1;
        req.body.miniReels = req.body.miniReels || req.origObj.miniReels || [];
        req.body.cards = req.body.cards || req.origObj.cards || [];
        req.body.targetMiniReels = req.body.targetMiniReels || req.origObj.targetMiniReels || [];

        ['miniReels', 'cards', 'targetMiniReels'].forEach(function(key) {
            if (!req.body[key].every(function(item) { return typeof item === 'object'; })) {
                log.info('[%1] req.body.%2 is invalid: %3',
                         req.uuid, key, JSON.stringify(req.body[key]));
                return done({code: 400, body: key + ' must be an array of objects'});
            }
        });
        
        return adtechUtils.createBanners(req.body.cards, 'card', adtechId)
        .then(function() {
            return adtechUtils.createBanners(req.body.miniReels, 'miniReel', adtechId);
        })
        .then(function() {
            return adtechUtils.createBanners(req.body.targetMiniReels, 'targetMiniReel', adtechId);
        })
        .then(function() {
            log.info('[%1] All banners for campaign %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('Failed creating banners for campaign %2: %3', req.uuid, id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    

    campModule.deleteContent = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            cardIds = (req.origObj.cards || []).map(function(card) { return card.id; }),
            expIds = (req.origObj.miniReels || []).map(function(exp) { return exp.id; }),
            updates = { $set: { lastUpdated: new Date(), status: Status.Deleted } };
        
        return q.npost(svc._cardColl, 'update', [{id: {$in: cardIds}}, updates, {multi: true}])
        .then(function() {
            if (cardIds.length) {
                log.info('[%1] Deleted cards %2', req.uuid, cardIds.join(', '));
            }
            return q.npost(svc._expColl, 'update', [{id: {$in: expIds}}, updates, {multi: true}]);
        })
        .then(function() {
            if (expIds.length) {
                log.info('[%1] Deleted experiences %2', req.uuid, expIds.join(', '));
            }
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error deleting cards + minireels for campaign %2: %3',
                      req.uuid, req.origObj.id, error);
            return q.reject(new Error('Mongo error'));
        });
    };
    

    campModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetCamp = authUtils.middlewarify({campaigns: 'read'});
        app.get('/api/campaign/:id', sessions, authGetCamp, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving campaign', detail: error });
            });
        });

        app.get('/api/campaigns', sessions, authGetCamp, audit, function(req, res) {
            var query = {};
            if (req.query.name) { //TODO: supported query params are?
                query.name = String(req.query.name);
            }

            svc.getObjs(query, req, true).then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving campaigns', detail: error });
            });
        });

        var authPostCamp = authUtils.middlewarify({campaigns: 'create'});
        app.post('/api/campaign', sessions, authPostCamp, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating campaign', detail: error });
            });
        });

        var authPutCamp = authUtils.middlewarify({campaigns: 'edit'});
        app.put('/api/campaign/:id', sessions, authPutCamp, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating campaign', detail: error });
            });
        });

        var authDelCamp = authUtils.middlewarify({campaigns: 'delete'});
        app.delete('/api/campaign/:id', sessions, authDelCamp, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting campaign', detail: error });
            });
        });
    };
    
    module.exports = campModule;
}());
