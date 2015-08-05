var flush = true;
describe('userSvc-policies (UT)', function() {
    var polModule, q, mockLog, logger, CrudSvc, Model, enums, Status, Scope, mockDb, mockColl,
        req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        polModule       = require('../../bin/userSvc-policies');
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

            [CrudSvc.prototype.validateUniqueProp, polModule.checkPolicyInUse].forEach(function(fn) {
                spyOn(fn, 'bind').andReturn(fn);
            });

            svc = polModule.setupSvc(mockDb);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'policies' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('policies');
            expect(svc._prefix).toBe('p');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(polModule.policySchema);
        });
        
        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', /^\w+$/);
        });
        
        it('should set some change tracking properties on create and edit', function() {
            expect(svc._middleware.create).toContain(polModule.setChangeTrackProps);
            expect(svc._middleware.edit).toContain(polModule.setChangeTrackProps);
        });
        
        it('should do additional validation for permissions on create and edit', function() {
            expect(svc._middleware.create).toContain(polModule.validatePermissions);
            expect(svc._middleware.edit).toContain(polModule.validatePermissions);
        });
        
        it('should prevent deleting in-use policies', function() {
            expect(svc._middleware.delete).toContain(polModule.checkPolicyInUse);
            expect(polModule.checkPolicyInUse.bind).toHaveBeenCalledWith(polModule, svc);
        });
    });

    
    describe('setChangeTrackProps', function() {
        it('should set createdBy and lastUpdatedBy', function(done) {
            req.body = { foo: 'bar' };
            polModule.setChangeTrackProps(req, nextSpy, doneSpy);
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
            req.origObj = { id: 'p-1', createdBy: 'u-2', lastUpdatedBy: 'u-2' };
            polModule.setChangeTrackProps(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ foo: 'bar', lastUpdatedBy: 'u-1' });
                done();
            });
        });
    });
    
    describe('validatePermissions', function() {
        beforeEach(function() {
            req.body = {
                permissions: {
                    puppies: { read: Scope.All, create: Scope.Own, edit: Scope.Org, delete: Scope.Deny },
                    kitties: { read: Scope.Own, edit: Scope.All }
                }
            };
        });
        
        it('should skip if there are no permissions on the request body', function(done) {
            var req1 = { body: { id: 'p-1' } };
            var req2 = { body: { id: 'p-2', permissions: {} } };
            polModule.validatePermissions(req1, nextSpy, doneSpy);
            polModule.validatePermissions(req2, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy.calls.length).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req1.body).toEqual({ id: 'p-1' });
                expect(req2.body).toEqual({ id: 'p-2', permissions: {} });
                done();
            });
        });
        
        it('should leave the permissions and call next if they are valid', function(done) {
            polModule.validatePermissions(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    permissions: {
                        puppies: { read: Scope.All, create: Scope.Own, edit: Scope.Org, delete: Scope.Deny },
                        kitties: { read: Scope.Own, edit: Scope.All },
                    }
                });
                done();
            });
        });
        
        it('should trim off invalid verbs', function(done) {
            req.body.permissions.puppies = { pet: Scope.All };
            polModule.validatePermissions(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    permissions: {
                        puppies: {},
                        kitties: { read: Scope.Own, edit: Scope.All },
                    }
                });
                done();
            });
        });
        
        it('should trim off invalid scopes', function(done) {
            req.body.permissions.kitties = { read: 'onlyCuteOnes', edit: Scope.Own };
            polModule.validatePermissions(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    permissions: {
                        puppies: { read: Scope.All, create: Scope.Own, edit: Scope.Org, delete: Scope.Deny },
                        kitties: { edit: Scope.Own },
                    }
                });
                done();
            });
        });
    });
    
    describe('checkPolicyInUse', function() {
        var roleColl, userColl, svc;
        beforeEach(function() {
            roleColl = {
                count: jasmine.createSpy('roles.count()').andCallFake(function(query, cb) {
                    cb(null, 0);
                })
            };
            userColl = {
                count: jasmine.createSpy('users.count()').andCallFake(function(query, cb) {
                    cb(null, 0);
                })
            };
            mockDb.collection.andCallFake(function(collName) {
                if (collName === 'roles') return roleColl;
                else if (collName === 'users') return userColl;
                else return { collectionName: 'policies' };
            });
            svc = polModule.setupSvc(mockDb);
            req.origObj = { id: 'p-1', name: 'pol1' };
        });
        
        it('should call next if the policy is not in use', function(done) {
            polModule.checkPolicyInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('roles');
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(roleColl.count).toHaveBeenCalledWith({ policies: 'pol1', status: { $ne: Status.Deleted } },
                    jasmine.any(Function));
                expect(userColl.count).toHaveBeenCalledWith({ policies: 'pol1', status: { $ne: Status.Deleted } },
                    jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if roles use the policy', function(done) {
            roleColl.count.andCallFake(function(query, cb) { cb(null, 1); });
            polModule.checkPolicyInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Policy still in use by users or roles' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.count).toHaveBeenCalled();
                expect(userColl.count).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 400 if roles use the policy', function(done) {
            userColl.count.andCallFake(function(query, cb) { cb(null, 5); });
            polModule.checkPolicyInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Policy still in use by users or roles' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.count).toHaveBeenCalled();
                expect(userColl.count).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if users.count() fails', function(done) {
            userColl.count.andCallFake(function(query, cb) { cb('users got problems'); });
            polModule.checkPolicyInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(roleColl.count).toHaveBeenCalled();
                expect(userColl.count).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });

        it('should reject if roles.count() fails', function(done) {
            roleColl.count.andCallFake(function(query, cb) { cb('roles got problems'); });
            polModule.checkPolicyInUse(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(roleColl.count).toHaveBeenCalled();
                expect(userColl.count).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});
