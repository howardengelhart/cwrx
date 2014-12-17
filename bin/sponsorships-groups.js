(function(){
    'use strict';

    var q               = require('q'),
        adtech          = require('adtech'),
        authUtils       = require('../lib/authUtils'),
        adtechUtils     = require('../lib/adtechUtils'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),

        groupModule = {};

    /*
        TODO: Open questions:
        - How should we handle permissions? Should everyone have 'all'? Or any scope is fine?
        - Should the delete endpoint exist?
        - How exactly should we namespace the endpoints?
    */
    
    groupModule.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        required: ['name', 'advertiserId', 'customerId']
    });
    
    groupModule.editValidator = new FieldValidator({
        forbidden: ['id', 'created']
    });
    
    groupModule.transformCampaign = function(campaign, banners) {
        banners = banners || [];
        var group = {
            id: campaign.id,
            name: campaign.name,
            created: campaign.createdAt,
            lastUpdated: campaign.lastUpdatedAt || campaign.createdAt
        };
        
        group.experiences = banners.filter(function(banner) {
            return campaign.bannerTimeRangeList[0].bannerInfoList.some(function(bannerInfo) {
                return banner.id === bannerInfo.bannerReferenceId;
            });
        }).map(function(banner) {
            return { id: banner.extId, adtechId: banner.bannerNumber };
        });
        
        return group;
    };
    
    groupModule.retrieveCampaign = function(id) {
        var log = logger.getLog(),
            campaign;
        
        return adtech.campaignAdmin.getCampaignById(id).then(function(resp) {
            log.trace('Retrieved campaign %1', id);
            campaign = resp;
            
            var aove = new adtech.AOVE();
            aove.addExpression(new adtech.AOVE.LongExpression('campaignId', campaign.id));
            return adtech.bannerAdmin.getBannerList(null, null, aove);
        })
        .then(function(bannList) {
            log.trace('Retrieved banner list for campaign %1', id);
            return q(groupModule.transformCampaign(campaign, bannList));
        }).catch(function(error) {
            log.error('Error retrieving campaign %1: %2', id, error);
            return q.reject(error);
        });
    };

    groupModule.getGroup = function(req) {
        var log = logger.getLog(),
            id = req.params.id;
        
        return groupModule.retrieveCampaign(id).then(function(group) {
            log.info('[%1] Successfully retrieved group campaign %2', req.uuid, id);
            return q({ code: 200, body: group });
        })
        .catch(function(error) {
            if (error.message && error.message.match(/^Unable to locate object/)) {
                log.info('[%1] Could not find campaign %2', req.uuid, id);
                return q({code: 404, body: 'Group not found'});
            } else {
                log.error('[%1] Error retrieving group campaign %2: %3', req.uuid, id, error);
                return q.reject('Adtech failure');
            }
        });
    };
    
    /* TODO: what can we filter groups by?  how should we do it?
    groupModule.getGroups = function(query, req) {
    };
    */
    
    //TODO: need to handle setting categories as kwlp3 keywords
    groupModule.createGroup = function(req) {
        var log = logger.getLog();
        
        if (req.body.miniReels && (!(req.body.miniReels instanceof Array) ||
            !req.body.miniReels.every(function(item) { return typeof item === 'object'; }))) {
            log.info('[%1] req.body.miniReels is invalid: %2',
                     req.uuid, JSON.stringify(req.body.miniReels));
            return q({code: 400, body: 'Invalid request body'});
        }
        if (!groupModule.createValidator.validate(req.body, {}, req.user)) {
            log.info('[%1] Invalid group object', req.uuid);
            return q({code: 400, body: 'Invalid request body'});
        }
        
        req.body.created = new Date();
        
        return adtech.campaignAdmin.createCampaign(adtechUtils.formatCampaign(req.body))
        .then(function(resp) {
            log.info('[%1] Created campaign %2 for group "%3"', req.uuid, resp.id, req.body.name);
            if (!req.body.miniReels) {
                return q(groupModule.transformCampaign(resp));
            }
            
            return adtechUtils.createBanners(req.body.miniReels, 'contentMiniReel', resp.id)
            .then(function() {
                return groupModule.retrieveCampaign(resp.id);
            });
        })
        .then(function(group) {
            return q({ code: 201, body: group });
        })
        .catch(function(error) {
            log.error('[%1] Error creating group "%2": %3', req.uuid, req.body.name, error);
            return q.reject('Adtech failure');
        });
    };
    
    //TODO: delete unused banners for PUTs?
    groupModule.editGroup = function(req) {
        var log = logger.getLog(),
            id = req.params.id,
            promise;
            
        // as of now, can't edit campaigns. So this will just update banner list
        if (!req.body.miniReels) {
            log.info('[%1] No miniReels list, not performing any edits to %2', req.uuid, id);
            promise = q();
        } else {
            promise = adtechUtils.createBanners(req.body.miniReels, 'contentMiniReel', id)
                      .then(function() { log.info('[%1] Created banners for %2', req.uuid, id); });
        }
        
        return promise.then(function() {
            return groupModule.retrieveCampaign(id);
        })
        .then(function(group) {
            return q({ code: 201, body: group });
        })
        .catch(function(error) {
            log.error('[%1] Error editing group %2: %3', req.uuid, id, error);
            return q.reject(error);
        });
    };


    /* TODO: need to edit a campaign + make it not active before deleting, but lib can't do it
    groupModule.deleteGroup = function(req) {
        var log = logger.getLog(),
            id = req.params.id;
            
        adtech.campaignAdmin.deleteCampaign(id)
        .then(function(resp) {
        
        })
        .catch(function(error) {
            log.error('[%1] Error deleting group %2: %3', req.uuid, req.body.id, error);
            return q.reject('Adtech failure');
        });
    };
    */

    
    groupModule.setupEndpoints = function(app, sessions, audit) {
        var authGetGroup = authUtils.middlewarify({contentGroups: 'read'});
        app.get('/api/contentGroup/:id', sessions, authGetGroup, audit, function(req, res) {
            groupModule.getGroup(req).then(function(resp) {
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

            groupModule.getGroups(query, req).then(function(resp) {
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
            groupModule.createGroup(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating contentGroup', detail: error });
            });
        });

        var authPutGroup = authUtils.middlewarify({contentGroups: 'edit'});
        app.put('/api/contentGroup/:id', sessions, authPutGroup, audit, function(req, res) {
            groupModule.editGroup(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating contentGroup', detail: error });
            });
        });

        var authDelGroup = authUtils.middlewarify({contentGroups: 'delete'});
        app.delete('/api/contentGroup/:id', sessions, authDelGroup, audit, function(req, res) {
            groupModule.deleteGroup(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting contentGroup', detail: error });
            });
        });
    };
    
    module.exports = groupModule;
}());
