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
        },
        budgetImpressions: {
            __allowed: true,
            __type: 'number',
            __min: 0
        },
        dailyLimitImpressions: {
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
    
    
    // Choose + return start date equal to earliest cards' startDate. 
    beesCamps.chooseStartDate = function(campaign) {
        var cards = campaign.cards || [];

        return cards.reduce(function(currStart, card) {
            var thisStart = new Date(ld.get(card, 'campaign.startDate', undefined));
            if (!!thisStart.valueOf() && (!currStart || thisStart < currStart)) {
                return thisStart;
            } else {
                return currStart;
            }
        }, undefined);
    };
    
    // Format campaign + externalCampaigns entry into a beeswax campaign body
    beesCamps.formatBeeswaxBody = function(campaign, extCampEntry, req) {
        var beesBody = {
            advertiser_id: req.advertiser.beeswaxIds.advertiser,
            alternative_id: campaign.id,
            campaign_name: campaign.name || 'Untitled (' + campaign.id + ')'
        };
        
        beesBody.start_date = beesCamps.chooseStartDate(campaign);
        /* Don't set end_date, as Beeswax may return errors if dates + budget/daily limit set such
         * that total budget won't be spent within timeframe */
        
        // If budgetImpressions is not undefined or null, use the Impressions props
        if (typeof extCampEntry.budgetImpressions === 'number') {
            beesBody.budget_type = 1; // 1 = impressions count
            
            extCampEntry.budgetImpressions = Math.max(extCampEntry.budgetImpressions, 1);

            // allow dailyLimitImpressions to be null, otherwise cap to budgetImpressions
            extCampEntry.dailyLimitImpressions = (!extCampEntry.dailyLimitImpressions) ?
                extCampEntry.dailyLimitImpressions :
                Math.max(Math.min(extCampEntry.budgetImpressions,
                                  extCampEntry.dailyLimitImpressions), 1);
            
            beesBody.campaign_budget = extCampEntry.budgetImpressions;
            beesBody.daily_budget = extCampEntry.dailyLimitImpressions;
        }
        else {
            beesBody.budget_type = 0; // 0 = spend

            extCampEntry.budget = Math.max(extCampEntry.budget, 1);

            // allow dailyLimit to be null, otherwise cap to budget
            extCampEntry.dailyLimit = (!extCampEntry.dailyLimit) ?
                extCampEntry.dailyLimit :
                Math.max(Math.min(extCampEntry.budget, extCampEntry.dailyLimit), 1);
            
            beesBody.campaign_budget = extCampEntry.budget;
            beesBody.daily_budget = extCampEntry.dailyLimit;
        }
        
        return beesBody;
    };
    
    // Return 400 if campaign's advertiser does not have a beeswax advertiser
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
    
    // Return 403 if request cannot edit campaign
    beesCamps.canEditCampaign = function(req, next, done) {
        var log = logger.getLog();

        if (!CrudSvc.checkScope('campaigns', true, req, req.campaign, 'edit')) {
            log.info('[%1] Requester %2 is not authorized to edit %3',
                     req.uuid, req.requester.id, req.campaign.id);
            return done({ code: 403, body: 'Not authorized to edit this campaign' });
        }
        return next();
    };
    
    // Validate request body using beesCamps.schema
    beesCamps.validateBody = function(action, req, next, done) {
        var log = logger.getLog(),
            model = new Model('beeswaxCampaign', beesCamps.schema),
            origObj = ld.get(req.campaign, 'externalCampaigns.beeswax', {}),
            validateResp = model.validate(action, req.body, origObj, req.requester);

        if (!validateResp.isValid) {
            return done({ code: 400, body: validateResp.reason });
        }
        
        function isSet(val) { return val !== undefined && val !== null; }
        var msg;
        if (isSet(req.body.budget) && isSet(req.body.budgetImpressions)) {
            msg = 'Cannot set both budget + budgetImpressions';
            log.info('[%1] %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        } else if (isSet(req.body.dailyLimit) && isSet(req.body.dailyLimitImpressions)) {
            msg = 'Cannot set both dailyLimit + dailyLimitImpressions';
            log.info('[%1] %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        }
        
        return next();
    };

    // Run action to create Beeswax campaign + update C6 campaign's externalCampaigns field
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
                budget: req.body.budget || null,
                dailyLimit: req.body.dailyLimit || null,
                budgetImpressions: req.body.budgetImpressions || null,
                dailyLimitImpressions: req.body.dailyLimitImpressions || null,
            };

            var beesBody = beesCamps.formatBeeswaxBody(req.campaign, extCampEntry, req);
            beesBody.active = false; // initialize status to inactive
            beesBody.start_date = beesBody.start_date || new Date(); // ensure start_date is set
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

    // Run action to edit Beeswax campaign + update C6 campaign's externalCampaigns field
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
            ['budget', 'dailyLimit', 'budgetImpressions', 'dailyLimitImpressions']
            .forEach(function(field) {
                extCampEntry[field] = (req.body[field] !== undefined) ? req.body[field]
                                                                      : extCampEntry[field];
            });
            
            var beesBody = beesCamps.formatBeeswaxBody(req.campaign, extCampEntry, req);
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
    
    // Run action to edit Beeswax campaign if relevant campaign fields changed. Called from
    // PUT /api/campaigns/:id handler, not directly from any endpoints in this module.
    beesCamps.syncCampaigns = function(svc, req) {
        var log = logger.getLog(),
            extCampEntry = req.origObj.externalCampaigns.beeswax,
            beesId = extCampEntry.externalId;
        
        return svc.runAction(req, 'syncCampaigns', function() {
            var oldBeesBody = {
                campaign_name: req.origObj.name,
                start_date: beesCamps.chooseStartDate(req.origObj)
            };
            var newBeesBody = {
                campaign_name: req.body.name || req.origObj.name,
                start_date: beesCamps.chooseStartDate(req.body) || oldBeesBody.start_date
            };
            
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
