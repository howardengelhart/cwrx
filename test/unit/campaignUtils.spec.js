var flush = true;
describe('campaignUtils', function() {
    var q, mockLog, logger, promise, Model, adtech, requestUtils, campaignUtils, mockClient, kCamp, campModule,
        nextSpy, doneSpy, errorSpy, req;
    
    beforeEach(function() {
        jasmine.clock().install();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        promise         = require('../../lib/promise');
        requestUtils    = require('../../lib/requestUtils');
        campaignUtils   = require('../../lib/campaignUtils');
        campModule      = require('../../bin/ads-campaigns');
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        req = { uuid: '1234' };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
        
        mockClient = {client: 'yes'};
        
        ['adtech/lib/campaign', 'adtech/lib/banner', 'adtech/lib/keyword', 'adtech/lib/push'].forEach(function(key) {
            delete require.cache[require.resolve(key)];
        });
        adtech = require('adtech');
        kCamp = adtech.constants.ICampaign;
        adtech.campaignAdmin = require('adtech/lib/campaign');
        adtech.bannerAdmin = require('adtech/lib/banner');
        adtech.keywordAdmin = require('adtech/lib/keyword');
        adtech.pushAdmin = require('adtech/lib/push');
        ['campaignAdmin', 'bannerAdmin', 'keywordAdmin', 'pushAdmin'].forEach(function(admin) {
            Object.keys(adtech[admin]).forEach(function(prop) {
                if (typeof adtech[admin][prop] !== 'function') {
                    return;
                }
                adtech[admin][prop] = adtech[admin][prop].bind(adtech[admin], mockClient);
                spyOn(adtech[admin], prop).and.callThrough();
            });
        });
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('validateDates', function() {
        var now = new Date(),
            delays, obj, existing;
        beforeEach(function() {
            delays = { start: 2*60*60*1000, end: 3*60*60*1000 };
            obj = {};
            existing = {
                startDate: new Date(now.valueOf() - 5000).toISOString(),
                endDate: new Date(now.valueOf() - 4000).toISOString()
            };
        });
        
        it('should not default the startDate and endDate if undefined', function() {
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(true);
            expect(mockLog.info).not.toHaveBeenCalled();
            expect(obj).toEqual({});
        });

        it('should return false if the startDate is not a valid date string', function() {
            obj.startDate = new Date().toISOString() + 'foo';
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });

        it('should return false if the endDate is not a valid date string', function() {
            obj.endDate = {foo: 'bar'};
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });

        it('should return false if the startDate is greater than the endDate', function() {
            obj = { startDate: now.toISOString(), endDate: new Date(now.valueOf() - 1000).toISOString() };
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });
        
        it('should return false if the endDate is in the past and has changed', function() {
            obj = {
                startDate: new Date(now.valueOf() - 5000).toISOString(),
                endDate: new Date(now.valueOf() - 1000).toISOString()
            };
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
            expect(campaignUtils.validateDates(obj, undefined, delays)).toBe(false);
            obj.endDate = new Date(now.valueOf() - 4000).toISOString();
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(true);
            obj.endDate = new Date(new Date().valueOf() + 4000).toISOString();
            expect(campaignUtils.validateDates(obj, existing, delays)).toBe(true);
        });
    });

    describe('validateAllDates', function() {
        var body, origObj, requester, delays, reqId;
        beforeEach(function() {
            body = { cards: [
                { id: 'rc-1', campaign: { adtechId: 11 } },
                { id: 'rc-2', campaign: { adtechId: 12 } }
            ] };
            requester = { id: 'u-1', email: 'selfie@c6.com' };
            delays = { start: 100, end: 200 };
            reqId = '1234';
            spyOn(campaignUtils, 'validateDates').and.returnValue(true);
        });
        
        it('should call campaignUtils.validateDates for every list object', function() {
            var resp = campaignUtils.validateAllDates(body, origObj, requester, delays, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates.calls.count()).toBe(2);
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 11 }, undefined, {start: 100, end: 200}, '1234');
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 12 }, undefined, {start: 100, end: 200}, '1234');
        });
        
        it('should pass in existing sub-objects if they exist', function() {
            origObj = { cards: [{ id: 'rc-1', campaign: { adtechId: 11, startDate: '2015-10-25T00:27:03.456Z' } }] };
            var resp = campaignUtils.validateAllDates(body, origObj, requester, delays, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates.calls.count()).toBe(2);
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 11 },
                { adtechId: 11, startDate: '2015-10-25T00:27:03.456Z' }, {start: 100, end: 200}, '1234');
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 12 }, undefined, {start: 100, end: 200}, '1234');
        });
        
        it('should skip if no cards are defined', function() {
            delete body.cards;
            var resp = campaignUtils.validateAllDates(body, origObj, requester, delays, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates).not.toHaveBeenCalled();
        });
        
        it('should return an invalid response if validateDates returns false', function() {
            campaignUtils.validateDates.and.callFake(function(obj) {
                if (obj.adtechId === 12) return false;
                else return true;
            });
            var resp = campaignUtils.validateAllDates(body, origObj, requester, delays, reqId);
            expect(resp).toEqual({ isValid: false, reason: 'cards[1] has invalid dates' });
            expect(campaignUtils.validateDates.calls.count()).toBe(2);
        });
    });

    describe('ensureUniqueIds', function() {
        it('should return an invalid response if the cards list is not distinct', function() {
            var body = { cards: [{id: 'rc-1'}, {id: 'rc-2'}, {id: 'rc-1'}] };
            var resp = campaignUtils.ensureUniqueIds(body);
            expect(resp).toEqual({ isValid: false, reason: 'cards must be distinct' });
        });

        it('should return an invalid response if the miniReels list is not distinct', function() {
            var body = { miniReels: [{id: 'e-1'}, {id: 'e-2'}, {id: 'e-1'}] };
            var resp = campaignUtils.ensureUniqueIds(body);
            expect(resp).toEqual({ isValid: false, reason: 'miniReels must be distinct' });
        });

        it('should return a valid response if all lists are distinct', function() {
            var body = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}, {id: 'e-11'}] };
            var resp = campaignUtils.ensureUniqueIds(body);
            expect(resp).toEqual({ isValid: true });
        });
        
        it('should be able to handle multiple cards without ids', function() {
            var body = { cards: [{ title: 'card 1' }, { title: 'card 2' }, { id: 'rc-1' }] };
            var resp = campaignUtils.ensureUniqueIds(body);
            expect(resp).toEqual({ isValid: true });
                
            body.cards.unshift({ id: 'rc-1' });
                
            resp = campaignUtils.ensureUniqueIds(body);
            expect(resp).toEqual({ isValid: false, reason: 'cards must be distinct' });
        });
    });

    describe('ensureUniqueNames', function() {
        var body;
        beforeEach(function() {
            body = { cards: [
                { campaign: { adtechName: 'foo' } },
                { id: 'rc-1', campaign: { adtechName: 'bar' } }
            ] };
        });
        
        it('should return a valid response if all names are unique', function() {
            var resp = campaignUtils.ensureUniqueNames(body);
            expect(resp).toEqual({ isValid: true });
        });
        
        it('should skip if no cards are defined', function() {
            delete body.cards;
            var resp = campaignUtils.ensureUniqueNames(body);
            expect(resp).toEqual({ isValid: true });
        });
        
        it('should return an invalid response if multiple objects share the same name', function() {
            body.cards.push({ campaign: { adtechName: 'bar' }});
            var resp = campaignUtils.ensureUniqueNames(body);
            expect(resp).toEqual({ isValid: false, reason: 'cards[2] has a non-unique name: "bar"' });
        });
    });

    describe('computeCost', function() {
        var body, origObj, requester, model, actingSchema;
        beforeEach(function() {
            body = { targeting: {
                geo: {
                    states: [],
                    dmas: []
                },
                demographics: {
                    age: [],
                    gender: [],
                    income: []
                },
                interests: []
            } };
            origObj = {};
            requester = { id: 'u-1', fieldValidation: { campaigns: { pricing: { cost: {} } } } };
            model = new Model('campaigns', campModule.campSchema);
            actingSchema = model.personalizeSchema(requester);
        });

        it('should return a base price if no targeting exists', function() {
            delete body.targeting;
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.05);
        });
        
        it('should increase the price for each targeting sub-category chosen', function() {
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.05);
            body.targeting.geo.states.push('ohio', 'new jersey');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.06);
            body.targeting.geo.dmas.push('princeton', 'new york', 'chicago');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.07);
            body.targeting.demographics.age.push('18-24', '24-36');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.08);
            body.targeting.demographics.gender.push('female');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.09);
            body.targeting.demographics.income.push('1000', '2000');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.10);
            body.targeting.interests.push('cat-1');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.11);
        });
        
        it('should use the targeting on the origObj if undefined on the body', function() {
            origObj.targeting = { interests: ['cat-1'], geo: { states: ['ohio'] } };
            body = {};
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.07);
        });
        
        it('should be able to use different pricing config defined for the requester', function() {
            requester.fieldValidation.campaigns.pricing.cost = {
                __base: 0.51,
                __pricePerGeo: 0.11,
                __pricePerDemo: 0.21,
                __priceForInterests: 1.11
            };
            actingSchema = model.personalizeSchema(requester);
            
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.51);
            body.targeting.geo.states.push('ohio', 'new jersey');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.62);
            body.targeting.geo.dmas.push('princeton', 'new york', 'chicago');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.73);
            body.targeting.demographics.age.push('18-24', '24-36');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.94);
            body.targeting.demographics.gender.push('female');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(1.15);
            body.targeting.demographics.income.push('1000', '2000');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(1.36);
            body.targeting.interests.push('cat-1');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(2.47);
        });
    });
    
    describe('validatePricing', function() {
        var body, origObj, requester, model, actingSchema;
        beforeEach(function() {
            body = { pricing: {
                budget: 1000,
                dailyLimit: 200,
                model: 'cpv'
            } };
            origObj = null;
            requester = { id: 'u-1', fieldValidation: { campaigns: {} } };
            model = new Model('campaigns', campModule.campSchema);
            model.__origPersonalize = model.personalizeSchema;
            spyOn(model, 'personalizeSchema').and.callFake(function(requester) {
                var personalized = model.__origPersonalize(requester);
                actingSchema = personalized;
                return personalized;
            });
            spyOn(campaignUtils, 'computeCost').and.returnValue(0.05);
        });
        
        it('should skip if no pricing is on the request body', function() {
            delete body.pricing;
            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).not.toBeDefined();
        });
        
        it('should pass if everything is valid', function() {
            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).toEqual({
                budget: 1000,
                dailyLimit: 200,
                model: 'cpv',
                cost: 0.05
            });
            expect(campaignUtils.computeCost).toHaveBeenCalledWith(body, origObj, actingSchema);
        });

        it('should be able to set a default dailyLimit', function() {
            delete body.pricing.dailyLimit;
            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).toEqual({
                budget: 1000,
                dailyLimit: 1000,
                model: 'cpv',
                cost: 0.05
            });
        });
        
        it('should copy missing props from the original object', function() {
            delete body.pricing.dailyLimit;
            delete body.pricing.model;
            origObj = { pricing: { budget: 2000, dailyLimit: 500, model: 'cpm' } };

            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).toEqual({
                budget: 1000,
                dailyLimit: 500,
                model: 'cpm',
                cost: 0.05
            });
        });
        
        it('should be able to copy the entire original object\'s pricing', function() {
            delete body.pricing;
            origObj = { pricing: { budget: 2000, dailyLimit: 500, model: 'cpm' } };

            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).toEqual({
                budget: 2000,
                dailyLimit: 500,
                model: 'cpm',
                cost: 0.05
            });
        });
        
        it('should skip handling dailyLimit if no budget is set yet', function() {
            body.pricing = {};
            origObj = { pricing: { model: 'cpm' } };

            var resp = campaignUtils.validatePricing(body, origObj, requester, model);
            expect(resp).toEqual({ isValid: true });
            expect(body.pricing).toEqual({
                model: 'cpm',
                cost: 0.05
            });
        });
        
        it('should return a 400 if the user\'s dailyLimit is too high or too low', function() {
            [1, 10000000].forEach(function(limit) {
                var bodyCopy = JSON.parse(JSON.stringify(body));
                bodyCopy.pricing.dailyLimit = limit;

                var resp = campaignUtils.validatePricing(bodyCopy, origObj, requester, model);
                expect(resp).toEqual({ isValid: false, reason: 'dailyLimit must be between 0.015 and 1 of budget 1000' });
            });
        });
        
        describe('if the user has custom config for the dailyLimit prop', function() {
            beforeEach(function() {
                requester.fieldValidation.campaigns = {
                    pricing: {
                        dailyLimit: {
                            __percentDefault: 0.75,
                            __percentMin: 0.5,
                            __percentMax: 0.8
                        }
                    }
                };
            });
            
            it('should use the custom min + max for validation', function() {
                [0.4, 0.9].forEach(function(limitRatio) {
                    var bodyCopy = JSON.parse(JSON.stringify(body));
                    bodyCopy.pricing.dailyLimit = limitRatio * bodyCopy.pricing.budget;

                    var resp = campaignUtils.validatePricing(bodyCopy, origObj, requester, model);
                    expect(resp).toEqual({ isValid: false, reason: 'dailyLimit must be between 0.5 and 0.8 of budget 1000' });
                });
            });
            
            it('should use the custom default if no dailyLimit is set', function() {
                delete body.pricing.dailyLimit;
                var resp = campaignUtils.validatePricing(body, origObj, requester, model);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing).toEqual({
                    budget: 1000,
                    dailyLimit: 750,
                    model: 'cpv',
                    cost: 0.05
                });
            });
        });
        
        describe('if the user can set their own cost', function() {
            beforeEach(function() {
                requester.fieldValidation.campaigns = { pricing: { cost: { __allowed: true } } };
            });

            it('should allow any value set on the request body', function() {
                body.pricing.cost = 0.00000123456;
                var resp = campaignUtils.validatePricing(body, origObj, requester, model);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing.cost).toBe(0.00000123456);
                expect(campaignUtils.computeCost).not.toHaveBeenCalled();
            });
            
            it('should fall back to a value on the origObj', function() {
                origObj = { pricing: { cost: 0.123456 } };
                var resp = campaignUtils.validatePricing(body, origObj, requester, model);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing.cost).toBe(0.123456);
                expect(campaignUtils.computeCost).not.toHaveBeenCalled();
            });
            
            it('should compute the cost if nothing else is defined', function() {
                var resp = campaignUtils.validatePricing(body, origObj, requester, model);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing.cost).toBe(0.05);
                expect(campaignUtils.computeCost).toHaveBeenCalledWith(body, origObj, actingSchema);
            });
            
            it('should always recompute the cost if the recomputeCost flag is set', function() {
                body.pricing.cost = 0.00000123456;
                var resp = campaignUtils.validatePricing(body, origObj, requester, model, true);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing.cost).toBe(0.05);
                expect(campaignUtils.computeCost).toHaveBeenCalledWith(body, origObj, actingSchema);
            });
        });
        
        describe('if the user cannot set their own cost', function() {
            it('should override any cost on the request body with a freshly computed cost', function() {
                body.pricing.cost = 0.00000123456;
                var resp = campaignUtils.validatePricing(body, origObj, requester, model);
                expect(resp).toEqual({ isValid: true });
                expect(body.pricing.cost).toBe(0.05);
                expect(campaignUtils.computeCost).toHaveBeenCalledWith(body, origObj, actingSchema);
            });
        });
    });
    
    describe('validatePaymentMethod', function() {
        var body, origObj, requester, payMethodUrl, mockResp;
        beforeEach(function() {
            body = { name: 'camp 1', paymentMethod: 'abc', org: 'o-1' };
            origObj = { name: 'camp 1', paymentMethod: 'def' };
            requester = { id: 'u-1' };
            payMethodUrl = 'https://test.com/api/payments/methods/';
            mockResp = { response: { statusCode: 200 }, body: [{ token: 'abc' }, { token: 'def' }] };
            spyOn(requestUtils, 'qRequest').and.callFake(function() { return q(mockResp); });
            req.headers = { cookie: 'asdf1234' };
        });
        
        describe('if no paymentMethod is defined on the body or origObj', function() {
            beforeEach(function() {
                delete body.paymentMethod;
                delete origObj.paymentMethod;
            });
            
            it('should pass without making any request', function(done) {
                campaignUtils.validatePaymentMethod(body, undefined, requester, payMethodUrl, req).then(function(resp) {
                    expect(resp).toEqual({ isValid: true, reason: undefined });
                    expect(requestUtils.qRequest).not.toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if no paymentMethod is defined on the body', function() {
            beforeEach(function() {
                delete body.paymentMethod;
            });

            it('should copy the original payment method and pass without making any request', function(done) {
                campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                    expect(resp).toEqual({ isValid: true, reason: undefined });
                    expect(requestUtils.qRequest).not.toHaveBeenCalled();
                    expect(body.paymentMethod).toBe('def');
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if the paymentMethod is defined and identical on the body and origObj', function() {
            beforeEach(function() {
                body.paymentMethod = origObj.paymentMethod;
            });

            it('should pass without making any request', function(done) {
                campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                    expect(resp).toEqual({ isValid: true, reason: undefined });
                    expect(requestUtils.qRequest).not.toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should lookup the org\'s paymentMethods and return valid if the chosen method exists', function(done) {
            campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                expect(resp).toEqual({ isValid: true, reason: undefined });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {
                    url: 'https://test.com/api/payments/methods/',
                    qs: { org: 'o-1' },
                    headers: { cookie: 'asdf1234' }
                });
                expect(body.paymentMethod).toBe('abc');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should call done if the chosen paymentMethod is not found', function(done) {
            body.paymentMethod = 'ghi';
            campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                expect(resp).toEqual({ isValid: false, reason: 'paymentMethod ghi does not exist for o-1' });
                expect(requestUtils.qRequest).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should call done and warn if the request returns a non-200 response', function(done) {
            mockResp.response.statusCode = 403;
            mockResp.body = 'Forbidden';
            campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                expect(resp).toEqual({ isValid: false, reason: 'cannot fetch payment methods for this org' });
                expect(requestUtils.qRequest).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campaignUtils.validatePaymentMethod(body, origObj, requester, payMethodUrl, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error fetching payment methods');
                expect(requestUtils.qRequest).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('objectify', function() {
        it('should transform all of a list\'s items into objects', function() {
            expect(campaignUtils.objectify(['e1', 'e2', 'bananas'])).toEqual([{id: 'e1'}, {id: 'e2'}, {id: 'bananas'}]);
            expect(campaignUtils.objectify(['e1', {id: 'e2'}, 'bananas'])).toEqual([{id: 'e1'}, {id: 'e2'}, {id: 'bananas'}]);
            expect(campaignUtils.objectify([{foo: 'bar'}, {id: 'e2'}, 'bananas'])).toEqual([{foo: 'bar'}, {id: 'e2'}, {id: 'bananas'}]);
        });
        
        it('should just return a non-list param', function() {
            expect(campaignUtils.objectify(undefined)).toEqual(undefined);
            expect(campaignUtils.objectify('bananas')).toEqual('bananas');
        });
    });
    
    describe('getAccountIds', function() {
        var req, advertColl, custColl, mockDb;
        beforeEach(function() {
            req = { uuid: '1234', body: { advertiserId: 'a-1', customerId: 'cu-1' } };
            advertColl = {
                findOne: jasmine.createSpy('advertColl.findOne').and.callFake(function(query, fields, cb) {
                    if (query.id === 'a-1') cb(null, {id: 'a-1', adtechId: 123});
                    else if (query.id === 'a-bad') cb('ADVERTS GOT A PROBLEM');
                    else cb();
                })
            };
            custColl = {
                findOne: jasmine.createSpy('custColl.findOne').and.callFake(function(query, fields, cb) {
                    if (query.id === 'cu-1') cb(null, {id: 'cu-1', adtechId: 456});
                    else if (query.id === 'cu-bad') cb('CUSTS GOT A PROBLEM');
                    else cb();
                })
            };
            mockDb = {
                collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                    if (name === 'advertisers') return advertColl;
                    else return custColl;
                })
            };
        });
        
        it('should lookup the advertiser and customer', function(done) {
            campaignUtils.getAccountIds(mockDb, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._advertiserId).toBe(123);
                expect(req._customerId).toBe(456);
                expect(advertColl.findOne).toHaveBeenCalledWith({id: 'a-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                expect(custColl.findOne).toHaveBeenCalledWith({id: 'cu-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                done();
            });
        });
        
        it('should call done if one of the two is not found', function(done) {
            var req1 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-1', customerId: 'cu-2' } },
                req2 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-2', customerId: 'cu-1' } };
            campaignUtils.getAccountIds(mockDb, req1, nextSpy, doneSpy).catch(errorSpy);
            campaignUtils.getAccountIds(mockDb, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(2);
                expect(doneSpy.calls.all()[0].args).toEqual([{code: 400, body: 'customer cu-2 does not exist'}]);
                expect(doneSpy.calls.all()[1].args).toEqual([{code: 400, body: 'advertiser a-2 does not exist'}]);
                expect(mockLog.warn.calls.count()).toBe(2);
                expect(req1._advertiserId).toBe(123);
                expect(req1._customerId).not.toBeDefined();
                expect(req2._advertiserId).not.toBeDefined();
                expect(req2._customerId).toBe(456);
                done();
            });
        });
        
        it('should reject if one of the two calls fails', function(done) {
            var req1 = { uuid: '1234', body: { advertiserId: 'a-1', customerId: 'cu-bad' } },
                req2 = { uuid: '1234', body: { advertiserId: 'a-bad', customerId: 'cu-1' } };
            campaignUtils.getAccountIds(mockDb, req1, nextSpy, doneSpy).catch(errorSpy);
            campaignUtils.getAccountIds(mockDb, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy.calls.count()).toBe(2);
                expect(errorSpy.calls.all()[0].args).toEqual([new Error('Mongo failure')]);
                expect(errorSpy.calls.all()[1].args).toEqual([new Error('Mongo failure')]);
                expect(mockLog.error.calls.count()).toBe(2);
                done();
            });
        });
    });

    describe('makeKeywordLevels', function() {
        it('should call makeKeywords for each level', function(done) {
            spyOn(campaignUtils, 'makeKeywords').and.callFake(function(keywords) {
                return keywords && keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).toEqual({level1: ['foo0', 'bar1'], level2: [], level3: undefined});
                expect(campaignUtils.makeKeywords.calls.count()).toBe(3);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['foo', 'bar']);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(undefined);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if any of the makeKeywords calls fails', function(done) {
            spyOn(campaignUtils, 'makeKeywords').and.callFake(function(keywords) {
                if (!keywords) return q.reject('I GOT A PROBLEM');
                return keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywords.calls.count()).toBe(3);
            }).done(done);
        });
    });
    
    describe('makeKeywords', function() {
        var keywords;
        beforeEach(function() {
            campaignUtils._keywordCache = new promise.Keeper();
            keywords = ['key123', 'key456'];
            adtech.keywordAdmin.registerKeyword.and.callFake(function(keyword) {
                return q(parseInt(keyword.match(/\d+/)[0]));
            });
        });
        
        it('should register a list of keywords', function(done) {
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key123');
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle undefined keyword lists', function(done) {
            campaignUtils.makeKeywords().then(function(ids) {
                expect(ids).not.toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should retrieve ids from the cache if defined', function(done) {
            campaignUtils._keywordCache.defer('key123').resolve(123);
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).not.toHaveBeenCalledWith('key123');
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should eventually delete keywords from the cache', function(done) {
            campaignUtils.makeKeywords(keywords.slice(0, 1)).then(function(ids) {
                expect(ids).toEqual([123]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                jasmine.clock().tick(1000*60*60*24 + 1);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the call to adtech fails, and not cache errors', function(done) {
            var callCount = 0;
            adtech.keywordAdmin.registerKeyword.and.callFake(function(keyword) {
                if (keyword === 'key123') {
                    if (callCount === 0) {
                        callCount++;
                        return q.reject('I GOT A PROBLEM');
                    }
                }
                return q(parseInt(keyword.match(/\d+/)[0]));
            });
            campaignUtils.makeKeywords(['key123', 'key456', 'key123']).then(function(ids) {
                expect(ids).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).not.toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword.calls.count()).toBe(2);
                return campaignUtils.makeKeywords(['key123']);
            }).then(function(ids) {
                expect(ids).toEqual([123]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('formatCampaign', function() {
        var campaign, now, keywords, features;
        beforeEach(function() {
           now = new Date();
           campaign = { id: 'cam-1', name: 'camp1', advertiserId: '123', customerId: '456', campaignTypeId: 232323,
                        startDate: now.toISOString(), endDate: new Date(now.valueOf() + 1000).toISOString() };
           features = {targeting:true,placements:true,frequency:true,schedule:true,
                       ngkeyword:true,keywordLevel:true,volume:true};
        });
        
        it('should format a campaign for saving to adtech', function() {
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.adGoalTypeId).toBe(1);
            expect(fmt.advertiserId).toBe(123);
            expect(fmt.campaignFeatures).toEqual(features);
            expect(fmt.campaignTypeId).toBe(232323);
            expect(fmt.customerId).toBe(456);
            expect(fmt.dateRangeList).toEqual([{deliveryGoal: {desiredImpressions: 1000000000},
                endDate: campaign.endDate, startDate: campaign.startDate}]);
            expect(fmt.extId).toBe('cam-1');
            expect(fmt.exclusive).toBe(true);
            expect(fmt.exclusiveType).toBe(kCamp.EXCLUSIVE_TYPE_END_DATE);
            expect(fmt.frequencyConfig).toEqual({type: -1});
            expect(fmt.id).not.toBeDefined();
            expect(fmt.name).toBe('camp1');
            expect(fmt.optimizerTypeId).toBe(6);
            expect(fmt.optimizingConfig).toEqual({minClickRate: 0, minNoPlacements: 0});
            expect(fmt.pricingConfig).toEqual({cpm: 0, invoiceImpressions : 1000000000});
            expect(fmt.priority).toBe(3);
            expect(fmt.priorityLevelOneKeywordIdList).not.toBeDefined();
            expect(fmt.priorityLevelThreeKeywordIdList).not.toBeDefined();
            expect(fmt.viewCount).toBe(true);
        });
        
        it('should be able to set keywords', function() {
            campaign.keywords = { level1: [12, 23], level3: [34] };
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.priorityLevelOneKeywordIdList).toEqual([12, 23]);
            expect(fmt.priorityLevelThreeKeywordIdList).toEqual([34]);
        });
        
        it('should set the campaign adtech id if defined', function() {
            campaign.adtechId = 987;
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.id).toBe(987);
        });
        
        it('should default dates if undefined', function() {
            delete campaign.startDate;
            delete campaign.endDate;
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(new Date(fmt.dateRangeList[0].startDate).valueOf()).toBeGreaterThan(Date.now());
            expect(new Date(fmt.dateRangeList[0].endDate).valueOf()).toBeGreaterThan(new Date(fmt.dateRangeList[0].startDate).valueOf());
        });
        
        it('should ensure the endDate is later than the start date', function() {
            campaign.endDate = new Date(now.valueOf() - 5000);
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.dateRangeList[0].startDate).toBe(campaign.startDate);
            expect(new Date(fmt.dateRangeList[0].endDate).valueOf()).toBeGreaterThan(new Date(fmt.dateRangeList[0].startDate).valueOf());
        });
    });
    
    describe('createCampaign', function() {
        var campaign;
        beforeEach(function() {
            campaign = { id: 'e-1', name: 'test camp' };
            spyOn(campaignUtils, 'formatCampaign').and.returnValue({formatted: 'yes'});
            adtech.campaignAdmin.createCampaign.and.returnValue(q({id: 123, properties: 'yes'}));
        });
        
        it('should format and create a campaign', function(done) {
            campaignUtils.createCampaign(campaign).then(function(resp) {
                expect(resp).toEqual({id: 123, properties: 'yes'});
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({id: 'e-1', name: 'test camp'});
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: 'yes'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if creating the campaign fails', function(done) {
            adtech.campaignAdmin.createCampaign.and.returnValue(q.reject('ADTECH IS THE WORST'));
            campaignUtils.createCampaign(campaign).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('editCampaign', function() {
        var name, campaign, keys, now, oldStart, oldEnd, origCamp;
        beforeEach(function() {
            now = new Date();
            oldStart = new Date(now.valueOf() - 4000);
            oldEnd = new Date(now.valueOf() - 2000);
            name = 'new';
            keys = { level1: [31, 32, 33], level3: [41] };
            campaign = {
                adtechId: 123,
                startDate: now.toISOString(),
                endDate: new Date(now.valueOf() + 6000).toISOString()
            };
            origCamp = {
                id: 123, foo: null, name: 'old', statusTypeId: kCamp.STATUS_ENTERED,
                dateRangeList: [{endDate: oldEnd, startDate: oldStart}],
                priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [21, 22]
            };
            adtech.campaignAdmin.getCampaignById.and.callFake(function() { return q(origCamp); });
            adtech.campaignAdmin.updateCampaign.and.returnValue(q());
        });
        
        it('should be capable of editing name, dates, and keywords', function(done) {
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({
                    id: 123, name: 'new', statusTypeId: kCamp.STATUS_ENTERED,
                    dateRangeList: [{endDate: new Date(now.valueOf() + 6000).toISOString(), startDate: now.toISOString()}],
                    priorityLevelOneKeywordIdList: [31, 32, 33], priorityLevelThreeKeywordIdList: [41]
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not change any properties whose new values are undefined', function(done) {
            campaign = { adtechId: 123 };
            campaignUtils.editCampaign(undefined, campaign).then(function() {
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({
                    id: 123, name: 'old', statusTypeId: kCamp.STATUS_ENTERED,
                    dateRangeList: [{endDate: oldEnd.toISOString(), startDate: oldStart.toISOString()}],
                    priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [21, 22]
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update a keyword list if a new list of that level is not provided', function(done) {
            delete keys.level1;
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({
                    id: 123, name: 'new', statusTypeId: kCamp.STATUS_ENTERED,
                    dateRangeList: [{endDate: new Date(now.valueOf() + 6000).toISOString(), startDate: now.toISOString()}],
                    priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [41]
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update an active campaign\'s startDate', function(done) {
            origCamp.statusTypeId = kCamp.STATUS_ACTIVE;
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({
                    id: 123, name: 'new', statusTypeId: kCamp.STATUS_ACTIVE,
                    dateRangeList: [{endDate: new Date(now.valueOf() + 6000).toISOString(), startDate: oldStart.toISOString()}],
                    priorityLevelOneKeywordIdList: [31, 32, 33], priorityLevelThreeKeywordIdList: [41]
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should ensure the endDate is greater than the startDate', function(done) {
            delete campaign.endDate;
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({
                    id: 123, name: 'new', statusTypeId: kCamp.STATUS_ENTERED,
                    dateRangeList: [{endDate: jasmine.any(String), startDate: now.toISOString()}],
                    priorityLevelOneKeywordIdList: [31, 32, 33], priorityLevelThreeKeywordIdList: [41]
                });
                var endDate = adtech.campaignAdmin.updateCampaign.calls.argsFor(0)[0].dateRangeList[0].endDate;
                expect(new Date(endDate)).toBeGreaterThan(now);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if retrieving the campaign failed', function(done) {
            adtech.campaignAdmin.getCampaignById.and.returnValue(q.reject('ADTECH IS THE WORST'));
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.campaignAdmin.updateCampaign).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if updating the campaign failed', function(done) {
            adtech.campaignAdmin.updateCampaign.and.returnValue(q.reject('ADTECH IS THE WORST'));
            campaignUtils.editCampaign(name, campaign, keys, '1234').then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalled();
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('pollStatuses', function() {
        var deferreds, desired, tick;
        beforeEach(function() {
            deferreds = { 123: q.defer(), 234: q.defer(), 345: q.defer() };
            desired = kCamp.STATUS_EXPIRED;
            spyOn(campaignUtils, 'pollStatuses').and.callThrough();
            adtech.campaignAdmin.getCampaignStatusValues.and.callFake(function(ids) {
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = desired;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            });
            tick = function() {
                var def = q.defer();
                process.nextTick(function() {
                    jasmine.clock().tick(1000);
                    def.resolve();
                });
                return def.promise;
            };
        });

        it('should poll for campaign statuses until all have succesfully transitioned', function(done) {
            q.all([
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(campaignUtils.pollStatuses.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[2].args).toEqual([['345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }),

            tick().then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'pending'});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'pending'});
            }).then(tick).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'pending'});
            }).then(tick)
            ]).finally(done);
        });

        it('should do nothing if there are no campaigns to check', function(done) {
            deferreds = {};
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(adtech.campaignAdmin.getCampaignStatusValues).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should just log a warning if a getCampaignStatusValues call fails', function(done) {
            q.all([
            adtech.campaignAdmin.getCampaignStatusValues.and.callFake(function(ids) {
                if (this.getCampaignStatusValues.calls.count() === 2) return q.reject('I GOT A PROBLEM');
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = desired;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            }),
            campaignUtils.pollStatuses(deferreds, desired, 1000, 4).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(campaignUtils.pollStatuses.calls.count()).toBe(4);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.count()).toBe(4);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[2].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[3].args).toEqual([['345']]);
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }),
            
            tick().then(tick).then(tick).then(tick)
            ]).finally(done);
        });
        
        it('should reject any promises for campaigns that don\'t succeed in time', function(done) {
            q.all([
            campaignUtils.pollStatuses(deferreds, desired, 1000, 2).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 345 is 10 after 2 poll attempts'});
                expect(campaignUtils.pollStatuses.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.count()).toBe(2);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[1].args).toEqual([['234', '345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }),
            
            tick().then(tick)
            ]).finally(done);
        });
        
        it('should stop checking a campaign if its status becomes an error status', function(done) {
            q.all([
            adtech.campaignAdmin.getCampaignStatusValues.and.callFake(function(ids) {
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = kCamp.STATUS_ERROR_STOPPING;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            }),
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 123 is STATUS_ERROR_STOPPING'});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 234 is STATUS_ERROR_STOPPING'});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 345 is STATUS_ERROR_STOPPING'});
                expect(campaignUtils.pollStatuses.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.all()[2].args).toEqual([['345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }),
            
            tick().then(tick).then(tick)
            ]).finally(done);
        });
    });
    
    describe('deleteCampaigns', function() {
        var ids;
        beforeEach(function() {
            ids = [123, 234, 345];
            adtech.pushAdmin.stopCampaignById.and.returnValue(q());
            adtech.campaignAdmin.deleteCampaign.and.returnValue(q());
            spyOn(campaignUtils, 'pollStatuses').and.callFake(function(deferreds) {
                Object.keys(deferreds).forEach(function(id) { deferreds[id].resolve(); });
            });
        });
        
        it('should stop and delete campaigns', function(done) {
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect(adtech.pushAdmin.stopCampaignById.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.count()).toBe(3);
                ids.forEach(function(id) {
                    expect(adtech.pushAdmin.stopCampaignById).toHaveBeenCalledWith(id);
                    expect(adtech.campaignAdmin.deleteCampaign).toHaveBeenCalledWith(id);
                });
                expect(campaignUtils.pollStatuses).toHaveBeenCalledWith({123: jasmine.any(Object),
                    234: jasmine.any(Object), 345: jasmine.any(Object)}, kCamp.STATUS_EXPIRED, 1000, 10);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if there are no ids', function(done) {
            campaignUtils.deleteCampaigns(undefined, 1000, 10).then(function() {
                return campaignUtils.deleteCampaigns([], 1000, 10);
            }).then(function() {
                expect(adtech.pushAdmin.stopCampaignById).not.toHaveBeenCalled();
                expect(adtech.campaignAdmin.deleteCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.pollStatuses).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail early if any of the stop calls fails', function(done) {
            adtech.pushAdmin.stopCampaignById.and.callFake(function(id) {
                if (id === 234) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.pollStatuses).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if one of the campaigns fails to transition states', function(done) {
            campaignUtils.pollStatuses.and.callFake(function(deferreds) {
                Object.keys(deferreds).forEach(function(id) {
                    if (id === '123') deferreds[id].reject('I GOT A PROBLEM');
                    else deferreds[id].resolve();
                });
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.count()).toBe(2);
                expect(campaignUtils.pollStatuses).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if deleting one of the campaigns fails', function(done) {
            adtech.campaignAdmin.deleteCampaign.and.callFake(function(id) {
                if (id === 345) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.count()).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.count()).toBe(3);
                expect(campaignUtils.pollStatuses).toHaveBeenCalled();
            }).done(done);
        });
    });
});
