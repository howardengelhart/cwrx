var flush = true;
describe('sponsor-groups (UT)', function() {
    var mockLog, logger, q, adtech, groupModule, FieldValidator, campaignUtils, mockClient,
        nextSpy, doneSpy, errorSpy, req, mockCamp, mockBanners, mockGroup, now, later;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        groupModule     = require('../../bin/sponsor-groups');
        campaignUtils   = require('../../lib/campaignUtils');
        FieldValidator  = require('../../lib/fieldValidator');

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
        now = new Date();
        later = new Date(now.valueOf() + 60*1000);
        mockCamp = {
            id: 123, name: 'group 1', createdAt: now, lastUpdatedAt: later,
            bannerTimeRangeList: [{
                bannerInfoList: [
                    { bannerReferenceId: 12 },
                    { bannerReferenceId: 23 }
                ]
            }]
        };
        mockBanners = [
            {id: 12, extId: 'e-1', bannerNumber: 1},
            {id: 23, extId: 'e-2', bannerNumber: 2},
            {id: 34, extId: 'e-3', bannerNumber: 3}
        ];
        mockGroup = {
            id: 123, name: 'group 1', created: now, lastUpdated: later,
            miniReels: [ {id: 'e-1', bannerId: 12, bannerNumber: 1},
                         {id: 'e-2', bannerId: 23, bannerNumber: 2} ]
        };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockClient = {client: 'yes'};
        ['adtech/lib/campaign', 'adtech/lib/banner'].forEach(function(key) {
            delete require.cache[require.resolve(key)];
        });
        adtech = require('adtech');
        adtech.campaignAdmin = require('adtech/lib/campaign');
        adtech.bannerAdmin = require('adtech/lib/banner');
        ['campaignAdmin', 'bannerAdmin'].forEach(function(admin) {
            Object.keys(adtech[admin]).forEach(function(prop) {
                if (typeof adtech[admin][prop] !== 'function') {
                    return;
                }
                adtech[admin][prop] = adtech[admin][prop].bind(adtech[admin], mockClient);
                spyOn(adtech[admin], prop).andCallThrough();
            });
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(groupModule.createValidator._forbidden).toEqual(['id', 'created', 'adtechId']);
            expect(groupModule.createValidator._required).toEqual(['name', 'advertiserId', 'customerId']);
            expect(groupModule.createValidator._formats).toEqual({miniReels: ['string'], categories: ['string']});
        });
    });

    describe('editValidator', function() {
        it('should have initialized correctly', function() {
            expect(groupModule.editValidator._forbidden).toEqual(['id', 'created']);
            expect(groupModule.editValidator._formats).toEqual({miniReels: ['string'], categories: ['string']});
        });
    });
    
    describe('formatOutput', function() {
        it('should replace the list of minireel objects with a list of ids', function() {
            var group = { id: 123, miniReels: [{id: 'e-1', bannerId: 12}, {id: 'e-2', bannerId: 23}] };
            expect(groupModule.formatOutput(group)).toEqual({id: 123, miniReels: ['e-1', 'e-2']});
        });
    });
    
    describe('transformCampaign', function() {
        var categories;
        beforeEach(function() {
            categories = ['food', 'sports'];
        });

        it('should format an adtech campaign for displaying to the user', function() {
            expect(groupModule.transformCampaign(mockCamp, mockBanners, categories)).toEqual({
                id: 123,
                name: 'group 1',
                created: now,
                lastUpdated: later,
                categories: ['food', 'sports'],
                miniReels: [
                    {id: 'e-1', bannerId: 12, bannerNumber: 1},
                    {id: 'e-2', bannerId: 23, bannerNumber: 2}
                ]
            });
        });
        
        it('should handle a group without banners and categories', function() {
            expect(groupModule.transformCampaign(mockCamp)).toEqual({
                id: 123,
                name: 'group 1',
                created: now,
                lastUpdated: later,
                miniReels: []
            });
        });
    });
    
    describe('lookupCampaign', function() {
        beforeEach(function() {
            adtech.campaignAdmin.getCampaignById.andReturn(q(mockCamp));
            adtech.bannerAdmin.getBannerList.andReturn(q(mockBanners));
            spyOn(campaignUtils, 'lookupKeywords').andReturn(q(['sports', 'food']));
        });
        
        it('should look up a campaign by id', function(done) {
            groupModule.lookupCampaign(123).then(function(group) {
                expect(group).toEqual({ id: 123, name: 'group 1', created: now, lastUpdated: later,
                                        miniReels: [{id: 'e-1', bannerId: 12, bannerNumber: 1},
                                                    {id: 'e-2', bannerId: 23, bannerNumber: 2}] });
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(campaignUtils.lookupKeywords).not.toHaveBeenCalled();
                expect(adtech.bannerAdmin.getBannerList).toHaveBeenCalledWith(null, null, jasmine.any(adtech.AOVE));
                expect(adtech.bannerAdmin.getBannerList.calls[0].args[2].expressions)
                    .toEqual([{ attr: 'campaignId', val: 123, op: '==', type: 'xsd:long' }]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should look up the category keywords if defined', function(done) {
            mockCamp.priorityLevelThreeKeywordIdList = [78, 89];
            groupModule.lookupCampaign(123).then(function(group) {
                expect(group.categories).toEqual(['sports', 'food']);
                expect(campaignUtils.lookupKeywords).toHaveBeenCalledWith([78, 89]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should gracefully handle retrieving no banners', function(done) {
            adtech.bannerAdmin.getBannerList.andReturn(q([]));
            groupModule.lookupCampaign(123).then(function(group) {
                expect(group.miniReels).toEqual([]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if adtech cannot find the campaign', function(done) {
            adtech.campaignAdmin.getCampaignById.andReturn(q.reject(new Error('Unable to locate object 123')));
            groupModule.lookupCampaign(123).then(function(group) {
                expect(group).not.toBeDefined();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(adtech.bannerAdmin.getBannerList).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if retrieving the campaign fails', function(done) {
            adtech.campaignAdmin.getCampaignById.andReturn(q.reject(new Error('Unable to do your thang')));
            groupModule.lookupCampaign(123).then(function(group) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.bannerAdmin.getBannerList).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if retrieving the keywords fails', function(done) {
            mockCamp.priorityLevelThreeKeywordIdList = [78, 89];
            campaignUtils.lookupKeywords.andReturn(q.reject(new Error('Unable to do your thang')));
            groupModule.lookupCampaign(123).then(function(group) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.bannerAdmin.getBannerList).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if retrieving the banner list fails', function(done) {
            adtech.bannerAdmin.getBannerList.andReturn(q.reject(new Error('Unable to do your thang')));
            groupModule.lookupCampaign(123).then(function(group) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('getGroup', function() {
        beforeEach(function() {
            req.params = { id: 123 };
            spyOn(groupModule, 'lookupCampaign').andReturn(q(mockGroup));
        });
        
        it('should find the group', function(done) {
            groupModule.getGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 200, body: mockGroup});
                expect(groupModule.lookupCampaign).toHaveBeenCalledWith(123);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the group cannot be found', function(done) {
            groupModule.lookupCampaign.andReturn(q());
            groupModule.getGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'Group not found'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass along errors from lookupCampaign', function(done) {
            groupModule.lookupCampaign.andReturn(q.reject('Adtech failure'));
            groupModule.getGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
            }).done(done);
        });
    });
    
    describe('createGroup', function() {
        beforeEach(function() {
            req.body = { name: 'group 1' };
            req.user = { id: 'u-1' };
            spyOn(groupModule.createValidator, 'validate').andReturn(true);
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                if (keywords && keywords.length > 0) return q([78, 89]);
                else return q([]);
            });
            spyOn(campaignUtils, 'formatCampaign').andReturn({formatted: true});
            adtech.campaignAdmin.createCampaign.andReturn(q(mockCamp));
            spyOn(campaignUtils, 'createBanners').andReturn(q());
            spyOn(groupModule, 'lookupCampaign').andReturn(q(mockGroup));
        });
        
        it('should successfully create a group campaign', function(done) {
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: {id: 123, name: 'group 1', created: now,
                                                        lastUpdated: later, miniReels: []}});
                expect(groupModule.createValidator.validate).toHaveBeenCalledWith(req.body, {}, {id: 'u-1'});
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({name: 'group 1', created: jasmine.any(Date)}, { level3: [] });
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: true});
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
                expect(groupModule.lookupCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to create banners for the campaign', function(done) {
            req.body.miniReels = ['e-1', 'e-2'];
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: {id: 123, name: 'group 1', created: now,
                                                        lastUpdated: later, miniReels: ['e-1', 'e-2']}});
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-2'}], null, 'contentMiniReel', 123);
                expect(groupModule.lookupCampaign).toHaveBeenCalledWith(123);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to set category keywords on the campaign', function(done) {
            req.body.categories = ['food', 'sports'];
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: {id: 123, name: 'group 1', created: now, categories: ['food', 'sports'],
                                                        lastUpdated: later, miniReels: []}});
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['food', 'sports']);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({name: 'group 1',
                    categories: ['food', 'sports'], created: jasmine.any(Date)}, { level3: [78, 89] });
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
                expect(groupModule.lookupCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is not valid', function(done) {
            groupModule.createValidator.validate.andReturn(false);
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Invalid request body'});
                expect(campaignUtils.makeKeywords).not.toHaveBeenCalled();
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if making keywords fails', function(done) {
            campaignUtils.makeKeywords.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if creating the campaign fails', function(done) {
            req.body.miniReels = ['e-1', 'e-2'];
            adtech.campaignAdmin.createCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if creating the banners fails', function(done) {
            req.body.miniReels = ['e-1', 'e-2'];
            campaignUtils.createBanners.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(groupModule.lookupCampaign).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if looking up the campaign again fails', function(done) {
            req.body.miniReels = ['e-1', 'e-2'];
            groupModule.lookupCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the campaign cannot be looked up again', function(done) {
            req.body.miniReels = ['e-1', 'e-2'];
            groupModule.lookupCampaign.andReturn(q());
            groupModule.createGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('editGroup', function() {
        beforeEach(function() {
            req.params = { id: 123 };
            req.body = { miniReels: ['e-1', 'e-3'] };
            req.user = { id: 'u-1' };
            spyOn(groupModule.editValidator, 'validate').andReturn(true);
            spyOn(campaignUtils, 'createBanners').andReturn(q());
            spyOn(campaignUtils, 'cleanBanners').andReturn(q());
            spyOn(groupModule, 'lookupCampaign').andReturn(q(mockGroup));
        });
        
        it('should successfully update the banner list of a group campaign', function(done) {
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: {id: 123, name: 'group 1', created: now,
                                                        lastUpdated: later, miniReels: ['e-1', 'e-3']}});
                expect(groupModule.editValidator.validate).toHaveBeenCalledWith(req.body, {}, {id: 'u-1'});
                expect(groupModule.lookupCampaign).toHaveBeenCalledWith(123);
                expect(campaignUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-3'}],
                    [{id: 'e-1', bannerId: 12, bannerNumber: 1}, {id: 'e-2', bannerId: 23, bannerNumber: 2}], 123);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-3'}],
                    [{id: 'e-1', bannerId: 12, bannerNumber: 1}, {id: 'e-2', bannerId: 23, bannerNumber: 2}], 'contentMiniReel', 123);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not perform any edits if there is no miniReels list on the request', function(done) {
            req.body = { name: 'group 1' };
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: {id: 123, name: 'group 1', created: now,
                                                        lastUpdated: later, miniReels: ['e-1', 'e-2']}});
                expect(groupModule.lookupCampaign).toHaveBeenCalled();
                expect(campaignUtils.cleanBanners).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 400 if the body is not valid', function(done) {
            groupModule.editValidator.validate.andReturn(false);
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Invalid request body'});
                expect(groupModule.lookupCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.cleanBanners).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 404 if the group does not exist', function(done) {
            groupModule.lookupCampaign.andReturn(q());
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'Group not found'});
                expect(campaignUtils.cleanBanners).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if looking up the campaign fails', function(done) {
            groupModule.lookupCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.cleanBanners).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if cleaning banners fails', function(done) {
            campaignUtils.cleanBanners.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if creating banners fails', function(done) {
            campaignUtils.createBanners.andReturn(q.reject('I GOT A PROBLEM'));
            groupModule.editGroup(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
});

