(function(){
    'use strict';
    
    var q           = require('q'),
        path        = require('path'),
        fs          = require('fs-extra'),
        adtech      = require('adtech'),
        logger      = require('./logger'),
        kBanner     = adtech.constants.IBanner,

        bannerDir = path.join(__dirname, '../templates/adtechBanners'),
        bannerTypes = {
            card: {                 // sponsored card
                sizeTypeId: 277,    // 2x2
                template: fs.readFileSync(path.join(bannerDir, 'card.html'))
            },
            miniReel: {             // sponsored minireel
                sizeTypeId: 509,    // 2x1
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            },
            contentMiniReel: {      // regular minireel in content group
                sizeTypeId: 16,     // 1x1
                template: fs.readFileSync(path.join(bannerDir, 'minireel.html'))
            }
        },
        bannerUtils = {};

    // Format a banner for saving to adtech, based on a preset banner type
    bannerUtils.formatBanner = function(type, extId, isSponsored) {
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
            statusId            : kBanner.STATUS_ACTIVE,
            styleTypeId         : kBanner.STYLE_HTML
        };
        retObj.bannerInfo = {
            bannerReferenceId        : retObj.banner.id,
            entityFrequencyConfig    : {},
            name                     : retObj.banner.name,
            statusId                 : retObj.banner.statusId
        };

        if (!isSponsored) {
            retObj.bannerInfo.entityFrequencyConfig = {
                frequencyCookiesOnly : true,
                frequencyDistributed : true,
                frequencyInterval    : 30,
                frequencyTypeId      : adtech.constants.IFrequencyInformation.FREQUENCY_5_MINUTES
            };
        }
        
        return retObj;
    };

    // Loops through newBanns and creates banners for anything that doesn't exist in oldBanns
    bannerUtils.createBanners = function(newBanns, oldBanns, type, isSponsored, campId) {
        var log = logger.getLog(),
            toCreate = [];
        oldBanns = oldBanns || [];
            
        if (!newBanns) {
            return q();
        }

        newBanns.forEach(function(item, idx) {
            var existing = oldBanns.filter(function(oldBann) { return item.id === oldBann.id; })[0];
            if (!existing) { // Create new banners for anything not in oldBanns
                toCreate.push(bannerUtils.formatBanner(type, item.id, isSponsored));
            } else { // copy adtech ids from existing obj for anything already in oldBanns
                newBanns[idx] = existing;
            }
        });
        
        // adtech won't allow multiple concurrent campaign edits, so create banners 1 by 1
        return toCreate.reduce(function(promise, obj) {
            return promise.then(function() {
                return adtech.bannerAdmin.createBanner(campId, obj.banner, obj.bannerInfo);
            })
            .then(function(resp) {
                log.info('Created banner "%1", id %2, for campaign %3', resp.name, resp.id, campId);
                newBanns.forEach(function(item) {
                    if (item.id === resp.extId) {
                        item.bannerNumber = resp.bannerNumber;
                        item.bannerId = parseInt(resp.id);
                    }
                });
            })
            .catch(function(error) {
                log.error('Error creating banner %1 for campaign %2: %3',
                          obj.banner.name, campId, error);
                return q.reject(new Error('Adtech failure'));
            });
        }, q());
    };
    
    // Loops through oldBanns and deletes anything that doesn't exist in newBanns
    bannerUtils.cleanBanners = function(newBanns, oldBanns, campId) {
        var log = logger.getLog();
        
        if (!newBanns || !oldBanns) {
            return q();
        }
        
        // adtech won't allow multiple concurrent campaign edits, so delete banners 1 by 1
        return oldBanns.reduce(function(promise, oldBann) {
            if (newBanns.some(function(newBann) { return newBann.id === oldBann.id; })) {
                log.trace('Banner %1 still exists for %2', oldBann.id, campId);
                return promise;
            }
            
            log.info('Banner %1 removed from %2, deleting it in Adtech', oldBann.id, campId);
            if (!oldBann.bannerId) {
                log.warn('Banner %1 has no bannerId, cannot delete it', oldBann.id);
                return promise;
            }
            
            return promise.then(function() {
                return adtech.bannerAdmin.deleteBanner(oldBann.bannerId);
            })
            .then(function() {
                log.info('Succesfully deleted banner %1 for %2', oldBann.id, campId);
            })
            .catch(function(error) {
                log.error('Error deleting banner %1: %2', oldBann.id, error);
                return q.reject(new Error('Adtech failure'));
            });
        }, q());
    };
    
    module.exports = bannerUtils;
}());
