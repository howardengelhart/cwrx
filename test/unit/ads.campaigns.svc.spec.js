var flush = true;
describe('ads-campaigns (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, campModule, campaignUtils, mockClient,
        nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        campModule      = require('../../bin/ads-campaigns');
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
        
        var keywordCount = 0;
        spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
            return q(keywords.map(function(key) { return ++keywordCount*100; }));
        });
        // spyOn(campaignUtils, 'formatCampaign').andReturn({formatted: true}); //TODO
        spyOn(campaignUtils, 'createBanners').andReturn(q());

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
            spyOn(campModule.deleteContent, 'bind').andReturn(campModule.deleteContent);
            spyOn(campModule.getAccountIds, 'bind').andReturn(campModule.getAccountIds);
            spyOn(campModule.formatOutput, 'bind').andReturn(campModule.formatOutput);
            var mockDb = {
                collection: jasmine.createSpy('db.collection()').andCallFake(function(name) {
                    return { collectionName: name };
                })
            };
            var svc = campModule.setupSvc(mockDb);
            expect(campModule.getAccountIds.bind).toHaveBeenCalledWith(campModule, svc);
            expect(campModule.deleteContent.bind).toHaveBeenCalledWith(campModule, svc);
            expect(campModule.formatOutput.bind).toHaveBeenCalledWith(campModule, svc);
            

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('cam');
            expect(svc.objName).toBe('campaigns');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toEqual({collectionName: 'campaigns'});
            expect(svc._cardColl).toEqual({collectionName: 'cards'});
            expect(svc._expColl).toEqual({collectionName: 'experiences'});
            expect(svc._advertColl).toEqual({collectionName: 'advertisers'});
            expect(svc._custColl).toEqual({collectionName: 'customers'});
            
            expect(svc.createValidator._required).toContain('advertiserId', 'customerId');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc.editValidator._forbidden).toContain('advertiserId', 'customerId');
            ['cards', 'miniReels', 'categories'].forEach(function(key) {
                expect(svc.createValidator._formats[key]).toEqual(['string']);
                expect(svc.editValidator._formats[key]).toEqual(['string']);
            });
            expect(svc.createValidator._formats.miniReelGroups).toEqual(['object']);
            expect(svc.editValidator._formats.miniReelGroups).toEqual(['object']);

            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(svc._middleware.create).toContain(campModule.getAccountIds,
                campModule.createSponsoredCamps, campModule.createTargetCamps);
            expect(svc._middleware.edit).toContain(campModule.getAccountIds, campModule.createSponsoredCamps,
                campModule.createTargetCamps, campModule.editTargetCamps);
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
            expect(svc.formatOutput).toBe(campModule.formatOutput);
        });
    });
    
    describe('formatOutput', function() {
        it('should correctly format an object for the client', function() {
            spyOn(CrudSvc.prototype, 'formatOutput').andCallThrough();
            var campaign = {
                _id: 'ekejrh', id: 'cam-1', name: 'camp 1', advertiserId: 'a-1', customerId: 'cu-1',
                cards: [{id: 'rc-1', adtechId: 12}, {id: 'rc-2', adtechId: 23}],
                miniReels: [{id: 'e-1', adtechId: 34}, {id: 'e-2', adtechId: 45}],
                miniReelGroups: [
                    { adtechId: 1234, cards: ['rc-1', 'rc-2'], miniReels: [{id: 'e-11', adtechId: 56}, {id: 'e-12', adtechId: 67}] },
                    { adtechId: 4567, cards: ['rc-1'] },
                ]
            };
            
            expect(campModule.formatOutput('mockSvc', campaign)).toEqual({
                id: 'cam-1', name: 'camp 1', advertiserId: 'a-1', customerId: 'cu-1',
                cards: ['rc-1', 'rc-2'],
                miniReels: ['e-1', 'e-2'],
                miniReelGroups: [
                    { adtechId: 1234, cards: ['rc-1', 'rc-2'], miniReels: ['e-11', 'e-12'] },
                    { adtechId: 4567, cards: ['rc-1'] }
                ]
            });
            
            expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(campaign);
        });
    });
    
    describe('getAccountIds', function() {
        var svc, req;
        beforeEach(function() {
            req = { uuid: '1234', body: { advertiserId: 'a-1', customerId: 'cu-1' } };
            svc = {
                _advertColl: {
                    findOne: jasmine.createSpy('advertColl.findOne').andCallFake(function(query, fields, cb) {
                        if (query.id === 'a-1') cb(null, {id: 'a-1', adtechId: 123});
                        else if (query.id === 'a-bad') cb('ADVERTS GOT A PROBLEM');
                        else cb();
                    })
                },
                _custColl: {
                    findOne: jasmine.createSpy('custColl.findOne').andCallFake(function(query, fields, cb) {
                        if (query.id === 'cu-1') cb(null, {id: 'cu-1', adtechId: 456});
                        else if (query.id === 'cu-bad') cb('CUSTS GOT A PROBLEM');
                        else cb();
                    })
                }
            };
        });
        
        it('should lookup the advertiser and customer', function(done) {
            campModule.getAccountIds(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._advertiserId).toBe(123);
                expect(req._customerId).toBe(456);
                expect(svc._advertColl.findOne).toHaveBeenCalledWith({id: 'a-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                expect(svc._custColl.findOne).toHaveBeenCalledWith({id: 'cu-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                done();
            });
        });
        
        it('should call done if one of the two is not found', function(done) {
            var req1 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-1', customerId: 'cu-2' } },
                req2 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-2', customerId: 'cu-1' } };
            campModule.getAccountIds(svc, req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.getAccountIds(svc, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.length).toBe(2);
                expect(doneSpy.calls[0].args).toEqual([{code: 400, body: 'customer cu-2 does not exist'}]);
                expect(doneSpy.calls[1].args).toEqual([{code: 400, body: 'advertiser a-2 does not exist'}]);
                expect(mockLog.warn.calls.length).toBe(2);
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
            campModule.getAccountIds(svc, req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.getAccountIds(svc, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy.calls.length).toBe(2);
                expect(errorSpy.calls[0].args).toEqual([new Error('Mongo error')]);
                expect(errorSpy.calls[1].args).toEqual([new Error('Mongo error')]);
                expect(mockLog.error.calls.length).toBe(2);
                done();
            });
        });
    });
    
    /*
    describe('makeSponsoredCamps', function() {
        var cats, objs;
        beforeEach(function() {
            objs = [{id: 'rc-1'}, {id: 'rc-2', adtechId: 12}, {id: 'rc-3'}];
            cats = ['food', 'sports'];
            adtech.campaignAdmin.createCampaign.andCallFake(function() {
                return q({id: String(this.createCampaign.calls.length*1000)});
            });
        });
        
        it('should create any necessary campaigns', function(done) {
            campModule.makeSponsoredCamps('cam-1', objs, 'miniReel', cats, 987, 876).then(function() {
                expect(objs).toEqual([{id: 'rc-1', adtechId: 1000}, {id: 'rc-2', adtechId: 12},
                    {id: 'rc-3', adtechId: 2000}]);
                expect(campaignUtils.makeKeywords.calls.length).toBe(1);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['food', 'sports']);
                expect(campaignUtils.formatCampaign.calls.length).toBe(2);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({id: 'rc-1', name: 'cam-1_miniReel_rc-1',
                    advertiserId: 987, customerId: 876, created: jasmine.any(Date)}, {level3: [100, 200]}, true);
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({id: 'rc-3', name: 'cam-1_miniReel_rc-3',
                    advertiserId: 987, customerId: 876, created: jasmine.any(Date)}, {level3: [100, 200]}, true);
                expect(adtech.campaignAdmin.createCampaign.calls.length).toBe(2);
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: true});
                expect(campaignUtils.createBanners.calls.length).toBe(2);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-1', adtechId: 1000}], null, 'miniReel', 1000);
                expect(campaignUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-3', adtechId: 2000}], null, 'miniReel', 2000);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should add the campaign id as a level 1 keyword if the type is card', function(done) {
            campModule.makeSponsoredCamps('cam-1', objs, 'card', cats, 987, 876).then(function() {
                expect(objs).toEqual([{id: 'rc-1', adtechId: 1000}, {id: 'rc-2', adtechId: 12},
                    {id: 'rc-3', adtechId: 2000}]);
                expect(campaignUtils.makeKeywords.calls.length).toBe(2);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['food', 'sports']);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['cam-1']);
                expect(campaignUtils.formatCampaign.calls[0].args[1]).toEqual({level1: [300], level3: [100, 200]});
                expect(campaignUtils.formatCampaign.calls[1].args[1]).toEqual({level1: [300], level3: [100, 200]});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if there are not objects to make campaigns of', function(done) {
            return q.all([campModule.makeSponsoredCamps('cam-1', {foo: 'bar'}, 'card', cats, 987, 876),
                          campModule.makeSponsoredCamps('cam-1', [], 'card', cats, 987, 876)]).then(function() {
                expect(campaignUtils.makeKeywords).not.toHaveBeenCalled();
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if making keywords fails', function(done) {
            campaignUtils.makeKeywords.andReturn(q.reject('I GOT A PROBLEM'));
            campModule.makeSponsoredCamps('cam-1', objs, 'card', cats, 987, 876).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywords.calls.length).toBe(1);
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.createBanners).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if creating a campaign fails', function(done) {
            adtech.campaignAdmin.createCampaign.andCallFake(function() {
                if (this.createCampaign.calls.length > 1) return q.reject('I GOT A PROBLEM');
                else return q({id: this.createCampaign.calls.length*1000});
            });
            campModule.makeSponsoredCamps('cam-1', objs, 'card', cats, 987, 876).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(adtech.campaignAdmin.createCampaign.calls.length).toBe(2);
                expect(campaignUtils.createBanners.calls.length).toBe(1);
            }).done(done);
        });
        
        it('should reject if creating banners fails', function(done) {
            adtech.campaignAdmin.createCampaign.andCallFake(function() {
                if (this.createCampaign.calls.length > 1) return q.reject('I GOT A PROBLEM');
                else return q({id: this.createCampaign.calls.length*1000});
            });
            campModule.makeSponsoredCamps('cam-1', objs, 'card', cats, 987, 876).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campaignUtils.createBanners.calls.length).toBe(1);
            }).done(done);
        });
    });
    */
    
    describe('createSponsoredCamps', function() {
        beforeEach(function() {
            spyOn(campaignUtils, 'makeKeywordLevels').andReturn(q({ keys: 'yes' }));
            spyOn(campaignUtils, 'createCampaign').andCallFake(function() {
                return q({id: String(this.createCampaign.calls.length*1000)});
            });
            req.body = { id: 'cam-1', miniReels: ['e-1'], cards: ['rc-1', 'rc-2'] };
            req._advertiserId = 123;
            req._customerId = 456;
        });
        
        it('should create sponsored card and minireel campaigns', function(done) {
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1', adtechId: 1000}]);
                expect(req.body.cards).toEqual([{id: 'rc-1', adtechId: 2000}, {id: 'rc-2', adtechId: 3000}]);
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: []});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: []});
                //expect(campModule.makeSponsoredCamps.calls.length).toBe(2);
                //expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[{id:'e-1'}],'miniReel',[],123,456);
                //expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[{id:'rc-1'},{id:'rc-2'}],'card',[],123,456);
                done();
            });
        });
        
        xit('should be able to set categories', function(done) {
            req.body.categories = ['food', 'sports'];
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.makeSponsoredCamps.calls[0].args[3]).toEqual(['food', 'sports']);
                expect(campModule.makeSponsoredCamps.calls[1].args[3]).toEqual(['food', 'sports']);
                done();
            });
        });
        
        xit('should only make campaigns for new content if this is an existing campaign', function(done) {
            req.origObj = { id: 'cam-1', miniReels: [{id: 'e-1', adtechId: 12}], categories: ['food'],
                            cards: [{id: 'rc-1', adtechId: 23}, {id: 'rc-2', adtechId: 34}] };
            req.body = { miniReels: ['e-1'], cards: ['rc-1', 'rc-3'] };
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1', adtechId: 12}]);
                expect(req.body.cards).toEqual([{id: 'rc-1', adtechId: 23}, {id: 'rc-3'}]);
                expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[{id: 'e-1', adtechId: 12}],'miniReel',['food'],123,456);
                expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[{id: 'rc-1', adtechId: 23},
                    {id: 'rc-3'}],'card',['food'],123,456);
                done();
            });
        });
        
        xit('should initialize undefined card or minireel lists to empty arrays', function(done) {
            req.body = { id: 'cam-1' };
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([]);
                expect(req.body.cards).toEqual([]);
                expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[],'miniReel',[],123,456);
                expect(campModule.makeSponsoredCamps).toHaveBeenCalledWith('cam-1',[],'card',[],123,456);
                done();
            });
        });
        
        xit('should fail if one of the adtech calls fails', function(done) {
            campModule.makeSponsoredCamps.andCallFake(function(id, objs, type, cats, advert, cust) {
                if (type === 'card') return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                done();
            });
        });
    });
    
    xdescribe('createTargetCamps', function() {
        beforeEach(function() {
            req.body = { id: 'cam-1', miniReelGroups: [
                { cards: ['rc-1', 'rc-2'], miniReels: ['e-1'] },
                { cards: ['rc-3'], miniReels: ['e-2', 'e-3'] }
            ]};
            req._advertiserId = 123;
            req._customerId = 456;
            adtech.campaignAdmin.createCampaign.andCallFake(function() {
                return q({id: String(this.createCampaign.calls.length*1000)});
            });
        });
        
        it('should skip if there are no miniReelGroups', function(done) {
            delete req.body.miniReelGroups;
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywords).not.toHaveBeenCalled();
                expect(adtech.campaignAdmin.createCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        /*
                { cards: [], miniReels: ['e-1'] },
                { miniReels: ['e-1'] },
                { cards: ['rc-1'], miniReels: [] },
        */
        
        it('should create target minireel campaigns', function(done) {
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                //TODO
                expect(campaignUtils.makeKeywords.calls.length).toBe(2);
                expect(campaignUtils.makeKeywords.calls[0].args).toEqual([['rc-1', 'rc-2']]);
                expect(campaignUtils.makeKeywords.calls[1].args).toEqual([['rc-3']]);

                done();
            });
        });
    });
    
    describe('editTargetCamps', function() {
        //TODO
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

