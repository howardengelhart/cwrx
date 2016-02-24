(function(){
    'use strict';
    
    var q               = require('q'),
        util            = require('util'),
        logger          = require('./logger'),
        promise         = require('./promise'),
        objUtils        = require('./objUtils'),
        requestUtils    = require('./requestUtils'),

        campaignUtils = { _keywordCache: new promise.Keeper() };
        
    /* Return true if obj.startDate and obj.endDate are valid (ISO date strings, end > start).
     * Also returns false if obj.endDate has changed and is in the past. */
    campaignUtils.validateDates = function(obj, existing, reqId) {
        var log = logger.getLog(),
            existingEnd = existing && existing.endDate || undefined;
        
        if (obj.startDate && !(new Date(obj.startDate).valueOf())) {
            log.info('[%1] startDate is not a valid date string: %2', reqId, obj.startDate);
            return false;
        }
        if (obj.endDate && !(new Date(obj.endDate).valueOf())) {
            log.info('[%1] endDate is not a valid date string: %2', reqId, obj.endDate);
            return false;
        }
        if (obj.endDate && new Date(obj.endDate) <= new Date() && obj.endDate !== existingEnd) {
            log.info('[%1] endDate is in the past: %2', reqId, obj.endDate);
            return false;
        }
        if (obj.startDate && obj.endDate && new Date(obj.endDate) <= new Date(obj.startDate)) {
            log.info('[%1] endDate %2 must be greater than startDate %3',
                     reqId, obj.endDate, obj.startDate);
            return false;
        }
        
        return true;
    };
    
    /* Calls campaignUtils.validateDates for each entry in body.cards.
     * Each entry in body.cards and origObj.cards should be a full C6 card entity.
     * delays should be the dateDelays object from the campaign config */
    campaignUtils.validateAllDates = function(body, origObj, requester, reqId) {
        if (!body.cards) {
            return { isValid: true };
        }

        function findExisting(newCard) {
            return (origObj && origObj.cards || []).filter(function(oldCard) {
                return oldCard.id === newCard.id;
            })[0];
        }

        for (var i = 0; i < body.cards.length; i++) {
            var card = body.cards[i],
                origCard = findExisting(card);
            
            if (!card.campaign) {
                continue;
            }

            var valid = campaignUtils.validateDates(
                card.campaign,
                origCard && origCard.campaign,
                reqId
            );

            if (!valid) {
                return { isValid: false, reason: 'cards[' + i + '] has invalid dates' };
            }
        }

        return { isValid: true };
    };

    // Ensures each entry in body.cards and body.miniReels has a unique id
    campaignUtils.ensureUniqueIds = function(body) {
        var keys = ['miniReels', 'cards'];
            
        function getIds(list) {
            if (!(list instanceof Array)) {
                return [];
            }

            return list.map(function(item) {
                return item.id || null;
            }).filter(function(id) {
                return !!id;
            });
        }

        for (var i = 0; i < keys.length; i++) {
            var ids = getIds(body[keys[i]]);
            
            if (!objUtils.isListDistinct(ids)) {
                return { isValid: false, reason: keys[i] + ' must be distinct' };
            }
        }
        return { isValid: true };
    };

    // Compute cost for the campaign, based on targeting added
    campaignUtils.computeCost = function(body, origObj, actingSchema) {
        var cfg = actingSchema.pricing.cost,
            targeting = body.targeting || (origObj && origObj.targeting) || {},
            geo = targeting.geo || {},
            demo = targeting.demographics || {},
            geoCostAdded = false, demoCostAdded = false;
        
        var cost = cfg.__base;
        
        ['states', 'dmas'].forEach(function(key) {
            if (geo[key] && geo[key].length > 0) {
                cost += cfg.__pricePerGeo; // add cost per geo sub-category
                if (!geoCostAdded) { // add one-time cost for any geo targeting
                    cost += cfg.__priceForGeoTargeting;
                    geoCostAdded = true;
                }
            }
        });
        
        if (geo.zipcodes && geo.zipcodes.codes && geo.zipcodes.codes.length > 0) {
            cost += cfg.__pricePerGeo; // add cost per geo sub-category
            if (!geoCostAdded) { // add one-time cost for any geo targeting
                cost += cfg.__priceForGeoTargeting;
                geoCostAdded = true;
            }
        }
        
        ['gender', 'age', 'income'].forEach(function(key) {
            if (demo[key] && demo[key].length > 0) {
                cost += cfg.__pricePerDemo; // add cost per demographics sub-category
                if (!demoCostAdded) { // add one-time cost for any demographics targeting
                    cost += cfg.__priceForDemoTargeting;
                    demoCostAdded = true;
                }
            }
        });
        
        if (targeting.interests && targeting.interests.length > 0) {
            cost += cfg.__priceForInterests;
        }
        
        return parseFloat(cost.toFixed(2)); // round to nearest penny to fix weird float handling
    };
    
    /* Extra validation for pricing, including dailyLimit checking + cost computing.
     * model should be an instantiated campaign model.
     * recomputeCost, if true, tells validatePricing to always recompute the cost, even if the
     * requester can set their own cost. */
    campaignUtils.validatePricing = function(body, origObj, requester, model, recomputeCost) {
        var origPricing = origObj && origObj.pricing || undefined,
            actingSchema = model.personalizeSchema(requester);

        // ensure pricing is validated if set on origObj but not on req.body
        body.pricing = body.pricing || (origPricing && JSON.parse(JSON.stringify(origPricing)));
        
        if (!body.pricing) {
            return { isValid: true };
        }

        // if requester can set own cost, take the value from body, origObj, or computeCost
        if (actingSchema.pricing.cost.__allowed === true && !recomputeCost) {
            body.pricing.cost = body.pricing.cost || origPricing && origPricing.cost ||
                                campaignUtils.computeCost(body, origObj, actingSchema);
        }
        else { // otherwise recompute the cost each time
            body.pricing.cost = campaignUtils.computeCost(body, origObj, actingSchema);
        }
        
        // copy over any missing props from original pricing
        objUtils.extend(body.pricing, origPricing);
        
        // don't validate dailyLimit if no budget set
        if (body.pricing.budget === undefined || body.pricing.budget === null) {
            return { isValid: true };
        }
        
        // validate dailyLimit:
        var limitMin = actingSchema.pricing.dailyLimit.__percentMin,
            limitMax = actingSchema.pricing.dailyLimit.__percentMax;
            
        if (!body.pricing.dailyLimit) {
            return { isValid: true };
        }

        // check if dailyLimit is within __percentMin and __percentMax of budget
        var ratio = (body.pricing.dailyLimit / body.pricing.budget) || 0;
        
        if (ratio < limitMin || ratio > limitMax) {
            return {
                isValid: false,
                reason: 'dailyLimit must be between ' + limitMin + ' and ' + limitMax +
                        ' of budget ' + body.pricing.budget
            };
        }
        
        return { isValid: true };
    };
    
    /* Check that paymentMethod on body is valid + owned by the campaign's org.
     * payMethodUrl should be the full API url for fetching payment methods. */
    campaignUtils.validatePaymentMethod = function(body, origObj, requester, payMethodUrl, req) {
        var log = logger.getLog(),
            origToken = origObj && origObj.paymentMethod,
            token = body.paymentMethod = body.paymentMethod || origToken, // preserve old token
            orgId = body.org || origObj && origObj.org;
            
        // Pass if no token defined or if token unchanged.
        if (!token || token === origToken) {
            return q({ isValid: true, reason: undefined });
        }
        
        // Proxy request to orgSvc's payment method endpoint
        return requestUtils.proxyRequest(req, 'get', {
            url: payMethodUrl,
            qs: { org: orgId }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 200) {
                log.warn('[%1] Requester %2 cannot fetch payment methods for %3: %4, %5',
                         req.uuid, requester.id, orgId, resp.response.statusCode, resp.body);
                return {
                    isValid: false,
                    reason: 'cannot fetch payment methods for this org'
                };
            }
            
            var exists = resp.body.some(function(method) {
                return method.token === token;
            });
            
            return {
                isValid: exists,
                reason: (!exists && ('paymentMethod ' + token + ' does not exist for ' + orgId)) ||
                        undefined
            };
        })
        .catch(function(error) {
            log.error('[%1] Error fetching payment methods for %2: %3',
                      req.uuid, orgId, util.inspect(error));
            return q.reject('Error fetching payment methods');
        });
    };
    
    campaignUtils.validateZipcodes = function(body, origObj, requester, zipUrl, req) {
        var log = logger.getLog(),
            codes = body.targeting && body.targeting.geo && body.targeting.geo.zipcodes &&
                    body.targeting.geo.zipcodes.codes || null;
        
        if (!codes || codes.length === 0) {
            return q({ isValid: true, reason: undefined });
        }
        
        return requestUtils.proxyRequest(req, 'get', {
            url: zipUrl,
            qs: { zipcodes: codes.join(','), fields: 'zipcode' }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 200) {
                log.warn('[%1] User %2 cannot fetch zipcodes: %3, %4',
                         req.uuid, requester.id, resp.response.statusCode, resp.body);
                return {
                    isValid: false,
                    reason: 'cannot fetch zipcodes'
                };
            }
            
            if (resp.body.length === codes.length) {
                return { isValid: true, reason: undefined };
            }
            
            var missing = codes.filter(function(reqCode) {
                return resp.body.every(function(obj) { return obj.zipcode !== reqCode; });
            });
            
            return {
                isValid: false,
                reason: 'These zipcodes were not found: [' + missing.join(',') + ']'
            };
        })
        .catch(function(error) {
            log.error('[%1] Error fetching zipcodes: %2', req.uuid, util.inspect(error));
            return q.reject('Error fetching zipcodes');
        });
    };

    module.exports = campaignUtils;
}());
