var flush = true;
describe('ads-externalCampaigns beeswax (UT)', function() {
    var util, mockLog, CrudSvc, Model, MiddleManager, logger, q, beesCamps, objUtils, JobManager,
        express, nextSpy, doneSpy, errorSpy, req, mockBeeswax, mockDb, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        util            = require('util');
        express         = require('express');
        logger          = require('../../lib/logger');
        beesCamps       = require('../../bin/ads-externalCampaigns/beeswax');
        CrudSvc         = require('../../lib/crudSvc');
        MiddleManager   = require('../../lib/middleManager');
        JobManager      = require('../../lib/jobManager');
        Model           = require('../../lib/model');
        objUtils        = require('../../lib/objUtils');
        authUtils       = require('../../lib/authUtils');
        Scope           = require('../../lib/enums').Scope;

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
        
        beesCamps.config = {
            api: {
                root: 'http://c6.com',
                campaigns: {
                    endpoint: '/api/campaigns',
                    baseUrl: 'http://c6.com/api/campaigns'
                },
                orgs: {
                    endpoint: '/api/account/orgs',
                    baseUrl: 'http://c6.com/api/account/orgs'
                }
            },
            beeswax: {
                impressionRatio: 1.3333
            }
        };
        
        mockBeeswax = { campaigns: {
            create: jasmine.createSpy('beeswax.campaigns.create()'),
            edit: jasmine.createSpy('beeswax.campaigns.edit()'),
        } };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        
        req = { uuid: '1234', requester: { id: 'u-1' }, params: { c6Id: 'cam-1' } };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });

    describe('setupSvc', function() {
        var svc, config, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

        beforeEach(function() {
            config = { api: {
                root: 'http://foo.com',
                campaigns: {
                    endpoint: '/api/campaigns',
                },
                orgs: {
                    endpoint: '/api/account/orgs',
                }
            } };
            
            boundFns = [];
            [beesCamps.validateBody, CrudSvc.fetchRelatedEntity, beesCamps.syncCampaigns].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = Function.prototype.bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });

            svc = beesCamps.setupSvc(mockDb, config, mockBeeswax);
        });

        it('should return a MiddleManager', function() {
            expect(svc).toEqual(jasmine.any(MiddleManager));
            expect(svc._db).toBe(mockDb);
            expect(svc.beeswax).toBe(mockBeeswax);
        });
        
        it('should setup a bound syncCampaigns method', function() {
            expect(svc.syncCampaigns).toEqual(getBoundFn(beesCamps.syncCampaigns, [beesCamps, svc]));
        });
        
        it('should fetch the campaign on create + edit', function() {
            var fetchCamp = getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'campaigns',
                idPath: 'params.c6Id'
            }, beesCamps.config.api]);
            expect(svc._middleware.create).toContain(fetchCamp);
            expect(svc._middleware.edit).toContain(fetchCamp);
        });
        
        it('should fetch the advertiser + ensure the beeswax advertiser on create, edit, and syncCampaigns', function() {
            var fetchAdvert = getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'advertisers',
                idPath: ['campaign.advertiserId', 'origObj.advertiserId']
            }, beesCamps.config.api]);
            expect(svc._middleware.create).toContain(fetchAdvert);
            expect(svc._middleware.edit).toContain(fetchAdvert);
            expect(svc._middleware.syncCampaigns).toContain(fetchAdvert);
            expect(svc._middleware.create).toContain(beesCamps.ensureBeeswaxAdvert);
            expect(svc._middleware.edit).toContain(beesCamps.ensureBeeswaxAdvert);
            expect(svc._middleware.syncCampaigns).toContain(beesCamps.ensureBeeswaxAdvert);
        });
        
        it('should check if the requester can edit the campaign on create + edit', function() {
            expect(svc._middleware.create).toContain(beesCamps.canEditCampaign);
            expect(svc._middleware.edit).toContain(beesCamps.canEditCampaign);
        });
        
        it('should validate the body on create + edit', function() {
            expect(svc._middleware.create).toContain(getBoundFn(beesCamps.validateBody, [beesCamps, 'create']));
            expect(svc._middleware.edit).toContain(getBoundFn(beesCamps.validateBody, [beesCamps, 'edit']));
        });
    });
    
    describe('externalCampaigns entry validation', function() {
        var model, newObj, origObj, requester;
        beforeEach(function() {
            model = new Model('beeswaxCampaign', beesCamps.schema);
            newObj = {};
            origObj = {};
            requester = { fieldValidation: {} };
        });
        
        describe('when handling externalId', function() {
            it('should trim the field if set', function() {
                newObj.externalId = 1234;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.externalId).not.toBeDefined();
            });
        });
        
        ['budget', 'dailyLimit'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a number', function() {
                    newObj[field] = 'many dollars';
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: number' });
                });
                
                it('should allow the field to be set', function() {
                    newObj[field] = 100;
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(100);
                });

                it('should fail if the value is too small', function() {
                    newObj[field] = -666;
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be greater than the min: 0' });
                });
            });
        });
    });
    
    describe('chooseStartDate', function() {
        var campaign;
        beforeEach(function() {
            campaign = {
                id: 'cam-1',
                name: 'my camp',
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-05-10T23:00:34.012Z' } },
                    { id: 'rc-2', campaign: { endDate: '2016-03-10T23:00:34.012Z' } },
                    { id: 'rc-3', campaign: { startDate: '2016-04-10T23:00:34.012Z' } }
                ]
            };
        });
        
        it('should use the oldest card startDate from the new campaign', function() {
            expect(beesCamps.chooseStartDate(campaign)).toEqual(new Date('2016-04-10T23:00:34.012Z'));
        });
        
        it('should handle a campaign with no cards', function() {
            campaign.cards = [];
            expect(beesCamps.chooseStartDate(campaign)).toBe(undefined);
            delete campaign.cards;
            expect(beesCamps.chooseStartDate(campaign)).toBe(undefined);
        });
    });
    
    describe('formatBeeswaxBody', function() {
        var campaign, extCampEntry;
        beforeEach(function() {
            req.advertiser = {
                id: 'a-1',
                beeswaxIds: { advertiser: 1111 }
            };
            campaign = {
                id: 'cam-1',
                name: 'brand new campaign',
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-05-10T23:00:34.012Z' } },
                    { id: 'rc-2', campaign: { endDate: '2016-03-10T23:00:34.012Z' } },
                    { id: 'rc-3', campaign: { startDate: '2016-04-10T23:00:34.012Z' } }
                ],
                pricing: {
                    budget: 20000,
                    dailyLimit: 2000
                }
            };
            extCampEntry = {
                externalId: 5555,
                budget: 10000,
                dailyLimit: 1000
            };
        });
        
        it('should format + return a Beeswax campaign body', function() {
            var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
            expect(beesBody).toEqual({
                advertiser_id   : 1111,
                alternative_id  : 'cam-1',
                campaign_name   : 'brand new campaign',
                budget_type     : 1,
                start_date      : new Date('2016-04-10T23:00:34.012Z'),
                campaign_budget : jasmine.any(Number),
                daily_budget    : jasmine.any(Number)
            });
        });
        
        it('should have a default if no name is defined on the campaign', function() {
            delete campaign.name;
            var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
            expect(beesBody.campaign_name).toBe('Untitled (cam-1)');
        });
        
        it('should leave the start_date undefined if the campaign has no cards', function() {
            delete campaign.cards;
            var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
            expect(beesBody.start_date).not.toBeDefined();
        });
        
        describe('when setting the campaign_budget', function() {
            it('should use the externalCampaigns entry budget, multiplied by an impression ratio', function() {
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.campaign_budget.toFixed(6))).toBe(13333);
            });
            
            it('should cap the new budget to the campaign\'s budget', function() {
                extCampEntry.budget = 66666;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.campaign_budget.toFixed(6))).toBe(26666);
            });
            
            it('should default the new budget to the campaign\'s budget', function() {
                delete extCampEntry.budget;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.campaign_budget.toFixed(6))).toBe(26666);
            });
            
            it('should ensure the the budget is set to some low value if the campaign does not have a budget', function() {
                delete campaign.pricing;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.campaign_budget.toFixed(6))).toBe(1.33);
            });
        });
        
        describe('when setting the daily_budget', function() {
            it('should use the externalCampaigns entry dailyLimit, multiplied by an impression ratio', function() {
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.daily_budget.toFixed(6))).toBe(1333.3);
            });
            
            it('should cap the new dailyLimit to the campaign\'s dailyLimit', function() {
                extCampEntry.dailyLimit = 6666;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.daily_budget.toFixed(6))).toBe(2666.6);
            });
            
            it('should default the new dailyLimit to the campaign\'s dailyLimit', function() {
                delete extCampEntry.dailyLimit;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.daily_budget.toFixed(6))).toBe(2666.6);
            });
            
            it('should cap the dailyLimit to the campaign budget', function() {
                extCampEntry.budget = 100;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(Number(beesBody.campaign_budget.toFixed(6))).toBe(133.33);
                expect(Number(beesBody.daily_budget.toFixed(6))).toBe(133.33);
            });
            
            it('should permit setting the new dailyLimit to null if the dailyLimit on the campaign is null', function() {
                extCampEntry.dailyLimit = null;
                campaign.pricing.dailyLimit = null;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(beesBody.daily_budget).toBe(null);
                
                delete campaign.pricing;
                delete extCampEntry.dailyLimit;
                var beesBody = beesCamps.formatBeeswaxBody(campaign, extCampEntry, req);
                expect(beesBody.daily_budget).toBe(null);
            });
        });
    });
    
    describe('updateExtCampPricing', function() {
        var extCampEntry, beesBody;
        beforeEach(function() {
            extCampEntry = {
                externalId: 1234,
                budget: 1000,
                dailyLimit: 100
            };
            beesBody = {
                campaign_id: 1234,
                campaign_budget: 2666.6,
                daily_budget: 266.66
            };
        });
        
        it('should reset the budget + dailyLimit on the extCampEntry', function() {
            beesCamps.updateExtCampPricing(extCampEntry, beesBody);
            expect(extCampEntry).toEqual({
                externalId: 1234,
                budget: 2000,
                dailyLimit: 200
            });
            expect(beesBody).toEqual({
                campaign_id: 1234,
                campaign_budget: 2666.6,
                daily_budget: 266.66
            });
        });
        
        it('should handle null values', function() {
            resps = [];
            ['campaign_budget', 'daily_budget'].forEach(function(field) {
                var newExtCampEntry = JSON.parse(JSON.stringify(extCampEntry)),
                    newBeesBody = JSON.parse(JSON.stringify(beesBody));
                    
                newBeesBody[field] = null;
                resps.push(newExtCampEntry);
                beesCamps.updateExtCampPricing(newExtCampEntry, newBeesBody);
            });
            
            expect(resps[0]).toEqual({ externalId: 1234, budget: null, dailyLimit: 200 });
            expect(resps[1]).toEqual({ externalId: 1234, budget: 2000, dailyLimit: null });
        });
        
        it('should round away slight math errors', function() {
            beesBody.campaign_budget = 2666.59999999;
            beesBody.daily_budget = 266.660000001;
            beesCamps.updateExtCampPricing(extCampEntry, beesBody);
            expect(extCampEntry).toEqual({
                externalId: 1234,
                budget: 2000,
                dailyLimit: 200
            });
        });
    });
    
    describe('ensureBeeswaxAdvert', function() {
        beforeEach(function() {
            req.advertiser = {
                id: 'a-1',
                beeswaxIds: { advertiser: 1234 }
            };
        });
        
        it('should call next if the fetched advertiser has a beeswax id', function() {
            beesCamps.ensureBeeswaxAdvert(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    
        it('should call done if the fetched advertiser does not have a beeswax id', function() {
            delete req.advertiser.beeswaxIds;
            beesCamps.ensureBeeswaxAdvert(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Must create beeswax advertiser for a-1' });
        });
    });
    
    describe('canEditCampaign', function() {
        beforeEach(function() {
            req.campaign = {
                id: 'cam-1',
                user: 'u-99',
                org: 'o-1'
            };
            req.requester.permissions = { campaigns: {
                read: Scope.All,
                edit: Scope.Org
            } };
            req.user = { id: 'u-1', org: 'o-1' };
            spyOn(CrudSvc, 'checkScope').and.callThrough();
        });
        
        it('should call next if the requester has permission to edit the campaign', function() {
            beesCamps.canEditCampaign(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    
        it('should call done if the requester does not have permission to edit the campaign', function() {
            req.user.org = 'o-66';
            beesCamps.canEditCampaign(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to edit this campaign' });
        });
    });
    
    describe('validateBody', function() {
        beforeEach(function() {
            req.body = {
                externalId: 1234,
                budget: 1000,
                dailyLimit: 100
            };
            req.campaign = {
                id: 'cam-1',
                user: 'u-99',
                org: 'o-1'
            };
        });
        
        it('should call next if the body is valid', function() {
            beesCamps.validateBody('create', req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual({ budget: 1000, dailyLimit: 100 });
        });
        
        it('should pass in the old externalCampaigns entry if it exists', function() {
            req.campaign.externalCampaigns = {
                beeswax: { externalId: 5678, budget: 200, dailyLimit: 20 }
            };
            beesCamps.validateBody('create', req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual({ externalId: 5678, budget: 1000, dailyLimit: 100 });
        });
    
        it('should call done if the body is not valid', function() {
            req.body.budget = 'one MILLION dollars';
            beesCamps.validateBody('create', req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'budget must be in format: number' });
        });
    });
    
    describe('createBeeswaxCamp', function() {
        var svc, beesResp, mockColl;
        beforeEach(function() {
            mockColl = {
                findOneAndUpdate: jasmine.createSpy('coll.findOneAndUpdate()').and.returnValue(q())
            };
            mockDb.collection.and.returnValue(mockColl);
            svc = {
                _db: mockDb,
                beeswax: mockBeeswax,
                runAction: jasmine.createSpy('svc.runAction()').and.callFake(function(req, action, cb) {
                    return cb();
                })
            };
            beesResp = {
                success: true,
                payload: {
                    campaign_id: 1234,
                    campaign_budget: 1333.3,
                    daily_budget: 133.33
                }
            };
            mockBeeswax.campaigns.create.and.callFake(function() { return q(beesResp); });
            spyOn(beesCamps, 'formatBeeswaxBody').and.callFake(function(campaign, extCampEntry, req) {
                return {
                    campaign_budget: extCampEntry.budget * beesCamps.config.beeswax.impressionRatio,
                    daily_budget: extCampEntry.dailyLimit * beesCamps.config.beeswax.impressionRatio,
                    start_date: beesCamps.chooseStartDate(campaign)
                };
            });
            req.campaign = {
                id: 'cam-1',
                name: 'my camp',
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-05-10T23:00:34.012Z' } },
                ]
            };
            req.body = { budget: 6666, dailyLimit: 666 };
        });
        
        it('should create a beeswax campaign and then update the C6 campaign accordingly', function(done) {
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: { externalId: 1234, budget: 1000, dailyLimit: 100 }
                });
                expect(svc.runAction).toHaveBeenCalledWith(req, 'create', jasmine.any(Function));
                expect(beesCamps.formatBeeswaxBody).toHaveBeenCalledWith(req.campaign, jasmine.any(Object), req);
                expect(mockBeeswax.campaigns.create).toHaveBeenCalledWith({
                    campaign_budget: 8887.7778,
                    daily_budget: 887.9778,
                    start_date: new Date('2016-05-10T23:00:34.012Z'),
                    active: false
                });
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith({ id: 'cam-1' }, jasmine.any(Object), jasmine.any(Object));
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[1]).toEqual({ $set: {
                    lastUpdated: jasmine.any(Date),
                    'externalCampaigns.beeswax': { externalId: 1234, budget: 1000, dailyLimit: 100 }
                } });
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[2])
                    .toEqual({ w: 1, j: true, returnOriginal: false, sort: { id: 1 } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default the start_date if no cards exist on the campaign', function(done) {
            delete req.campaign.cards;
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: { externalId: 1234, budget: 1000, dailyLimit: 100 }
                });
                expect(beesCamps.formatBeeswaxBody).toHaveBeenCalledWith(req.campaign, jasmine.any(Object), req);
                expect(mockBeeswax.campaigns.create).toHaveBeenCalledWith({
                    campaign_budget: 8887.7778,
                    daily_budget: 887.9778,
                    start_date: jasmine.any(Date),
                    active: false
                });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the campaign already has a beesax campaign', function(done) {
            req.campaign.externalCampaigns = {
                beeswax: { externalId: 7890, budget: 123, dailyLimit: 45 }
            };
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'Campaign already has beeswax campaign'
                });
                expect(svc.runAction).toHaveBeenCalled();
                expect(mockBeeswax.campaigns.create).not.toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should skip campaign creation/updates if svc.runAction returns early', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'i cant EVEN' }));
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'i cant EVEN'
                });
                expect(mockBeeswax.campaigns.create).not.toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and return a 4xx if beeswax returns an unsuccessful response', function(done) {
            beesResp = { success: false, code: 406, message: 'i dunno somethings wack' };
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 406,
                    body: 'Could not create beeswax campaign'
                });
                expect(mockBeeswax.campaigns.create).toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('i dunno somethings wack');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if creating the Beeswax campaign fails', function(done) {
            beesResp = q.reject('More like BeesNOPE');
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error creating Beeswax campaign');
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('More like BeesNOPE'));
            }).done(done);
        });
        
        it('should reject if editing the C6 campaign fails', function(done) {
            mockColl.findOneAndUpdate.and.returnValue(q.reject('More like MongNO'));
            beesCamps.createBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error creating Beeswax campaign');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('More like MongNO'));
            }).done(done);
        });
    });
    
    describe('editBeeswaxCamp', function() {
        var svc, beesResp, mockColl;
        beforeEach(function() {
            mockColl = {
                findOneAndUpdate: jasmine.createSpy('coll.findOneAndUpdate()').and.returnValue(q())
            };
            mockDb.collection.and.returnValue(mockColl);
            svc = {
                _db: mockDb,
                beeswax: mockBeeswax,
                runAction: jasmine.createSpy('svc.runAction()').and.callFake(function(req, action, cb) {
                    return cb();
                })
            };
            beesResp = {
                success: true,
                payload: {
                    campaign_id: 7890,
                    campaign_budget: 1333.3,
                    daily_budget: 133.33
                }
            };
            mockBeeswax.campaigns.edit.and.callFake(function() { return q(beesResp); });
            spyOn(beesCamps, 'formatBeeswaxBody').and.callFake(function(campaign, extCampEntry, req) {
                return {
                    campaign_budget: extCampEntry.budget * beesCamps.config.beeswax.impressionRatio,
                    daily_budget: extCampEntry.dailyLimit * beesCamps.config.beeswax.impressionRatio,
                };
            });
            req.campaign = {
                id: 'cam-1',
                externalCampaigns: {
                    beeswax: { externalId: 7890, budget: 20000, dailyLimit: 2000 }
                }
            };
            req.body = { budget: 6666, dailyLimit: 666 };
        });
        
        it('should edit a beeswax campaign and then update the C6 campaign accordingly', function(done) {
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { externalId: 7890, budget: 1000, dailyLimit: 100 }
                });
                expect(svc.runAction).toHaveBeenCalledWith(req, 'edit', jasmine.any(Function));
                expect(beesCamps.formatBeeswaxBody).toHaveBeenCalledWith(req.campaign, jasmine.any(Object), req);
                expect(mockBeeswax.campaigns.edit).toHaveBeenCalledWith(7890, { campaign_budget: 8887.7778, daily_budget: 887.9778 });
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith({ id: 'cam-1' }, jasmine.any(Object), jasmine.any(Object));
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[1]).toEqual({ $set: {
                    lastUpdated: jasmine.any(Date),
                    'externalCampaigns.beeswax': { externalId: 7890, budget: 1000, dailyLimit: 100 }
                } });
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[2])
                    .toEqual({ w: 1, j: true, returnOriginal: false, sort: { id: 1 } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a request body that is missing the budget and/or dailyLimit', function(done) {
            req.body = {};
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { externalId: 7890, budget: 1000, dailyLimit: 100 }
                });
                expect(svc.runAction).toHaveBeenCalledWith(req, 'edit', jasmine.any(Function));
                expect(beesCamps.formatBeeswaxBody).toHaveBeenCalledWith(req.campaign, jasmine.any(Object), req);
                expect(mockBeeswax.campaigns.edit).toHaveBeenCalledWith(7890, { campaign_budget: 26666, daily_budget: 2666.6 });
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith({ id: 'cam-1' }, jasmine.any(Object), jasmine.any(Object));
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[1]).toEqual({ $set: {
                    lastUpdated: jasmine.any(Date),
                    'externalCampaigns.beeswax': { externalId: 7890, budget: 1000, dailyLimit: 100 }
                } });
                expect(mockColl.findOneAndUpdate.calls.mostRecent().args[2])
                    .toEqual({ w: 1, j: true, returnOriginal: false, sort: { id: 1 } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the campaign has no beesax campaign', function(done) {
            delete req.campaign.externalCampaigns;
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'Campaign has no beeswax campaign'
                });
                expect(svc.runAction).toHaveBeenCalled();
                expect(mockBeeswax.campaigns.edit).not.toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should skip campaign updates if svc.runAction returns early', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'i cant EVEN' }));
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'i cant EVEN'
                });
                expect(mockBeeswax.campaigns.edit).not.toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and return a 4xx if beeswax returns an unsuccessful response', function(done) {
            beesResp = { success: false, code: 406, message: 'i dunno somethings wack' };
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 406,
                    body: 'Could not edit beeswax campaign'
                });
                expect(mockBeeswax.campaigns.edit).toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('i dunno somethings wack');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if editing the Beeswax campaign fails', function(done) {
            beesResp = q.reject('More like BeesNOPE');
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error editing Beeswax campaign');
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('More like BeesNOPE'));
            }).done(done);
        });
        
        it('should reject if editing the C6 campaign fails', function(done) {
            mockColl.findOneAndUpdate.and.returnValue(q.reject('More like MongNO'));
            beesCamps.editBeeswaxCamp(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error editing Beeswax campaign');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('More like MongNO'));
            }).done(done);
        });
    });
    
    describe('syncCampaigns', function() {
        var svc, beesResp;
        beforeEach(function() {
            svc = {
                beeswax: mockBeeswax,
                runAction: jasmine.createSpy('svc.runAction()').and.callFake(function(req, action, cb) {
                    return cb();
                })
            };
            beesResp = {
                success: true,
                payload: {
                    campaign_id: 7890
                }
            };
            mockBeeswax.campaigns.edit.and.callFake(function() { return q(beesResp); });
            req.body = {
                id: 'cam-1',
                name: 'brand new campaign',
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-05-10T23:00:34.012Z' } }
                ]
            };
            req.origObj = {
                id: 'cam-1',
                name: 'ye olde campaign',
                externalCampaigns: {
                    beeswax: { externalId: 7890, budget: 20000, dailyLimit: 2000 }
                },
                cards: [
                    { id: 'rc-1', campaign: { startDate: '2016-03-07T23:00:34.012Z' } }
                ]
            };
        });
        
        it('should edit a beeswax campaign', function(done) {
            beesCamps.syncCampaigns(svc, req).then(function(resp) {
                expect(resp).toEqual({ externalId: 7890, budget: 20000, dailyLimit: 2000 });
                expect(svc.runAction).toHaveBeenCalledWith(req, 'syncCampaigns', jasmine.any(Function));
                expect(mockBeeswax.campaigns.edit).toHaveBeenCalledWith(7890, {
                    campaign_name: 'brand new campaign',
                    start_date: new Date('2016-05-10T23:00:34.012Z')
                });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still do the edit if only the name or the start_date has changed', function(done) {
            q.all(['name', 'cards'].map(function(prop) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body[prop] = reqCopy.origObj[prop];
                return beesCamps.syncCampaigns(svc, reqCopy);
            })).then(function(results) {
                expect(results[0]).toEqual({ externalId: 7890, budget: 20000, dailyLimit: 2000 });
                expect(results[1]).toEqual({ externalId: 7890, budget: 20000, dailyLimit: 2000 });
                expect(mockBeeswax.campaigns.edit.calls.count()).toBe(2);
                expect(mockBeeswax.campaigns.edit.calls.argsFor(0)).toEqual([7890, {
                    campaign_name: 'ye olde campaign',
                    start_date: new Date('2016-05-10T23:00:34.012Z')
                }]);
                expect(mockBeeswax.campaigns.edit.calls.argsFor(1)).toEqual([7890, {
                    campaign_name: 'brand new campaign',
                    start_date: new Date('2016-03-07T23:00:34.012Z')
                }]);
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if neither name nor start_date have not changed', function(done) {
            req.body.name = 'ye olde campaign';
            delete req.body.cards;
            beesCamps.syncCampaigns(svc, req).then(function(resp) {
                expect(resp).toEqual({ externalId: 7890, budget: 20000, dailyLimit: 2000 });
                expect(svc.runAction).toHaveBeenCalled();
                expect(mockBeeswax.campaigns.edit).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should skip campaign updates if svc.runAction returns early', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'i cant EVEN' }));
            beesCamps.syncCampaigns(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'i cant EVEN'
                });
                expect(mockBeeswax.campaigns.edit).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and return a 4xx if beeswax returns an unsuccessful response', function(done) {
            beesResp = { success: false, code: 406, message: 'i dunno somethings wack' };
            beesCamps.syncCampaigns(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 406,
                    body: 'Could not edit beeswax campaign'
                });
                expect(mockBeeswax.campaigns.edit).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('i dunno somethings wack');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if editing the Beeswax campaign fails', function(done) {
            beesResp = q.reject('More like BeesNOPE');
            beesCamps.syncCampaigns(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error editing Beeswax campaign');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('More like BeesNOPE'));
            }).done(done);
        });
    });
    
    describe('setupEndpoints', function() {
        var app, svc, sessions, audit, mockRouter, expressRoutes, authMidware, res, jobManager;
        beforeEach(function() {
            mockRouter = {};
            expressRoutes = {};
            ['post', 'put'].forEach(function(verb) {
                expressRoutes[verb] = {};
                mockRouter[verb] = jasmine.createSpy('router.' + verb).and.callFake(function(route/*, middleware...*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes[verb][route] = (expressRoutes[verb][route] || []).concat(middleware);
                });
            });
            mockRouter.use = jasmine.createSpy('router.use()');
            spyOn(express, 'Router').and.returnValue(mockRouter);
            
            var authMidware = {
                edit: 'fakeEditMidware'
            };
            spyOn(authUtils, 'crudMidware').and.returnValue(authMidware);

            app = { use: jasmine.createSpy('app.use()') };
            svc = beesCamps.setupSvc(mockDb, beesCamps.config, mockBeeswax);
            sessions = 'sessionsMidware';
            audit = 'auditMidware';

            jobManager = new JobManager('fakeCache', {});
            spyOn(jobManager.setJobTimeout, 'bind').and.returnValue(jobManager.setJobTimeout);
            spyOn(jobManager, 'endJob').and.returnValue(q());

            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
            
            beesCamps.setupEndpoints(app, svc, sessions, audit, jobManager);
        });
        
        it('should create a router and attach it to the app', function() {
            expect(express.Router).toHaveBeenCalled();
            expect(mockRouter.use).toHaveBeenCalledWith(jobManager.setJobTimeout);
            expect(app.use).toHaveBeenCalledWith('/api/campaigns/:c6Id/external/beeswax', mockRouter);
        });

        it('should call authUtils.crudMidware to get a set of auth middleware', function() {
            expect(authUtils.crudMidware).toHaveBeenCalledWith('campaigns', { allowApps: true });
        });

        describe('creates a handler for POST /api/campaigns/:c6Id/external/beeswax/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.post).toHaveBeenCalledWith('/', 'sessionsMidware', 'fakeEditMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/'][expressRoutes.post['/'].length - 1];
                    spyOn(beesCamps, 'createBeeswaxCamp').and.returnValue(q({
                        code: 200,
                        body: { externalId: 1234, budget: 1000 }
                    }));
                });
                
                it('should call createBeeswaxCamp and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 200, body: { externalId: 1234, budget: 1000 } } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(beesCamps.createBeeswaxCamp).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from createBeeswaxCamp', function(done) {
                    beesCamps.createBeeswaxCamp.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for PUT /api/campaigns/:c6Id/external/beeswax/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.put).toHaveBeenCalledWith('/', 'sessionsMidware', 'fakeEditMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.put['/'][expressRoutes.put['/'].length - 1];
                    spyOn(beesCamps, 'editBeeswaxCamp').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call editBeeswaxCamps and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'fulfilled', value: { code: 400, body: 'i got a problem with YOU' } });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(beesCamps.editBeeswaxCamp).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from editBeeswaxCamps', function(done) {
                    beesCamps.editBeeswaxCamp.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res,
                            { state: 'rejected', reason: 'I GOT A PROBLEM' });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});
