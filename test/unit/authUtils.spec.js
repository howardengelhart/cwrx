var flush = true;
describe('authUtils', function() {
    var mockUser, q, authUtils, uuid, logger, mongoUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        authUtils   = require('../../lib/authUtils')();
        mongoUtils  = require('../../lib/mongoUtils');
        logger      = require('../../lib/logger');
        uuid        = require('../../lib/uuid');
        
        mockUser = {
            id: 'u-1234',
            status: 'active',
            username: 'johnnyTestmonkey',
            password: 'password',
            permissions: {
                dub: {
                    create: true,
                    status: true
                }
            }
        };
    });
    
    describe('getUser', function() {
        var collection, db;
        beforeEach(function() {
            jasmine.Clock.useMock();
            authUtils._cache = {};
            collection = {
                findOne: jasmine.createSpy('coll_findOne').andCallFake(function(query, cb) {
                    cb(null, mockUser);
                })
            };
            db = {
                collection: jasmine.createSpy('db_coll').andReturn(collection)
            };
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });
        
        it('should retrieve a user from the cache if they exist', function(done) {
            authUtils._cache['u-1234'] = mockUser;
            authUtils.getUser('u-1234', db).then(function(user) {
                expect(user).toEqual(mockUser);
                expect(collection.findOne).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should retrieve from a provided cache if the module was called with one', function(done) {
            var cache = {
                'u-1234': mockUser
            };
            authUtils = require('../../lib/authUtils')(null, cache);
            authUtils.getUser('u-1234', db).then(function(user) {
                expect(user).toEqual(mockUser);
                expect(collection.findOne).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should retrieve a user from mongodb if not in the cache', function(done) {
            authUtils.getUser('u-1234', db).then(function(user) {
                delete mockUser.password;
                expect(user).toEqual(mockUser);
                expect(authUtils._cache['u-1234']).toEqual(mockUser);
                expect(collection.findOne).toHaveBeenCalled();
                expect(collection.findOne.calls[0].args[0]).toEqual({id: 'u-1234'});
                expect(mongoUtils.safeUser).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should resolve with null if the user cannot be found', function(done) {
            collection.findOne.andCallFake(function(query, cb) {
                cb(null, null);
            });
            authUtils.getUser('u-1234', db).then(function(user) {
                expect(user).toBeNull();
                expect(authUtils._cache['u-1234']).not.toBeDefined();
                expect(collection.findOne).toHaveBeenCalled();
                expect(mongoUtils.safeUser).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject if mongo encounters an error', function(done) {
            collection.findOne.andCallFake(function(query, cb) {
                cb('Error!');
            });
            authUtils.getUser('u-1234', db).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("Error looking up user");
                expect(errorObj.detail).toBe('Error!');
                expect(collection.findOne).toHaveBeenCalled();
                done();
            });
        });
        
        it('should delete items after a period of time', function(done) {
            authUtils.getUser('u-1234', db).then(function(user) {
                delete mockUser.password;
                expect(user).toEqual(mockUser);
                expect(authUtils._cache['u-1234']).toEqual(mockUser);
                jasmine.Clock.tick(31*60*1000);
                expect(authUtils._cache['u-1234']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should have a configurable cache TTL', function(done) {
            authUtils = require('../../lib/authUtils')(60);
            authUtils.getUser('u-1234', db).then(function(user) {
                delete mockUser.password;
                expect(user).toEqual(mockUser);
                expect(authUtils._cache['u-1234']).toEqual(mockUser);
                jasmine.Clock.tick(31*60*1000);
                expect(authUtils._cache['u-1234']).toBeDefined();
                jasmine.Clock.tick(30*60*1000);
                expect(authUtils._cache['u-1234']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('compare', function() {
        var userPerms;
        beforeEach(function() {
            userPerms = {
                experiences: {
                    read: "org",
                    edit: "own"
                },
                orgs: {
                    read: "own"
                }
            };
        });
        
        it('should check that each object-verb pair exists in the user\'s permissions', function() {
            var perms = { experiences: "read" };
            expect(authUtils.compare(perms, userPerms)).toBe(true);
            
            var perms = {experiences: "edit", orgs: "read" };
            expect(authUtils.compare(perms, userPerms)).toBe(true);
            
            var perms = { orgs: "edit" };
            expect(authUtils.compare(perms, userPerms)).toBe(false);
            
            var perms = {users: "read" };
            expect(authUtils.compare(perms, userPerms)).toBe(false);
        });
        
        it('should work if the required permissions are blank', function() {
            var perms = {};
            expect(authUtils.compare(perms, userPerms)).toBe(true);
        });
    });
    
    describe('authUser', function() {
        var perms, db;
        beforeEach(function() {
            perms = {
                dub: {
                    create: true
                }
            };
            db = "mockDB";
            spyOn(authUtils, 'compare').andReturn(true);
            spyOn(authUtils, 'getUser').andCallFake(function() {
                return q(mongoUtils.safeUser(mockUser));
            });
        });
        
        it('should succeed if the user is found and the permissions match', function(done) {
            authUtils.authUser('u-1234', db, perms).then(function(user) {
                delete mockUser.password;
                expect(user).toEqual(mockUser);
                expect(authUtils.getUser).toHaveBeenCalled();
                expect(authUtils.getUser.calls[0].args[0]).toBe('u-1234');
                expect(authUtils.getUser.calls[0].args[1]).toBe('mockDB');
                expect(authUtils.compare).toHaveBeenCalledWith(perms, mockUser.permissions);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail the permissions do not match', function(done) {
            authUtils.compare.andReturn(false);
            authUtils.authUser('u-1234', db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("Permissions do not match");
                expect(errorObj.detail).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if the user is not active', function(done) {
            mockUser.status = 'inactive';
            authUtils.authUser('u-1234', db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("User is inactive");
                expect(errorObj.detail).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if getting the user fails', function(done) {
            authUtils.getUser.andReturn(q.reject({
                error: 'Error!',
                detail: 'NOPE'
            }));
            authUtils.authUser('u-1234', db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("Error!");
                expect(errorObj.detail).toBe("NOPE");
                expect(authUtils.getUser).toHaveBeenCalled();
                expect(authUtils.compare).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('middlewarify: ', function() {
        
        it('should return a function', function() {
            var midWare = authUtils.middlewarify('fakeDb', 'fakePerms');
            expect(typeof midWare).toBe('function');
        });
        
        describe('middleware', function() {
            var db, perms, mockLog, req, res, next;
            beforeEach(function() {
                db = "mockDb";
                perms = "fakePerms";
                mockLog = {
                    trace : jasmine.createSpy('log_trace'),
                    error : jasmine.createSpy('log_error'),
                    warn  : jasmine.createSpy('log_warn'),
                    info  : jasmine.createSpy('log_info'),
                    fatal : jasmine.createSpy('log_fatal'),
                    log   : jasmine.createSpy('log_log')
                };
                spyOn(logger, 'getLog').andReturn(mockLog);
                spyOn(uuid, 'createUuid').andReturn('1234567890abcd');
                req = {
                    uuid: '1234',
                    route: {
                        method: 'get',
                        path: '/ut'
                    },
                    session: {
                        user: 'u-123'
                    }
                };
                res = {};
                spyOn(authUtils, 'authUser').andReturn(q({ id: 'u-123' }));
            });
        
            it('should correctly wrap authUser', function(done) {
                var midWare = authUtils.middlewarify(db, perms);
                res.send = function(code, data) {
                    expect(code).not.toBeDefined();
                    expect(data).not.toBeDefined();
                    done();
                };
                midWare(req, res, function() {
                    expect(req.user).toEqual({id: 'u-123'});
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(req.uuid).toBe('1234');
                    expect(uuid.createUuid).not.toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalledWith('u-123', 'mockDb', 'fakePerms');
                    done();
                });
            });
            
            it('should call createUuid if there is no req.uuid', function(done) {
                delete req.uuid;
                var midWare = authUtils.middlewarify(db, perms);
                res.send = function(code, data) {
                    expect(code).not.toBeDefined();
                    expect(data).not.toBeDefined();
                    done();
                };
                midWare(req, res, function() {
                    expect(req.uuid).toBe('1234567890');
                    expect(uuid.createUuid).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with a 401 if there is no user in the session', function(done) {
                delete req.session.user;
                var midWare = authUtils.middlewarify(db, perms);
                res.send = function(code, data) {
                    expect(code).toBe(401);
                    expect(data).toBe("Unauthorized");
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(authUtils.authUser).not.toHaveBeenCalled();
                    done();
                };
                midWare(req, res, function() {
                    // indicate test failure in some way if we reach this point
                    expect('called next()').toBe('should never have called next()');
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 403 if the user is unauthorized', function(done) {
                authUtils.authUser.andReturn(q.reject({error: 'Error!'}));
                var midWare = authUtils.middlewarify(db, perms);
                res.send = function(code, data) {
                    expect(code).toBe(403);
                    expect(data).toBe("Forbidden");
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalled();
                    done();
                };
                midWare(req, res, function() {
                    // indicate test failure in some way if we reach this point
                    expect('called next()').toBe('should never have called next()');
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 500 if there was an internal error', function(done) {
                authUtils.authUser.andReturn(q.reject({error: 'Error!', detail: 'It broke!'}));
                var midWare = authUtils.middlewarify(db, perms);
                res.send = function(code, data) {
                    expect(code).toBe(500);
                    expect(data).toBe("Error checking authorization of user");
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalled();
                    done();
                };
                midWare(req, res, function() {
                    // indicate test failure in some way if we reach this point
                    expect('called next()').toBe('should never have called next()');
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
        });  // end -- describe returned function
    });  // end -- describe middlewarify
});  // end -- describe authUtils
