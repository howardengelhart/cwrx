var q           = require('q'),
    authUtils   = require('../../lib/authUtils')(),
    mongoUtils  = require('../../lib/mongoUtils');

describe('authUtils', function() {
    var mockUser;
    
    beforeEach(function() {
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
        
        it('should reject if the user cannot be found', function(done) {
            collection.findOne.andCallFake(function(query, cb) {
                cb();
            });
            authUtils.getUser('u-1234', db).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("User not found");
                expect(errorObj.detail).not.toBeDefined();
                expect(collection.findOne).toHaveBeenCalled();
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
        var a, b;
        it('should do a deep compare of two objects', function() {
            a = { a: { foo: 'bar' }, b: 1 };
            b = { a: { foo: 'bar' }, b: 1 };
            expect(authUtils.compare(a, b)).toBeTruthy();
            
            b.a.foo = 'baz';
            expect(authUtils.compare(a, b)).toBeFalsy();
            
            a = {a: 1, b: 2};
            b = {b: 2, a: 1};
            expect(authUtils.compare(a, b)).toBeTruthy();
        });
        
        it('should still return true if the user object has additional properties', function() {
            a = { a: 1 };
            b = { a: 1, b: 2};
            expect(authUtils.compare(a, b)).toBeTruthy();
            
            b.c = {d: 3};
            expect(authUtils.compare(a, b)).toBeTruthy();
        });
        
        it('should be able to compare two non-objects', function() {
            a = 'asdf', b = 'asdfq';
            expect(authUtils.compare(a, b)).toBeFalsy();
            
            b = 'asdf';
            expect(authUtils.compare(a, b)).toBeTruthy();
        });
    });
    
    describe('authUser', function() {
        var perms, db, req;
        beforeEach(function() {
            perms = {
                dub: {
                    create: true
                }
            };
            req = {
                session: {
                    user: 'u-1234'
                }
            };
            db = "mockDB";
            spyOn(authUtils, 'compare').andReturn(true);
            spyOn(authUtils, 'getUser').andCallFake(function() {
                return q(mongoUtils.safeUser(mockUser));
            });
        });
        
        it('should succeed if the user is found and the permissions match', function(done) {
            authUtils.authUser(req, db, perms).then(function(user) {
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
            authUtils.authUser(req, db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("Permissions do not match");
                expect(errorObj.detail).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if the user is not active', function(done) {
            mockUser.status = 'inactive';
            authUtils.authUser(req, db, perms).catch(function(errorObj) {
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
            authUtils.authUser(req, db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("Error!");
                expect(errorObj.detail).toBe("NOPE");
                expect(authUtils.getUser).toHaveBeenCalled();
                expect(authUtils.compare).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if there is no user id in the session', function(done) {
            req.session = { foo: 'bar' };
            authUtils.authUser(req, db, perms).catch(function(errorObj) {
                expect(errorObj).toBeDefined();
                expect(errorObj.error).toBe("No user is logged in");
                expect(errorObj.detail).not.toBeDefined();
                expect(authUtils.getUser).not.toHaveBeenCalled();
                done();
            });
        });
    });  // end -- describe authUser
});  // end -- describe authUtils
