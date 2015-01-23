(function(){
    'use strict';

    var q               = require('q'),
        // adtech          = require('adtech'),
        uuid            = require('../lib/uuid'),
        campaignUtils   = require('../lib/campaignUtils'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        
        campModule = {};


    campModule.setupSvc = function(db) {
        var campColl = db.collection('campaigns'),
            campSvc = new CrudSvc(campColl, 'cam', { userProp: false, orgProp: false });
        campSvc._cardColl = db.collection('cards');
        campSvc._expColl = db.collection('experiences');
        campSvc._advertColl = db.collection('advertisers');
        campSvc._custColl = db.collection('customers');
        
        campSvc.createValidator._required.push('advertiserId', 'customerId');
        campSvc.createValidator._forbidden.push('adtechId');
        campSvc.editValidator._forbidden.push('advertiserId', 'customerId');

        campSvc.createValidator._formats.cards = ['string'];
        campSvc.editValidator._formats.cards = ['string'];
        campSvc.createValidator._formats.miniReels = ['string'];
        campSvc.editValidator._formats.miniReels = ['string'];
        campSvc.createValidator._formats.miniReelGroups = ['object'];
        campSvc.editValidator._formats.miniReelGroups = ['object'];
        campSvc.createValidator._formats.categories = ['string'];
        campSvc.editValidator._formats.categories = ['string'];

        campSvc.use('read', campSvc.preventGetAll.bind(campSvc));
        campSvc.use('create', campModule.getAccountIds.bind(campModule, campSvc));
        campSvc.use('create', campModule.createSponsoredCamps);
        campSvc.use('create', campModule.createTargetCamps);
        campSvc.use('edit', campModule.getAccountIds.bind(campModule, campSvc));
        campSvc.use('edit', campModule.createSponsoredCamps);
        campSvc.use('edit', campModule.createTargetCamps);
        campSvc.use('edit', campModule.editTargetCamps);
        campSvc.use('delete', campModule.deleteContent.bind(campModule, campSvc));
        
        campSvc.formatOutput = campModule.formatOutput.bind(campModule, campSvc);
        
        return campSvc;
    };
    
    // TODO: revisit these functions - clean up/modularize, move code to campaignUtils, etc.
    
    // Extends CrudSvc.prototype.formatOutput, processing cards, miniReels, and miniReelGroups
    campModule.formatOutput = function(svc, obj) {
        ['cards', 'miniReels'].forEach(function(key) {
            obj[key] = (obj[key] || []).map(function(contentObj) { return contentObj.id; });
        });
        
        (obj.miniReelGroups || []).forEach(function(group) {
            if (!(group.miniReels instanceof Array)) {
                return;
            }

            group.miniReels = group.miniReels.map(function(reelObj) { return reelObj.id; });
        });
        
        return CrudSvc.prototype.formatOutput.call(svc, obj);
    };
    
    // Get adtech ids for advertiser and customer by searching mongo; attaches them to req
    campModule.getAccountIds = function(svc, req, next, done) {
        var log = logger.getLog(),
            doneCalled = false;
        
        function lookup(key, coll) {
            var c6Id = req.body[key] || (req.origObj && req.origObj[key]) || null,
                objName = key.replace(/Id$/, '');
            if (!c6Id) {
                return q();
            }
            
            return q.npost(coll, 'findOne', [{id: String(c6Id)}, {id: 1, adtechId: 1}])
            .then(function(obj) {
                if (!obj) {
                    log.warn('[%1] Could not find %2 %3', req.uuid, objName, c6Id);
                    if (!doneCalled) {
                        doneCalled = true;
                        return done({code: 400, body: objName + ' ' + c6Id + ' does not exist'});
                    } else {
                        return q();
                    }
                }
                req['_' + key] = parseInt(obj.adtechId);
            })
            .catch(function(error) {
                log.error('[%1] Error looking up %2 %3: %4', req.uuid, objName, c6Id, error);
                return q.reject(new Error('Mongo failure'));
            });
        }
        
        return q.all([lookup('advertiserId', svc._advertColl), lookup('customerId', svc._custColl)])
        .then(function() {
            if (!doneCalled) {
                next();
            }
        });
    };
    
/*
New middleware flow:

Note:
each entry in `miniReelGroup` should also have an `adtechId` so we can edit/delete/find the campaign

create:
done - for each card in `cards`, create a campaign, plus a banner in that campaign
done - for each exp in `miniReels`, create a campaign, plus a banner in that campaign
done - for each entry in `miniReelGroups`, create campaign, plus banners for id in `miniReels`

edit:
- clean old unused card campaigns
- clean old unused sponsored minireel campaigns
done - create new card campaigns
done - create new sponsored minireel campaigns
- edit existing card/sponsored minireel campaigns' category list???
- diff `miniReelGroup` list:
done- new objects (those without `adtechId`) in the list get new campaign plus banners
    - unused campaigns (those in origObj w/ `adtechId` no longer present in new) should get deleted
    - existing objects (those in origObj w/ `adtechId` still present in new) with different cards
      should have their kwlp1 list updated
done- existing objects with different miniReels should have their banners updated

delete:
- DELETE ALL THE THINGS (aka every campaign for cards, miniReels, miniReelGroups)
*/

    // Creates multiple sponsored campaigns of a given type
    /*
    campModule.makeSponsoredCamps = function(id, objs, type, categories, advertiserId, customerId) {
        var log = logger.getLog(),
            keys = {};
            
        if (!(objs instanceof Array) || objs.length === 0) {
            log.trace('No %1 campaigns to make', type);
            return q();
        }
        
        return campaignUtils.makeKeywords(categories || [])
        .then(function(kwlp3Ids) {
            keys.level3 = kwlp3Ids;
            if (type === 'card') {
                return campaignUtils.makeKeywords([id]);
            } else {
                return q();
            }
        })
        .then(function(kwlp1Ids) {
            keys.level1 = kwlp1Ids;
            return q.all(objs.map(function(obj) {
                if (obj.adtechId) {
                    log.info('Campaign %1 already exists for %2', obj.adtechId, obj.id);
                    return q();
                }
                
                var name = id + '_' + type + '_' + obj.id;
                return campaignUtils.createCampaign(id, name, true, keys, advertiserId, customerId)
                .then(function(resp) {
                    obj.adtechId = parseInt(resp.id);
                    return campaignUtils.createBanners([obj], null, type, obj.adtechId);
                });
            }));
        });
    };
    */
    
    // Middleware to create sponsored miniReel and sponsored card campaigns
    campModule.createSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            cats = req.body.categories || (req.origObj && req.origObj.categories) || [],
            advert = req._advertiserId,
            cust = req._customerId;
            
        return q.all(['miniReels', 'cards'].map(function(key) {
            var type = key.replace(/s$/, ''),
                keywords = { level1: (type === 'card' ? [id] : undefined), level3: cats };

            if (!(req.body[key] instanceof Array) || req.body[key].length === 0) {
                log.trace('[%1] No %2 to make campaigns for', req.uuid, key);
                return q();
            }

            req.body[key] = req.body[key].map(function(newId) {
                var oldList = (req.origObj && req.origObj[key]) || [],
                    existing = oldList.filter(function(oldObj) { return oldObj.id === newId; })[0];
                
                return existing || { id: newId };
            });
            
            return campaignUtils.makeKeywordLevels(keywords)
            .then(function(keys) {
                return q.all(req.body[key].map(function(obj) {
                    if (obj.adtechId) {
                        log.trace('[%1] Campaign %2 already exists for %3',
                                  req.uuid, obj.adtechId, obj.id);
                        return q();
                    }
                    
                    var name = id + '_' + type + '_' + obj.id;
                    return campaignUtils.createCampaign(id, name, true, keys, advert, cust)
                    .then(function(resp) {
                        obj.adtechId = parseInt(resp.id);
                        return campaignUtils.createBanners([obj], null, type, obj.adtechId);
                    });
                }));
            });
        }))
        .then(function() {
            log.trace('[%1] All sponsored campaigns for %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error creating sponsored campaigns: %2', req.uuid, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Middleware to create target minireel group campaigns from miniReelGroups property
    campModule.createTargetCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            name = id + '_group_' + uuid.createUuid().substr(0, 8),
            advert = req._advertiserId,
            cust = req._customerId;
        
        if (!req.body.miniReelGroups) {
            return q(next());
        }
        
        return q.all(req.body.miniReelGroups.map(function(obj) {
            if (obj.adtechId) {
                log.trace('[%1] Group campaign %2 already created', req.uuid, obj.adtechId);
                return q();
            }
            if (!(obj.cards instanceof Array) || obj.cards.length === 0) {
                log.trace('[%1] Cards array was empty, skipping this group', req.uuid);
                return q();
            }
            if (!(obj.miniReels instanceof Array) || obj.miniReels.length === 0) {
                log.trace('[%1] Minireels array was empty, skipping this group', req.uuid);
                return q();
            }
            
            return campaignUtils.makeKeywordLevels({ level1: obj.cards })
            .then(function(keys) {
                return campaignUtils.createCampaign(id, name, false, keys, advert, cust);
            })
            .then(function(resp) {
                obj.adtechId = parseInt(resp.id);
                obj.miniReels = obj.miniReels.map(function(mrId) { return {id: mrId}; });

                return campaignUtils.createBanners(obj.miniReels, null,
                                                   'contentMiniReel', obj.adtechId);
            });
        }))
        .then(function() {
            log.trace('[%1] All target groups for %2 have been created', req.uuid, id);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error creating target campaigns: %2', req.uuid, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Middleware to edit target group campaigns, updating banner list
    campModule.editTargetCamps = function(req, next/*, done*/) {
        //TODO: also edit kwlp1 keys if different cards...
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id);
        
        return q.all((req.body.miniReelGroups || []).map(function(group) {
            var existing = req.origObj.miniReelGroups.filter(function(oldGroup) {
                return oldGroup.adtechId === group.adtechId;
            })[0];
            
            if (!existing) {
                return q();
            }
            
            group.miniReels = (group.miniReels || []).map(function(mrId) { return { id: mrId }; });
            
            return campaignUtils.cleanBanners(group.miniReels, existing.miniReels, group.adtechId)
            .then(function() {
                return campaignUtils.createBanners(
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
        .catch(function(error) {
            log.error('[%1] Error editing target campaigns: %2', req.uuid, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Middleware to delete all sponsored content associated with this to-be-deleted campaign
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
