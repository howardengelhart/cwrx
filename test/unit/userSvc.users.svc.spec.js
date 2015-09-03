var flush = true;
describe('userSvc (UT)', function() {
    var userModule, q, bcrypt, mockLog, uuid, logger, CrudSvc, Model, mongoUtils, email,
        objUtils, req, userSvc, mockDb, nextSpy, doneSpy, errorSpy;

    var enums = require('../../lib/enums'),
        Status = enums.Status,
        Scope = enums.Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        userModule      = require('../../bin/userSvc-users');
        q               = require('q');
        bcrypt          = require('bcrypt');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc.js');
        Model           = require('../../lib/model.js');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
        email           = require('../../lib/email');

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
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        req = {uuid: '1234'};
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
        
        mockDb = {
            collection: jasmine.createSpy('db.collection()').andCallFake(function(objName) {
                return { collectionName: objName };
            })
        };
    });
    
    describe('setupSvc', function() {
        var result;

        var boundFns;

        function equals(array1, array2) {
            if (!array1 || !array2) { return false; }
            if (array1.length !== array2.length) { return false; }

            return array1.every(function(array1Value, index) {
                var array2Value = array2[index];

                return array1Value === array2Value;
            });
        }

        function getBoundFn(original, argParams) {
            var index = 0;
            var length = boundFns.length;

            var call;
            for (; index < length; index++) {
                call = boundFns[index];

                if (call.original === original && equals(call.args, argParams || [])) {
                    return call.bound;
                }
            }

            return null;
        }

        beforeEach(function() {
            var bind = Function.prototype.bind;
            boundFns = [];
            [CrudSvc.prototype.preventGetAll, CrudSvc.prototype.validateUniqueProp, userModule.checkExistingWithNewEmail,
             userModule.hashProp, userModule.validateRoles, userModule.validatePolicies].forEach(function(fn) {
                spyOn(fn, 'bind').andCallFake(function() {
                    var boundFn = bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });

            result = userModule.setupSvc(mockDb);
        });

        it('should return a CrudSvc', function() {
            expect(result).toEqual(jasmine.any(CrudSvc));
            expect(result._coll).toEqual({ collectionName: 'users' });
            expect(result._db).toBe(mockDb);
            expect(result._prefix).toBe('u');
            expect(result._userProp).toBe(false);
            expect(result.model).toEqual(jasmine.any(Model));
            expect(result.model.schema).toBe(userModule.userSchema);
        });

        it('should prevent getting all users', function() {
            expect(result.preventGetAll.bind).toHaveBeenCalledWith(result);
            expect(result._middleware.read).toContain(getBoundFn(result.preventGetAll, [result]));
        });

        it('should hash the user\'s passwords when creating', function() {
            expect(userModule.hashProp.bind).toHaveBeenCalledWith(userModule, 'password');
            expect(result._middleware.create).toContain(getBoundFn(userModule.hashProp, [userModule, 'password']));
        });

        it('should set defaults on the user when creating', function() {
            expect(result._middleware.create).toContain(userModule.setupUser);
        });

        it('should ensure the uniqueness of the email field when creating', function() {
            expect(result.validateUniqueProp.bind).toHaveBeenCalledWith(result, 'email', null);
            expect(result._middleware.create).toContain(getBoundFn(result.validateUniqueProp, [result, 'email', null]));
            expect(result._middleware.create.indexOf(getBoundFn(result.validateUniqueProp, [result, 'email', null]))).toBeGreaterThan(result._middleware.create.indexOf(userModule.setupUser));
        });
        
        it('should do additional validation for roles on create and edit', function() {
            expect(userModule.validateRoles.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.create).toContain(getBoundFn(userModule.validateRoles, [userModule, result]));
        });
        
        it('should do additional validation for policies on create and edit', function() {
            expect(userModule.validatePolicies.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.create).toContain(getBoundFn(userModule.validatePolicies, [userModule, result]));
        });
        
        it('should do additional validation for the password on create and edit', function() {
            expect(result._middleware.create).toContain(userModule.validatePassword);
            expect(result._middleware.edit).toContain(userModule.validatePassword);
        });

        it('should prevent the user from deleting themselves', function() {
            expect(result._middleware.delete).toContain(userModule.preventSelfDeletion);
        });

        it('should hash the user\'s password when changing it', function() {
            expect(userModule.hashProp.bind).toHaveBeenCalledWith(userModule, 'newPassword');
            expect(result._middleware.changePassword).toContain(getBoundFn(userModule.hashProp, [userModule, 'newPassword']));
        });

        it('should prevent the user from changing their email to another user\'s email', function() {
            expect(userModule.checkExistingWithNewEmail.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.changeEmail).toContain(getBoundFn(userModule.checkExistingWithNewEmail, [userModule, result]));
        });

        it('should only allow certain users to perform a forceLogout', function() {
            expect(result._middleware.forceLogout).toContain(userModule.authorizeForceLogout);
        });

        it('should remove sensitive fields from users when they are retrieved from mongo', function() {
            expect(result.transformMongoDoc).toBe(mongoUtils.safeUser);
        });

        it('should check/query user scope via the user\'s ID property', function() {
            expect(result.checkScope).toBe(userModule.checkScope);
            expect(result.userPermQuery).toBe(userModule.userPermQuery);
        });
    });
    
    describe('user validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb);
            newObj = { email: 'test@me.com', password: 'pass' };
            origObj = {};
            requester = { fieldValidation: { users: {} } };
        });
        
        describe('when handling email', function() {
            it('should fail if the field is not a string', function() {
                newObj.email = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'email must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
            });
            
            it('should fail if the field is not defined', function() {
                delete newObj.email;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: email' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                origObj.email = 'old value';
                delete newObj.email;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj.email).toEqual('old value');
            });
            
            it('should revert the field on edit', function() {
                origObj.email = 'old value';
                requester.fieldValidation.users.email = { __unchangeable: false };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj.email).toEqual('old value');
            });
        });

        describe('when handling password', function() {
            it('should fail if the field is not a string', function() {
                newObj.password = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'password must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
            });
            
            it('should pass if the field is not defined on edit', function() {
                delete newObj.password;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true });
                expect(newObj).toEqual({ email: 'test@me.com' });
            });
        });

        // locked, forbidden fields
        ['permissions', 'fieldValidation', 'entitlements', 'applications'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });
                
                it('should not allow any requesters to set the field', function() {
                    requester.fieldValidation.users[field] = { __allowed: true };
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });
            });
        });

        // roles and policies: forbidden but overridable
        ['roles', 'policies'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = ['thing1', 'thing2'];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = ['thing1', 'thing2'];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true });
                    expect(newObj[field]).toEqual(['thing1', 'thing2']);
                });
                
                it('should fail if the field is not an array of strings', function() {
                    newObj[field] = [{ name: 'thing1' }, { name: 'thing2' }];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: stringArray' });
                });
                
                it('should fail if the field does not contain acceptable values', function() {
                    newObj[field] = ['thing1', 'thing4'];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + '[1] is UNACCEPTABLE! acceptable values are: [thing1,thing2,thing3]' });
                });
            });
        });
    });

    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    users: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var users = [{ id: 'u-1234', org: 'o-1234'},
                         { id: 'u-4567', org: 'o-1234'},
                         { id: 'u-1234', org: 'o-4567'},
                         { id: 'u-4567', org: 'o-4567'}];

            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'read');
            })).toEqual(users);
            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'edit');
            })).toEqual([users[0], users[1], users[2]]);
            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'delete');
            })).toEqual([users[0], users[2]]);
        });

        it('should sanity-check the user permissions object', function() {
            var target = { id: 'u-1' };
            expect(userModule.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users = {};
            requester.permissions.orgs = { read: Scope.All };
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = '';
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = Scope.All;
            expect(userModule.checkScope(requester, target, 'read')).toBe(true);
        });
    });

    describe('userPermQuery', function() {
        var query, requester;
        beforeEach(function() {
            query = { org: 'o-1' };
            requester = { id: 'u-1', org: 'o-1', permissions: { users: { read: Scope.Own } } };
        });

        it('should just check that the user is not deleted if the requester is an admin', function() {
            requester.permissions.users.read = Scope.All;
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted } });
            expect(query).toEqual({org: 'o-1'});
        });

        it('should check that the ids match if the requester has Scope.Own', function() {
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
        });

        it('should check that the ids or orgs match if the requester has Scope.Org', function() {
            requester.permissions.users.read = Scope.Org;
            expect(userModule.userPermQuery(query, requester))
                .toEqual({org: 'o-1', status: {$ne: Status.Deleted}, $or: [{org: 'o-1'}, {id: 'u-1'}]});
        });

        it('should log a warning if the requester has an invalid scope', function() {
            requester.permissions.users.read = 'alfkjdf';
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });

    describe('setupUser(req, next, done)', function() {
        var req, next, done;

        beforeEach(function() {
            req = {
                body: {
                    email: 'Josh@Cinema6.com',
                    applications: ['e-4b10000923e73e', 'e-9c70d81e44c56f'],
                    config: {
                        studio: { foo: 'bar' }
                    },
                    roles: ['base', 'selfie'],
                    policies: ['denyCampaigns']
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            userModule.setupUser(req, next, done);
        });

        it('should make the email lowercase', function() {
            expect(req.body.email).toBe('josh@cinema6.com');
        });

        it('should call next()', function() {
            expect(next).toHaveBeenCalledWith();
        });

        it('should not overwrite the specified applications, roles, policies or config', function() {
            expect(req.body).toEqual({
                email: 'josh@cinema6.com',
                applications: ['e-4b10000923e73e', 'e-9c70d81e44c56f'],
                config: { studio: { foo: 'bar' } },
                roles: ['base', 'selfie'],
                policies: ['denyCampaigns']
            });
        });

        describe('if the user has no config', function() {
            beforeEach(function() {
                next.reset();
                delete req.body.config;

                userModule.setupUser(req, next, done);
            });

            it('should give the user a config object', function() {
                expect(req.body.config).toEqual({});
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalledWith();
            });
        });
        
        describe('if the user has no policies', function() {
            beforeEach(function() {
                next.reset();
                delete req.body.policies;

                userModule.setupUser(req, next, done);
            });

            it('should give the user a policies array', function() {
                expect(req.body.policies).toEqual([]);
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalledWith();
            });
        });
    });
    
    describe('hashProp(prop, req, next, done)', function() {
        var prop, req, next, done;
        var success, failure;
        var salt, hash;
        var hashCallback;

        beforeEach(function(proceed) {
            prop = 'someProp';
            req = {
                user: { id: 'u-978ae0224eb7aa' },
                body: {
                    someProp: 'MySupp3rS3cur3P@ssw0rd'
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            salt = '1db621a7d17a0bc84a3a6016c323';
            hash = '234c8eccef2c27732686dd2dbe6eedaadf7fd061d81e5fa26386607d';

            spyOn(bcrypt, 'hash').andCallFake(function(data, salt, cb) {
                hashCallback = cb;
            });
            spyOn(bcrypt, 'genSaltSync').andReturn(salt);

            userModule.hashProp(prop, req, next, done).then(success, failure);

            q().then(proceed);
        });

        it('should hash the prop', function() {
            expect(bcrypt.hash).toHaveBeenCalledWith(req.body[prop], salt, jasmine.any(Function));
        });

        [null, undefined, true, false, 20, ''].forEach(function(value) {
            describe('if the prop is "' + value + '"', function() {
                beforeEach(function(proceed) {
                    next.reset();
                    done.reset();
                    success.reset();
                    failure.reset();
                    bcrypt.hash.reset();
                    prop = 'foo';
                    req.body[prop] = value;

                    userModule.hashProp(prop, req, next, done).then(success, failure);
                    q().then(proceed);
                });

                it('should not hash the prop', function() {
                    expect(bcrypt.hash).not.toHaveBeenCalled();
                });

                it('should not call next()', function() {
                    expect(next).not.toHaveBeenCalled();
                });

                it('should call done()', function() {
                    expect(done).toHaveBeenCalledWith({
                        code: 400,
                        body: prop + ' is missing/not valid.'
                    });
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalled();
                });
            });
        });

        describe('if there is an error', function() {
            var error;

            beforeEach(function(proceed) {
                error = new Error('I GOT A PROBLEM.');
                hashCallback(error);
                q().then(proceed);
            });

            it('should reject the promise', function() {
                expect(failure).toHaveBeenCalledWith(error);
            });

            it('should not update the prop', function() {
                expect(req.body[prop]).toBe('MySupp3rS3cur3P@ssw0rd');
            });

            it('should not call next()', function() {
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe('if there is no error', function() {
            beforeEach(function(proceed) {
                hashCallback(null, hash);
                q().then(proceed);
            });

            it('should set the password to the hash', function() {
                expect(req.body[prop]).toBe(hash);
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalled();
            });

            it('should fulfill the promise', function() {
                expect(success).toHaveBeenCalled();
            });
        });
    });
    
    describe('validateRoles(svc, req, next, done)', function() {
        var roleColl, roles, svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb);
            roles = [
                { id: 'r-1', name: 'role1' },
                { id: 'r-2', name: 'role2' },
                { id: 'r-3', name: 'role3' }
            ];
            roleColl = {
                find: jasmine.createSpy('roles.find()').andCallFake(function() {
                    return { toArray: function(cb) {
                        cb(null, roles);
                    } };
                })
            };
            mockDb.collection.andReturn(roleColl);
            req.body = { roles: ['role1', 'role2', 'role3'] };
        });
        
        it('should call next if all roles on the request body exist', function(done) {
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(roleColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['role1', 'role2', 'role3'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if there are no roles on the request body', function(done) {
            delete req.body.roles;
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.find).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all roles are found', function(done) {
            req.body.roles.push('role4', 'role5');
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These roles were not found: [role4,role5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['role1', 'role2', 'role3', 'role4', 'role5'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            roleColl.find.andReturn({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(roleColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('validatePolicies(svc, req, next, done)', function() {
        var polColl, roles, svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb);
            roles = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-2', name: 'pol2' },
                { id: 'p-3', name: 'pol3' }
            ];
            polColl = {
                find: jasmine.createSpy('policies.find()').andCallFake(function() {
                    return { toArray: function(cb) {
                        cb(null, roles);
                    } };
                })
            };
            mockDb.collection.andReturn(polColl);
            req.body = { policies: ['pol1', 'pol2', 'pol3'] };
        });
        
        it('should call next if all policies on the request body exist', function(done) {
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('policies');
                expect(polColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if there are no policies on the request body', function(done) {
            delete req.body.policies;
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(polColl.find).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all policies are found', function(done) {
            req.body.policies.push('pol4', 'pol5');
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These policies were not found: [pol4,pol5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(polColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3', 'pol4', 'pol5'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            polColl.find.andReturn({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(polColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('preventSelfDeletion(req, next, done)', function() {
        var req, next, done;

        beforeEach(function() {
            req = {
                params: { id: 'u-848a8c6d11ddcd' },
                user: { id: 'u-4b023952363514' }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
        });

        describe('if the user is not trying to delete themselves', function() {
            beforeEach(function() {
                expect(req.user.id).not.toBe(req.params.id);

                userModule.preventSelfDeletion(req, next, done);
            });

            it('should not log a warning', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
            });

            it('should not call done()', function() {
                expect(done).not.toHaveBeenCalled();
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalled();
            });
        });

        describe('if the user is trying to delete themselves', function() {
            beforeEach(function() {
                req.params.id = req.user.id;

                userModule.preventSelfDeletion(req, next, done);
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should not call next()', function() {
                expect(next).not.toHaveBeenCalled();
            });

            it('should call done() with an error response', function() {
                expect(done).toHaveBeenCalledWith({
                    code: 400,
                    body: 'You cannot delete yourself'
                });
            });
        });
    });

    describe('changePassword(svc, req, emailSender)', function() {
        var deferred;
        var users;
        var svc, req, emailSender;
        var result;

        beforeEach(function() {
            deferred = q.defer();

            users = {
                update: jasmine.createSpy('users.update()')
            };

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod(req, actionName, cb)').andReturn(deferred.promise),
                _coll: users
            };
            req = {
                user: {
                    id: 'u-7e4895c648c57d'
                },
                body: {
                    newPassword: 'f081611cbba5acab5d3051b32698238a7c637419ff87a5fc6e66233b',
                    email: 'evan@cinema6.com'
                }
            };
            emailSender = 'johnnytestmonkey@cinema6.com';

            result = userModule.changePassword(svc, req, emailSender);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'changePassword', jasmine.any(Function));
            expect(result).toBe(deferred.promise);
        });

        describe('the callback', function() {
            var callback;
            var success, failure;
            var editObjectDeferred;

            beforeEach(function(done) {
                callback = svc.customMethod.mostRecentCall.args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                editObjectDeferred = q.defer();
                spyOn(mongoUtils, 'editObject').andReturn(editObjectDeferred.promise);

                callback().then(success, failure);

                q().then(done);
            });

            it('should update the user with the new password', function() {
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, { password: req.body.newPassword }, req.user.id);
            });

            describe('if the update fails', function() {
                var error;

                beforeEach(function(done) {
                    error = new Error('It didn\'t work.');
                    spyOn(email, 'notifyPwdChange');

                    editObjectDeferred.reject(error);
                    q().then(done);
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should not send an email', function() {
                    expect(email.notifyPwdChange).not.toHaveBeenCalled();
                });
            });

            describe('if the update succeeds', function() {
                var notifyDeffered;

                beforeEach(function(done) {
                    notifyDeffered = q.defer();
                    spyOn(email, 'notifyPwdChange').andReturn(notifyDeffered.promise);

                    editObjectDeferred.resolve();
                    q().then(done);
                });

                it('should send an email notifying the user of the password change', function() {
                    expect(email.notifyPwdChange).toHaveBeenCalledWith(emailSender, req.body.email);
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({
                        code: 200,
                        body: 'Successfully changed password'
                    });
                });

                describe('if sending the email succeeds', function() {
                    beforeEach(function(done) {
                        notifyDeffered.resolve();
                        notifyDeffered.promise.then(done);
                    });

                    it('should not log an error', function() {
                        expect(mockLog.error).not.toHaveBeenCalled();
                    });
                });

                describe('if sending the email fails', function() {
                    var error;

                    beforeEach(function(done) {
                        error = new Error('USPS is defunct.');
                        notifyDeffered.reject(error);

                        q().then(done);
                    });

                    it('should log an error', function() {
                        expect(mockLog.error).toHaveBeenCalled();
                    });
                });
            });
        });
    });

    describe('changeEmail(svc, req, emailSender)', function() {
        var deferred;
        var users;
        var svc, req, emailSender;
        var result;

        beforeEach(function() {
            deferred = q.defer();

            users = {
                update: jasmine.createSpy('users.update()')
            };

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod(req, actionName, cb)').andReturn(deferred.promise),
                _coll: users
            };
            req = {
                user: {
                    id: 'u-7e4895c648c57d'
                },
                body: {
                    email: 'jminzner@cinema6.com',
                    newEmail: 'josh@cinema6.com'
                }
            };
            emailSender = 'johnnytestmonkey@cinema6.com';

            result = userModule.changeEmail(svc, req, emailSender);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'changeEmail', jasmine.any(Function));
            expect(result).toBe(deferred.promise);
        });

        describe('the callback', function() {
            var callback;
            var success, failure;
            var editObjectDeferred;

            beforeEach(function(done) {
                callback = svc.customMethod.mostRecentCall.args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                editObjectDeferred = q.defer();
                spyOn(mongoUtils, 'editObject').andReturn(editObjectDeferred.promise);

                callback().then(success, failure);

                q().then(done);
            });

            it('should update the email', function() {
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, { email: req.body.newEmail }, req.user.id);
            });

            describe('if the update fails', function() {
                var error;

                beforeEach(function(done) {
                    error = new Error('I GOT A PROBLEM');
                    spyOn(email, 'compileAndSend');

                    editObjectDeferred.reject(error);

                    q().then(done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });

                it('should not send an email', function() {
                    expect(email.compileAndSend).not.toHaveBeenCalled();
                });
            });

            describe('if the update succeeds', function() {
                var emailDeferred;

                beforeEach(function(done) {
                    emailDeferred = q.defer();
                    spyOn(email, 'compileAndSend').andReturn(emailDeferred.promise);

                    editObjectDeferred.resolve();
                    q().then(done);
                });

                it('should send the user an email', function() {
                    expect(email.compileAndSend).toHaveBeenCalledWith(
                        emailSender,
                        req.body.email,
                        'Your Account Email Address Has Changed',
                        'emailChange.html',
                        { newEmail: req.body.newEmail, sender: emailSender }
                    );
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({
                        code: 200,
                        body: 'Successfully changed email'
                    });
                });

                describe('if sending the email succeeds', function() {
                    beforeEach(function(done) {
                        emailDeferred.resolve();
                        q().then(done);
                    });

                    it('should not log an error', function() {
                        expect(mockLog.error).not.toHaveBeenCalled();
                    });
                });

                describe('if sending the email fails', function() {
                    var error;

                    beforeEach(function(done) {
                        error = new Error('You addressed your thing wrong.');
                        emailDeferred.reject(error);

                        q().then(done);
                    });

                    it('should log an error', function() {
                        expect(mockLog.error).toHaveBeenCalled();
                    });
                });
            });
        });
    });

    describe('checkExistingWithNewEmail(sv, req, next, done)', function() {
        var validateUniquePropDeferred;
        var svc, req, next, done;
        var success, failure;
        var result;

        beforeEach(function() {
            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            validateUniquePropDeferred = q.defer();

            svc = {
                validateUniqueProp: jasmine.createSpy('svc.validateUniqueProp()').andReturn(validateUniquePropDeferred.promise)
            };
            req = {
                user: { id: 'u-19fa31cb1a8e0f' },
                body: {
                    newEmail: 'Josh@Cinema6.com'
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            result = userModule.checkExistingWithNewEmail(svc, req, next, done);
        });

        [undefined, null, 44, '', true, false].forEach(function(data) {
            describe('if newEmail is "' + data + '"', function() {
                beforeEach(function() {
                    svc.validateUniqueProp.reset();
                    req.body.newEmail = data;

                    userModule.checkExistingWithNewEmail(svc, req, next, done);
                });

                it('should not call validateUniqueProp()', function() {
                    expect(svc.validateUniqueProp).not.toHaveBeenCalled();
                });

                it('should not call next()', function() {
                    expect(next).not.toHaveBeenCalled();
                });

                it('should call done()', function() {
                    expect(done).toHaveBeenCalledWith({
                        code: 400,
                        body: 'Must provide a new email'
                    });
                });
            });
        });

        it('should make the newEmail lowercase', function() {
            expect(req.body.newEmail).toBe('josh@cinema6.com');
        });

        it('should call and return svc.validateUniqueProp()', function() {
            expect(svc.validateUniqueProp).toHaveBeenCalledWith(
                'email',
                null,
                { body: { email: 'josh@cinema6.com' } },
                next,
                done
            );
            expect(result).toBe(validateUniquePropDeferred.promise);
        });
    });

    describe('forceLogoutUser(svc, req, sessions)', function() {
        var customMethodDeffered;
        var svc, req, sessions;
        var success, failure;
        var result;

        beforeEach(function() {
            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            customMethodDeffered = q.defer();

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').andReturn(customMethodDeffered.promise)
            };
            req = {
                user: { id: 'u-19fa31cb1a8e0f' },
                params: { id: 'u-fbe05a74517c06' }
            };
            sessions = {
                remove: jasmine.createSpy('sessions.remove()')
            };

            result = userModule.forceLogoutUser(svc, req, sessions);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'forceLogout', jasmine.any(Function));
            expect(result).toBe(customMethodDeffered.promise);
        });

        describe('the callback passed to svc.customMethod()', function() {
            var callback;
            var success, failure;

            beforeEach(function(done) {
                callback = svc.customMethod.mostRecentCall.args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                callback().then(success, failure);
                q().then(done);
            });

            it('should remove the user\'s sessions', function() {
                expect(sessions.remove).toHaveBeenCalledWith(
                    { 'session.user': req.params.id },
                    { w: 1, journal: true },
                    jasmine.any(Function)
                );
            });

            describe('if the remove fails', function() {
                var removeCallback;
                var error;

                beforeEach(function(done) {
                    removeCallback = sessions.remove.mostRecentCall.args[2];
                    error = new Error('I suck.');

                    removeCallback(error);
                    q().then(done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });
            });

            describe('if the remove succeeds', function() {
                var removeCallback;

                beforeEach(function(done) {
                    removeCallback = sessions.remove.mostRecentCall.args[2];

                    removeCallback(null);
                    q().then(done);
                });

                it('should not log an error', function() {
                    expect(mockLog.log).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({ code: 204 });
                });
            });
        });
    });

    describe('authorizeForceLogout(req, next, done)', function() {
        var req, next, done;

        function itShouldCallDone() {
            it('should call done() with a 403', function() {
                expect(done).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to force logout users' });
                expect(next).not.toHaveBeenCalled();
            });
        }

        beforeEach(function() {
            req = {
                user: {}
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
        });

        describe('if the user has no permissions', function() {
            beforeEach(function() {
                req.user.permissions = null;
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the user has no users permissions', function() {
            beforeEach(function() {
                req.user.permissions = { experiences: {}, elections: {}, campaigns: {} };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the user has no edit permissions for users', function() {
            beforeEach(function() {
                req.user.permissions = {
                    users: { read: Scope.All, create: Scope.Org }
                };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        [Scope.Own, Scope.Org].forEach(function(scope) {
            describe('if the user\'s users edit permissions are ' + scope, function() {
                beforeEach(function() {
                    req.user.permissions = {
                        users: { edit: scope }
                    };
                    userModule.authorizeForceLogout(req, next, done);
                });

                itShouldCallDone();
            });
        });

        describe('if the user\'s users edit permissions are ' + Scope.All, function() {
            beforeEach(function() {
                req.user.permissions = {
                    users: { edit: Scope.All }
                };
                userModule.authorizeForceLogout(req, next, done);
            });

            it('should call next()', function() {
                expect(done).not.toHaveBeenCalled();
                expect(next).toHaveBeenCalledWith();
            });
        });
    });
});
