var flush = true;
describe('auth (UT)', function() {
    var auth, mockLog, req, users, q, logger, mongoUtils, authUtils, enums, crypto,
        Status, bcrypt, anyFunc, auditJournal, mockCache, config, streamUtils;
        
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        crypto      = require('crypto');
        bcrypt      = require('bcrypt');
        logger      = require('../../lib/logger');
        mongoUtils  = require('../../lib/mongoUtils');
        authUtils   = require('../../lib/authUtils');
        auth        = require('../../bin/auth');
        enums       = require('../../lib/enums');
        streamUtils = require('../../lib/streamUtils');
        Status      = enums.Status;
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        mockCache = {
            add: jasmine.createSpy('add()').and.returnValue(q()),
            incrTouch: jasmine.createSpy('incrTouch()').and.returnValue(1),
            delete: jasmine.createSpy('delete()').and.returnValue(q())
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        config = {
            sessions: {
                maxAge: 1000
            },
            loginAttempts: {
                ttl: 15*60*1000,
                threshold: 3
            },
            resetTokenTTL: 1*30*60*1000
        };

        req = {
            uuid: '12345',
            session: {
                regenerate: jasmine.createSpy('regenerate_session').and.callFake(function(cb) {
                    req.session.cookie = {};
                    cb();
                })
            },
            _target: 'selfie'
        };
        users = {
            findOneAndUpdate: jasmine.createSpy('users.findOneAndUpdate')
        };
        auditJournal = { writeAuditEntry: jasmine.createSpy('auditJournal.writeAuditEntry').and.returnValue(q()) };
        spyOn(mongoUtils, 'safeUser').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        anyFunc = jasmine.any(Function);
    });
    
    describe('produceFailedLogins', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
        });
        
        it('should be able to produce the failedLogins event', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            auth.produceFailedLogins(req, 'user').then(function() {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('failedLogins', { user: 'user', target: 'selfie' });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error if there was an error producing the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            auth.produceFailedLogins(req, 'user').then(function() {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).then(done, done.fail);
        });
    });
    
    describe('produceForgotPassword', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
        });
        
        it('should be able to produce the forgotPassword event', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            auth.produceForgotPassword(req, 'user', 'token').then(function() {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('forgotPassword', {
                    user: 'user',
                    token: 'token',
                    target: 'selfie'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).then(done, done.fail);
        });
        
        it('should reject if there was an error producing the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject());
            auth.produceForgotPassword(req, 'user', 'token').then(done.fail, done);
        });
    });
    
    describe('producePasswordChanged', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
        });
        
        it('should be able to produce the passwordChanged event', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            auth.producePasswordChanged(req, 'user').then(function() {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('passwordChanged', {
                    user: 'user',
                    target: 'selfie'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error if there was an error producing the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject());
            auth.producePasswordChanged(req, 'user').then(function() {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).then(done, done.fail);
        });
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
            spyOn(mongoUtils, 'findObject').and.returnValue(q(origUser));
            spyOn(bcrypt, 'compare').and.callFake(function(pass, hashed, cb) {
                cb(null, true);
            });
            spyOn(authUtils, 'decorateUser').and.returnValue(q({ id: 'u-123', decorated: true }));
            spyOn(auth, 'produceFailedLogins').and.returnValue(q());
        });
    
        it('should resolve with a 400 if not provided with the required parameters', function(done) {
            req.body = {};
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
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
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(mockCache.delete).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should resolve with a 400 if the email or password are not strings', function(done) {
            q.all([ { email: { $gt: '' }, password: 'pass'},
                    { email: 'user', password: { $gt: '' } } ].map(function(body) {
                req.body = body;
                return auth.login(req, users, config, auditJournal, mockCache);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp).toEqual({code: 400, body: 'You need to provide an email and password in the body'});
                });
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(mockCache.delete).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a user in successfully', function(done) {
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).toEqual({ id: 'u-123', decorated: true });
                expect(req.session.user).toEqual('u-123');
                expect(req.session.cookie.maxAge).toBe(1000);
                expect(origUser.password).toBe('hashpass'); // shouldn't accidentally delete this
                
                expect(mongoUtils.findObject).toHaveBeenCalledWith(users, { email: 'user' });
                expect(bcrypt.compare).toHaveBeenCalledWith('pass', 'hashpass', anyFunc);
                expect(mockCache.delete).toHaveBeenCalledWith('loginAttempts:u-123');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-123');
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.Active, email: 'user' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should convert the request email to lowercase', function(done) {
            req.body.email = 'USER';
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).toEqual({ id: 'u-123', decorated: true });
                expect(req.session.user).toEqual('u-123');
                expect(origUser.password).toBe('hashpass'); // shouldn't accidentally delete this
                expect(mongoUtils.findObject).toHaveBeenCalledWith(users, { email: 'user' });
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.Active, email: 'user' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('when passwords do not match', function() {
            beforeEach(function() {
                bcrypt.compare.and.callFake(function(pass, hashed, cb) {
                    cb(null, false);
                });
                mongoUtils.safeUser.and.returnValue('safeUser');
            });

            it('should resolve with a 401 code', function(done) {
                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp.code).toBe(401);
                    expect(resp.body).toBe('Invalid email or password');
                    expect(req.session.user).not.toBeDefined();
                    expect(req.session.regenerate).not.toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should add a key to the cache if needed and increment it', function(done) {
                auth.login(req, users, config, auditJournal, mockCache).then(function() {
                    expect(mockCache.add).toHaveBeenCalledWith('loginAttempts:u-123', 0, 900000);
                    expect(mockCache.incrTouch).toHaveBeenCalledWith('loginAttempts:u-123', 1, 900000);
                    expect(mockCache.delete).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should produce a failedLogins event on the third failed attempt', function(done) {
                mockCache.incrTouch.and.returnValue(3);
                auth.login(req, users, config, auditJournal, mockCache).then(function() {
                    expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                    expect(auth.produceFailedLogins).toHaveBeenCalledWith(req, 'safeUser');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not reject if adding a login attempt to the cache fails', function(done) {
                mockCache.add.and.returnValue(q.reject('error'));

                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp).toEqual({code:401,body:'Invalid email or password'});
                    expect(mockLog.warn).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should not reject if producing the failedLogins event fails', function(done) {
                mockCache.incrTouch.and.returnValue(3);
                auth.produceFailedLogins.and.returnValue(q.reject('error'));

                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp).toEqual({code:401,body:'Invalid email or password'});
                    expect(mockLog.warn).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        it('should resolve with a 401 code if the user does not exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should resolve with a 401 code if the user inactive and not new', function(done) {
            origUser.status = 'deleted';
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Account not active or new');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to log in a new user ', function(done) {
            origUser.status = Status.New;
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).toEqual({ id: 'u-123', decorated: true });
                expect(req.session.user).toEqual('u-123');
                expect(req.session.cookie.maxAge).toBe(1000);
                expect(origUser.password).toBe('hashpass'); // shouldn't accidentally delete this
                
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalledWith('pass', 'hashpass', anyFunc);
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                expect(mockCache.delete).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-123');
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.New, email: 'user' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if deleting the loginAttempts cache entry fails', function(done) {
            mockCache.delete.and.returnValue(q.reject('cache not ready yet halp'));
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'u-123', decorated: true });
                expect(mockCache.delete).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.Active, email: 'user' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not reject if writing to the journals fail', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'u-123', decorated: true });
                expect(auditJournal.writeAuditEntry).toHaveBeenCalled();
                expect(mockCache.delete).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.Active, email: 'user' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with an error if session.regenerate fails with an error', function(done) {
            req.session.regenerate.and.callFake(function(cb) {
                cb('Error!');
            });
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject with an error if bcrypt.compare fails with an error', function(done) {
            bcrypt.compare.and.callFake(function(pass, hashed, cb) {
                cb('Error!', null);
            });
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject with an error if mongoUtils.findObject fails with an error', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('Error!'));
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if decorating the user fails', function(done) {
            authUtils.decorateUser.and.returnValue(q.reject('Decorating is for squares'));

            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Decorating is for squares');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('logout', function() {
        beforeEach(function() {
            req.session = {
                user: 'u-123',
                destroy: jasmine.createSpy('session_destroy').and.callFake(function(cb) { cb(); })
            };
        });
        
        it('should correctly call req.session.destroy to log a user out', function(done) {
            auth.logout(req, auditJournal).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(req.session.destroy).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-123');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still respond with a 204 if the user is not logged in', function(done) {
            delete req.session.user;
            auth.logout(req, auditJournal).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(req.session.destroy).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if writing to the journal fails', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.logout(req, auditJournal).then(function(resp) {
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(req.session.destroy).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass along errors from req.session.destroy', function(done) {
            req.session.destroy.and.callFake(function(cb) {
                cb('Error!');
            });
            auth.logout(req, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(req.session.destroy).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('forgotPassword', function() {
        var origUser;
        beforeEach(function() {
            req.body = { email: 'user@c6.com'};
            origUser = {
                id: 'u-1',
                status: Status.Active,
                email: 'user@c6.com',
                password: 'hashpass'
            };
            spyOn(mongoUtils, 'findObject').and.returnValue(q(origUser));
            spyOn(mongoUtils, 'editObject').and.returnValue(q('updated'));
            spyOn(crypto, 'randomBytes').and.callFake(function(bytes, cb) { cb(null, new Buffer('HELLO')); });
            spyOn(bcrypt, 'genSaltSync').and.returnValue('sodiumChloride');
            spyOn(bcrypt, 'hash').and.callFake(function(txt, salt, cb) { cb(null, 'hashToken'); });
            spyOn(auth, 'produceForgotPassword').and.returnValue(q());
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            req.body = {};
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Need to provide email in the request');
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 400 if the email is not a string', function(done) {
            req.body.email = { $gt: '' };
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Need to provide email in the request');
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully create a password reset token', function(done) {
            var now = new Date();
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(mongoUtils.findObject).toHaveBeenCalledWith(users, { email: 'user@c6.com' });
                expect(crypto.randomBytes).toHaveBeenCalledWith(24, anyFunc);
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('48454c4c4f', 'sodiumChloride', anyFunc);
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, {
                    resetToken: { token: 'hashToken', expires: jasmine.any(Date) },
                }, 'u-1');
                expect((mongoUtils.editObject.calls.argsFor(0)[1].resetToken.expires - now) >= 10000).toBeTruthy();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should convert the request email to lowercase', function(done) {
            req.body.email = 'USER@c6.Com';
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(mongoUtils.findObject).toHaveBeenCalledWith(users, { email: 'user@c6.com' });
                expect(mongoUtils.editObject).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should produce a forgotPassword event', function(done) {
            mongoUtils.safeUser.and.returnValue('safeUser');
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(mongoUtils.safeUser).toHaveBeenCalledWith('updated');
                expect(auth.produceForgotPassword).toHaveBeenCalledWith(req, 'safeUser', '48454c4c4f');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 404 if the user does not exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 403 if the user is not active', function(done) {
            origUser.status = Status.Inactive;
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Account not active');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should overwrite a previous token if one exists', function(done) {
            origUser.resetToken = { expires: new Date(), token: 'oldToken' };
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, {
                    resetToken: { token: 'hashToken', expires: jasmine.any(Date) },
                }, 'u-1');
                expect(auth.produceForgotPassword).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if writing to the journal fails', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(auth.produceForgotPassword).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if looking up the user fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if creating a random token fails', function(done) {
            crypto.randomBytes.and.callFake(function(bytes, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(crypto.randomBytes).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if hashing the token fails', function(done) {
            bcrypt.hash.and.callFake(function(txt, salt, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if saving the token to the db fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).toHaveBeenCalled();
                expect(auth.produceForgotPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if producing the kinesis event fails', function(done) {
            auth.produceForgotPassword.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).toHaveBeenCalled();
                expect(auth.produceForgotPassword).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('resetPassword', function() {
        var origUser, now, sessions;
        beforeEach(function() {
            now = new Date();
            req.body = {id: 'u-1', token: 'qwer1234', newPassword: 'newPass'};
            origUser = {
                id: 'u-1', email: 'user@c6.com', password: 'oldpass', status: Status.Active,
                resetToken: { token: 'hashed', expires: new Date(now.valueOf() + 10000) }
            };
            spyOn(mongoUtils, 'findObject').and.returnValue(q(origUser));
            users.findOneAndUpdate.and.returnValue(q({ value: { id: 'u-1', updated: true, password: 'hashPass' } }));
            spyOn(bcrypt, 'compare').and.callFake(function(orig, hashed, cb) { cb(null, true); });
            spyOn(bcrypt, 'genSaltSync').and.returnValue('sodiumChloride');
            spyOn(bcrypt, 'hash').and.callFake(function(txt, salt, cb) { cb(null, 'hashPass'); });
            spyOn(authUtils, 'decorateUser').and.returnValue(q({ id: 'u-1', decorated: true }));
            sessions = {
                deleteMany: jasmine.createSpy('deleteMany()').and.returnValue(q({ deletedCount: 2 }))
            };
            spyOn(auth, 'producePasswordChanged').and.returnValue(q());
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            var bodies = [
                {id: 'u-1', token: 'qwer1234'},
                {id: 'u-1', newPassword: 'newPass'},
                {token: 'qwer1234', newPassword: 'newPass'}
            ];
            q.all(bodies.map(function(body) {
                req.body = body;
                return auth.resetPassword(req, users, config, auditJournal, sessions);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Must provide id, token, and newPassword');
                });
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 400 if any of the parameters are not strings', function(done) {
            var bodies = [
                {id: { $gt: '' }, token: 'qwer1234', newPassword: 'newPass'},
                {id: 'u-1', token: { $gt: '' }, newPassword: 'newPass'},
                {id: 'u-1', token: 'qwer1234', newPassword: { $gt: '' }}
            ];
            q.all(bodies.map(function(body) {
                req.body = body;
                return auth.resetPassword(req, users, 'test@c6.com', 10000, sessions);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Must provide id, token, and newPassword');
                });
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully reset a user\'s password', function(done) {
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', decorated: true});
                expect(mongoUtils.findObject).toHaveBeenCalledWith(users, {id: 'u-1'});
                expect(bcrypt.compare).toHaveBeenCalledWith('qwer1234', 'hashed', anyFunc);
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('newPass', 'sodiumChloride', anyFunc);
                expect(users.findOneAndUpdate).toHaveBeenCalledWith(
                    { id: 'u-1' },
                    {
                        $set : { password: 'hashPass', lastUpdated: jasmine.any(Date) },
                        $unset: { resetToken: 1 }
                    },
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                );
                expect(auth.producePasswordChanged).toHaveBeenCalledWith(req, { id: 'u-1', updated: true });
                expect(req.session.user).toBe('u-1');
                expect(req.session.cookie.maxAge).toBe(1000);
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith({id:'u-1',updated:true,password:'hashPass'});
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-1');
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1', updated: true });
                expect(sessions.deleteMany).toHaveBeenCalledWith({ 'session.user': 'u-1' }, { w: 1, j: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 403 if the user is not active', function(done) {
            origUser.status = Status.Inactive;
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Account not active');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if no reset token is found', function(done) {
            delete origUser.resetToken;
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('No reset token found');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the reset token has expired', function(done) {
            origUser.resetToken.expires = new Date(now.valueOf() - 1000);
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Reset token expired');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the request token does not match the reset token', function(done) {
            bcrypt.compare.and.callFake(function(orig, hashed, cb) { cb(null, false); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Invalid request token');
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if writing to the journal fails', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', decorated: true});
                expect(users.findOneAndUpdate).toHaveBeenCalled();
                expect(auth.producePasswordChanged).toHaveBeenCalled();
                expect(req.session.user).toBe('u-1');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1', updated: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if finding the user fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if checking the reset token fails', function(done) {
            bcrypt.compare.and.callFake(function(orig, hashed, cb) { cb('I GOT A PROBLEM', false); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.compare).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if hashing the new password fails', function(done) {
            bcrypt.hash.and.callFake(function(orig, hashed, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.findOneAndUpdate).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if updating the user fails', function(done) {
            users.findOneAndUpdate.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.findOneAndUpdate).toHaveBeenCalled();
                expect(auth.producePasswordChanged).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe resetPassword
});  // end -- describe auth
