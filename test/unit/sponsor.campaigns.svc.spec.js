var flush = true;
describe('sponsor-campaigns (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, campModule, campaignUtils, mockClient,
        nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        campModule      = require('../../bin/sponsor-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        CrudSvc         = require('../../lib/crudSvc');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockClient = {client: 'yes'};
        delete require.cache[require.resolve('adtech/lib/campaign')];
        adtech = require('adtech');
        adtech.campaignAdmin = require('adtech/lib/campaign');
        Object.keys(adtech.campaignAdmin).forEach(function(prop) {
            if (typeof adtech.campaignAdmin[prop] !== 'function') {
                return;
            }
            adtech.campaignAdmin[prop] = adtech.campaignAdmin[prop].bind(adtech.campaignAdmin, mockClient);
            spyOn(adtech.campaignAdmin, prop).andCallThrough();
        });
    });

    describe('setupSvc', function() {
        it('should setup the campaign service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').andReturn(CrudSvc.prototype.validateUniqueProp);
            spyOn(campModule.deleteContent, 'bind').andReturn(campModule.deleteContent);
            var mockDb = {
                collection: jasmine.createSpy('db.collection()').andCallFake(function(name) {
                    return { collectionName: name };
                })
            };
            var svc = campModule.setupSvc(mockDb);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('cam');
            expect(svc.objName).toBe('campaigns');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toEqual({collectionName: 'campaigns'});
            expect(svc._cardColl).toEqual({collectionName: 'cards'});
            expect(svc._expColl).toEqual({collectionName: 'experiences'});
            
            expect(svc.createValidator._required).toContain('name', 'advertiserId', 'customerId');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc.editValidator._forbidden).toContain('advertiserId', 'customerId');
            ['cards', 'miniReels', 'targetMiniReels'].forEach(function(key) {
                expect(svc.createValidator._formats[key]).toEqual(['object']);
                expect(svc.editValidator._formats[key]).toEqual(['object']);
            });
            expect(svc.createValidator._formats.categories).toEqual(['string']);
            expect(svc.editValidator._formats.categories).toEqual(['string']);

            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(svc._middleware.create).toContain(CrudSvc.prototype.validateUniqueProp,
                campModule.createAdtechCamp, campModule.createBanners);
            expect(svc._middleware.edit).toContain(CrudSvc.prototype.validateUniqueProp,
                campModule.cleanBanners, campModule.createBanners);
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
        });
    });
    
    describe('createAdtechCamp', function() {
        beforeEach(function() {
            var keywordNum = 0;
            req.body = { id: 'cam-1', name: 'camp 1' };
            spyOn(campaignUtils, 'formatCampaign').andReturn({formatted: true});
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                return q(keywords.map(function(key) { return ++keywordNum*100; }));
            });
            adtech.campaignAdmin.createCampaign.andReturn(q({id: 123}));
        });
        
        it('should create a campaign in adtech', function(done) {
            campModule.createAdtechCamp(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({id: 'cam-1', name: 'camp 1', minViewTime: -1, adtechId: 123});
                expect(campaignUtils.makeKeywords.calls.length).toBe(2);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith(req.body, {level1:[], level3:[]}, true);
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: true});
                done();
            });
        });
        
        it('should set keywords, if appropriate', function(done) {
            req.body = { id: 'cam-1', name: 'camp 1', targetMiniReels: [{id: 'e-1'}, {id: 'e-2'}],
                         cards: [{id: 'rc-1'}], categories: ['food', 'sports'], minViewTime: 5 };
            campModule.createAdtechCamp(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ id: 'cam-1', name: 'camp 1', cards: [{id: 'rc-1'}],
                                           targetMiniReels: [{id: 'e-1'}, {id: 'e-2'}], adtechId: 123,
                                           categories: ['food', 'sports'], minViewTime: 5 });
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['rc-1', 'e-1', 'e-2']);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['food', 'sports']);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith(
                    req.body, {level1:[100, 200, 300], level3:[400, 500]}, true);
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: true});
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            req.body.cards = [{id: 'rc-1'}];
            campaignUtils.makeKeywords.andReturn(q.reject('I GOT A PROBLEM'));
            campModule.createAdtechCamp(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(errorSpy.calls.length).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.body.adtechId).not.toBeDefined();
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if creating the campaign fails', function(done) {
            adtech.campaignAdmin.createCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            campModule.createAdtechCamp(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.body.adtechId).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('createBanners', function() {
        beforeEach(function() {
            req.body = { id: 'cam-1', cards: [{id: 'rc-11'}], targetMiniReels: [{id: 'e-11'}],
                         miniReels: [{id: 'e-12'}] };
            req.origObj = { id: 'cam-1', adtechId: 123, cards: [{id: 'rc-1'}],
                            targetMiniReels: [{id: 'e-1'}], miniReels: [{id: 'e-2'}] };
            spyOn(campaignUtils, 'createBanners').andReturn(q());
        });
        
        it('should create a batch of banners', function(done) {
            campModule.createBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners.calls.length).toBe(3);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'e-12'}], [{id: 'e-2'}], 'miniReel', 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-11'}], [{id: 'rc-1'}], 'card', 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'e-11'}], [{id: 'e-1'}], 'targetMiniReel', 123);
                done();
            });
        });
        
        it('should handle some lists being undefined', function(done) {
            req.body = { id: 'cam-1', cards: [{id: 'rc-11'}] };
            req.origObj = { id: 'cam-1', adtechId: 123, targetMiniReels: [{id: 'e-1'}] };
            campModule.createBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners.calls.length).toBe(3);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith(undefined, null, 'miniReel', 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-11'}], null, 'card', 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith(undefined, [{id: 'e-1'}], 'targetMiniReel', 123);
                done();
            });
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            campaignUtils.createBanners.andCallFake(function(bannCfgs, oldBanns, type, campId) {
                if (type === 'card') return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campModule.createBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createBanners.calls.length).toBe(2);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'e-12'}], [{id: 'e-2'}], 'miniReel', 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-11'}], [{id: 'rc-1'}], 'card', 123);
                done();
            });
        });
    });
    
    describe('cleanBanners', function() {
        beforeEach(function() {
            req.body = { id: 'cam-1', cards: [{id: 'rc-11'}], targetMiniReels: [{id: 'e-11'}],
                         miniReels: [{id: 'e-12'}] };
            req.origObj = { id: 'cam-1', adtechId: 123, cards: [{id: 'rc-1'}],
                            targetMiniReels: [{id: 'e-1'}], miniReels: [{id: 'e-2'}] };
            spyOn(campaignUtils, 'cleanBanners').andReturn(q());
        });
        
        it('should call campaignUtils.cleanBanners appropriately', function(done) {
            campModule.cleanBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.cleanBanners.calls.length).toBe(3);
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-12'}], [{id: 'e-2'}], 'cam-1');
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'rc-11'}], [{id: 'rc-1'}], 'cam-1');
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-11'}], [{id: 'e-1'}], 'cam-1');
                done();
            });
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            campaignUtils.cleanBanners.andCallFake(function(bannCfgs, oldBanns, type, campId) {
                if (this.cleanBanners.calls.length === 2) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campModule.cleanBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.cleanBanners.calls.length).toBe(2);
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-12'}], [{id: 'e-2'}], 'cam-1');
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'rc-11'}], [{id: 'rc-1'}], 'cam-1');
                done();
            });
        });
    });
    
    describe('deleteContent', function() {
        var svc;
        beforeEach(function() {
            req.origObj = { id: 'cam-1', cards: [{id: 'rc-1'}, {id: 'rc-2'}],
                            miniReels: [{id: 'e-1'}], targetMiniReels: [{id: 'e-2'}] };
            svc = {
                _cardColl: { update: jasmine.createSpy('cardColl.update')
                                     .andCallFake(function(query, updates, opts, cb) { cb(); }) },
                _expColl: { update: jasmine.createSpy('expColl.update')
                                     .andCallFake(function(query, updates, opts, cb) { cb(); }) },
            };
        });
        
        it('should delete content associated with the campaign', function(done) {
            campModule.deleteContent(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(svc._cardColl.update).toHaveBeenCalledWith({id: {$in: ['rc-1', 'rc-2']}},
                    {$set: {lastUpdated: jasmine.any(Date), status: 'deleted'}}, {multi: true}, jasmine.any(Function));
                expect(svc._expColl.update).toHaveBeenCalledWith({id: {$in: ['e-1']}},
                    {$set: {lastUpdated: jasmine.any(Date), status: 'deleted'}}, {multi: true}, jasmine.any(Function));
                done();
            });
        });
        
        it('should handle the cards and miniReels being undefined', function(done) {
            req.origObj = { id: 'cam-1'};
            campModule.deleteContent(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(svc._cardColl.update).toHaveBeenCalledWith({id: {$in: []}},
                    {$set: {lastUpdated: jasmine.any(Date), status: 'deleted'}}, {multi: true}, jasmine.any(Function));
                expect(svc._expColl.update).toHaveBeenCalledWith({id: {$in: []}},
                    {$set: {lastUpdated: jasmine.any(Date), status: 'deleted'}}, {multi: true}, jasmine.any(Function));
                done();
            });
        });
        
        it('should reject if deleting cards fails', function(done) {
            svc._cardColl.update.andCallFake(function(query, updates, opts, cb) { cb('I GOT A PROBLEM'); });
            campModule.deleteContent(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(svc._cardColl.update).toHaveBeenCalled();
                expect(svc._expColl.update).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if deleting experiences fails', function(done) {
            svc._expColl.update.andCallFake(function(query, updates, opts, cb) { cb('I GOT A PROBLEM'); });
            campModule.deleteContent(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(svc._cardColl.update).toHaveBeenCalled();
                expect(svc._expColl.update).toHaveBeenCalled();
                done();
            });
        });
    });
});

