var flush = true;
describe('ads-campaigns (UT)', function() {
    var mockLog, CrudSvc, Model, logger, q, campModule, campaignUtils, bannerUtils, requestUtils, uuid,
        nextSpy, doneSpy, errorSpy, req, anyNum, mockDb;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        requestUtils    = require('../../lib/requestUtils');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        bannerUtils     = require('../../lib/bannerUtils');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        anyNum = jasmine.any(Number);

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
        
        var keywordCount = 0;
        spyOn(campaignUtils, 'makeKeywords').and.callFake(function(keywords) {
            return q(keywords ? keywords.map(function(key) { return ++keywordCount*100; }) : keywords);
        });
        spyOn(campaignUtils, 'makeKeywordLevels').and.callThrough();
        spyOn(campaignUtils, 'deleteCampaigns').and.returnValue(q());
        spyOn(campaignUtils, 'editCampaign').and.returnValue(q());
        spyOn(campaignUtils, 'createCampaign').and.callFake(function() {
            return q({id: String(this.createCampaign.calls.count()*1000)});
        });
        spyOn(bannerUtils, 'createBanners').and.returnValue(q());
        spyOn(bannerUtils, 'cleanBanners').and.returnValue(q());

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        campModule.config.campaigns = {
            statusDelay: 1000, statusAttempts: 10, campaignTypeId: 454545,
            dateDelays: { start: 100, end: 200 }
        };
        campModule.config.api = { root: 'https://test.com' };

        req = { uuid: '1234', _advertiserId: 987, _customerId: 876, params: {} };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            var config = {
                api: { root: 'https://foo.com' },
                campaigns: { statusDelay: 100, statusAttempts: 5 }
            };
            
            [campaignUtils.getAccountIds, campModule.validatePricing].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });
            
            svc = campModule.setupSvc(mockDb, config);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'campaigns' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('campaigns');
            expect(svc._prefix).toBe('cam');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(campModule.campSchema);
        });
        
        it('should save some config variables locally', function() {
            expect(campModule.config.api.root).toBe('https://foo.com');
            expect(campModule.config.campaigns).toEqual({statusDelay: 100, statusAttempts: 5});
        });
        
        it('should enable statusHistory', function() {
            expect(svc._middleware.create).toContain(svc.handleStatusHistory);
            expect(svc._middleware.edit).toContain(svc.handleStatusHistory);
            expect(svc._middleware.delete).toContain(svc.handleStatusHistory);
            expect(svc.model.schema.statusHistory).toBeDefined();
        });
        
        it('should format text queries on read', function() {
            expect(svc._middleware.read).toContain(campModule.formatTextQuery);
        });
        
        it('should default advertiser + customer ids on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.defaultAccountIds);
            expect(svc._middleware.edit).toContain(campModule.defaultAccountIds);
        });
        
        it('should fetch advertiser + customer ids on create + edit', function() {
            expect(campaignUtils.getAccountIds.bind).toHaveBeenCalledWith(campaignUtils, mockDb);
            expect(svc._middleware.create).toContain(campaignUtils.getAccountIds);
            expect(svc._middleware.edit).toContain(campaignUtils.getAccountIds);
        });
        
        it('should extend list entries on edit', function() {
            expect(svc._middleware.edit).toContain(campModule.extendListObjects);
        });
        
        it('should validate dates on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.validateDates);
            expect(svc._middleware.edit).toContain(campModule.validateDates);
        });
        
        it('should ensure list entry identifiers are unique on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.ensureUniqueIds);
            expect(svc._middleware.edit).toContain(campModule.ensureUniqueIds);
            expect(svc._middleware.create).toContain(campModule.ensureUniqueNames);
            expect(svc._middleware.edit).toContain(campModule.ensureUniqueNames);
        });
        
        it('should default the reportingId on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.defaultReportingId);
            expect(svc._middleware.edit).toContain(campModule.defaultReportingId);
        });
        
        it('should do extra pricing validation on create + edit', function() {
            expect(campModule.validatePricing.bind).toHaveBeenCalledWith(campModule, svc);
            expect(svc._middleware.create).toContain(campModule.validatePricing);
            expect(svc._middleware.edit).toContain(campModule.validatePricing);
        });
        
        it('should include middleware for handling sponsored campaigns', function() {
            expect(svc._middleware.create).toContain(campModule.createSponsoredCamps);
            expect(svc._middleware.edit).toContain(campModule.cleanSponsoredCamps);
            expect(svc._middleware.edit).toContain(campModule.editSponsoredCamps);
            expect(svc._middleware.edit).toContain(campModule.createSponsoredCamps);
        });
        
        it('should include middleware for handling the pricingHistory', function() {
            expect(svc._middleware.create).toContain(campModule.handlePricingHistory);
            expect(svc._middleware.edit).toContain(campModule.handlePricingHistory);
        });
        
        it('should include middleware for deleting linked entities on delete', function() {
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
            expect(svc._middleware.delete).toContain(campModule.deleteAdtechCamps);
        });
    });
    
    describe('formatTextQuery', function() {
        it('should do nothing if the text query param is not set', function() {
            req._query = { user: 'u-1' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req._query).toEqual({ user: 'u-1' });
        });
        
        it('should not overwrite an existing filter on the name field', function() {
            req._query = { name: 'camp 1', text: 'camp 2' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req._query).toEqual({ name: 'camp 1' });
        });
        
        it('should replace the text query param with a regex query by name', function() {
            req._query = { user: 'u-1', text: 'camp 1 is great' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ user: 'u-1', name: { $regex: '.*camp.*1.*is.*great.*', $options: 'i' } });
            
            req._query = { text: 'camp' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ name: { $regex: '.*camp.*', $options: 'i' } });

            req._query = { text: '  camp\t1\tis\tgreat\t ' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ name: { $regex: '.*camp.*1.*is.*great.*', $options: 'i' } });
        });
    });

    describe('defaultAccountIds', function() {
        beforeEach(function() {
            req.body = {};
            req.user = { id: 'u-1', advertiser: 'a-1', customer: 'cu-1' };
            delete req.origObj;
        });

        it('should skip if the body has an advertiser and customer id', function(done) {
            req.body = { advertiserId: 'a-2', customerId: 'cu-2' };
            campModule.defaultAccountIds(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 'a-2', customerId: 'cu-2' });
                done();
            });
        });
        
        it('should skip if the original object has an advertiser and customer id', function(done) {
            req.origObj = { advertiserId: 'a-3', customerId: 'cu-3' };
            campModule.defaultAccountIds(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({});
                done();
            });
        });
        
        it('should copy advertiser and customer ids from the user to the request body', function(done) {
            campModule.defaultAccountIds(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 'a-1', customerId: 'cu-1' });
                done();
            });
        });
        
        it('should return a 400 if it cannot set both ids', function(done) {
            var req1 = { body: {}, user: { advertiserId: 'a-1' } },
                req2 = { body: {}, user: { advertiserId: 'cu-1' } };

            campModule.defaultAccountIds(req1, nextSpy, doneSpy);
            campModule.defaultAccountIds(req2, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(2);
                expect(doneSpy.calls.argsFor(0)).toEqual([{ code: 400, body: 'Must provide advertiserId + customerId' }]);
                expect(doneSpy.calls.argsFor(1)).toEqual([{ code: 400, body: 'Must provide advertiserId + customerId' }]);
                done();
            });
        });
    });

    describe('findMatchingObj', function() {
        var obj, body;
        beforeEach(function() {
            obj = { id: 'e-1', adtechId: 123, foo: 'bar' };
            body = {
                miniReels: [
                    { id: 'e-2', adtechId: 123, foo: 'baz' },
                    { id: 'e-1', adtechId: 456, foo: 'bez' }
                ],
                cards: [ { id: 'rc-1', adtechId: 789 } ]
            };
        });

        it('should find an object that matches the target', function() {
            expect(campModule.findMatchingObj(obj, body, 'miniReels')).toEqual({id: 'e-1', adtechId: 456, foo: 'bez'});
        });
        
        it('should return undefined if no matching object is found', function() {
            expect(campModule.findMatchingObj(obj, body, 'cards')).toEqual(undefined);
        });

        it('should return undefined if the target is undefined', function() {
            expect(campModule.findMatchingObj(undefined, body, 'miniReels')).toEqual(undefined);
        });

        it('should return undefined if there is no list to search', function() {
            delete body.miniReels;
            expect(campModule.findMatchingObj(obj, body, 'miniReels')).toEqual(undefined);
            expect(campModule.findMatchingObj(obj, undefined, 'miniReels')).toEqual(undefined);
        });
    });

    describe('extendListObjects', function() {
        beforeEach(function() {
            req.body = {
                cards: [ { id: 'rc-1' }, { id: 'rc-2' } ],
                miniReels: [ { id: 'e-1' } ]
            };
            req.origObj = {
                cards: [ { id: 'rc-2', name: 'foo' }, { id: 'rc-3', name: 'bar' } ],
                miniReels: [ { id: 'e-1', name: 'foo', startDate: 'now' } ]
            };
        });
        
        it('should extend objects in req.body with matching objects in req.origObj', function(done) {
            campModule.extendListObjects(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    cards: [ { id: 'rc-1' }, { id: 'rc-2', name: 'foo' } ],
                    miniReels: [ { id: 'e-1', name: 'foo', startDate: 'now' } ]
                });
                done();
            });
        });
        
        it('should handle lists being undefined', function(done) {
            delete req.body.cards;
            delete req.origObj.miniReels;
            campModule.extendListObjects(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    miniReels: [ { id: 'e-1' } ]
                });
                done();
            });
        });
    });
    
    describe('validateDates', function() {
        beforeEach(function() {
            req.body = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}] };
            spyOn(campaignUtils, 'validateDates').and.returnValue(true);
        });
        
        it('should call campaignUtils.validateDates for every list object', function(done) {
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(3);
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'rc-1'}, undefined, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'e-1'}, undefined, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'e-2'}, undefined, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should pass in existing sub-objects if they exist', function(done) {
            req.origObj = { cards: [{id: 'rc-1', foo: 'bar'}], miniReels: [{id: 'e-2', foo: 'baz'}] };
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(3);
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'rc-1'}, {id: 'rc-1', foo: 'bar'}, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'e-1'}, undefined, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({id: 'e-2'}, {id: 'e-2', foo: 'baz'}, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should skip a list if undefined', function(done) {
            delete req.body.cards;
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(2);
                expect(campaignUtils.validateDates).not.toHaveBeenCalledWith({id: 'rc-1'}, undefined, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should call done if validateDates returns false', function(done) {
            campaignUtils.validateDates.and.callFake(function(obj) {
                if (!!obj.id.match(/^e-/)) return false;
                else return true;
            });
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'miniReels[0] has invalid dates'});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('ensureUniqueIds', function() {
        it('should call done if the cards list is not distinct', function(done) {
            req.body = { cards: [{id: 'rc-1'}, {id: 'rc-2'}, {id: 'rc-1'}] };
            campModule.ensureUniqueIds(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'cards must be distinct'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if the miniReels list is not distinct', function(done) {
            req.body = { miniReels: [{id: 'e-1'}, {id: 'e-2'}, {id: 'e-1'}] };
            campModule.ensureUniqueIds(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'miniReels must be distinct'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if all lists are distinct', function(done) {
            req.body = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}, {id: 'e-11'}] };
            campModule.ensureUniqueIds(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('ensureUniqueNames', function() {
        beforeEach(function() {
            req.body = {
                cards: [ { id: 'rc-1', name: 'foo' }, { id: 'rc-1', name: 'bar' } ],
                miniReels: [ { id: 'e-1', name: 'baz' } ]
            };
        });
        
        it('should call next if all names are unique', function(done) {
            campModule.ensureUniqueNames(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle some lists being undefined', function(done) {
            delete req.body.cards;
            campModule.ensureUniqueNames(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if multiple objects share the same name', function(done) {
            req.body.cards[1].name = 'baz';
            campModule.ensureUniqueNames(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'miniReelGroups[0] has a non-unique name'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('defaultReportingId', function() {
        beforeEach(function() {
            req.body = {
                name: 'campaign 1',
                cards: [
                    { id: 'rc-1' },
                    { id: 'rc-2', reportingId: 'card2' },
                    { id: 'rc-3' }
                ]
            };
            req.origObj = { name: 'campaign 2' };
        });

        it('should skip if the body has no cards', function(done) {
            delete req.body.cards;
            campModule.defaultReportingId(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.cards).not.toBeDefined();
                done();
            });
        });
        
        it('should set a reportingId for each card without one', function(done) {
            campModule.defaultReportingId(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', reportingId: 'campaign 1' },
                    { id: 'rc-2', reportingId: 'card2' },
                    { id: 'rc-3', reportingId: 'campaign 1' }
                ]);
                done();
            });
        });
        
        it('should be able to use the original campaign\'s name', function(done) {
            delete req.body.name;
            campModule.defaultReportingId(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', reportingId: 'campaign 2' },
                    { id: 'rc-2', reportingId: 'card2' },
                    { id: 'rc-3', reportingId: 'campaign 2' }
                ]);
                done();
            });
        });
    });

    describe('computeCost', function() {
        it('should return a base price if no targeting exists', function() {
            expect(campModule.computeCost(req)).toEqual(0.1);
        });
    });
    
    describe('validatePricing', function() {
        var svc;
        beforeEach(function() {
            req.body = { pricing: {
                budget: 1000,
                dailyLimit: 200,
                model: 'cpv'
            } };
            req.user = { id: 'u-1', fieldValidation: { campaigns: {} } };
            svc = campModule.setupSvc(mockDb, campModule.config);
            spyOn(campModule, 'computeCost').and.callThrough();
        });
        
        it('should skip if no pricing is on the request body', function(done) {
            delete req.body.pricing;
            campModule.validatePricing(svc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.pricing).not.toBeDefined();
                done();
            });
        });
        
        it('should pass if everything is valid', function(done) {
            campModule.validatePricing(svc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.pricing).toEqual({
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpv',
                    cost: 0.1
                });
                expect(campModule.computeCost).toHaveBeenCalledWith(req);
                done();
            });
        });

        it('should be able to set a default dailyLimit', function(done) {
            delete req.body.pricing.dailyLimit;
            campModule.validatePricing(svc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.pricing).toEqual({
                    budget: 1000,
                    dailyLimit: 30,
                    model: 'cpv',
                    cost: 0.1
                });
                done();
            });
        });
        
        it('should copy missing props from the original object', function(done) {
            delete req.body.pricing.dailyLimit;
            delete req.body.pricing.model;
            req.origObj = { pricing: { budget: 2000, dailyLimit: 500, model: 'cpm' } };

            campModule.validatePricing(svc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.pricing).toEqual({
                    budget: 1000,
                    dailyLimit: 500,
                    model: 'cpm',
                    cost: 0.1
                });
                done();
            });
        });
        
        it('should skip handling dailyLimit if no budget is set yet', function(done) {
            req.body.pricing = {};
            req.origObj = { pricing: { model: 'cpm' } };

            campModule.validatePricing(svc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body.pricing).toEqual({
                    model: 'cpm',
                    cost: 0.1
                });
                done();
            });
        });
        
        it('should return a 400 if the user\'s dailyLimit is too high or too low', function(done) {
            q.all([1, 10000000].map(function(limit) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body.pricing.dailyLimit = limit;
                return q(campModule.validatePricing(svc, reqCopy, nextSpy, doneSpy));
            })).then(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(2);
                var expectedResp = {
                    code: 400,
                    body: 'dailyLimit must be between 0.015 and 1 of budget'
                };
                expect(doneSpy.calls.argsFor(0)).toEqual([expectedResp]);
                expect(doneSpy.calls.argsFor(1)).toEqual([expectedResp]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the user has custom config for the dailyLimit prop', function(done) {
            beforeEach(function() {
                req.user.fieldValidation.campaigns = {
                    pricing: {
                        dailyLimit: {
                            __percentDefault: 0.75,
                            __percentMin: 0.5,
                            __percentMax: 0.8
                        }
                    }
                };
            });
            
            it('should use the custom min + max for validation', function(done) {
                q.all([0.4, 0.9].map(function(limitRatio) {
                    var reqCopy = JSON.parse(JSON.stringify(req));
                    reqCopy.body.pricing.dailyLimit = limitRatio * reqCopy.body.pricing.budget ;
                    return q(campModule.validatePricing(svc, reqCopy, nextSpy, doneSpy));
                })).then(function() {
                    expect(nextSpy).not.toHaveBeenCalled();
                    expect(doneSpy.calls.count()).toBe(2);
                    var expectedResp = {
                        code: 400,
                        body: 'dailyLimit must be between 0.5 and 0.8 of budget'
                    };
                    expect(doneSpy.calls.argsFor(0)).toEqual([expectedResp]);
                    expect(doneSpy.calls.argsFor(1)).toEqual([expectedResp]);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should use the custom default if no dailyLimit is set', function(done) {
                delete req.body.pricing.dailyLimit;
                campModule.validatePricing(svc, req, nextSpy, doneSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.pricing).toEqual({
                        budget: 1000,
                        dailyLimit: 750,
                        model: 'cpv',
                        cost: 0.1
                    });
                    done();
                });
            });
        });
        
        describe('if the user can set their own cost', function() {
            beforeEach(function() {
                req.user.fieldValidation.campaigns = { pricing: { cost: { __allowed: true } } };
            });

            it('should allow any value set on the request body', function(done) {
                req.body.pricing.cost = 0.00000123456;
                campModule.validatePricing(svc, req, nextSpy, doneSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.pricing.cost).toBe(0.00000123456);
                    done();
                });
            });
            
            it('should fall back to a value on the origObj', function(done) {
                req.origObj = { pricing: { cost: 0.123456 } };
                campModule.validatePricing(svc, req, nextSpy, doneSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.pricing.cost).toBe(0.123456);
                    done();
                });
            });
            
            it('should compute the cost if nothing else is defined', function(done) {
                campModule.validatePricing(svc, req, nextSpy, doneSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.pricing.cost).toBe(0.1);
                    done();
                });
            });
        });
        
        describe('if the user cannot set their own cost', function() {
            it('should override any cost on the request body with a freshly computed cost', function(done) {
                req.body.pricing.cost = 0.00000123456;
                campModule.validatePricing(svc, req, nextSpy, doneSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.pricing.cost).toBe(0.1);
                    done();
                });
            });
        });
    });
    
    describe('cleanStaticMap', function() {
        var toDelete;
        beforeEach(function() {
            toDelete = ['rc-1', 'rc-2', 'rc-3'];
            req.body = { staticCardMap: {
                'e-1': { 'rc-pl1': 'rc-1', 'rc-pl2': 'rc-2', 'rc-pl3': 'rc-11' },
                'e-2': { 'rc-pl4': 'rc-2' }
            } };
            req.origObj = { staticCardMap: { 'e-3': { 'rc-pl1': 'rc-1', 'rc-pl5': 'rc-33' } } };
        });

        it('should remove entries including sponsored cards that have been deleted', function() {
            campModule.cleanStaticMap(req, toDelete);
            expect(req.body.staticCardMap).toEqual({
                'e-1': { 'rc-pl3': 'rc-11' },
                'e-2': {}
            });
        });
        
        it('should use the origObj staticCardMap if its not defined in req.body', function() {
            delete req.body.staticCardMap;
            campModule.cleanStaticMap(req, toDelete);
            expect(req.body.staticCardMap).toEqual({
                'e-3': { 'rc-pl5': 'rc-33' }
            });
        });
        
        it('should skip if there\'s no map or toDelete list', function() {
            campModule.cleanStaticMap(req, undefined);
            expect(req.body.staticCardMap).toEqual({
                'e-1': { 'rc-pl1': 'rc-1', 'rc-pl2': 'rc-2', 'rc-pl3': 'rc-11' },
                'e-2': { 'rc-pl4': 'rc-2' }
            });
            req = { body: { foo: 'bar' }, origObj: { foo: 'baz' } };
            campModule.cleanStaticMap(req, toDelete);
            expect(req).toEqual({ body: { foo: 'bar', staticCardMap: undefined }, origObj: { foo: 'baz' } });
        });
        
        it('should skip over non-object entries', function() {
            req.body.staticCardMap['e-3'] = null;
            campModule.cleanStaticMap(req, toDelete);
            expect(req.body.staticCardMap).toEqual({
                'e-1': { 'rc-pl3': 'rc-11' },
                'e-2': {},
                'e-3': null
            });
        });
    });
    
    describe('cleanSponsoredCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = { miniReels: [{id: 'e-1'}, {id: 'e-3'}], cards: [{id: 'rc-2'}, {id: 'rc-3'}],
                         staticCardMap: { 'e-11': { 'rc-pl1': 'rc-1' } } };
            req.origObj = { miniReels: [{id: 'e-1', adtechId: 11}, {id: 'e-2', adtechId: 12}],
                            cards: [{id: 'rc-1', adtechId: 21}, {id: 'rc-2', adtechId: 22}] };
            spyOn(campModule, 'sendDeleteRequest').and.returnValue(q());
            spyOn(campModule, 'cleanStaticMap').and.callThrough();
        });
        
        it('should delete unused campaigns', function(done) {
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1'}, {id: 'e-3'}]);
                expect(req.body.cards).toEqual([{id: 'rc-2'}, {id: 'rc-3'}]);
                expect(req.body.staticCardMap).toEqual({'e-11': {}});
                expect(campModule.cleanStaticMap).toHaveBeenCalledWith(req, ['rc-1']);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12, 21], 1000, 10);
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should skip a list if it is not defined in req.body', function(done) {
            delete req.body.miniReels;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).not.toBeDefined();
                expect(req.body.cards).toEqual([{id: 'rc-2'}, {id: 'rc-3'}]);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([21], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should skip a list if not defined in req.origObj', function(done) {
            delete req.origObj.cards;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12], 1000, 10);
                expect(campModule.cleanStaticMap).toHaveBeenCalledWith(req, []);
                expect(req.body.staticCardMap).toEqual({ 'e-11': { 'rc-pl1': 'rc-1' } });
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                done();
            });
        });
        
        it('should skip items that have no adtechId', function(done) {
            delete req.origObj.cards[0].adtechId;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });

        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.and.returnValue(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('ADTECH IS THE WORST'));
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if one of the delete requests fails', function(done) {
            campModule.sendDeleteRequest.and.returnValue(q.reject(new Error('Request failed')));
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Request failed'));
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('editSponsoredCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = {
                targeting: { interests: ['cat-1'] },
                miniReels: [
                    {id: 'e-1', name: 'new 1', startDate: 'newStart1', endDate: 'newEnd1', adtechId: 11},
                    {id: 'e-2', name: 'new 2', startDate: 'newStart2', endDate: 'newEnd2', adtechId: 12}
                ],
                cards: [{id: 'rc-1', name: 'old card 1', adtechId: 21}]
            };
            req.origObj = {
                targeting: { interests: ['cat-1'] },
                miniReels: [
                    {id: 'e-1', name: 'old 1', startDate: 'oldStart1', endDate: 'oldEnd1', adtechId: 11},
                    {id: 'e-2', name: 'old 2', startDate: 'oldStart2', endDate: 'oldEnd2', adtechId: 12}
                ],
                cards: [
                    {id: 'rc-1', name: 'old card 1', adtechId: 21},
                    {id: 'rc-2', name: 'old card 2', adtechId: 22},
                ]
            };
        });
        
        it('should edit any sponsored campaigns that have changed', function(done) {
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-1'] });
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 1 (cam-1)', req.body.miniReels[0], undefined, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 2 (cam-1)', req.body.miniReels[1], undefined, '1234');
                done();
            });
        });
        
        it('should edit all campaigns that still exist if the interests are different', function(done) {
            req.body.targeting.interests.unshift('cat-2');
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-2', 'cat-1'] });
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-2', 'cat-1']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-2', 'cat-1']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 1 (cam-1)', req.body.miniReels[0], {level1: undefined, level2: undefined, level3: [anyNum, anyNum]}, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 2 (cam-1)', req.body.miniReels[1], {level1: undefined, level2: undefined, level3: [anyNum, anyNum]}, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('old card 1 (cam-1)', req.body.cards[0],
                    {level1: [anyNum], level2: undefined, level3: [anyNum, anyNum]}, '1234');
                done();
            });
        });
        
        it('should still edit all campaigns when interests differ if a list is not declared in req.body', function(done) {
            req.body.targeting.interests = ['cat-3'];
            delete req.body.miniReels;
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-3'] });
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-3']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-3']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('old 1 (cam-1)', req.origObj.miniReels[0], {level1: undefined, level2: undefined, level3: [anyNum]}, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('old 2 (cam-1)', req.origObj.miniReels[1], {level1: undefined, level2: undefined, level3: [anyNum]}, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('old card 1 (cam-1)', req.body.cards[0],
                    {level1: [anyNum], level2: undefined, level3: [anyNum]}, '1234');
                done();
            });
        });
        
        it('should use * for kwlp3 if the interests are an empty array on the req.body', function(done) {
            req.body.targeting.interests = [];
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: [] });
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['*']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['*']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should not include * if adding interests when previously there were none', function(done) {
            req.origObj.targeting.interests = [];
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-1'] });
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-1']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-1']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should not change the keywords if interests are undefined on req.body', function(done) {
            delete req.body.targeting;
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).not.toBeDefined();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 1 (cam-1)', req.body.miniReels[0], undefined, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new 2 (cam-1)', req.body.miniReels[1], undefined, '1234');
                done();
            });
        });
        
        it('should do nothing if all campaigns match', function(done) {
            req.body.miniReels = req.origObj.miniReels;
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip a list if it does not exist on the original document', function(done) {
            delete req.origObj.miniReels;
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            req.body.targeting.interests.unshift('cat-2');
            campaignUtils.makeKeywords.and.callFake(function(keywords) {
                if (keywords && keywords[0] === 'cat-2') return q.reject(new Error('I GOT A PROBLEM'));
                else return q(keywords);
            });
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if updating a campaign fails', function(done) {
            campaignUtils.editCampaign.and.callFake(function(name, campaign, keys, reqId) {
                if (campaign.adtechId === 11) return q.reject(new Error('I GOT A PROBLEM'));
                else return q();
            });
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('createSponsoredCamps', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                targeting: { interests: ['cat-1'] },
                miniReels: [{id: 'e-1', name: 'exp 1', startDate: 'expStart1', endDate: 'expEnd1'}],
                cards: [
                    { id: 'rc-1', name: 'card 1', startDate: 'cardStart1', endDate: 'cardEnd1' },
                    { id: 'rc-2', adtechId: 22, name: 'card 2', startDate: 'cardStart2', endDate: 'cardEnd2' }
                ]
            };
            req.origObj = { id: 'cam-1', targeting: { interests: ['cat-2'] } };
        });
        
        it('should create sponsored card and minireel campaigns', function(done) {
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([
                    { id: 'e-1', adtechId: 1000, name: 'exp 1', startDate: 'expStart1', endDate: 'expEnd1' }
                ]);
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', adtechId: 2000, name: 'card 1', startDate: 'cardStart1', endDate: 'cardEnd1' },
                    { id: 'rc-2', adtechId: 22, name: 'card 2', startDate: 'cardStart2', endDate: 'cardEnd2' }
                ]);
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-1']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-1']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({ id: 'e-1', name: 'exp 1 (cam-1)',
                    startDate: 'expStart1', endDate: 'expEnd1', campaignTypeId: 454545,
                    keywords: {level1: undefined, level2: undefined, level3: [anyNum]}, advertiserId: 987, customerId: 876 }, '1234');
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({ id: 'rc-1', name: 'card 1 (cam-1)',
                    startDate: 'cardStart1', endDate: 'cardEnd1', campaignTypeId: 454545,
                    keywords: {level1: [anyNum], level2: undefined, level3: [anyNum]}, advertiserId: 987, customerId: 876 }, '1234');
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req.body.miniReels[0]], null, 'miniReel', true, 1000);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req.body.cards[0]], null, 'card', true, 2000);
                done();
            });
        });
        
        it('should handle a missing original object', function(done) {
            delete req.origObj;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(2);
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });
        
        it('should use the origObj\'s interests if not defined on req.body', function(done) {
            delete req.body.targeting.interests;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-2']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-2']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });
        
        it('should use * for kwlp3 if no interests are defined', function(done) {
            delete req.body.targeting.interests;
            req.origObj.targeting.interests = [];
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['*']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['*']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });

        it('should skip one of the lists if not defined on req.body', function(done) {
            delete req.body.cards;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).not.toBeDefined();
                expect(req.body.miniReels).toEqual([
                    { id: 'e-1', adtechId: 1000, name: 'exp 1', startDate: 'expStart1', endDate: 'expEnd1' }
                ]);
                expect(campaignUtils.makeKeywordLevels.calls.count()).toBe(1);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: undefined, level3: ['cat-1']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(1);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({ id: 'e-1', name: 'exp 1 (cam-1)',
                    startDate: 'expStart1', endDate: 'expEnd1', campaignTypeId: 454545,
                    keywords: {level1: undefined, level2: undefined, level3: [anyNum]}, advertiserId: 987, customerId: 876 }, '1234');
                expect(bannerUtils.createBanners.calls.count()).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req.body.miniReels[0]], null, 'miniReel', true, 1000);
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            campaignUtils.makeKeywords.and.callFake(function(keywords) {
                if (keywords && keywords[0] === 'cat-1') return q.reject(new Error('I GOT A PROBLEM'));
                else return q(keywords);
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if creating a campaign fails', function(done) {
            campaignUtils.createCampaign.and.callFake(function(obj) {
                if (obj.id === 'e-1') return q.reject(new Error('I GOT A PROBLEM'));
                else return q({id: String(this.createCampaign.calls.count()*1000)});
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req.body.cards[0]], null, 'card', true, 2000);
                done();
            });
        });
        
        it('should reject if creating banners fails', function(done) {
            bannerUtils.createBanners.and.callFake(function(newList, oldList, type, isSponsored, adtechId) {
                if (type === 'card') return q.reject(new Error('I GOT A PROBLEM'));
                else return q();
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });
    });

    describe('handlePricingHistory', function() {
        var oldDate;
        beforeEach(function() {
            oldDate = new Date(new Date().valueOf() - 5000);
            req.body = {
                foo: 'bar',
                pricing: {
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpv',
                    cost: 0.1
                }
            };
            var origPricing = {
                budget: 500,
                dailyLimit: 200,
                model: 'cpv',
                cost: 0.1
            };
            req.origObj = {
                pricing: origPricing,
                pricingHistory: [{
                    pricing: origPricing,
                    userId: 'u-2',
                    user: 'admin@c6.com',
                    date: oldDate
                }]
            };
            req.user = { id: 'u-1', email: 'foo@bar.com' };
        });
        
        it('should do nothing if req.body.pricing is not defined', function() {
            delete req.body.pricing;
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should do nothing if the pricing is unchanged', function() {
            req.body.pricing.budget = 500;
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });
        
        it('should add an entry to the pricingHistory', function() {
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).toEqual([
                {
                    pricing: {
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.1
                    },
                    userId: 'u-1',
                    user: 'foo@bar.com',
                    date: jasmine.any(Date)
                },
                {
                    pricing: {
                        budget: 500,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.1
                    },
                    userId: 'u-2',
                    user: 'admin@c6.com',
                    date: oldDate
                }
            ]);
            expect(req.body.pricingHistory[0].date).toBeGreaterThan(oldDate);
            expect(nextSpy).toHaveBeenCalledWith();
        });
        
        it('should initalize the pricingHistory if not defined', function() {
            delete req.origObj;
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).toEqual([
                {
                    pricing: {
                        budget: 1000,
                        dailyLimit: 200,
                        model: 'cpv',
                        cost: 0.1
                    },
                    userId: 'u-1',
                    user: 'foo@bar.com',
                    date: jasmine.any(Date)
                }
            ]);
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should delete the existing pricingHistory off req.body', function() {
            req.body = {
                pricingHistory: [{ pricing: 'yes', userId: 'u-3', user: 'me@c6.com', date: new Date() }]
            };
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });
    });

    describe('sendDeleteRequest', function() {
        var resp;
        beforeEach(function() {
            req.protocol = 'https';
            req.headers = { cookie: { c6Auth: 'qwer1234' } };
            resp = { response: { statusCode: 204 } };
            spyOn(requestUtils, 'qRequest').and.callFake(function() { return q(resp); });
        });
        
        it('should send a delete request to the content service', function(done) {
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect(requestUtils.qRequest).toHaveBeenCalledWith('delete', {headers: {cookie: {c6Auth: 'qwer1234'}},
                    url: 'https://test.com/api/content/experience/e-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log a warning if the statusCode is not 204', function(done) {
            resp = { response: { statusCode: 400 }, body: 'Unauthorized' };
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if the request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Failed sending delete request to content service'));
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('deleteContent', function() {
        beforeEach(function() {
            req.origObj = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}],
                miniReelGroups: [{adtechId: 11, cards: ['rc-2'], miniReels: [{id: 'e-3'}]}] };
            spyOn(campModule, 'sendDeleteRequest').and.returnValue(q());
        });
        
        it('should delete all sponsored content for the campaign', function(done) {
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.count()).toBe(3);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-1', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                done();
            });
        });
        
        it('should handle skip a list if not defined', function(done) {
            delete req.origObj.miniReels;
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.count()).toBe(1);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should reject if one of the requests rejects', function(done) {
            campModule.sendDeleteRequest.and.callFake(function(req, id, type) {
                if (id === 'e-1') return q.reject('YOU DONE FUCKED UP');
                else return q();
            });
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('YOU DONE FUCKED UP');
                expect(campModule.sendDeleteRequest.calls.count()).toBe(3);
                done();
            });
        });
    });
    
    describe('deleteAdtechCamps', function() {
        beforeEach(function() {
            req.origObj = {
                cards: [ { id: 'rc-1', adtechId: 11 } ],
                miniReels: [
                    { id: 'e-1', adtechId: 21 },
                    { id: 'e-2', adtechId: 22 }
                ]
            };
        });

        it('should delete all adtech campaigns', function(done) {
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 21, 22], 1000, 10);
                done();
            });
        });
        
        it('should skip a list if not defined', function(done) {
            delete req.origObj.cards;
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([21, 22], 1000, 10);
                done();
            });
        });
        
        it('should skip items if they do not have an adtechId', function(done) {
            delete req.origObj.miniReels[0].adtechId;
            req.origObj.cards.push({id: 'rc-2'});
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 22], 1000, 10);
                done();
            });
        });
        
        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.and.returnValue(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('ADTECH IS THE WORST'));
                done();
            });
        });
    });
});

