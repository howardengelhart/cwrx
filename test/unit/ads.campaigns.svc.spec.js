var flush = true;
describe('ads-campaigns (UT)', function() {
    var mockLog, CrudSvc, Model, logger, q, campModule, campaignUtils, requestUtils, email,
        mongoUtils, objUtils, nextSpy, doneSpy, errorSpy, req, anyNum, mockDb, Status;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        email           = require('../../lib/email');
        Status          = require('../../lib/enums').Status;
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
        spyOn(CrudSvc.prototype, 'formatOutput').and.callThrough();

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        campModule.config.api = {
            root: 'https://test.com',
            cards: {
                baseUrl: 'https://test.com/api/content/cards/',
                endpoint: '/api/content/cards/'
            },
            paymentMethods: {
                baseUrl: 'https://test.com/api/payments/methods/',
                endpoint: '/api/payments/methods/'
            },
            experiences: {
                baseUrl: 'https://test.com/api/content/experiences/',
                endpoint: '/api/content/experiences/'
            }
        };
        campModule.config.emails = {
            sender: 'no-reply@c6.com',
            manageLink: 'http://selfie.c6.com/manage/:campId/manage',
            dashboardLink: 'http://selfie.c6.com/review/campaigns'
        };

        req = {
            uuid: '1234',
            _advertiserId: 987,
            headers: { cookie: 'chocolate' },
            user: { id: 'u-1', email: 'selfie@c6.com' },
            params: {}, query: {}
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

        beforeEach(function() {
            var config = {
                emails: {
                    sender: 'email.sender',
                    manageLink: 'manage.this/:campId/manage',
                    dashboardLink: 'dash.board'
                },
                api: {
                    root: 'https://foo.com',
                    cards: { endpoint: '/cards/' },
                    experiences: { endpoint: '/experiences/' },
                }
            };

            boundFns = [];
            var bind = Function.prototype.bind;
            
            [campModule.extraValidation, campModule.statusCheck, campModule.notifyEnded].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
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
            expect(campModule.config.emails).toEqual({
                sender: 'email.sender',
                manageLink: 'manage.this/:campId/manage',
                dashboardLink: 'dash.board'
            });
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
        
        it('should fetch cards on create, edit, and delete', function() {
            expect(svc._middleware.create).toContain(campModule.fetchCards);
            expect(svc._middleware.edit).toContain(campModule.fetchCards);
            expect(svc._middleware.delete).toContain(campModule.fetchCards);
        });
        
        it('should do extra validation on create + edit', function() {
            expect(svc._middleware.create).toContain(getBoundFn(campModule.extraValidation, [campModule, svc]));
            expect(svc._middleware.edit).toContain(getBoundFn(campModule.extraValidation, [campModule, svc]));
        });
        
        it('should default the reportingId on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.defaultReportingId);
            expect(svc._middleware.edit).toContain(campModule.defaultReportingId);
        });
        
        it('should prevent editing + deleting campaigns while in certain statuses', function() {
            expect(svc._middleware.edit).toContain(getBoundFn(campModule.statusCheck, [campModule, [Status.Draft]]));
            expect(svc._middleware.delete).toContain(getBoundFn(campModule.statusCheck,
                [campModule, [Status.Draft, Status.Pending, Status.Canceled, Status.Expired]]));
        });
        
        it('should prevent editing locked campaigns on edit', function() {
            expect(svc._middleware.edit).toContain(campModule.enforceLock);
        });
        
        it('should clean out unused sponsored content on edit', function() {
            expect(svc._middleware.edit).toContain(campModule.cleanCards);
            expect(svc._middleware.edit).toContain(campModule.cleanMiniReels);
        });
        
        it('should set dates on cards on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.setCardDates);
            expect(svc._middleware.edit).toContain(campModule.setCardDates);
        });
        
        it('should create/edit C6 card entities on create + edit', function() {
            expect(svc._middleware.create).toContain(campModule.updateCards);
            expect(svc._middleware.edit).toContain(campModule.updateCards);
        });
        
        it('should potentially notify the owner when the campaign ends', function() {
            expect(svc._middleware.edit).toContain(getBoundFn(campModule.notifyEnded, [campModule, svc]));
        });
        
        it('should include middleware for handling the pricingHistory', function() {
            expect(svc._middleware.create).toContain(campModule.handlePricingHistory);
            expect(svc._middleware.edit).toContain(campModule.handlePricingHistory);
        });
        
        it('should include middleware for deleting linked entities on delete', function() {
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
        });
    });
    
    describe('decorateWithCards', function() {
        var campResp, c6Cards;
        beforeEach(function() {
            c6Cards = {
                'rc-1': { id: 'rc-1', title: 'card 1' },
                'rc-2': { id: 'rc-2', title: 'card 2' },
                'rc-3': { id: 'rc-3', title: 'card 3' },
                'rc-4': { id: 'rc-4', title: 'card 4' },
                'rc-5': { id: 'rc-5', title: 'card 5' }
            };
            campResp = {
                code: 200,
                body: {
                    id: 'cam-1',
                    name: 'my camp',
                    cards: [ { id: 'rc-1' }, { id: 'rc-2' } ]
                }
            };
            spyOn(requestUtils, 'qRequest').and.callFake(function(method, opts) {
                var cards = opts.qs.ids.split(',').map(function(id) { return c6Cards[id]; }).filter(function(card) { return !!card; });
                return q({
                    response: { statusCode: 200 },
                    body: cards
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
                        { id: 'rc-1', title: 'card 1' },
                        { id: 'rc-2', title: 'card 2' }
                    ]
                });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {
                    url: 'https://test.com/api/content/cards/',
                    qs: { ids: 'rc-1,rc-2' },
                    headers: { cookie: 'chocolate' }
                });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should decorate multiple campaigns', function(done) {
            campResp.body = [
                { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-1' }, { id: 'rc-2' } ] },
                { id: 'cam-1', name: 'camp 1' },
                { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-3' } ] },
                { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-4' }, { id: 'rc-5' } ] },
            ];

            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-1', title: 'card 1' }, { id: 'rc-2', title: 'card 2' } ] },
                    { id: 'cam-1', name: 'camp 1' },
                    { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-3', title: 'card 3' } ] },
                    { id: 'cam-1', name: 'camp 1', cards: [ { id: 'rc-4', title: 'card 4' }, { id: 'rc-5', title: 'card 5' } ] },
                ]);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {
                    url: 'https://test.com/api/content/cards/',
                    qs: { ids: 'rc-1,rc-2,rc-3,rc-4,rc-5' },
                    headers: { cookie: 'chocolate' }
                });
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
                        { id: 'rc-1', title: 'card 1' },
                        { id: 'rc-2', title: 'card 2' }
                    ]
                });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {
                    url: 'https://test.com/api/content/cards/',
                    qs: { ids: 'rc-2' },
                    headers: { cookie: 'chocolate' }
                });
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
                        { id: 'rc-1', title: 'card 1' },
                        { id: 'rc-2' }
                    ]
                });
                expect(mockLog.warn).toHaveBeenCalled();
                expect(requestUtils.qRequest).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if any requests fail', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.decorateWithCards(req, campResp).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error fetching cards');
                expect(mockLog.error).toHaveBeenCalled();
                expect(requestUtils.qRequest).toHaveBeenCalled();
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
        
        it('should replace the text query param with a regex query by name', function() {
            req._query = { user: 'u-1', text: 'camp 1 is great' };
            var expectedObj = { $regex: '.*camp.*1.*is.*great.*', $options: 'i' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ user: 'u-1', $or: [{ name: expectedObj }, { advertiserDisplayName: expectedObj }] });
            
            req._query = { text: 'camp' };
            expectedObj.$regex = '.*camp.*';
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ $or: [{ name: expectedObj }, { advertiserDisplayName: expectedObj }] });

            req._query = { text: '  camp\t1\tis\tgreat\t ' };
            expectedObj.$regex = '.*camp.*1.*is.*great.*';
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({ $or: [{ name: expectedObj }, { advertiserDisplayName: expectedObj }] });
        });
        
        it('should preserve existing $or queries', function() {
            req._query = { $or: [ { a: 1, b: 2 } ], text: 'foo' };
            var expectedObj = { $regex: '.*foo.*', $options: 'i' };
            campModule.formatTextQuery(req, nextSpy, doneSpy);
            expect(req._query).toEqual({
                $and: [
                    { $or: [ { a: 1, b: 2 } ] },
                    { $or: [ { name: expectedObj }, { advertiserDisplayName: expectedObj } ] }
                ]
            });
        });
    });
    
    describe('statusCheck', function() {
        var permitted;
        beforeEach(function() {
            req.origObj = { id: 'cam-1', status: Status.Active };
            req.user.entitlements = {};
            permitted = [Status.Draft, Status.Canceled];
        });

        it('should call done if the campaign is not one of the permitted statuses', function() {
            campModule.statusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Action not permitted on ' + Status.Active + ' campaign' });
        });
        
        it('should call next if the campaign is one of the permitted statuses', function() {
            req.origObj.status = Status.Canceled;
            campModule.statusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call next if the user has the directEditCampaigns entitlement', function() {
            req.user.entitlements.directEditCampaigns = true;
            campModule.statusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call next if there\'s an application with the directEditCampaigns entitlement', function() {
            req.application = { key: 'app 1', entitlements: { directEditCampaigns: true } };
            campModule.statusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });
    
    describe('enforceLock', function() {
        it('should call next if there is no updateRequest on the object', function(done) {  
            req.origObj = { id: 'cam-1', name: 'camp 1' };
            campModule.enforceLock(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if there is an updateRequest on the object', function(done) {
            req.origObj = { id: 'cam-1', name: 'camp 1', updateRequest: 'ur-1' };
            campModule.enforceLock(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign locked until existing update request resolved' });
                done();
            });
        });
    });

    describe('fetchCards', function() {
        var c6Cards;
        beforeEach(function() {
            c6Cards = {
                'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13, bannerId: 789, bannerNumber: 3 } }
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
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                });
                expect(req._origCards).toEqual({
                    'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13, bannerId: 789, bannerNumber: 3  } }
                });
                expect(req.body.cards).toEqual([{ id: 'rc-1' }, { id: 'rc-2' }]);
                expect(req.origObj.cards).toEqual([c6Cards['rc-3']]);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-2', headers: { cookie: 'chocolate' } });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-1', headers: { cookie: 'chocolate' } });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get',
                    { url: 'https://test.com/api/content/cards/rc-3', headers: { cookie: 'chocolate' } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should handle req.origObj being absent', function(done) {
            delete req.origObj;
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                });
                expect(req._origCards).toEqual({});
                expect(requestUtils.qRequest.calls.count()).toBe(2);
            }).done(done);
        });
        
        it('should skip over new cards that don\'t have ids', function(done) {
            req.body.cards.push({ title: 'my new card' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                });
                expect(req.body.cards).toEqual([{ id: 'rc-1' }, { id: 'rc-2' }, { title: 'my new card' }]);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should handle full card entities in req.body.cards', function(done) {
            req.body.cards = [
                { id: 'rc-1', title: 'card 1.1', campaign: { ads: 'yes' }, data: { foo: 'bar' } },
                { id: 'rc-2', title: 'card 1.2', campaign: { ads: 'maybe' }, data: { foo: 'baz' } }
            ];
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.cards).toEqual([
                    { id: 'rc-1', title: 'card 1.1', campaign: { ads: 'yes' }, data: { foo: 'bar' } },
                    { id: 'rc-2', title: 'card 1.2', campaign: { ads: 'maybe' }, data: { foo: 'baz' } }
                ]);
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                });
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                done();
            });
        });
        
        it('should avoid making duplicate requests', function(done) {
            req.origObj.cards.push({ id: 'rc-1' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._cards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechId: 12, bannerId: 456, bannerNumber: 2 } },
                });
                expect(req._origCards).toEqual({
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechId: 11, bannerId: 123, bannerNumber: 1 } },
                    'rc-3': { id: 'rc-3', title: 'card 3', campaign: { adtechId: 13, bannerId: 789, bannerNumber: 3  } }
                });
                expect(requestUtils.qRequest.calls.count()).toBe(3);
            }).done(done);
        });
        
        it('should call done if a card in req.body.cards cannot be fetched', function(done) {
            req.body.cards.push({ id: 'rc-fake' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot fetch card rc-fake' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest.calls.count()).toBe(4);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should log.warn and continue if a card in req.origObj.cards cannot be fetched', function(done) {
            req.origObj.cards.push({ id: 'rc-fake' });
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest.calls.count()).toBe(4);
                expect(mockLog.warn).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if any request fails', function(done) {
            requestUtils.qRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.fetchCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(jasmine.any(Error));
                expect(errorSpy.calls.argsFor(0)[0].message).toBe('Error fetching card rc-1');
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('extraValidation', function() {
        var svc;
        beforeEach(function() {
            req.body = { foo: 'bar' };
            req.origObj = { old: 'yes' };
            spyOn(campaignUtils, 'ensureUniqueIds').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validateAllDates').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validatePricing').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validatePaymentMethod').and.returnValue(q({ isValid: true }));
            svc = { model: new Model('campaigns', campModule.campSchema) };
        });
        
        it('should call next if all validation passes', function(done) {
            campModule.extraValidation(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.ensureUniqueIds).toHaveBeenCalledWith({ foo: 'bar' });
                expect(campaignUtils.validateAllDates).toHaveBeenCalledWith({ foo: 'bar' }, { old: 'yes' }, req.user, '1234');
                expect(campaignUtils.validatePricing).toHaveBeenCalledWith({ foo: 'bar' }, { old: 'yes' }, req.user, svc.model);
                expect(campaignUtils.validatePaymentMethod).toHaveBeenCalledWith({ foo: 'bar' }, { old: 'yes' },
                    req.user, 'https://test.com/api/payments/methods/', req);
            }).done(done, done.fail);
        });
        
        it('should call done if any of the synchronous methods return an invalid response', function(done) {
            var methods = ['ensureUniqueIds', 'validateAllDates', 'validatePricing'];
            methods.reduce(function(promise, method) {
                return promise.then(function() {
                    // reset all methods
                    methods.forEach(function(meth) { campaignUtils[meth].and.returnValue({ isValid: true }); });
                    nextSpy.calls.reset();
                    doneSpy.calls.reset();
                    errorSpy.calls.reset();
                    
                    // change behavior of currently evaluated method
                    campaignUtils[method].and.returnValue({ isValid: false, reason: method + ' has failed' });
                    
                    return campModule.extraValidation(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: method + ' has failed' });
                        expect(errorSpy).not.toHaveBeenCalled();
                    });
                });
            }, q()).done(done, done.fail);
        });
        
        it('should call done if validatePaymentMethods returns an invalid response', function(done) {
            campaignUtils.validatePaymentMethod.and.returnValue(q({ isValid: false, reason: 'you need to pay up buddy' }));
            campModule.extraValidation(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'you need to pay up buddy' });
                expect(errorSpy).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should reject if validatePaymentMethods reject', function(done) {
            campaignUtils.validatePaymentMethod.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.extraValidation(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
            }).done(done, done.fail);
        });
    });

    describe('defaultReportingId', function() {
        beforeEach(function() {
            req.body = {
                name: 'campaign 1',
                cards: [
                    { id: 'rc-1', campaign: {} },
                    { id: 'rc-2', campaign: { reportingId: 'card2' } },
                    { title: 'new card 1' },
                    { title: 'new card 2', campaign: { minViewTime: 3 } },
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
                    { title: 'new card 1', campaign: { reportingId: 'campaign 1' } },
                    { title: 'new card 2', campaign: { minViewTime: 3, reportingId: 'campaign 1' } },
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
                    { title: 'new card 1', campaign: { reportingId: 'campaign 2' } },
                    { title: 'new card 2', campaign: { minViewTime: 3, reportingId: 'campaign 2' } },
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
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
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
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-3', 'cards');
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
    
    describe('setCardDates', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                status: Status.Draft,
                cards: [
                    { id: 'rc-1', title: 'new1', campaign: {} },
                    { id: 'rc-2', title: 'new2', campaign: {} }
                ]
            };
            req.origObj = {
                id: 'cam-1',
                status: Status.Draft,
                cards: [
                    { id: 'rc-1', title: 'old1', campaign: {} },
                    { id: 'rc-2', title: 'old2', campaign: {} }
                ]
            };
            req._cards = {
                'rc-1': { id: 'rc-1', campaign: {}, data: { foo: 'bar' } },
                'rc-2': { id: 'rc-2', campaign: {}, data: { foo: 'bar' } },
            };
            req._origCards = {
                'rc-1': { id: 'rc-1', campaign: {}, data: { foo: 'bar' } },
                'rc-2': { id: 'rc-2', campaign: {}, data: { foo: 'bar' } },
            };
            
            jasmine.clock().install();
            jasmine.clock().mockDate(new Date('2016-01-28T23:32:22.023Z'));
        });
        
        afterEach(function() {
            jasmine.clock().uninstall();
        });
        
        it('should do nothing if the campaign is not starting or ending', function() {
            [{ old: Status.Draft, new: Status.Paused  }, { old: Status.Active, new: Status.OutOfBudget },
             { old: Status.Expired, new: Status.Active  }, { old: Status.Expired, new: Status.Canceled }].forEach(function(obj) {
                req.body.status = obj.new;
                req.origObj.status = obj.old;
                campModule.setCardDates(req, nextSpy, doneSpy);
            });
            expect(nextSpy.calls.count()).toBe(4);
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body.cards[0]).toEqual({ id: 'rc-1', title: 'new1', campaign: {} });
            expect(req.body.cards[1]).toEqual({ id: 'rc-2', title: 'new2', campaign: {} });
            expect(mockLog.info).not.toHaveBeenCalled();
        });
        
        ['starting', 'ending'].forEach(function(action) {
            describe('if the campaign is ' + action, function() {
                var modProp = action.replace('ing', 'Date');
                beforeEach(function() {
                    req.body.status = (action === 'starting') ? Status.Active : Status.Expired;
                    req.origObj.status = Status.Pending;
                });

                it('should do nothing if there are no cards', function() {
                    delete req.body.cards;
                    delete req.origObj.cards;
                    campModule.setCardDates(req, nextSpy, doneSpy);
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.cards).not.toBeDefined();
                    expect(req.origObj.cards).not.toBeDefined();
                    expect(mockLog.info).toHaveBeenCalled();
                });
                
                it('should set the ' + modProp + ' on cards', function() {
                    var expected = {};
                    expected[modProp] = '2016-01-28T23:32:22.023Z';

                    campModule.setCardDates(req, nextSpy, doneSpy);
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.cards[0]).toEqual({ id: 'rc-1', title: 'new1', campaign: expected });
                    expect(req.body.cards[1]).toEqual({ id: 'rc-2', title: 'new2', campaign: expected });
                    expect(mockLog.info).toHaveBeenCalled();
                });
                
                it('should not modify existing dates', function() {
                    req.body.cards[0].campaign.startDate = '2016-01-30T23:50:02.000Z';
                    req.body.cards[1].campaign.endDate = '2016-02-30T23:50:02.000Z';

                    campModule.setCardDates(req, nextSpy, doneSpy);
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.cards[0].campaign.startDate).toBe('2016-01-30T23:50:02.000Z');
                    expect(req.body.cards[1].campaign.endDate).toBe('2016-02-30T23:50:02.000Z');
                    if (action === 'starting') {
                        expect(req.body.cards[1].campaign.startDate).toBe('2016-01-28T23:32:22.023Z');
                        expect(req.body.cards[0].endDate).not.toBeDefined();
                    } else {
                        expect(req.body.cards[0].campaign.endDate).toBe('2016-01-28T23:32:22.023Z');
                        expect(req.body.cards[1].startDate).not.toBeDefined();
                    }
                    expect(mockLog.info).toHaveBeenCalled();
                });

                it('should ensure the campaign hash exists', function() {
                    var expected = {};
                    expected[modProp] = '2016-01-28T23:32:22.023Z';
                    req.body.cards = [{ id: 'rc-1' }, { id: 'rc-2' }];

                    campModule.setCardDates(req, nextSpy, doneSpy);
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.cards[0].campaign).toEqual(expected);
                    expect(req.body.cards[1].campaign).toEqual(expected);
                    expect(mockLog.info).toHaveBeenCalled();
                });
                
                it('should copy over the old cards if not defined in req.body', function() {
                    delete req.body.cards;
                    var expected = {};
                    expected[modProp] = '2016-01-28T23:32:22.023Z';

                    campModule.setCardDates(req, nextSpy, doneSpy);
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(req.body.cards[0]).toEqual({ id: 'rc-1', title: 'old1', campaign: expected });
                    expect(req.body.cards[1]).toEqual({ id: 'rc-2', title: 'old2', campaign: expected });
                    expect(mockLog.info).toHaveBeenCalled();
                });
            });
        });
    });
    
    describe('updateCards', function() {
        beforeEach(function() {
            req.body = {
                id: 'cam-1',
                advertiserId: 'a-1',
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
                    'rc-1': { id: 'rc-1', title: 'card 1', campaign: { adtechName: 'foo' }, updated: true, campaignId: 'cam-1', advertiserId: 'a-1' },
                    'rc-2': { id: 'rc-2', title: 'card 2', campaign: { adtechName: 'bar' }, updated: true, campaignId: 'cam-1', advertiserId: 'a-1' },
                });
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                    url: 'https://test.com/api/content/cards/',
                    json: { title: 'card 1', campaign: { adtechName: 'foo' }, campaignId: 'cam-1', advertiserId: 'a-1' },
                    headers: { cookie: 'chocolate' }
                });
                expect(requestUtils.qRequest).toHaveBeenCalledWith('put', {
                    url: 'https://test.com/api/content/cards/rc-2',
                    json: { id: 'rc-2', title: 'card 2', campaign: { adtechName: 'bar' }, campaignId: 'cam-1', advertiserId: 'a-1' },
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
    
    describe('handlePricingHistory', function() {
        var oldDate;
        beforeEach(function() {
            oldDate = new Date(new Date().valueOf() - 5000);
            req.body = {
                status: Status.Active,
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
        
        it('should update the latest pricingHistory entry if the status is draft', function() {
            req.body.status = Status.Draft;
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).toEqual([{
                pricing: {
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpv',
                    cost: 0.1
                },
                userId: 'u-1',
                user: 'foo@bar.com',
                date: jasmine.any(Date)
            }]);
            expect(req.body.pricingHistory[0].date).toBeGreaterThan(oldDate);
            expect(nextSpy).toHaveBeenCalledWith();
        });
        
        it('should be able to use the status on the origObj', function() {
            delete req.body.status;
            req.origObj.status = Status.Draft;
            campModule.handlePricingHistory(req, nextSpy, doneSpy);
            expect(req.body.pricingHistory).toEqual([{
                pricing: {
                    budget: 1000,
                    dailyLimit: 200,
                    model: 'cpv',
                    cost: 0.1
                },
                userId: 'u-1',
                user: 'foo@bar.com',
                date: jasmine.any(Date)
            }]);
            expect(req.body.pricingHistory[0].date).toBeGreaterThan(oldDate);
            expect(nextSpy).toHaveBeenCalledWith();
        });
    });
    
    describe('notifyEnded', function() {
        var svc, mockColl, mockCursor;
        beforeEach(function() {
            mockCursor = {
                next: jasmine.createSpy('cursor.next()').and.returnValue(q({ id: 'u-2', email: 'owner@c6.com' }))
            };
            mockColl = {
                find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor)
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { id: 'cam-1', name: 'best campaign', status: Status.Expired, user: 'u-2' };
            req.origObj = { id: 'cam-1', name: 'ok campaign', status: Status.Active, user: 'u-2' };
            spyOn(email, 'campaignEnded').and.returnValue(q());
            svc = { _db: mockDb };
        });
        
        it('should look up the owner\'s email and send them a notification', function(done) {
           campModule.notifyEnded(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.find).toHaveBeenCalledWith({ id: 'u-2' }, { fields: { id: 1, email: 1 }, limit: 1 });
                expect(email.campaignEnded).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'owner@c6.com',
                    'best campaign',
                    Status.Expired,
                    'http://selfie.c6.com/review/campaigns',
                    'http://selfie.c6.com/manage/cam-1/manage'
                );
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle any transitions to an end state', function(done) {
            q.all([{ old: Status.Paused, new: Status.Expired  }, { old: Status.Active, new: Status.OutOfBudget },
                   { old: Status.Error, new: Status.Expired  }, { old: Status.Draft, new: Status.OutOfBudget }].map(function(obj) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body.status = obj.new;
                reqCopy.origObj.status = obj.old;
                return campModule.notifyEnded(svc, reqCopy, nextSpy, doneSpy);
            })).then(function(results) {
                expect(nextSpy.calls.count()).toBe(4);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(mockColl.find.calls.count()).toBe(4);
                expect(email.campaignEnded.calls.count()).toBe(4);
                expect(email.campaignEnded.calls.argsFor(0)[3]).toBe(Status.Expired);
                expect(email.campaignEnded.calls.argsFor(1)[3]).toBe(Status.OutOfBudget);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the campaign is not ending', function(done) {
            q.all([{ old: Status.Active, new: Status.Paused  }, { old: Status.Expired, new: Status.OutOfBudget }].map(function(obj) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body.status = obj.new;
                reqCopy.origObj.status = obj.old;
                return campModule.notifyEnded(svc, reqCopy, nextSpy, doneSpy);
            })).then(function(results) {
                expect(nextSpy.calls.count()).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(mockColl.find).not.toHaveBeenCalled();
                expect(email.campaignEnded).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and continue if the user is not found', function(done) {
            mockCursor.next.and.returnValue(q());
            campModule.notifyEnded(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.campaignEnded).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });

        
        it('should warn and continue if looking up the user fails', function(done) {
            mockCursor.next.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.notifyEnded(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.campaignEnded).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });
        
        it('should warn and continue if emailing the user fails', function(done) {
            email.campaignEnded.and.returnValue(q.reject('I GOT A PROBLEM'));
            campModule.notifyEnded(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
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
});

