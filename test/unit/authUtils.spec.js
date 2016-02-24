var flush = true;
describe('authUtils', function() {
    var mockUser, q, authUtils, uuid, logger, mongoUtils, mockLog, bcrypt, mockColl, signatures,
        enums, Status, Scope, anyFunc, mockDb, res, next;
    
    beforeEach(function() {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(1453929767464));

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        bcrypt      = require('bcrypt');
        authUtils   = require('../../lib/authUtils');
        mongoUtils  = require('../../lib/mongoUtils');
        signatures  = require('../../lib/signatures');
        logger      = require('../../lib/logger');
        uuid        = require('../../lib/uuid');
        enums       = require('../../lib/enums');
        Status      = enums.Status;
        Scope       = enums.Scope;
        
        mockUser = {
            id: 'u-1234',
            status: Status.Active,
            email: 'johnnyTestmonkey',
            password: 'password',
            roles: ['base']
        };
        
        mockColl = {
            find: jasmine.createSpy('coll.find()')
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.returnValue(mockColl)
        };
        
        res = { send: jasmine.createSpy('res.send()') };
        next = jasmine.createSpy('next()');
        
        authUtils._db = mockDb;
        spyOn(mongoUtils, 'safeUser').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        spyOn(mongoUtils, 'findObject').and.callFake(function() { return q(mockUser); });
        anyFunc = jasmine.any(Function);

        mockLog = {
            trace : jasmine.createSpy('log.trace'),
            error : jasmine.createSpy('log.error'),
            warn  : jasmine.createSpy('log.warn'),
            info  : jasmine.createSpy('log.info'),
            fatal : jasmine.createSpy('log.fatal'),
            log   : jasmine.createSpy('log.log')
        };
        spyOn(logger, 'getLog').and.returnValue(mockLog);
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('getUser', function() {
        beforeEach(function() {
            spyOn(authUtils, 'decorateUser').and.callFake(function(user) {
                if (user) return q({ decorated: 'yes' });
                else return user;
            });
        });

        it('should call mongoUtils.findObject to find a user', function(done) {
            authUtils.getUser('u-1234').then(function(user) {
                delete mockUser.password;
                expect(user).toEqual({ decorated: 'yes' });
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, {id: 'u-1234'});
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1234',
                    status: Status.Active, email: 'johnnyTestmonkey', roles: ['base'] });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should resolve with nothing if no results are found', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(undefined);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass on errors from mongo', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe(JSON.stringify({error: 'Error looking up user', detail: 'I GOT A PROBLEM'}));
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, {id: 'u-1234'});
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should pass on errors from decorateUser', function(done) {
            authUtils.decorateUser.and.returnValue(q.reject('no decorating skills'));
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe(JSON.stringify({error: 'Error looking up user', detail: 'no decorating skills'}));
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, {id: 'u-1234'});
                expect(authUtils.decorateUser).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('decorateUser', function() {
        var roleColl, polColl, mockRoles, mockPolicies;
        beforeEach(function() {
            mockUser = {
                id: 'u-1234',
                roles: ['role1', 'role2', 'role3'],
                policies: ['pol4']
            };
            mockRoles = [
                { id: 'r-1', name: 'role1', policies: ['pol1'] },
                { id: 'r-2', name: 'role2', policies: ['pol2', 'pol3'] },
                { id: 'r-3', name: 'role3' }
            ];
            mockPolicies = [
                { id: 'p-1', name: 'pol1' },
                { id: 'p-2', name: 'pol2' },
                { id: 'p-3', name: 'pol3' },
                { id: 'p-4', name: 'pol4' }
            ];
            roleColl = {
                find: jasmine.createSpy('roles.find()').and.callFake(function(query) {
                    return { toArray: function() { return q(mockRoles); } };
                })
            };
            polColl = {
                find: jasmine.createSpy('policies.find()').and.callFake(function(query) {
                    return { toArray: function() { return q(mockPolicies); } };
                })
            };
            mockDb.collection.and.callFake(function(collName) {
                if (collName === 'roles') return roleColl;
                else return polColl;
            });

            spyOn(authUtils, 'mergePermissions').and.returnValue({ perms: 'yes' });
            spyOn(authUtils, 'mergeValidation').and.returnValue({ fieldVal: 'yes' });
            spyOn(authUtils, 'mergeEntitlements').and.returnValue({ entitled: 'yes' });
            spyOn(authUtils, 'mergeApplications').and.returnValue({ applicated: 'yes' });
        });
        
        it('should look up a user\'s roles + policies and merge them together', function(done) {
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).toBe(mockUser);
                expect(user).toEqual({
                    id: 'u-1234',
                    roles: ['role1', 'role2', 'role3'],
                    policies: ['pol4'],
                    permissions: { perms: 'yes' },
                    fieldValidation: { fieldVal: 'yes' },
                    entitlements: { entitled: 'yes' },
                    applications: { applicated: 'yes' }
                });
                expect(mockDb.collection).toHaveBeenCalledWith('roles');
                expect(mockDb.collection).toHaveBeenCalledWith('policies');
                expect(roleColl.find).toHaveBeenCalledWith({ name: { $in: ['role1', 'role2', 'role3'] }, status: Status.Active });
                expect(polColl.find).toHaveBeenCalledWith({ name: { $in: ['pol4', 'pol1', 'pol2', 'pol3'] }, status: Status.Active },
                    { sort: { name: 1} });
                expect(authUtils.mergePermissions).toHaveBeenCalledWith(mockPolicies);
                expect(authUtils.mergeValidation).toHaveBeenCalledWith(mockPolicies);
                expect(authUtils.mergeEntitlements).toHaveBeenCalledWith(mockPolicies);
                expect(authUtils.mergeApplications).toHaveBeenCalledWith(mockPolicies);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a user with roles and no policies', function(done) {
            delete mockUser.policies;
            mockPolicies.pop();
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).toBe(mockUser);
                expect(user).toEqual({
                    id: 'u-1234',
                    roles: ['role1', 'role2', 'role3'],
                    permissions: { perms: 'yes' },
                    fieldValidation: { fieldVal: 'yes' },
                    entitlements: { entitled: 'yes' },
                    applications: { applicated: 'yes' }
                });
                expect(roleColl.find).toHaveBeenCalledWith({ name: { $in: ['role1', 'role2', 'role3'] }, status: Status.Active });
                expect(polColl.find).toHaveBeenCalledWith({ name: { $in: ['pol1', 'pol2', 'pol3'] }, status: Status.Active },
                    { sort: { name: 1} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a user with no roles', function(done) {
            delete mockUser.roles;
            mockPolicies = [{ id: 'p-4', name: 'pol4' }];
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).toBe(mockUser);
                expect(user).toEqual({
                    id: 'u-1234',
                    policies: ['pol4'],
                    permissions: { perms: 'yes' },
                    fieldValidation: { fieldVal: 'yes' },
                    entitlements: { entitled: 'yes' },
                    applications: { applicated: 'yes' }
                });
                expect(roleColl.find).not.toHaveBeenCalled();
                expect(polColl.find).toHaveBeenCalledWith({ name: { $in: ['pol4'] }, status: Status.Active },
                    { sort: { name: 1} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the user has no roles or policies', function(done) {
            delete mockUser.roles;
            delete mockUser.policies;
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).toBe(mockUser);
                expect(user).toEqual({ id: 'u-1234' });
                expect(roleColl.find).not.toHaveBeenCalled();
                expect(polColl.find).not.toHaveBeenCalled();
                expect(authUtils.mergePermissions).not.toHaveBeenCalled();
                expect(authUtils.mergeValidation).not.toHaveBeenCalled();
                expect(authUtils.mergeEntitlements).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle mongo not finding any active roles or policies', function(done) {
            mockRoles = []; mockPolicies = [];
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).toBe(mockUser);
                expect(user).toEqual({
                    id: 'u-1234',
                    roles: ['role1', 'role2', 'role3'],
                    policies: ['pol4']
                });
                expect(roleColl.find).toHaveBeenCalledWith({ name: { $in: ['role1', 'role2', 'role3'] }, status: Status.Active });
                expect(polColl.find).toHaveBeenCalledWith({ name: { $in: ['pol4'] }, status: Status.Active },
                    { sort: { name: 1} });
                expect(authUtils.mergePermissions).not.toHaveBeenCalled();
                expect(authUtils.mergeValidation).not.toHaveBeenCalled();
                expect(authUtils.mergeEntitlements).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if roles.find() fails', function(done) {
            roleColl.find.and.returnValue({ toArray: function() { return q.reject('I GOT A PROBLEM'); } });
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(roleColl.find).toHaveBeenCalled();
                expect(polColl.find).not.toHaveBeenCalled();
                expect(authUtils.mergePermissions).not.toHaveBeenCalled();
                expect(authUtils.mergeValidation).not.toHaveBeenCalled();
                expect(authUtils.mergeEntitlements).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if policies.find() fails', function(done) {
            polColl.find.and.returnValue({ toArray: function() { return q.reject('I GOT A PROBLEM'); } });
            authUtils.decorateUser(mockUser).then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(roleColl.find).toHaveBeenCalled();
                expect(polColl.find).toHaveBeenCalled();
                expect(authUtils.mergePermissions).not.toHaveBeenCalled();
                expect(authUtils.mergeValidation).not.toHaveBeenCalled();
                expect(authUtils.mergeEntitlements).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('mergePermissions', function() {
        var policies;
        beforeEach(function() {
            policies = [
                {
                    permissions: {
                        cards: { read: Scope.Own, create: Scope.Own },
                        campaigns: { read: Scope.All, create: Scope.Own }
                    }
                },
                {
                    permissions: {
                        campaigns: { read: Scope.Own, create: Scope.All, edit: Scope.Org },
                        users: { read: Scope.Own },
                        orgs: { read: Scope.Own }
                    }
                },
                {
                    permissions: {
                        campaigns: { read: Scope.Own, create: Scope.Org, delete: Scope.All },
                        users: { read: Scope.All },
                        orgs: {}
                    }
                }
            ];
        });
        
        it('should combine policices\' permissions in the most permissive way', function() {
            expect(authUtils.mergePermissions(policies)).toEqual({
                cards: { read: Scope.Own, create: Scope.Own },
                campaigns: { read: Scope.All, create: Scope.All, edit: Scope.Org, delete: Scope.All },
                users: { read: Scope.All },
                orgs: { read: Scope.Own }
            });
        });
        
        it('should handle policies without permissions', function() {
            policies[0] = { fieldValidation: 'yes' };
            expect(authUtils.mergePermissions(policies)).toEqual({
                campaigns: { read: Scope.Own, create: Scope.All, edit: Scope.Org, delete: Scope.All },
                users: { read: Scope.All },
                orgs: { read: Scope.Own }
            });
        });
        
        it('should use the deny scope to remove permissions, overriding any other scopes', function() {
            policies[1].permissions.campaigns.create = Scope.Deny;
            expect(authUtils.mergePermissions(policies)).toEqual({
                cards: { read: Scope.Own, create: Scope.Own },
                campaigns: { read: Scope.All, edit: Scope.Org, delete: Scope.All },
                users: { read: Scope.All },
                orgs: { read: Scope.Own }
            });
        });
    });
    
    describe('mergeValidation', function() {
        var policies, pol1, pol2, pol3;
        beforeEach(function() {
            pol2 = {
                priority: 2,
                fieldValidation: {
                    cards: {
                        user: {
                            __allowed: true
                        }
                    },
                    campaigns: {
                        minViewTime: {
                            __allowed: true,
                            __min: 1,
                            __max: 10
                        }
                    }
                }
            };
            pol3 = {
                priority: 3,
                fieldValidation: {
                    cards: {
                        org: {
                            __allowed: true
                        }
                    }
                }
            };
            pol1 = {
                priority: 1,
                fieldValidation: {
                    users: {
                        policies: {
                            __allowed: true,
                            __acceptableValues: ['pol1', 'pol2']
                        }
                    }
                }
            };
            policies = [pol2, pol3, pol1];
        });
        
        it('should combine validation blocks from different policies', function() {
            expect(authUtils.mergeValidation(policies)).toEqual({
                cards: {
                    user: {
                        __allowed: true
                    },
                    org: {
                        __allowed: true
                    }
                },
                campaigns: {
                    minViewTime: {
                        __allowed: true,
                        __min: 1,
                        __max: 10
                    }
                },
                users: {
                    policies: {
                        __allowed: true,
                        __acceptableValues: ['pol1', 'pol2']
                    }
                }
            });
        });
        
        it('should prefer higher priority policies when there are conflicts', function() {
            pol3.fieldValidation.campaigns = {
                minViewTime: {
                    __allowed: true,
                    __min: 4
                }
            };
            pol2.fieldValidation.users = {
                policies: {
                    __allowed: true,
                    __acceptableValues: ['pol3']
                }
            };

            expect(authUtils.mergeValidation(policies)).toEqual({
                cards: {
                    user: {
                        __allowed: true
                    },
                    org: {
                        __allowed: true
                    }
                },
                campaigns: {
                    minViewTime: { // this whole block taken from pol3; does not preserve __max from pol2
                        __allowed: true,
                        __min: 4
                    }
                },
                users: {
                    policies: {
                        __allowed: true,
                        __acceptableValues: ['pol3']
                    }
                }
            });
        });
        
        it('should ignore policies with no fieldValidation', function() {
            delete pol2.fieldValidation;
            expect(authUtils.mergeValidation(policies)).toEqual({
                cards: {
                    org: {
                        __allowed: true
                    }
                },
                users: {
                    policies: {
                        __allowed: true,
                        __acceptableValues: ['pol1', 'pol2']
                    }
                }
            });
        });
        
        describe('when handling nested objects', function() {
            beforeEach(function() {
                pol2.fieldValidation = {
                    campaigns: {
                        pricing: {
                            budget: {
                                __allowed: false
                            },
                            dailyLimit: {
                                __allowed: false
                            }
                        }
                    }
                };
                pol3.fieldValidation = {
                    campaigns: {
                        pricing: {
                            dailyLimit: {
                                __allowed: true
                            }
                        }
                    }
                };
                pol1.fieldValidation = {
                    campaigns: {
                        pricing: {
                            budget: {
                                __allowed: true
                            },
                            cpv: {
                                __allowed: true
                            }
                        }
                    }
                };
            });
            
            it('should recursively merge all non-DSL fields', function() {
                expect(authUtils.mergeValidation(policies)).toEqual({
                    campaigns: {
                        pricing: {
                            budget: {
                                __allowed: false
                            },
                            dailyLimit: {
                                __allowed: true
                            },
                            cpv: {
                                __allowed: true
                            }
                        }
                    }
                });
            });
        });
        
        describe('when handling array fields', function() {
            beforeEach(function() {
                pol2.fieldValidation = {
                    campaigns: {
                        cards: {
                            __allowed: true,
                            __length: 1,
                            __entries: {
                                id: {
                                    __allowed: true,
                                },
                                name: {
                                    __allowed: true,
                                }
                            }
                        }
                    }
                };
                pol3.fieldValidation = {
                    campaigns: {
                        cards: {
                            __allowed: true,
                            __length: 10,
                            __entries: {
                                name: {
                                    __allowed: true,
                                },
                                reportingId: {
                                    __allowed: true,
                                }
                            }
                        }
                    }
                };
                policies = [pol2, pol3];
            });
            
            it('should recursively merge properties in __entries', function() {
                expect(authUtils.mergeValidation(policies)).toEqual({
                    campaigns: {
                        cards: {
                            __allowed: true,
                            __length: 10,
                            __entries: {
                                id: {
                                    __allowed: true
                                },
                                name: {
                                    __allowed: true
                                },
                                reportingId: {
                                    __allowed: true
                                }
                            }
                        }
                    }
                });
            });
        });
    });
    
    describe('mergeEntitlements', function() {
        var policies;
        beforeEach(function() {
            policies = [
                {
                    priority: 2,
                    entitlements: {
                        e1: true,
                        e2: false
                    }
                },
                {
                    priority: 3,
                    entitlements: {
                        e1: false,
                        e3: true
                    }
                },
                {
                    priority: 1,
                    entitlements: {
                        e1: true,
                        e3: false,
                        e4: true
                    }
                }
            ];
        });
        
        it('should combine entitlements, preferring higher priority policies', function() {
            expect(authUtils.mergeEntitlements(policies)).toEqual({
                e1: false,
                e2: false,
                e3: true,
                e4: true
            });
        });
        
        it('should handle policies without entitlements', function() {
            delete policies[1].entitlements;
            expect(authUtils.mergeEntitlements(policies)).toEqual({
                e1: true,
                e2: false,
                e3: false,
                e4: true
            });
        });
    });
    
    describe('mergeApplications', function() {
        var policies;
        beforeEach(function() {
            policies = [
                { applications: ['e-app1', 'e-app2'] },
                { applications: ['e-app1', 'e-app3'] },
                { applications: ['e-app4'] },
            ];
        });

        it('should combine applications', function() {
            expect(authUtils.mergeApplications(policies)).toEqual(['e-app1', 'e-app2', 'e-app3', 'e-app4']);
        });

        it('should handle policies without applications', function() {
            delete policies[1].applications;
            expect(authUtils.mergeApplications(policies)).toEqual(['e-app1', 'e-app2', 'e-app4']);
        });
    });
    
    describe('createRequester', function() {
        var req;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: {
                    id: 'u-1',
                    email: 'foo@bar.com',
                    permissions: { perms: 'user' },
                    fieldValidation: { fieldVal: 'user' },
                    entitlements: { entitles: 'user' },
                    applications: ['selfie']
                },
                application: {
                    id: 'app-1',
                    key: 'watchman',
                    permissions: { perms: 'app' },
                    fieldValidation: { fieldVal: 'app' },
                    entitlements: { entitles: 'app' },
                    applications: ['studio']
                }
            };
            spyOn(authUtils, 'mergePermissions').and.returnValue({ perms: 'merged' });
            spyOn(authUtils, 'mergeValidation').and.returnValue({ fieldVal: 'merged' });
            spyOn(authUtils, 'mergeEntitlements').and.returnValue({ entitles: 'merged' });
            spyOn(authUtils, 'mergeApplications').and.returnValue(['selfie', 'studio']);
        });
        
        it('should return an object with merged priviledges', function() {
            expect(authUtils.createRequester(req)).toEqual({
                id: 'u-1',
                permissions: { perms: 'merged' },
                fieldValidation: { fieldVal: 'merged' },
                entitlements: { entitles: 'merged' },
                applications: ['selfie', 'studio']
            });
            expect(authUtils.mergePermissions).toHaveBeenCalledWith([
                { priority: 2, permissions: { perms: 'app' } },
                { priority: 1, permissions: { perms: 'user' } },
            ]);
            expect(authUtils.mergeValidation).toHaveBeenCalledWith([
                { priority: 2, fieldValidation: { fieldVal: 'app' } },
                { priority: 1, fieldValidation: { fieldVal: 'user' } }
            ]);
            expect(authUtils.mergeEntitlements).toHaveBeenCalledWith([
                { priority: 2, entitlements: { entitles: 'app' } },
                { priority: 1, entitlements: { entitles: 'user' } }
            ]);
            expect(authUtils.mergeApplications).toHaveBeenCalledWith([
                { priority: 2, applications: ['studio'] },
                { priority: 1, applications: ['selfie'] }
            ]);
        });
        
        it('should handle the user being missing', function() {
            delete req.user;
            expect(authUtils.createRequester(req)).toEqual({
                id: 'app-1',
                permissions: { perms: 'merged' },
                fieldValidation: { fieldVal: 'merged' },
                entitlements: { entitles: 'merged' },
                applications: ['selfie', 'studio']
            });
            expect(authUtils.mergePermissions.calls.argsFor(0)[0][1].permissions).toBe(undefined);
            expect(authUtils.mergeValidation.calls.argsFor(0)[0][1].fieldValidation).toBe(undefined);
            expect(authUtils.mergeEntitlements.calls.argsFor(0)[0][1].entitlements).toBe(undefined);
            expect(authUtils.mergeApplications.calls.argsFor(0)[0][1].applications).toBe(undefined);
        });

        it('should handle the app being missing', function() {
            delete req.application;
            expect(authUtils.createRequester(req)).toEqual({
                id: 'u-1',
                permissions: { perms: 'merged' },
                fieldValidation: { fieldVal: 'merged' },
                entitlements: { entitles: 'merged' },
                applications: ['selfie', 'studio']
            });
            expect(authUtils.mergePermissions.calls.argsFor(0)[0][0].permissions).toBe(undefined);
            expect(authUtils.mergeValidation.calls.argsFor(0)[0][0].fieldValidation).toBe(undefined);
            expect(authUtils.mergeEntitlements.calls.argsFor(0)[0][0].entitlements).toBe(undefined);
            expect(authUtils.mergeApplications.calls.argsFor(0)[0][0].applications).toBe(undefined);
        });
    });
    
    describe('compare', function() {
        var userPerms;
        beforeEach(function() {
            userPerms = {
                experiences: {
                    read: 'org',
                    edit: 'own'
                },
                orgs: {
                    read: 'own'
                }
            };
        });
        
        it('should check that each object-verb pair exists in the user\'s permissions', function() {
            var perms = { experiences: 'read' };
            expect(authUtils._compare(perms, userPerms)).toBe(true);
            
            perms = {experiences: 'edit', orgs: 'read' };
            expect(authUtils._compare(perms, userPerms)).toBe(true);
            
            perms = { orgs: 'edit' };
            expect(authUtils._compare(perms, userPerms)).toBe(false);
            
            perms = {users: 'read' };
            expect(authUtils._compare(perms, userPerms)).toBe(false);
        });
        
        it('should work if the required permissions are blank', function() {
            var perms = {};
            expect(authUtils._compare(perms, userPerms)).toBe(true);
            expect(authUtils._compare(perms, undefined)).toBe(true);
            expect(authUtils._compare(undefined, undefined)).toBe(true);
        });
        
        it('should throw an error if the user has no permissions', function() {
            expect(function() {
                expect(authUtils._compare({ users: 'read' }, undefined)).toBe(false);
            }).not.toThrow();
        });
    });
    
    describe('authUser', function() {
        var req;
        beforeEach(function() {
            req = {
                uuid: '1234',
                session: { user: 'u-1234' }
            };
            spyOn(authUtils, 'getUser').and.callFake(function(id) {
                return q(mongoUtils.unescapeKeys(mongoUtils.safeUser(mockUser)));
            });
        });
        
        it('should return success if the user is found and is the right status', function(done) {
            authUtils.authUser(req).then(function(result) {
                expect(result).toEqual({
                    success: true,
                    user: {
                        id: 'u-1234',
                        status: Status.Active,
                        email: 'johnnyTestmonkey',
                        roles: ['base']
                    }
                });
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return an unsuccessful response if the session has no user', function(done) {
            q.all([{ uuid: '1234' }, { uuid: '1234', session: {} }].map(function(altReq) {
                return authUtils.authUser(altReq).then(function(result) {
                    expect(result).toEqual({ success: false });
                });
            })).then(function() {
                expect(authUtils.getUser).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 403 if the user is not active (by default)', function(done) {
            mockUser.status = Status.New;
            authUtils.authUser(req).then(function(result) {
                expect(result).toEqual({
                    success: false,
                    code: 403,
                    message: 'Forbidden'
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to use a custom list of acceptable statuses', function(done) {
            mockUser.status = Status.New;
            authUtils.authUser(req, [Status.Active, Status.New]).then(function(result) {
                expect(result).toEqual({
                    success: true,
                    user: jasmine.objectContaining({
                        id: 'u-1234',
                        status: Status.New
                    })
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not found', function(done) {
            authUtils.getUser.and.returnValue(q());
            authUtils.authUser(req).then(function(result) {
                expect(result).toEqual({
                    success: false,
                    code: 401,
                    message: 'Unauthorized'
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if getting the user fails', function(done) {
            authUtils.getUser.and.returnValue(q.reject('I GOT A PROBLEM'));
            authUtils.authUser(req).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(authUtils.getUser).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('getApp', function() {
        var req;
        beforeEach(function() {
            req = { uuid: '1234' };
            mongoUtils.findObject.and.returnValue(q({
                id: 'app-1',
                key: 'ads-service',
                secret: 'supersecret'
            }));
        });
        
        it('should fetch and return the application', function(done) {
            authUtils.getApp('ads-service', req).then(function(resp) {
                expect(resp).toEqual({
                    id: 'app-1',
                    key: 'ads-service',
                    secret: 'supersecret'
                });
                expect(mockDb.collection).toHaveBeenCalledWith('applications');
                expect(mongoUtils.findObject).toHaveBeenCalledWith(
                    mockColl,
                    { key: 'ads-service', status: 'active' }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the application is not found', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            authUtils.getApp('ads-service', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(mockDb.collection).toHaveBeenCalledWith('applications');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log and return errors', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('honey, you got a big storm coming'));
            authUtils.getApp('ads-service', req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Db error');
                expect(mockDb.collection).toHaveBeenCalledWith('applications');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('authApp', function() {
        var req;
        beforeEach(function() {
            spyOn(signatures, 'verifyRequest').and.returnValue(true);
            spyOn(authUtils, 'getApp').and.returnValue(q({
                _id: 'mongoid',
                id: 'app-1',
                key: 'ads-service',
                secret: 'supersecret',
                status: 'active',
                entitlements: { foo: true }
            }));
            req = {
                uuid: '1234',
                headers: {
                    'x-rc-auth-app-key'     : 'ads-service',
                    'x-rc-auth-timestamp'   : 1453929767464,
                    'x-rc-auth-nonce'       : 'morelikenoncenseamirite',
                    'x-rc-auth-signature'   : 'johnhancock'
                }
            };
        });
        
        it('should fetch the app, verify the signature, and return success', function(done) {
            authUtils.authApp(req, 3000).then(function(resp) {
                expect(resp).toEqual({
                    success: true,
                    application: {
                        id: 'app-1',
                        key: 'ads-service',
                        status: 'active',
                        entitlements: { foo: true }
                    }
                });
                expect(req._appSecret).toEqual('supersecret');
                expect(authUtils.getApp).toHaveBeenCalledWith('ads-service', req);
                expect(signatures.verifyRequest).toHaveBeenCalledWith(req, {
                    _id: 'mongoid',
                    id: 'app-1',
                    key: 'ads-service',
                    secret: 'supersecret',
                    status: 'active',
                    entitlements: { foo: true }
                });
            }).done(done);
        });
        
        it('should return an unsuccessful response if headers are missing', function(done) {
            q.all(['x-rc-auth-app-key', 'x-rc-auth-timestamp', 'x-rc-auth-nonce', 'x-rc-auth-signature'].map(function(field) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                delete reqCopy.headers[field];
                return authUtils.authApp(reqCopy, 3000).then(function(resp) {
                    expect(resp).toEqual({ success: false });
                });
            })).then(function() {
                expect(authUtils.getApp).not.toHaveBeenCalled();
                expect(signatures.verifyRequest).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the timestamp header is too old', function(done) {
            jasmine.clock().tick(5001);
            authUtils.authApp(req, 3000).then(function(resp) {
                expect(resp).toEqual({
                    success: false,
                    code: 400,
                    message: 'Request timestamp header is too old'
                });
                expect(authUtils.getApp).not.toHaveBeenCalled();
                expect(signatures.verifyRequest).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should return a 403 if the application is not found', function(done) {
            authUtils.getApp.and.returnValue(q());
            authUtils.authApp(req, 3000).then(function(resp) {
                expect(resp).toEqual({
                    success: false,
                    code: 401,
                    message: 'Unauthorized'
                });
                expect(authUtils.getApp).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should return a 401 if the signature does not match', function(done) {
            signatures.verifyRequest.and.returnValue(false);
            authUtils.authApp(req, 3000).then(function(resp) {
                expect(resp).toEqual({
                    success: false,
                    code: 401,
                    message: 'Unauthorized'
                });
                expect(authUtils.getApp).toHaveBeenCalled();
                expect(signatures.verifyRequest).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should return a 500 if _fetchApplication fails', function(done) {
            authUtils.getApp.and.returnValue(q.reject('honey, you got a big storm coming'));
            authUtils.authApp(req, 3000).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('honey, you got a big storm coming');
                expect(authUtils.getApp).toHaveBeenCalled();
                expect(signatures.verifyRequest).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('middlewarify', function() {
        it('should return a function', function() {
            expect(authUtils.middlewarify()).toEqual(jasmine.any(Function));
        });
        
        describe('returns a function that', function() {
            var req, midware, userAuthResp, appAuthResp;
            beforeEach(function() {
                req = {
                    uuid: '1234',
                    session: {
                        user: 'u-1',
                        save: jasmine.createSpy('save()').and.callFake(function(cb) {
                            cb(null);
                        })
                    }
                };
                userAuthResp = {
                    success: true,
                    user: {
                        id: 'u-123',
                        email: 'foo@bar.com',
                        permissions: { thangs: { read: Scope.Own, delete: Scope.Own } }
                    }
                };
                appAuthResp = {
                    success: true,
                    application: {
                        id: 'app-1',
                        key: 'watchman',
                        permissions: { thangs: { read: Scope.All, edit: Scope.All } }
                    }
                };
                
                spyOn(authUtils, 'authUser').and.callFake(function() { return q(userAuthResp); });
                spyOn(authUtils, 'authApp').and.callFake(function() { return q(appAuthResp); });
                
                spyOn(authUtils, '_compare').and.callThrough();
                
                midware = authUtils.middlewarify();
            });
            
            it('should call next if a user is authenticated', function(done) {
                midware(req, res, next).finally(function() {
                    expect(next).toHaveBeenCalled();
                    expect(res.send).not.toHaveBeenCalled();
                    expect(req.user).toEqual({
                        id: 'u-123',
                        email: 'foo@bar.com',
                        permissions: { thangs: { read: Scope.Own, delete: Scope.Own } }
                    });
                    expect(req.requester).toEqual(jasmine.objectContaining({
                        id: 'u-123',
                        permissions: { thangs: { read: Scope.Own, delete: Scope.Own } }
                    }));
                    expect(req.application).not.toBeDefined();
                    expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                    expect(authUtils.authApp).not.toHaveBeenCalled();
                    expect(authUtils._compare).toHaveBeenCalledWith(undefined, { thangs: { read: Scope.Own, delete: Scope.Own } });
                    expect(req.session.save).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should call res.send() if user authentication fails with a status code', function(done) {
                userAuthResp = {
                    success: false,
                    code: 403,
                    message: 'Forbidden'
                };
                midware(req, res, next).finally(function() {
                    expect(next).not.toHaveBeenCalled();
                    expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                    expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                    expect(authUtils.authApp).not.toHaveBeenCalled();
                    expect(req.session.save).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should call res.send() with a 401 if user authentication fails without a status code', function(done) {
                userAuthResp = { success: false };
                midware(req, res, next).finally(function() {
                    expect(next).not.toHaveBeenCalled();
                    expect(res.send).toHaveBeenCalledWith(401, 'Unauthorized');
                    expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                    expect(authUtils.authApp).not.toHaveBeenCalled();
                    expect(req.session.save).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should pass opts.userStatuses to authUser()', function(done) {
                midware = authUtils.middlewarify({ userStatuses: [Status.New, Status.Pending] });
                midware(req, res, next).finally(function() {
                    expect(next).toHaveBeenCalled();
                    expect(res.send).not.toHaveBeenCalled();
                    expect(req.user).toBeDefined();
                    expect(req.requester).toBeDefined();
                    expect(req.application).not.toBeDefined();
                    expect(authUtils.authUser).toHaveBeenCalledWith(req, [Status.New, Status.Pending]);
                    expect(authUtils.authApp).not.toHaveBeenCalled();
                    expect(req.session.save).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should not resave the session if req.session.user is not defined', function(done) {
                delete req.session.user;
                midware(req, res, next).finally(function() {
                    expect(next).toHaveBeenCalled();
                    expect(res.send).not.toHaveBeenCalled();
                    expect(req.user).toBeDefined();
                    expect(req.requester).toBeDefined();
                    expect(req.application).not.toBeDefined();
                    expect(req.session.save).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
            
            describe('when opts.permissions is defined', function(done) {
                beforeEach(function() {
                    midware = authUtils.middlewarify({
                        permissions: { thangs: 'read' }
                    });
                });
                
                it('should still succeed if the user has the right permissions', function(done) {
                    midware(req, res, next).finally(function() {
                        expect(next).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.user).toBeDefined();
                        expect(req.requester).toBeDefined();
                        expect(req.application).not.toBeDefined();
                        expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                        expect(authUtils.authApp).not.toHaveBeenCalled();
                        expect(authUtils._compare).toHaveBeenCalledWith({ thangs: 'read' }, { thangs: { read: Scope.Own, delete: Scope.Own } });
                        expect(req.session.save).toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should fail if the user does not have the right permissions', function(done) {
                    userAuthResp.user.permissions = { thangs: { edit: Scope.All } };
                    midware(req, res, next).finally(function() {
                        expect(next).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                        expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                        expect(authUtils.authApp).not.toHaveBeenCalled();
                        expect(req.session.save).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
            
            it('should send a 500 if authUtils.authUser fails', function(done) {
                authUtils.authUser.and.returnValue(q.reject('THE SYSTEM IS DOWN'));
                midware(req, res, next).finally(function() {
                    expect(next).not.toHaveBeenCalled();
                    expect(res.send).toHaveBeenCalledWith(500, 'Error authorizing request');
                    expect(req.session.save).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                }).done(done);
            });

            it('should send a 500 if req.session.save fails', function(done) {
                req.session.save.and.returnValue(q.reject('cant save that session yo'));
                midware(req, res, next).finally(function() {
                    expect(next).not.toHaveBeenCalled();
                    expect(res.send).toHaveBeenCalledWith(500, 'Error authorizing request');
                    expect(req.session.save).toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                }).done(done);
            });
            
            describe('when opts.allowApps is true', function(done) {
                beforeEach(function() {
                    midware = authUtils.middlewarify({ allowApps: true, tsGracePeriod: 2000 });
                });
                
                it('should also authenticate the app', function(done) {
                    midware(req, res, next).finally(function() {
                        expect(next).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.user).toEqual({
                            id: 'u-123',
                            email: 'foo@bar.com',
                            permissions: { thangs: { read: Scope.Own, delete: Scope.Own } }
                        });
                        expect(req.requester).toEqual(jasmine.objectContaining({
                            id: 'u-123',
                            permissions: { thangs: { read: Scope.All, edit: Scope.All, delete: Scope.Own } }
                        }));
                        expect(req.application).toEqual({
                            id: 'app-1',
                            key: 'watchman',
                            permissions: { thangs: { read: Scope.All, edit: Scope.All } }
                        });
                        expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                        expect(authUtils.authApp).toHaveBeenCalledWith(req, 2000);
                        expect(authUtils._compare).toHaveBeenCalledWith(undefined, { thangs: { read: Scope.All, edit: Scope.All, delete: Scope.Own } });
                        expect(req.session.save).toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should call res.send() if app authentication fails with a status code', function(done) {
                    appAuthResp = {
                        success: false,
                        code: 403,
                        message: 'Forbidden'
                    };
                    midware(req, res, next).finally(function() {
                        expect(next).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                        expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                        expect(authUtils.authApp).toHaveBeenCalledWith(req, 2000);
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should still succeed if no user is authenticated', function(done) {
                    userAuthResp = { success: false };
                    midware(req, res, next).finally(function() {
                        expect(next).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.user).not.toBeDefined();
                        expect(req.requester).toEqual(jasmine.objectContaining({
                            id: 'app-1',
                            permissions: { thangs: { read: Scope.All, edit: Scope.All } }
                        }));
                        expect(req.application).toEqual({
                            id: 'app-1',
                            key: 'watchman',
                            permissions: { thangs: { read: Scope.All, edit: Scope.All } }
                        });
                        expect(authUtils.authUser).toHaveBeenCalledWith(req, undefined);
                        expect(authUtils.authApp).toHaveBeenCalledWith(req, 2000);
                        expect(authUtils._compare).toHaveBeenCalledWith(undefined, { thangs: { read: Scope.All, edit: Scope.All } });
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should be able to use the app\'s permissions to pass a permissions check', function(done) {
                    midware = authUtils.middlewarify({
                        allowApps: true,
                        permissions: { thangs: 'edit' }
                    });
                    midware(req, res, next).finally(function() {
                        expect(next).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.user).toBeDefined();
                        expect(req.requester).toBeDefined();
                        expect(req.application).toBeDefined();
                        expect(authUtils._compare).toHaveBeenCalledWith({ thangs: 'edit' }, { thangs: { read: Scope.All, edit: Scope.All, delete: Scope.Own } });
                        expect(req.session.save).toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should send a 500 if authUtils.authApp rejects', function(done) {
                    authUtils.authApp.and.returnValue(q.reject('I GOT A PROBLEM'));
                    midware(req, res, next).finally(function() {
                        expect(next).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(500, 'Error authorizing request');
                        expect(req.session.save).not.toHaveBeenCalled();
                        expect(mockLog.error).toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
    
    describe('crudMidware', function() {
        var objName, spies;
        beforeEach(function() {
            objName = 'thangs';
            spies = {
                read: jasmine.createSpy('authRead'),
                create: jasmine.createSpy('authCreate'),
                edit: jasmine.createSpy('authEdit'),
                delete: jasmine.createSpy('authDelete')
            };
            spyOn(authUtils, 'middlewarify').and.callFake(function(opts) {
                return spies[opts.permissions.thangs];
            });
        });

        it('should return an object with middleware for each verb', function() {
            expect(authUtils.crudMidware(objName)).toEqual({
                read: spies.read,
                create: spies.create,
                edit: spies.edit,
                delete: spies.delete,
            });
            expect(authUtils.middlewarify.calls.argsFor(0)).toEqual([{ permissions: { thangs: 'read' } }]);
            expect(authUtils.middlewarify.calls.argsFor(1)).toEqual([{ permissions: { thangs: 'create' } }]);
            expect(authUtils.middlewarify.calls.argsFor(2)).toEqual([{ permissions: { thangs: 'edit' } }]);
            expect(authUtils.middlewarify.calls.argsFor(3)).toEqual([{ permissions: { thangs: 'delete' } }]);
        });
        
        it('should not overwrite existing opts', function() {
            var opts = { allowApps: true, permissions: { stuffs: 'create' } };
            expect(authUtils.crudMidware(objName, opts)).toEqual({
                read: spies.read,
                create: spies.create,
                edit: spies.edit,
                delete: spies.delete,
            });
            expect(authUtils.middlewarify.calls.argsFor(0)).toEqual([{ allowApps: true, permissions: { stuffs: 'create', thangs: 'read' } }]);
            expect(authUtils.middlewarify.calls.argsFor(1)).toEqual([{ allowApps: true, permissions: { stuffs: 'create', thangs: 'create' } }]);
            expect(authUtils.middlewarify.calls.argsFor(2)).toEqual([{ allowApps: true, permissions: { stuffs: 'create', thangs: 'edit' } }]);
            expect(authUtils.middlewarify.calls.argsFor(3)).toEqual([{ allowApps: true, permissions: { stuffs: 'create', thangs: 'delete' } }]);
        });
    });
    
    describe('userPassChecker', function() {
        it('should return a function', function() {
            var midWare = authUtils.userPassChecker('fakeDb');
            expect(authUtils._db).toBe('fakeDb');
            expect(typeof midWare).toBe('function');
        });
        
        describe('returns a function that', function() {
            var req, midWare;
            beforeEach(function() {
                req = {
                    uuid: '1234',
                    method: 'get',
                    baseUrl: '/ut',
                    route: { path: '/:id' },
                    body: { email: 'otter', password: 'thisisapassword' }
                };
                midWare = authUtils.userPassChecker();
                spyOn(bcrypt, 'compare').and.callFake(function(password, hashed, cb) {
                    cb(null, true);
                });
                spyOn(authUtils, 'decorateUser').and.callFake(function(user) {
                    if (user) return q({ decorated: 'yes' });
                    else return user;
                });
                spyOn(authUtils, 'createRequester').and.returnValue({ requester: 'yes' });
            });

            it('should fail with a 500 if authUtils has no db', function(done) {
                delete authUtils._db;
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mongoUtils.findObject).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 400 if no email or password is provided', function(done) {
                req.body = { email: 'otter' };
                midWare(req, res, next);
                req.body = { password: 'thisisapassword' };
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send.calls.count()).toBe(2);
                    expect(res.send.calls.all()[0].args).toEqual([400, 'Must provide email and password']);
                    expect(res.send.calls.all()[1].args).toEqual([400, 'Must provide email and password']);
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 400 if the email or password are not strings', function(done) {
                req.body = { email: { $gt: '' }, password: 'password' };
                midWare(req, res, next);
                req.body = { email: 'otter', password: { $exists: true } };
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send.calls.count()).toBe(2);
                    expect(res.send.calls.all()[0].args).toEqual([400, 'Must provide email and password']);
                    expect(res.send.calls.all()[1].args).toEqual([400, 'Must provide email and password']);
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should call next if the credentials are valid', function(done) {
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).not.toHaveBeenCalled();
                    expect(next).toHaveBeenCalledWith();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('users');
                    expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, {email: 'otter'});
                    expect(bcrypt.compare).toHaveBeenCalledWith('thisisapassword', 'password', anyFunc);
                    expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                    expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1234',
                        status: Status.Active, email: 'johnnyTestmonkey', roles: ['base'] });
                    expect(req.user).toEqual({ decorated: 'yes' });
                    expect(req.requester).toEqual({ requester: 'yes' });
                    done();
                });
            });
            
            it('should convert the email to lowercase', function(done) {
                req.body.email = 'OTTER';
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).not.toHaveBeenCalled();
                    expect(next).toHaveBeenCalledWith();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, {email: 'otter'});
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                    expect(authUtils.decorateUser).toHaveBeenCalled();
                    expect(req.user).toEqual({ decorated: 'yes' });
                    expect(req.requester).toEqual({ requester: 'yes' });
                    done();
                });
            });
            
            it('should fail with a 401 if the user does not exist', function(done) {
                mongoUtils.findObject.and.returnValue(q());
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(401, 'Invalid email or password');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 403 if the user is not active', function(done) {
                mockUser.status = Status.Inactive;
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(403, 'Account not active');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 401 if the password is incorrect', function(done) {
                bcrypt.compare.and.callFake(function(password, hashed, cb) {
                    cb(null, false);
                });
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(401, 'Invalid email or password');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should reject with an error if bcrypt.compare fails', function(done) {
                bcrypt.compare.and.callFake(function(password, hashed, cb) {
                    cb('I GOT A PROBLEM');
                });
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
            
            it('should reject with an error if mongoUtils.findObject fails', function(done) {
                mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });

            it('should reject with an error if decorateUsers fails', function(done) {
                authUtils.decorateUser.and.returnValue(q.reject('no decorating skills'));
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    expect(req.requester).not.toBeDefined();
                    done();
                });
            });
        });
    });
});
