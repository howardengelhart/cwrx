(function(){
    'use strict';
    
    var q       = require('q'),
        path    = require('path'),
        fs      = require('fs-extra'),
        adtech  = require('adtech'),
        logger  = require('./logger'),

        bannerDir = path.join(__dirname, '../templates/adtechBanners'),
        bannerTypes = {
            card: {
                sizeTypeId: 277,
                template: fs.readFileSync(path.join(bannerDir, 'card.html'))
            },
            miniReel: { // sponsored minireel
                sizeTypeId: 1182,
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            targetMiniReel: {
                sizeTypeId: 509,
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            contentMiniReel: {
                sizeTypeId: 16,
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            }
        },
        
        adtechUtils = {};


    adtechUtils.formatCampaign = function(campaign) {
        var campFeatures = adtech.campaignAdmin.makeCampaignFeatures({
            targeting: true,
            placements: true,
            frequency: true,
            schedule: true,
            ngkeyword: true,
            keywordLevel: true,
            volume: true
        });

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
            priority: 3,
            // priorityLevelOneKeywordIdList: [3171661] //TODO: properly set kwlp keywords
        };
    };

    adtechUtils.formatBanner = function(type, extId) {
        var retObj = { _type: type },
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

    adtechUtils.createBanners = function(bannerCfgs, type, campaignId) {
        var log = logger.getLog(),
            banners = [];
            
        banners = bannerCfgs.filter(function(item) { return !item.adtechId; })
                            .map(function(item) { return adtechUtils.formatBanner(type,item.id); });
        
        // seems like adtech won't let us create multiple banners concurrently, so do 1 by 1
        return banners.reduce(function(promise, obj) {
            return promise.then(function() {
                return adtech.bannerAdmin.createBanner(campaignId, obj.banner, obj.bannerInfo);
            })
            .then(function(resp) {
                log.info('Created banner "%1", id %2, for campaign %3',
                         resp.name, resp.bannerNumber, campaignId);
                bannerCfgs.forEach(function(item) {
                    if (item.id === resp.extId) {
                        item.adtechId = resp.bannerNumber;
                    }
                });
            })
            .catch(function(error) {
                log.error('Error creating banner %1 for campaign %2: %3',
                          obj.banner.name, campaignId, error);
                return q.reject(error);
            });
        }, q());
    };

    module.exports = adtechUtils;
}());
