(function(){
    'use strict';

    var q               = require('q'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),
        adtech          = require('adtech'),

        siteModule = {};

    siteModule.setupSvc = function(coll) {
        var svc = new CrudSvc(coll, 's', { userProp: false, orgProp: false });
        svc.createValidator._required.push('host');
        svc.createValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        svc.editValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        
        var hostRegex = /^([\w-]+\.)+[\w-]+$/;
        svc.use('create', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('edit', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', siteModule.adtechCreate);
        svc.use('create', siteModule.createPlacements);
        svc.use('edit', siteModule.adtechEdit);
        svc.use('edit', siteModule.createPlacements);
        
        return svc;
    };
    
    
    siteModule.formatAdtechSite = function(site) {
        return {
            URL: 'http://' + site.host, //TODO: or just the host?
            extId: site.id,
            id: site.adtechId && Number(site.adtechId),
            name: site.name
        };
    };
    
    siteModule.createPlacements = function(req, next, done) {
        var log = logger.getLog(),
            id = req.body.id || req.origObj && req.origObj.id,
            adtechId = req.body.adtechId || req.origObj && req.origObj.adtechId,
            pageId = req.body.pageId || req.origObj && req.origObj.pageId;
        
        //TODO: should we check req.origObj.containers for PmentIds?
        req.body.containers = req.body.containers || [];
        
        if (!(req.body.containers instanceof Array)) {
            log.warn('[%1] Site %2 has invalid containers: %3', id, req.body.containers);
            return done({code: 400, body: 'Containers must be an array'});
        }
        
        //TODO: speed up? find out why there's a 30+ second delay?
        return q.all(req.body.containers.map(function(container) {
            var placements = [];
            if (!container.displayPlacementId) {
                placements.push({
                    name: container.type + '_display',
                    pageId: Number(pageId),
                    websiteId: Number(adtechId)
                });
            }
            if (!container.contentPlacementId) {
                placements.push({
                    name: container.type + '_content',
                    pageId: Number(pageId),
                    websiteId: Number(adtechId)
                });
            }
            
            return q.all(placements.map(function(placement) {
                return adtech.websiteAdmin.createPlacement(placement);
            }))
            .spread(function(dispResult, contResult) {
                if (dispResult) {
                    log.info('[%1] Created placement %2, id = %3, for site %4',
                             req.uuid, dispResult.name, dispResult.id, id);
                    container.displayPlacementId = dispResult.id;
                }
                if (contResult) {
                    log.info('[%1] Created placement %2, id = %3, for site %4',
                             req.uuid, contResult.name, contResult.id, id);
                    container.contentPlacementId = contResult.id;
                }
            });
        })).then(function(results) {
            log.info('[%1] Successfully created all placements for site %2', req.uuid, id);
            next();
        });
    };
    
    siteModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = siteModule.formatAdtechSite(req.body);
        req.body.containers = req.body.containers || [];
        
        return adtech.websiteAdmin.createWebsite(record).then(function(resp) {
            log.info('[%1] Created Adtech site %2 for C6 site %3', req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            
            var page = { name: 'Default', websiteId: resp.id };
            return adtech.websiteAdmin.createPage(page);
        })
        .then(function(resp) {
            log.info('[%1] Created Adtech page %2 for C6 site %3', req.uuid, resp.id, req.body.id);
            req.body.pageId = resp.id;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech entries for %2: %3',req.uuid,req.body.id,error);
            return q.reject('Adtech failure');
        });
    };
    
    siteModule.adtechEdit = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = siteModule.formatAdtechSite(req.origObj);
        
        if (req.body.name === req.origObj.name && req.body.host === req.origObj.host) {
            log.info('[%1] Site props, unchanged; not updating adtech site', req.uuid);
            return next();
        }
        
        record.name = req.body.name;
        record.host = req.body.host;
        
        return adtech.websiteAdmin.updateWebsite(record).then(function(resp) {
            log.info('[%1] Updated Adtech site %2', req.uuid, resp.id);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech site %2: %3',req.uuid,req.origObj.adtechId,error);
            return q.reject('Adtech failure');
        });
    };
    
    
    siteModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetSite = authUtils.middlewarify({sites: 'read'});
        app.get('/api/site/:id', sessions, authGetSite, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving site', detail: error });
            });
        });

        app.get('/api/sites', sessions, authGetSite, audit, function(req, res) {
            var query = {};
            ['name', 'org', 'host']
            .forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

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
        app.post('/api/site', sessions, authPostSite, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating site', detail: error });
            });
        });

        var authPutSite = authUtils.middlewarify({sites: 'edit'});
        app.put('/api/site/:id', sessions, authPutSite, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating site', detail: error });
            });
        });

        var authDelSite = authUtils.middlewarify({sites: 'delete'});
        app.delete('/api/site/:id', sessions, authDelSite, audit, function(req, res) {
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
