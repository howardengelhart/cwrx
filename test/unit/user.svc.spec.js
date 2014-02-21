var flush = true;
describe('user (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, bcrypt, userSvc, q, QueryCache;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        bcrypt      = require('bcrypt');
        userSvc     = require('../../bin/user');
        QueryCache  = require('../../lib/queryCache');
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
    
    });
    
    describe('formatUpdates', function() {
    
    });
    
    describe('updateUser', function() {
    
    });
    
    describe('deleteUser', function() {
    
    });
});
