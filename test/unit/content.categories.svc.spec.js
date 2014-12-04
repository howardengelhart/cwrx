var flush = true;
describe('content (UT)', function() {
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
            spyOn(catModule.validateName, 'bind').andReturn(catModule.validateName);
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
            expect(catSvc._middleware.create).toContain(catModule.validateName);
            expect(catModule.validateName.bind).toHaveBeenCalledWith(catModule, catSvc);
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
    
    describe('validateName', function() {
        var svc, req, nextSpy, doneSpy, catchSpy;
        beforeEach(function() {
            svc = { _coll: {
                findOne: jasmine.createSpy('coll.findOne').andCallFake(function(query, cb) { cb(); })
            } };
            req = { uuid: '1234', user: { id: 'u1' }, body: { name: 'scruffles' } };
            nextSpy = jasmine.createSpy('next');
            doneSpy = jasmine.createSpy('done');
            catchSpy = jasmine.createSpy('errorCatcher');
        });
        
        it('should call next if no category exists with the request name', function(done) {
            catModule.validateName(svc, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).not.toHaveBeenCalled();
                done(); 
            });
        });
        
        it('should call done if the name is invalid', function(done) {
            q.all(['good cat', 'c@t', 'cat\n', '@#)($*)[['].map(function(name) {
                req.body.name = name;
                return catModule.validateName(svc, req, nextSpy, doneSpy).catch(catchSpy);
            })).then(function(results) {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.length).toBe(4);
                doneSpy.calls.forEach(function(call) {
                    expect(call.args).toEqual([{code: 400, body: 'Invalid name'}]);
                });
                expect(catchSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if a category exists with the request name', function(done) {
            svc._coll.findOne.andCallFake(function(query, cb) { cb(null, { cat: 'yes' }); });
            catModule.validateName(svc, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 409, body: 'A category with that name already exists'});
                expect(catchSpy).not.toHaveBeenCalled();
                done(); 
            });
        });
        
        it('should reject if mongo encounters an error', function(done) {
            svc._coll.findOne.andCallFake(function(query, cb) { cb('CAT IS TOO CUTE HALP'); });
            catModule.validateName(svc, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).toHaveBeenCalledWith('CAT IS TOO CUTE HALP');
                done(); 
            });
        });
    });
});
