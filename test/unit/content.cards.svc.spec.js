var flush = true;
describe('content-cards (UT)', function() {
    var cardModule, FieldValidator, CrudSvc;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        cardModule      = require('../../bin/content-cards');
        CrudSvc         = require('../../lib/crudSvc');
        FieldValidator  = require('../../lib/fieldValidator');
    });

    describe('setupCardSvc', function() {
        it('should setup the card service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(FieldValidator, 'orgFunc').andCallThrough();
            spyOn(FieldValidator, 'userFunc').andCallThrough();
            var mockColl = { collectionName: 'cards' },
                cardSvc = cardModule.setupCardSvc(mockColl);
            
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
            expect(cardSvc._middleware.read).toContain(CrudSvc.prototype.preventGetAll);
        });
    });
});
