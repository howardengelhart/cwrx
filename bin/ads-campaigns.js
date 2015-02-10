(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        requestUtils    = require('../lib/requestUtils'),
        uuid            = require('../lib/uuid'),
        campaignUtils   = require('../lib/campaignUtils'),
        bannerUtils     = require('../lib/bannerUtils'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        
        campModule = {};
        
    campModule.setupSvc = function(db, config) {
        campModule.campsCfg = config.campaigns;
        campModule.contentHost = config.contentHost;
    
        var campColl = db.collection('campaigns'),
            svc = new CrudSvc(campColl, 'cam', { userProp: false, orgProp: false });
        svc._advertColl = db.collection('advertisers');
        svc._custColl = db.collection('customers');
        
        svc.createValidator._required.push('advertiserId', 'customerId');
        svc.editValidator._forbidden.push('advertiserId', 'customerId');

        svc.createValidator._formats.cards = ['string'];
        svc.editValidator._formats.cards = ['string'];
        svc.createValidator._formats.miniReels = ['string'];
        svc.editValidator._formats.miniReels = ['string'];
        svc.createValidator._formats.miniReelGroups = ['object'];
        svc.editValidator._formats.miniReelGroups = ['object'];
        svc.createValidator._formats.categories = ['string'];
        svc.editValidator._formats.categories = ['string'];

        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', campaignUtils.getAccountIds.bind(campaignUtils, svc._advertColl,
                                                           svc._custColl));
        svc.use('create', campModule.createSponsoredCamps);
        svc.use('create', campModule.createTargetCamps);
        svc.use('edit', campaignUtils.getAccountIds.bind(campaignUtils, svc._advertColl,
                                                         svc._custColl));
        svc.use('edit', campModule.cleanSponsoredCamps);
        svc.use('edit', campModule.editSponsoredCamps);
        svc.use('edit', campModule.createSponsoredCamps);
        svc.use('edit', campModule.cleanTargetCamps);
        svc.use('edit', campModule.editTargetCamps);
        svc.use('edit', campModule.createTargetCamps);
        svc.use('delete', campModule.deleteContent);
        svc.use('delete', campModule.deleteAdtechCamps);
        
        svc.formatOutput = campModule.formatOutput.bind(campModule, svc);
        
        return svc;
    };
    
    // Extends CrudSvc.prototype.formatOutput, processing cards, miniReels, and miniReelGroups
    campModule.formatOutput = function(svc, obj) {
        ['cards', 'miniReels'].forEach(function(prop) {
            obj[prop] = obj[prop] && obj[prop].map(function(contentObj) { return contentObj.id; });
        });
        
        (obj.miniReelGroups || []).forEach(function(group) {
            if (!(group.miniReels instanceof Array)) {
                return;
            }

            group.miniReels = group.miniReels.map(function(reelObj) { return reelObj.id; });
        });
        
        return CrudSvc.prototype.formatOutput.call(svc, obj);
    };

    // Middleware to delete unused sponsored miniReel and card campaigns
    campModule.cleanSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            delay = campModule.campsCfg.statusDelay,
            attempts = campModule.campsCfg.statusAttempts,
            toDelete = [];
        
        ['miniReels', 'cards'].forEach(function(prop) {
            if (!req.origObj || !req.origObj[prop] || !req.body[prop]) {
                return;
            }
            req.body[prop] = campaignUtils.objectify(req.body[prop]);
            
            req.origObj[prop].forEach(function(oldObj) {
                if (req.body[prop].some(function(newObj) { return newObj.id === oldObj.id; })) {
                    log.trace('[%1] Campaign for %2 still exists for %3', req.uuid, oldObj.id, id);
                    return;
                }
                
                log.info('[%1] %2 removed from %3 in %4, deleting its campaign in Adtech',
                         req.uuid, oldObj.id, prop, id);
                if (!oldObj.adtechId) {
                    log.warn('[%1] Entry for %2 in %3 has no adtechId, cannot delete it',
                             req.uuid, oldObj.id, prop);
                    return;
                }
                toDelete.push(oldObj.adtechId);
            });
        });
        
        return campaignUtils.deleteCampaigns(toDelete, delay, attempts)
        .then(function() {
            log.trace('[%1] Cleaned sponsored campaigns for %2', req.uuid, req.params.id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error cleaning sponsored campaigns: %2',
                      req.uuid, error && error.stack || error);
            return q.reject('Adtech failure');
        });
    };

    // Middleware to edit sponsored campaigns, updating level 3 keywords if categories change
    campModule.editSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            cats = req.body.categories,
            origCats = req.origObj.categories || [],
            id = req.params.id;
        
        if (!cats || objUtils.compareObjects(cats.sort(), origCats.sort())) {
            log.trace('[%1] Categories unchanged, not editing sponsored campaigns', req.uuid);
            return q(next());
        }
        
        return q.all(['miniReels', 'cards'].map(function(prop) {
            if (!req.origObj[prop]) {
                return q();
            }
            
            var keywords = { level1: (prop === 'cards' ? [id] : undefined), level3: cats };
            return campaignUtils.makeKeywordLevels(keywords)
            .then(function(keys) {
                return q.all(req.origObj[prop].filter(function(oldCamp) {
                    return !req.body[prop] ||
                            campaignUtils.objectify(req.body[prop]).some(function(newCamp) {
                                return newCamp.id === oldCamp.id;
                            });
                }).map(function(camp) {
                    return campaignUtils.editCampaign(camp.adtechId, null, keys);
                }));
            });
        }))
        .then(function() {
            log.trace('[%1] All sponsored campaigns for %2 have been edited', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error editing sponsored campaigns: %2',
                      req.uuid, error && error.stack || error);
            return q.reject('Adtech failure');
        });
    };

    // Middleware to create sponsored miniReel and sponsored card campaigns
    campModule.createSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            cats = req.body.categories || (req.origObj && req.origObj.categories) || [],
            advert = req._advertiserId,
            cust = req._customerId;
            
        return q.all(['miniReels', 'cards'].map(function(prop) {
            var type = prop.replace(/s$/, ''),
                oldList = (req.origObj && req.origObj[prop]) || [],
                keywords = { level1: (type === 'card' ? [id] : undefined), level3: cats };
                
            if (!(req.body[prop] instanceof Array) || req.body[prop].length === 0) {
                log.trace('[%1] No %2 to make campaigns for', req.uuid, prop);
                return q();
            }

            req.body[prop] = campaignUtils.objectify(req.body[prop]).map(function(newObj) {
                var existing = oldList.filter(function(obj) {return obj.id === newObj.id;})[0];
                return existing || newObj;
            });
            
            return campaignUtils.makeKeywordLevels(keywords)
            .then(function(keys) {
                return q.all(req.body[prop].map(function(obj) {
                    if (obj.adtechId) {
                        log.trace('[%1] Campaign %2 already exists for %3',
                                  req.uuid, obj.adtechId, obj.id);
                        return q();
                    }
                    
                    var name = id + '_' + type + '_' + obj.id;
                    return campaignUtils.createCampaign(obj.id, name, true, keys, advert, cust)
                    .then(function(resp) {
                        obj.adtechId = parseInt(resp.id);
                        return bannerUtils.createBanners([obj], null, type, obj.adtechId);
                    });
                }));
            });
        }))
        .then(function() {
            log.trace('[%1] All sponsored campaigns for %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error creating sponsored campaigns: %2',
                      req.uuid, error && error.stack || error);
            return q.reject('Adtech failure');
        });
    };
    
    // Middleware to delete unused target minireel group campaigns on an edit
    campModule.cleanTargetCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.params.id,
            delay = campModule.campsCfg.statusDelay,
            attempts = campModule.campsCfg.statusAttempts,
            toDelete = [];
        
        if (!req.origObj.miniReelGroups || !req.body.miniReelGroups) {
            return q(next());
        }
        
        req.origObj.miniReelGroups.forEach(function(oldObj, idx) {
            if (!oldObj.adtechId) {
                log.warn('[%1] Entry %2 in miniReelGroups array for %3 has no adtechId',
                         req.uuid, idx, id);
                return;
            }
            if (req.body.miniReelGroups.some(function(newObj) {
                return newObj.adtechId === oldObj.adtechId;
            })) {
                log.trace('[%1] Campaign for %2 still exists for %3',req.uuid, oldObj.adtechId, id);
                return;
            }
            
            log.info('[%1] %2 removed from miniReelGroups in %3, deleting its campaign in Adtech',
                     req.uuid, oldObj.adtechId, id);
            toDelete.push(oldObj.adtechId);
        });
        return campaignUtils.deleteCampaigns(toDelete, delay, attempts)
        .then(function() {
            log.trace('[%1] Cleaned target campaigns for %2', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error cleaning target campaigns: %2',
                      req.uuid, error && error.stack || error);
            return q.reject('Adtech failure');
        });
    };
    
    // Middleware to edit target group campaigns, updating banner list + keywords
    campModule.editTargetCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.params.id;
            
        if (!req.body.miniReelGroups || !req.origObj.miniReelGroups) {
            return q(next());
        }
        
        return q.all((req.body.miniReelGroups).map(function(group) {
            group.miniReels = campaignUtils.objectify(group.miniReels);
            
            var existing = req.origObj.miniReelGroups.filter(function(oldGroup) {
                return oldGroup.adtechId === group.adtechId;
            })[0];
            
            if (!existing) {
                return q();
            }
            
            return ( (objUtils.compareObjects(group.cards.sort(), existing.cards.sort())) ? q() :
                campaignUtils.makeKeywordLevels({level1: group.cards}).then(function(keys) {
                    return campaignUtils.editCampaign(group.adtechId, null, keys);
                })
            )
            .then(function() {
                return bannerUtils.cleanBanners(group.miniReels,existing.miniReels,group.adtechId);
            })
            .then(function() {
                return bannerUtils.createBanners(
                    group.miniReels,
                    existing.miniReels,
                    'contentMiniReel',
                    group.adtechId
                );
            });
        }))
        .then(function() {
            log.trace('[%1] All target groups for %2 are up to date', req.uuid, id);
            next();
        })
        .catch(function(err) {
            log.error('[%1] Error editing target campaigns: %2', req.uuid, err && err.stack || err);
            return q.reject('Adtech failure');
        });
    };
        
    // Middleware to create target minireel group campaigns from miniReelGroups property
    campModule.createTargetCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            advert = req._advertiserId,
            cust = req._customerId;
        
        if (!req.body.miniReelGroups) {
            return q(next());
        }
        
        return q.all(req.body.miniReelGroups.map(function(obj, idx) {
            if (obj.adtechId) {
                log.trace('[%1] Group campaign %2 already created', req.uuid, obj.adtechId);
                return q();
            }
            if (!(obj.cards instanceof Array) || obj.cards.length === 0) {
                log.info('[%1] Cards array was empty, skipping group %2', req.uuid, idx);
                return q();
            }
            if (!(obj.miniReels instanceof Array) || obj.miniReels.length === 0) {
                log.info('[%1] Minireels array was empty, skipping group %2', req.uuid, idx);
                return q();
            }

            var name = id + '_group_' + uuid.createUuid().substr(0, 8);
            
            return campaignUtils.makeKeywordLevels({ level1: obj.cards })
            .then(function(keys) {
                return campaignUtils.createCampaign(id, name, false, keys, advert, cust);
            })
            .then(function(resp) {
                obj.adtechId = parseInt(resp.id);
                obj.miniReels = campaignUtils.objectify(obj.miniReels);
                
                return bannerUtils.createBanners(obj.miniReels,null,'contentMiniReel',obj.adtechId);
            });
        }))
        .then(function() {
            log.trace('[%1] All target groups for %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(err) {
            log.error('[%1] Error creating target campaigns: %2',req.uuid, err && err.stack || err);
            return q.reject('Adtech failure');
        });
    };

    /* Send a DELETE request to the content service. type should be "card" or "experience"
     * Logs + swallows 4xx failures, but rejects 5xx failures. */
    campModule.sendDeleteRequest = function(req, id, type) {
        var log = logger.getLog();
        
        return requestUtils.qRequest('delete', {
            url: req.protocol + '://' + campModule.contentHost + '/api/content/' + type + '/' + id,
            headers: { cookie: req.headers.cookie }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 204) {
                log.warn('[%1] Could not delete %2 %3. Received (%4, %5)',
                         req.uuid, type, id, resp.response.statusCode, resp.body);
            } else {
                log.info('[%1] Succesfully deleted %2 %3', req.uuid, type, id);
            }
        })
        .catch(function(error) {
            log.error('[%1] Error deleting %2 %3: %4', req.uuid, type, id, util.inspect(error));
            return q.reject('Failed sending delete request to content service');
        });
    };
    
    // Middleware to delete all sponsored content associated with this to-be-deleted campaign
    campModule.deleteContent = function(req, next/*, done*/) {
        var log = logger.getLog();
            
        return q.all(
            (req.origObj.cards || []).map(function(card) {
                return campModule.sendDeleteRequest(req, card.id, 'card');
            })
            .concat((req.origObj.miniReels || []).map(function(exp) {
                return campModule.sendDeleteRequest(req, exp.id, 'experience');
            }))
        )
        .then(function() {
            log.trace('[%1] Successfully deleted content for campaign %2',req.uuid,req.origObj.id);
            next();
        });
    };
    
    // Middleware to delete all sponsored and target adtech campaigns for this C6 campaign
    campModule.deleteAdtechCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            delay = campModule.campsCfg.statusDelay,
            attempts = campModule.campsCfg.statusAttempts,
            toDelete = [];
            
        log.trace('[%1] Deleting all sponsored + target campaigns for %2', req.uuid, req.params.id);

        ['cards', 'miniReels', 'miniReelGroups'].forEach(function(prop) {
            if (!req.origObj[prop]) {
                return;
            }
            
            for (var idx in req.origObj[prop]) {
                if (!req.origObj[prop][idx].adtechId) {
                    log.warn('[%1] Item %2 from %3 array has no adtechId', req.uuid, idx, prop);
                    continue;
                }
                toDelete.push(req.origObj[prop][idx].adtechId);
            }
        });
        
        return campaignUtils.deleteCampaigns(toDelete, delay, attempts)
        .then(function() {
            log.info('[%1] Deleted all adtech campaigns for %2', req.uuid, req.params.id);
            next();
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
            if (req.query.name) {
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
            svc.deleteObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting campaign', detail: error });
            });
        });
    };
    
    module.exports = campModule;
}());
