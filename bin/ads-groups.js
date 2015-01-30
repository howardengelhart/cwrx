(function(){
    'use strict';

    var q               = require('q'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        campaignUtils   = require('../lib/campaignUtils'),
        bannerUtils     = require('../lib/bannerUtils'),
        logger          = require('../lib/logger'),

        groupModule = {
            groupsCfg: null, // these will get filled in with vals from config in setupSvc
            campsCfg: null
        };

    groupModule.setupSvc = function(db, config) {
        groupModule.groupsCfg = config.contentGroups;
        groupModule.campsCfg = config.campaigns;
    
        var groupColl = db.collection('contentGroups'), //TODO: or just 'groups'?
            svc = new CrudSvc(groupColl, 'g', { userProp: false, orgProp: false });
        svc._advertColl = db.collection('advertisers');
        svc._custColl = db.collection('customers');
        
        svc.createValidator._required.push('name');
        svc.createValidator._forbidden.push('adtechId');
        svc.editValidator._forbidden.push('advertiserId', 'customerId');

        svc.createValidator._formats.miniReels = ['string'];
        svc.editValidator._formats.miniReels = ['string'];
        svc.createValidator._formats.categories = ['string'];
        svc.editValidator._formats.categories = ['string'];

        svc.use('read', svc.preventGetAll.bind(svc));
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', groupModule.getAccountIds.bind(groupModule, svc));
        svc.use('create', groupModule.createAdtechGroup);
        svc.use('create', groupModule.createBanners);
        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('edit', groupModule.getAccountIds.bind(groupModule, svc));
        svc.use('edit', groupModule.cleanBanners);
        svc.use('edit', groupModule.createBanners);
        svc.use('edit', groupModule.editAdtechGroup);
        svc.use('delete', groupModule.deleteAdtechGroup);
        
        svc.formatOutput = groupModule.formatOutput.bind(groupModule, svc);
        
        return svc;
    };

    // Extends CrudSvc.prototype.formatOutput, processing miniReels
    groupModule.formatOutput = function(svc, obj) {
        obj.miniReels = obj.miniReels && obj.miniReels.map(function(reel) { return reel.id; });
        return CrudSvc.prototype.formatOutput.call(svc, obj);
    };
    
    /* Wrap campaignUtils.getAccountIds, defaulting advertiserId and customerId to values from
       config if not in req.body or req.origObj */
    groupModule.getAccountIds = function(svc, req, next, done) {
        ['advertiserId', 'customerId'].forEach(function(key) {
            req.body[key] = req.body[key] || (req.origObj && req.origObj[key]) ||
                            groupModule.groupsCfg[key];
        });
        
        return campaignUtils.getAccountIds(svc._advertColl, svc._custColl, req, next, done);
    };

/*    
    groupModule.startCampaign = function(req) {
        var id = req.params.id,
            log = logger.getLog();
        
        log.info('[%1] Starting group campaign %2', req.uuid, id);
        return adtech.pushAdmin.startCampaignById(id)
        .then(function() {
            log.info('[%1] Succesfully started group campaign %2', req.uuid, id);
            return q({code: 204});
        })
        .catch(function(error) {
            try {
                var errRgx = /No active placement found for campaign /;
                if (!!error.root.Envelope.Body.Fault.faultstring.match(errRgx)) {
                    log.info('[%1] Need to assign campaign %2 to a placement before starting',
                             req.uuid, id);
                    return q({code: 400, body: 'Need to assign to a placement first'});
                }
            } catch(e) {}
            
            log.error('[%1] Error starting group campaign %2: %3', req.uuid, id, error);
            return q.reject('Adtech failure');
        });
    };

    groupModule.stopCampaign = function(req) {
        var id = req.params.id,
            log = logger.getLog();
        
        log.info('[%1] Stopping group campaign %2', req.uuid, id);
        return adtech.pushAdmin.stopCampaignById(id)
        .then(function() {
            log.info('[%1] Succesfully stopped group campaign %2', req.uuid, id);
            return q({code: 204});
        })
        .catch(function(error) {
            log.error('[%1] Error stopping group campaign %2: %3', req.uuid, id, error);
            return q.reject('Adtech failure');
        });
    };

    groupModule.holdCampaign = function(req) {
        var id = req.params.id,
            log = logger.getLog();
        
        log.info('[%1] Holding group campaign %2', req.uuid, id);
        return adtech.pushAdmin.holdCampaignById(id)
        .then(function() {
            log.info('[%1] Succesfully paused group campaign %2', req.uuid, id);
            return q({code: 204});
        })
        .catch(function(error) {
            log.error('[%1] Error holding group campaign %2: %3', req.uuid, id, error);
            return q.reject('Adtech failure');
        });
    };
*/

    groupModule.createBanners = function(req, next/*, done*/) {
        req.body.miniReels = campaignUtils.objectify(req.body.miniReels);
        return bannerUtils.createBanners(
            req.body.miniReels,
            req.origObj && req.origObj.miniReels || [],
            'contentMiniReel',
            req.body.adtechId || (req.origObj && req.origObj.adtechId)
        )
        .then(function() {
            next();
        });
    };

    groupModule.cleanBanners = function(req, next/*, done*/) {
        req.body.miniReels = campaignUtils.objectify(req.body.miniReels);
        return bannerUtils.cleanBanners(
            req.body.miniReels,
            req.origObj.miniReels,
            req.origObj.adtechId
        )
        .then(function() {
            next();
        });
    };

    groupModule.createAdtechGroup = function(req, next/*, done*/) {
        return campaignUtils.makeKeywordLevels({ level3: req.body.categories })
        .then(function(keys) {
            return campaignUtils.createCampaign(req.body.id, req.body.name, false, keys,
                                                req._advertiserId, req._customerId);
        })
        .then(function(resp) {
            req.body.adtechId = parseInt(resp.id);
            next();
        });
    };
    
    groupModule.editAdtechGroup = function(req, next/*, done*/) {
        var log = logger.getLog(),
            cats = req.body.categories;
        
        if ((!req.body.name || req.body.name === req.origObj.name) &&
            (!cats || objUtils.compareObjects(cats.sort(), req.origObj.categories.sort()))) {
            log.info('[%1] Adtech props unchanged, not updating adtech group campaign', req.uuid);
            return q(next());
        }
        
        return (cats ? campaignUtils.makeKeywordLevels({ level3: cats }) : q())
        .then(function(keys) {
            return campaignUtils.editCampaign(req.origObj.adtechId, req.body.name, keys);
        })
        .then(function() {
            next();
        });
    };

    groupModule.deleteAdtechGroup = function(req, next/*, done*/) {
        var log = logger.getLog(),
            delay = groupModule.campsCfg.statusDelay,
            attempts = groupModule.campsCfg.statusAttempts;
    
        if (!req.origObj || !req.origObj.adtechId) {
            log.warn('[%1] Group %2 has no adtechId, nothing to delete', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return campaignUtils.deleteCampaigns([req.origObj.adtechId], delay, attempts)
        .then(function() {
            next();
        });
    };
    
    groupModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetGroup = authUtils.middlewarify({contentGroups: 'read'});
        app.get('/api/contentGroup/:id', sessions, authGetGroup, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving contentGroup', detail: error });
            });
        });

        app.get('/api/contentGroups', sessions, authGetGroup, audit, function(req, res) {
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
                res.send(500, { error: 'Error retrieving contentGroups', detail: error });
            });
        });

        var authPostGroup = authUtils.middlewarify({contentGroups: 'create'});
        app.post('/api/contentGroup', sessions, authPostGroup, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating contentGroup', detail: error });
            });
        });

        var authPutGroup = authUtils.middlewarify({contentGroups: 'edit'});
        app.put('/api/contentGroup/:id', sessions, authPutGroup, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating contentGroup', detail: error });
            });
        });

        var authDelGroup = authUtils.middlewarify({contentGroups: 'delete'});
        app.delete('/api/contentGroup/:id', sessions, authDelGroup, audit, function(req, res) {
            svc.deleteObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting contentGroup', detail: error });
            });
        });
        
        /*
        app.post('/api/contentGroup/start/:id', sessions, authPutGroup, audit, function(req, res) {
            groupModule.startCampaign(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error starting contentGroup', detail: error });
            });
        });

        app.post('/api/contentGroup/hold/:id', sessions, authPutGroup, audit, function(req, res) {
            groupModule.holdCampaign(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error holding contentGroup', detail: error });
            });
        });

        app.post('/api/contentGroup/stop/:id', sessions, authPutGroup, audit, function(req, res) {
            groupModule.stopCampaign(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error stopping contentGroup', detail: error });
            });
        });
        */
    };
    
    module.exports = groupModule;
}());
