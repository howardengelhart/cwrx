(function(){
    'use strict';

    var q               = require('q'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        adtech          = require('adtech'),

        advertModule = {};

    advertModule.setupSvc = function(coll) {
        var svc = new CrudSvc(coll, 'a', { userProp: false, orgProp: false });
        svc.createValidator._required.push('name');
        svc.createValidator._forbidden.push('adtechId');
        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', advertModule.adtechCreate);
        svc.use('edit', advertModule.adtechEdit);
        
        return svc;
    };
    
    //TODO: should this merge a new and old version? will we need to set more than just name?
    advertModule.formatAdtechAdvert = function(advertiser) {
        return {
            companyData: { //TODO: load this through default in config? fill in address?
                address: {},
                url: advertiser.url || 'http://cinema6.com'
            },
            extId: advertiser.id,
            id: advertiser.adtechId && Number(advertiser.adtechId),
            name: advertiser.name
        };
    };
    
    //TODO: rename these? wrap so adtech can be swapped?
    advertModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = advertModule.formatAdtechAdvert(req.body);
        
        //TODO: should this timeout?
        return adtech.customerAdmin.createAdvertiser(record).then(function(resp) {
            log.info('[%1] Created Adtech advertiser %2 for C6 advertiser %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            next();
        }).catch(function(error) {
            log.error('[%1] Failed creating Adtech advertiser for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject('Adtech failure');
        });
    };
    
    advertModule.adtechEdit = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = advertModule.formatAdtechAdvert(req.origObj);
        
        if (req.body.name === req.origObj.name) {
            log.info('[%1] Advertiser name unchanged; not updating adtech', req.uuid);
            return next();
        }
        
        record.name = req.body.name;
        
        //TODO: should this timeout?
        return adtech.customerAdmin.updateAdvertiser(record).then(function(resp) {
            log.info('[%1] Updated Adtech advertiser %2 with name %3',
                     req.uuid, resp.id, req.body.name);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech advertiser %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject('Adtech failure');
        });
    };

    
    advertModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetAd = authUtils.middlewarify({advertisers: 'read'});
        app.get('/api/account/advertiser/:id', sessions, authGetAd, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving advertiser', detail: error });
            });
        });

        app.get('/api/account/advertisers', sessions, authGetAd, audit, function(req, res) {
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
                res.send(500, { error: 'Error retrieving advertisers', detail: error });
            });
        });

        var authPostAd = authUtils.middlewarify({advertisers: 'create'});
        app.post('/api/account/advertiser', sessions, authPostAd, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating advertiser', detail: error });
            });
        });

        var authPutAd = authUtils.middlewarify({advertisers: 'edit'});
        app.put('/api/account/advertiser/:id', sessions, authPutAd, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating advertiser', detail: error });
            });
        });

        var authDelAd = authUtils.middlewarify({advertisers: 'delete'});
        app.delete('/api/account/advertiser/:id', sessions, authDelAd, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting advertiser', detail: error });
            });
        });
    };
    
    module.exports = advertModule;
}());
