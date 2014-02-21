var flush = true;
describe('user (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, bcrypt, userSvc, q, QueryCache, mongoUtils;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        bcrypt      = require('bcrypt');
        userSvc     = require('../../bin/user');
        QueryCache  = require('../../lib/queryCache');
        mongoUtils  = require('../../lib/mongoUtils'),
        q           = require('q');
        
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
                        read: 'all',
                        edit: 'org',
                        delete: 'own'
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
            requester.permissions.orgs = { read: 'all' };
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            
            requester.permissions.users.read = '';
            expect(userSvc.checkScope(requester, target, 'read')).toBe(false);
            
            requester.permissions.users.read = 'all';
            expect(userSvc.checkScope(requester, target, 'read')).toBe(true);
        });
    });
    
    describe('getUser', function() {
        var state, authGetUser;
        beforeEach(function() {
            req.params = { id: 'u-4567' };
            req.user = { id: 'u-1234' };
            state = { db: 'fakeDb' };
            delete require.cache[require.resolve('../../bin/user')];
            authGetUser = jasmine.createSpy('authUtils.getUser').andReturn(q('fakeUser'));
            require.cache[require.resolve('../../lib/authUtils')] = { exports: function() {
                return { getUser: authGetUser };
            } }
            userSvc = require('../../bin/user');
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
        
        it('should not return a user doc the requester cannot see', function(done) {
            userSvc.checkScope.andReturn(false);
            userSvc.getUser(req, state).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to get this user');
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
            cache = { getPromise: jasmine.createSpy('cache.getPromise').andReturn(q(['fakeUser']))};
            spyOn(userSvc, 'checkScope').andReturn(true);
        });
        
        it('should call cache.getPromise to get users', function(done) {
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fakeUser']);
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {id: 1}, 20, 10);
                expect(userSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'fakeUser', 'read');
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
                expect(resp.body).toEqual(['fakeUser']);
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {}, 0, 0);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should only show users the requester is allowed to see', function(done) {
            cache.getPromise.andReturn(q(['fake1', 'fake2']));
            userSvc.checkScope.andCallFake(function(requester, target, verb) {
                if (target === 'fake1') return false;
                else return true;
            });
            userSvc.getUsersByOrg(req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fake2']);
                expect(cache.getPromise).toHaveBeenCalled();
                expect(userSvc.checkScope.calls.length).toBe(2);
                expect(userSvc.checkScope.calls[0].args).toEqual([{id: 'u-1234'}, 'fake1', 'read']);
                expect(userSvc.checkScope.calls[1].args).toEqual([{id: 'u-1234'}, 'fake2', 'read']);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the promise was reject', function(done) {
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
                expect(resp.body).toEqual(['fakeUser']);
                expect(mockLog.warn).toHaveBeenCalled();
                expect(cache.getPromise).toHaveBeenCalledWith({org: 'o-1234'}, {}, 20, 10);
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
                expect(newUser.status).toBe('active');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'own', create: 'own', edit: 'own', delete: 'own' },
                    users: { read: 'own', edit: 'own' },
                    org: { read: 'own' }
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
            newUser.status = 'pending';
            newUser.permissions = {
                experiences: { read: 'all', create: 'own' },
                users: { read: 'org', delete: 'own' }
            };
            userSvc.setupUser(newUser, requester).then(function() {
                expect(newUser.id).toBe('u-1234567890abcd');
                expect(newUser.username).toBe('testUser');
                expect(newUser.created instanceof Date).toBeTruthy('created is a Date');
                expect(newUser.lastUpdated).toEqual(newUser.created);
                expect(newUser.org).toBe('o-4567');
                expect(newUser.status).toBe('pending');
                expect(newUser.permissions).toEqual({
                    experiences: { read: 'all', create: 'own', edit: 'own', delete: 'own' },
                    users: { read: 'org', edit: 'own', delete: 'own' },
                    org: { read: 'own' }
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
            req.body = { username: 'test', password: 'pass', org: 'o-1234' };
            req.user = { id: 'u-1234', org: 'o-1234' };
            spyOn(userSvc, 'setupUser').andCallFake(function(target, requester) {
                target.password = 'hashPass';
                return q();
            });
            spyOn(mongoUtils, 'safeUser').andCallThrough();
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
        
        it('should reject with a 400 if the user already exists', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, { id: 'u-4567', username: 'test' });
            });
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
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
                expect(userSvc.setupUser).toHaveBeenCalledWith(req.body, req.user);
                expect(userColl.insert).toHaveBeenCalled();
                expect(userColl.insert.calls[0].args[0]).toBe(req.body);
                expect(userColl.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 403 if the target user is not in the same org', function(done) {
            req.user.org = 'o-4567';
            req.user.permissions = { users: { create: 'org' } };
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Cannot create users outside of your organization');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should allow an admin to create users in a different org', function(done) {
            req.user.org = 'o-4567';
            req.user.permissions = { users: { create: 'all' } };
            userSvc.createUser(req, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({username: 'test', org: 'o-1234'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.insert).toHaveBeenCalled();
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
                done();
            });
        });
    });
    
    describe('formatUpdates', function() {
        var updates, orig, requester;
        beforeEach(function() {
            updates = { id: 'u-1', username: 'foo', org: 'o-1', permissions: 'fakePerms' };
            orig = { id: 'u-1', org: 'o-1' };
            requester = { id: 'u-2' };
        });
        
        it('should convert the update object to a $set format', function() {
            var newUpdates = userSvc.formatUpdates(updates, orig, requester, '1234');
            expect(newUpdates).toEqual({ $set: updates });
            expect(updates).toEqual({id:'u-1',username:'foo',org:'o-1',permissions:'fakePerms'});
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should prune out illegal fields', function() {
            updates = {id:'u-3',username:'foo',org:'o-2',permissions:'fakePerms',password:'pass'};
            requester.id = 'u-1';
            var newUpdates = userSvc.formatUpdates(updates, orig, requester, '1234');
            expect(newUpdates).toEqual({ $set: updates });
            expect(updates).toEqual({ username: 'foo' });
            expect(mockLog.warn).toHaveBeenCalled();
            expect(mockLog.warn.calls.length).toBe(4);
        });
    });
    
    describe('updateUser', function() {
        /*var userColl, oldUser;
        beforeEach(function() {
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, null);
                }),
                findAndModify: jasmine.createSpy('users.insert').andCallFake(function(obj, opts, cb) {
                    cb(null, 'updated');
                })
            };
            req.body = { username: 'test', password: 'pass', org: 'o-1234' };
            req.user = { id: 'u-1234', org: 'o-1234' };
            spyOn(userSvc, 'setupUser').andCallFake(function(target, requester) {
                target.password = 'hashPass';
                return q();
            });
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });*/
        
        
    });
    
    describe('deleteUser', function() {
    
    });
});
