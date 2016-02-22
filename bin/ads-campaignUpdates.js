(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        express         = require('express'),
        Status          = require('../lib/enums').Status,
        campaignUtils   = require('../lib/campaignUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        signatures      = require('../lib/signatures'),
        authUtils       = require('../lib/authUtils'),
        historian       = require('../lib/historian'),
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

    updateModule.setupSvc = function(db, campSvc, config, appCreds) {
        updateModule.config.emails = config.emails;
        updateModule.config.api = config.api;
        Object.keys(updateModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            updateModule.config.api[key].baseUrl = urlUtils.resolve(
                updateModule.config.api.root,
                updateModule.config.api[key].endpoint
            );
        });

        var authenticator = new signatures.Authenticator(appCreds),
            coll = db.collection('campaignUpdates'),
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
            applyUpdate         = updateModule.applyUpdate.bind(updateModule, svc, authenticator),
            notifyOwner         = updateModule.notifyOwner.bind(updateModule, svc);
            
        svc.use('create', fetchCamp);
        svc.use('create', updateModule.enforceLock);
        svc.use('create', validateData);
        svc.use('create', extraValidation);
        svc.use('create', updateModule.validateCards);
        svc.use('create', updateModule.validatePaymentMethod);
        svc.use('create', updateModule.validateZipcodes);
        svc.use('create', handleInitialSubmit);
        svc.use('create', updateModule.notifySupport);
        svc.use('create', lockCampaign);
        
        svc.use('edit', updateModule.ignoreCompleted);
        svc.use('edit', fetchCamp);
        svc.use('edit', updateModule.requireReason);
        svc.use('edit', validateData);
        svc.use('edit', extraValidation);
        svc.use('edit', updateModule.validateCards);
        svc.use('edit', updateModule.validatePaymentMethod);
        svc.use('edit', updateModule.validateZipcodes);
        svc.use('edit', unlockCampaign);
        svc.use('edit', applyUpdate);
        svc.use('edit', notifyOwner);
        
        svc.use('autoApprove', autoApproveModel.midWare.bind(autoApproveModel, 'create'));
        svc.use('autoApprove', svc.setupObj.bind(svc));
        svc.use('autoApprove', fetchCamp);
        svc.use('autoApprove', updateModule.enforceLock);
        svc.use('autoApprove', updateModule.validatePaymentMethod);
        svc.use('autoApprove', updateModule.validateZipcodes);
        svc.use('autoApprove', historian.middlewarify('status', 'statusHistory'));
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
        return (
            // Can auto-approve if user has entitlement + ability to set campaign status
            req.requester.entitlements.autoApproveUpdates === true &&
            req.requester.fieldValidation.campaigns &&
            req.requester.fieldValidation.campaigns.status &&
            req.requester.fieldValidation.campaigns.status.__allowed === true
        ) || (
            // Otherwise, can auto-approve if body solely consists of paymentMethod
           req.body && req.body.data && !!req.body.data.paymentMethod &&
           Object.keys(req.body.data).length === 1
       );
    };


    // Middleware to fetch the decorated campaign and attach it as req.campaign.
    updateModule.fetchCamp = function(campSvc, req, next, done) {
        var log = logger.getLog(),
            campId = req.params.campId;
            
        log.trace('[%1] Fetching campaign %2', req.uuid, String(campId));
        return signatures.proxyRequest(req, 'get', {
            url: urlUtils.resolve(updateModule.config.api.campaigns.baseUrl, campId)
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 200) {
                return done({ code: resp.response.statusCode, body: resp.body });
            }

            req.campaign = resp.body;

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
        return signatures.proxyRequest(req, 'get', {
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
    
    // Check if paymentMethod on req.body.data is valid.
    updateModule.validatePaymentMethod = function(req, next, done) {
        var log = logger.getLog();

        return campaignUtils.validatePaymentMethod(
            req.body.data,
            req.campaign,
            req.requester,
            updateModule.config.api.paymentMethods.baseUrl,
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
    
    // On user's initial submit, check for additional props + transition campaign to 'pending'
    updateModule.handleInitialSubmit = function(svc, req, next, done) {
        var log = logger.getLog();

        if (req.campaign.status !== Status.Draft || req.body.data.status !== Status.Active) {
            return q(next());
        }

        log.info('[%1] Initial update request for %2, switching status to pending',
                 req.uuid, req.campaign.id);
                 
        req.body.initialSubmit = true;
        
        if (!req.body.data.paymentMethod && !req.requester.entitlements.paymentOptional) {
            log.info('[%1] Campaign %2 missing required field paymentMethod, cannot submit',
                     req.uuid, req.campaign.id);
            return q(done({ code: 400, body: 'Missing required field: paymentMethod' }));
        }

        // check that these required fields are now set
        var fields = ['budget', 'cost'];
        
        for (var i = 0; i < fields.length; i++) {
            if (!req.body.data.pricing || !req.body.data.pricing[fields[i]]) {
                log.info('[%1] Campaign %2 missing required field pricing.%3, cannot submit',
                         req.uuid, req.campaign.id, fields[i]);
                return q(done({ code: 400, body: 'Missing required field: pricing.' + fields[i] }));
            }
        }
        
        var updateObj = { status: Status.Pending };
        
        historian.historify('status', 'statusHistory', updateObj, req.campaign, req);
        
        req.body.data.statusHistory = updateObj.statusHistory;
        
        return mongoUtils.editObject(svc._db.collection('campaigns'), updateObj, req.campaign.id)
        .then(function() {
            log.trace('[%1] Edited %2 with pending status', req.uuid, req.campaign.id);
            next();
        });
    };
    
    // Send email to support notifying them of new update request
    updateModule.notifySupport = function(req, next/*, done*/) {
        var log = logger.getLog();

        return email.newUpdateRequest(
            updateModule.config.emails.sender,
            updateModule.config.emails.supportAddress,
            req,
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
        
        if (rejectingUpdate(req) && !req.body.rejectionReason) {
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

        if (!approvingUpdate(req) && !rejectingUpdate(req)) {
            return q(next());
        }
        
        log.info('[%1] Unlocking campaign %2', req.uuid, req.campaign.id);

        var coll = svc._db.collection('campaigns'),
            opts = { w: 1, j: true, returnOriginal: false, sort: { id: 1 } },
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
                
                historian.historify('status', 'statusHistory', updateObj.$set, req.campaign, req);
                
                req.body.data.statusHistory = updateObj.$set.statusHistory;
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
    
    /* Apply update request to campaign by proxying a PUT request. Assumes the user editing the
     * campaign update request has permission to edit all campaigns. Fails if any non-200 response
     * is returned from the campaign service, and attempts to re-lock the campaign. */
    updateModule.applyUpdate = function(svc, authenticator, req, next/*, done*/) {
        var log = logger.getLog(),
            updateId = req.origObj && req.origObj.id || req.body.id,
            campId = req.campaign.id;
            
        if (!approvingUpdate(req) && !req.body.autoApproved) {
            return q(next());
        }
        
        delete req.body.data.updateRequest;
        
        return authenticator.request('put', {
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

    // Emails the user that their update was approved/rejected
    updateModule.notifyOwner = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            userColl = svc._db.collection('users');
        
        if (!approvingUpdate(req) && !rejectingUpdate(req)) {
            return q(next());
        }

        return q(userColl.find(
            { id: req.campaign.user },
            { fields: { id: 1, email: 1 }, limit: 1 }
        ).next())
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
                log.info('[%1] Requester %2 created auto-approved update request %3 for %4',
                         req.uuid, req.requester.id, obj.id, obj.campaign);
                return { code: 201, body: svc.formatOutput(obj) };
            });
        });
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
                promise = svc.createObj(req);
            }
            
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating campaign updates', detail: error });
                });
            });
        });

        var authEditUpd = authUtils.middlewarify({ permissions: { campaignUpdates: 'edit' } });
        router.put('/:campId/updates?/:id', sessions, authEditUpd, audit, function(req, res) {
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
