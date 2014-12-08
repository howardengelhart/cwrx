(function(){
    'use strict';

    var authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),
        adtech          = require('adtech'),
        objUtils        = require('objUtils'),

        siteModule = {};

    siteModule.setupSvc = function(coll) {
        var siteSvc = new CrudSvc(coll, 's', { userProp: false, orgProp: false });
        siteSvc.createValidator._required.push('host');
        siteSvc.createValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        siteSvc.editValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        
        var hostRegex = /^([\w-]+\.)+[\w-]+$/;
        siteSvc.use('create', siteSvc.validateUniqueProp.bind(siteSvc, 'host', hostRegex));
        siteSvc.use('edit', siteSvc.validateUniqueProp.bind(siteSvc, 'host', hostRegex));
        siteSvc.use('read', siteSvc.preventGetAll.bind(siteSvc));
        svc.use('create', siteModule.adtechCreate);
        svc.use('edit', siteModule.adtechEdit);
        //TODO: make sure to default `containers` to {}; either override setupObj or in adtech stuff
        
        return siteSvc;
    };
    
    
    siteModule.getAdtechRecord = function(site) {
        var record = {
            URL: 
            extId: site.id,
            name: site.name
        };
        if (site.adtechId) {
            record.id = Number(site.adtechId);
        }
        
        return objUtils.sortObject(record);
    };
    
    siteModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = siteModule.getAdtechRecord(req.body);
        
        //TODO: should this timeout?
        return adtech.websiteAdmin.createWebsite(record).then(function(resp) {
            log.info('[%1] Created Adtech site %2 for C6 site %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            next();
        }).catch(function(error) {
            log.error('[%1] Failed creating Adtech site for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject('Adtech failure');
        });
    };
    
    siteModule.adtechEdit = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = siteModule.getAdtechRecord(req.origObj);
        
        if (req.body.name === req.origObj.name) {
            log.info('[%1] Site name unchanged; not updating adtech', req.uuid);
            return next();
        }
        
        record.name = req.body.name;
        
        //TODO: should this timeout?
        return adtech.websiteAdmin.updateWebsite(record).then(function(resp) {
            log.info('[%1] Updated Adtech site %2 with name %3',
                     req.uuid, resp.id, req.body.name);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech site %2: %3',
                      req.uuid, req.origObj.adtechId, error);
            return q.reject('Adtech failure');
        });
    };
    
    
    siteModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetSite = authUtils.middlewarify({sites: 'read'});
        app.get('/api/account/site/:id', sessions, authGetSite, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving site', detail: error });
            });
        });

        app.get('/api/account/sites', sessions, authGetSite, audit, function(req, res) {
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
                res.send(500, { error: 'Error retrieving sites', detail: error });
            });
        });

        var authPostSite = authUtils.middlewarify({sites: 'create'});
        app.post('/api/account/site', sessions, authPostSite, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating site', detail: error });
            });
        });

        var authPutSite = authUtils.middlewarify({sites: 'edit'});
        app.put('/api/account/site/:id', sessions, authPutSite, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating site', detail: error });
            });
        });

        var authDelSite = authUtils.middlewarify({sites: 'delete'});
        app.delete('/api/account/site/:id', sessions, authDelSite, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting site', detail: error });
            });
        });
    };
    
    module.exports = siteModule;
}());
