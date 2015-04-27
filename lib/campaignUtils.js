(function(){
    'use strict';
    
    var q           = require('q'),
        adtech      = require('adtech'),
        logger      = require('./logger'),
        promise     = require('./promise'),
        objUtils    = require('./objUtils'),
        kCamp       = adtech.constants.ICampaign,

        keywordTTL = 1000*60*60*24,
        campaignUtils = { _keywordCache: new promise.Keeper() };

    /* Return true if obj.startDate and obj.endDate are valid (ISO date strings, end > start).
     * Also returns false if obj.endDate has changed and is in the past.
     * Also defaults each to (now + delays[start || end]) and at least 1 hour in the future. */
    campaignUtils.validateDates = function(obj, existing, delays, reqId) {
        var log = logger.getLog(),
            existingEnd = existing && existing.endDate || undefined,
            now = new Date();
        delays = delays || { start: 0, end: 2000 };

        obj.startDate = obj.startDate || new Date(now.valueOf()+ delays.start).toISOString();
        obj.endDate = obj.endDate || new Date(now.valueOf() + delays.end).toISOString();
        
        if (!(new Date(obj.startDate).valueOf())) {
            log.info('[%1] startDate is not a valid date string: %2', reqId, obj.startDate);
            return false;
        }
        if (!(new Date(obj.endDate).valueOf())) {
            log.info('[%1] endDate is not a valid date string: %2', reqId, obj.endDate);
            return false;
        }
        if (new Date(obj.endDate) <= new Date() && obj.endDate !== existingEnd) {
            log.info('[%1] endDate is in the past: %2', reqId, obj.endDate);
            return false;
        }
        if (new Date(obj.endDate) <= new Date(obj.startDate)) {
            log.info('[%1] endDate %2 must be greater than startDate %3',
                     reqId, obj.endDate, obj.startDate);
            return false;
        }
        
        return true;
    };

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
    campaignUtils.formatCampaign = function(campaign) {
        var campFeatures = {
            targeting: true,
            placements: true,
            frequency: true,
            schedule: true,
            ngkeyword: true,
            keywordLevel: true,
            volume: true
        };
        campaign.keywords = campaign.keywords || {};
        
        return {
            adGoalTypeId: 1,
            advertiserId: parseInt(campaign.advertiserId),
            bannerDeliveryTypeId: 1,
            campaignFeatures: campFeatures,
            campaignTypeId: campaign.campaignTypeId,
            customerId: parseInt(campaign.customerId),
            dateRangeList: [{
                deliveryGoal: {
                    desiredImpressions: campaign.impressions || 1000000000
                },
                endDate: campaign.endDate,
                startDate: campaign.startDate
            }],
            extId: campaign.id,
            exclusiveType: kCamp.EXCLUSIVE_TYPE_END_DATE,
            exclusive: true,
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
            priority: 3,
            priorityLevelOneKeywordIdList: campaign.keywords.level1,
            priorityLevelThreeKeywordIdList: campaign.keywords.level3,
            viewCount: true
        };
    };
    
    /* Format and create a single Adtech campaign. campaign should have the following fields:
     * - id             : C6 id, will become extId
     * - name           : should be unique
     * - startDate      : should be ISO string
     * - endDate        : should be ISO string and greater than startDate
     * - keywords       : should be the output of makeKeywordLevels()
     * - advertiserId   : adtech id of advertiser
     * - customerId     : adtech id of advertiser
     */
    campaignUtils.createCampaign = function(campaign, reqId) {
        var log = logger.getLog();
        
        return adtech.campaignAdmin.createCampaign(campaignUtils.formatCampaign(campaign))
        .then(function(resp) {
            log.info('[%1] Created Adtech campaign %2, named "%3", for %4',
                     reqId, resp.id, campaign.name, campaign.id);
            return q(resp);
        })
        .catch(function(error) {
            log.error('[%1] Error creating campaign %2: %3', reqId, campaign.name, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    // Edit a campaign, setting certain props. keys should be output of makeKeywordLevels()
    campaignUtils.editCampaign = function(name, campaign, keys, reqId) {
        var log = logger.getLog();
        
        return adtech.campaignAdmin.getCampaignById(campaign.adtechId)
        .then(function(resp) {
            log.trace('[%1] Retrieved campaign %2', reqId, campaign.adtechId);
            var record = JSON.parse(JSON.stringify(resp));
            objUtils.trimNull(record);
            record.name = name || record.name;
            
            // Adtech won't allow editing active camp's startDate, so we instead take Adtech's val
            if (resp.statusTypeId === kCamp.STATUS_ACTIVE) {
                log.info('[%1] Campaign %2 is active, not updating its startDate',
                         reqId, campaign.adtechId);
                campaign.startDate = record.dateRangeList[0].startDate;
            } else {
                record.dateRangeList[0].startDate = campaign.startDate ||
                                                    record.dateRangeList[0].startDate;
            }
            
            record.dateRangeList[0].endDate = campaign.endDate || record.dateRangeList[0].endDate;
            
            record.priorityLevelOneKeywordIdList = keys && keys.level1 ||
                                                   record.priorityLevelOneKeywordIdList;
            record.priorityLevelThreeKeywordIdList = keys && keys.level3 ||
                                                     record.priorityLevelThreeKeywordIdList;
            
            return adtech.campaignAdmin.updateCampaign(record);
        })
        .then(function() {
            log.info('[%1] Successfully updated campaign %2', reqId, campaign.adtechId);
        })
        .catch(function(error) {
            log.error('[%1] Error editing campaign %2: %3', reqId, campaign.adtechId, error);
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
    
    /* Delete multiple campaigns from adtech, polling to make sure they're stopped first.
     * If any campaign encounters errors, this will reject the promise */
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
                        log.error('Failed deleting campaign %1: %2', id, error);
                        return q.reject('Failed on campaign ' + id);
                    });
                }));
            });
            
            // This should eventually resolve or reject all promises in deferreds
            campaignUtils.pollStatuses(deferreds, kCamp.STATUS_EXPIRED, delay, maxAttempts);
            
            return q.all(promises);
        })
        .catch(function(error) {
            log.error('Error deleting campaigns %1: %2', ids, error);
            return q.reject(new Error('Adtech failure'));
        });
    };
    
    module.exports = campaignUtils;
}());
