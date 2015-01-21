var flush = true;
describe('content-categories (UT)', function() {
    var mockLog, CrudSvc, logger, enums, Scope, q;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        catModule       = require('../../bin/content-categories');
        CrudSvc         = require('../../lib/crudSvc');
        enums           = require('../../lib/enums');
        Scope           = enums.Scope;

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

    describe('setupCatSvc', function() {
        it('should setup the category service', function() {
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').andReturn(CrudSvc.prototype.validateUniqueProp);
            var mockColl = { collectionName: 'categories' },
                catSvc = catModule.setupCatSvc(mockColl);

            expect(catSvc instanceof CrudSvc).toBe(true);
            expect(catSvc._prefix).toBe('cat');
            expect(catSvc.objName).toBe('categories');
            expect(catSvc._userProp).toBe(false);
            expect(catSvc._orgProp).toBe(false);
            expect(catSvc._allowPublic).toBe(true);
            expect(catSvc._coll).toBe(mockColl);
            expect(catSvc.createValidator._required).toContain('name');
            expect(catSvc.editValidator._forbidden).toContain('name');
            expect(catSvc._middleware.create).toContain(catModule.adminCreateCheck);
            expect(catSvc._middleware.create).toContain(CrudSvc.prototype.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(catSvc, 'name', /^\w+$/);
        });
    });
    
    describe('adminCreateCheck', function() {
        var req, nextSpy, doneSpy;
        beforeEach(function() {
            req = { uuid: '1234', user: { id: 'u1', permissions: {} } };
            nextSpy = jasmine.createSpy('next');
            doneSpy = jasmine.createSpy('done');
        });
        
        it('should allow admins to create categories', function() {
            req.user.permissions.categories = { create: Scope.All };
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should prevent anyone else from creating categories', function() {
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            req.user.permissions.categories = {};
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            req.user.permissions.categories = {create: Scope.Own};
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.length).toBe(3);
            doneSpy.calls.forEach(function(call) {
                expect(call.args).toEqual([{code: 403, body: 'Not authorized to create categories'}]);
            });
        });
    });
});
