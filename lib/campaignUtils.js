(function(){
    'use strict';
    
    var q       = require('q'),
        path    = require('path'),
        fs      = require('fs-extra'),
        adtech  = require('adtech'),
        logger  = require('./logger'),
        kCamp   = adtech.constants.ICampaign,
        kBanner = adtech.constants.IBanner,

        bannerDir = path.join(__dirname, '../templates/adtechBanners'),
        keywordTTL = 1000*60*60*24, // TODO: move this to actual config?
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
        campaignUtils = { _keywordCache: {} };


    ////////////////////////////// Campaign Helper Methods //////////////////////////////

    // Transform a list of ids into a list of objects, if the items are not already objects
    campaignUtils.objectify = function(list) {
        if (!(list instanceof Array)) {
            return list;
        }
        
        return list.map(function(item) {
            if (typeof item !== 'object') {
                return { id: item };
            } else {
                return item;
            }
        });
    };

    // Get adtech ids for advertiser and customer by searching mongo; attaches them to req
    campaignUtils.getAccountIds = function(advertColl, custColl, req, next, done) {
        var log = logger.getLog(),
            doneCalled = false;
        
        function lookup(key, coll) {
            var c6Id = req.body[key] || (req.origObj && req.origObj[key]) || null,
                objName = key.replace(/Id$/, '');
            
            return q.npost(coll, 'findOne', [{id: String(c6Id)}, {id: 1, adtechId: 1}])
            .then(function(obj) {
                if (!obj) {
                    log.warn('[%1] Could not find %2 %3', req.uuid, objName, c6Id);
                    if (!doneCalled) {
                        doneCalled = true;
                        return done({code: 400, body: objName + ' ' + c6Id + ' does not exist'});
                    } else {
                        return q();
                    }
                }
                req['_' + key] = parseInt(obj.adtechId);
            })
            .catch(function(error) {
                log.error('[%1] Error looking up %2 %3: %4', req.uuid, objName, c6Id, error);
                return q.reject(new Error('Mongo failure'));
            });
        }
        
        return q.all([lookup('advertiserId', advertColl), lookup('customerId', custColl)])
        .then(function() {
            if (!doneCalled) {
                next();
            }
        });
    };
        
    // Lookup a list of keyword values given their adtech ids; uses a local keyword cache
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
                return q.reject(new Error('Adtech failure'));
            });
        }));
    };
    
    // Expects { level1: [...], ... }; transforms each list of keywords into list of keyword ids
    campaignUtils.makeKeywordLevels = function(keys) {
        return q.all(['level1', 'level2', 'level3'].map(function(level) {
            return campaignUtils.makeKeywords(keys[level]);
        }))
        .spread(function(kwlp1, kwlp2, kwlp3) {
            return { level1: kwlp1, level2: kwlp2, level3: kwlp3 };
        });
    };
    
    // Creates keywords in adtech, returning the id associated with each value; uses local cache
    campaignUtils.makeKeywords = function(keywords) {
        var log = logger.getLog();
        
        if (!(keywords instanceof Array)) {
            return q(keywords);
        }
        
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
                return q.reject(new Error('Adtech failure'));
            });
        }));
    };

    // Formats our representation of a campaign for saving to adtech, filling in some defaults
    campaignUtils.formatCampaign = function(campaign, keywords, isSponsored) {
        var campFeatures = {
            targeting: true,
            placements: true,
            frequency: true,
            schedule: true,
            ngkeyword: true,
            keywordLevel: true,
            volume: true
        };
        keywords = keywords || {};
        
        return {
            adGoalTypeId: 1,
            advertiserId: parseInt(campaign.advertiserId),
            bannerDeliveryTypeId: 1,
            campaignFeatures: campFeatures,
            campaignTypeId: 26954,
            customerId: parseInt(campaign.customerId),
            dateRangeList: [{
                deliveryGoal: {
                    desiredImpressions: campaign.impressions || 1000000000
                },
                endDate: new Date(campaign.created.valueOf() + 365*24*60*60*1000).toISOString(),
                startDate: campaign.created.toISOString()
            }],
            extId: campaign.id,
            frequencyConfig: {
                type: kCamp.FREQUENCY_TYPE_NONE
            },
            id: campaign.adtechId && parseInt(campaign.adtechId),
            name: campaign.name,
            optimizerTypeId: 6,
            optimizingConfig: {
                minClickRate: 0,
                minNoPlacements: 0
            },
            pricingConfig: {
                cpm: 0,
                invoiceImpressions: campaign.impressions || 1000000000
            },
            priority: isSponsored ? 2 : 3,
            priorityLevelOneKeywordIdList: keywords.level1,
            priorityLevelThreeKeywordIdList: keywords.level3,
            viewCount: true
        };
    };
    
    // Format and create a single campaign
    campaignUtils.createCampaign = function(id, name, isSponsored, keys, advertiserId, customerId) {
        var log = logger.getLog(),
            campObj = {
                id: id,
                name: name,
                advertiserId: advertiserId,
                customerId: customerId,
                created: new Date()
            },
            record = campaignUtils.formatCampaign(campObj, keys, isSponsored);
            
        return adtech.campaignAdmin.createCampaign(record).then(function(resp) {
            log.info('Created Adtech campaign %1, named "%2", for %3', resp.id, name, id);
            return q(resp);
        })
        .catch(function(error) {
            log.error('Error creating campaign %1: %2', name, error);
            return q.reject(new Error('Adtech failure'));
        });
    };

    // TODO: comment. Rewrite to be less insane?
    campaignUtils.pollStatuses = function(deferreds, desired, delay, maxAttempts, attempts) {
        var log = logger.getLog(),
            errorStatuses = {},
            pollIds;
            
        attempts = (attempts !== undefined) ? attempts : maxAttempts;
        errorStatuses[kCamp.STATUS_ERROR_STARTING] = 'STATUS_ERROR_STARTING';
        errorStatuses[kCamp.STATUS_ERROR_UPDATING] = 'STATUS_ERROR_UPDATING';
        errorStatuses[kCamp.STATUS_ERROR_STOPPING] = 'STATUS_ERROR_STOPPING';
        pollIds = Object.keys(deferreds).filter(function(id) {
            return deferreds[id].promise.isPending();
        });
        
        log.trace('Polling for statuses of [%1], %2 attempts remaining', pollIds, attempts);
        
        if (pollIds.length === 0) {
            return q();
        }
        
        if (attempts-- < 1) {
            pollIds.forEach(function(id) {
                deferreds[id].reject('Status for ' + id + ' is ' + deferreds[id].lastStatus +
                                     ' after ' + maxAttempts + ' poll attempts');
                return q();
            });
        }
        
        return adtech.campaignAdmin.getCampaignStatusValues(pollIds)
        .then(function(results) {
            for (var id in results) {
                deferreds[id].lastStatus = results[id];
                if (results[id] === desired) {
                    log.trace('Campaign %1 successfully transitioned to status %2', id, desired);
                    deferreds[id].resolve();
                } else if (results[id] in errorStatuses) {
                    deferreds[id].reject('Status for ' + id + ' is ' + errorStatuses[results[id]]);
                }
            }
        },
        function(error) {
            log.warn('Failed to get statuses for %1: %2', pollIds, error);
        })
        .done(function() {
            if (Object.keys(deferreds).filter(function(id) {
                return deferreds[id].promise.isPending();
            }).length === 0) {
                return q();
            }
            
            return q.delay(delay).then(function() {
                return campaignUtils.pollStatuses(deferreds, desired, delay, maxAttempts, attempts);
            });
        });
    };
    
    // Delete multiple campaigns from adtech, polling to make sure they're stopped first
    campaignUtils.deleteCampaigns = function(ids, delay, maxAttempts) {
        var log = logger.getLog();
        
        if (!(ids instanceof Array) || ids.length === 0) {
            return q();
        }
            
        return q.all(ids.map(function(id) {
            return adtech.pushAdmin.stopCampaignById(id);
        })).then(function() {
            var deferreds = {},
                promises = [];

            ids.forEach(function(id) {
                deferreds[id] = q.defer();
                promises.push(deferreds[id].promise.then(function() {
                    return adtech.campaignAdmin.deleteCampaign(id)
                    .then(function() {
                        log.info('Successfully deleted campaign %1', id);
                    })
                    .catch(function(error) {
                        return q.reject('Failed deleting campaign ' + id + ': ' + error);
                    });
                }));
            });
            
            campaignUtils.pollStatuses(deferreds, kCamp.STATUS_EXPIRED, delay, maxAttempts);
            
            return q.allSettled(promises);
        }).then(function(results) {
            results.forEach(function(result) {
                if (result.state === 'rejected') {
                    log.warn(result.reason);
                }
            });
        });
    };
    
    
    ////////////////////////////// Banner Helper Methods //////////////////////////////

    // Format a banner for saving to adtech, based on a preset banner type
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
            statusId            : kBanner.STATUS_ACTIVE,
            styleTypeId         : kBanner.STYLE_HTML
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

    // Loops through bannCfgs and creates banners for anything that doesn't exist in oldBanns
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
        
        // adtech won't allow multiple concurrent campaign edits, so create banners 1 by 1
        return toCreate.reduce(function(promise, obj) {
            return promise.then(function() {
                return adtech.bannerAdmin.createBanner(campId, obj.banner, obj.bannerInfo);
            })
            .then(function(resp) {
                log.info('Created banner "%1", id %2, for campaign %3', resp.name, resp.id, campId);
                bannCfgs.forEach(function(item) {
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
    
    // Loops through oldBanners and deletes anything that doesn't exist in newBanners
    campaignUtils.cleanBanners = function(newBanners, oldBanners, campId) {
        var log = logger.getLog();
        
        if (!newBanners || !oldBanners) {
            return q();
        }
        
        // adtech won't allow multiple concurrent campaign edits, so delete banners 1 by 1
        return oldBanners.reduce(function(promise, oldBann) {
            if (newBanners.some(function(newBann) { return newBann.id === oldBann.id; })) {
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
    
    module.exports = campaignUtils;
}());
