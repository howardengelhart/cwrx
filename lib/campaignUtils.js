(function(){
    'use strict';
    
    var q           = require('q'),
        adtech      = require('adtech'),
        logger      = require('./logger'),
        promise     = require('./promise'),
        objUtils    = require('./objUtils'),
        kCamp       = adtech.constants.ICampaign,

        keywordTTL = 1000*60*60*24, // TODO: move this to actual config?
        campaignUtils = { _keywordCache: new promise.Keeper() };
        
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
            var deferred = campaignUtils._keywordCache.getDeferred(keyword, true);
            
            if (!deferred) {
                deferred = campaignUtils._keywordCache.defer(keyword);
                
                adtech.keywordAdmin.registerKeyword(keyword)
                .then(function(id) {
                    log.info('Created keyword %1 for "%2"', id, keyword);
                    deferred.resolve(id);
                    setTimeout(function() {
                        campaignUtils._keywordCache.remove(keyword, true);
                    }, keywordTTL);
                })
                .catch(function(error) {
                    log.error('Error registering keyword %1: %2', keyword, error);
                    deferred.reject(new Error('Adtech failure'));
                    campaignUtils._keywordCache.remove(keyword, true);
                });
            }
            
            return deferred.promise;
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
            
        return adtech.campaignAdmin.createCampaign(record)
        .then(function(resp) {
            log.info('Created Adtech campaign %1, named "%2", for %3', resp.id, name, id);
            return q(resp);
        })
        .catch(function(error) {
            log.error('Error creating campaign %1: %2', name, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Edit a campaign, setting new name + keywords. keys should be output of makeKeywordLevels
    campaignUtils.editCampaign = function(adtechId, name, keys) {
        var log = logger.getLog();
        
        return adtech.campaignAdmin.getCampaignById(adtechId)
        .then(function(resp) {
            log.trace('Retrieved campaign %1', adtechId);
            var record = JSON.parse(JSON.stringify(resp));
            objUtils.trimNull(record);
            record.name = name || record.name;
            record.priorityLevelOneKeywordIdList = keys && keys.level1 ||
                                                   record.priorityLevelOneKeywordIdList;
            record.priorityLevelThreeKeywordIdList = keys && keys.level3 ||
                                                     record.priorityLevelThreeKeywordIdList;
            
            return adtech.campaignAdmin.updateCampaign(record);
        })
        .then(function() {
            log.info('Successfully updated campaign %1', adtechId);
        })
        .catch(function(error) {
            log.error('Error editing campaign %1: %2', adtechId, error);
            return q.reject(new Error('Adtech failure'));
        });
    };

    /* Poll the statuses of multiple campaigns. deferreds should be an object mapping campaign ids
     * to deferred objects. This will periodically check the status values for all campaign ids in
     * deferreds whose promises are not resolved; once a campaign's status matches desired, its
     * promise in deferreds is resolved. This will keep polling, waiting delay between tries, until
     * attempts = maxAttempts or every promise in deferreds is resolved. */
    campaignUtils.pollStatuses = function(deferreds, desired, delay, maxAttempts, attempts) {
        var log = logger.getLog(),
            errorStatuses = {},
            pollIds;
            
        attempts = (attempts !== undefined) ? attempts : maxAttempts;
        errorStatuses[kCamp.STATUS_ERROR_STARTING] = 'STATUS_ERROR_STARTING';
        errorStatuses[kCamp.STATUS_ERROR_UPDATING] = 'STATUS_ERROR_UPDATING';
        errorStatuses[kCamp.STATUS_ERROR_STOPPING] = 'STATUS_ERROR_STOPPING';

        // only check campaigns that haven't successfully transitioned yet
        pollIds = Object.keys(deferreds).filter(function(id) {
            return deferreds[id].promise.isPending();
        });

        if (pollIds.length === 0) {
            return q();
        }
        
        log.trace('Polling for statuses of [%1], %2 attempts remaining', pollIds, attempts);
        
        // No more tries left, so reject each pending campaign, including its last status in msg
        if (attempts-- < 1) {
            pollIds.forEach(function(id) {
                deferreds[id].reject('Status for ' + id + ' is ' + deferreds[id].lastStatus +
                                     ' after ' + maxAttempts + ' poll attempts');
            });
            return q();
        }
        
        return adtech.campaignAdmin.getCampaignStatusValues(pollIds)
        .then(function(results) {
            for (var id in results) {
                deferreds[id].lastStatus = results[id]; // set lastStatus, for error reporting
                if (results[id] === desired) {
                    log.trace('Campaign %1 successfully transitioned to status %2', id, desired);
                    deferreds[id].resolve();
                } else if (results[id] in errorStatuses) { // status change failed for this camp
                    deferreds[id].reject('Status for ' + id + ' is ' + errorStatuses[results[id]]);
                }
            }
        },
        function(error) { // if a status check fails, warn and keep trying
            log.warn('Failed to get statuses for %1: %2', pollIds, error);
        })
        .then(function() {
            if (Object.keys(deferreds).filter(function(id) {
                return deferreds[id].promise.isPending();
            }).length === 0) {
                return q();
            }
            
            return q.delay(delay).then(function() { // wait, then recursively check again
                return campaignUtils.pollStatuses(deferreds, desired, delay, maxAttempts, attempts);
            });
        });
    };
    
    // TODO: should failing to delete campaigns just log warnings, or should it reject promises?

    /* Delete multiple campaigns from adtech, polling to make sure they're stopped first
     * If campaigns encounter errors, this will log warnings but not reject the promise */
    campaignUtils.deleteCampaigns = function(ids, delay, maxAttempts) {
        var log = logger.getLog();
        
        if (!(ids instanceof Array) || ids.length === 0) {
            return q();
        }
        
        // stop all the campaigns first
        return q.all(ids.map(function(id) {
            return adtech.pushAdmin.stopCampaignById(id);
        }))
        .then(function() {
            var deferreds = {},
                promises = [];

            ids.forEach(function(id) { // set up list of deferreds
                deferreds[id] = q.defer();
                
                // Delete campaign as soon as it has transitioned to stopped state
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
            
            // This should eventually resolve or reject all promises in deferreds
            campaignUtils.pollStatuses(deferreds, kCamp.STATUS_EXPIRED, delay, maxAttempts);
            
            return q.allSettled(promises);
        })
        .then(function(results) {
            results.forEach(function(result) {
                if (result.state === 'rejected') {
                    log.warn(result.reason);
                }
            });
        })
        .catch(function(error) {
            log.error('Error deleting campaigns %1: %2', ids, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    module.exports = campaignUtils;
}());
