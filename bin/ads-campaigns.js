(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        express         = require('express'),
        requestUtils    = require('../lib/requestUtils'),
        uuid            = require('../lib/uuid'),
        campaignUtils   = require('../lib/campaignUtils'),
        bannerUtils     = require('../lib/bannerUtils'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        
        campModule = { config: {} };
        
    var sponsoredCampSchema = { // for entries in cards + miniReels arrays
        id: {
            __allowed: true,
            __required: true,
            __type: 'string'
        },
        adtechId: {
            __allowed: false,
            __type: 'number',
            __locked: true
        },
        bannerNumber: {
            __allowed: false,
            __type: 'number',
            __locked: true
        },
        bannerId: {
            __allowed: false,
            __type: 'number',
            __locked: true
        },
        name: {
            __allowed: false,
            __type: 'string'
        },
        startDate: {
            __allowed: false,
            __type: 'string' // stored as Date().toISOString()
        },
        endDate: {
            __allowed: false,
            __type: 'string' // stored as Date().toISOString()
        },
        reportingId: {
            __allowed: false,
            __type: 'string'
        }
    };
         
    campModule.campSchema = {
        status: { // will be changed in later releases
            __allowed: true,
            __type: 'string'
        },
        application: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __default: 'studio'
        },
        advertiserId: {
            __allowed: false,
            __unchangeable: true,
            __type: 'string'
        },
        customerId: {
            __allowed: false,
            __unchangeable: true,
            __type: 'string'
        },
        minViewTime: {
            __allowed: false,
            __type: 'number'
        },
        pricing: {
            budget: {
                __allowed: true,
                __required: true,
                __type: 'number',
                __min: 50,
                __max: 20000
            },
            dailyLimit: {
                __allowed: true,
                __type: 'number',
                __percentMin: 0.015,    // used internally, not in model.validate()
                __percentMax: 1,        // used internally, not in model.validate()
                __percentDefault: 0.03  // used internally, not in model.validate() 
            },
            model: {
                __allowed: false,
                __type: 'string',
                __default: 'cpv'
            },
            cost: {
                __allowed: false,
                __type: 'number'
            }
        },
        pricingHistory: {
            __allowed: false,
            __type: 'objectArray',
            __locked: true
        },
        contentCategories: {
            primary: {
                __allowed: true,
                __type: 'string'
            }
        },
        targeting: {
            __allowed: true,
            geo: {
                __allowed: true,
                states: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                dmas: {
                    __allowed: true,
                    __type: 'stringArray'
                }
            },
            demographics: {
                __allowed: true,
                gender: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                age: {
                    __allowed: true,
                    __type: 'stringArray'
                },
                income: {
                    __allowed: true,
                    __type: 'stringArray'
                }
            },
            interests: {
                __allowed: true,
                __type: 'stringArray'
            }
        },
        staticCardMap: {
            __allowed: false,
            __type: 'object'
        },
        cards: {
            __allowed: true,
            __unchangeable: true,
            __type: 'objectArray',
            __length: 1,
            __entries: sponsoredCampSchema
        },
        miniReels: {
            __allowed: false,
            __type: 'objectArray',
            __entries: sponsoredCampSchema
        },
        miniReelGroups: { // effectively deprecated, so don't bother validating entries
            __allowed: false,
            __type: 'objectArray'
        }
    };

    campModule.setupSvc = function(db, config) {
        campModule.config.campaigns = config.campaigns;
        campModule.config.contentHost = config.contentHost;
    
        var campColl = db.collection('campaigns'),
            svc = new CrudSvc(campColl, 'cam', { statusHistory: true }, campModule.campSchema);
        svc._db = db;
        
        var getAccountIds = campaignUtils.getAccountIds.bind(campaignUtils, svc._db);
        
        svc.use('read', campModule.formatTextQuery);

        svc.use('create', campModule.defaultAccountIds);
        svc.use('create', getAccountIds);
        svc.use('create', campModule.validateDates);
        svc.use('create', campModule.ensureUniqueIds);
        svc.use('create', campModule.ensureUniqueNames);
        svc.use('create', campModule.defaultReportingId);
        svc.use('create', campModule.validatePricing);
        svc.use('create', campModule.createSponsoredCamps);
        svc.use('create', campModule.createTargetCamps);
        svc.use('create', campModule.handlePricingHistory);

        svc.use('edit', campModule.defaultAccountIds);
        svc.use('edit', getAccountIds);
        svc.use('edit', campModule.extendListObjects);
        svc.use('edit', campModule.validateDates);
        svc.use('edit', campModule.ensureUniqueIds);
        svc.use('edit', campModule.ensureUniqueNames);
        svc.use('edit', campModule.defaultReportingId);
        svc.use('edit', campModule.validatePricing);
        svc.use('edit', campModule.cleanSponsoredCamps);
        svc.use('edit', campModule.editSponsoredCamps);
        svc.use('edit', campModule.createSponsoredCamps);
        svc.use('edit', campModule.cleanTargetCamps);
        svc.use('edit', campModule.editTargetCamps);
        svc.use('edit', campModule.createTargetCamps);
        svc.use('edit', campModule.handlePricingHistory);

        svc.use('delete', campModule.deleteContent);
        svc.use('delete', campModule.deleteAdtechCamps);

        svc.formatOutput = campModule.formatOutput.bind(campModule, svc);
        
        return svc;
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
    
    // Format a 'text search' query: current just turns it into a regex query on name field
    campModule.formatTextQuery = function(req, next/*, done*/) {
        if (!req._query || !req._query.text) {
            return next();
        }
        
        var textParts = req._query.text.trim().split(/\s+/),
            nameQuery = { $regex: '.*' + textParts.join('.*') + '.*', $options: 'i' };
        
        // don't overwrite an actual 'name' filter if provided
        req._query.name = req._query.name || nameQuery;
        delete req._query.text;

        return next();
    };

    // Set advertiserId and customerId on the body to the user's advert + cust ids, if not defined
    campModule.defaultAccountIds = function(req, next, done) {
        var log = logger.getLog();

        if ((req.body.advertiserId && req.body.customerId) ||
            (req.origObj && req.origObj.advertiserId && req.origObj.customerId)) {
            return next();
        }
        
        req.body.advertiserId = req.user.advertiser;
        req.body.customerId = req.user.customer;
        
        if (!(req.body.advertiserId && req.body.customerId)) {
            log.info('[%1] Advertiser + customer must be set on campaign or user', req.uuid);
            return done({
                code: 400,
                body: 'Must provide advertiserId + customerId'
            });
        }
        
        return next();
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
            delays = campModule.config.campaigns.dateDelays;
            
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

    // Set the reportingId for each card without one to the campaign's name
    campModule.defaultReportingId = function(req, next/*, done*/) {
        if (!req.body.cards) {
            return next();
        }
        
        req.body.cards.forEach(function(card) {
            if (!card.reportingId) {
                card.reportingId = req.body.name || (req.origObj && req.origObj.name);
            }
        });
        
        return next();
    };

    // Compute cost for the campaign, based on targeting added
    campModule.computeCost = function(/*req*/) {
        //TODO: replace this with actual values/logic!
        return 0.1;
    };
    
    // Extra validation for pricing, including dailyLimit checking + cost computing
    campModule.validatePricing = function(svc, req, next, done) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            origPricing = req.origObj && req.origObj.pricing,
            actingSchema = svc.model.personalizeSchema(req.user);

        if (!req.body.pricing) {
            return next();
        }

        // if user can set own cost, take the value from body, origObj, or computeCost
        if (actingSchema.pricing.cost.__allowed === true) {
            req.body.pricing.cost = req.body.pricing.cost || origPricing && origPricing.cost ||
                                    campModule.computeCost(req);
        }
        else { // otherwise recompute the cost each time
            req.body.pricing.cost = campModule.computeCost(req);
        }
        
        // copy over any missing props from original pricing
        objUtils.extend(req.body.pricing, origPricing);
        
        // validate dailyLimit:
        var limitMin = actingSchema.pricing.dailyLimit.__percentMin,
            limitMax = actingSchema.pricing.dailyLimit.__percentMax,
            limitDefault = actingSchema.pricing.dailyLimit.__percentDefault;
        
        // default dailyLimit if undefined
        req.body.pricing.dailyLimit = req.body.pricing.dailyLimit ||
                                      ( limitDefault * req.body.pricing.budget );

        // check if dailyLimit is within __percentMin and __percentMax of budget
        var ratio = (req.body.pricing.dailyLimit / req.body.pricing.budget) || 0;
        
        if (ratio < limitMin || ratio > limitMax) {
            log.info('[%1] User %2 cannot set dailyLimit of %3 to %4% of budget: bounds are %5, %6',
                     req.uuid, req.user.id, id, ratio, limitMin, limitMax);
            return done({
                code: 400,
                body: 'dailyLimit must be between ' + limitMin + ' and ' + limitMax + ' of budget'
            });
        }
        
        return next();
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
    
    /* Send a DELETE request to the content service. type should be "card" or "experience"
     * Logs + swallows 4xx failures, but rejects 5xx failures. */
    campModule.sendDeleteRequest = function(req, id, type) {
        var log = logger.getLog(),
            url = urlUtils.format({
                protocol: req.protocol,
                host: campModule.config.contentHost,
                pathname: '/api/content/' + type + '/' + id
            });
        
        return requestUtils.qRequest('delete', {
            url: url,
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

    /* Middleware to delete unused sponsored miniReels and cards. Deletes their campaigns from
     * Adtech, as well their objects in mongo through the content service */
    campModule.cleanSponsoredCamps = function(req, next/*, done*/) {
        var log = logger.getLog(),
            id = req.body.id || (req.origObj && req.origObj.id),
            delay = campModule.config.campaigns.statusDelay,
            attempts = campModule.config.campaigns.statusAttempts,
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
                        campaignTypeId  : campModule.config.campaigns.campaignTypeId,
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
            delay = campModule.config.campaigns.statusDelay,
            attempts = campModule.config.campaigns.statusAttempts,
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
    campModule.editTargetCamps = function(req, next, done) {
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
                return bannerUtils.createBanners(
                    group.miniReels,
                    orig.miniReels,
                    'contentMiniReel',
                    false,
                    group.adtechId
                );
            })
            .then(function() {
                return bannerUtils.cleanBanners(group.miniReels, orig.miniReels, group.adtechId);
            });
        }))
        .then(function() {
            log.trace('[%1] All target groups for %2 are up to date', req.uuid, id);
            next();
        })
        .catch(function(err) {
            if (err.c6warn) {
                return done({ code: 400, body: err.c6warn });
            }

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
                    campaignTypeId  : campModule.config.campaigns.campaignTypeId,
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
    
    // Initialize or update the pricingHistory property when the pricing changes
    campModule.handlePricingHistory = function(req, next/*, done*/) {
        var orig = req.origObj || {};
        
        delete req.body.pricingHistory;
            
        if (req.body.pricing && !objUtils.compareObjects(req.body.pricing, orig.pricing)) {
            req.body.pricingHistory = orig.pricingHistory || [];
            
            var wrapper = {
                pricing : req.body.pricing,
                userId  : req.user.id,
                user    : req.user.email,
                date    : new Date()
            };
            
            req.body.pricingHistory.unshift(wrapper);
        }
        
        next();
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
            delay = campModule.config.campaigns.statusDelay,
            attempts = campModule.config.campaigns.statusAttempts,
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
    
    campModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/campaigns?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetCamp = authUtils.middlewarify({campaigns: 'read'});
        router.get('/:id', sessions, authGetCamp, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaign', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCamp, audit, function(req, res) {
            var query = {};
            ['user', 'org', 'name', 'text', 'application']
            .forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if ('statuses' in req.query) {
                query.status = String(req.query.statuses).split(',');
            }
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaigns', detail: error });
                });
            });
        });

        var authPostCamp = authUtils.middlewarify({campaigns: 'create'});
        router.post('/', sessions, authPostCamp, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign', detail: error });
                });
            });
        });

        var authPutCamp = authUtils.middlewarify({campaigns: 'edit'});
        router.put('/:id', sessions, authPutCamp, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating campaign', detail: error });
                });
            });
        });

        var authDelCamp = authUtils.middlewarify({campaigns: 'delete'});
        router.delete('/:id', sessions, authDelCamp, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting campaign', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = campModule;
}());
