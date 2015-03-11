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
        groupModule.groupsCfg = config.minireelGroups;
        groupModule.campsCfg = config.campaigns;
    
        var groupColl = db.collection('minireelGroups'),
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
        svc.use('create', groupModule.validateDates);
        svc.use('create', groupModule.ensureDistinctList);
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', groupModule.getAccountIds.bind(groupModule, svc));
        svc.use('create', groupModule.createAdtechGroup);
        svc.use('create', groupModule.createBanners);
        svc.use('edit', groupModule.validateDates);
        svc.use('edit', groupModule.ensureDistinctList);
        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('edit', groupModule.getAccountIds.bind(groupModule, svc));
        svc.use('edit', groupModule.cleanBanners);
        svc.use('edit', groupModule.createBanners);
        svc.use('edit', groupModule.editAdtechGroup);
        svc.use('delete', groupModule.deleteAdtechGroup);
        
        svc.formatOutput = groupModule.formatOutput.bind(groupModule, svc);
        
        return svc;
    };
    
    // Ensure the miniReels list in the request has all distinct entires
    groupModule.ensureDistinctList = function(req, next, done) {
        var log = logger.getLog();
        
        if (!objUtils.isListDistinct(req.body.miniReels)) {
            log.info('[%1] miniReels list in req is not distinct: [%2]',
                     req.uuid, req.body.miniReels);
            return q(done({code: 400, body: 'miniReels must be distinct'}));
        } else {
            return q(next());
        }
    };
    
    // Validate/default in startDate + endDate
    groupModule.validateDates = function(req, next, done) {
        req.body.startDate = req.body.startDate || (req.origObj && req.origObj.startDate);
        req.body.endDate = req.body.endDate || (req.origObj && req.origObj.endDate);
        if (!campaignUtils.validateDates(req.body, groupModule.campsCfg.dateDelays, req.uuid)) {
            return q(done({code: 400, body: 'group has invalid dates'}));
        } else {
            return q(next());
        }
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

    // Setup the group's campaign, calling makeKeywordLevels and createCampaign
    groupModule.createAdtechGroup = function(req, next/*, done*/) {
        var now = new Date(),
            delays = groupModule.campsCfg.dateDelays;
            
        req.body.startDate = new Date(now.valueOf()+ delays.start).toISOString();
        req.body.endDate = new Date(now.valueOf()+ delays.end).toISOString();
        
        return campaignUtils.makeKeywordLevels({ level3: req.body.categories })
        .then(function(keywords) {
            return campaignUtils.createCampaign({
                id              : req.body.id,
                name            : req.body.name,
                startDate       : req.body.startDate,
                endDate         : req.body.endDate,
                isSponsored     : false,
                keywords        : keywords,
                advertiserId    : req._advertiserId,
                customerId      : req._customerId
            }, req.uuid);
        })
        .then(function(resp) {
            req.body.adtechId = parseInt(resp.id);
            next();
        });
    };

    // Call bannerUtils.createBanners to create any necessary banners for the campaign
    groupModule.createBanners = function(req, next/*, done*/) {
        req.body.miniReels = campaignUtils.objectify(req.body.miniReels);
        return bannerUtils.createBanners(
            req.body.miniReels,
            req.origObj && req.origObj.miniReels || [],
            'contentMiniReel',
            false,
            req.body.adtechId || (req.origObj && req.origObj.adtechId)
        )
        .then(function() {
            next();
        });
    };

    // Call bannerUtils.cleanBanners to delete any unused banners for the campaign
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

    // Edit the campaign with updated keywords if the name or categories have been changed
    groupModule.editAdtechGroup = function(req, next/*, done*/) {
        var log = logger.getLog(),
            cats = req.body.categories,
            origCats = req.origObj.categories || [],
            promise;
            
        req.body.adtechId = req.body.adtechId || req.origObj.adtechId;
            
        if (!cats || objUtils.compareObjects(cats.slice().sort(), origCats.slice().sort())) {
            promise = q();
        } else {
            promise = campaignUtils.makeKeywordLevels({ level3: cats });
        }
        
        return promise.then(function(keys) {
            if (!keys && (!req.body.name || req.body.name === req.origObj.name)) {
                log.info('[%1] Adtech props unchanged, not updating adtech campaign', req.uuid);
                return q();
            }
            
            return campaignUtils.editCampaign(
                req.body.name,
                req.body,
                keys,
                req.uuid
            );
        })
        .then(function() {
            next();
        });
    };

    // Delete the group's campaign from adtech
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
        var authGetGroup = authUtils.middlewarify({minireelGroups: 'read'});
        app.get('/api/minireelGroup/:id', sessions, authGetGroup, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving minireelGroup', detail: error });
            });
        });

        app.get('/api/minireelGroups', sessions, authGetGroup, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }
            if (req.query.adtechId) {
                query.adtechId = Number(req.query.adtechId);
            }

            svc.getObjs(query, req, true).then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving minireelGroups', detail: error });
            });
        });

        var authPostGroup = authUtils.middlewarify({minireelGroups: 'create'});
        app.post('/api/minireelGroup', sessions, authPostGroup, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating minireelGroup', detail: error });
            });
        });

        var authPutGroup = authUtils.middlewarify({minireelGroups: 'edit'});
        app.put('/api/minireelGroup/:id', sessions, authPutGroup, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating minireelGroup', detail: error });
            });
        });

        var authDelGroup = authUtils.middlewarify({minireelGroups: 'delete'});
        app.delete('/api/minireelGroup/:id', sessions, authDelGroup, audit, function(req, res) {
            svc.deleteObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting minireelGroup', detail: error });
            });
        });
    };
    
    module.exports = groupModule;
}());
