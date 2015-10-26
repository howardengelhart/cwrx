var flush = true;
describe('ads-campaigns (UT)', function() {
    var mockLog, CrudSvc, Model, logger, q, campModule, campaignUtils, bannerUtils, requestUtils, uuid,
        mongoUtils, nextSpy, doneSpy, errorSpy, req, anyNum, mockDb;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        requestUtils    = require('../../lib/requestUtils');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        bannerUtils     = require('../../lib/bannerUtils');
        mongoUtils      = require('../../lib/mongoUtils');
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
        spyOn(CrudSvc.prototype, 'formatOutput').and.callThrough();

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        campModule.config.campaigns = {
            statusDelay: 1000, statusAttempts: 10, campaignTypeId: 454545,
            dateDelays: { start: 100, end: 200 }
        };
        campModule.config.api = {
            root: 'https://test.com',
            cards: {
                baseUrl: 'https://test.com/api/content/cards/',
                endpoint: '/api/content/cards/'
            },
            experiences: {
                baseUrl: 'https://test.com/api/content/experiences/',
                endpoint: '/api/content/experiences/'
            }
        };

        req = {
            uuid: '1234',
            _advertiserId: 987,
            _customerId: 876,
            headers: { cookie: 'chocolate' },
            user: { id: 'u-1', email: 'selfie@c6.com' },
            params: {}, query: {}
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            var config = {
                api: {
                    root: 'https://foo.com',
                    cards: { endpoint: '/cards/' },
                    experiences: { endpoint: '/experiences/' },
                },
                campaigns: { statusDelay: 100, statusAttempts: 5 }
            };
            
            [campaignUtils.getAccountIds, campModule.validatePricing,
             campModule.editSponsoredCamps, campModule.createSponsoredCamps].forEach(function(fn) {
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
            expect(campModule.config.api).toEqual({
                root: 'https://foo.com',
                cards: {
                    endpoint: '/cards/',
                    baseUrl: 'https://foo.com/cards/'
                },
                experiences: {
                    endpoint: '/experiences/',
                    baseUrl: 'https://foo.com/experiences/'
                }
            });
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
        
        it('should do extra pricing validation on create + edit', function() {
            expect(campModule.validatePricing.bind).toHaveBeenCalledWith(campModule, svc);
            expect(svc._middleware.create).toContain(campModule.validatePricing);
            expect(svc._middleware.edit).toContain(campModule.validatePricing);
        });
        
        it('should ensure list entry identifiers are unique on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.ensureUniqueIds);
            expect(svc._middleware.edit).toContain(campModule.ensureUniqueIds);
            expect(svc._middleware.create).toContain(campModule.ensureUniqueNames);
            expect(svc._middleware.edit).toContain(campModule.ensureUniqueNames);
        });
        
        it('should fetch cards on create, edit, and delete', function() {
            expect(svc._middleware.create).toContain(campModule.fetchCards);
            expect(svc._middleware.edit).toContain(campModule.fetchCards);
            expect(svc._middleware.delete).toContain(campModule.fetchCards);
        });
        
        it('should validate dates on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.validateDates);
            expect(svc._middleware.edit).toContain(campModule.validateDates);
        });
        
        it('should default the reportingId on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.defaultReportingId);
            expect(svc._middleware.edit).toContain(campModule.defaultReportingId);
        });
        
        it('should clean out unused sponsored content on edit', function() {
            expect(svc._middleware.edit).toContain(campModule.cleanCards);
            expect(svc._middleware.edit).toContain(campModule.cleanMiniReels);
        });
        
        it('should create/edit C6 card entities on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.updateCards);
            expect(svc._middleware.edit).toContain(campModule.updateCards);
        });
        
        it('should include middleware for managing adtech campaigns on create + edit', function() {
            expect(campModule.createSponsoredCamps.bind).toHaveBeenCalledWith(campModule, svc);
            expect(campModule.editSponsoredCamps.bind).toHaveBeenCalledWith(campModule, svc);
            expect(svc._middleware.create).toContain(campModule.createSponsoredCamps);
            expect(svc._middleware.edit).toContain(campModule.createSponsoredCamps);
            expect(svc._middleware.edit).toContain(campModule.editSponsoredCamps);
        });
        
        it('should include middleware for handling the pricingHistory', function() {
            expect(svc._middleware.create).toContain(campModule.handlePricingHistory);
            expect(svc._middleware.edit).toContain(campModule.handlePricingHistory);
        });
        
        it('should include middleware for deleting linked entities on delete', function() {
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
            expect(svc._middleware.delete).toContain(campModule.deleteSponsoredCamps);
        });
    });
    
    describe('decorateWithCards', function() {
        var campResp, c6Cards;
        beforeEach(function() {
            c6Cards = {
                'rc-1': { id: 'rc-1', title: 'card 1' },
                'rc-2': { id: 'rc-2', title: 'card 2' }
            };
            campResp = {
                code: 200,
                body: {
                    id: 'cam-1',
                    name: 'my camp',
                    cards: [ { id: 'rc-2' }, { id: 'rc-1' } ]
                }
            };
            spyOn(requestUtils, 'qRequest').and.callFake(function(method, opts) {
                var card = c6Cards[opts.url.match(/cards\/(.+)$/)[1]];
                return q({
                    response: { statusCode: !!card ? 200 : 404 },
                    body: card || 'Card not found'
                });
            });
        });
        
        it('should decorate the cards array with entities fetched from the content svc', function(done) {
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({
                    id: 'cam-1',
                    name: 'my camp',
                    cards: [
                        { id: 'rc-2', title: 'card 2' },
                        { id: 'rc-1', title: 'card 1' }
                    ]
                });
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-2', headers: { cookie: 'chocolate' } });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-1', headers: { cookie: 'chocolate' } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
                
        it('should skip if the response is non-2xx', function(done) {
            campResp = { code: 400, body: 'you did a bad thing' };
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('you did a bad thing');
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if there are no cards on the response body', function(done) {
            delete campResp.body.cards;
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'cam-1', name: 'my camp' });
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not refetch any cards it already has', function(done) {
            req._cards = { 'rc-1': c6Cards['rc-1'] };
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({
                    id: 'cam-1',
                    name: 'my camp',
                    cards: [
                        { id: 'rc-2', title: 'card 2' },
                        { id: 'rc-1', title: 'card 1' }
                    ]
                });
                expect(requestUtils.qRequest.calls.count()).toBe(1);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-2', headers: { cookie: 'chocolate' } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log.warn if any cards are not found', function(done) {
            delete c6Cards['rc-2'];
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({
                    id: 'cam-1',
                    name: 'my camp',
                    cards: [
                        { id: 'rc-2' },
                        { id: 'rc-1', title: 'card 1' }
                    ]
                });
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if any requests fail', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('Error fetching card rc-2');
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
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
        
        it('should be able to handle multiple cards without ids', function(done) {
            req.body = { cards: [{ title: 'card 1' }, { title: 'card 2' }, { id: 'rc-1' }] };
            campModule.ensureUniqueIds(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                
                req.body.cards.unshift({ id: 'rc-1' });
                nextSpy.calls.reset();
                doneSpy.calls.reset();
                errorSpy.calls.reset();
                
                campModule.ensureUniqueIds(req, nextSpy, doneSpy).catch(errorSpy);
                process.nextTick(function() {
                    expect(nextSpy).not.toHaveBeenCalled();
                    expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'cards must be distinct'});
                    expect(errorSpy).not.toHaveBeenCalled();
                    done();
                });
            });
        });
    });

    describe('fetchCards', function() {
        var c6Cards;
        beforeEach(function() {
            c6Cards = {
                'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12 } },
                'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13 } }
            };
            req.body = {
                id: 'cam-1',
                cards: [ { id: 'rc-1' }, { id: 'rc-2' } ]
            };
            req.origObj = {
                id: 'cam-1',
                cards: [ { id: 'rc-3' } ]
            };
            spyOn(requestUtils, 'qRequest').and.callFake(function(method, opts) {
                var card = c6Cards[opts.url.match(/cards\/(.+)$/)[1]];
                return q({
                    response: { statusCode: !!card ? 200 : 404 },
                    body: card || 'Card not found'
                });
            });
        });
        
        it('should fetch all cards from the new + original objects', function(done) {
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12 } },
                });
                expect(req._origCards).toEqual({
                    'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13 } }
                });
                expect(req.body.cards).toEqual([c6Cards['rc-1'], c6Cards['rc-2']]);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-2', headers: { cookie: 'chocolate' } });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-1', headers: { cookie: 'chocolate' } });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-3', headers: { cookie: 'chocolate' } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle req.origObj being absent', function(done) {
            delete req.origObj;
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12 } },
                });
                expect(req._origCards).toEqual({});
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                done();
            });
        });
        
        it('should intelligently merge req.body.cards entries with fetched cards', function(done) {
            req.body.cards = [
                { id: 'rc-1', title: 'card 1.1', tag: 'foo' },
                { id: 'rc-2', campaign: { adtechName: 'adtechSux' } }
            ];
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', title: 'card 1.1', tag: 'foo', campaign: { adtechId: 11 } },
                    { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, adtechName: 'adtechSux' } }
                ]);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should initialize the campaign property if needed', function(done) {
            req.body.cards.push({ title: 'my new card' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                    { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12 } },
                    { title: 'my new card', campaign: {} }
                ]);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should avoid making duplicate requests', function(done) {
            req.origObj.cards.push({ id: 'rc-1' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12 } },
                });
                expect(req._origCards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11 } },
                    'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13 } }
                });
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should call done if a card in req.body.cards cannot be fetched', function(done) {
            req.body.cards.push({ id: 'rc-fake' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot fetch card rc-fake' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest.calls.count()).toBe(4);
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should log.warn and continue if a card in req.origObj.cards cannot be fetched', function(done) {
            req.origObj.cards.push({ id: 'rc-fake' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([c6Cards['rc-1'], c6Cards['rc-2']]);
                expect(requestUtils.qRequest.calls.count()).toBe(4);
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if any request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(jasmine.any(Error));
                expect(errorSpy.calls.argsFor(0)[0].message).toBe('Error fetching card rc-1');
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('validateDates', function() {
        beforeEach(function() {
            req.body = { cards: [
                { id: 'rc-1', campaign: { adtechId: 11 } },
                { id: 'rc-2', campaign: { adtechId: 12 } }
            ] };
            req._cards = {};
            spyOn(campaignUtils, 'validateDates').and.returnValue(true);
        });
        
        it('should call campaignUtils.validateDates for every list object', function(done) {
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(2);
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 11 }, undefined, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 12 }, undefined, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should pass in existing sub-objects if they exist', function(done) {
            req._cards['rc-1'] = { id: 'rc-1', campaign: { adtechId: 11, startDate: '2015-10-25T00:27:03.456Z' } };
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(2);
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 11 },
                    { adtechId: 11, startDate: '2015-10-25T00:27:03.456Z' }, {start: 100, end: 200}, '1234');
                expect(campaignUtils.validateDates).toHaveBeenCalledWith({ adtechId: 12 }, undefined, {start: 100, end: 200}, '1234');
                done();
            });
        });
        
        it('should skip if no cards are defined', function(done) {
            delete req.body.cards;
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if validateDates returns false', function(done) {
            campaignUtils.validateDates.and.callFake(function(obj) {
                if (obj.adtechId === 12) return false;
                else return true;
            });
            campModule.validateDates(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'cards[1] has invalid dates'});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateDates.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('ensureUniqueNames', function() {
        beforeEach(function() {
            req.body = { cards: [
                { campaign: { adtechName: 'foo' } },
                { id: 'rc-1', campaign: { adtechName: 'bar' } }
            ] };
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
        
        it('should skip if no cards are defined', function(done) {
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
            req.body.cards.push({ campaign: { adtechName: 'bar' }});
            campModule.ensureUniqueNames(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'cards[2] has a non-unique name'});
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
                    { id: 'rc-1', campaign: {} },
                    { id: 'rc-2', campaign: { reportingId: 'card2' } },
                    { id: 'rc-3', campaign: {} }
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
                    { id: 'rc-1', campaign: { reportingId: 'campaign 1' } },
                    { id: 'rc-2', campaign: { reportingId: 'card2' } },
                    { id: 'rc-3', campaign: { reportingId: 'campaign 1' } }
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
                    { id: 'rc-1', campaign: { reportingId: 'campaign 2' } },
                    { id: 'rc-2', campaign: { reportingId: 'card2' } },
                    { id: 'rc-3', campaign: { reportingId: 'campaign 2' } }
                ]);
                done();
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
    
    describe('cleanCards', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                cards: [ { id: 'rc-1' } ],
                staticCardMap: { 'e-11': { 'rc-pl1': 'rc-2' } }
            };
            req._cards = { 'rc-1': { id: 'rc-1' } };
            req.origObj = {
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }, { id: 'rc-3' }]
            };
            req._origCards = {
                'rc-1': { id: 'rc-1', campaign: { adtechId: 11 } },
                'rc-2': { id: 'rc-2', campaign: { adtechId: 12 } },
                'rc-3': { id: 'rc-2', campaign: { adtechId: 13 } }
            };
            spyOn(campModule, 'sendDeleteRequest').and.returnValue(q());
            spyOn(campModule, 'cleanStaticMap').and.callThrough();
        });
        
        it('should delete unused cards', function(done) {
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.staticCardMap).toEqual({'e-11': {}});
                expect(campModule.cleanStaticMap).toHaveBeenCalledWith(req, ['rc-2', 'rc-3']);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12, 13], 1000, 10);
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-2', 'cards');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-3', 'cards');
                done();
            });
        });
        
        it('should skip if no cards array exists on req.body', function(done) {
            delete req.body.cards;
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).not.toBeDefined();
                expect(campaignUtils.deleteCampaigns).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if no cards are defined on req.origObj', function(done) {
            delete req.origObj.cards;
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.staticCardMap).toEqual({ 'e-11': { 'rc-pl1': 'rc-2' } });
                expect(campaignUtils.deleteCampaigns).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip items that have no adtechId', function(done) {
            delete req._origCards['rc-3'].campaign.adtechId;
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-2', 'cards');
                done();
            });
        });
        
        it('should skip items that were not fetched', function(done) {
            delete req._origCards['rc-2'];
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([13], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-3', 'cards');
                done();
            });
        });

        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.and.returnValue(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
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
            campModule.cleanCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Request failed'));
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('cleanMiniReels', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                miniReels: [ { id: 'e-1' } ]
            };
            req.origObj = {
                miniReels: [{ id: 'e-1' }, { id: 'e-2' }, { id: 'e-3' }]
            };
            spyOn(campModule, 'sendDeleteRequest').and.returnValue(q());
        });
        
        it('should delete unused campaigns', function(done) {
            campModule.cleanMiniReels(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experiences');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-3', 'experiences');
                done();
            });
        });
        
        it('should skip if there are no miniReels on req.body or req.origObj', function(done) {
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
            delete req1.body.miniReels;
            delete req2.origObj.miniReels;
            campModule.cleanMiniReels(req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.cleanMiniReels(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy.calls.count()).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if deleting a miniReel fails', function(done) {
            campModule.sendDeleteRequest.and.returnValue(q.reject(new Error('Request failed')));
            campModule.cleanMiniReels(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Request failed'));
                expect(campModule.sendDeleteRequest.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('updateCards', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                cards: [
                    { title: 'card 1', campaign: { adtechName: 'foo' } },
                    { id: 'rc-2', title: 'card 2', campaign: { adtechName: 'bar' } }
                ]
            };
            req._cards = { 'rc-2': { id: 'rc-2', title: 'old title' } };
            spyOn(requestUtils, 'qRequest').and.callFake(function(method, opts) {
                var resp = { response: {}, body: JSON.parse(JSON.stringify(opts.json)) };
                resp.body.updated = true;
                if (method === 'post') {
                    resp.body.id = 'rc-1';
                    resp.response.statusCode = 201;
                } else {
                    resp.response.statusCode = 200;
                }
                return q(resp);
            });
        });
        
        it('should create + edit cards through the content service', function(done) {
            campModule.updateCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([{ id: 'rc-1' }, { id: 'rc-2' } ]);
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechName: 'foo' }, updated: true, campaignId: 'cam-1' },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechName: 'bar' }, updated: true, campaignId: 'cam-1' },
                });
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                    url: 'https://test.com/api/content/cards/',
                    json: { title: 'card 1', campaign: { adtechName: 'foo' }, campaignId: 'cam-1' },
                    headers: { cookie: 'chocolate' }
                });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('put', {
                    url: 'https://test.com/api/content/cards/rc-2',
                    json: { id: 'rc-2', title: 'card 2', campaign: { adtechName: 'bar' }, campaignId: 'cam-1' },
                    headers: { cookie: 'chocolate' }
                });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if the body has no cards', function(done) {
            delete req.body.cards;
            campModule.updateCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).not.toBeDefined();
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if one of the requests returns a 4xx', function(done) {
            requestUtils.qRequest.and.callFake(function(method, opts) {
                if (method === 'post') return q({ response: { statusCode: 403 }, body: 'Cannot POST cards' });
                else return q({ response: { statusCode: 200 }, body: opts.json });
            });
            campModule.updateCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot post card "card 1"' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if one of the requests fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.updateCards(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalledWith();
                expect(errorSpy).toHaveBeenCalledWith(jasmine.any(Error));
                expect(errorSpy.calls.argsFor(0)[0].message).toBe('Error updating card "card 1"');
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('editSponsoredCamps', function() {
        var svc;
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }, { id: 'rc-3' }],
                targeting: { interests: ['cat-1'] }
            };
            req.origObj = {
                targeting: { interests: ['cat-1'] },
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }, { id: 'rc-3' }, { id: 'rc-4' }]
            };
            req._cards = {
                'rc-1': { id: 'rc-1', campaign: { adtechId: 11, adtechName: 'card 1', startDate: 'right now', endDate: 'tomorrow' } },
                'rc-2': { id: 'rc-2', campaign: { adtechId: 12, adtechName: 'cats', startDate: 'right meow', endDate: 'mewsday' } },
                'rc-3': { id: 'rc-3', campaign: { adtechId: 13, adtechName: 'card 3', startDate: '123', endDate: '456' } }
            };
            req._origCards = {
                'rc-1': { id: 'rc-1', campaign: { adtechId: 11, adtechName: 'old card 1', startDate: 'right now', endDate: 'tomorrow' } },
                'rc-2': { id: 'rc-2', campaign: { adtechId: 12, adtechName: 'cats', startDate: 'now', endDate: 'mewsday' } },
                'rc-3': { id: 'rc-3', campaign: { adtechId: 13, adtechName: 'card 3', startDate: '123', endDate: '456' } }
            };
            svc = { _db: mockDb };
            spyOn(mongoUtils, 'editObject').and.callFake(function(coll, updates, id) {
                var resp = req._cards[id];
                resp.updated = true;
                return q(resp);
            });
        });
        
        it('should edit any card camapigns that have changed', function(done) {
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-1'] });
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('card 1 (cam-1)', req._cards['rc-1'].campaign, undefined, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('cats (cam-1)', req._cards['rc-2'].campaign, undefined, '1234');
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', campaign: { adtechId: 11, adtechName: 'card 1', startDate: 'right now', endDate: 'tomorrow' } },
                    'rc-2': { id: 'rc-2', campaign: { adtechId: 12, adtechName: 'cats', startDate: 'right meow', endDate: 'mewsday' } },
                    'rc-3': { id: 'rc-3', campaign: { adtechId: 13, adtechName: 'card 3', startDate: '123', endDate: '456' } }
                });
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should edit all campaigns that still exist if the interests are different', function(done) {
            req.body.targeting.interests.unshift('cat-2');
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-2', 'cat-1'] });
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-2', 'cat-1']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('card 1 (cam-1)', req._cards['rc-1'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum, anyNum] }, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('cats (cam-1)', req._cards['rc-2'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum, anyNum] }, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('card 3 (cam-1)', req._cards['rc-3'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum, anyNum] }, '1234');
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should still edit all campaigns when interests differ if no cards are declared on req.body', function(done) {
            req.body.targeting.interests = ['cat-3'];
            delete req.body.cards;
            req._cards = {};
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-3'] });
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-3']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('old card 1 (cam-1)', req._origCards['rc-1'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum] }, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('cats (cam-1)', req._origCards['rc-2'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum] }, '1234');
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith('card 3 (cam-1)', req._origCards['rc-3'].campaign,
                    { level1: [anyNum], level2: undefined, level3: [anyNum] }, '1234');
                done();
            });
        });
        
        it('should use * for kwlp3 if the interests are an empty array on the req.body', function(done) {
            req.body.targeting.interests = [];
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: [] });
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['*']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should not include * if adding interests when previously there were none', function(done) {
            req.origObj.targeting.interests = [];
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).toEqual({ interests: ['cat-1'] });
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-1']});
                expect(campaignUtils.editCampaign.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should not change the keywords if interests are undefined on req.body', function(done) {
            delete req.body.targeting;
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.targeting).not.toBeDefined();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                done();
            });
        });
        
        it('should edit cards in mongo if editCampaign changes card.campaign properties', function(done) {
            campaignUtils.editCampaign.and.callFake(function(name, campaign, keys, uuid) {
                if (campaign.adtechId === 12) {
                    campaign.startDate = 'eventually';
                }
                return q();
            });

            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                expect(req._cards['rc-2']).toEqual({
                    id: 'rc-2', updated: true, campaign: { adtechId: 12, adtechName: 'cats', startDate: 'eventually', endDate: 'mewsday' }
                });
                expect(mongoUtils.editObject.calls.count()).toBe(1);
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'cards' }, { campaign: req._cards['rc-2'].campaign }, 'rc-2');
                expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(req._cards['rc-2']);
                done();
            });
        });
        
        it('should do nothing if all campaigns match', function(done) {
            req._origCards = req._cards;
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if no cards were defined on the original document', function(done) {
            delete req.origObj.cards;
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
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
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(jasmine.any(Error));
                expect(errorSpy.calls.argsFor(0)[0].message).toBe('I GOT A PROBLEM');
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if updating a campaign fails', function(done) {
            campaignUtils.editCampaign.and.callFake(function(name, campaign, keys, reqId) {
                if (campaign.adtechId === 11) return q.reject(new Error('I GOT A PROBLEM'));
                else return q();
            });
            campModule.editSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(jasmine.any(Error));
                expect(errorSpy.calls.argsFor(0)[0].message).toBe('I GOT A PROBLEM');
                expect(campaignUtils.editCampaign.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('createSponsoredCamps', function() {
        var svc;
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                targeting: { interests: ['cat-1'] },
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }]
            };
            req.origObj = { targeting: { interests: ['cat-2'] } };
            req._cards = {
                'rc-1': { id: 'rc-1', campaign: { adtechName: 'card 1', startDate: 'right now', endDate: 'tomorrow' } },
                'rc-2': { id: 'rc-2', campaign: { startDate: 'right meow', endDate: 'mewsday' } }
            };
            spyOn(campaignUtils, 'createCampaign').and.callFake(function() {
                return q({id: String(this.createCampaign.calls.count()*1000)});
            });
            spyOn(bannerUtils, 'createBanners').and.returnValue(q());
            spyOn(bannerUtils, 'cleanBanners').and.returnValue(q());
            svc = { _db: mockDb };
            spyOn(mongoUtils, 'editObject').and.callFake(function(coll, updates, id) {
                var resp = req._cards[id];
                resp.updated = true;
                return q(resp);
            });
        });
        
        it('should create sponsored card campaigns', function(done) {
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([{ id: 'rc-1' }, { id: 'rc-2' }]);
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', campaign: { adtechId: 1000, adtechName: 'card 1', startDate: 'right now', endDate: 'tomorrow' }, updated: true },
                    'rc-2': { id: 'rc-2', campaign: { adtechId: 2000, adtechName: 'card_rc-2', startDate: 'right meow', endDate: 'mewsday' }, updated: true }
                });
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-1']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({
                    id: 'rc-1',
                    name: 'card 1 (cam-1)',
                    startDate: 'right now',
                    endDate: 'tomorrow',
                    campaignTypeId: 454545,
                    keywords: {level1: [anyNum], level2: undefined, level3: [anyNum]},
                    advertiserId: 987, customerId: 876
                }, '1234');
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith({
                    id: 'rc-2',
                    name: 'card_rc-2 (cam-1)',
                    startDate: 'right meow',
                    endDate: 'mewsday',
                    campaignTypeId: 454545,
                    keywords: {level1: [anyNum], level2: undefined, level3: [anyNum]},
                    advertiserId: 987, customerId: 876
                }, '1234');
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req._cards['rc-1']], null, 'card', true, 1000);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req._cards['rc-2']], null, 'card', true, 2000);
                expect(mongoUtils.editObject.calls.count()).toBe(2);
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'cards' }, { campaign: req._cards['rc-1'].campaign }, 'rc-1');
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'cards' }, { campaign: req._cards['rc-2'].campaign }, 'rc-2');
                expect(CrudSvc.prototype.formatOutput.calls.count()).toBe(2);
                expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(req._cards['rc-1']);
                expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(req._cards['rc-2']);
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip cards that already have an adtechId', function(done) {
            req._cards['rc-1'].campaign.adtechId = 1111;
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-1']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(1);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith(jasmine.objectContaining({ id: 'rc-2' }), '1234');
                expect(bannerUtils.createBanners.calls.count()).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req._cards['rc-2']], null, 'card', true, 1000);
                expect(mongoUtils.editObject.calls.count()).toBe(1);
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'cards' }, { campaign: req._cards['rc-2'].campaign }, 'rc-2');
                expect(CrudSvc.prototype.formatOutput.calls.count()).toBe(1);
                expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(req._cards['rc-2']);
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should use the origObj\'s interests if not defined on req.body', function(done) {
            delete req.body.targeting.interests;
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['cat-2']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });
        
        it('should use * for kwlp3 if no interests are defined', function(done) {
            delete req.body.targeting.interests;
            req.origObj.targeting.interests = [];
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['*']});
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(2);
                done();
            });
        });

        it('should skip if no cards are defined on req.body', function(done) {
            delete req.body.cards;
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).not.toBeDefined();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            campaignUtils.makeKeywords.and.callFake(function(keywords) {
                if (keywords && keywords[0] === 'cat-1') return q.reject(new Error('I GOT A PROBLEM'));
                else return q(keywords);
            });
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
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
                if (obj.id === 'rc-1') return q.reject(new Error('I GOT A PROBLEM'));
                else return q({id: String(this.createCampaign.calls.count()*1000)});
            });
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.count()).toBe(2);
                expect(bannerUtils.createBanners.calls.count()).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([req._cards['rc-2']], null, 'card', true, 2000);
                done();
            });
        });
        
        it('should reject if creating banners fails', function(done) {
            bannerUtils.createBanners.and.returnValue(q.reject(new Error('I GOT A PROBLEM')));
            campModule.createSponsoredCamps(svc, req, nextSpy, doneSpy).catch(errorSpy);
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
            campModule.sendDeleteRequest(req, 'e-1', 'experiences').then(function() {
                expect(requestUtils.qRequest).toHaveBeenCalledWith('delete', {headers: {cookie: {c6Auth: 'qwer1234'}},
                    url: 'https://test.com/api/content/experiences/e-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log a warning if the statusCode is not 204', function(done) {
            resp = { response: { statusCode: 400 }, body: 'Unauthorized' };
            campModule.sendDeleteRequest(req, 'e-1', 'experiences').then(function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if the request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.sendDeleteRequest(req, 'e-1', 'experiences').then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Failed sending delete request to content service'));
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('deleteContent', function() {
        beforeEach(function() {
            req.origObj = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}] };
            spyOn(campModule, 'sendDeleteRequest').and.returnValue(q());
        });
        
        it('should delete all sponsored content for the campaign', function(done) {
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.count()).toBe(3);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'cards');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-1', 'experiences');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experiences');
                done();
            });
        });
        
        it('should skip a list if not defined', function(done) {
            delete req.origObj.miniReels;
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.count()).toBe(1);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'cards');
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
    
    describe('deleteSponsoredCamps', function() {
        beforeEach(function() {
            req.origObj = { id: 'cam-1', cards: [{ id: 'rc-1' }, { id: 'rc-2' }] };
            req._origCards = {
                'rc-1': { id: 'rc-1', campaign: { adtechId: 11 } },
                'rc-2': { id: 'rc-2', campaign: { adtechId: 12 } }
            };
        });

        it('should delete all adtech campaigns', function(done) {
            campModule.deleteSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 12], 1000, 10);
                done();
            });
        });
        
        it('should skip if no cards are defined', function(done) {
            delete req.origObj.cards;
            campModule.deleteSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip items if they do not have an adtechId', function(done) {
            delete req._origCards['rc-2'].campaign.adtechId;
            req.origObj.cards.push({ id: 'rc-old' });
            campModule.deleteSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn.calls.count()).toBe(2);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11], 1000, 10);
                done();
            });
        });
        
        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.and.returnValue(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.deleteSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('ADTECH IS THE WORST'));
                done();
            });
        });
    });
});

