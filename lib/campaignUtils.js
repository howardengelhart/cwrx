(function(){
    'use strict';
    
    var q       = require('q'),
        path    = require('path'),
        fs      = require('fs-extra'),
        adtech  = require('adtech'),
        logger  = require('./logger'),

        bannerDir = path.join(__dirname, '../templates/adtechBanners'),
        keywordTTL = 1000*60*60*24, // TODO: move this to actual config?
        bannerTypes = {
            card: {                 // sponsored card
                sizeTypeId: 277,    // 2x2
                template: fs.readFileSync(path.join(bannerDir, 'card.html'))
            },
            miniReel: {             // sponsored minireel
                sizeTypeId: 1182,   // 2x11
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            targetMiniReel: {       // regular minireel targeted for campaign
                sizeTypeId: 509,    // 2x1
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            contentMiniReel: {      // regular minireel in content group
                sizeTypeId: 16,     // 1x1
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            }
        },
        campaignUtils = { _keywordCache: {} };
        

    campaignUtils.lookupKeywords = function(ids) {
        var log = logger.getLog(),
            keys = Object.keys(campaignUtils._keywordCache);
        
        return q.all(ids.map(function(id) {
            for (var i = 0; i < keys.length; i++) {
                if (campaignUtils._keywordCache[keys[i]] === id) {
                    return q(keys[i]);
                }
            }
            
            return adtech.keywordAdmin.getKeywordById(id)
            .then(function(keyword) {
                log.trace('Successfully retrieved keyword %1: "%2"', id, keyword);
                campaignUtils._keywordCache[keyword] = id;
                setTimeout(function() {
                    delete campaignUtils._keywordCache[keyword];
                }, keywordTTL);
                return q(keyword);
            })
            .catch(function(error) {
                log.error('Error looking up keyword %1: %2', id, error);
                return q.reject('Adtech failure');
            });
        }));
    };
    
    campaignUtils.makeKeywords = function(keywords) {
        var log = logger.getLog();
        
        return q.all(keywords.map(function(keyword) {
            if (campaignUtils._keywordCache[keyword]) {
                return q(campaignUtils._keywordCache[keyword]);
            }
            
            return adtech.keywordAdmin.registerKeyword(keyword)
            .then(function(id) {
                log.info('Created keyword %1 for "%2"', id, keyword);
                campaignUtils._keywordCache[keyword] = id;
                setTimeout(function() {
                    delete campaignUtils._keywordCache[keyword];
                }, keywordTTL);
                return id;
            })
            .catch(function(error) {
                log.error('Error registering keyword %1: %2', keyword, error);
                return q.reject('Adtech failure');
            });
        }));
    };

    campaignUtils.formatCampaign = function(campaign, keywords, sponsored) {
        var campFeatures = adtech.campaignAdmin.makeCampaignFeatures({
            targeting: true,
            placements: true,
            frequency: true,
            schedule: true,
            ngkeyword: true,
            keywordLevel: true,
            volume: true
        }), kwlp1, kwlp3;
        keywords = keywords || {};
        kwlp1 = adtech.campaignAdmin.makeKeywordIdList(keywords.level1 || []);
        kwlp3 = adtech.campaignAdmin.makeKeywordIdList(keywords.level3 || []);
        
        return {
            adGoalTypeId: 1,
            advertiserId: Number(campaign.advertiserId),
            campaignFeatures: campFeatures,
            campaignTypeId: 26954,
            customerId: Number(campaign.customerId),
            dateRangeList: adtech.campaignAdmin.makeDateRangeList([{
                endDate: new Date(campaign.created.valueOf() + 365*24*60*60*1000).toISOString(),
                startDate: campaign.created.toISOString()
            }]),
            extId: campaign.id,
            frequencyConfig: {
                type: adtech.constants.ICampaign.FREQUENCY_TYPE_NONE
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
            },
            priority: sponsored ? 2 : 3,
            priorityLevelOneKeywordIdList: kwlp1,
            priorityLevelThreeKeywordIdList: kwlp3,
            viewCount: true
        };
    };

    campaignUtils.formatBanner = function(type, extId) {
        var retObj = {},
            typeConfig = bannerTypes[type];

        retObj.banner = {
            data                : typeConfig.template.toString('base64'),
            extId               : extId,
            fileType            : 'html',
            id                  : -1,
            mainFileName        : 'index.html',
            name                : type + ' ' + extId,
            originalData        : typeConfig.template.toString('base64'),
            sizeTypeId          : typeConfig.sizeTypeId,
            statusId            : adtech.constants.IBanner.STATUS_ACTIVE,
            styleTypeId         : adtech.constants.IBanner.STYLE_HTML
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

    campaignUtils.createBanners = function(bannCfgs, oldBanns, type, campId) {
        var log = logger.getLog(),
            toCreate = [];
        oldBanns = oldBanns || [];
            
        if (!bannCfgs) {
            return q();
        }

        bannCfgs.forEach(function(item, idx) {
            var existing = oldBanns.filter(function(oldBann) { return item.id === oldBann.id; })[0];
            if (!existing) { // Create new banners for anything not in oldBanns
                toCreate.push(campaignUtils.formatBanner(type, item.id));
            } else { // copy adtech ids from existing obj for anything already in oldBanns
                bannCfgs[idx] = existing;
            }
        });
        
        // seems like adtech won't let us create multiple banners concurrently, so do 1 by 1
        return toCreate.reduce(function(promise, obj) {
            return promise.then(function() {
                return adtech.bannerAdmin.createBanner(campId, obj.banner, obj.bannerInfo);
            })
            .then(function(resp) {
                log.info('Created banner "%1", id %2, for campaign %3', resp.name, resp.id, campId);
                bannCfgs.forEach(function(item) {
                    if (item.id === resp.extId) {
                        item.bannerNumber = resp.bannerNumber;
                        item.bannerId = resp.id;
                    }
                });
            })
            .catch(function(error) {
                log.error('Error creating banner %1 for campaign %2: %3',
                          obj.banner.name, campId, error);
                return q.reject(error);
            });
        }, q());
    };
    
    campaignUtils.cleanBanners = function(newBanners, oldBanners, campId) {
        var log = logger.getLog();
        
        if (!newBanners || !oldBanners) {
            return q();
        }
        
        return oldBanners.reduce(function(promise, oldBann) {
            return promise.then(function() {
                if (newBanners.some(function(newBann) { return newBann.id === oldBann.id; })) {
                    log.trace('Banner %1 still exists for %2', oldBann.id, campId);
                    return q();
                }
                
                log.info('Banner %1 removed from %2, deleting it in Adtech', oldBann.id, campId);
                         
                return adtech.bannerAdmin.deleteBanner(oldBann.bannerId)
                .then(function() {
                    log.info('Succesfully deleted banner %1 for %2', oldBann.id, campId);
                })
                .catch(function(error) {
                    log.error('Error deleting banner %1: %2', oldBann.id, error);
                    return q.reject(error);
                });
            });
        }, q());
    };

    module.exports = campaignUtils;
}());
