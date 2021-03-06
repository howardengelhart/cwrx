var flush = true;
describe('userSvc-roles (UT)', function() {
    var roleModule, q, mockLog, logger, CrudSvc, Model, enums, Status, Scope,
        mockDb, mockColl, req, nextSpy, doneSpy, errorSpy;

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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        mockColl = {
            find: jasmine.createSpy('find')
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.returnValue(mockColl)
        };

        req = { uuid: '1234', user: { id: 'u-1' }, requester: { id: 'u-1', permissions: {} } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            mockDb.collection.and.callFake(function(objName) { return { collectionName: objName }; });

            [CrudSvc.prototype.validateUniqueProp, roleModule.validatePolicies, roleModule.checkRoleInUse].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
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
    
    describe('role validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            mockColl.collectionName = 'roles';
            svc = roleModule.setupSvc(mockDb);
            newObj = { name: 'test', foo: 'bar' };
            origObj = {};
            requester = { fieldValidation: { roles: {} } };
        });
        
        describe('when handling name', function() {
            it('should fail if the name is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });
            
            it('should allow the name to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', foo: 'bar' });
            });

            it('should fail if the name is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });
            
            it('should pass if the name was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old role name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old role name', foo: 'bar' });
            });

            it('should revert the name if defined on edit', function() {
                origObj.name = 'old role name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old role name', foo: 'bar' });
            });
        });
        
        // user tracking fields
        ['createdBy', 'lastUpdatedBy'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = 'me';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test', foo: 'bar' });
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    requester.fieldValidation.roles[field] = { __allowed: true };
                    newObj[field] = 'me';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toBe('me');
                });

                it('should fail if the field is not a string', function() {
                    requester.fieldValidation.roles[field] = { __allowed: true };
                    newObj[field] = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
            });
        });
        
        describe('when handling policies', function() {
            it('should fail if the field is not an array of strings', function() {
                newObj.policies = [{ name: 'pol1' }, { name: 'pol2' }];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'policies must be in format: stringArray' });
            });
            
            it('should allow the field to be set', function() {
                newObj.policies = ['pol1', 'pol2'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', foo: 'bar', policies: ['pol1', 'pol2'] });
            });
            
            it('should be able to prevent some requesters from setting the field', function() {
                requester.fieldValidation.roles.policies = { __allowed: false };
                newObj.policies = ['pol1', 'pol2'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', foo: 'bar' });
            });
        });
    });
    
    describe('validatePolicies', function() {
        var svc, policies;
        beforeEach(function() {
            svc = roleModule.setupSvc(mockDb);
            policies = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-2', name: 'pol2' },
                { id: 'p-3', name: 'pol3' }
            ];
            mockColl.find.and.callFake(function() {
                return {
                    toArray: function(cb) {
                        return q(policies);
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
            mockColl.find.and.returnValue({ toArray: function() { return q.reject('I GOT A PROBLEM'); } });
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
            mockColl.count = jasmine.createSpy('cursor.count').and.returnValue(q(0));
            req.origObj = { id: 'r-1', name: 'role1' };
        });
        
        it('should call next if no users exist with the role', function(done) {
            roleModule.checkRoleInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.count).toHaveBeenCalledWith({roles: 'role1', status: { $ne: Status.Deleted } });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if there are users with the role', function(done) {
            mockColl.count.and.returnValue(q(3));
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
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));
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
