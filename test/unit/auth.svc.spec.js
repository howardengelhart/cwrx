var flush = true;
describe('auth (UT)', function() {
    var auth, mockLog, mockLogger, req, users, q, uuid, logger, mongoUtils, auth, email, enums,
        Status, bcrypt, anyFunc;
        
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        crypto      = require('crypto');
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        mongoUtils  = require('../../lib/mongoUtils');
        auth        = require('../../bin/auth');
        email       = require('../../lib/email');
        enums       = require('../../lib/enums');
        Status      = enums.Status;
        bcrypt      = require('bcrypt');
        
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
            session: {
                regenerate: jasmine.createSpy('regenerate_session').andCallFake(function(cb) {
                    req.session.cookie = {};
                    cb();
                })
            }
        };
        users = {
            findOne: jasmine.createSpy('users_findOne'),
            update: jasmine.createSpy('users_update')
        };
        spyOn(mongoUtils, 'safeUser').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        anyFunc = jasmine.any(Function);
    });
    
    describe('login', function() {
        var origUser;
        beforeEach(function() {
            req.body = { email: 'user', password: 'pass' };
            origUser = {
                id: 'u-123',
                status: Status.Active,
                email: 'user',
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
            req.body = {};
            auth.login(req, users).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                req.body = {email: 'user'};
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
                    email: 'user',
                    status: Status.Active
                };
                expect(resp.body).toEqual(safeUser);
                expect(req.session.user).toEqual('u-123');
                expect(origUser.password).toBe('hashpass'); // shouldn't accidentally delete this
                
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findOne.calls[0].args[0]).toEqual({'email': 'user'});
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.compare.calls[0].args[0]).toBe('pass');
                expect(bcrypt.compare.calls[0].args[1]).toBe('hashpass');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
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
                expect(resp.body).toBe('Invalid email or password');
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
                expect(resp.body).toBe('Invalid email or password');
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

        it('should resolve with a 401 code if the user is inactive', function(done) {
            origUser.status = 'deleted';
            auth.login(req, users).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Account not active');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
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
    
    describe('mailResetToken', function() {
        beforeEach(function() {
            spyOn(email, 'compileAndSend').andReturn(q('success'));
        });
        
        it('should correctly call compileAndSend', function(done) {
            auth.mailResetToken('send', 'recip', 'reset-pwd.com').then(function(resp) {
                expect(resp).toBe('success');
                expect(email.compileAndSend).toHaveBeenCalledWith('send','recip',
                    'Reset your Cinema6 Password','pwdReset.html',{url:'reset-pwd.com'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should pass along errors from compileAndSend', function(done) {
            email.compileAndSend.andReturn(q.reject('I GOT A PROBLEM'));
            auth.mailResetToken('send', 'recip', 'reset-pwd.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(email.compileAndSend).toHaveBeenCalled();
            }).finally(done);
        });
    });
    
    describe('forgotPassword', function() {
        var origUser;
        beforeEach(function() {
            req.body = {email: 'user@c6.com'};
            origUser = {
                id: 'u-1',
                status: Status.Active,
                email: 'user@c6.com',
                password: 'hashpass'
            };
            users.findOne.andCallFake(function(query, cb) { cb(null, origUser); });
            users.update.andCallFake(function(query, obj, opts, cb) { cb(null, 'updated'); });
            spyOn(crypto, 'randomBytes').andCallFake(function(bytes, cb) { cb(null, new Buffer('HELLO')); });
            spyOn(bcrypt, 'genSaltSync').andReturn('sodiumChloride');
            spyOn(bcrypt, 'hash').andCallFake(function(txt, salt, cb) { cb(null, 'hashToken'); });
            spyOn(auth, 'mailResetToken').andReturn(q('success'));
        });
        
        it('should fail with a 400 if no email is in the request', function(done) {
            req.body = {};
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Need to provide email in the request');
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should successfully create and mail a password reset token', function(done) {
            var now = new Date();
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(users.findOne).toHaveBeenCalledWith({email: 'user@c6.com'}, anyFunc);
                expect(crypto.randomBytes).toHaveBeenCalledWith(24, anyFunc);
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('48454c4c4f', 'sodiumChloride', anyFunc);
                expect(users.update).toHaveBeenCalledWith({ email: 'user@c6.com' },
                    { $set: { lastUpdated: jasmine.any(Date),
                              resetToken: { token: 'hashToken', expires: jasmine.any(Date) } } },
                    { w: 1, journal: true}, anyFunc);
                expect((users.update.calls[0].args[1]['$set'].resetToken.expires - now) >= 10000).toBeTruthy();
                expect(auth.mailResetToken).toHaveBeenCalledWith('test@c6.com', 'user@c6.com',
                    'https://ut.c6.com/api/auth/reset/u-1/48454c4c4f');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            users.findOne.andCallFake(function(query, cb) { cb(null, null); });
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should overwrite a previous token if one exists', function(done) {
            origUser.resetToken = { expires: new Date(), token: 'oldToken' };
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalledWith({ email: 'user@c6.com' },
                    { $set: { lastUpdated: jasmine.any(Date),
                              resetToken: { token: 'hashToken', expires: jasmine.any(Date) } } },
                    { w: 1, journal: true}, anyFunc);
                expect(auth.mailResetToken).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if looking up the user fails', function(done) {
            users.findOne.andCallFake(function(query, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if creating a random token fails', function(done) {
            crypto.randomBytes.andCallFake(function(bytes, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if hashing the token fails', function(done) {
            bcrypt.hash.andCallFake(function(txt, salt, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if saving the token to the db fails', function(done) {
            users.update.andCallFake(function(query, obj, opts, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(auth.mailResetToken).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if sending the email fails', function(done) {
            auth.mailResetToken.andReturn(q.reject('I GOT A PROBLEM'));
            auth.forgotPassword(req, users, 10000, 'test@c6.com', 'ut.c6.com').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(auth.mailResetToken).toHaveBeenCalled();
            }).finally(done);
        });
    });  // describe forgotPassword
    
    describe('resetPassword', function() {
        var origUser, now;
        beforeEach(function() {
            now = new Date();
            req.body = {id: 'u-1', token: 'qwer1234', newPassword: 'newPass'};
            origUser = {
                id: 'u-1', email: 'user@c6.com', password: 'oldpass',
                resetToken: { token: 'hashed', expires: new Date(now.valueOf() + 10000) }
            };
            users.findOne.andCallFake(function(query, cb) { cb(null, origUser); });
            users.update.andCallFake(function(query, obj, opts, cb) {
                cb(null, [{ id: 'u-1', updated: true, password: 'hashPass' }]);
            });
            spyOn(bcrypt, 'compare').andCallFake(function(orig, hashed, cb) { cb(null, true); });
            spyOn(bcrypt, 'genSaltSync').andReturn('sodiumChloride');
            spyOn(bcrypt, 'hash').andCallFake(function(txt, salt, cb) { cb(null, 'hashPass'); });
            spyOn(email, 'notifyPwdChange').andReturn(q('success'));
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            var bodies = [
                {id: 'u-1', token: 'qwer1234'},
                {id: 'u-1', newPassword: 'newPass'},
                {token: 'qwer1234', newPassword: 'newPass'}
            ];
            q.all(bodies.map(function(body) {
                req.body = body;
                return auth.resetPassword(req, users, 'test@c6.com', 10000);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Must provide id, token, and newPassword');
                });
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should successfully reset a user\'s password', function(done) {
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', updated: true});
                expect(users.findOne).toHaveBeenCalledWith({id: 'u-1'}, anyFunc);
                expect(bcrypt.compare).toHaveBeenCalledWith('qwer1234', 'hashed', anyFunc);
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('newPass', 'sodiumChloride', anyFunc);
                expect(users.update).toHaveBeenCalledWith({ id: 'u-1' },
                    { $set : { password: 'hashPass', lastUpdated: jasmine.any(Date) },
                      $unset: { resetToken: 1 } },
                    { w: 1, journal: true, new: true }, anyFunc);
                expect(email.notifyPwdChange).toHaveBeenCalledWith('test@c6.com', 'user@c6.com');
                expect(req.session.user).toBe('u-1');
                expect(req.session.cookie.maxAge).toBe(10000);
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith({id:'u-1',updated:true,password:'hashPass'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            users.findOne.andCallFake(function(query, cb) { cb(null, null); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if no reset token is found', function(done) {
            delete origUser.resetToken;
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('No reset token found');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if the reset token has expired', function(done) {
            origUser.resetToken.expires = new Date(now.valueOf() - 1000);
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Reset token expired');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail with a 403 if the request token does not match the reset token', function(done) {
            bcrypt.compare.andCallFake(function(orig, hashed, cb) { cb(null, false); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Invalid request token');
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if finding the user fails', function(done) {
            users.findOne.andCallFake(function(query, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if checking the reset token fails', function(done) {
            bcrypt.compare.andCallFake(function(orig, hashed, cb) { cb('I GOT A PROBLEM', false); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if hashing the new password fails', function(done) {
            bcrypt.hash.andCallFake(function(orig, hashed, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if updating the user fails', function(done) {
            users.update.andCallFake(function(query, obj, opts, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(email.notifyPwdChange).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should just log an error if sending a notification fails', function(done) {
            email.notifyPwdChange.andReturn(q.reject('I GOT A PROBLEM'));
            auth.resetPassword(req, users, 'test@c6.com', 10000).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', updated: true});
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(email.notifyPwdChange).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).toBe('u-1');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
    });  // end -- describe resetPassword
});  // end -- describe auth
