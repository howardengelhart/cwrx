var flush = true;
describe('content-cards (UT)', function() {
    var q, cardModule, QueryCache, FieldValidator, CrudSvc, Status, logger, mockLog;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        cardModule      = require('../../bin/content-cards');
        CrudSvc         = require('../../lib/crudSvc');
        logger          = require('../../lib/logger');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
        Status          = require('../../lib/enums').Status;

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
    });

    describe('setupCardSvc', function() {
        it('should setup the card service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(cardModule.getPublicCard, 'bind').andReturn(cardModule.getPublicCard);
            spyOn(FieldValidator, 'orgFunc').andCallThrough();
            spyOn(FieldValidator, 'userFunc').andCallThrough();

            var mockColl = { collectionName: 'cards' },
                cardSvc = cardModule.setupCardSvc(mockColl, { caches: 'yes' });
                
            expect(cardModule.getPublicCard.bind).toHaveBeenCalledWith(cardModule, cardSvc, { caches: 'yes' });
            
            expect(cardSvc instanceof CrudSvc).toBe(true);
            expect(cardSvc._prefix).toBe('rc');
            expect(cardSvc.objName).toBe('cards');
            expect(cardSvc._userProp).toBe(true);
            expect(cardSvc._orgProp).toBe(true);
            expect(cardSvc._allowPublic).toBe(true);
            expect(cardSvc._coll).toBe(mockColl);
            
            expect(cardSvc.createValidator._required).toContain('campaignId');
            expect(Object.keys(cardSvc.createValidator._condForbidden)).toEqual(['user', 'org']);
            expect(Object.keys(cardSvc.editValidator._condForbidden)).toEqual(['user', 'org']);
            expect(FieldValidator.userFunc).toHaveBeenCalledWith('cards', 'create');
            expect(FieldValidator.userFunc).toHaveBeenCalledWith('cards', 'edit');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('cards', 'create');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('cards', 'edit');
            
            expect(cardSvc._middleware.read).toEqual([CrudSvc.prototype.preventGetAll]);
        });
    });
    
    describe('getPublicCard', function() {
        var req, cardSvc, mockCard, mockCamp, caches;
        beforeEach(function() {
            req = { uuid: '1234' };
            mockCard = {
                id: 'rc-1',
                campaignId: 'cam-1',
                status: Status.Active,
                user: 'u-1',
                org: 'o-1',
                foo: 'bar'
            };
            mockCamp = {
                id: 'cam-1',
                status: Status.Active,
                user: 'u-1',
                org: 'o-1',
                advertiserId: 'a-1',
                customerId: 'cu-1',
                cards: [
                    { id: 'rc-1', adtechId: 11, bannerId: 1234, bannerNumber: 2 },
                    { id: 'rc-2', adtechId: 12, bannerId: 5678, bannerNumber: 1 }
                ]
            };
            caches = {
                cards: {
                    getPromise: jasmine.createSpy('caches.cards.getPromise').andCallFake(function() {
                        return q([mockCard]);
                    })
                },
                campaigns: {
                    getPromise: jasmine.createSpy('caches.campaigns.getPromise').andCallFake(function() {
                        return q([mockCamp]);
                    })
                }
            };
            cardSvc = {
                formatOutput: jasmine.createSpy('svc.formatOutput').andCallFake(function(card) {
                    card.formatted = true;
                    return card;
                })
            };
        });
        
        it('should retrieve a card from the cache', function(done) {
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual({
                    id: 'rc-1',
                    campaignId: 'cam-1',
                    status: Status.Active,
                    foo: 'bar',
                    advertiserId: 'a-1',
                    adtechId: 11,
                    bannerId: 2,
                    formatted: true
                });
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the card was not found', function(done) {
            caches.cards.getPromise.andReturn(q([]));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card is not active', function(done) {
            mockCard.status = Status.Pending;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s campaign was not found', function(done) {
            caches.campaigns.getPromise.andReturn(q([]));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s campaign is not active', function(done) {
            mockCamp.status = Status.Pending;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the card does not exist in the campaign', function(done) {
            mockCamp.cards[0].id = 'rc-2';
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s entry in the campaign has no adtechId', function(done) {
            delete mockCamp.cards[0].adtechId;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the card promise was rejected', function(done) {
            caches.cards.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('handlePublicGet', function() {
        var req, res, cardSvc, config;
        beforeEach(function() {
            req = { uuid: '1234', params: { id: 'e-1' }, originHost: 'http://cinema6.com' };
            res = {
                header: jasmine.createSpy('res.header()')
            };
            cardSvc = {
                getPublicCard: jasmine.createSpy('cardSvc.getPublicCard()').andReturn(q({ card: 'yes' }))
            };
            config = { cacheTTLs: { cloudFront: 5 } };
        });
        
        it('should set headers and return a card', function(done) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { card: 'yes' } });
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('e-1', req);
                expect(res.header.calls.length).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if no card is found', function(done) {
            cardSvc.getPublicCard.andReturn(q());
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Card not found' });
                expect(res.header.calls.length).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 if getPublicCard fails', function(done) {
            cardSvc.getPublicCard.andReturn(q.reject('I GOT A PROBLEM'));
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: { error: 'Error retrieving card', detail: 'I GOT A PROBLEM' } });
                expect(res.header.calls.length).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=60');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the extension is js', function() {
            beforeEach(function() {
                req.params.ext = 'js';
            });

            it('should return the card as a CommonJS module', function(done) {
                cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: 'module.exports = {"card":"yes"};' });
                    expect(cardSvc.getPublicCard).toHaveBeenCalledWith('e-1', req);
                    expect(res.header.calls.length).toBe(2);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                    expect(res.header).toHaveBeenCalledWith('content-type', 'application/javascript');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter the response if no card is found', function(done) {
                cardSvc.getPublicCard.andReturn(q());
                cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 404, body: 'Card not found' });
                    expect(res.header.calls.length).toBe(1);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
    });
});
