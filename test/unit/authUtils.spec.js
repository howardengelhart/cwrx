var flush = true;
describe('authUtils', function() {
    var mockUser, q, authUtils, uuid, logger, mongoUtils, mockLog, bcrypt;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        bcrypt      = require('bcrypt');
        authUtils   = require('../../lib/authUtils')();
        mongoUtils  = require('../../lib/mongoUtils');
        QueryCache  = require('../../lib/queryCache');
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

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'getLog').andReturn(mockLog);
        
        spyOn(authUtils, '_initCache').andCallThrough();
        authUtils._cache = new QueryCache(5, 10, 'fakeColl');
    });
    
    describe('initialization', function() {
        it('should initialize the cache if provided with a collection', function() {
            authUtils = require('../../lib/authUtils')(1, 2, 'fakeColl');
            expect(authUtils._cache).toBeDefined();
            expect(authUtils._cache.freshTTL).toBe(1*60*1000);
            expect(authUtils._cache.maxTTL).toBe(2*60*1000);
            expect(authUtils._cache._coll).toBe('fakeColl');
        });
        
        it('should use defaults for the TTLs if not provided', function() {
            authUtils = require('../../lib/authUtils')(null, null, 'fakeColl');
            expect(authUtils._cache).toBeDefined();
            expect(authUtils._cache.freshTTL).toBe(5*60*1000);
            expect(authUtils._cache.maxTTL).toBe(10*60*1000);
            expect(authUtils._cache._coll).toBe('fakeColl');
        });
    });
    
    describe('_initCache', function() {
        beforeEach(function() {
            delete authUtils._cache;
        });
        
        it('should just return if the cache is defined', function() {
            authUtils._cache = 'fakeCache';
            expect(authUtils._initCache).not.toThrow();
        });
        
        it('should initialize the cache if not defined and a collection is provided', function() {
            expect(authUtils._cache).not.toBeDefined();
            authUtils._initCache('fakeColl');
            expect(authUtils._cache).toBeDefined();
            expect(authUtils._cache.freshTTL).toBe(5*60*1000);
            expect(authUtils._cache.maxTTL).toBe(10*60*1000);
            expect(authUtils._cache._coll).toBe('fakeColl');
        });
        
        it('should throw an error if the cache is undefined and no collection is provided', function() {
            expect(authUtils._initCache).toThrow('Cannot call this method without providing a collection');
        });
    });
    
    describe('getUser', function() {
        var collection;
        beforeEach(function() {
            collection = 'fakeColl';
            spyOn(authUtils._cache, 'getPromise').andReturn(q([mockUser]));
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });
        
        it('should call cache.getPromise to get the results of a query', function(done) {
            authUtils.getUser('u-1234', 'fakeColl').then(function(user) {
                delete mockUser.password;
                expect(user).toEqual(mockUser);
                expect(authUtils._initCache).toHaveBeenCalledWith('fakeColl');
                expect(authUtils._cache.getPromise).toHaveBeenCalledWith({id: 'u-1234'});
                expect(mongoUtils.safeUser).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should resolve with nothing if no results are found', function(done) {
            authUtils._cache.getPromise.andReturn(q());
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
                authUtils._cache.getPromise.andReturn(q([]));
                return authUtils.getUser('u-1234');
            }).then(function(user) {
                expect(user).not.toBeDefined();
                authUtils._cache.getPromise.andReturn(q('this is not a user'));
                return authUtils.getUser('u-1234');
            }).then(function(user) {
                expect(user).not.toBeDefined();
                expect(mongoUtils.safeUser).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should pass on errors from the cache', function(done) {
            authUtils._cache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe(JSON.stringify({error: 'Error looking up user', detail: 'I GOT A PROBLEM'}));
                expect(authUtils._cache.getPromise).toHaveBeenCalledWith({id: 'u-1234'});
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
        
        it('should return a user if found and the permissions match', function(done) {
            authUtils.authUser('u-1234', perms, 'fakeColl').then(function(result) {
                delete mockUser.password;
                expect(result.user).toEqual(mockUser);
                expect(authUtils._initCache).toHaveBeenCalledWith('fakeColl');
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(authUtils.compare).toHaveBeenCalledWith(perms, mockUser.permissions);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a fail message if the permissions do not match', function(done) {
            authUtils.compare.andReturn(false);
            authUtils.authUser('u-1234', perms).then(function(result) {
                expect(result).toBe('Permissions do not match');
                expect(result.user).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(authUtils.compare).toHaveBeenCalledWith(perms, mockUser.permissions);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a fail message if the user is not active', function(done) {
            mockUser.status = 'inactive';
            authUtils.authUser('u-1234', perms).then(function(result) {
                expect(result).toBe('User is not active');
                expect(result.user).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(authUtils.compare).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if getting the user fails', function(done) {
            authUtils.getUser.andReturn(q.reject('I GOT A PROBLEM'));
            authUtils.authUser('u-1234', db, perms).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(authUtils.getUser).toHaveBeenCalled();
                expect(authUtils.compare).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('middlewarify: ', function() {
        it('should return a function', function() {
            var midWare = authUtils.middlewarify('fakePerms', 'fakeColl');
            expect(authUtils._initCache).toHaveBeenCalledWith('fakeColl');
            expect(typeof midWare).toBe('function');
        });
        
        describe('middleware', function() {
            var perms, req, res, next;
            beforeEach(function() {
                perms = "fakePerms";
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
                spyOn(authUtils, 'authUser').andReturn(q({ user: { id: 'u-123' } }));
            });
        
            it('should correctly wrap authUser', function(done) {
                var midWare = authUtils.middlewarify(perms);
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
                    expect(authUtils.authUser).toHaveBeenCalledWith('u-123', 'fakePerms');
                    done();
                });
            });
            
            it('should call createUuid if there is no req.uuid', function(done) {
                delete req.uuid;
                var midWare = authUtils.middlewarify(perms);
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
                var midWare = authUtils.middlewarify(perms);
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
                authUtils.authUser.andReturn(q("HE DON'T BELONG HERE"));
                var midWare = authUtils.middlewarify(perms);
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
                authUtils.authUser.andReturn(q.reject('I GOT A PROBLEM'));
                var midWare = authUtils.middlewarify(perms);
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
    
    describe('userPassChecker', function() {
        var userColl, user, req, res, next, midWare;
        beforeEach(function() {
            user = { id: 'u-1', username: 'otter', password: 'fakeHash' };
            userColl = {
                findOne: jasmine.createSpy('users.findOne').andCallFake(function(query, cb) {
                    cb(null, user);
                })
            };
            req = {
                uuid: '1234',
                route: { method: 'get', path: '/ut' },
                body: { username: 'otter', password: 'thisisapassword' }
            };
            res = {};
            midWare = authUtils.userPassChecker(userColl);
            spyOn(bcrypt, 'compare').andCallFake(function(password, hashed, cb) {
                cb(null, true);
            });
            spyOn(mongoUtils, 'safeUser').andCallThrough();
        });
        
        it('should fail with a 400 if no username or password is provided', function(done) {
            res.send = function(code, body) {
                expect(code).toBe(400);
                expect(body).toBe('Must provide username and password');
                expect(userColl.findOne).not.toHaveBeenCalled();
                expect(req.user).not.toBeDefined();
                done();
            };
            next = function() {
                expect('called next').toBe('should not have called next');
                done();
            };
            req.body = { username: 'otter' };
            midWare(req, res, next);
            req.body = { password: 'thisisapassword' };
            midWare(req, res, next);
        });
        
        it('should call next if the credentials are valid', function(done) {
            res.send = function(code, body) {
                expect(code).not.toBeDefined();
                expect(body).not.toBeDefined();
                done();
            };
            midWare(req, res, function() {
                expect(req.user).toEqual({id: 'u-1', username: 'otter'});
                expect(userColl.findOne).toHaveBeenCalled();
                expect(userColl.findOne.calls[0].args[0]).toEqual({username: 'otter'});
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.compare.calls[0].args[0]).toBe('thisisapassword');
                expect(bcrypt.compare.calls[0].args[1]).toBe('fakeHash');
                expect(mongoUtils.safeUser).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with a 401 if the user does not exist', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb(null, null);
            });
            res.send = function(code, body) {
                expect(code).toBe(401);
                expect(body).toBe('Invalid username or password');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(req.user).not.toBeDefined();
                done();
            };
            midWare(req, res, function() {
                expect('called next').toBe('should not have called next');
                done();
            });
        });
        
        it('should fail with a 401 if the password is incorrect', function(done) {
            bcrypt.compare.andCallFake(function(password, hashed, cb) {
                cb(null, false);
            });
            res.send = function(code, body) {
                expect(code).toBe(401);
                expect(body).toBe('Invalid username or password');
                expect(userColl.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(req.user).not.toBeDefined();
                done();
            };
            midWare(req, res, function() {
                expect('called next').toBe('should not have called next');
                done();
            });
        });
        
        it('should reject with an error if bcrypt.compare fails', function(done) {
            bcrypt.compare.andCallFake(function(password, hashed, cb) {
                cb('I GOT A PROBLEM');
            });
            res.send = function(code, body) {
                expect(code).toBe(500);
                expect(body).toBe('Error checking authorization of user');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(req.user).not.toBeDefined();
                done();
            };
            midWare(req, res, function() {
                expect('called next').toBe('should not have called next');
                done();
            });
        });
        
        it('should reject with an error if users.findOne fails', function(done) {
            userColl.findOne.andCallFake(function(query, cb) {
                cb('I GOT A PROBLEM');
            });
            res.send = function(code, body) {
                expect(code).toBe(500);
                expect(body).toBe('Error checking authorization of user');
                expect(mockLog.error).toHaveBeenCalled();
                expect(userColl.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(req.user).not.toBeDefined();
                done();
            };
            midWare(req, res, function() {
                expect('called next').toBe('should not have called next');
                done();
            });
        });
    });  // end -- describe userPassChecker
});  // end -- describe authUtils
