var flush = true;
describe('campaignUtils', function() {
    var q, mockLog, logger, promise, Model, requestUtils, campaignUtils, campModule,
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
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('validateDates', function() {
        var now = new Date(),
            obj, existing;
        beforeEach(function() {
            obj = {};
            existing = {
                startDate: new Date(now.valueOf() - 5000).toISOString(),
                endDate: new Date(now.valueOf() - 4000).toISOString()
            };
        });
        
        it('should not default the startDate and endDate if undefined', function() {
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(true);
            expect(mockLog.info).not.toHaveBeenCalled();
            expect(obj).toEqual({});
        });

        it('should return false if the startDate is not a valid date string', function() {
            obj.startDate = new Date().toISOString() + 'foo';
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });

        it('should return false if the endDate is not a valid date string', function() {
            obj.endDate = {foo: 'bar'};
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });

        it('should return false if the startDate is greater than the endDate', function() {
            obj = { startDate: now.toISOString(), endDate: new Date(now.valueOf() - 1000).toISOString() };
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
        });
        
        it('should return false if the endDate is in the past and has changed', function() {
            obj = {
                startDate: new Date(now.valueOf() - 5000).toISOString(),
                endDate: new Date(now.valueOf() - 1000).toISOString()
            };
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(false);
            expect(mockLog.info).toHaveBeenCalled();
            expect(campaignUtils.validateDates(obj, undefined, '1234')).toBe(false);
            obj.endDate = new Date(now.valueOf() - 4000).toISOString();
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(true);
            obj.endDate = new Date(new Date().valueOf() + 4000).toISOString();
            expect(campaignUtils.validateDates(obj, existing, '1234')).toBe(true);
        });
    });

    describe('validateAllDates', function() {
        var body, origObj, requester, reqId;
        beforeEach(function() {
            body = { cards: [
                { id: 'rc-1', campaign: { minViewTime: 3 } },
                { id: 'rc-2', campaign: { minViewTime: 4 } }
            ] };
            requester = { id: 'u-1', email: 'selfie@c6.com' };
            reqId = '1234';
            spyOn(campaignUtils, 'validateDates').and.returnValue(true);
        });
        
        it('should call campaignUtils.validateDates for every list object', function() {
            var resp = campaignUtils.validateAllDates(body, origObj, requester, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates.calls.count()).toBe(2);
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ minViewTime: 3 }, undefined, '1234');
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ minViewTime: 4 }, undefined, '1234');
        });
        
        it('should pass in existing sub-objects if they exist', function() {
            origObj = { cards: [{ id: 'rc-1', campaign: { minViewTime: 3, startDate: '2015-10-25T00:27:03.456Z' } }] };
            var resp = campaignUtils.validateAllDates(body, origObj, requester, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates.calls.count()).toBe(2);
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ minViewTime: 3 },
                { minViewTime: 3, startDate: '2015-10-25T00:27:03.456Z' }, '1234');
            expect(campaignUtils.validateDates).toHaveBeenCalledWith({ minViewTime: 4 }, undefined, '1234');
        });
        
        it('should skip if no cards are defined', function() {
            delete body.cards;
            var resp = campaignUtils.validateAllDates(body, origObj, requester, reqId);
            expect(resp).toEqual({ isValid: true });
            expect(campaignUtils.validateDates).not.toHaveBeenCalled();
        });
        
        it('should return an invalid response if validateDates returns false', function() {
            campaignUtils.validateDates.and.callFake(function(obj) {
                if (obj.minViewTime === 4) return false;
                else return true;
            });
            var resp = campaignUtils.validateAllDates(body, origObj, requester, reqId);
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
        
        it('should increase the price for each targeting category chosen', function() {
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.05);
            body.targeting.geo.states.push('ohio', 'new jersey');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.06);
            body.targeting.geo.dmas.push('princeton', 'new york', 'chicago');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.06);
            body.targeting.demographics.age.push('18-24', '24-36');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.07);
            body.targeting.demographics.gender.push('female');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.07);
            body.targeting.interests.push('cat-1');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.08);
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
                __priceForGeoTargeting: 0.07,
                __priceForDemoTargeting: 0.08,
                __priceForInterests: 1.11
            };
            actingSchema = model.personalizeSchema(requester);
            
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.51);
            body.targeting.geo.states.push('ohio', 'new jersey');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.69);
            body.targeting.geo.dmas.push('princeton', 'new york', 'chicago');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(0.80);
            body.targeting.demographics.age.push('18-24', '24-36');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(1.09);
            body.targeting.demographics.gender.push('female');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(1.30);
            body.targeting.demographics.income.push('1000', '2000');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(1.51);
            body.targeting.interests.push('cat-1');
            expect(campaignUtils.computeCost(body, origObj, actingSchema)).toEqual(2.62);
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
});
