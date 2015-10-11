var flush = true;
describe('campaign validation', function() {
    var campModule, logger, mockLog, svc, newObj, origObj, requester;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        logger      = require('../../lib/logger');
        campModule  = require('../../bin/ads-campaigns');

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

        var mockDb = {
            collection: jasmine.createSpy('db.collection()').and.returnValue({ collectionName: 'campaigns' })
        };

        svc = campModule.setupSvc(mockDb, {});
        
        newObj = {};
        origObj = {};
        requester = { fieldValidation: { campaigns: {} } };
    });
    
    describe('when handling status', function() {
        it('should fail if the field is not a string', function() {
            newObj.status = 123;
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'status must be in format: string' });
        });
        
        it('should allow the field to be set', function() {
            newObj.status = 'active';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.status).toEqual('active');
        });
    });
    
    describe('when handling application', function() {
        it('should fail if the field is not a string', function() {
            newObj.application = 123;
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'application must be in format: string' });
        });
        
        it('should allow the field to be set on create', function() {
            newObj.application = 'campaign manager';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj).toEqual({ application: 'campaign manager' });
        });

        it('should default the field if not defined', function() {
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj).toEqual({ application: 'studio' });
        });
        
        it('should revert the field if defined on edit', function() {
            origObj.application = 'sponsorship manager';
            newObj.application = 'campaign manager';
            expect(svc.model.validate('edit', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj).toEqual({ application: 'sponsorship manager' });
        });
    });
    
    // advertiser + customer
    ['advertiserId', 'customerId'].forEach(function(field) {
        describe('when handling ' + field, function() {
            it('should trim the field if set', function() {
                newObj[field] = 'someAccount';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj[field]).not.toBeDefined();
            });
            
            it('should allow some requesters to initially set but not change the field', function() {
                requester.fieldValidation.campaigns[field] = { __allowed: true };
                newObj[field] = 'someAccount';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj[field]).toEqual('someAccount');
                
                newObj[field] = 'someAccount';
                origObj[field] = 'oldAccount';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj[field]).toEqual('oldAccount');
            });
            
            it('should fail if the field is not a string', function() {
                requester.fieldValidation.campaigns[field] = { __allowed: true };
                newObj[field] = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: field + ' must be in format: string' });
            });
        });
    });
    
    describe('when handling minViewTime', function() {
        it('should trim the field if set', function() {
            newObj.minViewTime = 1234;
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.minViewTime).not.toBeDefined();
        });
        
        it('should be able to allow some requesters to set the field', function() {
            requester.fieldValidation.campaigns.minViewTime = { __allowed: true };
            newObj.minViewTime = 1234;
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.minViewTime).toBe(1234);
        });

        it('should fail if the field is not a number', function() {
            requester.fieldValidation.campaigns.minViewTime = { __allowed: true };
            newObj.minViewTime = 'asdf';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'minViewTime must be in format: number' });
        });
    });
    
    describe('when handling pricing', function() {
        beforeEach(function() {
            newObj.pricing = { budget: 1000 };
        });

        describe('subfield budget', function() {
            it('should fail if the field is not a number', function() {
                newObj.pricing.budget = 'one MILLION dollars';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'pricing.budget must be in format: number' });
            });
            
            it('should allow the field to be set on create or edit', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.budget).toEqual(1000);
                
                origObj.pricing = { budget: 500 };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.budget).toEqual(1000);
            });

            it('should fail if the field is not defined', function() {
                delete newObj.pricing.budget;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: pricing.budget' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.pricing.budget;
                origObj.pricing = { budget: 500 };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.budget).toEqual(500);
            });

            it('should fail if the field does not fit the bounds', function() {
                newObj.pricing.budget = 1000000000000000000000000000000000000000;
                var resp = svc.model.validate('edit', newObj, origObj, requester);
                expect(resp.isValid).toBe(false);
                expect(resp.reason).toMatch(/pricing.budget must be less than the max: \d+/);
                
                newObj.pricing.budget = -1234;
                resp = svc.model.validate('edit', newObj, origObj, requester);
                expect(resp.isValid).toBe(false);
                expect(resp.reason).toMatch(/pricing.budget must be greater than the min: \d+/);
            });
        });
        
        describe('subfield dailyLimit', function() {
            it('should fail if the field is not a number', function() {
                newObj.pricing.dailyLimit = 'the limit does not exist';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'pricing.dailyLimit must be in format: number' });
            });
            
            it('should allow the field to be set', function() {
                newObj.pricing.dailyLimit = 100;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.dailyLimit).toEqual(100);
            });
        });
        
        describe('subfield model', function() {
            it('should replace user input with a default', function() {
                newObj.pricing.model = 'never charge me cause i am the best';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.model).toBe('cpv');
            });
            
            it('should be able to allow some requesters to set the field', function() {
                requester.fieldValidation.campaigns.pricing = { model: { __allowed: true } };
                newObj.pricing.model = 'never charge me cause i am the best';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.model).toBe('never charge me cause i am the best');
            });

            it('should fail if the field is not a string', function() {
                requester.fieldValidation.campaigns.pricing = { model: { __allowed: true } };
                newObj.pricing.model = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'pricing.model must be in format: string' });
            });
        });

        describe('subfield cost', function() {
            it('should trim the field if set', function() {
                newObj.pricing.cost = 0.0001;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.cost).not.toBeDefined();
            });
            
            it('should be able to allow some requesters to set the field', function() {
                requester.fieldValidation.campaigns.pricing = { cost: { __allowed: true } };
                newObj.pricing.cost = 0.0001;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.pricing.cost).toBe(0.0001);
            });

            it('should fail if the field is not a number', function() {
                requester.fieldValidation.campaigns.pricing = { cost: { __allowed: true } };
                newObj.pricing.cost = 'no dollars';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'pricing.cost must be in format: number' });
            });
        });
    });
    
    describe('when handling pricingHistory', function() {
        it('should not allow anyone to set the field', function() {
            requester.fieldValidation.campaigns.pricingHistory = { __allowed: true };
            newObj.pricingHistory = 'yesterday it cost a lot';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.pricingHistory).not.toBeDefined();
        });
    });
    
    describe('when handling contentCategories,', function() {
        beforeEach(function() {
            newObj.contentCategories = {};
        });

        describe('subfield primary,', function() {
            it('should fail if the field is not a string', function() {
                newObj.contentCategories.primary = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'contentCategories.primary must be in format: string' });
            });
            
            it('should allow the field to be set', function() {
                newObj.contentCategories.primary = 'foo';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.contentCategories.primary).toEqual('foo');
            });
        });
    });
    
    describe('when handling targeting,', function() {
        beforeEach(function() {
            newObj.targeting = {};
        });
        
        function targetingArrayTests(targetingType, subProp) {
            it('should fail if the field is not an array of strings', function() {
                newObj.targeting[targetingType][subProp] = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'targeting.' + targetingType + '.' + subProp + ' must be in format: stringArray' });

                newObj.targeting[targetingType][subProp] = ['foo', 'bar', 123];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'targeting.' + targetingType + '.' + subProp + ' must be in format: stringArray' });
            });
            
            it('should allow the field to be set', function() {
                newObj.targeting[targetingType][subProp] = ['foo', 'bar'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.targeting[targetingType][subProp]).toEqual(['foo', 'bar']);
            });
        }
        
        describe('subfield geo,', function() {
            beforeEach(function() {
                newObj.targeting.geo = {};
            });
            
            describe('subfield states,', function() {
                targetingArrayTests('geo', 'states');
            });

            describe('subfield dmas', function() {
                targetingArrayTests('geo', 'dmas');
            });
        });

        describe('subfield demographics,', function() {
            beforeEach(function() {
                newObj.targeting.demographics = {};
            });

            describe('subfield gender,', function() {
                targetingArrayTests('demographics', 'gender');
            });

            describe('subfield age,', function() {
                targetingArrayTests('demographics', 'age');
            });

            describe('subfield income', function() {
                targetingArrayTests('demographics', 'income');
            });
        });

        describe('subfield interests,', function() {
            it('should fail if the field is not an array of strings', function() {
                newObj.targeting.interests = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'targeting.interests must be in format: stringArray' });

                newObj.targeting.interests = ['foo', 'bar', 123];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'targeting.interests must be in format: stringArray' });
            });
            
            it('should allow the field to be set', function() {
                newObj.targeting.interests = ['foo', 'bar'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.targeting.interests).toEqual(['foo', 'bar']);
            });
        });
    });
    
    describe('when handling staticCardMap', function() {
        it('should trim the field if set', function() {
            newObj.staticCardMap = { cards: 'yes' };
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.staticCardMap).not.toBeDefined();
        });
        
        it('should be able to allow some requesters to set the field', function() {
            requester.fieldValidation.campaigns.staticCardMap = { __allowed: true };
            newObj.staticCardMap = { cards: 'yes' };
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.staticCardMap).toEqual({ cards: 'yes' });
        });

        it('should fail if the field is not an object', function() {
            requester.fieldValidation.campaigns.staticCardMap = { __allowed: true };
            newObj.staticCardMap = 'asdf';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'staticCardMap must be in format: object' });
        });
    });
    
    describe('when handling cards', function() {
        it('should allow the field to be set', function() {
            newObj.cards = [{ id: 'rc-1' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.cards).toEqual([{ id: 'rc-1' }]);
        });
        
        it('should fail if the field is not an object array', function() {
            newObj.cards = 'asdf';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'cards must be in format: objectArray' });

            newObj.cards = ['asdf'];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'cards must be in format: objectArray' });
        });
        
        it('should not allow the field to be changed once initialized', function() {
            origObj.cards = [{ id: 'rc-2' }];
            newObj.cards = [{ id: 'rc-1' }];
            expect(svc.model.validate('edit', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.cards).toEqual([{ id: 'rc-2' }]);
        });
        
        it('should fail if the field has too many entries', function() {
            newObj.cards = [{ id: 'rc-1' }, { id: 'rc-2' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'cards must have at most 1 entries' });
        });
        
        it('should allow these restrictions to be eased for some users', function() {
            requester.fieldValidation.campaigns.cards = { __unchangeable: false, __length: 10 };
            origObj.cards = [{ id: 'rc-3' }];
            newObj.cards = [{ id: 'rc-1' }, { id: 'rc-2' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.cards).toEqual([{ id: 'rc-1' }, { id: 'rc-2' }]);
        });
    });
    
    describe('when handling miniReels', function() {
        it('should trim the field if set', function() {
            newObj.miniReels = [{ id: 'e-1' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.miniReels).not.toBeDefined();
        });
        
        it('should be able to allow some requesters to set the field', function() {
            requester.fieldValidation.campaigns.miniReels = { __allowed: true };
            newObj.miniReels = [{ id: 'e-1' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.miniReels).toEqual([{ id: 'e-1' }]);
        });

        it('should fail if the field is not an object array', function() {
            requester.fieldValidation.campaigns.miniReels = { __allowed: true };
            newObj.miniReels = { id: 'e-1' };
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'miniReels must be in format: objectArray' });
                
            newObj.miniReels = [{ id: 'e-1' }, 'e-2'];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'miniReels must be in format: objectArray' });
        });
    });
    
    ['cards', 'miniReels'].forEach(function(field) {
        describe('when handling ' + field + ' entries,', function() {
            beforeEach(function() {
                requester.fieldValidation.campaigns[field] = { __allowed: true, __entries: {} };
                newObj[field] = [{ id: 'content-1' }];
            });
            
            describe('subfield id,', function() {
                it('should fail if the field is not a string', function() {
                    newObj[field][0].id = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + '[0].id must be in format: string' });
                });
                
                it('should allow the field to be set', function() {
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual([{ id: 'content-1' }]);
                });

                it('should fail if the field is not defined', function() {
                    delete newObj[field][0].id;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'Missing required field: ' + field + '[0].id' });
                });
            });
            
            // internal adtech ids, always forbidden
            ['adtechId', 'bannerNumber', 'bannerId'].forEach(function(subfield) {
                describe('subfield ' + subfield + ',', function() {
                    it('should always trim the field if set', function() {
                        requester.fieldValidation.campaigns[field].__entries[subfield] = { __allowed: true };
                        newObj[field][0][subfield] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj[field][0][subfield]).not.toBeDefined();
                    });
                });
            });
            
            // campaign details, may be set by some users
            ['name', 'startDate', 'endDate', 'reportingId'].forEach(function(subfield) {
                describe('subfield ' + subfield + ',', function() {
                    it('should trim the field if set', function() {
                        newObj[field][0][subfield] = 'foo';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj[field][0][subfield]).not.toBeDefined();
                    });
                    
                    it('should be able to allow some requesters to set the field', function() {
                        requester.fieldValidation.campaigns[field].__entries[subfield] = { __allowed: true };
                        newObj[field][0][subfield] = 'foo';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj[field][0][subfield]).toBe('foo');
                    });

                    it('should fail if the field is not a string', function() {
                        requester.fieldValidation.campaigns[field].__entries[subfield] = { __allowed: true };
                        newObj[field][0][subfield] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: field + '[0].' + subfield + ' must be in format: string' });
                    });
                });
            });
        });
    });
    
    describe('when handling miniReelGroups', function() {
        it('should trim the field if set', function() {
            newObj.miniReelGroups = [{ cards: 'yes' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.miniReelGroups).not.toBeDefined();
        });
        
        it('should be able to allow some requesters to set the field', function() {
            requester.fieldValidation.campaigns.miniReelGroups = { __allowed: true };
            newObj.miniReelGroups = [{ cards: 'yes' }];
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: true, reason: undefined });
            expect(newObj.miniReelGroups).toEqual([{ cards: 'yes' }]);
        });

        it('should fail if the field is not an object arry', function() {
            requester.fieldValidation.campaigns.miniReelGroups = { __allowed: true };
            newObj.miniReelGroups = 'asdf';
            expect(svc.model.validate('create', newObj, origObj, requester))
                .toEqual({ isValid: false, reason: 'miniReelGroups must be in format: objectArray' });
        });
    });
});
