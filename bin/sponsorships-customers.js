(function(){
    'use strict';

    var q               = require('q'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        adtech          = require('adtech'),

        custModule = {};

    custModule.setupSvc = function(coll) {
        var svc = new CrudSvc(coll, 'cu', { userProp: false, orgProp: false });
        svc.createValidator._required.push('name');
        svc.createValidator._forbidden.push('adtechId');
        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', custModule.adtechCreate);
        svc.use('edit', custModule.adtechEdit);
        
        return svc;
    };
    
    /* TODO: how to use for reads? should all Adtech updates retrieve original first?
    custModule.getAdvertList = function(req, next, done) {
        var log = logger.getLog(),
            adtechId = req.origObj.adtechId;
            
        if (!adtechId) {
            log.warn('[%1] No adtech id for customer %2', req.uuid, req.origObj.id);
            return next();
        }
        
        return adtech.customerAdmin.getCustomerById(adtechId).then(function(resp) {
            req.origAdvertisers = resp.advertiser;
            next();
        }).catch(function(error) {
            log.error('[%1] Could not retrieve Adtech customer %2: %3', req.uuid, adtechId, error);
            return q.reject(error); //TODO: is this what we want?
        });
    };
    */
    
    custModule.formatAdtechCust = function(req, customer, advertList) {
        var log = logger.getLog(),
            advertisers;
        
        if (advertList) {
            if (!(advertList instanceof Array) || !advertList.every(function(advert) {
                return typeof advert === 'string' || typeof advert === 'number';
            })) {
                log.warn('[%1] Invalid advertiser list: %2', req.uuid, JSON.stringify(advertList));
            } else {
                log.info('[%1] Linking customer %2 to advertisers %3',
                         req.uuid, customer.id, advertList);
                advertisers = adtech.customerAdmin.makeAdvertiserList(advertList.map(function(id) {
                    return { id: Number(id) };
                }));
            }
        }
            
        return {
            advertiser: advertisers,
            companyData: {
                address: {},
                url: customer.url || 'http://cinema6.com'
            },
            extId: customer.id,
            id: customer.adtechId && Number(customer.adtechId),
            name: customer.name
        };
    };
    
    custModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = custModule.formatAdtechCust(req);
        
        delete req.body.advertisers;
        
            
        return adtech.customerAdmin.createCustomer(record).then(function(resp) {
            log.info('[%1] Created Adtech customer %2 for C6 customer %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            next();
        }).catch(function(error) {
            log.error('[%1] Failed creating Adtech customer for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject('Adtech failure');
        });
    };
    
    custModule.adtechEdit = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = custModule.formatAdtechCust(req, req.origObj, req.body.advertisers);
        
        if (req.body.name === req.origObj.name && !req.body.advertisers) {
            log.info('[%1] Customer unchanged; not updating adtech', req.uuid);
            return next();
        }
        
        record.name = req.body.name;
        delete req.body.advertisers;
        
        return adtech.customerAdmin.updateCustomer(record).then(function(resp) {
            log.info('[%1] Updated Adtech customer %2', req.uuid, resp.id);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech customer %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject('Adtech failure');
        });
    };


    custModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetCust = authUtils.middlewarify({customers: 'read'});
        app.get('/api/account/customer/:id', sessions, authGetCust, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving customer', detail: error });
            });
        });

        app.get('/api/account/customers', sessions, authGetCust, audit, function(req, res) {
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
                res.send(500, { error: 'Error retrieving customers', detail: error });
            });
        });

        var authPostCust = authUtils.middlewarify({customers: 'create'});
        app.post('/api/account/customer', sessions, authPostCust, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating customer', detail: error });
            });
        });

        var authPutCust = authUtils.middlewarify({customers: 'edit'});
        app.put('/api/account/customer/:id', sessions, authPutCust, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating customer', detail: error });
            });
        });

        var authDelCust = authUtils.middlewarify({customers: 'delete'});
        app.delete('/api/account/customer/:id', sessions, authDelCust, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting customer', detail: error });
            });
        });
    };
    
    module.exports = custModule;
}());
