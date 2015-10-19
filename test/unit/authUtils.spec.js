var flush = true;
describe('authUtils', function() {
    var mockUser, q, authUtils, uuid, logger, mongoUtils, mockLog, bcrypt, mockColl, enums, Status,
        Scope, anyFunc, res, next;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        bcrypt      = require('bcrypt');
        authUtils   = require('../../lib/authUtils');
        mongoUtils  = require('../../lib/mongoUtils');
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
            findOne: jasmine.createSpy('coll.findOne').and.callFake(function(query, cb) {
                cb(null, mockUser);
            })
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.returnValue(mockColl)
        };
        
        res = { send: jasmine.createSpy('res.send()') };
        next = jasmine.createSpy('next()');
        
        authUtils._db = mockDb;
        spyOn(mongoUtils, 'safeUser').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
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
    
    describe('getUser', function() {
        beforeEach(function() {
            spyOn(authUtils, 'decorateUser').and.callFake(function(user) {
                if (user) return q({ decorated: 'yes' });
                else return user;
            });
        });

        it('should call coll.findOne to find a user', function(done) {
            authUtils.getUser('u-1234').then(function(user) {
                delete mockUser.password;
                expect(user).toEqual({ decorated: 'yes' });
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.findOne).toHaveBeenCalledWith({id: 'u-1234'}, anyFunc);
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1234',
                    status: Status.Active, email: 'johnnyTestmonkey', roles: ['base'] });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should resolve with nothing if no results are found', function(done) {
            mockColl.findOne.and.callFake(function(query, cb) { cb(); });
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
                expect(mongoUtils.safeUser).toHaveBeenCalledWith(undefined);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass on errors from mongo', function(done) {
            mockColl.findOne.and.callFake(function(query, cb) { cb('I GOT A PROBLEM'); });
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe(JSON.stringify({error: 'Error looking up user', detail: 'I GOT A PROBLEM'}));
                expect(mockColl.findOne).toHaveBeenCalledWith({id: 'u-1234'}, anyFunc);
                expect(authUtils.decorateUser).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should pass on errors from decorateUser', function(done) {
            authUtils.decorateUser.and.returnValue(q.reject('no decorating skills'));
            authUtils.getUser('u-1234').then(function(user) {
                expect(user).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe(JSON.stringify({error: 'Error looking up user', detail: 'no decorating skills'}));
                expect(mockColl.findOne).toHaveBeenCalledWith({id: 'u-1234'}, anyFunc);
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
                    return { toArray: function(cb) {
                        cb(null, mockRoles);
                    } };
                })
            };
            polColl = {
                find: jasmine.createSpy('policies.find()').and.callFake(function(query) {
                    return { toArray: function(cb) {
                        cb(null, mockPolicies);
                    } };
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
            mockRoles = [], mockPolicies = [];
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
            roleColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM') } });
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
            polColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM') } });
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
            
            var perms = {experiences: 'edit', orgs: 'read' };
            expect(authUtils._compare(perms, userPerms)).toBe(true);
            
            var perms = { orgs: 'edit' };
            expect(authUtils._compare(perms, userPerms)).toBe(false);
            
            var perms = {users: 'read' };
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
        var perms;
        beforeEach(function() {
            perms = { users: 'read' };
            spyOn(authUtils, '_compare').and.returnValue(true);
            spyOn(authUtils, 'getUser').and.callFake(function(id) {
                return q(mongoUtils.unescapeKeys(mongoUtils.safeUser(mockUser)));
            });
        });
        
        it('should return a user if found and the permissions match', function(done) {
            authUtils.authUser('u-1234', perms).then(function(result) {
                delete mockUser.password;
                expect(result.user).toEqual(mockUser);
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(authUtils._compare).toHaveBeenCalledWith(perms, mockUser.permissions);
                expect(mongoUtils.safeUser).toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a fail message if the permissions do not match', function(done) {
            authUtils._compare.and.returnValue(false);
            authUtils.authUser('u-1234', perms).then(function(result) {
                expect(result).toBe('Permissions do not match');
                expect(result.user).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a fail message if the user is not active (by default)', function(done) {
            mockUser.status = 'inactive';
            authUtils.authUser('u-1234', perms).then(function(result) {
                expect(result).toBe('User is not active');
                expect(result.user).not.toBeDefined();
                expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                expect(authUtils._compare).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if getting the user fails', function(done) {
            authUtils.getUser.and.returnValue(q.reject('I GOT A PROBLEM'));
            authUtils.authUser('u-1234', perms).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(authUtils.getUser).toHaveBeenCalled();
                expect(authUtils._compare).not.toHaveBeenCalled();
            }).done(done);
        });
        
        describe('when passed user statuses to check against', function() {
            var requiredStatuses;
            
            beforeEach(function() {
                requiredStatuses = [Status.New, Status.Active];
            });
            
            it('should return a user when the user has one of the required statuses', function(done) {
                var checkSuccess = function() {
                    return authUtils.authUser('u-1234', perms, requiredStatuses).then(function(result) {
                        delete mockUser.password;
                        expect(result.user).toEqual(mockUser);
                        expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                        expect(authUtils._compare).toHaveBeenCalledWith(perms, mockUser.permissions);
                        expect(mongoUtils.safeUser).toHaveBeenCalled();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    });
                };
                
                mockUser.status = 'active';
                checkSuccess().then(function() {
                    mockUser.status = 'new';
                    return checkSuccess();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });

            it('should return a fail message when the user does not have any of the required statuses', function(done) {
                mockUser.status = 'deleted';
                authUtils.authUser('u-1234', perms, requiredStatuses).then(function(result) {
                    expect(result).toBe('User is not new, or active');
                    expect(result.user).not.toBeDefined();
                    expect(authUtils.getUser).toHaveBeenCalledWith('u-1234');
                    expect(authUtils._compare).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });    
        });
    });
    
    describe('middlewarify', function() {
        it('should return a function', function() {
            var midWare = authUtils.middlewarify('fakePerms', 'fakeDb');
            expect(authUtils._db).toBe('fakeDb');
            expect(typeof midWare).toBe('function');
        });
        
        describe('returns a function that', function() {
            var perms, req;
            beforeEach(function() {
                perms = 'fakePerms';
                spyOn(uuid, 'createUuid').and.returnValue('1234567890abcd');
                req = {
                    uuid: '1234',
                    method: 'get',
                    baseUrl: '/ut',
                    route: {
                        path: '/:id'
                    },
                    session: {
                        user: 'u-123',
                        save: jasmine.createSpy('save()').and.callFake(function(cb) {
                            cb(null);
                        })
                    }
                };
                spyOn(authUtils, 'authUser').and.returnValue(q({ user: { id: 'u-123' } }));
            });
        
            it('should resave the session for authorized users', function(done) {
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(req.session.save).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should not resave the session for unauthorized users', function(done) {
                authUtils.authUser.and.returnValue(q('HE DON\'T BELONG HERE'));
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(req.session.save).not.toHaveBeenCalled();
                    done();
                });
            });
        
            it('should correctly wrap authUser', function(done) {
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).not.toHaveBeenCalled();
                    expect(next).toHaveBeenCalledWith();
                    expect(req.user).toEqual({id: 'u-123'});
                    expect(req.uuid).toBe('1234');
                    expect(uuid.createUuid).not.toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalledWith('u-123', 'fakePerms', undefined);
                    done();
                });
            });
            
            it('should call createUuid if there is no req.uuid', function(done) {
                delete req.uuid;
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).not.toHaveBeenCalled();
                    expect(next).toHaveBeenCalledWith();
                    expect(req.uuid).toBe('1234567890');
                    expect(uuid.createUuid).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with a 401 if there is no user in the session', function(done) {
                delete req.session.user;
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(401, 'Unauthorized');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(authUtils.authUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 403 if the user is unauthorized', function(done) {
                authUtils.authUser.and.returnValue(q('HE DON\'T BELONG HERE'));
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 500 if there was an internal error', function(done) {
                authUtils.authUser.and.returnValue(q.reject('I GOT A PROBLEM'));
                var midWare = authUtils.middlewarify(perms);
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(authUtils.authUser).toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            describe('when passed a userStatuses param', function() {
                var statuses;

                beforeEach(function() {
                    statuses = ['active', 'new'];
                });
                
                it('should fail with a 403 if the user is not that status', function(done) {
                    authUtils.authUser.and.returnValue(q('HE DON\'T BELONG HERE'));
                    var midWare = authUtils.middlewarify(perms, null, statuses);
                    midWare(req, res, next);
                    process.nextTick(function() {
                        expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                        expect(next).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                        expect(authUtils.authUser).toHaveBeenCalledWith(req.session.user, perms, statuses);
                        expect(req.user).not.toBeDefined();
                        done();
                    });
                });
            });
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
            });

            it('should fail with a 500 if authUtils has no db', function(done) {
                delete authUtils._db;
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockColl.findOne).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).toHaveBeenCalledWith({email: 'otter'}, anyFunc);
                    expect(bcrypt.compare).toHaveBeenCalledWith('thisisapassword', 'password', anyFunc);
                    expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                    expect(authUtils.decorateUser).toHaveBeenCalledWith({ id: 'u-1234',
                        status: Status.Active, email: 'johnnyTestmonkey', roles: ['base'] });
                    expect(req.user).toEqual({ decorated: 'yes' });
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
                    expect(mockColl.findOne).toHaveBeenCalledWith({email: 'otter'}, anyFunc);
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(mongoUtils.safeUser).toHaveBeenCalledWith(mockUser);
                    expect(authUtils.decorateUser).toHaveBeenCalled();
                    expect(req.user).toEqual({ decorated: 'yes' });
                    done();
                });
            });
            
            it('should fail with a 401 if the user does not exist', function(done) {
                mockColl.findOne.and.callFake(function(query, cb) {
                    cb(null, null);
                });
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(401, 'Invalid email or password');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
            
            it('should reject with an error if users.findOne fails', function(done) {
                mockColl.findOne.and.callFake(function(query, cb) {
                    cb('I GOT A PROBLEM');
                });
                midWare(req, res, next);
                process.nextTick(function() {
                    expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of user');
                    expect(next).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).not.toHaveBeenCalled();
                    expect(authUtils.decorateUser).not.toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
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
                    expect(mockColl.findOne).toHaveBeenCalled();
                    expect(bcrypt.compare).toHaveBeenCalled();
                    expect(authUtils.decorateUser).toHaveBeenCalled();
                    expect(req.user).not.toBeDefined();
                    done();
                });
            });
        });
    });
});
