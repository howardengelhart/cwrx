/* jshint camelcase: false */
(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        express         = require('express'),
        Model           = require('../../lib/model'),
        logger          = require('../../lib/logger'),
        CrudSvc         = require('../../lib/crudSvc'),
        objUtils        = require('../../lib/objUtils'),
        authUtils       = require('../../lib/authUtils'),
        MiddleManager   = require('../../lib/middleManager'),

        beesCamps = { config: {} };
        
    // Schema for request bodies, matching `campaign.externalCampaigns.beeswax`
    beesCamps.schema = {
        externalId: {
            __allowed: false
        },
        budget: {
            __allowed: true,
            __type: 'number',
            __min: 0
        },
        dailyLimit: {
            __allowed: true,
            __type: 'number',
            __min: 0
        }
    };

    beesCamps.setupSvc = function(db, config, beeswax) {
        beesCamps.config.beeswax = config.beeswax;
        beesCamps.config.api = config.api;
        Object.keys(beesCamps.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            beesCamps.config.api[key].baseUrl = urlUtils.resolve(
                beesCamps.config.api.root,
                beesCamps.config.api[key].endpoint
            );
        });
        
        var svc = new MiddleManager();
        svc._db = db;
        svc.beeswax = beeswax;
        
        var fetchC6Campaign = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'campaigns',
            idPath: 'params.c6Id'
        }, beesCamps.config.api);
        // advert id could be on req.campaign for these endpoints, or req.origObj for syncCampaigns
        var fetchC6Advertiser = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'advertisers',
            idPath: ['campaign.advertiserId', 'origObj.advertiserId'],
        }, beesCamps.config.api);
        
        svc.use('create', fetchC6Campaign);
        svc.use('create', fetchC6Advertiser);
        svc.use('create', beesCamps.ensureBeeswaxAdvert);
        svc.use('create', beesCamps.canEditCampaign);
        svc.use('create', beesCamps.validateBody.bind(beesCamps, 'create'));

        svc.use('edit', fetchC6Campaign);
        svc.use('edit', fetchC6Advertiser);
        svc.use('edit', beesCamps.ensureBeeswaxAdvert);
        svc.use('edit', beesCamps.canEditCampaign);
        svc.use('edit', beesCamps.validateBody.bind(beesCamps, 'edit'));
        
        svc.use('syncCampaigns', fetchC6Advertiser);
        svc.use('syncCampaigns', beesCamps.ensureBeeswaxAdvert);
        
        svc.syncCampaigns = beesCamps.syncCampaigns.bind(beesCamps, svc);
        
        return svc;
    };
    
    function round(num) {
        return Number(num.toFixed(2));
    }
    
    beesCamps.formatBeeswaxBody = function(newCamp, oldCamp, extCampEntry, req) {
        var log = logger.getLog(),
            impressionRatio = beesCamps.config.beeswax.impressionRatio;

        var beesBody = {
            advertiser_id: req.advertiser.beeswaxIds.advertiser,
            alternative_id: oldCamp.id,
            campaign_name: newCamp.name || oldCamp.name,
            budget_type: 1,
            active: false
        };
        
        /* Set start_date to earliest cards' startDate, or now. Don't set end_date, as Beeswax may
         * return errors if dates + budget/daily limit set such that total budget won't be spent
         * within timeframe */
        var cards = newCamp.cards || oldCamp.cards || [];
        cards.forEach(function(card) {
            var start = new Date(ld.get(card, 'campaign.startDate', undefined));
            if (!!start.valueOf() && (!beesBody.start_date || start < beesBody.start_date)) {
                beesBody.start_date = start;
            }
        });
        beesBody.start_date = beesBody.start_date || new Date();
        
        var newVals = {};
        ['budget', 'dailyLimit'].forEach(function(field) {
            var newCampVal = ld.get(newCamp, 'pricing.' + field, undefined),
                oldCampVal = ld.get(oldCamp, 'pricing.' + field, undefined),
                campVal = (newCampVal !== undefined) ? newCampVal : oldCampVal;
                
            // Fow now, not handling updating extern camps in case of camp budget/limit changing
            if (!!newCampVal && !!oldCampVal && newCampVal !== oldCampVal) {
                log.info('[%1] %2 for %3 changing, but not modifying beeswax value',
                         req.uuid, field, oldCamp.id);
                newVals[field] = extCampEntry[field];
                return;
            }
            
            if (field === 'dailyLimit') {
                // Allow dailyLimit to be set to null
                if (!campVal && !extCampEntry[field]) {
                    newVals[field] = null;
                    return;
                } else { // if campVal is null, treat it as infinite dailyLimit
                    campVal = campVal || Infinity;
                }
            } else { // treat null/undefined budget as 0
                campVal = campVal || 0;
            }

            // Set value as close to new val from extCampEntry as possible
            newVals[field] = Math.max(Math.min(
                ((typeof extCampEntry[field] === 'number') ? extCampEntry[field] : Infinity),
                campVal
            ), 1); // min of $1 as Beeswax will error on budget/limit of 0
        });
        // Ensure dailyLimit does not exceed budget
        newVals.dailyLimit = !!newVals.dailyLimit ? Math.min(newVals.budget, newVals.dailyLimit)
                                                  : newVals.dailyLimit;
        
        beesBody.campaign_budget = !!newVals.budget ? round(newVals.budget * impressionRatio)
                                                    : newVals.budget;
        beesBody.daily_budget = !!newVals.dailyLimit ? round(newVals.dailyLimit * impressionRatio)
                                                     : newVals.dailyLimit;
        return beesBody;
    };
    
    beesCamps.updateExtCampPricing = function(extCampEntry, beeswaxCampaign) {
        var impressionRatio = beesCamps.config.beeswax.impressionRatio;
        
        // Round to 6 decimal places to deal with JS math errors
        extCampEntry.budget = !!beeswaxCampaign.campaign_budget ?
            round(beeswaxCampaign.campaign_budget / impressionRatio) :
            beeswaxCampaign.campaign_budget;

        extCampEntry.dailyLimit = !!beeswaxCampaign.daily_budget ?
            round(beeswaxCampaign.daily_budget / impressionRatio) :
            beeswaxCampaign.daily_budget;
    };
    
    beesCamps.ensureBeeswaxAdvert = function(req, next, done) {
        var log = logger.getLog();

        if (!ld.get(req.advertiser, 'beeswaxIds.advertiser')) {
            log.info('[%1] Advert %2 has no beeswax id', req.uuid, req.advertiser.id);
            return done({
                code: 400,
                body: 'Must create beeswax advertiser for ' + req.advertiser.id
            });
        }
        next();
    };
    
    beesCamps.canEditCampaign = function(req, next, done) {
        var log = logger.getLog();

        if (!CrudSvc.checkScope('campaigns', true, req, req.campaign, 'edit')) {
            log.info('[%1] Requester %2 is not authorized to edit %3',
                     req.uuid, req.requester.id, req.campaign.id);
            return done({ code: 403, body: 'Not authorized to edit this campaign' });
        }
        return next();
    };
    
    beesCamps.validateBody = function(action, req, next, done) {
        var model = new Model('beeswaxCampaign', beesCamps.schema),
            origObj = ld.get(req.campaign, 'externalCampaigns.beeswax', {}),
            validateResp = model.validate(action, req.body, origObj, req.requester);

        if (validateResp.isValid) {
            next();
        } else {
            done({ code: 400, body: validateResp.reason });
        }
    };

    beesCamps.createBeeswaxCamp = function(svc, req) {
        var log = logger.getLog(),
            c6Id = req.params.c6Id;
        
        return svc.runAction(req, 'create', function() {
            req.campaign.externalCampaigns = req.campaign.externalCampaigns || {};
            if (req.campaign.externalCampaigns.beeswax) {
                log.info('[%1] Campaign %2 already has beeswax campaign %3',
                         req.uuid, c6Id, req.campaign.externalCampaigns.beeswax.externalId);
                return q({ code: 400, body: 'Campaign already has beeswax campaign' });
            }
            
            var extCampEntry = {
                budget: req.body.budget,
                dailyLimit: req.body.dailyLimit
            };
            var beesBody = beesCamps.formatBeeswaxBody(req.campaign,req.campaign,extCampEntry, req);
            log.trace('[%1] Body for new beeswax campaign: %2', req.uuid, JSON.stringify(beesBody));
            
            return svc.beeswax.campaigns.create(beesBody)
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Creating beeswax campaign failed: %2', req.uuid, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: 'Could not create beeswax campaign'
                    });
                }
                var beesId = resp.payload.campaign_id;
                log.info('[%1] Created Beeswax campaign %2 for %3', req.uuid, beesId, c6Id);

                beesCamps.updateExtCampPricing(extCampEntry, resp.payload);
                extCampEntry.externalId = beesId;
                
                return q(svc._db.collection('campaigns').findOneAndUpdate(
                    { id: c6Id },
                    {$set: { 'externalCampaigns.beeswax': extCampEntry, lastUpdated: new Date() }},
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                ))
                .thenResolve({
                    code: 201,
                    body: extCampEntry
                });
            })
            .catch(function(error) {
                log.error('[%1] Error creating Beeswax campaign for %2: %3',
                          req.uuid, c6Id, error.message || util.inspect(error));
                return q.reject('Error creating Beeswax campaign');
            });
        });
    };

    beesCamps.editBeeswaxCamp = function(svc, req) {
        var log = logger.getLog();
        
        return svc.runAction(req, 'edit', function() {
            var extCampEntry = ld.get(req.campaign, 'externalCampaigns.beeswax', null),
                c6Id = req.campaign.id;
            if (!extCampEntry) {
                log.info('[%1] Campaign %2 has no beeswax campaign', req.uuid, c6Id);
                return q({ code: 400, body: 'Campaign has no beeswax campaign' });
            }
            var beesId = extCampEntry.externalId;
            
            // update existing externCamp entry with body fields, if set
            ['budget', 'dailyLimit'].forEach(function(field) {
                extCampEntry[field] = (req.body[field] !== undefined) ? req.body[field]
                                                                      : extCampEntry[field];
            });
            
            var beesBody = beesCamps.formatBeeswaxBody(req.campaign,req.campaign,extCampEntry, req);
            log.trace('[%1] Body for beeswax campaign: %2', req.uuid, JSON.stringify(beesBody));
            
            return svc.beeswax.campaigns.edit(beesId, beesBody)
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Editing beeswax campaign %2 failed: %3',
                             req.uuid, beesId, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: 'Could not edit beeswax campaign'
                    });
                }
                log.info('[%1] Edited Beeswax campaign %2 for %3', req.uuid, beesId, c6Id);

                beesCamps.updateExtCampPricing(extCampEntry, resp.payload);
                
                return q(svc._db.collection('campaigns').findOneAndUpdate(
                    { id: c6Id },
                    {$set: { 'externalCampaigns.beeswax': extCampEntry, lastUpdated: new Date() }},
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                ))
                .thenResolve({
                    code: 200,
                    body: extCampEntry
                });
            })
            .catch(function(error) {
                log.error('[%1] Error editing Beeswax campaign %2 for %3: %4',
                          req.uuid, beesId, c6Id, error.message || util.inspect(error));
                return q.reject('Error editing Beeswax campaign');
            });
        });
    };
    
    beesCamps.syncCampaigns = function(svc, req) {
        var log = logger.getLog(),
            extCampEntry = req.origObj.externalCampaigns.beeswax;
        
        return svc.runAction(req, 'syncCampaigns', function() {
            var newBeesBody = beesCamps.formatBeeswaxBody(req.body, req.origObj, extCampEntry, req),
                oldBeesBody = beesCamps.formatBeeswaxBody(req.origObj,req.origObj,extCampEntry,req),
                beesId = extCampEntry.externalId;
                
            if (objUtils.compareObjects(newBeesBody, oldBeesBody)) {
                log.trace('[%1] Beeswax-related fields for %2 unchanged', req.uuid, req.origObj.id);
                return q(extCampEntry);
            }

            log.trace('[%1] Body for beeswax campaign: %2', req.uuid, JSON.stringify(newBeesBody));
            
            return svc.beeswax.campaigns.edit(beesId, newBeesBody)
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Editing beeswax campaign %2 failed: %3',
                             req.uuid, beesId, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: 'Could not edit beeswax campaign'
                    });
                }
                log.info('[%1] Edited Beeswax campaign %2 for %3',req.uuid, beesId, req.origObj.id);

                beesCamps.updateExtCampPricing(extCampEntry, resp.payload);

                return q(extCampEntry);
            })
            .catch(function(error) {
                log.error('[%1] Error editing Beeswax campaign %2 for %3: %4',
                          req.uuid, beesId, req.origObj.id, error.message || util.inspect(error));
                return q.reject('Error editing Beeswax campaign');
            });
        });
    };

    
    beesCamps.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/campaigns/:c6Id/external/beeswax';
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('campaigns', { allowApps: true });
        
        router.post('/', sessions, authMidware.edit, audit, function(req, res) {
            var promise = beesCamps.createBeeswaxCamp(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign', detail: error });
                });
            });
        });

        router.put('/', sessions, authMidware.edit, audit, function(req, res) {
            var promise = beesCamps.editBeeswaxCamp(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating campaign', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = beesCamps;
}());
/* jshint camelcase: true */
