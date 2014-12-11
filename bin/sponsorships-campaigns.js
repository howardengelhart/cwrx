(function(){
    'use strict';

    var q               = require('q'),
        path            = require('path'),
        fs              = require('fs-extra'),
        adtech          = require('adtech'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        
        bannerDir = path.join(__dirname, '../templates/adtechBanners'),
        bannerTypes = { // TODO: move elsewhere?
            card: {
                sizeTypeId: 277,
                template: fs.readFileSync(path.join(bannerDir, 'card.html'))
            },
            miniReel: {
                sizeTypeId: 1182,
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            targetMiniReel: {
                sizeTypeId: 509,
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            }
        },

        campModule = {};

    campModule.setupSvc = function(db) {
        var campColl = db.collection('campaigns'),
            cardColl = db.collection('cards'),
            expColl = db.collection('experiences'),
            campSvc = new CrudSvc(campColl, 'cam', { userProp: false, orgProp: false });
        campSvc._cardColl = cardColl;
        campSvc._expColl = expColl;
        
        campSvc.createValidator._required.push('name', 'advertiserId', 'customerId');
        campSvc.createValidator._forbidden.push('adtechId');
        campSvc.editValidator._forbidden.push('campaignId', 'customerId');
        campSvc.use('create', campSvc.validateUniqueProp.bind(campSvc, 'name', null));
        campSvc.use('edit', campSvc.validateUniqueProp.bind(campSvc, 'name', null));
        campSvc.use('read', campSvc.preventGetAll.bind(campSvc));
        campSvc.use('create', campModule.adtechCreate);
        campSvc.use('create', campModule.createBanners);
        campSvc.use('edit', campModule.createBanners);
        campSvc.use('delete', campModule.deleteContent.bind(campModule, campSvc));
        
        return campSvc;
    };

    //TODO: need to set KGT in features somehow...
    campModule.formatAdtechCamp = function(campaign) {
        return {
            adGoalTypeId: 1, //TODO: should these be configurable? or something?
            advertiserId: Number(campaign.advertiserId),
            campaignTypeId: 26954,
            customerId: Number(campaign.customerId),
            dateRangeList: adtech.campaignAdmin.makeDateRangeList([{
                endDate: new Date(campaign.created.valueOf() + 365*24*60*60*1000).toISOString(),
                startDate: campaign.created.toISOString()
            }]),
            extId: campaign.id,
            frequencyConfig: {
                type: campaign.frequency || adtech.constants.ICampaign.FREQUENCY_TYPE_NONE
            },
            id: campaign.adtechId && Number(campaign.adtechId),
            name: campaign.name,
            optimizerTypeId: 6,
            optimizingConfig: {
                minClickRate: 0,
                minNoPlacements: 0
            },
            pricingConfig: {
                cpm: 0
            }
        };
    };

    campModule.formatAdtechBanner = function(type, extId) {
        var retObj = { _type: type },
            typeConfig = bannerTypes[type];

        retObj.banner = {
            data            : typeConfig.template.toString('base64'),
            // description     : type + ' ' + extId,
            extId           : extId,
            fileType        : 'html',
            id              : -1,
            mainFileName    : 'index.html',
            name            : type + ' ' + extId,
            originalData    : typeConfig.template.toString('base64'),
            sizeTypeId      : typeConfig.sizeTypeId,
            statusId        : adtech.constants.IBanner.STATUS_ACTIVE,
            styleTypeId     : adtech.constants.IBanner.STYLE_HTML
        };
        retObj.bannerInfo = {
            bannerReferenceId        : retObj.banner.id,
            entityFrequencyConfig    : {
                frequencyCookiesOnly : true,
                frequencyDistributed : true,
                frequencyInterval    : 30,
                frequencyTypeId      : adtech.constants.IFrequencyInformation.FREQUENCY_5_MINUTES
            },
            name                     : retObj.banner.name,
            statusId                 : retObj.banner.statusId
        };
        
        return retObj;
    };
    
    campModule.adtechCreate = function(req, next/*, done*/) {
        var log = logger.getLog();
            
        return adtech.campaignAdmin.createCampaign(campModule.formatAdtechCamp(req.body))
        .then(function(resp) {
            log.info('[%1] Created Adtech campaign %2 for C6 campaign %3',
                     req.uuid, resp.id, req.body.id);
            req.body.adtechId = resp.id;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed creating Adtech campaign for %2: %3',
                      req.uuid, req.body.id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    //TODO: delete unused banners for PUTs?
    campModule.createBanners = function(req, next, done) {
        var log = logger.getLog(),
            bnCount = 0,
            banners = [],
            id, adtechId;
            
        req.origObj = req.origObj || {}; //TODO: this feels like a bad hack
        adtechId = req.body.adtechId || req.origObj.adtechId;
        id = req.body.id || req.origObj.id;
        
        //TODO: merge arrays more intelligently?
        req.body.minViewTime = req.body.minViewTime || req.origObj.minViewTime || -1;
        req.body.miniReels = req.body.miniReels || req.origObj.miniReels || [];
        req.body.cards = req.body.cards || req.origObj.cards || [];
        req.body.targetMiniReels = req.body.targetMiniReels || req.origObj.targetMiniReels || [];

        ['miniReels', 'cards', 'targetMiniReels'].forEach(function(key) {
            if (!req.body[key].every(function(item) { return typeof item === 'object'; })) {
                log.info('[%1] req.body.%2 is invalid: %3',
                         req.uuid, key, JSON.stringify(req.body[key]));
                return done({code: 400, body: key + ' must be an array of objects'});
            }
        });
        
        function filterItem(item) {
            return !item.adtechId;
        }
        
        banners = banners.concat(req.body.cards.filter(filterItem).map(function(card) {
                        return campModule.formatAdtechBanner('card', card.id);
                    }), req.body.miniReels.filter(filterItem).map(function(reel) {
                        return campModule.formatAdtechBanner('miniReel', reel.id);
                    }), req.body.targetMiniReels.filter(filterItem).map(function(tReel) {
                        return campModule.formatAdtechBanner('targetMiniReel', tReel.id);
                    }));
        
        // seems like adtech won't let us create multiple banners concurrently, so do 1 by 1
        return banners.reduce(function(promise, obj) {
            return promise.then(function() {
                return adtech.bannerAdmin.createBanner(adtechId,obj.banner,obj.bannerInfo);
            })
            .then(function(resp) {
                bnCount++;
                log.info('[%1] Created banner "%2", id %3, for campaign %4',
                         req.uuid, resp.name, resp.bannerNumber, id || req.origObj.id);
                req.body[obj._type + 's'].forEach(function(item) {
                    if (item.id === resp.extId) {
                        item.adtechId = resp.bannerNumber;
                    }
                });
            });
        }, q())
        .then(function() {
            if (bnCount > 0) {
                log.info('[%1] Created all banners for campaign %2', req.uuid, id);
            }
            next();
        })
        .catch(function(error) {
            log.error('Failed creating banners for campaign %2: %3', req.uuid, id, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    campModule.deleteContent = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            cardIds = (req.origObj.cards || []).map(function(card) { return card.id; }),
            expIds = (req.origObj.miniReels || []).map(function(exp) { return exp.id; }),
            updates = { $set: { lastUpdated: new Date(), status: Status.Deleted } };
        
        return q.npost(svc._cardColl, 'update', [{id: {$in: cardIds}}, updates, {multi: true}])
        .then(function() {
            if (cardIds.length) {
                log.info('[%1] Deleted cards %2', req.uuid, cardIds.join(', '));
            }
            return q.npost(svc._expColl, 'update', [{id: {$in: expIds}}, updates, {multi: true}]);
        })
        .then(function() {
            if (expIds.length) {
                log.info('[%1] Deleted experiences %2', req.uuid, expIds.join(', '));
            }
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error deleting cards + minireels for campaign %2: %3',
                      req.uuid, req.origObj.id, error);
            return q.reject(new Error('Mongo error'));
        });
    };
    
    campModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetCamp = authUtils.middlewarify({campaigns: 'read'});
        app.get('/api/campaign/:id', sessions, authGetCamp, audit, function(req, res) {
            svc.getObjs({id: req.params.id}, req, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving campaign', detail: error });
            });
        });

        app.get('/api/campaigns', sessions, authGetCamp, audit, function(req, res) {
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
                res.send(500, { error: 'Error retrieving campaigns', detail: error });
            });
        });

        var authPostCamp = authUtils.middlewarify({campaigns: 'create'});
        app.post('/api/campaign', sessions, authPostCamp, audit, function(req, res) {
            svc.createObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating campaign', detail: error });
            });
        });

        var authPutCamp = authUtils.middlewarify({campaigns: 'edit'});
        app.put('/api/campaign/:id', sessions, authPutCamp, audit, function(req, res) {
            svc.editObj(req).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating campaign', detail: error });
            });
        });

        var authDelCamp = authUtils.middlewarify({campaigns: 'delete'});
        app.delete('/api/campaign/:id', sessions, authDelCamp, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting campaign', detail: error });
            });
        });
    };
    
    module.exports = campModule;
}());
