var flush = true;
describe('userSvc-roles (UT)', function() {
    var roleModule, q, mockLog, logger, CrudSvc, Model, enums, Status, Scope, mockDb, mockColl,
        req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        roleModule      = require('../../bin/userSvc-roles');
        q               = require('q');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc.js');
        Model           = require('../../lib/model');
        enums           = require('../../lib/enums');
        Status          = enums.Status;
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
        
        mockColl = {
            find: jasmine.createSpy('find')
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').andReturn(mockColl)
        };

        req = { uuid: '1234', user: { id: 'u-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    //TODO: test model or schema?

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            mockDb.collection.andCallFake(function(objName) { return { collectionName: objName }; });

            [CrudSvc.prototype.validateUniqueProp, roleModule.validatePolicies, roleModule.checkRoleInUse].forEach(function(fn) {
                spyOn(fn, 'bind').andReturn(fn);
            });

            svc = roleModule.setupSvc(mockDb);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'roles' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('roles');
            expect(svc._prefix).toBe('r');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(roleModule.roleSchema);
        });
        
        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', /^\w+$/);
        });
        
        it('should do additional validation for policies on create and edit', function() {
            expect(svc._middleware.create).toContain(roleModule.validatePolicies);
            expect(svc._middleware.edit).toContain(roleModule.validatePolicies);
            expect(roleModule.validatePolicies.bind).toHaveBeenCalledWith(roleModule, svc);
        });
        
        it('should set some change tracking properties on create and edit', function() {
            expect(svc._middleware.create).toContain(roleModule.setChangeTrackProps);
            expect(svc._middleware.edit).toContain(roleModule.setChangeTrackProps);
        });
        
        it('should prevent deleting in-use roles', function() {
            expect(svc._middleware.delete).toContain(roleModule.checkRoleInUse);
            expect(roleModule.checkRoleInUse.bind).toHaveBeenCalledWith(roleModule, svc);
        });
    });
    
    describe('validatePolicies', function() {
        var svc, policies;
        beforeEach(function() {
            svc = roleModule.setupSvc(mockDb);
            policies = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-1', name: 'pol2' },
                { id: 'p-1', name: 'pol3' }
            ];
            mockColl.find.andCallFake(function() {
                return {
                    toArray: function(cb) {
                        cb(null, policies);
                    }
                };
            });
            req.body = { policies: ['pol1', 'pol2', 'pol3'] };
        });
        
        it('should call next if all policies on the request body exist', function(done) {
            roleModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('policies');
                expect(mockColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if there are no policies on the request body', function(done) {
            delete req.body.policies;
            roleModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all policies are found', function(done) {
            req.body.policies.push('pol4', 'pol5');
            roleModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These policies were not found: [pol4,pol5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3', 'pol4', 'pol5'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            mockColl.find.andReturn({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
            roleModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('setChangeTrackProps', function() {
        it('should set createdBy and lastUpdatedBy', function(done) {
            req.body = { foo: 'bar' };
            roleModule.setChangeTrackProps(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ foo: 'bar', createdBy: 'u-1', lastUpdatedBy: 'u-1' });
                done();
            });
        });
        
        it('should not overwrite the existing createdBy', function(done) {
            req.body = { foo: 'bar' };
            req.origObj = { id: 'r-1', createdBy: 'u-2', lastUpdatedBy: 'u-2' };
            roleModule.setChangeTrackProps(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ foo: 'bar', lastUpdatedBy: 'u-1' });
                done();
            });
        });
    });
    
    describe('checkRoleInUse', function() {
        var svc;
        beforeEach(function() {
            svc = roleModule.setupSvc(mockDb);
            mockColl.count = jasmine.createSpy('coll.count()').andCallFake(function(query, cb) {
                cb(null, 0);
            });
            req.origObj = { id: 'r-1', name: 'role1' };
        });
        
        it('should call next if no users exist with the role', function(done) {
            roleModule.checkRoleInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.count).toHaveBeenCalledWith({roles: 'role1', status: { $ne: Status.Deleted } }, jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if there are users with the role', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb(null, 3); });
            roleModule.checkRoleInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Role still in use by users' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.count).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
            roleModule.checkRoleInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockColl.count).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});
