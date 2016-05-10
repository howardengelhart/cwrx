var flush = true;
describe('userSvc (UT)', function() {
    var userModule, q, bcrypt, mockLog, uuid, logger, CrudSvc, Model, mongoUtils, email, crypto, authUtils, util,
        CacheMutex, requestUtils, objUtils, req, userSvc, mockDb, nextSpy, doneSpy, errorSpy, mockCache, appCreds, streamUtils;

    var enums = require('../../lib/enums'),
        Status = enums.Status,
        Scope = enums.Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        userModule      = require('../../bin/userSvc-users');
        q               = require('q');
        util            = require('util');
        bcrypt          = require('bcrypt');
        crypto          = require('crypto');
        uuid            = require('rc-uuid');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc.js');
        Model           = require('../../lib/model.js');
        mongoUtils      = require('../../lib/mongoUtils');
        authUtils       = require('../../lib/authUtils.js');
        objUtils        = require('../../lib/objUtils');
        email           = require('../../lib/email');
        CacheMutex      = require('../../lib/cacheMutex.js');
        requestUtils    = require('../../lib/requestUtils.js');
        streamUtils     = require('../../lib/streamUtils.js');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        spyOn(mongoUtils, 'escapeKeys').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        spyOn(email, 'passwordChanged');
        spyOn(email, 'accountWasActivated');
        spyOn(email, 'activateAccount');
        spyOn(email, 'emailChanged');
        req = { uuid: '1234', query: {}, requester: {} };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        userModule.config = {
            activationTokenTTL: 60000,
            validTargets: ['selfie', 'showcase', 'portal'],
            newUserPermissions: {
                selfie: {
                    roles: ['selfieRole1'],
                    policies: ['selfiePol1', 'selfiePol2']
                },
                showcase: {
                    roles: ['showcaseRole1', 'showcaseRole2'],
                    policies: ['showcasePol1']
                },
            },
            api: {
                root: 'http://localhost',
                orgs: {
                    endpoint: '/api/account/orgs/',
                    baseUrl: 'http://localhost/api/account/orgs/'
                },
                advertisers: {
                    endpoint: '/api/account/advertisers/',
                    baseUrl: 'http://localhost/api/account/advertisers/'
                }
            },
            sessions: {
                maxAge: 60*60*1000
            },
            kinesis: {
                streamName: 'superStream',
                region: 'narnia'
            }
        };
        appCreds = {
            key: 'e2e-user-service',
            secret: 'omgsosecret'
        };
    });

    describe('setupSvc', function() {
        var result, mockConfig;

        var boundFns;

        function equals(array1, array2) {
            if (!array1 || !array2) { return false; }
            if (array1.length !== array2.length) { return false; }

            return array1.every(function(array1Value, index) {
                var array2Value = array2[index];

                if(Array.isArray(array1Value) && Array.isArray(array2Value)) {
                    return equals(array1Value, array2Value);
                }
                return array1Value === array2Value;
            });
        }

        function getBoundFn(original, argParams) {
            var index = 0;
            var length = boundFns.length;

            var call;
            for (; index < length; index++) {
                call = boundFns[index];

                if (call.original === original && equals(call.args, argParams || [])) {
                    return call.bound;
                }
            }

            return null;
        }

        beforeEach(function() {
            var bind = Function.prototype.bind;
            boundFns = [];
            [CrudSvc.prototype.validateUniqueProp, userModule.checkExistingWithNewEmail,
             userModule.hashProp, userModule.validateRoles, userModule.validatePolicies, userModule.setupSignupUser,
             userModule.giveActivationToken, userModule.checkValidToken, userModule.createLinkedEntities].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });

            spyOn(streamUtils, 'createProducer');

            mockCache = {};
            mockConfig = JSON.parse(JSON.stringify(userModule.config));
            Object.keys(mockConfig.api).forEach(function(key) {
                delete mockConfig.api[key].baseUrl;
            });
            userModule.config = {};

            result = userModule.setupSvc(mockDb, mockConfig, mockCache, appCreds);
        });

        it('should return a CrudSvc', function() {
            expect(result).toEqual(jasmine.any(CrudSvc));
            expect(result._coll).toEqual({ collectionName: 'users' });
            expect(result._db).toBe(mockDb);
            expect(result._prefix).toBe('u');
            expect(result._userProp).toBe(false);
            expect(result.model).toEqual(jasmine.any(Model));
            expect(result.model.schema).toBe(userModule.userSchema);
        });
        
        it('should save some config locally', function() {
            expect(userModule.config).toEqual(mockConfig);
            expect(userModule.config.api.orgs.baseUrl).toBe('http://localhost/api/account/orgs/');
            expect(userModule.config.api.advertisers.baseUrl).toBe('http://localhost/api/account/advertisers/');
        });
        
        it('should create a kinesis producer', function() {
            expect(streamUtils.createProducer).toHaveBeenCalledWith(userModule.config.kinesis);
        });

        it('should hash the user\'s passwords when creating', function() {
            expect(userModule.hashProp.bind).toHaveBeenCalledWith(userModule, 'password');
            expect(result._middleware.create).toContain(getBoundFn(userModule.hashProp, [userModule, 'password']));
        });

        it('should set defaults on the user when creating', function() {
            expect(result._middleware.create).toContain(userModule.setupUser);
        });

        it('should ensure the uniqueness of the email field when creating', function() {
            expect(result.validateUniqueProp.bind).toHaveBeenCalledWith(result, 'email', null);
            expect(result._middleware.create).toContain(getBoundFn(result.validateUniqueProp, [result, 'email', null]));
            expect(result._middleware.create.indexOf(getBoundFn(result.validateUniqueProp, [result, 'email', null]))).toBeGreaterThan(result._middleware.create.indexOf(userModule.setupUser));
        });

        it('should do additional validation for roles on create and edit', function() {
            expect(userModule.validateRoles.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.create).toContain(getBoundFn(userModule.validateRoles, [userModule, result]));
        });

        it('should do additional validation for policies on create and edit', function() {
            expect(userModule.validatePolicies.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.create).toContain(getBoundFn(userModule.validatePolicies, [userModule, result]));
        });

        it('should do additional validation for the password on create and edit', function() {
            expect(result._middleware.create).toContain(userModule.validatePassword);
            expect(result._middleware.edit).toContain(userModule.validatePassword);
        });

        it('should prevent the user from deleting themselves', function() {
            expect(result._middleware.delete).toContain(userModule.preventSelfDeletion);
        });

        it('should hash the user\'s password when changing it', function() {
            expect(userModule.hashProp.bind).toHaveBeenCalledWith(userModule, 'newPassword');
            expect(result._middleware.changePassword).toContain(getBoundFn(userModule.hashProp, [userModule, 'newPassword']));
        });

        it('should prevent the user from changing their email to another user\'s email', function() {
            expect(userModule.checkExistingWithNewEmail.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.changeEmail).toContain(getBoundFn(userModule.checkExistingWithNewEmail, [userModule, result]));
        });

        it('should only allow certain users to perform a forceLogout', function() {
            expect(result._middleware.forceLogout).toContain(userModule.authorizeForceLogout);
        });

        it('should remove sensitive fields from users when they are retrieved from mongo', function() {
            expect(result.transformMongoDoc).toBe(mongoUtils.safeUser);
        });

        it('should check/query user scope via the user\'s ID property', function() {
            expect(result.checkScope).toBe(userModule.checkScope);
            expect(result.userPermQuery).toBe(userModule.userPermQuery);
        });
        
        it('should validate the target on any action that publishes a watchman event', function() {
            expect(result._middleware.changePassword).toContain(userModule.validateTarget);
            expect(result._middleware.changeEmail).toContain(userModule.validateTarget);
            expect(result._middleware.signupUser).toContain(userModule.validateTarget);
            expect(result._middleware.confirmUser).toContain(userModule.validateTarget);
            expect(result._middleware.resendActivation).toContain(userModule.validateTarget);
        });

        it('should setupSignupUser when signing up a user', function() {
            expect(userModule.setupSignupUser.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.setupSignupUser, [userModule, result]));
        });

        it('should validate the password when signing up a user', function() {
            expect(result._middleware.signupUser).toContain(userModule.validatePassword);
        });

        it('should hash the password when signing up a user', function() {
            expect(userModule.hashProp.bind).toHaveBeenCalledWith(userModule, 'password');
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.hashProp, [userModule, 'password']));
        });

        it('should setup the user when signing up a user', function() {
            expect(result._middleware.signupUser).toContain(userModule.setupUser);
        });

        it('should validate a unique email address when signing up a user', function() {
            expect(result.validateUniqueProp.bind).toHaveBeenCalledWith(result, 'email', null);
            expect(result._middleware.signupUser).toContain(getBoundFn(result.validateUniqueProp, [result, 'email', null]));
        });

        it('should give an activation token when signing up a user or resending activation', function() {
            expect(result._middleware.signupUser).toContain(userModule.giveActivationToken);
            expect(result._middleware.resendActivation).toContain(userModule.giveActivationToken);
        });

        it('should check validity of token on user confirm', function() {
            expect(userModule.checkValidToken.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.checkValidToken, [userModule, result]));
        });

        it('should give linked entities on user confirm', function() {
            expect(userModule.createLinkedEntities.bind).toHaveBeenCalledWith(userModule, mockCache, result, appCreds);
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.createLinkedEntities, [userModule, mockCache, result, appCreds]));
        });
    });

    describe('user validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, userModule.config, mockCache, appCreds);
            newObj = { email: 'test@me.com', password: 'pass' };
            origObj = {};
            requester = { fieldValidation: { users: {} } };
        });
        
        describe('when handling company', function() {
            it('should fail if the field is not a string', function() {
                newObj.company = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'company must be in format: string' });
            });
            
            it('should allow the field to be set', function() {
                newObj.company = 'Heinz';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.company).toEqual('Heinz');
            });
        });

        describe('when handling advertiser', function() {
            it('should trim the field if set', function() {
                newObj.advertiser = 'that guy';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.advertiser).not.toBeDefined();
            });
            
            it('should be able to allow some requesters to set the field', function() {
                requester.fieldValidation.users.advertiser = { __allowed: true };
                newObj.advertiser = 'that guy';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.advertiser).toBe('that guy');
            });

            it('should fail if the field is not a string', function() {
                requester.fieldValidation.users.advertiser = { __allowed: true };
                newObj.advertiser = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'advertiser must be in format: string' });
            });
        });

        describe('when handling email', function() {
            it('should fail if the field is not a string', function() {
                newObj.email = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'email must be in format: string' });
            });

            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.email;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: email' });
            });

            it('should pass if the field was defined on the original object', function() {
                origObj.email = 'old value';
                delete newObj.email;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.email).toEqual('old value');
            });

            it('should revert the field on edit', function() {
                origObj.email = 'old value';
                requester.fieldValidation.users.email = { __unchangeable: false };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.email).toEqual('old value');
            });
        });

        describe('when handling password', function() {
            it('should fail if the field is not a string', function() {
                newObj.password = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'password must be in format: string' });
            });

            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
            });

            it('should pass if the field is not defined on edit', function() {
                delete newObj.password;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ email: 'test@me.com' });
            });
        });

        // locked, forbidden fields
        ['permissions', 'fieldValidation', 'entitlements', 'applications', 'activationToken'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });

                it('should not allow any requesters to set the field', function() {
                    requester.fieldValidation.users[field] = { __allowed: true };
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });
            });
        });

        // roles and policies: forbidden but overridable
        ['roles', 'policies'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = ['thing1', 'thing2'];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ email: 'test@me.com', password: 'pass' });
                });

                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = ['thing1', 'thing2'];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(['thing1', 'thing2']);
                });

                it('should fail if the field is not an array of strings', function() {
                    newObj[field] = [{ name: 'thing1' }, { name: 'thing2' }];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: stringArray' });
                });

                it('should fail if the field does not contain acceptable values', function() {
                    newObj[field] = ['thing1', 'thing4'];
                    requester.fieldValidation.users[field] = {
                        __allowed: true,
                        __entries: { __acceptableValues: ['thing1', 'thing2', 'thing3'] }
                    };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + '[1] is UNACCEPTABLE! acceptable values are: [thing1,thing2,thing3]' });
                });
            });
        });

        ['referralCode', 'paymentPlanId', 'promotion'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = '123456';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).not.toBeDefined();
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = '123456';
                    requester.fieldValidation.users[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('123456');
                });
                
                it('should fail if the field is not a string', function() {
                    newObj[field] = 123456;
                    requester.fieldValidation.users[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
            });
        });
    });
    
    describe('createSignupModel', function() {
        var svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, userModule.config, mockCache, appCreds);
        });

        it('should return a new model with an altered user schema', function() {
            var newModel = userModule.createSignupModel(svc);
            expect(newModel).toEqual(jasmine.any(Model));
            expect(newModel.objName).toBe('users');

            expect(newModel.schema.referralCode.__allowed).toBe(true);
            expect(svc.model.schema.referralCode.__allowed).toBe(false);

            expect(newModel.schema.paymentPlanId.__allowed).toBe(true);
            expect(svc.model.schema.paymentPlanId.__allowed).toBe(false);

            expect(newModel.schema.promotion.__allowed).toBe(true);
            expect(svc.model.schema.promotion.__allowed).toBe(false);

            newModel.schema.referralCode.__allowed = false;
            newModel.schema.paymentPlanId.__allowed = false;
            newModel.schema.promotion.__allowed = false;
            expect(newModel.schema).toEqual(svc.model.schema);
        });
    });
    
    describe('validateTarget', function() {
        it('should call next if the target param is valid', function() {
            ['selfie', 'showcase', 'portal'].forEach(function(val) {
                req.query.target = val;
                userModule.validateTarget(req, nextSpy, doneSpy);
                expect(req.query.target).toBe(val);
            });
            expect(nextSpy.calls.count()).toBe(3);
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should default the target param if not set', function() {
            delete req.query.target;
            userModule.validateTarget(req, nextSpy, doneSpy);
            expect(req.query.target).toBe('selfie');
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if the target param is not valid', function() {
            ['selfieTime', 1234, { foo: 'bar' }].forEach(function(val) {
                req.query.target = val;
                userModule.validateTarget(req, nextSpy, doneSpy);
            });
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(3);
            doneSpy.calls.allArgs().forEach(function(args) {
                expect(args).toEqual([{ code: 400, body: 'Invalid Target' }]);
            });
        });
    });

    describe('checkValidToken', function() {
        var svc, req, mockUser;

        beforeEach(function() {
            svc = {
                _coll: 'fakeColl',
                transformMongoDoc: jasmine.createSpy('transformMongoDoc(doc)').and.callFake(function(doc) {
                    return doc;
                })
            };
            req = {
                params: { },
                body: { }
            };
            spyOn(mongoUtils, 'findObject').and.callFake(function() { return q(mockUser); });
            spyOn(bcrypt, 'compare');
        });

        describe('when the user does not exist', function() {
            beforeEach(function(done) {
                mockUser = undefined;
                req.params.id = 'non-existent-user-id';
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 404', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 404, body: 'User not found'});
            });
        });

        describe('when the user does not have a status of new', function() {
            beforeEach(function(done) {
                mockUser = { status: 'active', activationToken: {} };
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Confirmation failed'});
            });
        });

        describe('when the user does not have an activation token', function() {
            beforeEach(function(done) {
                mockUser = { status: 'new' };
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Confirmation failed'});
            });
        });

        describe('when the activation token on the user has expired', function() {
            beforeEach(function(done) {
                mockUser = { status: 'new', activationToken: { expires: String(new Date(0)) } };
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Activation token has expired'});
            });
        });

        describe('when the provided token does not match the stored activation token', function() {
            beforeEach(function(done) {
                mockUser = { 
                    status: 'new',
                    activationToken: {
                        expires: new Date(99999, 11, 25),
                        token: 'salty token'
                    }
                };
                req.body.token = 'invalid token';
                bcrypt.compare.and.callFake(function(val1, val2, cb) {
                    return cb(null, false);
                });
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should compare the tokens', function() {
                expect(bcrypt.compare).toHaveBeenCalledWith('invalid token', 'salty token', jasmine.any(Function));
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Confirmation failed'});
            });
        });

        describe('when the provided token is valid and matches the stored activation token', function() {
            beforeEach(function(done) {
                mockUser = {
                    id: 'u-new',
                    status: 'new',
                    activationToken: {
                        expires: new Date(99999, 11, 25),
                        token: 'salty token'
                    }
                };
                req.body.token = 'valid token';
                bcrypt.compare.and.callFake(function(val1, val2, cb) {
                    cb(null, true);
                });
                
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should compare the tokens', function() {
                expect(bcrypt.compare).toHaveBeenCalledWith('valid token', 'salty token', jasmine.any(Function));
            });

            it('should call next', function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
            });

            it('should temporarily store the safe fetched user document on the request', function() {
                expect(svc.transformMongoDoc).toHaveBeenCalledWith(mockUser);
                expect(req.user).toEqual(mockUser);
                expect(req.requester).toEqual({
                    id: 'u-new',
                    permissions: {},
                    fieldValidation: {},
                    entitlements: {},
                    applications: []
                });
            });
        });
    });

    describe('createLinkedEntities', function() {
        var svc;
        beforeEach(function() {
            req.user = { id: 'u-12345', company: 'some company' };
            req.requester = { id: 'u-12345', permissions: {} };
            svc = { _coll: 'fakeColl' };
            spyOn(CacheMutex.prototype, '_init');
            spyOn(CacheMutex.prototype, 'acquire').and.returnValue(q(true));
            spyOn(CacheMutex.prototype, 'release').and.returnValue(q());
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            spyOn(requestUtils, 'makeSignedRequest').and.callFake(function(creds, method, opts) {
                var object = opts.url.match(/orgs|advertisers/)[0];
                return q({
                    response: { statusCode: 201 },
                    body: { id: object + '-id-123' }
                });
            });
        });
        
        it('should create an advertiser and org', function(done) {
            userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.user.org).toBe('orgs-id-123');
                
                expect(CacheMutex.prototype._init).toHaveBeenCalledWith(mockCache, 'confirmUser:u-12345', 60000);
                expect(CacheMutex.prototype.acquire).toHaveBeenCalled();

                expect(requestUtils.makeSignedRequest.calls.count()).toBe(2);
                expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', {
                    url: 'http://localhost/api/account/orgs/',
                    json: { name: 'some company (u-12345)' }
                });
                expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', {
                    url: 'http://localhost/api/account/advertisers/',
                    json: { name: 'some company', org: 'orgs-id-123' }
                });

                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(CacheMutex.prototype.release).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should call done if it cannot acquire a mutex lock', function(done) {
            CacheMutex.prototype.acquire.and.returnValue(q(false));
            userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Another operation is already in progress' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(CacheMutex.prototype.release).not.toHaveBeenCalled();
            }).done(done);
        });
        
        describe('if the user already has an org', function() {
            beforeEach(function() {
                req.user.org = 'o-existing';
            });

            it('should not attempt to create another org', function(done) {
                userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                .finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(req.user.org).toBe('o-existing');

                    expect(requestUtils.makeSignedRequest.calls.count()).toBe(1);
                    expect(requestUtils.makeSignedRequest).not.toHaveBeenCalledWith(appCreds, 'post', jasmine.objectContaining({
                        url: 'http://localhost/api/account/orgs/'
                    }));
                    expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', jasmine.objectContaining({
                        url: 'http://localhost/api/account/advertisers/'
                    }));

                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        describe('if the user has a referralCode', function() {
            beforeEach(function() {
                req.user.referralCode = 'asdf123456';
            });

            it('should save the code on the org', function(done) {
                userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                .finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(req.user.org).toBe('orgs-id-123');

                    expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', {
                        url: 'http://localhost/api/account/orgs/',
                        json: {
                            name: 'some company (u-12345)',
                            referralCode: 'asdf123456'
                        }
                    });

                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                }).done(done);
            });
        });

        describe('if the user has a paymentPlanId', function() {
            beforeEach(function() {
                req.user.paymentPlanId = 'pp-0Ek1iM02uYGNaLIL';
            });

            it('should save the id on the org', function(done) {
                userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                .finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(req.user.org).toBe('orgs-id-123');

                    expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', {
                        url: 'http://localhost/api/account/orgs/',
                        json: {
                            name: 'some company (u-12345)',
                            paymentPlanId: 'pp-0Ek1iM02uYGNaLIL'
                        }
                    });

                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        ['4xx response', 'rejection'].forEach(function(failType) {
            function failRequestFor(entity, creds, method, opts) {
                return function(creds, method, opts) {
                    var object = opts.url.match(/orgs|advertisers/)[0];
                    if (object === (entity + 's')) {
                        if (/reject/.test(failType)) {
                            return q.reject('I GOT A PROBLEM');
                        } else {
                            return q({
                                response: { statusCode: 400 },
                                body: 'I can\'t let you do that, sixxy'
                            });
                        }
                    } else {
                        return q({
                            response: { statusCode: 201 },
                            body: { id: object + '-id-123' }
                        });
                    }
                };
            }

            describe('if creating an org fails with a ' + failType, function() {
                beforeEach(function() {
                    requestUtils.makeSignedRequest.and.callFake(failRequestFor('org'));
                });
                
                it('should reject without attempting to save the user', function(done) {
                    userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                    .finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(doneSpy).not.toHaveBeenCalled();
                        expect(errorSpy).toHaveBeenCalledWith('Failed creating linked entities');
                        expect(req.user.org).not.toBeDefined();

                        expect(requestUtils.makeSignedRequest.calls.count()).toBe(1);
                        expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', jasmine.objectContaining({
                            url: 'http://localhost/api/account/orgs/'
                        }));
                        expect(mongoUtils.editObject).not.toHaveBeenCalled();
                        
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(mockLog.error.calls.mostRecent().args).toContain('org');
                        if (/reject/.test(failType)) {
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('I GOT A PROBLEM'));
                        } else {
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('400'));
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('let you do that, sixxy'));
                        }
                        expect(CacheMutex.prototype.release).toHaveBeenCalled();
                    }).done(done);
                });
            });
            
            describe('if creating an advertiser fails with a ' + failType, function() {
                beforeEach(function() {
                    requestUtils.makeSignedRequest.and.callFake(failRequestFor('advertiser'));
                });
                
                it('should attempt to save the org id on the user', function(done) {
                    userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                    .finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(doneSpy).not.toHaveBeenCalled();
                        expect(errorSpy).toHaveBeenCalledWith('Failed creating linked entities');
                        expect(req.user.org).toBe('orgs-id-123');

                        expect(requestUtils.makeSignedRequest.calls.count()).toBe(2);
                        expect(mongoUtils.editObject).toHaveBeenCalledWith('fakeColl', { org: 'orgs-id-123' }, 'u-12345');
                        
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(mockLog.error.calls.mostRecent().args).toContain('advertiser');
                        if (/reject/.test(failType)) {
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('I GOT A PROBLEM'));
                        } else {
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('400'));
                            expect(mockLog.error.calls.mostRecent().args).toContain(jasmine.stringMatching('let you do that, sixxy'));
                        }
                        expect(CacheMutex.prototype.release).toHaveBeenCalled();
                    }).done(done);
                });

                it('should reject with the same message if saving the user fails', function(done) {
                    mongoUtils.editObject.and.returnValue(q.reject('Honey you got a big storm coming'));
                    userModule.createLinkedEntities(mockCache, svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy)
                    .finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(doneSpy).not.toHaveBeenCalled();
                        expect(errorSpy).toHaveBeenCalledWith('Failed creating linked entities');
                        expect(mongoUtils.editObject).toHaveBeenCalled();
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(CacheMutex.prototype.release).toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });

    describe('setupSignupUser', function() {
        var svc;

        beforeEach(function() {
            spyOn(uuid, 'createUuid').and.returnValue('1234567890abcdef');
            svc = userModule.setupSvc(mockDb, userModule.config, mockCache, appCreds);
            req.body = {};
            req.query = { target: 'selfie' };
        });
        
        it('should setup a new selfie user', function() {
            userModule.setupSignupUser(svc, req, nextSpy, doneSpy);
            expect(req.body.id).toBe('u-1234567890abcdef');
            expect(req.body.created).toEqual(jasmine.any(Date));
            expect(req.body.lastUpdated).toBe(req.body.created);
            expect(req.body.status).toEqual(Status.New);
            expect(req.body.external).toBe(true);
            expect(req.body.roles).toEqual(['selfieRole1']);
            expect(req.body.policies).toEqual(['selfiePol1', 'selfiePol2']);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should setup a new showcase user', function() {
            req.query.target = 'showcase';
            userModule.setupSignupUser(svc, req, nextSpy, doneSpy);
            expect(req.body.id).toBe('u-1234567890abcdef');
            expect(req.body.created).toEqual(jasmine.any(Date));
            expect(req.body.lastUpdated).toBe(req.body.created);
            expect(req.body.status).toEqual(Status.New);
            expect(req.body.external).toBe(true);
            expect(req.body.roles).toEqual(['showcaseRole1', 'showcaseRole2']);
            expect(req.body.policies).toEqual(['showcasePol1']);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });

        it('should setup a new user that doesn\'t have pre-configured roles + policies', function() {
            req.query.target = 'someotherapp';
            userModule.setupSignupUser(svc, req, nextSpy, doneSpy);
            expect(req.body.id).toBe('u-1234567890abcdef');
            expect(req.body.created).toEqual(jasmine.any(Date));
            expect(req.body.lastUpdated).toBe(req.body.created);
            expect(req.body.status).toEqual(Status.New);
            expect(req.body.external).toBe(true);
            expect(req.body.roles).toEqual([]);
            expect(req.body.policies).toEqual([]);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('giveActivationToken', function() {
        var req, nextSpy;

        beforeEach(function() {
            req = {
                body: { }
            };
            spyOn(crypto, 'randomBytes').and.callFake(function(num, cb) {
                cb(null, new Buffer('abcdefghijklmnopqrstuvwxyz'.substring(0, num)));
            });
            spyOn(bcrypt, 'hash').and.callFake(function(data, salt, cb) {
                cb(null, 'hashed-activation-token');
            });
            spyOn(bcrypt, 'genSaltSync').and.returnValue('salt');
            nextSpy = jasmine.createSpy('next()');
            doneSpy = jasmine.createSpy('done()');
        });

        it('should generate random bytes and convert to hex', function(done) {
            userModule.giveActivationToken(req, nextSpy)
            .then(function() {
                expect(crypto.randomBytes).toHaveBeenCalledWith(24, jasmine.any(Function));
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should temporarily store the unhashed token in hex on the request', function(done) {
            userModule.giveActivationToken(req, nextSpy)
            .then(function() {
                expect(req.tempToken).toBe('6162636465666768696a6b6c6d6e6f707172737475767778');
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should hash the hex token', function(done) {
            userModule.giveActivationToken(req, nextSpy)
            .then(function() {
                expect(bcrypt.genSaltSync).toHaveBeenCalled();
                expect(bcrypt.hash).toHaveBeenCalledWith('6162636465666768696a6b6c6d6e6f707172737475767778', 'salt', jasmine.any(Function));
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should set the hashed token on the user document', function(done) {
            userModule.giveActivationToken(req, nextSpy)
            .then(function() {
                expect(req.body.activationToken.token).toBe('hashed-activation-token');
                expect(req.body.activationToken.expires).toEqual(jasmine.any(Date));
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should call next', function(done) {
            userModule.giveActivationToken(req, nextSpy)
            .then(function() {
                expect(nextSpy).toHaveBeenCalled();
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should reject if something fails', function(done) {
            var errorSpy = jasmine.createSpy('errorSpy()');
            crypto.randomBytes.and.returnValue(q.reject('epic fail'));
            userModule.giveActivationToken(req, nextSpy)
            .catch(errorSpy)
            .done(function() {
                expect(errorSpy).toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('checkScope', function() {
        var req, users;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: {
                    id: 'u-1234',
                    org: 'o-1234'
                },
                requester: {
                    id: 'u-1234',
                    permissions: {
                        users: {
                            read: Scope.All,
                            edit: Scope.Org,
                            delete: Scope.Own
                        }
                    }
                }
            };
            users = [{ id: 'u-1234', org: 'o-1234'},
                     { id: 'u-4567', org: 'o-1234'},
                     { id: 'u-1234', org: 'o-4567'},
                     { id: 'u-4567', org: 'o-4567'}];
        });

        it('should correctly handle the scopes', function() {
            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'read');
            })).toEqual(users);

            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'edit');
            })).toEqual([users[0], users[1], users[2]]);

            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'delete');
            })).toEqual([users[0], users[2]]);
        });

        it('should sanity-check the requester permissions object', function() {
            var target = { id: 't-1' };
            
            req.requester.permissions.users.read = '';
            expect(userModule.checkScope({}, target, 'read')).toBe(false);

            req.requester.permissions.users = {};
            req.requester.permissions.orgs = { read: Scope.All };
            expect(userModule.checkScope({}, target, 'read')).toBe(false);
            
            req.requester.permissions = {};
            expect(userModule.checkScope({}, target, 'read')).toBe(false);
            
            delete req.requester;
            expect(userModule.checkScope({}, target, 'read')).toBe(false);
        });
        
        it('should handle a case where there is no req.user', function() {
            delete req.user;
            req.requester.id = 'app-1';
            req.application = { id: 'app-1', key: 'watchman' };
            
            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'read');
            })).toEqual(users);

            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'edit');
            })).toEqual([]);

            expect(users.filter(function(target) {
                return userModule.checkScope(req, target, 'delete');
            })).toEqual([]);
        });
    });

    describe('userPermQuery', function() {
        var query, req;
        beforeEach(function() {
            query = { org: 'o-1' };
            req = {
                uuid: '1234',
                user: {
                    id: 'u-1',
                    org: 'o-1'
                },
                requester: {
                    id: 'u-1',
                    permissions: { users: { read: Scope.Own } }
                }
            };
        });

        it('should just check that the user is not deleted if the requester is an admin', function() {
            req.requester.permissions.users.read = Scope.All;
            expect(userModule.userPermQuery(query, req))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted } });
            expect(query).toEqual({org: 'o-1'});
        });

        it('should check that the ids match if the requester has Scope.Own', function() {
            expect(userModule.userPermQuery(query, req))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
        });

        it('should check that the ids or orgs match if the requester has Scope.Org', function() {
            req.requester.permissions.users.read = Scope.Org;
            expect(userModule.userPermQuery(query, req))
                .toEqual({org: 'o-1', status: {$ne: Status.Deleted}, $or: [{id: 'u-1'}, {org: 'o-1'}]});
        });

        it('should preserve existing $or clauses', function() {
            req.requester.permissions.users.read = Scope.Org;
            query.$or = [ { a: 1 }, { b: 2 } ];
            expect(userModule.userPermQuery(query, req)).toEqual({
                org: 'o-1',
                status: { $ne: Status.Deleted },
                $and: [
                    { $or: [ { a: 1 }, { b: 2 } ] },
                    { $or: [ { id: 'u-1' }, { org: 'o-1' } ] }
                ]
            });
        });

        it('should log a warning if the requester has an invalid scope', function() {
            req.requester.permissions.users.read = 'alfkjdf';
            expect(userModule.userPermQuery(query, req))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
            expect(mockLog.warn).toHaveBeenCalled();
        });
        
        it('should handle requests from apps instead of users', function() {
            delete req.user;
            req.requester.id = 'app-1';
            req.application = { id: 'app-1', key: 'watchman' };
            
            req.requester.permissions.users.read = Scope.All;
            expect(userModule.userPermQuery(query, req)).toEqual({
                org: 'o-1',
                status: { $ne: Status.Deleted }
            });
            
            req.requester.permissions.users.read = Scope.Own;
            expect(userModule.userPermQuery(query, req)).toEqual({
                org: 'o-1',
                status: { $ne: Status.Deleted },
                $or: [{ id: '' }]
            });

            req.requester.permissions.users.read = Scope.Org;
            expect(userModule.userPermQuery(query, req)).toEqual({
                org: 'o-1',
                status: { $ne: Status.Deleted },
                $or: [{ id: '' }, { org: '' }]
            });
        });
    });

    describe('setupUser(req, next, done)', function() {
        var req, next, done;

        beforeEach(function() {
            req = {
                body: {
                    email: 'Josh@Cinema6.com',
                    applications: ['e-4b10000923e73e', 'e-9c70d81e44c56f'],
                    config: {
                        studio: { foo: 'bar' }
                    },
                    roles: ['base', 'selfie'],
                    policies: ['denyCampaigns']
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            userModule.setupUser(req, next, done);
        });

        it('should make the email lowercase', function() {
            expect(req.body.email).toBe('josh@cinema6.com');
        });

        it('should call next()', function() {
            expect(next).toHaveBeenCalledWith();
        });

        it('should not overwrite the specified applications, roles, policies or config', function() {
            expect(req.body).toEqual({
                email: 'josh@cinema6.com',
                applications: ['e-4b10000923e73e', 'e-9c70d81e44c56f'],
                config: { studio: { foo: 'bar' } },
                roles: ['base', 'selfie'],
                policies: ['denyCampaigns']
            });
        });

        describe('if the user has no config', function() {
            beforeEach(function() {
                next.calls.reset();
                delete req.body.config;

                userModule.setupUser(req, next, done);
            });

            it('should give the user a config object', function() {
                expect(req.body.config).toEqual({});
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalledWith();
            });
        });

        describe('if the user has no policies', function() {
            beforeEach(function() {
                next.calls.reset();
                delete req.body.policies;

                userModule.setupUser(req, next, done);
            });

            it('should give the user a policies array', function() {
                expect(req.body.policies).toEqual([]);
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalledWith();
            });
        });
    });

    describe('hashProp(prop, req, next, done)', function() {
        var prop, req, next, done;
        var success, failure;
        var salt, hash;
        var hashCallback;

        beforeEach(function(proceed) {
            prop = 'someProp';
            req = {
                user: { id: 'u-978ae0224eb7aa' },
                requester: { id: 'u-978ae0224eb7aa', permissions: {} },
                body: {
                    someProp: 'MySupp3rS3cur3P@ssw0rd'
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            salt = '1db621a7d17a0bc84a3a6016c323';
            hash = '234c8eccef2c27732686dd2dbe6eedaadf7fd061d81e5fa26386607d';

            spyOn(bcrypt, 'hash').and.callFake(function(data, salt, cb) {
                hashCallback = cb;
            });
            spyOn(bcrypt, 'genSaltSync').and.returnValue(salt);

            userModule.hashProp(prop, req, next, done).then(success, failure);

            q().then(proceed);
        });

        it('should hash the prop', function() {
            expect(bcrypt.hash).toHaveBeenCalledWith(req.body[prop], salt, jasmine.any(Function));
        });

        [null, undefined, true, false, 20, ''].forEach(function(value) {
            describe('if the prop is "' + value + '"', function() {
                beforeEach(function(proceed) {
                    next.calls.reset();
                    done.calls.reset();
                    success.calls.reset();
                    failure.calls.reset();
                    bcrypt.hash.calls.reset();
                    prop = 'foo';
                    req.body[prop] = value;

                    userModule.hashProp(prop, req, next, done).then(success, failure);
                    q().then(proceed);
                });

                it('should not hash the prop', function() {
                    expect(bcrypt.hash).not.toHaveBeenCalled();
                });

                it('should not call next()', function() {
                    expect(next).not.toHaveBeenCalled();
                });

                it('should call done()', function() {
                    expect(done).toHaveBeenCalledWith({
                        code: 400,
                        body: prop + ' is missing/not valid.'
                    });
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalled();
                });
            });
        });

        describe('if there is an error', function() {
            var error;

            beforeEach(function(proceed) {
                error = new Error('I GOT A PROBLEM.');
                hashCallback(error);
                q().then(function() {}).then(function() {}).then(proceed);
            });

            it('should reject the promise', function() {
                expect(failure).toHaveBeenCalledWith(error);
            });

            it('should not update the prop', function() {
                expect(req.body[prop]).toBe('MySupp3rS3cur3P@ssw0rd');
            });

            it('should not call next()', function() {
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe('if there is no error', function() {
            beforeEach(function(proceed) {
                hashCallback(null, hash);
                q().then(function() {}).then(function() {}).then(proceed);
            });

            it('should set the password to the hash', function() {
                expect(req.body[prop]).toBe(hash);
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalled();
            });

            it('should fulfill the promise', function() {
                expect(success).toHaveBeenCalled();
            });
        });
    });

    describe('validateRoles(svc, req, next, done)', function() {
        var roleColl, roles, svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, userModule.config, mockCache, appCreds);
            roles = [
                { id: 'r-1', name: 'role1' },
                { id: 'r-2', name: 'role2' },
                { id: 'r-3', name: 'role3' }
            ];
            roleColl = {
                find: jasmine.createSpy('roles.find()').and.callFake(function() {
                    return { toArray: function() {
                        return q(roles);
                    } };
                })
            };
            mockDb.collection.and.returnValue(roleColl);
            req.body = { roles: ['role1', 'role2', 'role3'] };
        });

        it('should call next if all roles on the request body exist', function(done) {
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(roleColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['role1', 'role2', 'role3'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if there are no roles on the request body', function(done) {
            delete req.body.roles;
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.find).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 400 if not all roles are found', function(done) {
            req.body.roles.push('role4', 'role5');
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These roles were not found: [role4,role5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(roleColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['role1', 'role2', 'role3', 'role4', 'role5'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                done();
            });
        });

        it('should reject if mongo fails', function(done) {
            roleColl.find.and.returnValue({ toArray: function() { return q.reject('I GOT A PROBLEM'); } });
            userModule.validateRoles(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(roleColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('validatePolicies(svc, req, next, done)', function() {
        var polColl, pols, svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, userModule.config, mockCache, appCreds);
            pols = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-2', name: 'pol2' },
                { id: 'p-3', name: 'pol3' }
            ];
            polColl = {
                find: jasmine.createSpy('policies.find()').and.callFake(function() {
                    return { toArray: function() {
                        return q(pols);
                    } };
                })
            };
            mockDb.collection.and.returnValue(polColl);
            req.body = { policies: ['pol1', 'pol2', 'pol3'] };
        });

        it('should call next if all policies on the request body exist', function(done) {
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('policies');
                expect(polColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if there are no policies on the request body', function(done) {
            delete req.body.policies;
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(polColl.find).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 400 if not all policies are found', function(done) {
            req.body.policies.push('pol4', 'pol5');
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These policies were not found: [pol4,pol5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(polColl.find).toHaveBeenCalledWith(
                    { name: { $in: ['pol1', 'pol2', 'pol3', 'pol4', 'pol5'] }, status: { $ne: Status.Deleted } },
                    { fields: { name: 1 } }
                );
                done();
            });
        });

        it('should reject if mongo fails', function(done) {
            polColl.find.and.returnValue({ toArray: function() { return q.reject('I GOT A PROBLEM'); } });
            userModule.validatePolicies(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(polColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('preventSelfDeletion(req, next, done)', function() {
        var req, next, done;

        beforeEach(function() {
            req = {
                params: { id: 'u-848a8c6d11ddcd' },
                user: { id: 'u-4b023952363514' },
                requester: { id: 'u-4b023952363514', permissions: {} },
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
        });

        describe('if the user is not trying to delete themselves', function() {
            beforeEach(function() {
                expect(req.user.id).not.toBe(req.params.id);

                userModule.preventSelfDeletion(req, next, done);
            });

            it('should not log a warning', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
            });

            it('should not call done()', function() {
                expect(done).not.toHaveBeenCalled();
            });

            it('should call next()', function() {
                expect(next).toHaveBeenCalled();
            });
        });

        describe('if the user is trying to delete themselves', function() {
            beforeEach(function() {
                req.params.id = req.requester.id;

                userModule.preventSelfDeletion(req, next, done);
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should not call next()', function() {
                expect(next).not.toHaveBeenCalled();
            });

            it('should call done() with an error response', function() {
                expect(done).toHaveBeenCalledWith({
                    code: 400,
                    body: 'You cannot delete yourself'
                });
            });
        });
    });

    describe('checkExistingWithNewEmail(sv, req, next, done)', function() {
        var validateUniquePropDeferred;
        var svc, req, next, done;
        var success, failure;
        var result;

        beforeEach(function() {
            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            validateUniquePropDeferred = q.defer();

            svc = {
                validateUniqueProp: jasmine.createSpy('svc.validateUniqueProp()').and.returnValue(validateUniquePropDeferred.promise)
            };
            req = {
                user: { id: 'u-19fa31cb1a8e0f' },
                requester: { id: 'u-19fa31cb1a8e0f', permissions: {} },
                body: {
                    newEmail: 'Josh@Cinema6.com'
                }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');

            result = userModule.checkExistingWithNewEmail(svc, req, next, done);
        });

        [undefined, null, 44, '', true, false].forEach(function(data) {
            describe('if newEmail is "' + data + '"', function() {
                beforeEach(function() {
                    svc.validateUniqueProp.calls.reset();
                    req.body.newEmail = data;

                    userModule.checkExistingWithNewEmail(svc, req, next, done);
                });

                it('should not call validateUniqueProp()', function() {
                    expect(svc.validateUniqueProp).not.toHaveBeenCalled();
                });

                it('should not call next()', function() {
                    expect(next).not.toHaveBeenCalled();
                });

                it('should call done()', function() {
                    expect(done).toHaveBeenCalledWith({
                        code: 400,
                        body: 'Must provide a new email'
                    });
                });
            });
        });

        it('should make the newEmail lowercase', function() {
            expect(req.body.newEmail).toBe('josh@cinema6.com');
        });

        it('should call and return svc.validateUniqueProp()', function() {
            expect(svc.validateUniqueProp).toHaveBeenCalledWith(
                'email',
                null,
                { body: { email: 'josh@cinema6.com' } },
                next,
                done
            );
            expect(result).toBe(validateUniquePropDeferred.promise);
        });
    });

    describe('authorizeForceLogout(req, next, done)', function() {
        var req, next, done;

        function itShouldCallDone() {
            it('should call done() with a 403', function() {
                expect(done).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to force logout users' });
                expect(next).not.toHaveBeenCalled();
            });
        }

        beforeEach(function() {
            req = {
                user: { id: 'u-1' },
                requester: { id: 'u-1', permissions: {} }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
        });

        describe('if the requester has no permissions', function() {
            beforeEach(function() {
                req.requester.permissions = null;
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the requester has no users permissions', function() {
            beforeEach(function() {
                req.requester.permissions = { experiences: {}, elections: {}, campaigns: {} };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the requester has no edit permissions for users', function() {
            beforeEach(function() {
                req.requester.permissions = {
                    users: { read: Scope.All, create: Scope.Org }
                };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        [Scope.Own, Scope.Org].forEach(function(scope) {
            describe('if the requester\'s users edit permissions are ' + scope, function() {
                beforeEach(function() {
                    req.requester.permissions = {
                        users: { edit: scope }
                    };
                    userModule.authorizeForceLogout(req, next, done);
                });

                itShouldCallDone();
            });
        });

        describe('if the requester\'s users edit permissions are ' + Scope.All, function() {
            beforeEach(function() {
                req.requester.permissions = {
                    users: { edit: Scope.All }
                };
                userModule.authorizeForceLogout(req, next, done);
            });

            it('should call next()', function() {
                expect(done).not.toHaveBeenCalled();
                expect(next).toHaveBeenCalledWith();
            });
        });
    });

    describe('changePassword(svc, req)', function() {
        var deferred;
        var users;
        var svc, req;
        var result;

        beforeEach(function() {
            deferred = q.defer();

            users = {
                update: jasmine.createSpy('users.update()')
            };

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod(req, actionName, cb)').and.returnValue(deferred.promise),
                _coll: users
            };
            req = {
                user: {
                    id: 'u-7e4895c648c57d'
                },
                body: {
                    newPassword: 'f081611cbba5acab5d3051b32698238a7c637419ff87a5fc6e66233b',
                    email: 'someone@domain.com'
                }
            };

            result = userModule.changePassword(svc, req);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'changePassword', jasmine.any(Function));
            expect(result).toBe(deferred.promise);
        });

        describe('the callback', function() {
            var callback;
            var success, failure;
            var editObjectDeferred;

            beforeEach(function(done) {
                callback = svc.customMethod.calls.mostRecent().args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                editObjectDeferred = q.defer();
                spyOn(mongoUtils, 'editObject').and.returnValue(editObjectDeferred.promise);

                callback().then(success, failure);

                q().then(done);
            });

            it('should update the user with the new password', function() {
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, { password: req.body.newPassword }, req.user.id);
            });

            describe('if the update fails', function() {
                var error;

                beforeEach(function(done) {
                    error = new Error('It didn\'t work.');

                    editObjectDeferred.reject(error);
                    editObjectDeferred.promise.finally(done);
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });
            });

            describe('if the update succeeds', function() {
                beforeEach(function(done) {
                    editObjectDeferred.resolve();
                    editObjectDeferred.promise.finally(done);
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({
                        code: 200,
                        body: 'Successfully changed password'
                    });
                });
            });
        });
    });

    describe('changeEmail(svc, req)', function() {
        var deferred;
        var users;
        var svc, req;
        var result;

        beforeEach(function() {
            deferred = q.defer();

            users = {
                update: jasmine.createSpy('users.update()')
            };

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod(req, actionName, cb)').and.returnValue(deferred.promise),
                _coll: users
            };
            req = {
                user: {
                    id: 'u-7e4895c648c57d'
                },
                body: {
                    email: 'jminzner@cinema6.com',
                    newEmail: 'josh@cinema6.com'
                }
            };

            result = userModule.changeEmail(svc, req);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'changeEmail', jasmine.any(Function));
            expect(result).toBe(deferred.promise);
        });

        describe('the callback', function() {
            var callback;
            var success, failure;
            var editObjectDeferred;

            beforeEach(function(done) {
                callback = svc.customMethod.calls.mostRecent().args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                editObjectDeferred = q.defer();
                spyOn(mongoUtils, 'editObject').and.returnValue(editObjectDeferred.promise);

                callback().then(success, failure);

                q().then(done);
            });

            it('should update the email', function() {
                expect(mongoUtils.editObject).toHaveBeenCalledWith(users, { email: req.body.newEmail }, req.user.id);
            });

            describe('if the update fails', function() {
                var error;

                beforeEach(function(done) {
                    error = new Error('I GOT A PROBLEM');

                    editObjectDeferred.reject(error);

                    editObjectDeferred.promise.finally(done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });
            });

            describe('if the update succeeds', function() {
                beforeEach(function(done) {
                    editObjectDeferred.resolve();
                    editObjectDeferred.promise.finally(done);
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({
                        code: 200,
                        body: 'Successfully changed email'
                    });
                });
            });
        });
    });

    xdescribe('signupUser', function() { //TODO
        var customMethodDeferred, mockModel;
        var svc, req;
        var result;

        beforeEach(function() {
            customMethodDeferred = q.defer();
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(customMethodDeferred.promise),
                _coll: 'users',
                transformMongoDoc: jasmine.createSpy('svc.transformMongoDoc()').and.callFake(function(value) {
                    return value;
                }),
                formatOutput: jasmine.createSpy('svc.formatOutput()').and.callFake(function(value) {
                    return value;
                })
            };
            mockModel = {
                validate: jasmine.createSpy('model.validate()').and.returnValue({ isValid: true })
            };
            spyOn(userModule, 'createSignupModel').and.returnValue(mockModel);
            req = {
                body: {
                    foo: 'bar'
                }
            };
            result = userModule.signupUser(svc, req);
        });

        it('should validate the model', function() {
            expect(userModule.createSignupModel).toHaveBeenCalledWith(svc);
            expect(mockModel.validate).toHaveBeenCalledWith('create', { foo: 'bar' }, {}, {});
        });

        describe('when the model is valid', function() {
            beforeEach(function() {
                mockModel.validate.and.returnValue({
                    isValid: true,
                    reason: null
                });
            });

            it('should call and return svc.customMethod()', function() {
                expect(svc.customMethod).toHaveBeenCalledWith(req, 'signupUser', jasmine.any(Function));
                expect(result).toBe(customMethodDeferred.promise);
            });

            describe('the callback passed to svc.customMethod()', function() {
                var callback;
                var success, failure;

                beforeEach(function(done) {
                    callback = svc.customMethod.calls.mostRecent().args[2];
                    success = jasmine.createSpy('success()');
                    failure = jasmine.createSpy('failure()');

                    spyOn(mongoUtils, 'createObject').and.callFake(function(collection, document) {
                        return q(document);
                    });

                    callback().then(success, failure).finally(done);
                });

                it('should create an object in the mongo collection', function() {
                    expect(mongoUtils.createObject).toHaveBeenCalledWith('users', { foo: 'bar' });
                });

                it('should transform the mongo doc', function() {
                    expect(svc.transformMongoDoc).toHaveBeenCalledWith(req.body);
                });

                it('should fulfill with a 201', function() {
                    expect(success).toHaveBeenCalledWith({ code: 201, body: { foo: 'bar' } });
                    expect(failure).not.toHaveBeenCalled();
                });
            });
        });

        describe('when the model is not valid', function() {
            beforeEach(function() {
                mockModel.validate.and.returnValue({
                    isValid: false,
                    reason: 'error message'
                });
            });

            it('should resolve with a 400', function(done) {
                userModule.signupUser(svc, req).then(function(res) {
                    expect(res.code).toBe(400);
                    expect(res.body).toBe('error message');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });
    });

    describe('confirmUser', function() {
        var customMethodDeferred;
        var svc, req, journal;
        var result;

        beforeEach(function() {
            customMethodDeferred = q.defer();
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(customMethodDeferred.promise),
                _coll: {
                    findOneAndUpdate: jasmine.createSpy('findOneAndUpdate()').and.returnValue(q({ value: { id: 'u-12345' } }))
                },
                transformMongoDoc: jasmine.createSpy('transformMongoDoc(doc)').and.returnValue('transformed user')
            };
            req = {
                user: {
                    id: 'u-12345',
                    org: 'o-12345',
                    advertiser: 'a-12345'
                },
                requester: { id: 'u-12345', permissions: {} },
                session: {
                    regenerate: jasmine.createSpy('regenerate()').and.callFake(function(cb) {
                        cb(null, q());
                    }),
                    cookie: { }
                },
                body: {
                    foo: 'bar',
                    token: 'some token'
                }
            };
            journal = {
                writeAuditEntry: jasmine.createSpy('writeAuditEntry').and.returnValue(q())
            };
            spyOn(authUtils, 'decorateUser').and.returnValue(q({id: 'u-12345'}));
            result = userModule.confirmUser(svc, req, journal);
        });

        it('should return a 400 if a token is not present on the body of the request', function(done) {
            delete req.body.token;
            userModule.confirmUser(svc, req, journal).done(function(result) {
                expect(result).toEqual({code:400,body:'Must provide a token'});
                done();
            });
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'confirmUser', jasmine.any(Function));
            expect(result).toBe(customMethodDeferred.promise);
        });
        
        it('should log an error if updating the user fails', function(done) {
            svc._coll.findOneAndUpdate.and.returnValue(q.reject('error'));
            var callback = svc.customMethod.calls.mostRecent().args[2];
            callback().then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        describe('the callback passed to svc.customMethod()', function() {
            var callback;
            var success, failure;

            beforeEach(function(done) {
                callback = svc.customMethod.calls.mostRecent().args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                callback().then(success, failure).finally(done);
            });

            it('should update the user in the db', function() {
                expect(svc._coll.findOneAndUpdate).toHaveBeenCalledWith(
                    { id: 'u-12345' },
                    {
                        $set: {
                            lastUpdated: jasmine.any(Date),
                            status: 'active',
                            org: 'o-12345'
                        },
                        $unset: {
                            activationToken: 1
                        }
                    },
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                );
            });

            it('should regenerate the session', function() {
                expect(req.session.regenerate).toHaveBeenCalledWith(jasmine.any(Function));
            });

            it('should delete the user off of the request', function() {
                expect(req.user).not.toBeDefined();
            });

            it('should decorate a transformed mongo doc', function() {
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({id: 'u-12345'});
                expect(authUtils.decorateUser).toHaveBeenCalledWith('transformed user');
            });

            it('should write an audit entry', function() {
                expect(journal.writeAuditEntry).toHaveBeenCalledWith(req, 'u-12345');
            });

            it('should set the session on the request', function() {
                expect(req.session.user).toBe('u-12345');
                expect(req.session.cookie.maxAge).toBe(userModule.config.sessions.maxAge);
            });

            it('should retun with a 200', function() {
                expect(success).toHaveBeenCalledWith({code: 200, body: {id: 'u-12345'}});
                expect(failure).not.toHaveBeenCalled();
            });
        });
    });
    
    describe('resendActivation(svc, req)', function(done) { //TODO
        var svc, req;
        var mockUser, result;

        beforeEach(function() {
            mockUser = {
                id: 'u-12345',
                org: 'o-12345',
                advertiser: 'a-12345',
                email: 'some email'
            };
            spyOn(mongoUtils, 'editObject').and.returnValue(q(mockUser));
            spyOn(mongoUtils, 'findObject').and.returnValue(q(mockUser));
            spyOn(streamUtils, 'produceEvent').and.returnValue(q());
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(q()),
                _coll: 'fakeColl'
            };
            req = {
                body: { },
                query: { target: 'showcase' },
                session: {
                    user: 'u-12345'
                }
            };
        });

        it('should get the account of the user currently logged in', function(done) {
            userModule.resendActivation(svc, req).done(function() {
                expect(mongoUtils.findObject).toHaveBeenCalledWith('fakeColl', {id: 'u-12345'});
                done();
            });
        });

        it('should return a 403 if the user does not have an activationToken', function(done) {
            userModule.resendActivation(svc, req).done(function(result) {
                expect(result).toEqual({code: 403, body: 'No activation token to resend'});
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should return a 403 if the user does not exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            userModule.resendActivation(svc, req).done(function(result) {
                expect(result).toEqual({code: 403, body: 'No activation token to resend'});
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if finding the user fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            userModule.resendActivation(svc, req).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should call and return svc.customMethod()', function(done) {
            mockUser.activationToken = { };
            userModule.resendActivation(svc, req).done(function(result) {
                var expectedReq = {
                    body: {
                        id: 'u-12345',
                        email: 'some email'
                    },
                    query: { target: 'showcase' },
                    session: {
                        user: 'u-12345'
                    }
                };
                expect(svc.customMethod).toHaveBeenCalledWith(expectedReq, 'resendActivation', jasmine.any(Function));
                done();
            });
        });

        describe('the callback passed to svc.customMethod()', function() {
            var success, failure;

            beforeEach(function() {
                mockUser.activationToken = {
                    token: 'old token'
                };
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');
                req.body.activationToken = {
                    token: 'new token',
                    expires: 'sometime'
                };
                req.tempToken = 'unhashedToken';
                req.user = mockUser;
                svc.customMethod.and.callFake(function(req, action, cb) {
                    req.body.activationToken = {
                        token: 'new token',
                        expires: 'sometime'
                    };
                    return cb();
                });
            });
            
            describe('if everything succeeds', function() {
                beforeEach(function(done) {
                    userModule.resendActivation(svc, req).then(success, failure).done(done);
                });
            
                it('should update the user with its new activation token', function() {
                    var expectedUpdates = {
                        lastUpdated: jasmine.any(Date),
                        activationToken: {
                            token: 'new token',
                            expires: 'sometime'
                        }
                    };
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(svc._coll, expectedUpdates, 'u-12345');
                });
                
                it('should produce a resendActivation event', function() {
                    expect(streamUtils.produceEvent).toHaveBeenCalledWith('resendActivation', {
                        target: 'showcase',
                        token: 'unhashedToken',
                        user: mockUser
                    });
                });
                
                it('should return with a 204', function() {
                    expect(success).toHaveBeenCalledWith({ code: 204 });
                    expect(failure).not.toHaveBeenCalled();
                });
                
                it('should clear the tempToken', function() {
                    expect(req.tempToken).not.toBeDefined();
                });
            });
            
            describe('if editing the user fails', function() {
                beforeEach(function(done) {
                    mongoUtils.editObject.and.returnValue(q.reject('MONGO GOT PROBLEMS'));
                    userModule.resendActivation(svc, req).then(success, failure).done(done);
                });
                
                it('should not produce a resendActivation event', function() {
                    expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                });
                
                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith('MONGO GOT PROBLEMS');
                });
                
                it('should clear the tempToken', function() {
                    expect(req.tempToken).not.toBeDefined();
                });
            });
            
            describe('if producing the event fails', function() {
                beforeEach(function(done) {
                    streamUtils.produceEvent.and.returnValue(q.reject('KINESIS GOT PROBLEMS'));
                    userModule.resendActivation(svc, req).then(success, failure).done(done);
                });
                
                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith('Failed producing resendActivation event');
                });
                
                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('KINESIS GOT PROBLEMS'));
                });
                
                it('should clear the tempToken', function() {
                    expect(req.tempToken).not.toBeDefined();
                });
            });
        });
    });
    
    describe('produceAccountActivated', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
            req.query = { target: 'showcase' };
        });
        
        it('should produce the accountActivated event', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            var mockResp = {
                code: 200,
                body: {
                    id: 'u-123'
                }
            };
            userModule.produceAccountActivated(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('accountActivated', {
                    target: 'showcase',
                    user: {
                        id: 'u-123'
                    }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error if there was an error producing the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            var mockResp = {
                code: 200,
                body: {
                    id: 'u-123'
                }
            };
            userModule.produceAccountActivated(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should not produce if not given a successfull response', function(done) {
            q.all([{ code: 400, body: { } }, { code: 200, body: 'not an object' }].map(function(mockResp) {
                return userModule.produceAccountActivated(req, mockResp).then(function(resp) {
                    expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(resp).toEqual(mockResp);
                });
            })).then(done, done.fail);
        });
    });
    
    describe('producePasswordChanged', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
            req.query = { target: 'selfie' };
            req.user = 'user';
        });
        
        it('should produce the passwordChanged event', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            var mockResp = {
                code: 200,
                body: 'password changed'
            };
            userModule.producePasswordChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('passwordChanged', {
                    target: 'selfie',
                    user: 'user'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error if there was an error producing the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            var mockResp = {
                code: 200,
                body: 'password changed'
            };
            userModule.producePasswordChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('shoud not produce if not given a successfull response', function(done) {
            var mockResp = {
                code: 400,
                body: 'password changed'
            };
            userModule.producePasswordChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
    });
    
    describe('produceEmailChanged', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
            req.body = {
                email: 'oldEmail@gmail.com',
                newEmail: 'newEmail@gmail.com'
            };
            req.user = {
                email: 'oldEmail@gmail.com'
            };
            req.query = { target: 'selfie' };
        });
        
        it('should produce the emailChanged event twice', function(done) {
            streamUtils.produceEvent.and.returnValue(q());
            var mockResp = {
                code: 200,
                body: 'email changed'
            };
            userModule.produceEmailChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent.calls.count()).toBe(2);
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('emailChanged', {
                    target: 'selfie',
                    oldEmail: 'oldEmail@gmail.com',
                    newEmail: 'newEmail@gmail.com',
                    user: {
                        email: 'oldEmail@gmail.com'
                    }
                });
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('emailChanged', {
                    target: 'selfie',
                    oldEmail: 'oldEmail@gmail.com',
                    newEmail: 'newEmail@gmail.com',
                    user: {
                        email: 'newEmail@gmail.com'
                    }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error for each failed attempt to produce the event', function(done) {
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            var mockResp = {
                code: 200,
                body: 'email changed'
            };
            userModule.produceEmailChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent.calls.count()).toBe(2);
                expect(mockLog.error.calls.count()).toBe(2);
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should not produce if not given a successfull response', function(done) {
            var mockResp = {
                code: 400,
                body: 'email changed'
            };
            userModule.produceEmailChanged(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
    });

    describe('forceLogoutUser(svc, req, sessions)', function() {
        var customMethodDeffered;
        var svc, req, sessions;
        var success, failure;
        var result;

        beforeEach(function() {
            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            customMethodDeffered = q.defer();

            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(customMethodDeffered.promise)
            };
            req = {
                user: { id: 'u-19fa31cb1a8e0f' },
                requester: { id: 'u-19fa31cb1a8e0f', permissions: {} },
                params: { id: 'u-fbe05a74517c06' },
                session: {
                    user: 'u-19fa31cb1a8e0f'
                }
            };
            sessions = {
                deleteMany: jasmine.createSpy('sessions.deleteMany()').and.returnValue(q({ deletedCount: 1 }))
            };

            result = userModule.forceLogoutUser(svc, req, sessions);
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'forceLogout', jasmine.any(Function));
            expect(result).toBe(customMethodDeffered.promise);
        });

        describe('the callback passed to svc.customMethod()', function() {
            var callback;
            var success, failure;

            beforeEach(function() {
                callback = svc.customMethod.calls.mostRecent().args[2];
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');
            });

            it('should remove the user\'s sessions', function(done) {
                callback().done(function() {
                    expect(sessions.deleteMany).toHaveBeenCalledWith(
                        { 'session.user': req.params.id },
                        { w: 1, j: true }
                    );
                    done();
                });
            });

            describe('if the remove fails', function() {
                var removeCallback;
                var error;

                beforeEach(function(done) {
                    error = new Error('I suck.');
                    sessions.deleteMany.and.returnValue(q.reject(error));
                    callback().then(success, failure).done(done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });
            });

            describe('if the remove succeeds', function() {
                var removeCallback;

                beforeEach(function(done) {
                    callback().then(success, failure).done(done);
                });

                it('should not log an error', function() {
                    expect(mockLog.log).not.toHaveBeenCalled();
                });

                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({ code: 204 });
                });
            });
            
            describe('when logging own oneself', function() {
                beforeEach(function(done) {
                    req.params.id = 'u-19fa31cb1a8e0f';
                    callback().then(success, failure).done(done);
                });
                
                it('should not log an error', function() {
                    expect(mockLog.log).not.toHaveBeenCalled();
                });
                
                it('should fulfill the promise', function() {
                    expect(success).toHaveBeenCalledWith({ code: 204 });
                });
                
                it('should delete the session object off of the request', function() {
                    expect(req.session).not.toBeDefined();
                });
            });
        });
    });
});
