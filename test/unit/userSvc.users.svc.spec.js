var flush = true;
describe('userSvc (UT)', function() {
    var userModule, q, bcrypt, mockLog, uuid, logger, CrudSvc, Model, mongoUtils, email, crypto, authUtils,
        CacheMutex, requestUtils, objUtils, req, userSvc, mockDb, mockConfig, nextSpy, doneSpy, errorSpy, mockCache;

    var enums = require('../../lib/enums'),
        Status = enums.Status,
        Scope = enums.Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        userModule      = require('../../bin/userSvc-users');
        q               = require('q');
        bcrypt          = require('bcrypt');
        crypto          = require('crypto');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc.js');
        Model           = require('../../lib/model.js');
        mongoUtils      = require('../../lib/mongoUtils');
        authUtils       = require('../../lib/authUtils.js');
        objUtils        = require('../../lib/objUtils');
        email           = require('../../lib/email');
        uuid            = require('../../lib/uuid');
        CacheMutex      = require('../../lib/cacheMutex.js');
        requestUtils    = require('../../lib/requestUtils.js');

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
        req = {uuid: '1234'};
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        mockConfig = {
            emails: {
                region: 'us-east-1',
                sender: 'support@cinema6.com',
                activationTarget: 'https://www.selfie.cinema6.com/activate',
                dashboardLink: 'http://seflie.c6.com/review/campaigns'
            },
            port: 3500,
            activationTokenTTL: 60000,
            newUserPermissions: {
                roles: ['newUserRole1'],
                policies: ['newUserPol1'],
                tempPolicy: 'tempPolicy'
            },
            api: {
                root: 'http://localhost'
            }
        };
    });

    describe('setupSvc', function() {
        var result;

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
            [CrudSvc.prototype.preventGetAll, CrudSvc.prototype.validateUniqueProp, userModule.checkExistingWithNewEmail,
             userModule.hashProp, userModule.validateRoles, userModule.validatePolicies, userModule.setupSignupUser,
             userModule.filterProps, userModule.giveActivationToken, userModule.sendActivationEmail,
             userModule.checkValidToken, userModule.createLinkedEntities, userModule.sendConfirmationEmail,
             userModule.handleBrokenUser].forEach(function(fn) {
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

            mockCache = {
                
            };

            result = userModule.setupSvc(mockDb, mockConfig, mockCache);
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

        it('should prevent getting all users', function() {
            expect(result.preventGetAll.bind).toHaveBeenCalledWith(result);
            expect(result._middleware.read).toContain(getBoundFn(result.preventGetAll, [result]));
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

        it('should setupSignupUser when signing up a user', function() {
            expect(userModule.setupSignupUser.bind).toHaveBeenCalledWith(userModule, result, ['newUserRole1'], ['newUserPol1']);
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.setupSignupUser, [userModule, result, ['newUserRole1'], ['newUserPol1']]));
        });

        it('should filter props when signing up a user', function() {
            expect(userModule.filterProps.bind).toHaveBeenCalledWith(userModule, ['org', 'customer', 'advertiser']);
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.filterProps, [userModule, ['org', 'customer', 'advertiser']]));
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

        it('should give an activation token when signing up a user', function() {
            expect(userModule.giveActivationToken.bind).toHaveBeenCalledWith(userModule, 60000);
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.giveActivationToken, [userModule, 60000]));
        });

        it('should send an activation email when signing up a user', function() {
            expect(userModule.sendActivationEmail.bind).toHaveBeenCalledWith(userModule, 'support@cinema6.com', 'https://www.selfie.cinema6.com/activate');
            expect(result._middleware.signupUser).toContain(getBoundFn(userModule.sendActivationEmail, [userModule, 'support@cinema6.com', 'https://www.selfie.cinema6.com/activate']));
        });

        it('should check validity of token on user confirm', function() {
            expect(userModule.checkValidToken.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.checkValidToken, [userModule, result]));
        });

        it('should give linked entities on user confirm', function() {
            expect(userModule.createLinkedEntities.bind).toHaveBeenCalledWith(userModule, mockConfig.api, 3500, mockCache);
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.createLinkedEntities, [userModule, mockConfig.api, 3500, mockCache]));
        });

        it('should send confirmation email on user confirm', function() {
            expect(userModule.sendConfirmationEmail.bind).toHaveBeenCalledWith(userModule, 'support@cinema6.com', 'http://seflie.c6.com/review/campaigns');
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.sendConfirmationEmail, [userModule, 'support@cinema6.com', 'http://seflie.c6.com/review/campaigns']));
        });

        it('should handle a broken user', function() {
            expect(userModule.handleBrokenUser.bind).toHaveBeenCalledWith(userModule, result);
            expect(result._middleware.confirmUser).toContain(getBoundFn(userModule.handleBrokenUser, [userModule, result]));
        });
        
        it('should give an activation token on resendActivation', function() {
            expect(userModule.giveActivationToken.bind).toHaveBeenCalledWith(userModule, 60000);
            expect(result._middleware.resendActivation).toContain(getBoundFn(userModule.giveActivationToken, [userModule, 60000]));
        });
        
        it('should send an activation email on resendActivation', function() {
            expect(userModule.sendActivationEmail.bind).toHaveBeenCalledWith(userModule, 'support@cinema6.com', 'https://www.selfie.cinema6.com/activate');
            expect(result._middleware.resendActivation).toContain(getBoundFn(userModule.sendActivationEmail, [userModule, 'support@cinema6.com', 'https://www.selfie.cinema6.com/activate']));
        });
    });

    describe('user validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, mockConfig);
            newObj = { email: 'test@me.com', password: 'pass' };
            origObj = {};
            requester = { fieldValidation: { users: {} } };
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
    });

    describe('checkValidToken', function() {
        var svc, req, nextSpy, doneSpy;

        beforeEach(function() {
            svc = {
                _coll: {
                    findOne: jasmine.createSpy('findOne()')
                },
                transformMongoDoc: jasmine.createSpy('transformMongoDoc(doc)').and.callFake(function(doc) {
                    return doc;
                })
            };
            req = {
                params: { },
                body: { }
            };
            nextSpy = jasmine.createSpy('next()').and.returnValue(q());
            doneSpy = jasmine.createSpy('done()').and.returnValue(q());
            spyOn(bcrypt, 'compare');
        });

        describe('when the user does not exist', function() {
            beforeEach(function(done) {
                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, null);
                });
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
                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, { status: 'active', activationToken: {} });
                });
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Confirmation failed'});
            });
        });

        describe('when the user does not have an activation token', function() {
            beforeEach(function(done) {
                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, { status: 'new' });
                });
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Confirmation failed'});
            });
        });

        describe('when the activation token on the user has expired', function() {
            beforeEach(function(done) {
                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, {
                        status: 'new',
                        activationToken: {
                            expires: String(new Date(0))
                        }
                    });
                });
                userModule.checkValidToken(svc, req, nextSpy, doneSpy).done(done);
            });

            it('should call done with a 403', function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Activation token has expired'});
            });
        });

        describe('when the provided token does not match the stored activation token', function() {
            beforeEach(function(done) {
                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, {
                        status: 'new',
                        activationToken: {
                            expires: new Date(99999, 11, 25),
                            token: 'salty token'
                        }
                    });
                });
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
            var userDocument;

            beforeEach(function(done) {
                userDocument = {
                    status: 'new',
                    activationToken: {
                        expires: new Date(99999, 11, 25),
                        token: 'salty token'
                    }
                };

                svc._coll.findOne.and.callFake(function(query, cb) {
                    cb(null, userDocument);
                });
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
                expect(svc.transformMongoDoc).toHaveBeenCalledWith(userDocument);
                expect(req.user).toEqual(userDocument);
            });
        });
    });

    describe('createLinkedEntities()', function() {
        var api, req, nextSpy, doneSpy;

        beforeEach(function() {
            spyOn(requestUtils, 'qRequest');
            spyOn(userModule, 'getSixxySession').and.returnValue(q('sixxy cookie'));
            api = {
                root: 'http://localhost',
                orgs: {
                    endpoint: '/api/account/orgs'
                },
                customers: {
                    endpoint: '/api/account/customers'
                },
                advertisers: {
                    endpoint: '/api/account/advertisers'
                }
            };
            spyOn(CacheMutex.prototype, 'acquire').and.returnValue(q(true));
            spyOn(CacheMutex.prototype, 'release').and.returnValue(q());
            nextSpy = jasmine.createSpy('nextSpy()').and.returnValue(q());
            doneSpy = jasmine.createSpy('doneSpy()').and.returnValue(q());
            req = {
                user: {
                    id: 'u-12345',
                    company: 'some company'
                }
            };
        });

        describe('when requests succeed', function() {
            beforeEach(function() {
                requestUtils.qRequest.and.callFake(function(method, opts) {
                    var object = opts.url.match(/orgs|customers|advertisers/)[0];
                    return q({
                        response: {
                            statusCode: 201
                        },
                        body: {
                            id: object + '-id-123'
                        }
                    });
                });
            });

            describe('the cache mutex', function() {
                beforeEach(function(done) {
                    spyOn(CacheMutex.prototype, '_init');
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy, doneSpy).done(done);
                });
                
                it('should be created', function() {
                    expect(CacheMutex.prototype._init).toHaveBeenCalledWith(mockCache, 'confirmUser:u-12345', 60000);
                });

                it('should attempt to aquire the mutex lock', function() {
                    expect(CacheMutex.prototype.acquire).toHaveBeenCalled();
                });
            });

            describe('when the mutex lock is able to be acquired', function() {
                beforeEach(function(done) {
                    CacheMutex.prototype.acquire.and.returnValue(q(true));
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy, doneSpy).done(done);
                });
                
                it('should get the sixxy user session', function() {
                    expect(userModule.getSixxySession).toHaveBeenCalledWith(req, 3500);
                });

                it('should send a request to create an org', function() {
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'http://localhost/api/account/orgs',
                        json: {
                            name: 'some company (u-12345)'
                        },
                        headers: {
                            cookie: 'sixxy cookie'
                        }
                    });
                });

                it('should send a request to create a customer', function() {
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'http://localhost/api/account/customers',
                        json: {
                            name: 'some company (u-12345)',
                            advertisers: ['advertisers-id-123']
                        },
                        headers: {
                            cookie: 'sixxy cookie'
                        }
                    });
                });

                it('should send a request to create an advertiser', function() {
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'http://localhost/api/account/advertisers',
                        json: {
                            name: 'some company (u-12345)'
                        },
                        headers: {
                            cookie: 'sixxy cookie'
                        }
                    });
                });

                it('should set company properties on request', function() {
                    expect(req.user.org).toBe('orgs-id-123');
                    expect(req.user.customer).toBe('customers-id-123');
                    expect(req.user.advertiser).toBe('advertisers-id-123');
                });

                it('should release the mutex lock', function() {
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                });

                it('should call next', function() {
                    expect(nextSpy).toHaveBeenCalled();
                });
            });

            describe('when the mutex lock is unable to be required', function() {
                beforeEach(function(done) {
                    CacheMutex.prototype.acquire.and.returnValue(q(false));
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy, doneSpy).done(done);
                });
                
                it('should not release the mutex lock', function() {
                    expect(CacheMutex.prototype.release).not.toHaveBeenCalled();
                });

                it('should call done', function() {
                    expect(nextSpy).not.toHaveBeenCalled();
                    expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Another operation is already in progress' });
                });
            });
        });

        describe('when requests fail', function() {
            function failRequestsFor(entityName, reject) {
                requestUtils.qRequest.and.callFake(function(method, opts) {
                    var object = opts.url.match(/orgs|customers|advertisers/)[0];
                    var code = (object === entityName) ? 500 : 201;
                    var body = (code === 201) ? { id: object + '-id-123' } : 'error body';
                    if(reject) {
                        return q.reject('rejected');
                    }
                    return q({
                        response: {
                            statusCode: code
                        },
                        body: body
                    });
                });
            }
            
            describe('when the promise to make the request gets rejected', function() {
                ['orgs', 'customers', 'advertisers'].forEach(function(entity) {
                    describe(entity, function() {
                        beforeEach(function(done) {
                            failRequestsFor(entity, true);
                            userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy).done(done);
                        });
                        
                        it('should log an error with the rejection reason', function() {
                            var args = mockLog.error.calls.mostRecent().args;
                            var errorMessage = args[args.length - 1];
                            expect(mockLog.error).toHaveBeenCalled();
                            expect(errorMessage).toContain('rejected');
                        });
                        
                        it('should release the mutex', function() {
                            expect(CacheMutex.prototype.release).toHaveBeenCalled();
                        });
                        
                        it('should set the user to have a status of Error', function() {
                            expect(req.user.status).toBe('error');
                        });
                        
                        it('should call next', function() {
                            expect(nextSpy).toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                        });
                    });
                });
            });
            
            describe('when an org fails to be created', function() {
                beforeEach(function(done) {
                    failRequestsFor('orgs');
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy).done(done);
                });

                it('should still create other entities', function() {
                    var args = requestUtils.qRequest.calls.allArgs();
                    var endpoints = args.map(function(params) {
                        return params[1].url.match(/orgs|customers|advertisers/)[0];
                    });
                    expect(endpoints).toContain('customers');
                    expect(endpoints).toContain('advertisers');
                    expect(req.user.customer).toBeDefined();
                    expect(req.user.advertiser).toBeDefined();
                });

                it('should not set an org on the user', function() {
                    expect(req.user.org).not.toBeDefined();
                });

                it('should log an error', function() {
                    var args = mockLog.error.calls.mostRecent().args;
                    var errorMessage = args[args.length - 1];
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(errorMessage).toContain('500');
                    expect(errorMessage).toContain('error body');
                });

                it('should set the status of the user on the request to error', function() {
                    expect(req.user.status).toBe('error');
                });

                it('should call next', function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                });
                
                it('should release the mutex', function() {
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                });
            });
            
            describe('when an advertiser fails to be created', function() {
                beforeEach(function(done) {
                    failRequestsFor('advertisers');
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy).done(done);
                });

                it('should still create an org', function() {
                    var args = requestUtils.qRequest.calls.allArgs();
                    var endpoints = args.map(function(params) {
                        return params[1].url.match(/orgs|customers|advertisers/)[0];
                    });
                    expect(endpoints).toContain('orgs');
                    expect(endpoints).not.toContain('customers');
                    expect(req.user.org).toBeDefined();
                    expect(req.user.customer).not.toBeDefined();
                });

                it('should not set an advertiser on the user', function() {
                    expect(req.user.advertiser).not.toBeDefined();
                });

                it('should log an error', function() {
                    var args = mockLog.error.calls.mostRecent().args;
                    var errorMessage = args[args.length - 1];
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(errorMessage).toContain('500');
                    expect(errorMessage).toContain('error body');
                });

                it('should set the status of the user on the request to error', function() {
                    expect(req.user.status).toBe('error');
                });

                it('should call next', function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                });
                
                it('should release the mutex', function() {
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                });
            });
            
            describe('when a customer fails to be created', function() {
                beforeEach(function(done) {
                    failRequestsFor('customers');
                    userModule.createLinkedEntities(api, 3500, mockCache, req, nextSpy).done(done);
                });

                it('should still create other entities', function() {
                    var args = requestUtils.qRequest.calls.allArgs();
                    var endpoints = args.map(function(params) {
                        return params[1].url.match(/orgs|customers|advertisers/)[0];
                    });
                    expect(endpoints).toContain('orgs');
                    expect(endpoints).toContain('advertisers');
                    expect(req.user.org).toBeDefined();
                    expect(req.user.advertiser).toBeDefined();
                });

                it('should not set a customer on the user', function() {
                    expect(req.user.customer).not.toBeDefined();
                });

                it('should log an error', function() {
                    var args = mockLog.error.calls.mostRecent().args;
                    var errorMessage = args[args.length - 1];
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(errorMessage).toContain('500');
                    expect(errorMessage).toContain('error body');
                });

                it('should set the status of the user on the request to error', function() {
                    expect(req.user.status).toBe('error');
                });

                it('should call next', function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                });
                
                it('should release the mutex', function() {
                    expect(CacheMutex.prototype.release).toHaveBeenCalled();
                });
            });
        });
    });

    describe('handleBrokenUser()', function() {
        var svc, req, nextSpy;

        beforeEach(function() {
            svc = {
                _coll: {
                    findAndModify: jasmine.createSpy('findAndModify').and.callFake(function(query1, query2, updates, opts, cb) {
                        cb(null, q());
                    })
                }
            };
            req = {
                user: {
                    id: 'u-12345'
                }
            };
            nextSpy = jasmine.createSpy('nextSpy()').and.returnValue(q());
        });

        describe('when the user is broken', function() {
            var success, failure;
            beforeEach(function(done) {
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');
                req.user.status = 'error';
                userModule.handleBrokenUser(svc, req, nextSpy).then(success, failure).done(done);
            });

            it('should update the user with an error status', function() {
                var updates = {
                    $set: {
                        lastUpdated: jasmine.any(Date),
                        status: 'error'
                    },
                    $unset: { activationToken: 1 }
                };
                expect(svc._coll.findAndModify).toHaveBeenCalledWith({id: 'u-12345'}, {id: 1}, updates, {w: 1, journal: true, new:true}, jasmine.any(Function));
            });

            it('should reject the promise and log a warning', function() {
                expect(success).not.toHaveBeenCalled();
                expect(failure).toHaveBeenCalledWith('The user is in a broken state.');
                expect(mockLog.warn).toHaveBeenCalled();
            });
        });

        describe('when the user is not broken', function() {
            beforeEach(function(done) {
                req.user.status = 'new';
                userModule.handleBrokenUser(svc, req, nextSpy).done(done);
            });

            it('should call next', function() {
                expect(nextSpy).toHaveBeenCalled();
            });
        });
    });

    describe('sendConfirmationEmail', function() {
        var nextSpy;

        beforeEach(function(done) {
            nextSpy = jasmine.createSpy('next()').and.returnValue(q());
            spyOn(email, 'accountWasActivated').and.returnValue(q());
            userModule.sendConfirmationEmail('sender', 'http://dash.board', {user:{email:'some email'}}, nextSpy).done(done);
        });

        it('should notify account activation', function() {
            expect(email.accountWasActivated).toHaveBeenCalledWith('sender', 'some email', 'http://dash.board');
        });

        it('should call next', function() {
            expect(nextSpy).toHaveBeenCalled();
        });
    });

    describe('setupSignupUser', function() {
        var svc, req, next, done;

        beforeEach(function() {
            spyOn(uuid, 'createUuid').and.returnValue('abcdefghijklmnopqrstuvwxyz');
            var newUserRoles = ['newUserRole1', 'newUserRole2'];
            var newUserPols = ['newUserPol1', 'newUserPol2'];
            svc = userModule.setupSvc(mockDb, mockConfig);
            req = {
                body: { }
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
            userModule.setupSignupUser(svc, newUserRoles, newUserPols, req, next, done);
        });

        it('should give the object an id', function() {
            expect(req.body.id).toBe('u-abcdefghijklmn');
        });

        it('should set the created date of the object', function() {
            expect(req.body.created).toEqual(jasmine.any(Date));
            expect(req.body.created).toBe(req.body.lastUpdated);
        });

        it('should set the last updated date of the object', function() {
            expect(req.body.lastUpdated).toEqual(jasmine.any(Date));
            expect(req.body.lastUpdated).toBe(req.body.created);
        });

        it('should set the status of the object to new', function() {
            expect(req.body.status).toBe('new');
        });

        it('should set roles on the new object', function() {
            expect(req.body.roles).toEqual(['newUserRole1', 'newUserRole2']);
        });

        it('should set policies on the new object', function() {
            expect(req.body.policies).toEqual(['newUserPol1', 'newUserPol2']);
        });

        it('should set external on the new object to true', function() {
            expect(req.body.external).toBe(true);
        });

        it('should call next', function() {
            expect(next).toHaveBeenCalled();
        });

        it('should not call done', function() {
            expect(done).not.toHaveBeenCalled();
        });
    });

    describe('filterProps', function() {
        var req, next, done;

        beforeEach(function() {
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
            req = {
                body: {
                    foo: 'bar',
                    goo: 'bla',
                    key: 'value',
                    hey: 'listen'
                }
            };
            userModule.filterProps(['foo', 'goo'], req, next, done);
        });

        it('should filter properties off the body of an object', function() {
            expect(req.body).toEqual({
                key: 'value',
                hey: 'listen'
            });
        });

        it('should call next', function() {
            expect(next).toHaveBeenCalled();
        });

        it('should not call done', function() {
            expect(done).not.toHaveBeenCalled();
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
            userModule.giveActivationToken(60000, req, nextSpy)
            .then(function() {
                expect(crypto.randomBytes).toHaveBeenCalledWith(24, jasmine.any(Function));
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should temporarily store the unhashed token in hex on the request', function(done) {
            userModule.giveActivationToken(60000, req, nextSpy)
            .then(function() {
                expect(req.tempToken).toBe('6162636465666768696a6b6c6d6e6f707172737475767778');
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should hash the hex token', function(done) {
            userModule.giveActivationToken(60000, req, nextSpy)
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
            userModule.giveActivationToken(60000, req, nextSpy)
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
            userModule.giveActivationToken(60000, req, nextSpy)
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
            userModule.giveActivationToken(60000, req, nextSpy)
            .catch(errorSpy)
            .done(function() {
                expect(errorSpy).toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('sendActivationEmail', function() {
        var req, nextSpy, doneSPy;

        beforeEach(function() {
            req = {
                body: {
                    id: 'u-abcdefghijklmn',
                    email: 'email@email.com'
                },
                tempToken: '6162636465666768696a6b6c6d6e6f707172737475767778'
            };
            spyOn(email, 'activateAccount').and.returnValue(q());
            nextSpy = jasmine.createSpy('next()');
            doneSpy = jasmine.createSpy('done()');
        });

        it('should send an activation email', function(done) {
            userModule.sendActivationEmail('sender', 'target', req, nextSpy, doneSpy)
            .then(function() {
                expect(email.activateAccount).toHaveBeenCalledWith('sender', 'email@email.com', 'target?id=u-abcdefghijklmn&token=6162636465666768696a6b6c6d6e6f707172737475767778');
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should handle targets with existing query params', function(done) {
            userModule.sendActivationEmail('sender', 'https://staging.cinema6.com/#/activate?selfie=selfie', req, nextSpy, doneSpy)
            .then(function() {
                expect(email.activateAccount).toHaveBeenCalledWith('sender', 'email@email.com', 'https://staging.cinema6.com/#/activate?selfie=selfie&id=u-abcdefghijklmn&token=6162636465666768696a6b6c6d6e6f707172737475767778');
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should remove the temporary token from the request object', function(done) {
            userModule.sendActivationEmail('sender', 'target', req, nextSpy, doneSpy)
            .then(function() {
                expect(req.tempToken).not.toBeDefined();
                expect(req).toEqual({
                    body: {
                        id: 'u-abcdefghijklmn',
                        email: 'email@email.com'
                    }
                });
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should call next', function(done) {
            userModule.sendActivationEmail('sender', 'target', req, nextSpy, doneSpy)
            .then(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should call done if failed due to a malformed email', function(done) {
            email.activateAccount.and.returnValue(q.reject({name: 'InvalidParameterValue'}));
            userModule.sendActivationEmail('sender', 'target', req, nextSpy, doneSpy)
            .then(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({
                    code: 400,
                    body: 'Invalid email address'
                });
            })
            .catch(function(error) {
                expect(error).not.toBeDefined();
            })
            .done(done);
        });

        it('should reject if something fails', function(done) {
            var errorSpy = jasmine.createSpy('errorSpy()');
            email.activateAccount.and.returnValue(q.reject({}));
            userModule.sendActivationEmail('sender', 'target', req, nextSpy, doneSpy)
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
        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    users: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var users = [{ id: 'u-1234', org: 'o-1234'},
                         { id: 'u-4567', org: 'o-1234'},
                         { id: 'u-1234', org: 'o-4567'},
                         { id: 'u-4567', org: 'o-4567'}];

            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'read');
            })).toEqual(users);
            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'edit');
            })).toEqual([users[0], users[1], users[2]]);
            expect(users.filter(function(target) {
                return userModule.checkScope(requester, target, 'delete');
            })).toEqual([users[0], users[2]]);
        });

        it('should sanity-check the user permissions object', function() {
            var target = { id: 'u-1' };
            expect(userModule.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users = {};
            requester.permissions.orgs = { read: Scope.All };
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = '';
            expect(userModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.users.read = Scope.All;
            expect(userModule.checkScope(requester, target, 'read')).toBe(true);
        });
    });

    describe('userPermQuery', function() {
        var query, requester;
        beforeEach(function() {
            query = { org: 'o-1' };
            requester = { id: 'u-1', org: 'o-1', permissions: { users: { read: Scope.Own } } };
        });

        it('should just check that the user is not deleted if the requester is an admin', function() {
            requester.permissions.users.read = Scope.All;
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted } });
            expect(query).toEqual({org: 'o-1'});
        });

        it('should check that the ids match if the requester has Scope.Own', function() {
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
        });

        it('should check that the ids or orgs match if the requester has Scope.Org', function() {
            requester.permissions.users.read = Scope.Org;
            expect(userModule.userPermQuery(query, requester))
                .toEqual({org: 'o-1', status: {$ne: Status.Deleted}, $or: [{org: 'o-1'}, {id: 'u-1'}]});
        });

        it('should preserve existing $or clauses', function() {
            requester.permissions.users.read = Scope.Org;
            query.$or = [ { a: 1 }, { b: 2 } ];
            expect(userModule.userPermQuery(query, requester)).toEqual({
                org: 'o-1',
                status: { $ne: Status.Deleted },
                $and: [
                    { $or: [ { a: 1 }, { b: 2 } ] },
                    { $or: [ { org: 'o-1' }, { id: 'u-1' } ] }
                ]
            });
        });

        it('should log a warning if the requester has an invalid scope', function() {
            requester.permissions.users.read = 'alfkjdf';
            expect(userModule.userPermQuery(query, requester))
                .toEqual({ org: 'o-1', status: { $ne: Status.Deleted }, $or: [ { id: 'u-1' } ] });
            expect(mockLog.warn).toHaveBeenCalled();
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
            svc = userModule.setupSvc(mockDb, mockConfig);
            roles = [
                { id: 'r-1', name: 'role1' },
                { id: 'r-2', name: 'role2' },
                { id: 'r-3', name: 'role3' }
            ];
            roleColl = {
                find: jasmine.createSpy('roles.find()').and.callFake(function() {
                    return { toArray: function(cb) {
                        cb(null, roles);
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
            roleColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
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
        var polColl, roles, svc;
        beforeEach(function() {
            svc = userModule.setupSvc(mockDb, mockConfig);
            roles = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-2', name: 'pol2' },
                { id: 'p-3', name: 'pol3' }
            ];
            polColl = {
                find: jasmine.createSpy('policies.find()').and.callFake(function() {
                    return { toArray: function(cb) {
                        cb(null, roles);
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
            polColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
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
                user: { id: 'u-4b023952363514' }
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
                req.params.id = req.user.id;

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

    describe('changePassword(svc, req, emailSender)', function() {
        var deferred;
        var users;
        var svc, req, emailSender;
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
                    email: 'evan@cinema6.com'
                }
            };
            emailSender = 'johnnytestmonkey@cinema6.com';

            result = userModule.changePassword(svc, req, emailSender, 'support@c6.com');
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
                    spyOn(email, 'passwordChanged');

                    editObjectDeferred.reject(error);
                    editObjectDeferred.promise.finally(done);
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should not send an email', function() {
                    expect(email.passwordChanged).not.toHaveBeenCalled();
                });
            });

            describe('if the update succeeds', function() {
                var notifyDeffered;

                beforeEach(function(done) {
                    notifyDeffered = q.defer();
                    spyOn(email, 'passwordChanged').and.returnValue(notifyDeffered.promise);

                    editObjectDeferred.resolve();
                    editObjectDeferred.promise.finally(done);
                });

                it('should send an email notifying the user of the password change', function() {
                    expect(email.passwordChanged).toHaveBeenCalledWith(emailSender, req.body.email, 'support@c6.com');
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

                describe('if sending the email succeeds', function() {
                    beforeEach(function(done) {
                        notifyDeffered.resolve();
                        notifyDeffered.promise.then(done);
                    });

                    it('should not log an error', function() {
                        expect(mockLog.error).not.toHaveBeenCalled();
                    });
                });

                describe('if sending the email fails', function() {
                    var error;

                    beforeEach(function(done) {
                        error = new Error('USPS is defunct.');
                        notifyDeffered.reject(error);

                        notifyDeffered.promise.finally(done);
                    });

                    it('should log an error', function() {
                        expect(mockLog.error).toHaveBeenCalled();
                    });
                });
            });
        });
    });

    describe('changeEmail(svc, req, emailSender, supportContact)', function() {
        var deferred;
        var users;
        var svc, req, emailSender;
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
            emailSender = 'johnnytestmonkey@cinema6.com';

            result = userModule.changeEmail(svc, req, emailSender, 'support@c6.com');
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
                    spyOn(email, 'emailChanged');

                    editObjectDeferred.reject(error);

                    editObjectDeferred.promise.finally(done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(error);
                });

                it('should not send an email', function() {
                    expect(email.emailChanged).not.toHaveBeenCalled();
                });
            });

            describe('if the update succeeds', function() {
                var emailDeferred;

                beforeEach(function(done) {
                    emailDeferred = q.defer();
                    spyOn(email, 'emailChanged').and.returnValue(emailDeferred.promise);

                    editObjectDeferred.resolve();
                    editObjectDeferred.promise.finally(done);
                });

                it('should send the user an email at both addresses', function() {
                    expect(email.emailChanged.calls.count()).toBe(2);
                    expect(email.emailChanged).toHaveBeenCalledWith(
                        emailSender,
                        req.body.email,
                        req.body.email,
                        req.body.newEmail,
                        'support@c6.com'
                    );
                    expect(email.emailChanged).toHaveBeenCalledWith(
                        emailSender,
                        req.body.newEmail,
                        req.body.email,
                        req.body.newEmail,
                        'support@c6.com'
                    );
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

                describe('if sending the email succeeds', function() {
                    beforeEach(function(done) {
                        emailDeferred.resolve();
                        q().then(done);
                    });

                    it('should not log an error', function() {
                        expect(mockLog.error).not.toHaveBeenCalled();
                    });
                });

                describe('if sending the email fails', function() {
                    var error;

                    beforeEach(function(done) {
                        error = new Error('You addressed your thing wrong.');
                        emailDeferred.reject(error);

                        emailDeferred.promise.finally(done);
                    });

                    it('should log an error', function() {
                        expect(mockLog.error.calls.count()).toBe(2);
                    });
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

    describe('signupUser', function() {
        var customMethodDeferred;
        var svc, req;
        var result;

        beforeEach(function() {
            customMethodDeferred = q.defer();
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(customMethodDeferred.promise),
                model: {
                    validate: jasmine.createSpy('svc.model.validate()').and.returnValue({
                        isValid: true
                    })
                },
                _coll: 'users',
                transformMongoDoc: jasmine.createSpy('svc.transformMongoDoc()').and.callFake(function(value) {
                    return value;
                }),
                formatOutput: jasmine.createSpy('svc.formatOutput()').and.callFake(function(value) {
                    return value;
                })
            };
            req = {
                body: {
                    foo: 'bar'
                }
            };
            result = userModule.signupUser(svc, req);
        });

        it('should validate the model', function() {
            expect(svc.model.validate).toHaveBeenCalledWith('create', { foo: 'bar' }, {}, {});
        });

        describe('when the model is valid', function() {
            beforeEach(function() {
                svc.model.validate.and.returnValue({
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
                svc.model.validate.and.returnValue({
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

    describe('getSixxySession(req, port)', function() {
        var req, port, mockResponse;
        
        beforeEach(function() {
            spyOn(crypto, 'randomBytes').and.callFake(function(num, cb) {
                cb(null, new Buffer('abcdefghijklmnopqrstuvwxyz'.substring(0, num)));
            });
            mockResponse = {
                response: {
                    statusCode: 204,
                    headers: {
                        'set-cookie': [
                            'c6Auth cookie'
                        ]
                    }
                }
            };
            spyOn(requestUtils, 'qRequest').and.returnValue(mockResponse);
            req = {
                uuid: 'uuid'
            };
            port = 3500;
        });
        
        it('should set a random nonce string for the request', function(done) {
            userModule.getSixxySession(req, port).then(function() {
                expect(crypto.randomBytes).toHaveBeenCalledWith(24, jasmine.any(Function));
                expect(userModule._nonces.uuid).toBe('6162636465666768696a6b6c6d6e6f707172737475767778');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should send a request to get the sixxy user session', function(done) {
            userModule.getSixxySession(req, port).then(function() {
                expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                    url: 'http://localhost:3500/__internal/sixxyUserSession',
                    json: {uuid:'uuid',nonce:'6162636465666768696a6b6c6d6e6f707172737475767778'}
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the statusCode of the response is not a 204', function(done) {
            mockResponse.response.statusCode = 400;
            userModule.getSixxySession(req, port).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed to request sixxy session: code = 400, body = undefined');
            }).done(done);
        });
        
        it('should reject if there is no c6Auth cookie', function(done) {
            mockResponse.response.headers['set-cookie'] = [];
            userModule.getSixxySession(req, port).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('No c6Auth cookie in response');
            }).done(done);
        });
        
        it('should return the c6Auth cookie', function(done) {
            userModule.getSixxySession(req, port).then(function(result) {
                expect(result).toBe('c6Auth cookie');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('insertSixxySession(req, res, config)', function() {
        var req, res, config;
        
        beforeEach(function() {
            req = {
                body: {
                    
                },
                session: {
                    regenerate: jasmine.createSpy('regenerate()').and.callFake(function(cb) {
                        cb(null, null);
                    }),
                    cookie: { }
                }
            };
            res = {
                send: jasmine.createSpy('send()')
            };
            config = {
                systemUserId: 'u-sixxy'
            };
        });
        
        it('should 400 if there is no nonce on the body of the request', function() {
            req.body.uuid = 'uuid';
            userModule.insertSixxySession(req, res, config);
            expect(res.send).toHaveBeenCalledWith(400);
            expect(mockLog.warn).toHaveBeenCalled();
        });
        
        it('should 400 if there is no uuid on the body of the request', function() {
            req.body.nonce = 'nonce';
            userModule.insertSixxySession(req, res, config);
            expect(res.send).toHaveBeenCalledWith(400);
            expect(mockLog.warn).toHaveBeenCalled();
        });
        
        it('should 400 if the provided nonce does not match', function() {
            req.body.nonce = 'nonce';
            req.body.uuid = 'uuid';
            userModule._nonces.uuid = 'random bytes';
            userModule.insertSixxySession(req, res, config);
            expect(res.send).toHaveBeenCalledWith(400);
            expect(mockLog.warn).toHaveBeenCalled();
        });
        
        it('should regenerate the session and login the sixxy user', function(done) {
            req.body.nonce = 'nonce';
            req.body.uuid = 'uuid';
            userModule._nonces.uuid = 'nonce';
            userModule.insertSixxySession(req, res, config);
            process.nextTick(function() {
                expect(req.session.regenerate).toHaveBeenCalled();
                expect(req.session.user).toBe('u-sixxy');
                expect(req.session.cookie.maxAge).toBe(60000);
                expect(req.session.cookie.secure).toBe(false);
                expect(res.send).toHaveBeenCalledWith(204);
                done();
            });
        });
    });

    describe('confirmUser', function() {
        var customMethodDeferred;
        var svc, req, journal, maxAge;
        var result;

        beforeEach(function() {
            customMethodDeferred = q.defer();
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(customMethodDeferred.promise),
                _coll: {
                    findAndModify: jasmine.createSpy('findAndModify()').and.callFake(function(query1, query2, updates, opts, cb) {
                        cb(null, [{id: 'u-12345'}]);
                    })
                },
                transformMongoDoc: jasmine.createSpy('transformMongoDoc(doc)').and.returnValue('transformed user')
            };
            req = {
                user: {
                    id: 'u-12345',
                    org: 'o-12345',
                    customer: 'c-12345',
                    advertiser: 'a-12345'
                },
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
            maxAge = 'max age';
            spyOn(authUtils, 'decorateUser').and.returnValue(q({id: 'u-12345'}));
            result = userModule.confirmUser(svc, req, journal, maxAge);
        });

        it('should return a 400 if a token is not present on the body of the request', function(done) {
            delete req.body.token;
            userModule.confirmUser(svc, req, journal, maxAge).done(function(result) {
                expect(result).toEqual({code:400,body:'Must provide a token'});
                done();
            });
        });

        it('should call and return svc.customMethod()', function() {
            expect(svc.customMethod).toHaveBeenCalledWith(req, 'confirmUser', jasmine.any(Function));
            expect(result).toBe(customMethodDeferred.promise);
        });
        
        it('should log an error if updating the user fails', function(done) {
            svc._coll.findAndModify.and.callFake(function(query1, query2, updates, opts, cb) {
                cb('error', null);
            });
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
                var updates = {
                    $set: {
                        lastUpdated: jasmine.any(Date),
                        status: 'active',
                        org: 'o-12345',
                        customer: 'c-12345',
                        advertiser: 'a-12345'
                    },
                    $unset: {
                        activationToken: 1
                    }
                };
                expect(svc._coll.findAndModify).toHaveBeenCalledWith({id: 'u-12345'}, {id: 1}, updates, {w: 1, journal: true, new: true}, jasmine.any(Function));
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
                expect(req.session.cookie.maxAge).toBe('max age');
            });

            it('should retun with a 200', function() {
                expect(success).toHaveBeenCalledWith({code: 200, body: {id: 'u-12345'}});
                expect(failure).not.toHaveBeenCalled();
            });
        });
    });
    
    describe('resendActivation(svc, req)', function(done) {
        var svc, req;
        var mockUser, result;

        beforeEach(function() {
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            mockUser = {
                id: 'u-12345',
                org: 'o-12345',
                customer: 'c-12345',
                advertiser: 'a-12345',
                email: 'some email'
            };
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.returnValue(q()),
                _coll: {
                    findOne: jasmine.createSpy('findOne(query, cb)').and.callFake(function(query, cb) {
                        return cb(null, mockUser);
                    })
                }
            };
            req = {
                body: { },
                session: {
                    user: 'u-12345'
                }
            };
        });

        it('should get the account of the user currently logged in', function(done) {
            userModule.resendActivation(svc, req).done(function() {
                expect(svc._coll.findOne).toHaveBeenCalledWith({id: 'u-12345'}, jasmine.any(Function));
                done();
            });
        });

        it('should return a 403 if the user does not have an activationToken', function(done) {
            userModule.resendActivation(svc, req).done(function(result) {
                expect(result).toEqual({code: 403, body: 'No activation token to resend'});
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });

        it('should call and return svc.customMethod()', function(done) {
            mockUser.activationToken = { };
            userModule.resendActivation(svc, req).done(function(result) {
                var expectedReq = {
                    body: {
                        id: 'u-12345',
                        email: 'some email'
                    },
                    session: {
                        user: 'u-12345'
                    }
                };
                expect(svc.customMethod).toHaveBeenCalledWith(expectedReq, 'resendActivation', jasmine.any(Function));
                done();
            });
        });

        describe('the callback passed to svc.customMethod()', function() {
            var callback;
            var success, failure;

            beforeEach(function(done) {
                mockUser.activationToken = {
                    token: 'old token'
                };
                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');
                req.body.activationToken = {
                    token: 'new token',
                    expires: 'sometime'
                };
                svc.customMethod.and.callFake(function(req) {
                    req.body.activationToken = {
                        token: 'new token',
                        expires: 'sometime'
                    };
                    return q();
                });
                userModule.resendActivation(svc, req).then(function() {
                    callback = svc.customMethod.calls.mostRecent().args[2];
                    return callback();
                }).then(success, failure).done(done);
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
            
            it('should return with a 204', function() {
                expect(success).toHaveBeenCalledWith({code:204});
                expect(failure).not.toHaveBeenCalled();
            });
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
                params: { id: 'u-fbe05a74517c06' },
                session: {
                    user: 'u-19fa31cb1a8e0f'
                }
            };
            sessions = {
                remove: jasmine.createSpy('sessions.remove()').and.callFake(function(arg1, arg2, cb) {
                    cb(null, 1);
                })
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
                    expect(sessions.remove).toHaveBeenCalledWith(
                        { 'session.user': req.params.id },
                        { w: 1, journal: true },
                        jasmine.any(Function)
                    );
                    done();
                });
            });

            describe('if the remove fails', function() {
                var removeCallback;
                var error;

                beforeEach(function(done) {
                    error = new Error('I suck.');
                    sessions.remove.and.callFake(function(arg1, arg2, cb) {
                        cb(error, null);
                    });
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
                user: {}
            };
            next = jasmine.createSpy('next()');
            done = jasmine.createSpy('done()');
        });

        describe('if the user has no permissions', function() {
            beforeEach(function() {
                req.user.permissions = null;
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the user has no users permissions', function() {
            beforeEach(function() {
                req.user.permissions = { experiences: {}, elections: {}, campaigns: {} };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        describe('if the user has no edit permissions for users', function() {
            beforeEach(function() {
                req.user.permissions = {
                    users: { read: Scope.All, create: Scope.Org }
                };
                userModule.authorizeForceLogout(req, next, done);
            });

            itShouldCallDone();
        });

        [Scope.Own, Scope.Org].forEach(function(scope) {
            describe('if the user\'s users edit permissions are ' + scope, function() {
                beforeEach(function() {
                    req.user.permissions = {
                        users: { edit: scope }
                    };
                    userModule.authorizeForceLogout(req, next, done);
                });

                itShouldCallDone();
            });
        });

        describe('if the user\'s users edit permissions are ' + Scope.All, function() {
            beforeEach(function() {
                req.user.permissions = {
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
});
