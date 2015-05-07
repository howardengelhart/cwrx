(function(){
    'use strict';

    var q               = require('q'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        adtech          = require('adtech'),

        custModule = {};

    custModule.setupSvc = function(db, jobManager) {
        var coll = db.collection('customers'),
            opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(coll, 'cu', opts, jobManager);
        svc._advertColl = db.collection('advertisers');
        svc.createValidator._required.push('name');
        svc.createValidator._forbidden.push('adtechId');
        svc.createValidator._formats.advertisers = ['string'];
        svc.editValidator._formats.advertisers = ['string'];

        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', custModule.createAdtechCust.bind(custModule, svc));
        svc.use('edit', custModule.editAdtechCust.bind(custModule, svc));
        svc.use('delete', custModule.deleteAdtechCust);
        
        return svc;
    };
    
    /* Get advertisers lists for each customer in resp.body, using decorateCustomers.
     * Should be called in route handler with response from appropriate CrudSvc method. */
    custModule.getAdvertLists = function(svc, req, resp) {
        var log = logger.getLog(),
            aove = new adtech.AOVE(),
            customers = resp.body instanceof Array ? resp.body : [resp.body],
            ids = customers.map(function(cust) { return cust.id; });
        
        if (resp.code < 200 || resp.code >= 300 || typeof resp.body !== 'object') {
            return q(resp);
        }
        
        aove.addExpression(new adtech.AOVE.IntExpression('archiveStatus', 0));
        aove.addExpression(new adtech.AOVE.StringListExpression('extId', ids));
        
        return adtech.customerAdmin.getCustomerList(null, null, aove)
        .catch(function(error) {
            log.error('[%1] Failed retrieving customers: %2', req.uuid, error);
            return q.reject('Adtech failure');
        })
        .then(function(adtechCusts) {
            log.trace('[%1] Retrieved %2 customers for %3 ids',
                      req.uuid, adtechCusts.length, ids.length);
            return custModule.decorateCustomers(req.uuid, svc, customers, adtechCusts);
        })
        .thenResolve(resp);
    };
    
    /* Decorates each customer (retrieved from mongo) in `customers` with an `advertisers` property.
     * This will be a list of C6 advertiser ids, retrieved from svc._advertColl, using the list of
     * adtech customers `adtechCusts` */
    custModule.decorateCustomers = function(reqId, svc, customers, adtechCusts) {
        var log = logger.getLog(),
            adtechIds = [];
        if ((!(adtechCusts instanceof Array) || adtechCusts.length === 0) && customers.length) {
            log.warn('[%1] Retrieved no custs from Adtech, not looking up advertisers', reqId);
            customers.forEach(function(cust) { cust.advertisers = []; });
            return q();
        }
        
        // get list of unique advertiser adtechIds from relevant adtech customers
        adtechCusts.filter(function(adtechCust) {
            return customers.some(function(cust) { return cust.id === adtechCust.extId; });
        }).forEach(function(adtechCust) {
            adtechCust.advertiser.forEach(function(adtechId) {
                if (adtechIds.indexOf(parseInt(adtechId)) === -1) {
                    adtechIds.push(parseInt(adtechId));
                }
            });
        });
        
        log.trace('[%1] Querying for advertisers with adtechIds = [%2]', reqId, adtechIds.join());
        var query = { adtechId: { $in: adtechIds }, status: { $ne: 'deleted' } },
            cursor = svc._advertColl.find(query, {id: 1, adtechId: 1});

        return q.npost(cursor, 'toArray')
        .then(function(advertisers) {
            var mapping = {};
            advertisers.forEach(function(advert) { mapping[advert.adtechId] = advert.id; });
            
            customers.forEach(function(cust) {
                var adtechCust = adtechCusts.filter(function(item) {
                    return item.extId === cust.id;
                })[0];
                
                if (!adtechCust) {
                    log.warn('[%1] No customer in Adtech found for %2', reqId, cust.id);
                    cust.advertisers = [];
                    return;
                }
                
                cust.advertisers = adtechCust.advertiser.map(function(adtechId) {
                    var c6Id = mapping[adtechId];
                    
                    if (c6Id === undefined) {
                        log.warn('[%1] No advertiser in mongo found for %2', reqId, adtechId);
                        mapping[adtechId] = null; // ensures we only log once per adtechId
                    }
                    return c6Id;
                }).filter(function(c6Id) { return !!c6Id; });
            });
        })
        .catch(function(error) {
            log.error('[%1] Failed looking up advertisers with adtechIds [%2]: %3',
                      reqId, adtechIds, error);
            return q.reject('Mongo error');
        });
    };

    // Query svc._advertColl for advertisers, returning a list of adtech ids for the list of c6Ids
    custModule.getAdvertAdtechIds = function(svc, c6Ids) {
        var log = logger.getLog();
        if (!(c6Ids instanceof Array) || c6Ids.length === 0) {
            return q(c6Ids);
        }
        
        var query = { id: { $in: c6Ids }, status: { $ne: 'deleted' } },
            cursor = svc._advertColl.find(query, {id: 1, adtechId: 1});
        
        return q.npost(cursor, 'toArray')
        .then(function(advertisers) {
            if (advertisers.length !== c6Ids.length) {
                log.warn('Looking up advertisers [%1] but only found [%2]', c6Ids,
                         advertisers.map(function(advertiser) { return advertiser.id; }));
            }
            return advertisers.map(function(advertiser) { return advertiser.adtechId; });
        })
        .catch(function(error) {
            log.error('Failed looking up advertisers with c6Ids [%1]: %2', c6Ids, error);
            return q.reject('Mongo error');
        });
    };

    /* Formats a customer for sending to adtech. orig may be the original object (from Adtech),
     * and advertList should be a list of adtech ids */
    custModule.formatAdtechCust = function(body, orig, advertList) {
        var log = logger.getLog(),
            c6Id = body.id || (orig && orig.extId),
            advertisers, record;
            
        advertList = advertList || (orig && orig.advertiser) || null;
        if (advertList) {
            log.info('Linking customer %1 to advertisers [%2]', c6Id, advertList);
            advertisers = adtech.customerAdmin.makeAdvertiserList(advertList.map(function(id) {
                return { id: Number(id) };
            }));
        }

        if (orig) {
            record = JSON.parse(JSON.stringify(orig));
            objUtils.trimNull(record);
            record.assignedUsers = record.assignedUsers ?
                adtech.customerAdmin.makeUserList(record.assignedUsers) : undefined;
            record.contacts = record.contacts ?
                adtech.customerAdmin.makeContactList(record.contacts) : undefined;
            record.name = body.name || record.name;
            record.advertiser = advertisers;
        } else {
            record = {
                advertiser: advertisers,
                companyData: {
                    address: {},
                    url: 'http://cinema6.com'
                },
                extId: c6Id,
                name: body.name
            };
        }
        
        return record;
    };
    
    // Middleware to create a customer in Adtech
    custModule.createAdtechCust = function(svc, req, next/*, done*/) {
        var log = logger.getLog();
        
        return custModule.getAdvertAdtechIds(svc, req.body.advertisers)
        .then(function(advertisers) {
            delete req.body.advertisers;
            var record = custModule.formatAdtechCust(req.body, null, advertisers);
            return adtech.customerAdmin.createCustomer(record);
        })
        .then(function(resp) {
            log.info('[%1] Created Adtech customer %2 for C6 customer %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = parseInt(resp.id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech customer for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Middleware to edit a customer in Adtech. Only pays attention to `name` and `advertisers`
    custModule.editAdtechCust = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            oldCust;
        
        if ((!req.body.name || req.body.name === req.origObj.name) && !req.body.advertisers) {
            log.info('[%1] Customer unchanged; not updating adtech', req.uuid);
            return q(next());
        }
        
        return adtech.customerAdmin.getCustomerById(req.origObj.adtechId)
        .then(function(cust) {
            log.info('[%1] Retrieved previous customer %2', req.uuid, cust.id);
            oldCust = cust;
            return custModule.getAdvertAdtechIds(svc, req.body.advertisers);
        })
        .then(function(advertisers) {
            delete req.body.advertisers;
            var record = custModule.formatAdtechCust(req.body, oldCust, advertisers);
            return adtech.customerAdmin.updateCustomer(record);
        })
        .then(function(resp) {
            log.info('[%1] Updated Adtech customer %2', req.uuid, resp.id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed editing Adtech customer %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject(new Error('Adtech failure'));
        });
    };

    // Middleware to delete a customer from Adtech
    custModule.deleteAdtechCust = function(req, next/*, done*/) {
        var log = logger.getLog();
        
        if (!req.origObj || !req.origObj.adtechId) {
            log.warn('[%1] Cust %2 has no adtechId, nothing to delete', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return adtech.customerAdmin.deleteCustomer(req.origObj.adtechId)
        .then(function() {
            log.info('[%1] Deleted Adtech customer %2', req.uuid, req.origObj.adtechId);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error deleting Adtech customer %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject(new Error('Adtech failure'));
        });
    };


    custModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetCust = authUtils.middlewarify({customers: 'read'});
        app.get('/api/account/customer/:id', sessions, authGetCust, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, res, false)
            .then(function(resp) {
                return custModule.getAdvertLists(svc, req, resp);
            }).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving customer', detail: error });
            });
        });

        app.get('/api/account/customers', sessions, authGetCust, audit, function(req, res) {
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
                return custModule.getAdvertLists(svc, req, resp);
            }).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving customers', detail: error });
            });
        });

        var authPostCust = authUtils.middlewarify({customers: 'create'});
        app.post('/api/account/customer', sessions, authPostCust, audit, function(req, res) {
            svc.createObj(req, res).then(function(resp) {
                return custModule.getAdvertLists(svc, req, resp);
            }).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating customer', detail: error });
            });
        });

        var authPutCust = authUtils.middlewarify({customers: 'edit'});
        app.put('/api/account/customer/:id', sessions, authPutCust, audit, function(req, res) {
            svc.editObj(req, res).then(function(resp) {
                return custModule.getAdvertLists(svc, req, resp);
            }).then(function(resp) {
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
