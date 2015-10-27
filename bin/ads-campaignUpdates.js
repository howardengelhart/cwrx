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
        Model           = require('../lib/Model'),
        email           = require('../lib/email'),
        
        updateModule = { config: {} };
        
    updateModule.updateSchema = {
        status: {
            __type: 'string',
            __allowed: false,
            __default: 'pending'
        },
        campaign: {
            __type: 'string',
            __allowed: true,
            __required: true,
            __unchangeable: true
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
        
        var campDataModel = updateModule.createCampModel(campSvc);
        
        var fetchCamp       = updateModule.fetchCamp.bind(updateModule, campSvc),
            validateData    = updateModule.validateData.bind(updateModule, campDataModel),
            extraValidation = updateModule.extraValidation.bind(updateModule, campDataModel),
            lockCampaign    = updateModule.lockCampaign.bind(updateModule, svc),
            unlockCampaign  = updateModule.unlockCampaign.bind(updateModule, svc),
            notifyOwner     = updateModule.notifyOwner.bind(updateModule, svc);
        
        svc.use('create', fetchCamp);
        svc.use('create', updateModule.enforceLock);
        svc.use('create', updateModule.autoApprove);
        svc.use('create', validateData);
        svc.use('create', extraValidation);
        svc.use('create', updateModule.handleInitialSubmit);
        svc.use('create', updateModule.notifySupport);
        svc.use('create', lockCampaign);
        
        svc.use('edit', fetchCamp);
        svc.use('edit', updateModule.requireReason);
        svc.use('edit', validateData);
        svc.use('edit', extraValidation);
        // TODO: include:  svc.use('edit', updateModule.handleInitialSubmit);  ???
        svc.use('edit', unlockCampaign);
        svc.use('edit', updateModule.applyUpdate);
        svc.use('edit', notifyOwner);
        
        return svc;
    };
    
    updateModule.createCampModel = function(campSvc) { //TODO: test this pretty rigorously
        var schema = JSON.parse(JSON.stringify(campSvc.model.schema));
        
        schema.status.__allowed = true;
        
        return new Model('campaigns', schema);
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
            next();
        });
    };
    
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
    
    updateModule.autoApprove = function(req, next, done) {
        var log = logger.getLog();
        
        function canAutoApprove( ) {
            /*
                - can autoapprove if only changing payment method, if it's a valid payment method
                 that the user owns
                    - if selfie user only needs to change payment method, body *will* only contain
                      payment method, despite the fact that normally whole camp is passed up
                    - should we still save full campaign into update request for consistency?
            */
        }
        
        //TODO TODO: YO IF YOU CHANGE THE STATUS HERE HOW YOU GONNA DO THE STATUSHISTORY
    };
    
    // TODO: decide how to validate cards in campaign!!
    updateModule.validateData = function(model, req, next, done) {
        var log = logger.getLog();

        //TODO: ohh man test all this merging; esp. double check array handling        
        if (req.origObj && req.origObj.data) {
            objUtils.extend(req.body.data, req.origObj.data);
        }
        objUtils.extend(req.body.data, req.campaign);
        
        var validateResp = model.validate('create', req.body.data, req.campaign, req.user);

        if (validateResp.isValid) {
            return q(next());
        } else {
            return q(done({ code: 400, body: validateResp.reason }));
        }
    };
    
    updateModule.extraValidation = function(model, req, next, done) {
        var log = logger.getLog(),
            delays = updateModule.config.campaigns.dateDelays;
        
        var validResps = [
            campaignUtils.ensureUniqueIds(req.body.data),
            campaignUtils.ensureUniqueNames(req.body.data),
            campaignUtils.validateDates(req.body.data, req.campaign, req.user, delays, req.uuid),
            campaignUtils.validatePricing(req.body.data, req.campaign, req.user, model),
        ];
        
        for (var i = 0; i < validResps.length; i++) {
            if (!validResps[i].isValid) {
                log.info('[%1] %2', req.uuid, validResps[i].reason);
                return done({ code: 400, body: validResps[i].reason });
            }
        }
        
        return next();
    };
    
    updateModule.handleInitialSubmit = function(svc, req, next, done) {
        var log = logger.getLog();

        if (req.campaign.status === Status.Draft && req.body.data.status === Status.Active) {
            log.info('[%1] Initial update request for %2, switching status to pending',
                     req.uuid, req.campaign.id);
            //TODO TODO: change camp status to pending, but how to handle statusHistory
        }
        
        /*TODO:
         * - ensure paymentMethod
         * - ensure all pricing fields
         * - any other validation?
         */
        
    };
    
    updateModule.notifySupport = function(req, next, done) {
        var subject = 'New campaign update request',
            reviewLink = updateModule.config.emails.reviewLink.replace(':campId', req.campaign.id),
            data = {
                userEmail: req.user.email,
                campName: req.campaign.name,
                reviewLink: reviewLink
            };

        return email.compileAndSend(
            updateModule.config.emails.supportAddress, //TODO: to + from support@c6 seems weird...
            updateModule.config.emails.supportAddress,
            subject,
            'newUpdateRequest.html',
            data
        ).then(function() {
            return next();
        });
    };
    
    updateModule.lockCampaign = function(svc, req, next, done) {
        var log = logger.getLog();
        
        log.info('[%1] Setting updateRequest to %2 for campaign %3 for user %4',
                 req.uuid, req.body.id, req.campaign.id, req.user.id);
                 
        return mongoUtils.editObject(
            svc._db.collection('campaigns'),
            { updateRequest: req.body.id },
            req.campaign.id
        ).then(function(updatedCamp) {
            req.campaign = updatedCamp;
            return next();
        });
    };
    
    updateModule.requireReason = function(req, next, done) {
        var log = logger.getLog();
        
        if (rejectingUpdate(req) && !req.body.rejectionReason) {
            log.info('[%1] User %2 trying to reject %3 without a reason',
                     req.uuid, req.user.id, req.origObj.id);
            return done({ code: 400, body: 'Cannot reject update without a reason' });
        }
        
        return next();
    };

    updateModule.unlockCampaign = function(svc, req, next, done) {
        if (!approvingUpdate(req) && !rejectingUpdate(req)) {
            return q(next());
        }

        var log = logger.getLog(),
            coll = svc._db.collection('campaigns'),
            opts = { w: 1, journal: true, new: true },
            updateObj = {
                $set: { lastUpdated: new Date() },
                $unset: { updateRequest: 1 }
            };

        return q.npost(coll, 'findAndModify', [{id: req.campaign.id}, {id: 1}, updateObj, opts])
        .then(function(results) {
            log.info('[%1] Unlocked campaign %2', req.uuid, results[0].id);
            req.campaign = results[0];
            next();
        })
        .catch(function(err) {
            log.error('[%1] Failed unlocking campaign %2: %3',
                      req.uuid, req.campaign.id, err && err.stack || err);
            return q.reject(err);
        });
    };
    
    updateModule.applyUpdate = function(svc, req, next, done) {
        var log = logger.getLog(),
            updateId = req.origObj.id,
            campId = req.campaign.id;
            
        if (!approvingUpdate(req)) {
            return q(next());
        }
        
        return requestUtils.qRequest('put', {
            url: urlUtils.resolve(updateModule.config.api.campaigns.baseUrl, req.campaign.id),
            json: req.body.data, //TODO: should be fine? I think?
            headers: { cookie: req.headers.cookie }
        })
        .then(function(resp) {
            if (resp.response.statusCode === 200) {
                log.info('[%1] Applied update %2 to campaign %3', req.uuid, updateId, campId);
                req.campaign = resp.body;
                return next();
            }
            
            log.error('[%1] Could not edit %2 with %3: %3, %4',
                      req.uuid, campId, updateId, resp.response.statusCode, resp.body);
            
            log.info('[%1] Attempting to reset updateRequest for %2 to %3',
                     req.uuid, campId, updateId);
                     
            return mongoUtils.editObject(
                svc._db.collection('campaigns'),
                { updateRequest: updateId },
                campId
            ).finally(function() {
                return done({
                    code: 500, //TODO: RECONSIDER RESP CODE + LOG LEVEL!!
                    body: 'Failed to edit campaign: ' + resp.body
                });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error editing %2 with %3: %4',
                      req.uuid, campId, updateId, util.inspect(error));
            return q.reject(new Error('Error editing campaign'));
        });
    };

    updateModule.notifyOwner = function(svc, req, next, done) {
        var log = logger.getLog(),
            userColl = svc._db.collection('users'),
            subject, data, template;
        
        if (approvingUpdate(req)) {
            subject = 'Your campaign update has been approved!';
            data = {
                campName: req.campaign.name,
                contact: updateModule.config.emails.supportAddress
            };
            template = 'updateRequestApproved.html';
        }
        else if (rejectingUpdate(req)) {
            subject = 'Your campaign update has been rejected';
            data = {
                campName: req.campaign.name,
                reason: req.body.rejectionReason,
                contact: updateModule.config.emails.supportAddress
            };
            template = 'updateRequestApproved.html';
        }
        else {
            return q();
        }
        
        return q.npost(userColl, 'findOne', { id: req.campaign.user }, { id: 1, email: 1 })
        .then(function(user) {
            if (!user) {
                log.warn('[%1] Campaign %2 has nonexistent owner %3, not notifying anyone',
                         req.uuid, req.campaign.id, req.campaign.user);
                return next();
            }
            
            return email.compileAndSend(
                updateModule.config.emails.supportAddress,
                user.email,
                subject,
                template,
                data
            );
        })
        .then(function() {
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error notifying user %2: %3',
                      req.uuid, req.campaign.user, util.inspect(error));
            return q.reject('Error notifying user');
        });
    };
    
    // MUST be called before campaign module's setupEndpoints
    updateModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
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
            var promise = svc.createObj(req);
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
