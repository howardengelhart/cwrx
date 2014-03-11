var flush = true;
describe('auth (UT)', function() {
    if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
    var auth, mockLog, mockLogger, req, users,
        uuid        = require('../../lib/uuid'),
        logger      = require('../../lib/logger'),
        mongoUtils  = require('../../lib/mongoUtils'),
        auth        = require('../../bin/auth'),
        bcrypt      = require('bcrypt');
    
    beforeEach(function() {
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
        req = {
            uuid: '12345',
            body: {
                username: 'user',
                password: 'pass'
            },
            session: {
                regenerate: jasmine.createSpy('regenerate_session').andCallFake(function(cb) {
                    cb();
                })
            }
        };
        users = {
            findOne: jasmine.createSpy('users_findOne')
        };
        spyOn(mongoUtils, 'safeUser').andCallThrough();
    });
    
    describe('login', function() {
        var origUser;
        beforeEach(function() {
            origUser = {
                id: 'u-123',
                username: 'user',
                password: 'hashpass'
            };
            users.findOne.andCallFake(function(query, cb) {
                cb(null, origUser);
            });
            spyOn(bcrypt, 'compare').andCallFake(function(pass, hashed, cb) {
                cb(null, true);
            });
        });
    
        it('should resolve with a 400 if not provided with the required parameters', function(done) {
            req = {};
            auth.login(req, users).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                req.body = {username: 'user'};
                return auth.login(req, users);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                req.body = {password: 'pass'};
                return auth.login(req, users);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                expect(users.findOne).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should log a user in successfully', function(done) {
            auth.login(req, users).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBeDefined();
                var safeUser = {
                    id: 'u-123',
                    username: 'user'
                };
                expect(resp.body).toEqual(safeUser);
                expect(req.session.user).toEqual(safeUser.id);
                expect(origUser.password).toBe('hashpass'); // shouldn't accidentally delete this
                
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findOne.calls[0].args[0]).toEqual({'username': 'user'});
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.compare.calls[0].args[0]).toBe('pass');
                expect(bcrypt.compare.calls[0].args[1]).toBe('hashpass');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should resolve with a 401 code if the passwords do not match', function(done) {
            bcrypt.compare.andCallFake(function(pass, hashed, cb) {
                cb(null, false);
            });
            auth.login(req, users).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(401);
                expect(resp.body).toBe('Invalid username or password');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should resolve with a 401 code if the user does not exist', function(done) {
            users.findOne.andCallFake(function(query, cb) {
                cb(null, null);
            });
            auth.login(req, users).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(401);
                expect(resp.body).toBe('Invalid username or password');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if session.regenerate fails with an error', function(done) {
            req.session.regenerate.andCallFake(function(cb) {
                cb('Error!');
            });
            auth.login(req, users).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).toHaveBeenCalled();
                done();
            });            
        });
        
        it('should reject with an error if bcrypt.compare fails with an error', function(done) {
            bcrypt.compare.andCallFake(function(pass, hashed, cb) {
                cb('Error!', null);
            });
            auth.login(req, users).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject with an error if users.findOne fails with an error', function(done) {
            users.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            auth.login(req, users).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('logout', function() {
        var req;
        beforeEach(function() {
            req = {
                session: {
                    user: 'u-123',
                    destroy: jasmine.createSpy('session_destroy')
                }
            };
        });
        
        it('should correctly call req.session.destroy to log a user out', function(done) {
            req.session.destroy.andCallFake(function(cb) {
                cb();
            });
            auth.logout(req).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(req.session.destroy).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still respond with a 204 if the user is not logged in', function(done) {
            delete req.session.user;
            auth.logout(req).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(req.session.destroy).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should pass along errors from req.session.destroy', function(done) {
            req.session.destroy.andCallFake(function(cb) {
                cb('Error!');
            });
            auth.logout(req).catch(function(error) {
                expect(error).toBe('Error!');
                expect(req.session.destroy).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});  // end -- describe auth
