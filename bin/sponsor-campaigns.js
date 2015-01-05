(function(){
    'use strict';

    var q               = require('q'),
        adtech          = require('adtech'),
        campaignUtils   = require('../lib/campaignUtils'),
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
        campSvc.editValidator._forbidden.push('advertiserId', 'customerId');
        ['cards', 'miniReels', 'targetMiniReels'].forEach(function(key) {
            campSvc.createValidator._formats[key] = ['object'];
            campSvc.editValidator._formats[key] = ['object'];
        });
        campSvc.createValidator._formats.categories = ['string'];
        campSvc.editValidator._formats.categories = ['string'];

        campSvc.use('read', campSvc.preventGetAll.bind(campSvc));
        campSvc.use('create', campSvc.validateUniqueProp.bind(campSvc, 'name', null)); //TODO: ???
        campSvc.use('create', campModule.createAdtechCamp);
        campSvc.use('create', campModule.createBanners);
        campSvc.use('edit', campSvc.validateUniqueProp.bind(campSvc, 'name', null));
        campSvc.use('edit', campModule.cleanBanners);
        campSvc.use('edit', campModule.createBanners);
        campSvc.use('delete', campModule.deleteContent.bind(campModule, campSvc));
        
        return campSvc;
    };
    
    campModule.createAdtechCamp = function(req, next/*, done*/) {
        var log = logger.getLog(),
            kwlp1List;
        
        req.body.minViewTime = req.body.minViewTime || -1;
        
        kwlp1List = (req.body.cards || []).map(function(card) { return card.id; })
                    .concat((req.body.targetMiniReels || []).map(function(exp) { return exp.id; }));
        
        return q.all([campaignUtils.makeKeywords(kwlp1List),
                      campaignUtils.makeKeywords(req.body.categories || [])])
        .spread(function(kwlp1Ids, kwlp3Ids) {
            var keys = {
                level1: kwlp1Ids,
                level3: kwlp3Ids
            };
            var formatted = campaignUtils.formatCampaign(req.body, keys, true);
            return adtech.campaignAdmin.createCampaign(formatted);
        })
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
    
    campModule.createBanners = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            adtechId = parseInt(req.body.adtechId || (req.origObj && req.origObj.adtechId));
        
        return ['miniReels', 'cards', 'targetMiniReels'].reduce(function(promise, key) {
            return promise.then(function() {
                return campaignUtils.createBanners(
                    req.body[key],
                    req.origObj && req.origObj[key] || null,
                    key.replace(/s$/, ''),
                    adtechId
                );
            });
        }, q())
        .then(function() {
            log.info('[%1] All banners for campaign %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('Failed creating banners for campaign %2: %3', req.uuid, id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    campModule.cleanBanners = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.origObj.id;
        
        return ['miniReels', 'cards', 'targetMiniReels'].reduce(function(promise, key) {
            return promise.then(function() {
                return campaignUtils.cleanBanners(req.body[key], req.origObj[key], id);
            });
        }, q())
        .then(function() {
            log.trace('[%1] Successfully processed all banners from origObj', req.uuid);
            next();
        })
        .catch(function(error) {
            log.error('Failed cleaning banners for campaign %2: %3', req.uuid, id, error);
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
