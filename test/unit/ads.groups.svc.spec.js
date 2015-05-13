var flush = true;
describe('ads-groups (UT)', function() {
    var mockLog, logger, q, CrudSvc, groupModule, bannerUtils, campaignUtils,
        nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc');
        groupModule     = require('../../bin/ads-groups');
        campaignUtils   = require('../../lib/campaignUtils');
        bannerUtils     = require('../../lib/bannerUtils');

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

        groupModule.groupsCfg = { advertiserId: 987, customerId: 876 };
        groupModule.campsCfg = {
            campaignTypeId: 343434, statusDelay: 1000, statusAttempts: 10,
            dateDelays: { start: 100, end: 200 }
        };

        req = { uuid: '1234', _advertiserId: 987, _customerId: 876 };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        it('should setup the group service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').andReturn(CrudSvc.prototype.validateUniqueProp);
            spyOn(groupModule.getAccountIds, 'bind').andReturn(groupModule.getAccountIds);
            spyOn(groupModule.formatOutput, 'bind').andReturn(groupModule.formatOutput);
            
            var config = { campaigns: { statusDelay: 100, statusAttempts: 5 },
                           minireelGroups: { advertiserId: 123, customerId: 234 } };
            var mockDb = {
                collection: jasmine.createSpy('db.collection()').andCallFake(function(name) {
                    return { collectionName: name };
                })
            };
            var svc = groupModule.setupSvc(mockDb, config);
            expect(groupModule.getAccountIds.bind).toHaveBeenCalledWith(groupModule, svc);
            expect(groupModule.formatOutput.bind).toHaveBeenCalledWith(groupModule, svc);
            expect(groupModule.groupsCfg).toEqual({ advertiserId: 123, customerId: 234 });
            expect(groupModule.campsCfg).toEqual({ statusDelay: 100, statusAttempts: 5 });
            
            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('g');
            expect(svc.objName).toBe('minireelGroups');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toEqual({collectionName: 'minireelGroups'});
            expect(svc._advertColl).toEqual({collectionName: 'advertisers'});
            expect(svc._custColl).toEqual({collectionName: 'customers'});
            
            expect(svc.createValidator._required).toContain('name');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc.editValidator._forbidden).toContain('advertiserId', 'customerId');
            ['miniReels', 'categories'].forEach(function(key) {
                expect(svc.createValidator._formats[key]).toEqual(['string']);
                expect(svc.editValidator._formats[key]).toEqual(['string']);
            });

            expect(svc._middleware.read).toEqual([svc.preventGetAll]);
            expect(svc._middleware.create).toEqual([jasmine.any(Function), jasmine.any(Function),
                groupModule.validateDates, groupModule.ensureDistinctList, CrudSvc.prototype.validateUniqueProp,
                groupModule.getAccountIds, groupModule.createAdtechGroup, groupModule.createBanners]);
            expect(svc._middleware.edit).toEqual([jasmine.any(Function), jasmine.any(Function),
                groupModule.validateDates, groupModule.ensureDistinctList, CrudSvc.prototype.validateUniqueProp,
                groupModule.getAccountIds, groupModule.cleanBanners, groupModule.createBanners,
                groupModule.editAdtechGroup]);
            expect(svc._middleware.delete).toEqual([jasmine.any(Function), groupModule.deleteAdtechGroup]);
            expect(svc.formatOutput).toBe(groupModule.formatOutput);
        });
    });
    
    describe('validateDates', function() {
        beforeEach(function() {
            req.body = { name: 'group 1' };
            spyOn(campaignUtils, 'validateDates').andCallThrough();
        });
        
        it('should call next if campaignUtils.validateDates returns true', function(done) {
            groupModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({name: 'group 1', startDate: jasmine.any(String), endDate: jasmine.any(String)});
                expect(campaignUtils.validateDates).toHaveBeenCalledWith(req.body, undefined, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should call done if campaignUtils.validateDates returns false', function(done) {
            req.body = { name: 'group 1', startDate: 'foo' };
            groupModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'group has invalid dates'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should preserve dates from req.origObj', function(done) {
            var start = new Date(new Date().valueOf() + 3*60*60*1000).toISOString(),
                end = new Date(new Date().valueOf() + 4*60*60*1000).toISOString();
            req.origObj = { startDate: start, endDate: end };
            groupModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({name: 'group 1', startDate: start, endDate: end});
                expect(campaignUtils.validateDates).toHaveBeenCalledWith(req.body, req.origObj, {start: 100, end: 200}, '1234');
                done();
            });
        });
    });
    
    describe('ensureDistinctList', function() {
        it('should call next if all entries in the miniReels list are distinct', function(done) {
            req.body = { miniReels: ['e-1', 'e-2', 'e-11'] };
            groupModule.ensureDistinctList(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if there are repeated entries in the miniReels list', function(done) {
            req.body = { miniReels: ['e-1', 'e-2', 'e-1'] };
            groupModule.ensureDistinctList(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'miniReels must be distinct'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if miniReels is not defined', function(done) {
            req.body = {};
            groupModule.ensureDistinctList(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('formatOutput', function() {
        it('should replace the list of minireel objects with a list of ids', function() {
            var group = { _id: 'qwer124', id: 123, miniReels: [{id: 'e-1', bannerId: 12}, {id: 'e-2', bannerId: 23}] };
            expect(groupModule.formatOutput(CrudSvc, group)).toEqual({id: 123, miniReels: ['e-1', 'e-2']});
        });
    });
    
    describe('getAccountIds', function() {
        var svc;
        beforeEach(function() {
            req.body = { advertiserId: 123, customerId: 321 };
            req.origObj = { advertiserId: 234, customerId: 432 };
            svc = { _advertColl: 'fakeAdvertColl', _custColl: 'fakeCustColl' };
            spyOn(campaignUtils, 'getAccountIds')
                .andCallFake(function(advertColl, custColl, req, next, done) { return q(next()); });
        });
        
        it('should take the advertiserId and customerId from the body', function(done) {
            groupModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 123, customerId: 321 });
                expect(campaignUtils.getAccountIds).toHaveBeenCalledWith('fakeAdvertColl', 'fakeCustColl', req, nextSpy, doneSpy);
                done();
            });
        });
        
        it('should fall back to the advertiserId and customerId on the origObj', function(done) {
            req.body = { name: 'foo' };
            groupModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 234, customerId: 432, name: 'foo' });
                expect(campaignUtils.getAccountIds).toHaveBeenCalled();
                done();
            });
        });
        
        it('should next fall back to the advertiserId and customerId on the origObj', function(done) {
            req.body = {}; req.origObj = {};
            groupModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 987, customerId: 876 });
                expect(campaignUtils.getAccountIds).toHaveBeenCalled();
                done();
            });
        });
        
        it('should be able to take each id from different locations', function(done) {
            req.body = { customerId: 321 }; req.origObj = {};
            groupModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ advertiserId: 987, customerId: 321 });
                expect(campaignUtils.getAccountIds).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if campaignUtils.getAccountIds rejects', function(done) {
            campaignUtils.getAccountIds.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('createAdtechGroup', function() {
        beforeEach(function() {
            req.body = { id: 'g-1', name: 'group 1', categories: ['food', 'sports'] };
            spyOn(campaignUtils, 'makeKeywordLevels').andReturn(q({keys: 'yes'}));
            spyOn(campaignUtils, 'createCampaign').andReturn(q({id: '1234'}));
        });
        
        it('should make keywords and call createCampaign', function(done) {
            groupModule.createAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    id: 'g-1', adtechId: 1234, name: 'group 1', categories: ['food', 'sports'],
                    startDate: jasmine.any(String), endDate: jasmine.any(String)
                });
                expect(new Date(req.body.endDate) - new Date(req.body.startDate))
                    .toEqual(groupModule.campsCfg.dateDelays.end - groupModule.campsCfg.dateDelays.start);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: ['food', 'sports']});
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({
                    id: 'g-1',
                    name: 'group 1',
                    startDate: req.body.startDate,
                    endDate: req.body.endDate,
                    campaignTypeId: 343434,
                    keywords: {keys: 'yes'},
                    advertiserId: 987,
                    customerId: 876
                }, '1234');
                done();
            });
        });
        
        it('should handle a missing category list', function(done) {
            delete req.body.categories;
            groupModule.createAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({id: 'g-1', adtechId: 1234, name: 'group 1',
                    startDate: jasmine.any(String), endDate: jasmine.any(String)});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: undefined});
                expect(campaignUtils.createCampaign.calls[0].args[0].keywords).toEqual({keys: 'yes'});
                done();
            });
        });
        
        it('should reject if making keywords fails', function(done) {
            campaignUtils.makeKeywordLevels.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(req.body.adtechId).not.toBeDefined();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if creating the campaign fails', function(done) {
            campaignUtils.createCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(req.body.adtechId).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('createBanners', function() {
        beforeEach(function() {
            req.body = { miniReels: ['e-1', 'e-2'] };
            req.origObj = { adtechId: 123, miniReels: [{id: 'e-2'}, {id: 'e-3'}] };
            spyOn(bannerUtils, 'createBanners').andReturn(q());
        });
        
        it('should call createBanners', function(done) {
            groupModule.createBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ miniReels: [{id: 'e-1'}, {id: 'e-2'}] });
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-2'}],
                    [{id: 'e-2'}, {id: 'e-3'}], 'contentMiniReel', false, 123);
                done();
            });
        });
        
        it('should tolerate lists being undefined', function(done) {
            var req1 = { body: {}, origObj: req.origObj },
                req2 = { body: { adtechId: 234, miniReels: req.body.miniReels } };

            groupModule.createBanners(req1, nextSpy, doneSpy).catch(errorSpy);
            groupModule.createBanners(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req1.body).toEqual({});
                expect(req2.body).toEqual({ adtechId: 234, miniReels: [{id: 'e-1'}, {id: 'e-2'}] });
                expect(bannerUtils.createBanners.calls[0].args).toEqual([undefined,
                    [{id: 'e-2'}, {id: 'e-3'}], 'contentMiniReel', false, 123]);
                expect(bannerUtils.createBanners.calls[1].args).toEqual([[{id: 'e-1'}, {id: 'e-2'}],
                    [], 'contentMiniReel', false, 234]);
                done();
            });
        });
        
        it('should reject if createBanners fails', function(done) {
            bannerUtils.createBanners.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('cleanBanners', function() {
        beforeEach(function() {
            req.body = { miniReels: ['e-1', 'e-2'] };
            req.origObj = { adtechId: 123, miniReels: [{id: 'e-2'}, {id: 'e-3'}] };
            spyOn(bannerUtils, 'cleanBanners').andReturn(q());
        });
        
        it('should call cleanBanners', function(done) {
            groupModule.cleanBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ miniReels: [{id: 'e-1'}, {id: 'e-2'}] });
                expect(bannerUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-2'}],
                    [{id: 'e-2'}, {id: 'e-3'}], 123);
                done();
            });
        });
        
        it('should tolerate lists being undefined', function(done) {
            var req1 = { body: {}, origObj: req.origObj },
                req2 = { body: req.body, origObj: { adtechId: 123 } };

            groupModule.cleanBanners(req1, nextSpy, doneSpy).catch(errorSpy);
            groupModule.cleanBanners(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req1.body).toEqual({});
                expect(req2.body).toEqual({ miniReels: [{id: 'e-1'}, {id: 'e-2'}] });
                expect(bannerUtils.cleanBanners.calls[0].args).toEqual([undefined,
                    [{id: 'e-2'}, {id: 'e-3'}], 123]);
                expect(bannerUtils.cleanBanners.calls[1].args).toEqual([[{id: 'e-1'}, {id: 'e-2'}],
                    undefined, 123]);
                done();
            });
        });
        
        it('should reject if cleanBanners fails', function(done) {
            bannerUtils.cleanBanners.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.cleanBanners(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('editAdtechGroup', function() {
        beforeEach(function() {
            req.body = { name: 'new name', categories: ['sports', 'food'] };
            req.origObj = { adtechId: 123, name: 'old name', categories: ['sport', 'food'] };
            spyOn(campaignUtils, 'editCampaign').andReturn(q());
            spyOn(campaignUtils, 'makeKeywordLevels').andReturn(q({keys: 'yes'}));
        });
        
        it('should be able to edit the name and keywords', function(done) {
            groupModule.editAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.adtechId).toBe(123);
                expect(req.body.categories).toEqual(['sports', 'food']);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: ['sports', 'food']});
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new name', req.body, {keys: 'yes'}, '1234');
                done();
            });
        });
        
        it('should skip making keywords if the categories are undefined', function(done) {
            delete req.body.categories;
            groupModule.editAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('new name', req.body, undefined, '1234');
                done();
            });
        });
        
        it('should do nothing if all properties are are unchanged', function(done) {
            req.body = { name: 'name', categories: ['food'] };
            req.origObj = { adtechId: 123, name: 'name', startDate: 'oldStart', endDate: 'end', categories: ['food'] };
            groupModule.editAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(req.body.categories).toEqual(['food']);
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if making keywords fails', function(done) {
            campaignUtils.makeKeywordLevels.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.editAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if editing the campaign fails', function(done) {
            campaignUtils.editCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.editAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('deleteAdtechGroup', function() {
        beforeEach(function() {
            req.origObj = { id: 'g-1', adtechId: 123 };
            spyOn(campaignUtils, 'deleteCampaigns').andReturn(q());
        });
        
        it('should delete the group\'s adtech campaign', function(done) {
            groupModule.deleteAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([123], 1000, 10);
                done();
            });
        });

        it('should just log a warning if the origObj has no adtechId', function(done) {
            delete req.origObj.adtechId;
            groupModule.deleteAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if deleting the campaign fails', function(done) {
            campaignUtils.deleteCampaigns.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.deleteAdtechGroup(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
});

