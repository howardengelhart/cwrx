(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        express         = require('express'),
        Status          = require('../lib/enums').Status,
        campaignUtils   = require('../lib/campaignUtils'),
        requestUtils    = require('../lib/requestUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        Model           = require('../lib/model'),
        email           = require('../lib/email'),
        
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
    
    // Helper to return true if changes in body translates to update being approved
    function approvingUpdate(req) {
        return req.origObj && req.origObj.status === Status.Pending &&
               req.body && req.body.status === Status.Approved;
    }
    
    // Helper to return true if changes in body translates to update being rejected
    function rejectingUpdate(req) {
        return req.origObj && req.origObj.status === Status.Pending &&
               req.body && req.body.status === Status.Rejected;
    }

    updateModule.setupSvc = function(db, campSvc, config) {
        updateModule.config.campaigns = config.campaigns;
        updateModule.config.emails = config.emails;
        updateModule.config.api = config.api;
        updateModule.config.api.campaigns.baseUrl = urlUtils.resolve(
            updateModule.config.api.root,
            updateModule.config.api.campaigns.endpoint
        );

        var coll = db.collection('campaignUpdates'),
            svc = new CrudSvc(coll, 'ur', { statusHistory: true }, updateModule.updateSchema);
        svc._db = db;
        
        var campDataModel = updateModule.createCampModel(campSvc),
            autoApproveModel = updateModule.createAutoApproveModel();
        
        var fetchCamp           = updateModule.fetchCamp.bind(updateModule, campSvc),
            validateData        = updateModule.validateData.bind(updateModule, campDataModel),
            extraValidation     = updateModule.extraValidation.bind(updateModule, campDataModel),
            handleInitialSubmit = updateModule.handleInitialSubmit.bind(updateModule, svc),
            lockCampaign        = updateModule.lockCampaign.bind(updateModule, svc),
            unlockCampaign      = updateModule.unlockCampaign.bind(updateModule, svc),
            applyUpdate         = updateModule.applyUpdate.bind(updateModule, svc),
            notifyOwner         = updateModule.notifyOwner.bind(updateModule, svc);
            
        svc.use('create', fetchCamp);
        svc.use('create', updateModule.enforceLock);
        svc.use('create', validateData);
        svc.use('create', extraValidation);
        svc.use('create', handleInitialSubmit);
        svc.use('create', updateModule.notifySupport);
        svc.use('create', lockCampaign);
        
        svc.use('edit', updateModule.ignoreCompleted);
        svc.use('edit', fetchCamp);
        svc.use('edit', updateModule.requireReason);
        svc.use('edit', validateData);
        svc.use('edit', extraValidation);
        svc.use('edit', unlockCampaign);
        svc.use('edit', applyUpdate);
        svc.use('edit', notifyOwner);
        
        svc.use('autoApprove', autoApproveModel.midWare.bind(autoApproveModel, 'create'));
        svc.use('autoApprove', svc.setupObj.bind(svc));
        svc.use('autoApprove', fetchCamp);
        svc.use('autoApprove', updateModule.enforceLock);
        svc.use('autoApprove', applyUpdate);
        
        return svc;
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
        // currently, auto-approve if body solely consists of paymentMethod
        return req.body && req.body.data && !!req.body.data.paymentMethod &&
               Object.keys(req.body.data).length === 1;
    };


    // Middleware to fetch the campaign and attach it as req.campaign.
    updateModule.fetchCamp = function(campSvc, req, next, done) {
        var log = logger.getLog(),
            campId = req.params.campId;
            
        log.trace('[%1] Fetching campaign %2', req.uuid, String(campId));
        return campSvc.getObjs({ id: String(campId) }, req, false)
        .then(function(resp) {
            if (resp.code !== 200) {
                return done(resp);
            }

            req.campaign = resp.body;

            if (req.origObj && req.origObj.id && req.campaign.updateRequest !== req.origObj.id) {
                log.warn('[%1] Campaign %2 has updateRequest %3, not %4',
                         req.uuid, req.campaign.id, req.campaign.updateRequest, req.origObj.id);
                return done({ code: 400, body: 'Update request does not apply to this campaign' });
            }
            
            if (!campSvc.checkScope(req.user, req.campaign, 'edit')) {
                log.info('[%1] User %2 does not have permission to edit %3',
                         req.uuid, req.user.id, req.campaign.id);
                return done({ code: 403, body: 'Not authorized to edit this campaign' });
            }
            
            req.body.campaign = campId;
            
            next();
        });
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
        
        // ensure cards only set on request if user defined them for update
        mergedData.cards = req.body.data.cards || (origData && origData.cards) || undefined;

        // TODO: decide how to validate cards in campaign!!
        
        req.body.data = mergedData;
        delete req.body.data.rejectionReason;

        var validateResp = model.validate('create', req.body.data, req.campaign, req.user);

        if (validateResp.isValid) {
            return q(next());
        } else {
            return q(done({ code: 400, body: validateResp.reason }));
        }
    };
    
    // Additional validation for cards array + pricing not covered by campaign model
    updateModule.extraValidation = function(model, req, next, done) {
        var log = logger.getLog(),
            delays = updateModule.config.campaigns.dateDelays;
        
        var validResps = [
            campaignUtils.ensureUniqueIds(req.body.data),
            campaignUtils.ensureUniqueNames(req.body.data),
            campaignUtils.validateAllDates(req.body.data, req.campaign, req.user, delays,req.uuid),
            campaignUtils.validatePricing(req.body.data, req.campaign, req.user, model, true),
        ];
        
        for (var i = 0; i < validResps.length; i++) {
            if (!validResps[i].isValid) {
                log.info('[%1] %2', req.uuid, validResps[i].reason);
                return done({ code: 400, body: validResps[i].reason });
            }
        }

        return next();
    };
    
    // On user's initial submit, check for additional props + transition campaign to 'pending'
    updateModule.handleInitialSubmit = function(svc, req, next, done) {
        var log = logger.getLog();

        if (req.campaign.status !== Status.Draft || req.body.data.status !== Status.Active) {
            return q(next());
        }

        log.info('[%1] Initial update request for %2, switching status to pending',
                 req.uuid, req.campaign.id);
                 
        req.body.initialSubmit = true;

        // check that these required fields are now set
        var checks = [
            { parent: req.body.data, field: 'paymentMethod' },
            { parent: req.body.data, field: 'pricing' },
            { parent: req.body.data.pricing, field: 'budget' },
            { parent: req.body.data.pricing, field: 'dailyLimit' },
            { parent: req.body.data.pricing, field: 'cost' }
        ];
        
        for (var i = 0; i < checks.length; i++) {
            if (!checks[i].parent || !checks[i].parent[checks[i].field]) {
                log.info('[%1] Campaign %2 missing required field %3, cannot submit',
                         req.uuid, req.campaign.id, checks[i].field);
                return q(done({ code: 400, body: 'Missing required field: ' + checks[i].field }));
            }
        }
        
        var updateObj = {
            status: Status.Pending,
            statusHistory: req.campaign.statusHistory || []
        };
        
        updateObj.statusHistory.unshift({
            status  : updateObj.status,
            userId  : req.user.id,
            user    : req.user.email,
            date    : new Date()
        });
        
        req.body.data.statusHistory = updateObj.statusHistory;
        
        return mongoUtils.editObject(svc._db.collection('campaigns'), updateObj, req.campaign.id)
        .then(function() {
            next();
        });
    };
    
    // Send email to support notifying them of new update request
    updateModule.notifySupport = function(req, next/*, done*/) {
        var log = logger.getLog();

        return email.newUpdateRequest(
            updateModule.config.emails.sender,
            updateModule.config.emails.supportAddress,
            req.user.email,
            req.campaign.name,
            updateModule.config.emails.reviewLink.replace(':campId', req.campaign.id)
        ).then(function() {
            log.info('[%1] Notified support at %2 of new update request',
                     req.uuid, updateModule.config.emails.supportAddress);
            return next();
        });
    };
    
    // Save updateRequest prop on the campaign. Also unsets any previous rejectionReason on campaign
    updateModule.lockCampaign = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            coll = svc._db.collection('campaigns'),
            opts = { w: 1, journal: true, new: true },
            updateObj = {
                $set: { lastUpdated: new Date(), updateRequest: req.body.id },
                $unset: { rejectionReason: 1 }
            };
            
        log.info('[%1] Setting updateRequest to %2 for campaign %3 for user %4',
                 req.uuid, req.body.id, req.campaign.id, req.user.id);

        return q.npost(coll, 'findAndModify', [{id: req.campaign.id}, {id: 1}, updateObj, opts])
        .then(function() {
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
        
        if (rejectingUpdate(req) && !req.body.rejectionReason) {
            log.info('[%1] User %2 trying to reject %3 without a reason',
                     req.uuid, req.user.id, req.origObj.id);
            return done({ code: 400, body: 'Cannot reject update without a reason' });
        }
        
        return next();
    };

    /* Remove campaign's updateRequest prop. Also, if rejecting the update, save rejectionReason on
     * the campaign, and if this was user's initial submit, send campaign back to 'draft' */
    updateModule.unlockCampaign = function(svc, req, next/*, done*/) {
        var log = logger.getLog();

        if (!approvingUpdate(req) && !rejectingUpdate(req)) {
            return q(next());
        }
        
        log.info('[%1] Unlocking campaign %2', req.uuid, req.campaign.id);

        var coll = svc._db.collection('campaigns'),
            opts = { w: 1, journal: true, new: true },
            updateObj = {
                $set: { lastUpdated: new Date() },
                $unset: { updateRequest: 1 }
            };
            
        if (rejectingUpdate(req)) {
            updateObj.$set.rejectionReason = req.body.rejectionReason;
            
            if (req.campaign.status === Status.Pending && req.body.data.status === Status.Active) {
                log.info('[%1] Update %2 was initial approval request, switching %3 back to draft',
                         req.uuid, req.origObj.id, req.campaign.id);

                updateObj.$set.status = Status.Draft;
                updateObj.$set.statusHistory = req.campaign.statusHistory || [];
                updateObj.$set.statusHistory.unshift({
                    status  : updateObj.$set.status,
                    userId  : req.user.id,
                    user    : req.user.email,
                    date    : new Date()
                });
            }
        }

        return q.npost(coll, 'findAndModify', [{id: req.campaign.id}, {id: 1}, updateObj, opts])
        .then(function() {
            next();
        })
        .catch(function(err) {
            log.error('[%1] Failed unlocking campaign %2: %3',
                      req.uuid, req.campaign.id, err && err.stack || err);
            return q.reject(err);
        });
    };
    
    /* Apply update request to campaign by proxying a PUT request. Assumes the user editing the
     * campaign update request has permission to edit all campaigns. Fails if any non-200 response
     * is returned from the campaign service, and attempts to re-lock the campaign. */
    updateModule.applyUpdate = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            updateId = req.origObj && req.origObj.id || req.body.id,
            campId = req.campaign.id;
            
        if (!approvingUpdate(req) && !req.body.autoApproved) {
            return q(next());
        }
        
        delete req.body.data.updateRequest;
        
        return requestUtils.qRequest('put', {
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

            log.info('[%1] Attempting to re-lock campaign %2', req.uuid, campId);

            return mongoUtils.editObject(
                svc._db.collection('campaigns'),
                { updateRequest: updateId, status: Status.Error },
                campId
            )
            .catch(function(error) {
                log.error('[%1] Failed direct campaign edit: %2', req.uuid, util.inspect(error));
            })
            .then(function() {
                return q.reject('Failed editing campaign: ' + util.inspect(error));
            });
        });
    };

    // Emails the user that their update was approved/rejected
    updateModule.notifyOwner = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            userColl = svc._db.collection('users');
        
        if (!approvingUpdate(req) && !rejectingUpdate(req)) {
            return q(next());
        }

        return q.npost(userColl, 'findOne', [
            { id: req.campaign.user },
            { fields: { id: 1, email: 1 } }
        ])
        .then(function(user) {
            if (!user) {
                log.warn('[%1] Campaign %2 has nonexistent owner %3, not notifying anyone',
                         req.uuid, req.campaign.id, req.campaign.user);
                return next();
            }
            
            var emailPromise, action;
            
            if (approvingUpdate(req)) {
                emailPromise = email.updateApproved(
                    updateModule.config.emails.sender,
                    user.email,
                    !!req.origObj.initialSubmit,
                    req.campaign.name,
                    updateModule.config.emails.dashboardLink
                );
                action = 'approved';
            } else {
                emailPromise = email.updateRejected(
                    updateModule.config.emails.sender,
                    user.email,
                    !!req.origObj.initialSubmit,
                    req.campaign.name,
                    updateModule.config.emails.dashboardLink,
                    req.body.rejectionReason
                );
                action = 'rejected';
            }

            log.info('[%1] Notifying user %2 at %3 that request %4 was %5',
                     req.uuid, req.campaign.user, user.email, req.origObj.id, action);
            
            return emailPromise;
        })
        .then(function() {
            return next();
        })
        .catch(function(error) {
            log.warn('[%1] Error notifying user %2: %3',
                      req.uuid, req.campaign.user, util.inspect(error));
            return next();
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
                log.info('[%1] User %2 created auto-approved update request %3 for %4',
                         req.uuid, req.user.id, obj.id, obj.campaign);
                return { code: 201, body: svc.formatOutput(obj) };
            });
        });
    };

    
    // MUST be called before campaign module's setupEndpoints
    updateModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/campaigns?/:campId/updates?';
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetUpd = authUtils.middlewarify({campaignUpdates: 'read'});
        router.get('/:id', sessions, authGetUpd, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id, campaign: req.params.campId}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving campaign updates', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetUpd, audit, function(req, res) {
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

        var authPostUpd = authUtils.middlewarify({campaignUpdates: 'create'});
        router.post('/', sessions, authPostUpd, audit, function(req, res) {
            var promise;
            
            if (updateModule.canAutoApprove(req)) {
                promise = updateModule.autoApprove(svc, req);
            } else {
                promise = svc.createObj(req);
            }
            
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign updates', detail: error });
                });
            });
        });

        var authPutUpd = authUtils.middlewarify({campaignUpdates: 'edit'});
        router.put('/:id', sessions, authPutUpd, audit, function(req, res) {
            var promise = svc.editObj(req);
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
