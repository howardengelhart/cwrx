var flush = true;
describe('sponsor-groups (UT)', function() {
    var mockLog, logger, q, adtech, groupModule, FieldValidator, campaignUtils, mockClient,
        nextSpy, doneSpy, errorSpy, req;

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
            expect(groupModule.createValidator._formats).toEqual({miniReels: ['object'], categories: ['string']});
        });
        //TODO: actually have tests for forbidden/required/formats?
    });

    describe('editValidator', function() {
        it('should have initialized correctly', function() {
            expect(groupModule.editValidator._forbidden).toEqual(['id', 'created']);
            expect(groupModule.editValidator._formats).toEqual({miniReels: ['object'], categories: ['string']});
        });
        //TODO: actually have tests for forbidden/required/formats?
    });
    
    describe('transformCampaign', function() { //TODO: more tests for this method?
        it('should format an adtech campaign for displaying to the user', function() {
            var now = new Date(),
                later = new Date(now.valueOf() + 60*1000),
                campaign = {
                    id: 123, name: 'group 1', createdAt: now, lastUpdatedAt: later,
                    bannerTimeRangeList: [{
                        bannerInfoList: [
                            { bannerReferenceId: 12 },
                            { bannerReferenceId: 23 }
                        ]
                    }]
                },
                banners = [
                    {id: 12, extId: 'e-1', bannerNumber: 1},
                    {id: 23, extId: 'e-2', bannerNumber: 2},
                    {id: 34, extId: 'e-3', bannerNumber: 3}
                ],
                categories = ['food', 'sports'];
                
            expect(groupModule.transformCampaign(campaign, banners, categories)).toEqual({
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
    });
});

