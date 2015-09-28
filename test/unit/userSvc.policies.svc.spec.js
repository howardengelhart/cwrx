var flush = true;
describe('userSvc-policies (UT)', function() {
    var polModule, q, mockLog, logger, CrudSvc, Model, enums, Status, Scope,
        mockDb, mockColl, req, nextSpy, doneSpy, errorSpy;
        
    var mockCfg = {
        policies: {
            allEntities: [
                'advertisers',
                'campaigns',
                'cards',
                'categories',
                'customers',
                'elections',
                'experiences',
                'minireelGroups',
                'orgs',
                'policies',
                'roles',
                'sites',
                'users'
            ]
        }
    };

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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        mockColl = {
            find: jasmine.createSpy('find')
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.returnValue(mockColl)
        };

        req = { uuid: '1234', user: { id: 'u-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            mockDb.collection.and.callFake(function(objName) { return { collectionName: objName }; });

            [CrudSvc.prototype.validateUniqueProp, polModule.checkPolicyInUse, polModule.validateApplications].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });

            svc = polModule.setupSvc(mockDb, mockCfg);
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

        it('should do additional validation for applications on create and edit', function() {
            expect(svc._middleware.create).toContain(polModule.validateApplications);
            expect(svc._middleware.edit).toContain(polModule.validateApplications);
            expect(polModule.validateApplications.bind).toHaveBeenCalledWith(polModule, svc);
        });
        
        it('should prevent deleting in-use policies', function() {
            expect(svc._middleware.delete).toContain(polModule.checkPolicyInUse);
            expect(polModule.checkPolicyInUse.bind).toHaveBeenCalledWith(polModule, svc);
        });
    });

    describe('policy validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            mockColl.collectionName = 'policies';
            svc = polModule.setupSvc(mockDb, mockCfg);
            newObj = { name: 'test', priority: 1 };
            origObj = {};
            requester = { fieldValidation: { policies: {} } };
        });
        
        describe('when handling name', function() {
            it('should fail if the field is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1 });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old pol name', priority: 1 });
            });

            it('should revert the field if defined on edit', function() {
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old pol name', priority: 1 });
            });
        });
        
        describe('when handling priority', function() {
            it('should fail if the field is not a number', function() {
                newObj.priority = 'really high';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'priority must be in format: number' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1 });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.priority;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: priority' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.priority;
                origObj.name = 'old pol name';
                origObj.priority = 2;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old pol name', priority: 2 });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old pol name';
                origObj.priority = 2;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old pol name', priority: 1 });
            });
        });
        
        // user tracking fields
        ['createdBy', 'lastUpdatedBy'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = 'me';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test', priority: 1 });
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    requester.fieldValidation.policies[field] = { __allowed: true };
                    newObj[field] = 'me';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toBe('me');
                });

                it('should fail if the field is not a string', function() {
                    requester.fieldValidation.policies[field] = { __allowed: true };
                    newObj[field] = 1234;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
            });
        });
        
        describe('when handling applications', function() {
            it('should trim the field if set', function() {
                newObj.applications = ['e-app1', 'e-app2'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1 });
            });
            
            it('should be able to allow some requesters to set the field', function() {
                newObj.applications = ['e-app1', 'e-app2'];
                requester.fieldValidation.policies.applications = {
                    __allowed: true,
                    __entries: { __acceptableValues: ['e-app1', 'e-app2', 'e-app3'] }
                };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1, applications: ['e-app1', 'e-app2'] });
            });
            
            it('should fail if the field is not an array of strings', function() {
                newObj.applications = [{ name: 'e-app1' }, { name: 'e-app2' }];
                requester.fieldValidation.policies.applications = {
                    __allowed: true,
                    __entries: { __acceptableValues: ['e-app1', 'e-app2', 'e-app3'] }
                };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'applications must be in format: stringArray' });
            });
            
            it('should fail if the field does not contain acceptable values', function() {
                newObj.applications = ['e-app1', 'e-app4'];
                requester.fieldValidation.policies.applications = {
                    __allowed: true,
                    __entries: { __acceptableValues: ['e-app1', 'e-app2', 'e-app3'] }
                };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'applications[1] is UNACCEPTABLE! acceptable values are: [e-app1,e-app2,e-app3]' });
            });
        });
        
        describe('when handling entitlements', function() {
            it('should trim the field if set', function() {
                newObj.entitlements = { doThings: 'yes' };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1 });
            });
            
            it('should be able to allow some requesters to set the field', function() {
                newObj.entitlements = { doThings: 'yes' };
                requester.fieldValidation.policies.entitlements = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', priority: 1, entitlements: { doThings: 'yes' } });
            });
            
            it('should fail if the field is not an object', function() {
                newObj.entitlements = [{ doThings: 'yes' }, { changeThings: 'no' }];
                requester.fieldValidation.policies.entitlements = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'entitlements must be in format: object' });
            });
        });
        
        ['permissions', 'fieldValidation'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should allow the field to be set', function() {
                    newObj[field] = {};
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual({});
                });
                
                it('should fail if the field is not an object', function() {
                    newObj[field] = 'please let me do things';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: object' });
                });
                
                mockCfg.policies.allEntities.forEach(function(subfield) {
                    describe('subfield ' + subfield, function() {
                        it('should be trimmed when set', function() {
                            newObj[field] = {};
                            newObj[field][subfield] = { someRules: 'yes' };

                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: true, reason: undefined });
                            expect(newObj[field]).toEqual({});
                        });
                        
                        it('should be settable for some requesters', function() {
                            newObj[field] = {};
                            newObj[field][subfield] = { someRules: 'yes' };
                            requester.fieldValidation.policies[field] = {};
                            requester.fieldValidation.policies[field][subfield] = { __allowed: true };

                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: true, reason: undefined });
                            expect(newObj[field][subfield]).toEqual({ someRules: 'yes' });
                        });
                        
                        it('can only be an object', function() {
                            newObj[field] = {};
                            newObj[field][subfield] = 'yes';
                            requester.fieldValidation.policies[field] = {};
                            requester.fieldValidation.policies[field][subfield] = { __allowed: true };

                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: false, reason: field + '.' + subfield + ' must be in format: object' });
                        });
                    });
                });
            });
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
                expect(nextSpy.calls.count()).toBe(2);
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
    
    describe('validateApplications', function() {
        var svc, apps;
        beforeEach(function() {
            svc = polModule.setupSvc(mockDb, mockCfg);
            apps = [{ id: 'e-app1' }, { id: 'e-app2' }, { id: 'e-app3' }];
            mockColl.find.and.callFake(function() {
                return {
                    toArray: function(cb) {
                        cb(null, apps);
                    }
                };
            });
            req.body = { applications: ['e-app1', 'e-app2', 'e-app3'] };
        });
        
        it('should call next if all applications on the request body exist', function(done) {
            polModule.validateApplications(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('experiences');
                expect(mockColl.find).toHaveBeenCalledWith(
                    { id: { $in: ['e-app1', 'e-app2', 'e-app3'] }, 'status.0.status': { $ne: Status.Deleted } },
                    { fields: { id: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if there are no applications on the request body', function(done) {
            delete req.body.applications;
            polModule.validateApplications(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all applications are found', function(done) {
            req.body.applications.push('e-app4', 'e-app5');
            polModule.validateApplications(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These applications were not found: [e-app4,e-app5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalledWith(
                    { id: { $in: ['e-app1', 'e-app2', 'e-app3', 'e-app4', 'e-app5'] }, 'status.0.status': { $ne: Status.Deleted } },
                    { fields: { id: 1 } }
                );
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            mockColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
            polModule.validateApplications(svc, req, nextSpy, doneSpy).catch(errorSpy);
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
    
    describe('checkPolicyInUse', function() {
        var roleColl, userColl, svc;
        beforeEach(function() {
            roleColl = {
                count: jasmine.createSpy('roles.count()').and.callFake(function(query, cb) {
                    cb(null, 0);
                })
            };
            userColl = {
                count: jasmine.createSpy('users.count()').and.callFake(function(query, cb) {
                    cb(null, 0);
                })
            };
            mockDb.collection.and.callFake(function(collName) {
                if (collName === 'roles') return roleColl;
                else if (collName === 'users') return userColl;
                else return { collectionName: 'policies' };
            });
            svc = polModule.setupSvc(mockDb, mockCfg);
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
            roleColl.count.and.callFake(function(query, cb) { cb(null, 1); });
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
            userColl.count.and.callFake(function(query, cb) { cb(null, 5); });
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
            userColl.count.and.callFake(function(query, cb) { cb('users got problems'); });
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
            roleColl.count.and.callFake(function(query, cb) { cb('roles got problems'); });
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
