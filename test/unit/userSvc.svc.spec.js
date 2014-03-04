var flush = true;
describe('userSvc (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, bcrypt, userSvc, q, QueryCache, mongoUtils,
        FieldValidator, enums, Status, Scope;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        bcrypt          = require('bcrypt');
        userSvc         = require('../../bin/userSvc');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
        mongoUtils      = require('../../lib/mongoUtils'),
        q               = require('q');
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
        req = {uuid: '1234'};
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
                return userSvc.checkScope(requester, target, 'read');
            })).toEqual(users);
            expect(users.filter(function(target) {
                return userSvc.checkScope(requester, target, 'edit');
            })).toEqual([users[0], users[1], users[2]]);
            expect(users.filter(function(target) {
                return userSvc.checkScope(requester, target, 'delete');
            })).toEqual([users[0], users[2]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var target = { id: 'u-1' };
            expect(userSvc.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users = {};
            requester.permissions.orgs = { read: Scope.All };
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = '';
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = Scope.All;
            expect(userSvc.checkScope(requester, target, 'read')).toBe(true);
        });
    });
    
    describe('permsCheck', function() {
        var updates, orig, requester;
        beforeEach(function() {
            updates = { permissions: { users: {} } };
            orig = { id: 'u-2' };
            requester = {
                id: 'u-1',
                permissions: {
                    users: {
                        read: Scope.Own,
                        create: Scope.Org,
                        edit: Scope.All
                    }
                }
            };
        });
        
        it('should return false if the requester has no perms', function() {
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            delete requester.permissions;
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
        
        it('should return false if the requester is trying to change their own perms', function() {
            orig.id = 'u-1';
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
        
        it('should return false if the updates\' perms exceed the requester\'s', function() {
            updates.permissions.users = { read: Scope.Org };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { read: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { create: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { edit: Scope.All };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            updates.permissions.users = { delete: Scope.Own };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
            updates.permissions.users = { read: Scope.Own, create: Scope.Own, edit: Scope.Own };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(true);
            updates.permissions = { experiences: { read: Scope.Own } };
            expect(userSvc.permsCheck(updates, orig, requester)).toBe(false);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            spyOn(FieldValidator, 'eqReqFieldFunc').andCallThrough();
            spyOn(FieldValidator, 'scopeFunc').andCallThrough();
            delete require.cache[require.resolve('../../bin/userSvc')];
            userSvc = require('../../bin/userSvc');

            expect(userSvc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(userSvc.createValidator._condForbidden.org instanceof Array).toBeTruthy();
            expect(userSvc.createValidator._condForbidden.org.length).toBe(2);
            expect(FieldValidator.eqReqFieldFunc).toHaveBeenCalledWith('org');
            expect(FieldValidator.scopeFunc).toHaveBeenCalledWith('users', 'create', Scope.All);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initalized correctly', function() {
            expect(userSvc.updateValidator._forbidden).toEqual(['id', 'org', 'password', 'created']);
            expect(userSvc.updateValidator._condForbidden.permissions).toBe(userSvc.permsCheck);
        });
    });
    
    describe('getUser', function() {
        var state, authGetUser;
        beforeEach(function() {
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            state = { db: 'fakeDb' };
            delete require.cache[require.resolve('../../bin/userSvc')];
            authGetUser = jasmine.createSpy('authUtils.getUser').andReturn(q('fakeUser'));
            require.cache[require.resolve('../../lib/authUtils')] = { exports: function() {
                return { getUser: authGetUser };
            } }
            userSvc = require('../../bin/userSvc');
            spyOn(userSvc, 'checkScope').andReturn(true);
        });
        
        it('should call authUtils.getUser to get a user', function(done) {
            userSvc.getUser(req, state).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('fakeUser');
                expect(authGetUser).toHaveBeenCalledWith('u-4567', 'fakeDb');
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'fakeUser', 'read');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if the user is not found', function(done) {
            authGetUser.andReturn(q());
            userSvc.getUser(req, state).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No user found');
                expect(authGetUser).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not return a user doc the requester cannot see', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.getUser(req, state).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to get this user');
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'fakeUser', 'read');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if getting the user fails', function(done) {
            authGetUser.andReturn(q.reject('Error!'));
            userSvc.getUser(req, state).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(authGetUser).toHaveBeenCalled();
                expect(userSvc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('getUsersByOrg', function() {
        var cache;
        beforeEach(function() {
            req.user = { id: 'u-1234' };
            req.query = {
                sort: 'id,1',
                org: 'o-1234',
                limit: 20,
                skip: 10
            };
            cache = {
                getPromise: jasmine.createSpy('cache.getPromise').andReturn(q([{id:'1'}, {id:'2'}]))
            };
            spyOn(userSvc, 'checkScope').andReturn(true);
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });
        
        it('should call cache.getPromise to get users', function(done) {
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {id: 1}, 20, 10);
                expect(userSvc.checkScope.calls.length).toBe(2);
                expect(userSvc.checkScope.calls[0].args).toEqual([{id: 'u-1234'}, {id:'1'}, 'read']);
                expect(userSvc.checkScope.calls[1].args).toEqual([{id: 'u-1234'}, {id:'2'}, 'read']);
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                expect(mongoUtils.safeUser.calls[0].args[0]).toEqual({id:'1'});
                expect(mongoUtils.safeUser.calls[1].args[0]).toEqual({id:'2'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should use defaults for sorting/paginating options if not provided', function(done) {
            req.query = { org: 'o-1234' };
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {}, 0, 0);
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should only show users the requester is allowed to see', function(done) {
            userSvc.checkScope.andCallFake(function(requester, target, verb) {
                if (target.id === '1') return false;
                else return true;
            });
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'2'}]);
                expect(cache.getPromise).toHaveBeenCalled();
                expect(userSvc.checkScope.calls.length).toBe(2);
                expect(userSvc.checkScope.calls[0].args).toEqual([{id: 'u-1234'}, {id:'1'}, 'read']);
                expect(userSvc.checkScope.calls[1].args).toEqual([{id: 'u-1234'}, {id:'2'}, 'read']);
                expect(mongoUtils.safeUser.calls.length).toBe(1);
                expect(mongoUtils.safeUser.calls[0].args[0]).toEqual({id:'2'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing was found', function(done) {
            cache.getPromise.andReturn(q([]));
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No users found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the promise was rejected', function(done) {
            cache.getPromise.andReturn(q.reject('Error!'));
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {id: 1}, 20, 10);
                expect(userSvc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}, {id:'2'}]);
                expect(mockLog.warn).toHaveBeenCalled();
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {}, 20, 10);
                expect(mongoUtils.safeUser.calls.length).toBe(2);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('setupUser', function() {
        var newUser, requester;
        beforeEach(function() {
            newUser = { username: 'testUser', password: 'pass' };
            requester = { id: 'u-4567', org: 'o-1234' };
            spyOn(bcrypt, 'hash').andCallFake(function(password, salt, cb) {
                cb(null, 'fakeHash');
            });
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdefg')
        });

        it('should set some default fields and hash the user\'s password', function(done) {
            userSvc.setupUser(newUser, requester).then(function() {
                expect(newUser.id).toBe('u-1234567890abcd');
                expect(newUser.username).toBe('testUser');
                expect(newUser.created instanceof Date).toBeTruthy('created is a Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.org).toBe('o-1234');
                expect(newUser.status).toBe(Status.Active);
                expect(newUser.permissions).toEqual({
                    experiences: { read: Scope.Own, create: Scope.Own, edit: Scope.Own, delete: Scope.Own },
                    users: { read: Scope.Own, edit: Scope.Own },
                    orgs: { read: Scope.Own }
                });
                expect(newUser.password).toBe('fakeHash');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should intelligently merge the newUser fields with defaults', function(done) {
            newUser.org = 'o-4567';
            newUser.status = Status.Pending;
            newUser.permissions = {
                experiences: { read: Scope.All, create: Scope.Own },
                users: { read: Scope.Org, delete: Scope.Own }
            };
            userSvc.setupUser(newUser, requester).then(function() {
                expect(newUser.id).toBe('u-1234567890abcd');
                expect(newUser.username).toBe('testUser');
                expect(newUser.created instanceof Date).toBeTruthy('created is a Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.org).toBe('o-4567');
                expect(newUser.status).toBe(Status.Pending);
                expect(newUser.permissions).toEqual({
                    experiences: { read: Scope.All, create: Scope.Own, edit: Scope.Own, delete: Scope.Own },
                    users: { read: Scope.Org, edit: Scope.Own, delete: Scope.Own },
                    orgs: { read: Scope.Own }
                });
                expect(newUser.password).toBe('fakeHash');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if hashing the password fails', function(done) {
            bcrypt.hash.andReturn(q.reject('Error!'));
            userSvc.setupUser(newUser, requester).then(function() {
                expect(true).toBeFalsy('you should not be here!');
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                done();
            });
        });
    });
    
    describe('createUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, null);
                }),
                insert: jasmine.createSpy('users.insert').andCallFake(function(obj, opts, cb) {
                    cb();
                })
            };
            req.body = { username: 'test', password: 'pass'};
            req.user = { id: 'u-1234', org: 'o-1234' };
            spyOn(userSvc, 'setupUser').andCallFake(function(target, requester) {
                target.password = 'hashPass';
                if (!target.org) target.org = requester.org;
                return q();
            });
            spyOn(mongoUtils, 'safeUser').andCallThrough();
            spyOn(userSvc.createValidator, 'validate').andReturn(true);
        });
        
        it('should reject with a 400 if no user object is provided', function(done) {
            delete req.body;
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('You must provide an object in the body');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });            
        });
        
        it('should reject with a 400 if the username or password are unspecificied', function(done) {
            delete req.body.username;
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New user object must have a username and password');
                req.body = { username: 'test' };
                return userSvc.createUser(req, userColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New user object must have a username and password');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 409 if the user already exists', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, { id: 'u-4567', username: 'test' });
            });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(409);
                expect(resp.body).toEqual('A user with that username already exists');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should successfully create a new user', function(done) {
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({username: 'test', org: 'o-1234'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({username: 'test'});
                expect(userSvc.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(userSvc.setupUser).toHaveBeenCalledWith(req.body, req.user);
                expect(userColl.insert).toHaveBeenCalled();
                expect(userColl.insert.calls[0].args[0]).toBe(req.body);
                expect(userColl.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(mongoUtils.safeUser)
                    .toHaveBeenCalledWith({username: 'test', org: 'o-1234', password: 'hashPass'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 400 if the new user contains illegal fields', function(done) {
            userSvc.createValidator.validate.andReturn(false);
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Illegal fields');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.createValidator.validate).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should allow an admin to create users in a different org', function(done) {
            req.body.org = 'o-4567';
            req.user.permissions = { users: { create: Scope.All } };
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({username: 'test', org: 'o-4567'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).toHaveBeenCalled();
                expect(mongoUtils.safeUser)
                    .toHaveBeenCalledWith({username: 'test', org: 'o-4567', password: 'hashPass'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should fail with an error if finding the existing user fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if setting up the user fails', function(done) {
            userSvc.setupUser.andReturn(q.reject('Error!'));
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userSvc.setupUser).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if inserting the user fails', function(done) {
            userColl.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.insert).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('updateUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, {orig: 'yes'});
                }),
                findAndModify: jasmine.createSpy('users.findAndModify').andCallFake(
                    function(query, sort, obj, opts, cb) {
                        cb(null, [{ id: 'u-4567', updated: true }]);
                    })
            };
            req.body = { foo: 'bar' };
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            spyOn(userSvc, 'checkScope').andReturn(true);
            spyOn(mongoUtils, 'safeUser').andCallThrough();
            spyOn(userSvc.updateValidator, 'validate').andReturn(true);
        });
        
        it('should fail immediately if no update object is provided', function(done) {
            delete req.body;
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                req.body = 'foo';
                return userSvc.updateUser(req, userColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBeDefined(400);
                expect(resp.body).toBe('You must provide an object in the body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully update a user', function(done) {
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'u-4567', updated: true });
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, {orig: 'yes'}, 'edit');
                expect(userSvc.updateValidator.validate)
                    .toHaveBeenCalledWith(req.body, {orig: 'yes'}, {id: 'u-1234'});
                expect(userColl.findAndModify).toHaveBeenCalled();
                expect(userColl.findAndModify.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userColl.findAndModify.calls[0].args[1]).toEqual({id: 1});
                var updates = userColl.findAndModify.calls[0].args[2];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.foo).toBe('bar');
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(userColl.findAndModify.calls[0].args[3]).toEqual({w:1,journal:true,new:true});
                expect(mongoUtils.safeUser).toHaveBeenCalledWith({ id: 'u-4567', updated: true });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not create a user if they do not exist', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).not.toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit a user the requester is not authorized to edit', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this user');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the user if the updates contain illegal fields', function(done) {
            userSvc.updateValidator.validate.andReturn(false);
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.updateValidator.validate).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findAndModify).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            userColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) {
                cb('Error!', null);
            });
            userSvc.updateUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findAndModify).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('deleteUser', function() {
        var userColl;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, 'original');
                }),
                update: jasmine.createSpy('users.update').andCallFake(function(query,obj,opts,cb) {
                    cb(null, 1);
                })
            };
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            spyOn(userSvc, 'checkScope').andReturn(true);
        });
        
        it('should fail if the user is trying to delete themselves', function(done) {
            req.params.id = 'u-1234';
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You cannot delete yourself');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully mark a user as deleted', function(done) {
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({id: 'u-4567'});
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'original', 'delete');
                expect(userColl.update).toHaveBeenCalled();
                expect(userColl.update.calls[0].args[0]).toEqual({id: 'u-4567'});
                var updates = userColl.update.calls[0].args[1];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.status).toBe(Status.Deleted);
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(userColl.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete a nonexistent user', function(done) {
            userColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete a user the requester is not authorized to delete', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this user');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userSvc.checkScope).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the user if they have already been deleted', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, {id: 'u-4567', status: Status.Deleted});
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            userColl.update.andCallFake(function(query, obj, ops, cb) {
                cb('Error!', null);
            });
            userSvc.deleteUser(req, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.update).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});
