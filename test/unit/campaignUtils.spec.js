var flush = true;
describe('campaignUtils', function() {
    var q, path, fs, mockLog, logger, adtech, campaignUtils, mockClient;
    
    beforeEach(function() {
        jasmine.Clock.useMock();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        path            = require('path');
        fs              = require('fs-extra');
        logger          = require('../../lib/logger');
        campaignUtils   = require('../../lib/campaignUtils');
        
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
        
        mockClient = {client: 'yes'};
        ['adtech/lib/campaign', 'adtech/lib/banner', 'adtech/lib/keyword'].forEach(function(key) {
            delete require.cache[require.resolve(key)];
        });
        adtech = require('adtech');
        adtech.campaignAdmin = require('adtech/lib/campaign');
        adtech.bannerAdmin = require('adtech/lib/banner');
        adtech.keywordAdmin = require('adtech/lib/keyword');
        ['campaignAdmin', 'bannerAdmin', 'keywordAdmin'].forEach(function(admin) {
            Object.keys(adtech[admin]).forEach(function(prop) {
                if (typeof adtech[admin][prop] !== 'function') {
                    return;
                }
                adtech[admin][prop] = adtech[admin][prop].bind(adtech[admin], mockClient);
                spyOn(adtech[admin], prop).andCallThrough();
            });
        });
    });

    describe('lookupKeywords', function() {
        var ids;
        beforeEach(function() {
            campaignUtils._keywordCache = {};
            ids = [123, 456, 789];
            adtech.keywordAdmin.getKeywordById.andCallFake(function(id) { return q('key' + id); });
        });
        
        it('should lookup multiple keywords by id', function(done) {
            campaignUtils.lookupKeywords(ids).then(function(keywords) {
                expect(keywords).toEqual(['key123', 'key456', 'key789']);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                expect(campaignUtils._keywordCache.key456).toBe(456);
                expect(campaignUtils._keywordCache.key789).toBe(789);
                expect(adtech.keywordAdmin.getKeywordById).toHaveBeenCalledWith(123);
                expect(adtech.keywordAdmin.getKeywordById).toHaveBeenCalledWith(456);
                expect(adtech.keywordAdmin.getKeywordById).toHaveBeenCalledWith(789);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should retrieve keywords from the cache if defined', function(done) {
            campaignUtils._keywordCache.key123 = 123;
            campaignUtils.lookupKeywords(ids).then(function(keywords) {
                expect(keywords).toEqual(['key123', 'key456', 'key789']);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                expect(campaignUtils._keywordCache.key456).toBe(456);
                expect(campaignUtils._keywordCache.key789).toBe(789);
                expect(adtech.keywordAdmin.getKeywordById).not.toHaveBeenCalledWith(123);
                expect(adtech.keywordAdmin.getKeywordById).toHaveBeenCalledWith(456);
                expect(adtech.keywordAdmin.getKeywordById).toHaveBeenCalledWith(789);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should eventually delete keywords from the cache', function(done) {
            campaignUtils.lookupKeywords(ids.slice(0, 1)).then(function(keywords) {
                expect(keywords).toEqual(['key123']);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                jasmine.Clock.tick(1000*60*60*24 + 1);
                expect(campaignUtils._keywordCache.key123).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the call to adtech fails', function(done) {
            adtech.keywordAdmin.getKeywordById.andCallFake(function(id) {
                if (id === 456) return q.reject('I GOT A PROBLEM');
                else return q('key' + id);
            });
            campaignUtils.lookupKeywords(ids).then(function(keywords) {
                expect(keywords).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils._keywordCache.key456).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('makeKeywordLevels', function() {
        it('should call makeKeywords for each level', function(done) {
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                return keywords && keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).toEqual({level1: ['foo0', 'bar1'], level2: [], level3: undefined});
                expect(campaignUtils.makeKeywords.calls.length).toBe(3);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['foo', 'bar']);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(undefined);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if any of the makeKeywords calls fails', function(done) {
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                if (!keywords) return q.reject('I GOT A PROBLEM');
                return keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywords.calls.length).toBe(3);
            }).done(done);
        });
    });
    
    describe('makeKeywords', function() {
        var keywords;
        beforeEach(function() {
            campaignUtils._keywordCache = {};
            keywords = ['key123', 'key456'];
            adtech.keywordAdmin.registerKeyword.andCallFake(function(keyword) {
                return q(parseInt(keyword.match(/\d+/)[0]));
            });
        });
        
        it('should register a list of keywords', function(done) {
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                expect(campaignUtils._keywordCache.key456).toBe(456);
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
            campaignUtils._keywordCache.key123 = 123;
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                expect(campaignUtils._keywordCache.key456).toBe(456);
                expect(adtech.keywordAdmin.registerKeyword).not.toHaveBeenCalledWith('key123');
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should eventually delete keywords from the cache', function(done) {
            campaignUtils.makeKeywords(keywords.slice(0, 1)).then(function(ids) {
                expect(ids).toEqual([123]);
                expect(campaignUtils._keywordCache.key123).toBe(123);
                jasmine.Clock.tick(1000*60*60*24 + 1);
                expect(campaignUtils._keywordCache.key123).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the call to adtech fails', function(done) {
            adtech.keywordAdmin.registerKeyword.andCallFake(function(keyword) {
                if (keyword === 'key123') return q.reject('I GOT A PROBLEM');
                else return q(parseInt(keyword.match(/\d+/)[0]));
            });
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils._keywordCache.key123).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('formatCampaign', function() {
        var campaign, now, keywords, features;
        beforeEach(function() {
           now = new Date();
           campaign = {id: 'cam-1', name: 'camp1', created: now, advertiserId: '123', customerId: '456'};
           keywords = { level1: [12, 23], level3: [34] };
           features = {targeting:true,placements:true,frequency:true,schedule:true,
                       ngkeyword:true,keywordLevel:true,volume:true};
        });
        
        it('should format a campaign for saving to adtech', function() {
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.adGoalTypeId).toBe(1);
            expect(fmt.advertiserId).toBe(123);
            expect(Object.keys(fmt.campaignFeatures)).toEqual(['attributes', 'Keys', 'Values']);
            expect(adtech.campaignAdmin.makeCampaignFeatures).toHaveBeenCalledWith(features);
            expect(fmt.campaignTypeId).toBe(26954);
            expect(fmt.customerId).toBe(456);
            expect(fmt.dateRangeList).toEqual({Items: jasmine.any(Object)});
            expect(adtech.campaignAdmin.makeDateRangeList).toHaveBeenCalledWith([
                {endDate: new Date(now.valueOf() + 365*24*60*60*1000).toISOString(), startDate: now.toISOString()}]);
            expect(fmt.extId).toBe('cam-1');
            expect(fmt.frequencyConfig).toEqual({type: -1});
            expect(fmt.id).not.toBeDefined();
            expect(fmt.name).toBe('camp1');
            expect(fmt.optimizerTypeId).toBe(6);
            expect(fmt.optimizingConfig).toEqual({minClickRate: 0, minNoPlacements: 0});
            expect(fmt.pricingConfig).toEqual({cpm: 0});
            expect(fmt.priority).toBe(3);
            expect(fmt.priorityLevelOneKeywordIdList.Items.Item).toEqual([]);
            expect(fmt.priorityLevelThreeKeywordIdList.Items.Item).toEqual([]);
            expect(fmt.viewCount).toBe(true);
        });
        
        it('should be able to set keywords', function() {
            var fmt = campaignUtils.formatCampaign(campaign, keywords);
            expect(fmt.priorityLevelOneKeywordIdList.Items.Item).toEqual([
                { attributes: { 'xsi:type': 'cm:long'}, '$value': 12 },
                { attributes: { 'xsi:type': 'cm:long'}, '$value': 23 },
            ]);
            expect(fmt.priorityLevelThreeKeywordIdList.Items.Item).toEqual([
                { attributes: { 'xsi:type': 'cm:long'}, '$value': 34 }
            ]);
        });
        
        it('should set a higher priority if the campaign is sponsored', function() {
            var fmt = campaignUtils.formatCampaign(campaign, null, true);
            expect(fmt.priority).toBe(2);
        });
        
        it('should set the campaign adtech id if defined', function() {
            campaign.adtechId = 987;
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.id).toBe(987);
        });
    });
    
    describe('createCampaign', function() {
        //TODO
    });
    
    describe('formatBanners', function() {
        var cardTempl, reelTempl;
        beforeEach(function() {
            cardTempl = fs.readFileSync(path.join(__dirname, '../../templates/adtechBanners/card.html'));
            reelTempl = fs.readFileSync(path.join(__dirname, '../../templates/adtechBanners/minireel.html'));
        });

        it('should format a banner for saving to adtech', function() {
            var obj = campaignUtils.formatBanner('card', 'rc-1');
            expect(obj).toEqual({ banner: jasmine.any(Object), bannerInfo: jasmine.any(Object) });
            expect(obj.banner).toEqual({
                data: cardTempl.toString('base64'), extId: 'rc-1', fileType: 'html', id: -1, mainFileName: 'index.html',
                name: 'card rc-1', originalData: cardTempl.toString('base64'), sizeTypeId: 277, statusId: 1, styleTypeId: 3 });
            expect(obj.bannerInfo).toEqual({
                bannerReferenceId: -1, entityFrequencyConfig: { frequencyCookiesOnly: true, frequencyDistributed: true,
                frequencyInterval: 30, frequencyTypeId: 18 }, name: 'card rc-1', statusId: 1 });
        });
        
        it('should correctly handle different banner types', function() {
            var banners = {};
            ['card', 'miniReel', 'contentMiniReel'].forEach(function(type) {
                banners[type] = campaignUtils.formatBanner(type, 'rc-1');
                if (type === 'card') expect(banners[type].banner.data).toBe(cardTempl.toString('base64'));
                else expect(banners[type].banner.data).toBe(reelTempl.toString('base64'));
                expect(banners[type].banner.originalData).toBe(banners[type].banner.data);
                expect(banners[type].banner.name).toBe(type + ' rc-1');
            });
            expect(banners.card.banner.sizeTypeId).toBe(277);
            expect(banners.miniReel.banner.sizeTypeId).toBe(509);
            expect(banners.contentMiniReel.banner.sizeTypeId).toBe(16);
        });
    });
    
    describe('createBanners', function() {
        var newBanns, oldBanns;
        beforeEach(function() {
            oldBanns = [];
            newBanns = [{id: 'rc-1'}, {id: 'rc-2'}];
            
            adtech.bannerAdmin.createBanner.andCallFake(function(campId, banner, bannerInfo) {
                var num = this.createBanner.calls.length;
                return q({name: banner.name, extId: banner.extId, bannerNumber: num, id: num*100});
            });
            spyOn(campaignUtils, 'formatBanner').andCallFake(function(type, id) {
                return {banner: {extId: id, name: type + ' ' + id}, bannerInfo: {name: type + ' ' + id}};
            });
        });
        
        it('should create a batch of banners', function(done) {
            campaignUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function(resp) {
                expect(newBanns).toEqual([
                    {id: 'rc-1', bannerId: 100, bannerNumber: 1},
                    {id: 'rc-2', bannerId: 200, bannerNumber: 2}
                ]);
                expect(campaignUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-1');
                expect(campaignUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-2');
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-1', name: 'card rc-1'}, {name: 'card rc-1'});
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-2', name: 'card rc-2'}, {name: 'card rc-2'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not recreate banners that already exist', function(done) {
            oldBanns = [
                { id: 'rc-2', bannerId: 200, bannerNumber: 2 },
                { id: 'rc-3', bannerId: 300, bannerNumber: 3 }
            ];
            campaignUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function() {
                expect(newBanns).toEqual([
                    {id: 'rc-1', bannerId: 100, bannerNumber: 1},
                    {id: 'rc-2', bannerId: 200, bannerNumber: 2}
                ]);
                expect(campaignUtils.formatBanner.calls.length).toBe(1);
                expect(campaignUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-1');
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(1);
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-1', name: 'card rc-1'}, {name: 'card rc-1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.bannerAdmin.createBanner.andReturn(q.reject('I GOT A PROBLEM'));
            campaignUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.formatBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(1);
            }).done(done);
        });
    });
    
    describe('cleanBanners', function() {
        var newBanns, oldBanns;
        beforeEach(function() {
            oldBanns = [
                { id: 'rc-2', bannerId: 200, bannerNumber: 2 },
                { id: 'rc-3', bannerId: 300, bannerNumber: 3 },
                { id: 'rc-4', bannerId: 400, bannerNumber: 4 }
            ];
            newBanns = [{id: 'rc-1'}, {id: 'rc-2'}];
            adtech.bannerAdmin.deleteBanner.andReturn(q());
        });
        
        it('should delete old banners not in the set of new banners', function(done) {
            campaignUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect(adtech.bannerAdmin.deleteBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.deleteBanner).toHaveBeenCalledWith(300);
                expect(adtech.bannerAdmin.deleteBanner).toHaveBeenCalledWith(400);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if there are no old banners', function(done) {
            oldBanns = [];
            campaignUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect(adtech.bannerAdmin.deleteBanner).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.bannerAdmin.deleteBanner.andReturn(q.reject('I GOT A PROBLEM'));
            campaignUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.bannerAdmin.deleteBanner.calls.length).toBe(1);
            }).done(done);
        });
    });
});
