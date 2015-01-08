(function(){
    'use strict';

    var q               = require('q'),
        adtech          = require('adtech'),
        authUtils       = require('../lib/authUtils'),
        campaignUtils   = require('../lib/campaignUtils'),
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
        forbidden: ['id', 'created', 'adtechId'],
        required: ['name', 'advertiserId', 'customerId'],
        formats: {
            miniReels: ['string'],
            categories: ['string']
        }
    });
    
    groupModule.editValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        formats: {
            miniReels: ['string'],
            categories: ['string']
        }
    });
    
    groupModule.formatOutput = function(group) {
        group.miniReels = group.miniReels.map(function(reel) { return reel.id; });
        return group;
    };
    
    groupModule.transformCampaign = function(campaign, banners, categories) {
        banners = banners || [];
        var group = {
            id: campaign.id,
            categories: categories,
            name: campaign.name,
            created: campaign.createdAt,
            lastUpdated: campaign.lastUpdatedAt || campaign.createdAt
        };
        
        group.miniReels = banners.filter(function(banner) {
            return campaign.bannerTimeRangeList[0].bannerInfoList.some(function(bannerInfo) {
                return banner.id === bannerInfo.bannerReferenceId;
            });
        }).map(function(banner) {
            return { id: banner.extId, bannerNumber: banner.bannerNumber, bannerId: banner.id };
        });
        
        return group;
    };
    
    groupModule.lookupCampaign = function(id) {
        var log = logger.getLog(),
            campaign, categories;
        
        return adtech.campaignAdmin.getCampaignById(id).then(function(resp) {
            log.trace('Retrieved campaign %1', id);
            campaign = resp;
            
            if (campaign.priorityLevelThreeKeywordIdList instanceof Array &&
                campaign.priorityLevelThreeKeywordIdList.length > 0) {
                return campaignUtils.lookupKeywords(campaign.priorityLevelThreeKeywordIdList);
            } else {
                return q();
            }
        })
        .then(function(catList) {
            categories = catList;
            var aove = new adtech.AOVE();
            aove.addExpression(new adtech.AOVE.LongExpression('campaignId', campaign.id));
            return adtech.bannerAdmin.getBannerList(null, null, aove);
        })
        .then(function(bannList) {
            log.trace('Retrieved banner list for campaign %1', id);
            return q(groupModule.transformCampaign(campaign, bannList, categories));
        })
        .catch(function(error) {
            if (error.message && error.message.match(/^Unable to locate object/)) {
                log.info('Could not find campaign %1', id);
                return q();
            } else {
                log.error('Error retrieving group campaign %1: %2', id, error);
                return q.reject('Adtech failure');
            }
        });
    };

    groupModule.getGroup = function(req) {
        var log = logger.getLog(),
            id = parseInt(req.params.id);
        
        return groupModule.lookupCampaign(id).then(function(group) {
            if (!group) {
                return q({code: 404, body: 'Group not found'});
            }
            log.info('[%1] Successfully retrieved group campaign %2', req.uuid, id);
            return q({ code: 200, body: groupModule.formatOutput(group) });
        });
    };
    
    // TODO: what can we filter groups by?  how should we do it?
    /*
    groupModule.getGroups = function(query, req) {
        
        var aove = new adtech.AOVE();
        aove.addExpression(new adtech.AOVE.IntExpression('priority', 3));
    };
    */
    
    groupModule.createGroup = function(req) {
        var log = logger.getLog(),
            miniReels = req.body.miniReels;
        
        if (!groupModule.createValidator.validate(req.body, {}, req.user)) {
            log.info('[%1] Invalid group object', req.uuid);
            log.trace('updates: %1', JSON.stringify(req.body));
            log.trace('requester: %1', JSON.stringify(req.user));
            return q({code: 400, body: 'Invalid request body'});
        }
        
        req.body.created = new Date();
        
        return campaignUtils.makeKeywords(req.body.categories || [])
        .then(function(keyIds) {
            var keys = { level3: keyIds };
            return adtech.campaignAdmin.createCampaign(campaignUtils.formatCampaign(req.body,keys));
        })
        .then(function(resp) {
            log.info('[%1] Created campaign %2 for group "%3"', req.uuid, resp.id, req.body.name);
            if (!miniReels) {
                return q(groupModule.transformCampaign(resp, null, req.body.categories));
            }

            miniReels = miniReels.map(function(id) { return { id: id }; });
            return campaignUtils.createBanners(miniReels, null, 'contentMiniReel', resp.id)
            .then(function() {
                return groupModule.lookupCampaign(resp.id);
            });
        })
        .then(function(group) {
            if (!group) {
                return q.reject('Newly created group could not be found');
            }
            return q({ code: 201, body: groupModule.formatOutput(group) });
        })
        .catch(function(error) {
            log.error('[%1] Error creating group "%2": %3', req.uuid, req.body.name, error);
            return q.reject('Adtech failure');
        });
    };
    
    // as of now, can't edit campaigns. So this will just update banner list
    groupModule.editGroup = function(req) {
        var log = logger.getLog(),
            id = parseInt(req.params.id),
            miniReels = req.body.miniReels;

        if (!groupModule.editValidator.validate(req.body, {}, req.user)) {
            log.info('[%1] Invalid group object', req.uuid);
            log.trace('updates: %1', JSON.stringify(req.body));
            log.trace('requester: %1', JSON.stringify(req.user));
            return q({code: 400, body: 'Invalid request body'});
        }
            
        return groupModule.lookupCampaign(id)
        .then(function(group) {
            if (!group) {
                return q({code: 404, body: 'Group not found'});
            }
            if (!miniReels) {
                return q({ code: 201, body: groupModule.formatOutput(group) });
            }
            
            miniReels = miniReels.map(function(id) { return { id: id }; });
            return campaignUtils.cleanBanners(miniReels, group.miniReels, id)
            .then(function() {
                log.trace('[%1] Successfully processed all banners from original', req.uuid);
                return campaignUtils.createBanners(miniReels,group.miniReels,'contentMiniReel',id);
            })
            .then(function() {
                log.info('[%1] All banners for %2 have been created', req.uuid, id);
                group.miniReels = miniReels;
                return q({ code: 201, body: groupModule.formatOutput(group) });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error editing group campaign %2: %3', req.uuid, id, error);
            return q.reject('Adtech failure');
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
