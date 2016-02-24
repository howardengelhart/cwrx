var flush = true;
describe('content-categories (UT)', function() {
    var catModule, mockLog, CrudSvc, Model, logger, enums, Scope, q;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        catModule       = require('../../bin/content-categories');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
    });

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            svc = catModule.setupSvc({ collectionName: 'categories' });
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'categories' });
            expect(svc.objName).toBe('categories');
            expect(svc._prefix).toBe('cat');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(catModule.catSchema);
        });
        
        it('should check that the user has admin permissions on create', function() {
            expect(svc._middleware.create).toContain(catModule.adminCreateCheck);
        });
    });
    
    describe('category validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = catModule.setupSvc({ collectionName: 'categories' });
            newObj = {};
            origObj = {};
            requester = { fieldValidation: { categories: {} } };
        });

        ['name', 'type', 'source', 'externalId', 'label'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a string', function() {
                    newObj[field] = 123;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
                
                it('should allow the field to be set', function() {
                    newObj[field] = 'foo';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('foo');
                });
            });
        });
    });
    
    describe('adminCreateCheck', function() {
        var req, nextSpy, doneSpy;
        beforeEach(function() {
            req = { uuid: '1234', user: { id: 'u-1' }, requester: { id: 'u-1', permissions: {} } };
            nextSpy = jasmine.createSpy('next');
            doneSpy = jasmine.createSpy('done');
        });
        
        it('should allow admins to create categories', function() {
            req.requester.permissions.categories = { create: Scope.All };
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should prevent anyone else from creating categories', function() {
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            req.requester.permissions.categories = {};
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            req.requester.permissions.categories = {create: Scope.Own};
            catModule.adminCreateCheck(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(3);
            doneSpy.calls.all().forEach(function(call) {
                expect(call.args).toEqual([{code: 403, body: 'Not authorized to create categories'}]);
            });
        });
    });
});
