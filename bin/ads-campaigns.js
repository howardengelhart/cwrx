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

    campModule.setupSvc = function(db, config, jobManager) {
        campModule.campsCfg = config.campaigns;
        campModule.contentHost = config.contentHost;
    
        var campColl = db.collection('campaigns'),
            svc = new CrudSvc(campColl, 'cam', {}, jobManager);
        svc._advertColl = db.collection('advertisers');
        svc._custColl = db.collection('customers');
        
        svc.createValidator._required.push('advertiserId', 'customerId');
        svc.editValidator._forbidden.push('advertiserId', 'customerId');

        svc.createValidator._formats.cards = ['object'];
        svc.editValidator._formats.cards = ['object'];
        svc.createValidator._formats.miniReels = ['object'];
        svc.editValidator._formats.miniReels = ['object'];
        svc.createValidator._formats.miniReelGroups = ['object'];
        svc.editValidator._formats.miniReelGroups = ['object'];
        svc.createValidator._formats.categories = ['string'];
        svc.editValidator._formats.categories = ['string'];
        svc.createValidator._formats.staticCardMap = 'object';
        svc.editValidator._formats.staticCardMap = 'object';

        svc.use('create', campaignUtils.getAccountIds.bind(campaignUtils, svc._advertColl,
                                                           svc._custColl));
        svc.use('create', campModule.validateDates);
        svc.use('create', campModule.ensureUniqueIds);
        svc.use('create', campModule.ensureUniqueNames);
        svc.use('create', campModule.createSponsoredCamps);
        svc.use('create', campModule.createTargetCamps);
        svc.use('edit', campaignUtils.getAccountIds.bind(campaignUtils, svc._advertColl,
                                                         svc._custColl));
        svc.use('edit', campModule.extendListObjects);
        svc.use('edit', campModule.validateDates);
        svc.use('edit', campModule.ensureUniqueIds);
        svc.use('edit', campModule.ensureUniqueNames);
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
    
    // Attempts to find a sub-object in body[key] that matches target
    campModule.findMatchingObj = function(target, body, key) {
        if (!target) {
            return undefined;
        }
    
        return (body && body[key] || []).filter(function(obj) {
            return key === 'miniReelGroups' ? obj.adtechId === target.adtechId :
                                              obj.id === target.id;
        })[0];
    };
    
    // Copy props from origObj missing from each sub-campaign object that still exists in req.body
    campModule.extendListObjects = function(req, next/*, done*/) {
        ['miniReels', 'cards', 'miniReelGroups'].forEach(function(key) {
            if (!req.body[key] || !req.origObj[key]) {
                return;
            }
            
            req.body[key].forEach(function(newObj) {
                var existing = campModule.findMatchingObj(newObj, req.origObj, key);
                    
                objUtils.extend(newObj, existing);
            });
        });
        return q(next());
    };
    
    // Calls campaignUtils.validateDates for every object in cards, miniReels, and miniReelGroups
    campModule.validateDates = function(req, next, done) {
        var keys = ['cards', 'miniReels', 'miniReelGroups'],
            delays = campModule.campsCfg.dateDelays;
            
        for (var i = 0; i < keys.length; i++) {
            if (!req.body[keys[i]]) {
                continue;
            }
            
            for (var j = 0; j < req.body[keys[i]].length; j++) {
                var obj = req.body[keys[i]][j],
                    existing = campModule.findMatchingObj(obj, req.origObj, keys[i]);
                    
                if (!campaignUtils.validateDates(obj, existing, delays, req.uuid)) {
                    return q(done({code: 400, body: keys[i] + '[' + j + '] has invalid dates'}));
                }
            }
        }
        return q(next());
    };

    // Ensures that cards and miniReels lists have unique ids for camp + each miniReelGroup
    campModule.ensureUniqueIds = function(req, next, done) {
        var log = logger.getLog(),
            groups = req.body.miniReelGroups || [],
            keys = ['miniReels', 'cards'];
            
        function getId(obj) { return obj.id; }

        for (var i = 0; i < keys.length; i++) {
            var ids = (req.body[keys[i]] instanceof Array) && req.body[keys[i]].map(getId);
            if (!objUtils.isListDistinct(ids)) {
                log.info('[%1] %2 must be distinct: %3', req.uuid, keys[i], ids);
                return q(done({code: 400, body: keys[i] + ' must be distinct'}));
            }
            
            for (var j = 0; j < groups.length; j++) {
                if (!objUtils.isListDistinct(groups[j][keys[i]])) {
                    var msg = 'miniReelGroups[' + j + '].' + keys[i] + ' must be distinct';
                    log.info('[%1] %2: %3', req.uuid, msg, groups[j][keys[i]]);
                    return q(done({code: 400, body: msg}));
                }
            }
        }
        return q(next());
    };

    // Ensures that names are unique across all miniReels, cards, and miniReelGroups in campaign
    campModule.ensureUniqueNames = function(req, next, done) {
        var log = logger.getLog(),
            names = [],
            keys = ['miniReels', 'cards', 'miniReelGroups'];

        for (var i = 0; i < keys.length; i++) {
            if (!req.body[keys[i]]) {
                continue;
            }
            
            for (var j = 0; j < req.body[keys[i]].length; j++) {
                var obj = req.body[keys[i]][j];
                if (!obj.name) {
                    continue;
                }
                
                if (names.indexOf(obj.name) !== -1) {
                    var msg = keys[i] + '[' + j + ']' + ' has a non-unique name';
                    log.info('[%1] %2: %3', req.uuid, msg, obj.name);
                    return q(done({code: 400, body: msg}));
                } else {
                    names.push(obj.name);
                }
            }
        }
        return q(next());
    };
    
    // Extends CrudSvc.prototype.formatOutput, processing cards, miniReels, and miniReelGroups
    campModule.formatOutput = function(svc, obj) {
        (obj.miniReelGroups || []).forEach(function(group) {
            if (!(group.miniReels instanceof Array)) {
                return;
            }

            group.miniReels = group.miniReels.map(function(reelObj) { return reelObj.id; });
        });
        
        return CrudSvc.prototype.formatOutput.call(svc, obj);
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
            return q.reject(new Error('Failed sending delete request to content service'));
        });
    };
    
    // Remove entries from the staticCardMap for deleted sponsored cards
    campModule.cleanStaticMap = function(req, toDelete) {
        var map = req.body.staticCardMap = req.body.staticCardMap ||
                  (req.origObj && req.origObj.staticCardMap) || undefined;
        
        if (!toDelete || !(map instanceof Object)) {
            return;
        }
        
        Object.keys(map).forEach(function(expId) {
            if (!(map[expId] instanceof Object)) {
                return;
            }
            
            Object.keys(map[expId]).forEach(function(plId) {
                if (toDelete.indexOf(map[expId][plId]) !== -1) {
                    delete map[expId][plId];
                }
            });
        });
    };

    /* Middleware to delete unused sponsored miniReels and cards. Deletes their campaigns from
     * Adtech, as well their objects in mongo through the content service */
    campModule.cleanSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            delay = campModule.campsCfg.statusDelay,
            attempts = campModule.campsCfg.statusAttempts,
            toDelete = { adtechIds: [], miniReels: [], cards: [] };
        
        ['miniReels', 'cards'].forEach(function(prop) {
            if (!req.origObj || !req.origObj[prop] || !req.body[prop]) {
                return;
            }
            
            req.origObj[prop].forEach(function(oldObj) {
                if (req.body[prop].some(function(newObj) { return newObj.id === oldObj.id; })) {
                    log.trace('[%1] Campaign for %2 still exists for %3', req.uuid, oldObj.id, id);
                    return;
                }
                
                log.info('[%1] Item %2 with adtechId %3 removed from %4 in %5, deleting it',
                         req.uuid, oldObj.id, oldObj.adtechId, prop, id);
                toDelete[prop].push(oldObj.id);
                         
                if (!oldObj.adtechId) {
                    log.warn('[%1] Entry for %2 in %3 has no adtechId, cannot delete its campaign',
                             req.uuid, oldObj.id, prop);
                } else {
                    toDelete.adtechIds.push(oldObj.adtechId);
                }
                
            });
        });
        
        campModule.cleanStaticMap(req, toDelete.cards);
        
        return campaignUtils.deleteCampaigns(toDelete.adtechIds, delay, attempts)
        .then(function() {
            log.trace('[%1] Cleaned sponsored Adtech campaigns for %2', req.uuid, req.params.id);
            
            return q.all(
                toDelete.miniReels.map(function(id) {
                    return campModule.sendDeleteRequest(req, id, 'experience');
                }).concat(toDelete.cards.map(function(id) {
                    return campModule.sendDeleteRequest(req, id, 'card');
                }))
            );
        }).then(function() {
            log.trace('[%1] Deleted all unused content for %2', req.uuid, req.params.id);
            next();
        });
    };

    // Middleware to edit sponsored campaigns. Can edit keywords, name, startDate, & endDate
    campModule.editSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            cats = req.body.categories,
            origCats = req.origObj.categories || [],
            id = req.params.id;
        
        return q.all(['miniReels', 'cards'].map(function(prop) {
            var promise;
            if (!req.origObj[prop]) {
                return q();
            }

            if (!cats || objUtils.compareObjects(cats.slice().sort(), origCats.slice().sort())) {
                promise = q();
            } else {
                var keywords = { level1: (prop === 'cards' ? [id] : undefined), level3: cats };
                promise = campaignUtils.makeKeywordLevels(keywords);
            }
            
            return promise.then(function(keys) {
                
                return q.all(req.origObj[prop].map(function(oldCamp) {
                    var matching = campModule.findMatchingObj(oldCamp, req.body, prop);
                    
                    if (!matching) { // don't edit old camps that no longer exist in new version
                        return q();
                    }
                    
                    // Only edit sponsored campaign if some fields have changed
                    if (!keys && ['name', 'startDate', 'endDate'].every(function(field) {
                        return matching[field] === oldCamp[field];
                    })) {
                        return q();
                    } else {
                        log.info('[%1] Campaign %2 for %3 changed, updating',
                                 req.uuid, oldCamp.adtechId, oldCamp.id);

                        return campaignUtils.editCampaign(
                            matching.name + ' (' + id + ')',
                            matching,
                            keys,
                            req.uuid
                        );
                    }
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
            cats = req.body.categories || (req.origObj && req.origObj.categories) || [];
            
        return q.all(['miniReels', 'cards'].map(function(prop) {
            var type = prop.replace(/s$/, ''),
                keyLevels = { level1: (type === 'card' ? [id] : undefined), level3: cats };
                
            if (!(req.body[prop] instanceof Array) || req.body[prop].length === 0) {
                log.trace('[%1] No %2 to make campaigns for', req.uuid, prop);
                return q();
            }
            
            return campaignUtils.makeKeywordLevels(keyLevels)
            .then(function(keywords) {
                return q.all(req.body[prop].map(function(obj) {
                    if (obj.adtechId) {
                        log.trace('[%1] Campaign %2 already exists for %3',
                                  req.uuid, obj.adtechId, obj.id);
                        return q();
                    }
                    
                    obj.name = obj.name || type + '_' + obj.id;
                    
                    return campaignUtils.createCampaign({
                        id              : obj.id,
                        name            : obj.name + ' (' + id + ')',
                        startDate       : obj.startDate,
                        endDate         : obj.endDate,
                        campaignTypeId  : campModule.campsCfg.campaignTypeId,
                        keywords        : keywords,
                        advertiserId    : req._advertiserId,
                        customerId      : req._customerId
                    }, req.uuid)
                    .then(function(resp) {
                        obj.adtechId = parseInt(resp.id);
                        return bannerUtils.createBanners([obj], null, type, true, obj.adtechId);
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
    
    // Middleware to edit target group campaigns. Can edit keywords, name, startDate, & endDate
    campModule.editTargetCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.params.id,
            promise;
            
        if (!req.body.miniReelGroups || !req.origObj.miniReelGroups) {
            return q(next());
        }
        
        return q.all((req.body.miniReelGroups).map(function(group) {
            group.miniReels = campaignUtils.objectify(group.miniReels);
            
            var orig = campModule.findMatchingObj(group, req.origObj, 'miniReelGroups');
            
            if (!orig) { // only edit already existing groups
                return q();
            }
            
            if (objUtils.compareObjects(group.cards.slice().sort(), orig.cards.slice().sort())) {
                promise = q();
            } else {
                promise = campaignUtils.makeKeywordLevels({level1: group.cards});
            }
            
            return promise.then(function(keys) {
                // Only edit group campaign if some fields have changed
                if (!keys && ['name', 'startDate', 'endDate'].every(function(field) {
                    return group[field] === orig[field];
                })) {
                    return q();
                } else {
                    log.info('[%1] Campaign %2 for "%3" changed, updating',
                             req.uuid, group.adtechId, group.name);

                    return campaignUtils.editCampaign(
                        group.name + ' (' + id + ')',
                        group,
                        keys,
                        req.uuid
                    );
                }
            })
            .then(function() {
                return bannerUtils.cleanBanners(group.miniReels, orig.miniReels, group.adtechId);
            })
            .then(function() {
                return bannerUtils.createBanners(
                    group.miniReels,
                    orig.miniReels,
                    'contentMiniReel',
                    false,
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
            id = req.body.id || (req.origObj && req.origObj.id);
        
        if (!req.body.miniReelGroups) {
            return q(next());
        }
        
        return q.all(req.body.miniReelGroups.map(function(obj) {
            if (obj.adtechId) {
                log.trace('[%1] Group campaign %2 already created', req.uuid, obj.adtechId);
                return q();
            }
            
            obj.cards = obj.cards || [];
            obj.miniReels = obj.miniReels || [];

            
            return campaignUtils.makeKeywordLevels({ level1: obj.cards })
            .then(function(keywords) {
                obj.name = obj.name || 'group_' + uuid.createUuid().substr(0, 8);

                return campaignUtils.createCampaign({
                    id              : id,
                    name            : obj.name + ' (' + id + ')',
                    startDate       : obj.startDate,
                    endDate         : obj.endDate,
                    campaignTypeId  : campModule.campsCfg.campaignTypeId,
                    keywords        : keywords,
                    advertiserId    : req._advertiserId,
                    customerId      : req._customerId
                }, req.uuid);
            })
            .then(function(resp) {
                obj.adtechId = parseInt(resp.id);
                obj.miniReels = campaignUtils.objectify(obj.miniReels);
                
                return bannerUtils.createBanners(
                    obj.miniReels,
                    null,
                    'contentMiniReel',
                    false,
                    obj.adtechId
                );
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
            svc.getObjs({id: req.params.id}, req, res, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving campaign', detail: error });
            });
        });

        app.get('/api/campaigns', sessions, authGetCamp, audit, function(req, res) {
            var query = {};
            ['user', 'org', 'name']
            .forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            svc.getObjs(query, req, res, true).then(function(resp) {
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
            svc.createObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating campaign', detail: error });
            });
        });

        var authPutCamp = authUtils.middlewarify({campaigns: 'edit'});
        app.put('/api/campaign/:id', sessions, authPutCamp, audit, function(req, res) {
            svc.editObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating campaign', detail: error });
            });
        });

        var authDelCamp = authUtils.middlewarify({campaigns: 'delete'});
        app.delete('/api/campaign/:id', sessions, authDelCamp, audit, function(req, res) {
            svc.deleteObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting campaign', detail: error });
            });
        });
    };
    
    module.exports = campModule;
}());
