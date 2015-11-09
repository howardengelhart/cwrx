var flush = true;
describe('auth (UT)', function() {
    var auth, mockLog, req, users, q, uuid, logger, mongoUtils, authUtils, email, enums,
        Status, bcrypt, anyFunc, auditJournal, mockCache, config;
        
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        crypto      = require('crypto');
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        mongoUtils  = require('../../lib/mongoUtils');
        authUtils   = require('../../lib/authUtils');
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
        mockCache = {
            add: jasmine.createSpy('add()').and.returnValue(q()),
            incrTouch: jasmine.createSpy('incrTouch()').and.returnValue(1)
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
            emails: {
                sender: 'no-reply@cinema6.com',
                supportAddress: 'support@cinema6.com'
            },
            forgotTargets: {
                portal: 'https://portal.c6.com/forgot',
                selfie: 'https://staging.cinema6.com/#/?selfie=barf',
            },
            passwordResetPages: {
                portal: 'portal link',
                selfie: 'selfie link'
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
            }
        };
        users = {
            findOne: jasmine.createSpy('users_findOne'),
            update: jasmine.createSpy('users_update'),
            findAndModify: jasmine.createSpy('users_findAndModify')
        };
        auditJournal = { writeAuditEntry: jasmine.createSpy('auditJournal.writeAuditEntry').and.returnValue(q()) };
        spyOn(mongoUtils, 'safeUser').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
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
            users.findOne.and.callFake(function(query, cb) {
                cb(null, origUser);
            });
            spyOn(bcrypt, 'compare').and.callFake(function(pass, hashed, cb) {
                cb(null, true);
            });
            spyOn(authUtils, 'decorateUser').and.returnValue(q({ id: 'u-123', decorated: true }));
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
                expect(users.findOne).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
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
                expect(users.findOne).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
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
                
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findOne.calls.all()[0].args[0]).toEqual({'email': 'user'});
                expect(bcrypt.compare).toHaveBeenCalledWith('pass', 'hashpass', anyFunc);
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
                expect(users.findOne).toHaveBeenCalledWith({email: 'user'}, anyFunc);
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
                spyOn(email, 'failedLogins');
            });

            it('should resolve with a 401 code', function(done) {
                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp.code).toBe(401);
                    expect(resp.body).toBe('Invalid email or password');
                    expect(req.session.user).not.toBeDefined();
                    expect(req.session.regenerate).not.toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(email.failedLogins).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should add a key to the cache if needed and increment it', function(done) {
                auth.login(req, users, config, auditJournal, mockCache).then(function() {
                    expect(mockCache.add).toHaveBeenCalledWith('loginAttempts:u-123', 0, 900000);
                    expect(mockCache.incrTouch).toHaveBeenCalledWith('loginAttempts:u-123', 1, 900000);
                    expect(email.failedLogins).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should send an email on the third failed attempt with a portal link', function(done) {
                mockCache.incrTouch.and.returnValue(3);
                origUser.external = false;
                
                auth.login(req, users, config, auditJournal, mockCache).then(function() {
                    expect(email.failedLogins).toHaveBeenCalledWith('no-reply@cinema6.com', 'user', 'portal link');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should send an email on the third failed attempt using a selfie link', function(done) {
                req.body.target = 'portal';
                origUser.external = true;
                
                mockCache.incrTouch.and.returnValue(3);
                auth.login(req, users, config, auditJournal, mockCache).then(function() {
                    expect(email.failedLogins).toHaveBeenCalledWith('no-reply@cinema6.com', 'user', 'selfie link');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not reject if adding a login attempt to the cache fails', function(done) {
                mockCache.add.and.returnValue(q.reject('error'));

                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp).toEqual({code:401,body:'Invalid email or password'})
                    expect(mockLog.warn).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should not reject if sending the notification email to the user fails', function(done) {
                mockCache.incrTouch.and.returnValue(3);
                email.failedLogins.and.returnValue(q.reject('error'));

                auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                    expect(resp).toEqual({code:401,body:'Invalid email or password'})
                    expect(mockLog.warn).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        it('should resolve with a 401 code if the user does not exist', function(done) {
            users.findOne.and.callFake(function(query, cb) {
                cb(null, null);
            });
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp.code).toBe(401);
                expect(resp.body).toBe('Invalid email or password');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
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
                expect(users.findOne).toHaveBeenCalled();
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
                
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findOne.calls.all()[0].args[0]).toEqual({'email': 'user'});
                expect(bcrypt.compare).toHaveBeenCalledWith('pass', 'hashpass', anyFunc);
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(origUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-123');
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-123', status: Status.New, email: 'user' });
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
        
        it('should reject with an error if users.findOne fails with an error', function(done) {
            users.findOne.and.callFake(function(query, cb) {
                cb('Error!', null);
            });
            auth.login(req, users, config, auditJournal, mockCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
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
        var origUser, targets;
        beforeEach(function() {
            targets = { portal: 'https://c6.com/forgot' };
            req.body = { email: 'user@c6.com', target: 'portal'};
            origUser = {
                id: 'u-1',
                status: Status.Active,
                email: 'user@c6.com',
                password: 'hashpass'
            };
            users.findOne.and.callFake(function(query, cb) { cb(null, origUser); });
            users.update.and.callFake(function(query, obj, opts, cb) { cb(null, 'updated'); });
            spyOn(crypto, 'randomBytes').and.callFake(function(bytes, cb) { cb(null, new Buffer('HELLO')); });
            spyOn(bcrypt, 'genSaltSync').and.returnValue('sodiumChloride');
            spyOn(bcrypt, 'hash').and.callFake(function(txt, salt, cb) { cb(null, 'hashToken'); });
            spyOn(email, 'resetPassword').and.returnValue(q('success'));
        });
        
        it('should fail with a 400 if the request is incomplete', function(done) {
            var bodies = [{email: 'user@c6.com'}, {target: 'portal'}];
            q.all(bodies.map(function(body) {
                req.body = body;
                return auth.forgotPassword(req, users, config, auditJournal);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Need to provide email and target in the request');
                });
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 400 if the email is not a string', function(done) {
            req.body.email = { $gt: '' };
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Need to provide email and target in the request');
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 400 if the target is invalid', function(done) {
            req.body.target = 'fake';
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Invalid target');
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully create and mail a password reset token', function(done) {
            var now = new Date();
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
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
                expect((users.update.calls.argsFor(0)[1]['$set'].resetToken.expires - now) >= 10000).toBeTruthy();
                expect(email.resetPassword).toHaveBeenCalledWith('no-reply@cinema6.com', 'user@c6.com',
                    'https://portal.c6.com/forgot?id=u-1&token=48454c4c4f');
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
                expect(users.findOne).toHaveBeenCalledWith({email: 'user@c6.com'}, anyFunc);
                expect(users.update.calls.all()[0].args[0]).toEqual({ email: 'user@c6.com' });
                expect(email.resetPassword).toHaveBeenCalledWith('no-reply@cinema6.com', 'user@c6.com',
                    'https://portal.c6.com/forgot?id=u-1&token=48454c4c4f');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle target urls with query parameters', function(done) {
            targets.selfie = 'https://staging.cinema6.com/#/?selfie=barf';
            req.body.target = 'selfie';
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(users.findOne).toHaveBeenCalledWith({email: 'user@c6.com'}, anyFunc);
                expect(users.update.calls.all()[0].args[0]).toEqual({ email: 'user@c6.com' });
                expect(email.resetPassword).toHaveBeenCalledWith('no-reply@cinema6.com', 'user@c6.com',
                    'https://staging.cinema6.com/#/?selfie=barf&id=u-1&token=48454c4c4f');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 404 if the user does not exist', function(done) {
            users.findOne.and.callFake(function(query, cb) { cb(null, null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
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
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
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
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalledWith({ email: 'user@c6.com' },
                    { $set: { lastUpdated: jasmine.any(Date),
                              resetToken: { token: 'hashToken', expires: jasmine.any(Date) } } },
                    { w: 1, journal: true}, anyFunc);
                expect(email.resetPassword).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if writing to the journal fails', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('Successfully generated reset token');
                expect(email.resetPassword).toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if looking up the user fails', function(done) {
            users.findOne.and.callFake(function(query, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if creating a random token fails', function(done) {
            crypto.randomBytes.and.callFake(function(bytes, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(crypto.randomBytes).toHaveBeenCalled();
                expect(bcrypt.hash).not.toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if hashing the token fails', function(done) {
            bcrypt.hash.and.callFake(function(txt, salt, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.update).not.toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if saving the token to the db fails', function(done) {
            users.update.and.callFake(function(query, obj, opts, cb) { cb('I GOT A PROBLEM', null); });
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(email.resetPassword).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if sending the email fails', function(done) {
            email.resetPassword.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.forgotPassword(req, users, config, auditJournal).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(users.update).toHaveBeenCalled();
                expect(email.resetPassword).toHaveBeenCalled();
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
            users.findOne.and.callFake(function(query, cb) { cb(null, origUser); });
            users.findAndModify.and.callFake(function(query, sort, obj, opts, cb) {
                cb(null, [{ id: 'u-1', updated: true, password: 'hashPass' }]);
            });
            spyOn(bcrypt, 'compare').and.callFake(function(orig, hashed, cb) { cb(null, true); });
            spyOn(bcrypt, 'genSaltSync').and.returnValue('sodiumChloride');
            spyOn(bcrypt, 'hash').and.callFake(function(txt, salt, cb) { cb(null, 'hashPass'); });
            spyOn(email, 'passwordChanged').and.returnValue(q('success'));
            spyOn(authUtils, 'decorateUser').and.returnValue(q({ id: 'u-1', decorated: true }));
            sessions = {
                remove: jasmine.createSpy('remove()').and.callFake(function(query, concern, cb) {
                    cb(null, 2);
                })
            };
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
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
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
                expect(users.findOne).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully reset a user\'s password', function(done) {
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', decorated: true});
                expect(users.findOne).toHaveBeenCalledWith({id: 'u-1'}, anyFunc);
                expect(bcrypt.compare).toHaveBeenCalledWith('qwer1234', 'hashed', anyFunc);
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('newPass', 'sodiumChloride', anyFunc);
                expect(users.findAndModify).toHaveBeenCalledWith({ id: 'u-1' }, { id: 1 },
                    { $set : { password: 'hashPass', lastUpdated: jasmine.any(Date) },
                      $unset: { resetToken: 1 } },
                    { w: 1, journal: true, new: true }, anyFunc);
                expect(email.passwordChanged).toHaveBeenCalledWith('no-reply@cinema6.com', 'user@c6.com', 'support@cinema6.com');
                expect(req.session.user).toBe('u-1');
                expect(req.session.cookie.maxAge).toBe(1000);
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith({id:'u-1',updated:true,password:'hashPass'});
                expect(auditJournal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-1');
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1', updated: true });
                expect(sessions.remove).toHaveBeenCalledWith({'session.user':'u-1'},{w:1,journal:true},jasmine.any(Function));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 404 if the user does not exist', function(done) {
            users.findOne.and.callFake(function(query, cb) { cb(null, null); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That user does not exist');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 403 if the user is not active', function(done) {
            origUser.status = Status.Inactive;
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Account not active');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(auditJournal.writeAuditEntry).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if no reset token is found', function(done) {
            delete origUser.resetToken;
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('No reset token found');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with a 403 if the reset token has expired', function(done) {
            origUser.resetToken.expires = new Date(now.valueOf() - 1000);
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Reset token expired');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
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
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not reject if writing to the journal fails', function(done) {
            auditJournal.writeAuditEntry.and.returnValue(q.reject('audit journal fail'));
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', decorated: true});
                expect(users.findAndModify).toHaveBeenCalled();
                expect(email.passwordChanged).toHaveBeenCalled();
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
            users.findOne.and.callFake(function(query, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(users.findOne).toHaveBeenCalled();
                expect(bcrypt.compare).not.toHaveBeenCalled();
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
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
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
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
                expect(users.findAndModify).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if updating the user fails', function(done) {
            users.findAndModify.and.callFake(function(query, sort, obj, opts, cb) { cb('I GOT A PROBLEM', null); });
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(users.findAndModify).toHaveBeenCalled();
                expect(email.passwordChanged).not.toHaveBeenCalled();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should just log an error if sending a notification fails', function(done) {
            email.passwordChanged.and.returnValue(q.reject('I GOT A PROBLEM'));
            auth.resetPassword(req, users, config, auditJournal, sessions).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'u-1', decorated: true});
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findAndModify).toHaveBeenCalled();
                expect(email.passwordChanged).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.session.user).toBe('u-1');
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalled();
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1', updated: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });  // end -- describe resetPassword
});  // end -- describe auth
