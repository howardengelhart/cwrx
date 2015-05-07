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
                cardSvc = cardModule.setupCardSvc(mockColl, 'fakeCardCache', 'jobMgr');
                
            expect(cardModule.getPublicCard.bind).toHaveBeenCalledWith(cardModule, cardSvc);
            
            expect(cardSvc instanceof CrudSvc).toBe(true);
            expect(cardSvc._prefix).toBe('rc');
            expect(cardSvc.objName).toBe('cards');
            expect(cardSvc._userProp).toBe(true);
            expect(cardSvc._orgProp).toBe(true);
            expect(cardSvc._allowPublic).toBe(true);
            expect(cardSvc._coll).toBe(mockColl);
            expect(cardSvc._cardCache).toBe('fakeCardCache');
            expect(cardSvc.jobManager).toBe('jobMgr');
            
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
        var req, cardSvc, mockCard;
        beforeEach(function() {
            req = { uuid: '1234' };
            mockCard = { id: 'rc-1', status: Status.Active, user: 'u-1', org: 'o-1', foo: 'bar' };
            cardSvc = {
                formatOutput: jasmine.createSpy('svc.formatOutput').andReturn('formatted'),
                _cardCache: {
                    getPromise: jasmine.createSpy('cache.getPromise').andCallFake(function() {
                        return q([mockCard]);
                    })
                }
            };
        });
        
        it('should retrieve a card from the cache', function(done) {
            cardModule.getPublicCard(cardSvc, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual('formatted');
                expect(cardSvc._cardCache.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalledWith({id: 'rc-1', status: Status.Active, foo: 'bar'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if nothing was found', function(done) {
            cardSvc._cardCache.getPromise.andReturn(q([]));
            cardModule.getPublicCard(cardSvc, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(cardSvc._cardCache.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the card is not active', function(done) {
            mockCard.status = Status.Pending;
            cardModule.getPublicCard(cardSvc, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(cardSvc._cardCache.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the promise was rejected', function(done) {
            cardSvc._cardCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            cardModule.getPublicCard(cardSvc, 'rc-1', req).then(function(resp) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(cardSvc._cardCache.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('handlePublicGet', function() {
    
    });
});
