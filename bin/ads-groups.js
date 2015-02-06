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

    // Setup the group's campaign, calling makeKeywordLevels and createCampaign
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

    // Call bannerUtils.createBanners to create any necessary banners for the campaign
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
            origCats = req.origObj.categories || [];
        
        if ((!req.body.name || req.body.name === req.origObj.name) &&
            (!cats || objUtils.compareObjects(cats.sort(), origCats.sort()))) {
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
