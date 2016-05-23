(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        express         = require('express'),
        Status          = require('../lib/enums').Status,
        campaignUtils   = require('../lib/campaignUtils'),
        requestUtils    = require('../lib/requestUtils'),
        streamUtils     = require('../lib/streamUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        historian       = require('../lib/historian'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        Model           = require('../lib/model'),
        
        updateModule = { config: {} };
        
    updateModule.updateSchema = {
        status: {
            __type: 'string',
            __allowed: false,
            __default: Status.Pending,
            __acceptableValues: Object.keys(Status).map(function(key) {
                return Status[key];
            })
        },
        autoApproved: { // set automatically if update can be auto-approved
            __type: 'boolean',
            __allowed: false,
            __default: false,
            __locked: true
        },
        initialSubmit: { // set automatically if update is initial campaign submit
            __type: 'boolean',
            __allowed: false,
            __default: false,
            __locked: true
        },
        renewal: { // set automatically if update is campaign renewal
            __type: 'boolean',
            __allowed: false,
            __default: false,
            __locked: true
        },
        campaign: { // set automatically based on campId in params
            __type: 'string',
            __allowed: false,
            __locked: true
        },
        rejectionReason: {
            __type: 'string',
            __allowed: false
        },
        data: {
            __type: 'object',
            __allowed: true,
            __required: true
        }
    };

    updateModule.setupSvc = function(db, campSvc, config, appCreds) {
        updateModule.config.api = config.api;
        Object.keys(updateModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            updateModule.config.api[key].baseUrl = urlUtils.resolve(
                updateModule.config.api.root,
                updateModule.config.api[key].endpoint
            );
        });

        var coll = db.collection('campaignUpdates'),
            svc = new CrudSvc(coll, 'ur', { statusHistory: true }, updateModule.updateSchema);
        svc._db = db;
        
        streamUtils.createProducer(config.kinesis);

        var campDataModel = updateModule.createCampModel(campSvc),
            autoApproveModel = updateModule.createAutoApproveModel();
        
        var fetchCamp = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'campaigns',
            idPath: ['params.campId']
        }, updateModule.config.api);

        var canEditCampaign     = updateModule.canEditCampaign.bind(updateModule, campSvc),
            validateData        = updateModule.validateData.bind(updateModule, campDataModel),
            extraValidation     = updateModule.extraValidation.bind(updateModule, campDataModel),
            handleInitialSubmit = updateModule.handleInitialSubmit.bind(updateModule, svc),
            handleRenewal       = updateModule.handleRenewal.bind(updateModule, svc),
            lockCampaign        = updateModule.lockCampaign.bind(updateModule, svc),
            unlockCampaign      = updateModule.unlockCampaign.bind(updateModule, svc),
            applyUpdate         = updateModule.applyUpdate.bind(updateModule, svc, appCreds);
        
        svc.use('create', fetchCamp);
        svc.use('create', canEditCampaign);
        svc.use('create', updateModule.enforceLock);
        svc.use('create', validateData);
        svc.use('create', extraValidation);
        svc.use('create', updateModule.validateCards);
        svc.use('create', updateModule.validateZipcodes);
        svc.use('create', updateModule.checkAvailableFunds);
        svc.use('create', handleInitialSubmit);
        svc.use('create', handleRenewal);
        svc.use('create', lockCampaign);
        
        svc.use('edit', updateModule.ignoreCompleted);
        svc.use('edit', fetchCamp);
        svc.use('edit', canEditCampaign);
        svc.use('edit', updateModule.requireReason);
        svc.use('edit', validateData);
        svc.use('edit', extraValidation);
        svc.use('edit', updateModule.validateCards);
        svc.use('edit', updateModule.validateZipcodes);
        svc.use('edit', updateModule.checkAvailableFunds);
        svc.use('edit', unlockCampaign);
        svc.use('edit', applyUpdate);
        
        svc.use('autoApprove', autoApproveModel.midWare.bind(autoApproveModel, 'create'));
        svc.use('autoApprove', svc.setupObj.bind(svc));
        svc.use('autoApprove', fetchCamp);
        svc.use('autoApprove', canEditCampaign);
        svc.use('autoApprove', updateModule.enforceLock);
        svc.use('autoApprove', updateModule.validateZipcodes);
        svc.use('autoApprove', updateModule.checkAvailableFunds);
        svc.use('autoApprove', historian.middlewarify('status', 'statusHistory'));
        svc.use('autoApprove', applyUpdate);
        
        return svc;
    };
    
    // Helper to return true if changes in body translates to update being approved
    updateModule.approvingUpdate = function(req) {
        return !!req.origObj && req.origObj.status === Status.Pending &&
               !!req.body && req.body.status === Status.Approved;
    };
    
    // Helper to return true if changes in body translates to update being rejected
    updateModule.rejectingUpdate = function(req) {
        return !!req.origObj && req.origObj.status === Status.Pending &&
               !!req.body && req.body.status === Status.Rejected;
    };

    // Helper to return true if update request is an initial campaign submit
    updateModule.isInitSubmit = function(req) {
        return !!req.body.initialSubmit || (req.origObj && req.origObj.initialSubmit) ||
               (req.campaign.status === Status.Draft && req.body.data.status === Status.Pending);
    };

    // Helper to return true if update request is a campaign renewal
    updateModule.isRenewal = function(req) {
        var finishedStatuses = [Status.Expired, Status.OutOfBudget, Status.Canceled],
            oldStatus = req.campaign.status,
            newStatus = req.body.data.status;

        return !!req.body.renewal || (req.origObj && req.origObj.renewal) ||
               (finishedStatuses.indexOf(oldStatus) !== -1 && newStatus === Status.Pending);
    };
    
    // Creates a modified campaign model that allows users to set status
    updateModule.createCampModel = function(campSvc) {
        var schema = JSON.parse(JSON.stringify(campSvc.model.schema));
        
        schema.status.__allowed = true;
        
        return new Model('campaigns', schema);
    };
    
    // Create a modified campaignUpdate model that allows users to set status + autoApproved.
    updateModule.createAutoApproveModel = function() {
        var autoApprovedSchema = JSON.parse(JSON.stringify(updateModule.updateSchema));
        autoApprovedSchema.status.__allowed = true;
        autoApprovedSchema.autoApproved.__allowed = true;
        
        return new Model('campaignUpdates', autoApprovedSchema);
    };
    
    // Check if we can auto-approve the update request
    updateModule.canAutoApprove = function(req) {
        return !!(
            // Can auto-approve if user has entitlement + ability to set campaign status
            req.requester.entitlements.autoApproveUpdates === true &&
            req.requester.fieldValidation.campaigns &&
            req.requester.fieldValidation.campaigns.status &&
            req.requester.fieldValidation.campaigns.status.__allowed === true
        );
    };

    // Check that update request applies to this campaign, and user can edit this campaign
    updateModule.canEditCampaign = function(campSvc, req, next, done) {
        var log = logger.getLog();

        if (req.origObj && req.origObj.id && req.campaign.updateRequest !== req.origObj.id) {
            log.warn('[%1] Campaign %2 has updateRequest %3, not %4',
                     req.uuid, req.campaign.id, req.campaign.updateRequest, req.origObj.id);
            return done({ code: 400, body: 'Update request does not apply to this campaign' });
        }
        
        if (!campSvc.checkScope(req, req.campaign, 'edit')) {
            log.info('[%1] Requester %2 does not have permission to edit %3',
                     req.uuid, req.requester.id, req.campaign.id);
            return done({ code: 403, body: 'Not authorized to edit this campaign' });
        }
        
        req.body.campaign = req.campaign.id;
        
        next();
    };
    
    // Prevent creating updating request if campaign already has one
    updateModule.enforceLock = function(req, next, done) {
        var log = logger.getLog();
        
        if (!!req.campaign.updateRequest) {
            log.info('[%1] Campaign %2 has pending update request %3, cannot edit',
                     req.uuid, req.campaign.id, req.campaign.updateRequest);
            return done({
                code: 400,
                body: 'Campaign locked until existing update request resolved'
            });
        }
        
        return next();
    };
    
    /* Merge + validate data prop of req.body. Preserves props from orig update + orig campaign.
     * Does not merge array values, so if new targeting.interests = ['cat-1'] and old
     * targeting.interests = ['cat-3, 'cat-1'], merged targeting.interests = ['cat-1']. */
    updateModule.validateData = function(model, req, next, done) {
        var mergedData = {},
            origData = req.origObj && req.origObj.data;
            
        objUtils.extend(mergedData, req.body.data);

        // set the ignoreArrays flag for objUtils.extend so array entries not merged        
        if (origData) {
            objUtils.extend(mergedData, origData, true);
        }
        objUtils.extend(mergedData, req.campaign, true);
        
        req.body.data = mergedData;
        delete req.body.data.rejectionReason;

        var validateResp = model.validate('create', req.body.data, req.campaign, req.requester);

        if (validateResp.isValid) {
            return q(next());
        } else {
            return q(done({ code: 400, body: validateResp.reason }));
        }
    };
    
    // Additional validation for cards array + pricing not covered by campaign model
    updateModule.extraValidation = function(model, req, next, done) {
        var log = logger.getLog();
        
        var validResps = [
            campaignUtils.ensureUniqueIds(req.body.data),
            campaignUtils.validateAllDates(req.body.data, req.campaign, req.requester, req.uuid),
            campaignUtils.validatePricing(req.body.data, req.campaign, req.requester, model, true),
        ];
        
        for (var i = 0; i < validResps.length; i++) {
            if (!validResps[i].isValid) {
                log.info('[%1] %2', req.uuid, validResps[i].reason);
                return done({ code: 400, body: validResps[i].reason });
            }
        }
        
        return next();
    };
    
    /* Fetch the card schema + use it to validate the req.body.data.cards array.
     * NOTE: This will not set data.moat or data.duration on the cards. These properties should be
     * set properly on the PUT to the card in applyUpdate() */
    updateModule.validateCards = function(req, next, done) {
        var log = logger.getLog();
        
        if (!req.body.data.cards || req.body.data.cards.length === 0) {
            return q(next());
        }
        
        // get non-personalized schema, as we will construct a model that personalizes it here
        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(updateModule.config.api.cards.baseUrl, 'schema')
        })
        .then(function(resp) {
            var code = resp.response.statusCode;
            if (code !== 200) {
                log.info('[%1] Could not get card schema for %2, bailing: %3, %4',
                         req.uuid, req.requester.id, code, util.inspect(resp.body));
                return done({ code: code, body: resp.body });
            }
            
            var cardModel = new Model('cards', resp.body);
            
            function findExisting(newCard) {
                return (req.campaign.cards || []).filter(function(oldCard) {
                    return oldCard.id === newCard.id;
                })[0];
            }
            
            for (var i = 0; i < req.body.data.cards.length; i++) {
                var origCard = findExisting(req.body.data.cards[i]);
                
                var validation = cardModel.validate(
                    !!origCard ? 'edit' : 'create',
                    req.body.data.cards[i],
                    origCard,
                    req.requester
                );
                if (!validation.isValid) {
                    log.info('[%1] Card %2 in update data is invalid', req.uuid, i);
                    return done({
                        code: 400,
                        body: 'cards[' + i + '] is invalid: ' + validation.reason
                    });
                }
            }
            
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error fetching card schema: %2', req.uuid, util.inspect(error));
            return q.reject('Error fetching card schema');
        });
    };

    // Check if zipcodes in req.body.data targeting are valid
    updateModule.validateZipcodes = function(req, next, done) {
        var log = logger.getLog();

        return campaignUtils.validateZipcodes(
            req.body.data,
            req.campaign,
            req.requester,
            updateModule.config.api.zipcodes.baseUrl,
            req
        )
        .then(function(validResp) {
            if (!validResp.isValid) {
                log.info('[%1] %2', req.uuid, validResp.reason);
                return done({ code: 400, body: validResp.reason });
            } else {
                return next();
            }
        });
    };

    // Immediately edit campaign + set status to pending; used for renewal or init submit
    updateModule.setPending = function(svc, req) {
        var log = logger.getLog(),
            updateObj = { status: Status.Pending };
        
        historian.historify('status', 'statusHistory', updateObj, req.campaign, req);
        
        req.body.data.statusHistory = updateObj.statusHistory;
        
        return mongoUtils.editObject(svc._db.collection('campaigns'), updateObj, req.campaign.id)
        .then(function() {
            log.trace('[%1] Edited %2 with pending status', req.uuid, req.campaign.id);
        });
    };
    
    // On user's initial submit, check for additional props + transition campaign to 'pending'
    updateModule.handleInitialSubmit = function(svc, req, next, done) {
        var log = logger.getLog();

        if (!updateModule.isInitSubmit(req)) {
            return q(next());
        }

        log.info('[%1] Initial update request for %2, switching status to pending',
                 req.uuid, req.campaign.id);
                 
        req.body.initialSubmit = true;
        
        // check that these required fields are now set
        var fields = ['budget', 'cost'];
        
        for (var i = 0; i < fields.length; i++) {
            if (!req.body.data.pricing || !req.body.data.pricing[fields[i]]) {
                log.info('[%1] Campaign %2 missing required field pricing.%3, cannot submit',
                         req.uuid, req.campaign.id, fields[i]);
                return q(done({ code: 400, body: 'Missing required field: pricing.' + fields[i] }));
            }
        }

        return updateModule.setPending(svc, req)
        .then(function() {
            next();
        });
    };
    
    updateModule.handleRenewal = function(svc, req, next/*, done*/) {
        var log = logger.getLog();

        if (!updateModule.isRenewal(req)) {
            return q(next());
        }

        log.info('[%1] Renewal request for %2, setting status to pending',req.uuid,req.campaign.id);
                 
        req.body.renewal = true;
        
        return updateModule.setPending(svc, req)
        .then(function() {
            next();
        });
    };

    // If update req is changing balance (or is init submit), check that org has enough funds for it
    updateModule.checkAvailableFunds = function(req, next, done) {
        var log = logger.getLog(),
            orgId = req.body.data.org || req.campaign.org,
            prevBudgetChange = ld.get(req.origObj, 'data.pricing.budget', null),
            newBudget = ld.get(req.body.data, 'pricing.budget', prevBudgetChange),
            oldBudget = ld.get(req.campaign, 'pricing.budget', 0);
        
        // Skip if budget not changing, and this is not an initial submit or renewal
        if (!updateModule.isInitSubmit(req) && !updateModule.isRenewal(req) &&
            (!newBudget || newBudget === oldBudget)) {
            return q(next());
        }
        
        return requestUtils.proxyRequest(req, 'post', {
            url: updateModule.config.api.creditCheck.baseUrl,
            json: {
                campaign: req.campaign.id,
                org: orgId,
                newBudget: newBudget
            }
        })
        .then(function(resp) {
            if (resp.response.statusCode === 204) {
                log.info('[%1] Org %2 has enough balance to cover changes to %3',
                         req.uuid, orgId, req.campaign.id);
                return next();
            }
            else if (resp.response.statusCode === 402) {
                log.info('[%1] Update to %2 would incur deficit of %3 for %4',
                         req.uuid, req.campaign.id, orgId, resp.body.depositAmount);
                return done({ code: resp.response.statusCode, body: resp.body });
            }
            else {
                log.info('[%1] Requester %2 could not make credit check for %3: %4, %5',
                         req.uuid, req.requester.id, orgId, resp.response.statusCode, resp.body);
                return done({ code: resp.response.statusCode, body: resp.body });
            }
        })
        .catch(function(error) {
            log.error('[%1] Requester %2 failed making credit check for %3: %4',
                      req.uuid, req.requester.id, req.campaign.id, util.inspect(error));
            return q.reject('Failed making credit check');
        });
    };
    
    // Save updateRequest prop on the campaign. Also unsets any previous rejectionReason on campaign
    updateModule.lockCampaign = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            coll = svc._db.collection('campaigns'),
            opts = { w: 1, j: true, returnOriginal: false, sort: { id: 1 } },
            updateObj = {
                $set: { lastUpdated: new Date(), updateRequest: req.body.id },
                $unset: { rejectionReason: 1 }
            };
            
        log.info('[%1] Setting updateRequest to %2 for campaign %3 for requester %4',
                 req.uuid, req.body.id, req.campaign.id, req.requester.id);

        return q(coll.findOneAndUpdate({ id: req.campaign.id }, updateObj, opts))
        .then(function(/*updated*/) {
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed locking campaign %2: %3',
                      req.uuid, req.campaign.id, error && error.stack || error);
            return q.reject(error);
        });
    };
    
    // Prevent editing update requests that are 'approved' or 'rejected'
    updateModule.ignoreCompleted = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.origObj.status === Status.Approved || req.origObj.status === Status.Rejected) {
            log.info('[%1] Update request %2 is %3, cannot edit anymore',
                     req.uuid, req.origObj.id, req.origObj.status);
            return done({ code: 400, body: 'Update has already been ' + req.origObj.status });
        }
        
        next();
    };
    
    // Prevent rejecting update request without a rejectionReason
    updateModule.requireReason = function(req, next, done) {
        var log = logger.getLog();
        
        if (updateModule.rejectingUpdate(req) && !req.body.rejectionReason) {
            log.info('[%1] Requester %2 trying to reject %3 without a reason',
                     req.uuid, req.requester.id, req.origObj.id);
            return done({ code: 400, body: 'Cannot reject update without a reason' });
        }
        
        return next();
    };

    /* Remove campaign's updateRequest prop. Also, if rejecting the update, save rejectionReason on
     * the campaign, and if this was user's initial submit, send campaign back to 'draft' */
    updateModule.unlockCampaign = function(svc, req, next/*, done*/) {
        var log = logger.getLog();

        if (!updateModule.approvingUpdate(req) && !updateModule.rejectingUpdate(req)) {
            return q(next());
        }
        
        log.info('[%1] Unlocking campaign %2', req.uuid, req.campaign.id);

        var coll = svc._db.collection('campaigns'),
            opts = { w: 1, j: true, returnOriginal: false, sort: { id: 1 } },
            updateObj = {
                $set: { lastUpdated: new Date() },
                $unset: { updateRequest: 1 }
            };
            
        if (updateModule.rejectingUpdate(req)) {
            updateObj.$set.rejectionReason = req.body.rejectionReason;
            
            var updateType = (updateModule.isInitSubmit(req) && 'initial submit' ) ||
                             (updateModule.isRenewal(req) && 'renewal' ) ||
                             null;
            
            if (updateType !== null) {
                var prevStatus = ld.get(req.campaign, 'statusHistory[1].status', null);

                if (!prevStatus) {
                    log.warn('[%1] Update %2 was %3, but no previous status for %4 to revert to',
                             req.uuid, req.origObj.id, updateType, req.campaign.id);
                } else {
                    log.info('[%1] Update %2 was %3 request, switching %4 back to %5',
                             req.uuid, req.origObj.id, updateType, req.campaign.id, prevStatus);

                    updateObj.$set.status = prevStatus;
                    historian.historify('status', 'statusHistory', updateObj.$set,req.campaign,req);
                    req.body.data.statusHistory = updateObj.$set.statusHistory;
                }
            }
        }

        return q(coll.findOneAndUpdate({ id: req.campaign.id }, updateObj, opts))
        .then(function(/*updated*/) {
            next();
        })
        .catch(function(err) {
            log.error('[%1] Failed unlocking campaign %2: %3',
                      req.uuid, req.campaign.id, err && err.stack || err);
            return q.reject(err);
        });
    };
    
    /* Apply update request to campaign by proxying a PUT request. Uses the cwrx app for auth to
     * ensure no permissions issues. Fails if any non-200 response is returned from the campaign
     * service, and attempts to re-lock the campaign. */
    updateModule.applyUpdate = function(svc, appCreds, req, next/*, done*/) {
        var log = logger.getLog(),
            updateId = req.origObj && req.origObj.id || req.body.id,
            campId = req.campaign.id;
            
        if (!updateModule.approvingUpdate(req) && !req.body.autoApproved) {
            return q(next());
        }
        
        delete req.body.data.updateRequest;
        
        return requestUtils.makeSignedRequest(appCreds, 'put', {
            url: urlUtils.resolve(updateModule.config.api.campaigns.baseUrl, campId),
            json: req.body.data,
            headers: { cookie: req.headers.cookie }
        })
        .then(function(resp) {
            if (resp.response.statusCode === 200) {
                log.info('[%1] Applied update %2 to campaign %3', req.uuid, updateId, campId);
                return next();
            }
            
            return q.reject({ code: resp.response.statusCode, body: resp.body });
        })
        .catch(function(error) {
            log.error('[%1] Failed to edit %2 with %3: %4',
                      req.uuid, campId, updateId, util.inspect(error));

            // Do not re-lock campaign if update is auto-approved, since campaign was not locked
            if (req.body.autoApproved) {
                return q.reject('Failed editing campaign: ' + util.inspect(error));
            }

            log.info('[%1] Attempting to re-lock campaign %2', req.uuid, campId);

            return mongoUtils.editObject(
                svc._db.collection('campaigns'),
                { updateRequest: updateId, status: Status.Error },
                campId
            )
            .catch(function(err) {
                log.error('[%1] Failed direct campaign edit: %2', req.uuid, util.inspect(err));
            })
            .then(function() {
                return q.reject('Failed editing campaign: ' + util.inspect(error));
            });
        });
    };
    
    /* Creates a new update request but runs a different middleware stack so the update request
     * can be applied to the campaign immediately. */
    updateModule.autoApprove = function(svc, req) {
        var log = logger.getLog();
        
        req.body.status = Status.Approved;
        req.body.autoApproved = true;
        
        return svc.customMethod(req, 'autoApprove', function saveUpdate() {
            return mongoUtils.createObject(svc._coll, req.body)
            .then(svc.transformMongoDoc.bind(svc))
            .then(function(obj) {
                log.info('[%1] Requester %2 created auto-approved update request %3 for %4',
                         req.uuid, req.requester.id, obj.id, obj.campaign);
                return { code: 201, body: svc.formatOutput(obj) };
            });
        });
    };

    updateModule.produceNewUpdateRequest = function(req, resp) {
        var log = logger.getLog();
        
        if(resp.code === 201 && typeof resp.body === 'object') {
            return streamUtils.produceEvent('newUpdateRequest', {
                application: req.application,
                campaign: req.campaign,
                updateRequest: resp.body,
                user: req.user
            }).then(function() {
                log.info('[%1] Produced newUpdateRequest event for updateRequest %2', req.uuid,
                    resp.body.id);
            }).catch(function(error) {
                log.error('[%1] Error producing newUpdateRequest event for updateRequest %2: %3',
                    req.uuid, resp.body.id, util.inspect(error));
            }).thenResolve(resp);
        } else {
            return q(resp);
        }
    };
    
    updateModule.produceEditUpdateRequest = function(req, resp) {
        var log = logger.getLog();
        
        if(resp.code !== 200 || typeof resp.body !== 'object') {
            return q(resp);
        }
        
        var campaignApproved = updateModule.approvingUpdate(req);
        var campaignRejected = updateModule.rejectingUpdate(req);
        
        if(campaignApproved || campaignRejected) {
            var eventName = campaignApproved ?
                (!!updateModule.isInitSubmit(req) ? 'campaignApproved' : 'campaignUpdateApproved') :
                (!!updateModule.isInitSubmit(req) ? 'campaignRejected' : 'campaignUpdateRejected');
            return streamUtils.produceEvent(eventName, {
                campaign: req.campaign,
                updateRequest: resp.body
            }).then(function() {
                log.info('[%1] Produced %2 event for updateRequest %3', req.uuid, eventName,
                    resp.body.id);
            }).catch(function(error) {
                log.error('[%1] Error producing %2 event for updateRequest %3: %4', req.uuid,
                    eventName, resp.body.id, util.inspect(error));
            }).thenResolve(resp);
        } else {
            return q(resp);
        }
    };
    
    // MUST be called before campaign module's setupEndpoints
    updateModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/campaigns?(?=/?:campId?/update)';
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authReadUpd = authUtils.middlewarify({
            allowApps: true,
            permissions: { campaignUpdates: 'read' }
        });
        
        router.get('/updates?/', sessions, authReadUpd, audit, function(req, res) {
            var query = {};
            if ('statuses' in req.query) {
                query.status = String(req.query.statuses).split(',');
            }
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if ('campaigns' in req.query) {
                query.campaign = String(req.query.campaigns).split(',');
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaign updates', detail: error });
                });
            });
        });

        router.get('/:campId/updates?/:id', sessions, authReadUpd, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id, campaign: req.params.campId}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaign updates', detail: error });
                });
            });
        });

        router.get('/:campId/updates?/', sessions, authReadUpd, audit, function(req, res) {
            var query = { campaign: req.params.campId };
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
                    res.send(500, { error: 'Error retrieving campaign updates', detail: error });
                });
            });
        });
        
        var authCreateUpd = authUtils.middlewarify({ permissions: { campaignUpdates: 'create' } });
        router.post('/:campId/updates?/', sessions, authCreateUpd, audit, function(req, res) {
            var promise;
            
            if (updateModule.canAutoApprove(req)) {
                promise = updateModule.autoApprove(svc, req);
            } else {
                promise = svc.createObj(req).then(function(resp) {
                    return updateModule.produceNewUpdateRequest(req, resp);
                });
            }
            
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign updates', detail: error });
                });
            });
        });

        var authEditUpd = authUtils.middlewarify({
            permissions: { campaignUpdates: 'edit' },
            allowApps: true
        });
        router.put('/:campId/updates?/:id', sessions, authEditUpd, audit, function(req, res) {
            var promise = svc.editObj(req).then(function(resp) {
                return updateModule.produceEditUpdateRequest(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating campaign updates', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = updateModule;
}());
