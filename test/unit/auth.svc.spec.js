var path        = require('path'),
    fs          = require('fs-extra'),
    cwrxConfig  = require('../../lib/config'),
    uuid        = require('../../lib/uuid'),
    mongoUtils  = require('../../lib/mongoUtils'),
    bcrypt      = require('bcrypt'),
    sanitize    = require('../sanitize');

describe('auth (UT)', function() {
    var auth, mockLog, mockLogger, req, users;
    
    beforeEach(function() {
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };
        auth = sanitize(['../bin/auth'])
                .andConfigure([['../lib/logger', mockLogger]])
                .andRequire();
                
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

    describe('getVersion', function() {
        
        beforeEach(function() {
            spyOn(fs, 'existsSync');
            spyOn(fs, 'readFileSync');
        });
        
        it('should exist', function() {
            expect(auth.getVersion).toBeDefined();
        });
        
        it('should attempt to read a version file', function() {
            fs.existsSync.andReturn(true);
            fs.readFileSync.andReturn('ut123');
            
            expect(auth.getVersion()).toEqual('ut123');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
        });
        
        it('should return "unknown" if it fails to read the version file', function() {
            fs.existsSync.andReturn(false);
            expect(auth.getVersion()).toEqual('unknown');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).not.toHaveBeenCalled();
            
            fs.existsSync.andReturn(true);
            fs.readFileSync.andThrow('Exception!');
            expect(auth.getVersion()).toEqual('unknown');
            expect(fs.existsSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
            expect(fs.readFileSync).toHaveBeenCalledWith(path.join(__dirname, '../../bin/auth.version'));
        });
    });

    describe('createConfiguration', function() {
        var createConfig, mockConfig;
        
        beforeEach(function() {
            spyOn(fs, 'existsSync');
            spyOn(fs, 'mkdirsSync');
            spyOn(fs, 'readJsonSync');
            
            mockConfig = {
                caches: {
                    run: 'ut/run/'
                },
                log: {
                    logLevel: 'trace'
                },
                secrets: {
                    path: '/secrets/.secrets.json'
                }
            };
            createConfig = spyOn(cwrxConfig, 'createConfigObject').andReturn(mockConfig);
        });
    
        it('should exist', function() {
            expect(auth.createConfiguration).toBeDefined();
        });
        
        it('should correctly setup the config object', function() {
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(createConfig).toHaveBeenCalledWith('utConfig', auth.defaultConfiguration);
            expect(mockLogger.createLog).toHaveBeenCalledWith(mockConfig.log);
            expect(fs.readJsonSync).toHaveBeenCalledWith('/secrets/.secrets.json');
            
            expect(cfgObject.caches.run).toBe('ut/run/');
            expect(cfgObject.ensurePaths).toBeDefined();
            expect(cfgObject.cacheAddress).toBeDefined();
        });
        
        it('should correctly load secrets from a file', function() {
            fs.readJsonSync.andReturn({
                cookieParser: 'cookieSecret',
                session: 'secretSession',
            });
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(cfgObject.secrets.cookieParser).toBe('cookieSecret');
            expect(cfgObject.secrets.session).toBe('secretSession');
        });
        
        describe('ensurePaths method', function() {
            it('should create directories if needed', function() {
                var cfgObject = auth.createConfiguration({config: 'utConfig'});
                fs.existsSync.andReturn(false);
                cfgObject.ensurePaths();
                expect(fs.existsSync).toHaveBeenCalledWith('ut/run/');
                expect(fs.mkdirsSync).toHaveBeenCalledWith('ut/run/');
            });
            
            it('should not create directories if they exist', function() {
                var cfgObject = auth.createConfiguration({config: 'utConfig'});
                fs.existsSync.andReturn(true);
                cfgObject.ensurePaths();
                expect(fs.mkdirsSync).not.toHaveBeenCalled();
            });
        });
        
        it('should create a working cacheAddress method', function() {
            var cfgObject = auth.createConfiguration({config: 'utConfig'});
            expect(cfgObject.cacheAddress('test.pid', 'run')).toBe('ut/run/test.pid');
        });
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
            })
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
                expect(resp.body.user).toBeDefined();
                var safeUser = {
                    id: 'u-123',
                    username: 'user'
                };
                expect(resp.body.user).toEqual(safeUser);
                expect(req.session.user).toEqual(safeUser);
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
    
    describe('signup', function() {
        beforeEach(function() {
            users.findOne.andCallFake(function(query, cb) {
                cb(null, null);
            })
            users.insert = jasmine.createSpy('users_insert').andCallFake(function(obj, opts, cb) {
                cb(null, null);
            });
            spyOn(bcrypt, 'hash').andCallFake(function(pass, hashed, cb) {
                cb(null, 'hashpass');
            });
            spyOn(bcrypt, 'genSaltSync').andReturn('salt');
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdef');
        });    
    
        it('should resolve with a 400 if not provided with the required parameters', function(done) {
            req = {};
            auth.signup(req, users).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                req.body = {username: 'user'};
                return auth.signup(req, users);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBeDefined();
                req.body = {password: 'pass'};
                return auth.signup(req, users);
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
        
        it('should successfully create a new user', function(done) {
            auth.signup(req, users).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body.user).toBeDefined();
                expect(resp.body.user.id).toBe('u-1234567890abcd');
                expect(resp.body.user.username).toBe('user');
                expect(resp.body.user.created instanceof Date).toBeTruthy('created instanceof Date');
                expect(resp.body.user.password).not.toBeDefined();
                expect(req.session.user).toEqual(resp.body.user);
                
                expect(users.findOne).toHaveBeenCalled();
                expect(users.findOne.calls[0].args[0]).toEqual({'username': 'user'});
                expect(bcrypt.hash).toHaveBeenCalled();
                expect(bcrypt.hash.calls[0].args[0]).toBe('pass');
                expect(bcrypt.hash.calls[0].args[1]).toBe('salt');
                expect(users.insert).toHaveBeenCalled();
                resp.body.user.password = 'hashpass';
                expect(users.insert.calls[0].args[0]).toEqual(resp.body.user);
                expect(users.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(resp.body.user);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should resolve with a 400 if the user already exists', function(done) {
            users.findOne.andCallFake(function(query, cb) {
                cb(null, 'a user');
            });
            auth.signup(req, users).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(typeof resp.body).toBe('string');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
                expect(users.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if the insert fails', function(done) {
            users.insert.andCallFake(function(obj, opts, cb) {
                cb('Error!', null);
            });
            auth.signup(req, users).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.insert).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject with an error if bcrypt.hash fails', function(done) {
            bcrypt.hash.andCallFake(function(pass, hashed, cb) {
                cb('Error!', null);
            });
            auth.signup(req, users).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.insert).not.toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject with an error if users.findOne fails', function(done) {
            users.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            auth.signup(req, users).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(req.session.user).not.toBeDefined();
                expect(req.session.regenerate).not.toHaveBeenCalled();
                expect(users.insert).not.toHaveBeenCalled();
                expect(users.findOne).toHaveBeenCalled();
                done();
            });
        });
        
    }); // end -- describe signup
});  // end -- describe auth
