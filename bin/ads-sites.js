(function(){
    'use strict';

    var q               = require('q'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),
        adtech          = require('adtech'),

        siteModule = {};

    siteModule.setupSvc = function(coll) {
        var svc = new CrudSvc(coll, 's', { userProp: false, orgProp: false });
        svc.createValidator._required.push('host', 'name');
        svc.createValidator._forbidden.push('adtechId');
        svc.createValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        svc.createValidator._formats.containers = ['object'];
        svc.editValidator._formats.containers = ['object'];
        svc.editValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'edit');
        
        var hostRegex = /^([\w-]+\.)+[\w-]+$/;
        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('create', siteModule.validateContainers);
        svc.use('create', siteModule.createAdtechSite);
        svc.use('create', siteModule.createPlacements);
        svc.use('edit', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('edit', siteModule.validateContainers);
        svc.use('edit', siteModule.cleanPlacements);
        svc.use('edit', siteModule.createPlacements);
        svc.use('edit', siteModule.editAdtechSite);
        svc.use('delete', siteModule.deleteAdtechSite);
        
        return svc;
    };

    siteModule.formatAdtechSite = function(body, orig) {
        if (!orig) {
            return {
                URL: 'http://' + body.host,
                contact: { email: 'ops@cinema6.com' },
                extId: body.id,
                name: body.name
            };
        }
        
        var record = JSON.parse(JSON.stringify(orig));
        objUtils.trimNull(record);

        record.pageList = record.pageList ?
            adtech.websiteAdmin.makePageList(record.pageList) : undefined;
        record.assignedUsers = record.assignedUsers ?
            adtech.customerAdmin.makeUserList(record.assignedUsers) : undefined;
        record.name = body.name || record.name;
        record.URL = body.host ? 'http://' + body.host : record.URL;

        return record;
    };
    
    siteModule.validateContainers = function(req, next, done) {
        var log = logger.getLog(),
            containers = req.body.containers || [],
            ids = {};
        
        for (var i = 0; i < containers.length; i++) {
            if (!containers[i].id) {
                log.info('[%1] Container #%2 has no id', req.uuid, i);
                return q(done({code: 400, body: 'All containers must have an id'}));
            }

            if (ids[containers[i].id] !== undefined) {
                log.info('[%1] Containers #%2 and #%3 both have id %4',
                         req.uuid, ids[containers[i].id], i, containers[i].id);
                return q(done({code: 400, body: 'Container ids must be unique'}));
            }
            
            ids[containers[i].id] = i;
        }
        
        return q(next());
    };

    siteModule.cleanPlacements = function(req, next, done) {
        var log = logger.getLog(),
            id = req.origObj.id,
            doneCalled = false;
        
        if (!req.origObj.containers || !req.body.containers) {
            return q(next());
        }
        
        return req.origObj.containers.reduce(function(promise, cont) {
            if (req.body.containers.some(function(newCont) { return newCont.id === cont.id; })) {
                log.trace('[%1] Container %2 still exists for %3', req.uuid, cont.id, id);
                return promise;
            }
            
            log.info('[%1] Container %2 removed from %3, deleting placements',req.uuid,cont.id,id);

            var ids = [cont.displayPlacementId, cont.contentPlacementId];
            return ids.reduce(function(promise2, plId) {
                if (!plId) {
                    return promise2;
                }

                return promise2.then(function() {
                    return adtech.websiteAdmin.deletePlacement(plId);
                })
                .then(function() {
                    log.info('[%1] Succesfully deleted placement %2 from container %3',
                             req.uuid, plId, cont.id);
                })
                .catch(function(error) {
                    try {
                        var rgx = /deletion cannot be performed because .* run on the affected/;
                        if (!!error.root.Envelope.Body.Fault.faultstring.match(rgx)) {
                            log.info('[%1] Cannot delete placement %2; it has active campaigns',
                                     req.uuid, plId);

                            if (!doneCalled) { // ensure done is only called once
                                doneCalled = true;
                                return done({code: 400, body: 'Cannot delete in-use placements'});
                            } else {
                                return q();
                            }
                        }
                    } catch(e) {}
                
                    log.error('[%1] Error deleting placement %2: %3', req.uuid, plId, error);
                    return q.reject(new Error('Adtech failure'));
                });
            }, promise);
        }, q())
        .then(function() {
            if (!doneCalled) {
                log.trace('[%1] Successfully processed all containers from origObj', req.uuid);
                next();
            }
        });
    };
    
    siteModule.createPlacements = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            adtechId = req.body.adtechId || (req.origObj && req.origObj.adtechId),
            pageId = req.body.pageId || (req.origObj && req.origObj.pageId),
            oldConts = (req.origObj && req.origObj.containers) || [],
            idx = 0;
        
        if (!req.body.containers) {
            return q(next());
        }
        
        return req.body.containers.reduce(function(promise, cont) {
            var existing = oldConts.filter(function(oldCont) { return cont.id === oldCont.id; })[0];
            if (existing) { // copy over any existing placements, then ensure both are created
                req.body.containers[idx] = cont = existing;
            }
            idx++;

            return ['contentPlacementId', 'displayPlacementId'].reduce(function(promise2, key) {
                if (cont[key]) {
                    return promise2;
                }

                var formatted = {
                    name: cont.id + '_' + key.replace('PlacementId', ''),
                    pageId: parseInt(pageId),
                    websiteId: parseInt(adtechId)
                };

                return promise2.then(function() {
                    return adtech.websiteAdmin.createPlacement(formatted);
                })
                .then(function(result) {
                    log.info('[%1] Created placement %2, id = %3, for site %4',
                             req.uuid, result.name, result.id, id);
                    cont[key] = parseInt(result.id);
                })
                .catch(function(error) {
                    log.error('[%1] Error creating placement %2 for site %3: %4',
                              req.uuid, formatted.name, id, error);
                    return q.reject(new Error('Adtech failure'));
                });
            }, promise);
        }, q())
        .then(function() {
            log.info('[%1] All placements have been created for site %2', req.uuid, id);
            next();
        });
    };
    
    
    siteModule.createAdtechSite = function(req, next/*, done*/) {
        var log = logger.getLog(),
            record = siteModule.formatAdtechSite(req.body);
        
        return adtech.websiteAdmin.createWebsite(record).then(function(resp) {
            log.info('[%1] Created Adtech site %2 for C6 site %3', req.uuid, resp.id, req.body.id);
            req.body.adtechId = parseInt(resp.id);
            
            var page = { name: 'Default', websiteId: resp.id };
            return adtech.websiteAdmin.createPage(page);
        })
        .then(function(resp) {
            log.info('[%1] Created Adtech page %2 for C6 site %3', req.uuid, resp.id, req.body.id);
            req.body.pageId = parseInt(resp.id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech entries for %2: %3',req.uuid,req.body.id,error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    siteModule.editAdtechSite = function(req, next/*, done*/) {
        var log = logger.getLog();
        
        if ((!req.body.name || req.body.name === req.origObj.name) &&
            (!req.body.host || req.body.host === req.origObj.host)) {
            log.info('[%1] Site props unchanged; not updating adtech site', req.uuid);
            return q(next());
        }
        
        if (!req.origObj || !req.origObj.adtechId) {
            log.warn('[%1] Site %2 has no adtechId, nothing to edit', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return adtech.websiteAdmin.getWebsiteById(req.origObj.adtechId)
        .then(function(orig) {
            log.info('[%1] Retrieved previous site %2', req.uuid, orig.id);
            var record = siteModule.formatAdtechSite(req.body, orig);
            return adtech.websiteAdmin.updateWebsite(record);
        })
        .then(function(resp) {
            log.info('[%1] Updated Adtech site %2', req.uuid, resp.id);
            next();
        }).catch(function(error) {
            log.error('[%1] Failed editing Adtech site %2: %3',req.uuid,req.origObj.adtechId,error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    siteModule.deleteAdtechSite = function(req, next, done) {
        var log = logger.getLog();
        
        if (!req.origObj || !req.origObj.adtechId) {
            log.warn('[%1] Site %2 has no adtechId, nothing to delete', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return adtech.websiteAdmin.deleteWebsite(req.origObj.adtechId)
        .then(function() {
            log.info('[%1] Deleted Adtech site %2', req.uuid, req.origObj.adtechId);
            next();
        })
        .catch(function(error) {
            try {
                var errRgx = /deletion cannot be performed because .* run on .* placements/;
                if (!!error.root.Envelope.Body.Fault.faultstring.match(errRgx)) {
                    log.warn('[%1] Cannot delete website %2; it has active campaigns',
                             req.uuid, req.origObj.adtechId);
                    return done({code: 400, body: 'Cannot delete in-use placements'});
                }
            } catch(e) {}

            log.error('[%1] Error deleting Adtech site %2: %3',req.uuid,req.origObj.adtechId,error);
            return q.reject(new Error('Adtech failure'));
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
            ['name', 'org', 'host'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if (req.query.adtechId) {
                query.adtechId = Number(req.query.adtechId);
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
