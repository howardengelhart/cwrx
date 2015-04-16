(function(){
    'use strict';

    var q               = require('q'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        objUtils        = require('../lib/objUtils'),
        adtech          = require('adtech'),

        advertModule = {};

    advertModule.setupSvc = function(coll, cache) {
        var svc = new CrudSvc(coll, 'a', { userProp: false, orgProp: false }, cache);
        svc.createValidator._required.push('name');
        svc.createValidator._forbidden.push('adtechId');
        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', advertModule.createAdtechAdvert);
        svc.use('edit', advertModule.editAdtechAdvert);
        svc.use('delete', advertModule.deleteAdtechAdvert);
        
        return svc;
    };
    
    advertModule.formatAdtechAdvert = function(body, orig) {
        if (!orig) {
            return {
                companyData: {
                    address: {},
                    url: 'http://cinema6.com'
                },
                extId: body.id,
                name: body.name
            };
        }
        
        var record = JSON.parse(JSON.stringify(orig));
        objUtils.trimNull(record);

        record.assignedUsers = record.assignedUsers ?
            adtech.customerAdmin.makeUserList(record.assignedUsers) : undefined;
        record.contacts = record.contacts ?
            adtech.customerAdmin.makeContactList(record.contacts) : undefined;
        record.name = body.name || record.name;
        
        return record;
    };
    
    advertModule.createAdtechAdvert = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = advertModule.formatAdtechAdvert(req.body);
        
        return adtech.customerAdmin.createAdvertiser(record)
        .then(function(resp) {
            log.info('[%1] Created Adtech advertiser %2 for C6 advertiser %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = parseInt(resp.id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech advertiser for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    advertModule.editAdtechAdvert = function(req, next/*, done*/) {
        var log = logger.getLog();
        
        if (req.origObj && req.body.name === req.origObj.name) {
            log.info('[%1] Advertiser name unchanged; not updating adtech', req.uuid);
            return q(next());
        }
        
        return adtech.customerAdmin.getAdvertiserById(req.origObj.adtechId)
        .then(function(advert) {
            log.info('[%1] Retrieved previous advertiser %2', req.uuid, advert.id);
            var record = advertModule.formatAdtechAdvert(req.body, advert);
            return adtech.customerAdmin.updateAdvertiser(record);
        })
        .then(function(resp) {
            log.info('[%1] Updated Adtech advertiser %2', req.uuid, resp.id);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech advertiser %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject(new Error('Adtech failure'));
        });
    };

    advertModule.deleteAdtechAdvert = function(req, next/*, done*/) {
        var log = logger.getLog();
        
        if (!req.origObj || !req.origObj.adtechId) {
            log.warn('[%1] Advert %2 has no adtechId, nothing to delete', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return adtech.customerAdmin.deleteAdvertiser(req.origObj.adtechId)
        .then(function() {
            log.info('[%1] Deleted Adtech advertiser %2', req.uuid, req.origObj.adtechId);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error deleting Adtech advertiser %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject(new Error('Adtech failure'));
        });
    };

    
    advertModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetAd = authUtils.middlewarify({advertisers: 'read'});
        app.get('/api/account/advertiser/:id', sessions, authGetAd, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, res, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving advertiser', detail: error });
            });
        });

        app.get('/api/account/advertisers', sessions, authGetAd, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }
            if (req.query.adtechId) {
                query.adtechId = Number(req.query.adtechId);
            }

            svc.getObjs(query, req, res, true).then(function(resp) {
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
            svc.createObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating advertiser', detail: error });
            });
        });

        var authPutAd = authUtils.middlewarify({advertisers: 'edit'});
        app.put('/api/account/advertiser/:id', sessions, authPutAd, audit, function(req, res) {
            svc.editObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating advertiser', detail: error });
            });
        });

        var authDelAd = authUtils.middlewarify({advertisers: 'delete'});
        app.delete('/api/account/advertiser/:id', sessions, authDelAd, audit, function(req, res) {
            svc.deleteObj(req, res)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting advertiser', detail: error });
            });
        });
    };
    
    module.exports = advertModule;
}());
