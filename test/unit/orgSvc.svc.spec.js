var flush = true;
describe('orgSvc (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, orgSvc, q, mongoUtils, FieldValidator, objUtils,
        enums, Status, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        orgSvc          = require('../../bin/orgSvc');
        FieldValidator  = require('../../lib/fieldValidator');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
        q               = require('q');
        enums           = require('../../lib/enums');
        Status          = enums.Status;
        Scope           = enums.Scope;
        
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
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        req = {uuid: '1234'};
    });

    describe('checkScope', function() {

        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    orgs: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var orgs = [{ name: 'org-1', id: 'o-1234'},
                        { name: 'org-2', id: 'o-1234'},
                        { name: 'org-1', id: 'o-4567'},
                        { name: 'org-2', id: 'o-4567'}];
            
            expect(orgs.filter(function(target) {
                return orgSvc.checkScope(requester, target, 'read');
            })).toEqual(orgs);
            expect(orgs.filter(function(target) {
                return orgSvc.checkScope(requester, target, 'edit');
            })).toEqual([orgs[0], orgs[1]]);
            expect(orgs.filter(function(target) {
                return orgSvc.checkScope(requester, target, 'delete');
            })).toEqual([orgs[0], orgs[1]]);
        });

        it('should sanity-check the user permissions object', function() {
            var target = { id: 'o-1' };
            expect(orgSvc.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(orgSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(orgSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs = {};
            requester.permissions.users = { read: Scope.All };
            expect(orgSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = '';
            expect(orgSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = Scope.All;
            expect(orgSvc.checkScope(requester, target, 'read')).toBe(true);
        });

    });

    describe('createValidator', function() {

        it('should have initialized correctly', function() {
            expect(orgSvc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(orgSvc.createValidator._condForbidden).toEqual({});
        });
        
        it('should prevent setting forbidden fields', function() {
            var updates = { a: 'b' };
            expect(orgSvc.createValidator.validate(updates, {}, {})).toBe(true);
            var updates = { a: 'b', id: 'foo' };
            expect(orgSvc.createValidator.validate(updates, {}, {})).toBe(false);
            var updates = { a: 'b', created: 'foo' };
            expect(orgSvc.createValidator.validate(updates, {}, {})).toBe(false);
        });
        
    });

    describe('updateValidator', function() {

        it('should have initialized correctly', function() {
            expect(orgSvc.updateValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(orgSvc.updateValidator._condForbidden).toEqual({});
        });
        
        it('should prevent illegal updates', function() {
            var updates = { a: 'b', id: 'o-4567'};
            expect(orgSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', created: 'long, long ago'};
            expect(orgSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', _id: 'custom_id' };
            expect(orgSvc.updateValidator.validate(updates, {}, {})).toBe(false);
        });

    });

    describe('getOrg', function() {

        var query, orgColl, fakeCursor;
        beforeEach(function() {
            req.user = { id: 'u-1234', org: 'o-1234', permissions: {orgs: {read: Scope.All}}};
            req.params = { id: 'o-4567' };
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, q([ {id: '1'}]));
                })
            };
            orgColl = {
                find: jasmine.createSpy('orgs.find').andReturn(fakeCursor)
            };
            spyOn(orgSvc, 'checkScope').andReturn(true);
        });

        it('should call orgs.find to get org', function(done) {
            orgSvc.getOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id:'1'});
                expect(orgColl.find).toHaveBeenCalledWith({id: 'o-4567'});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith({ id: 'u-1234', org: 'o-1234', permissions: {orgs: {read: Scope.All}}}, { id: 'o-4567' }, 'read');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not show a deleted org', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, q([{id: '1', status: Status.Deleted}]));
            })
            orgSvc.getOrg(req, orgColl).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No orgs found');
                expect(orgColl.find).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should log a warning when attempting to get an org when multiple with the same id exist', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, q([{id: '1'}, {id: '1'}]));
            });
            orgSvc.getOrg(req, orgColl).then(function(resp) {
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, []);
            });
           orgSvc.getOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No orgs found');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
       
        it('should fail if the promise was rejected', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb('Error!');
            });
            orgSvc.getOrg(req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(orgColl.find).toHaveBeenCalledWith({id: 'o-4567'});
                expect(orgSvc.checkScope).toHaveBeenCalled();
                done();
            });
        });
        
    });

    describe('getOrgs', function() {
        var query, orgColl, fakeCursor;
        beforeEach(function() {
            req.user = { id: 'u-1234', permissions: { orgs: { read: Scope.All } } };
            req.query = { sort: 'id,1', limit: 20, skip: 10 };
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, q([{id: '1'}]));
                }),
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) {
                    cb(null, 50);
                })
            };
            orgColl = {
                find: jasmine.createSpy('orgs.find').andReturn(fakeCursor)
            };
        });

        it('should sanity check the requester\'s permissions before checking them for the required scope', function(done) {
            delete req.user.permissions;
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to read all orgs');
                expect(orgColl.find).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should return a 403 if the requester doesn\'t have scope \'all\'', function(done) {
            req.user.permissions.orgs.read = Scope.Own;
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to read all orgs');
                expect(orgColl.find).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should call orgs.find to get orgs', function(done) {
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 11, end: 30, total: 50});
                expect(orgColl.find).toHaveBeenCalledWith({status: {$ne: Status.Deleted}},
                                                          {sort: {id: 1}, limit: 20, skip: 10});
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 46, end: 50, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use defaults for sorting/paginating options if not provided', function(done) {
            req.query = {};
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 1, end: 50, total: 50});
                expect(orgColl.find).toHaveBeenCalledWith({status: {$ne: Status.Deleted}},
                                                          {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 11, end: 30, total: 50});
                expect(mockLog.warn).toHaveBeenCalled();
                expect(orgColl.find).toHaveBeenCalledWith({status: {$ne: Status.Deleted}},
                                                          {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No orgs found');
                expect(resp.pagination).toEqual({start: 0, end: 0, total: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should fail if cursor.count has an error', function(done) {
            fakeCursor.count.andCallFake(function(cb) { cb('Error!'); });
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Error!'); });
            orgSvc.getOrgs(null, req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).finally(done);
        });
    });

    describe('setupOrg', function() {
        var newOrg, requester;
        beforeEach(function() {
            newOrg = { name: 'myNewOrg'};
            requester = { id: 'u-4567', org: 'o-1234' };
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdefg');
        });

        it('should set some default fields', function(done) {
            orgSvc.setupOrg(newOrg, requester);
            expect(newOrg.id).toBe('o-1234567890abcd');
            expect(newOrg.created instanceof Date).toBeTruthy('created is a Date');
            expect(newOrg.lastUpdated).toEqual(newOrg.created);
            expect(newOrg.name).toBe('myNewOrg');
            expect(newOrg.status).toBe(Status.Active);
            expect(newOrg.waterfalls.video).toEqual(['cinema6']);
            expect(newOrg.waterfalls.display).toEqual(['cinema6']);
            expect(newOrg.config).toEqual({});
            expect(mongoUtils.escapeKeys).toHaveBeenCalled();
            done();
        });
        
        it('should intelligently merge the newOrg fields with defaults', function(done) {
            newOrg.id = 'o-4567';
            newOrg.status = Status.Pending;
            newOrg.waterfalls = {video: ['publisher']};
            newOrg.config = {foo: 'bar'};
            orgSvc.setupOrg(newOrg, requester);
            expect(newOrg.id).toBe('o-1234567890abcd');
            expect(newOrg.created instanceof Date).toBeTruthy('created is a Date');
            expect(newOrg.lastUpdated).toEqual(newOrg.created);
            expect(newOrg.status).toBe(Status.Pending);
            expect(newOrg.waterfalls.display).toEqual(['cinema6']);
            expect(newOrg.config).toEqual({foo: 'bar'});
            expect(mongoUtils.escapeKeys).toHaveBeenCalled();
            done();
        });
        
    });

    describe('createOrg', function() {
        var orgColl;
        beforeEach(function() {
            orgColl = {
                findOne: jasmine.createSpy('orgs.findOne').andCallFake(function(query, cb) {
                    cb(null, null);
                }),
                insert: jasmine.createSpy('orgs.insert').andCallFake(function(obj, opts, cb) {
                    cb();
                })
            };
            req.body = { name: 'test' };
            req.user = { id: 'u-1234', org: 'o-1234', permissions: {orgs: {create: Scope.All}}};
            spyOn(orgSvc, 'setupOrg');
            spyOn(orgSvc.createValidator, 'validate').andReturn(true);
            spyOn(orgSvc, 'checkScope').andReturn(false);
        });

        it('should reject with a 400 if no org object is provided', function(done) {
            delete req.body;
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('You must provide an object in the body');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });            
        });
        
        it('should reject with a 400 if the name is unspecified', function(done) {
            req.body = {someAttribute: 'hello'};
            orgSvc.createOrg(req, orgColl)
            .then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New org object must have a name');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should sanity-check the user permissions object and check scope', function(done) {
            delete req.user.permissions;
            orgSvc.createOrg(req, orgColl).then(function(resp){
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to create orgs');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                req.user.permissions = {};
                return orgSvc.createOrg(req, orgColl);
            })
            .then(function(resp){
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to create orgs');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                req.user.permissions.orgs = {};
                return orgSvc.createOrg(req, orgColl);
            })
            .then(function(resp){
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to create orgs');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                req.user.permissions.orgs.create = {};
                return orgSvc.createOrg(req, orgColl);
            })
            .then(function(resp){
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to create orgs');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                req.user.permissions.orgs.create = Scope.Own;
                return orgSvc.createOrg(req, orgColl);
            })
            .then(function(resp){
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to create orgs');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                done();
            })
            .catch(function(error){
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should reject with a 409 if the org already exists', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) {
                cb(null, { name: 'test' });
            });
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(409);
                expect(resp.body).toEqual('An org with that name already exists');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should successfully create a new org', function(done) {
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({name: 'test' });
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findOne.calls[0].args[0]).toEqual({name: 'test'});
                expect(orgSvc.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(orgSvc.setupOrg).toHaveBeenCalledWith(req.body);
                expect(orgColl.insert).toHaveBeenCalled();
                expect(orgColl.insert.calls[0].args[0]).toBe(req.body);
                expect(orgColl.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(orgSvc.checkScope).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should prevent ordinary users from setting the adConfig', function(done) {
            req.body.adConfig = {foo: 'bar'};
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toEqual('Not authorized to set adConfig');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, {}, 'editAdConfig');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let users set the adConfig if they have permission to do so', function(done) {
            orgSvc.checkScope.andReturn(true);
            req.body.adConfig = {foo: 'bar'};
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({name: 'test', adConfig: {foo: 'bar'}});
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.insert).toHaveBeenCalled();
                expect(orgColl.insert.calls[0].args[0]).toEqual({name: 'test', adConfig: {foo: 'bar'}});
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, {}, 'editAdConfig');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with a 400 if the new org contains illegal fields', function(done) {
            orgSvc.createValidator.validate.andReturn(false);
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Illegal fields');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgSvc.createValidator.validate).toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if finding the existing org fails', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if inserting the org fails', function(done) {
            orgColl.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            orgSvc.createOrg(req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.insert).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('updateOrg', function() {
        var orgColl, origOrg;
        beforeEach(function() {
            origOrg = {orig: 'yes'};
            orgColl = {
                findOne: jasmine.createSpy('orgs.findOne').andCallFake(function(query, cb) {
                    cb(null, origOrg);
                }),
                findAndModify: jasmine.createSpy('orgs.findAndModify').andCallFake(
                    function(query, sort, obj, opts, cb) {
                        cb(null, [{ id: 'o-4567', updated: true }]);
                    })
            };
            req.body = { foo: 'bar' };
            req.params = { id: 'o-4567' };
            req.user = { id: 'u-1234' };
            spyOn(orgSvc, 'checkScope').andReturn(true);
            spyOn(orgSvc.updateValidator, 'validate').andReturn(true);
            spyOn(objUtils, 'compareObjects').andCallThrough();
        });
        
        it('should fail immediately if no update object is provided', function(done) {
            delete req.body;
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                req.body = 'foo';
                return orgSvc.updateOrg(req, orgColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBeDefined(400);
                expect(resp.body).toBe('You must provide an object in the body');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully update an org', function(done) {
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'o-4567', updated: true });
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findOne.calls[0].args[0]).toEqual({id: 'o-4567'});
                expect(orgSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, {id: 'o-4567'}, 'edit');
                expect(orgSvc.updateValidator.validate).toHaveBeenCalledWith(req.body, {orig: 'yes'}, {id: 'u-1234'});
                expect(orgColl.findAndModify).toHaveBeenCalled();
                expect(orgColl.findAndModify.calls[0].args[0]).toEqual({id: 'o-4567'});
                expect(orgColl.findAndModify.calls[0].args[1]).toEqual({id: 1});
                var updates = orgColl.findAndModify.calls[0].args[2];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.foo).toBe('bar');
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(orgColl.findAndModify.calls[0].args[3]).toEqual({w:1,journal:true,new:true});
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not create an org if it does not exist', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That org does not exist');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalled();
                expect(orgColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
               expect(error.toString()).not.toBeDefined();
               done();
            });
        });
        
        it('should not edit an org the requester is not authorized to edit', function(done) {
            orgSvc.checkScope.andReturn(false);
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this org');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalled();
                expect(orgColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should prevent ordinary users from editing the adConfig', function(done) {
            orgSvc.checkScope.andCallFake(function(user, orig, verb) {
                if (verb == 'editAdConfig') return false;
                else return true;
            });
            req.body.adConfig = {foo: 'bar'};
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit adConfig of this org');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findAndModify).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, {id: 'o-4567'}, 'editAdConfig');
                expect(objUtils.compareObjects).toHaveBeenCalledWith({foo: 'bar'}, undefined);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should allow the edit if the adConfig is unchanged', function(done) {
            orgSvc.checkScope.andCallFake(function(user, orig, verb) {
                if (verb == 'editAdConfig') return false;
                else return true;
            });
            req.body.adConfig = {foo: 'bar'};
            origOrg.adConfig = {foo: 'bar'};
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'o-4567', updated: true });
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findAndModify).toHaveBeenCalled();
                expect(orgColl.findAndModify.calls[0].args[2].$set.adConfig).toEqual({foo: 'bar'});
                expect(orgSvc.checkScope).not.toHaveBeenCalledWith(req.user, {id: 'o-4567'}, 'editAdConfig');
                expect(objUtils.compareObjects).toHaveBeenCalledWith({foo: 'bar'}, {foo: 'bar'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let users edit the adConfig if they have permission to do so', function(done) {
            orgSvc.checkScope.andReturn(true);
            req.body.adConfig = {foo: 'bar'};
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 'o-4567', updated: true });
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findAndModify).toHaveBeenCalled();
                expect(orgColl.findAndModify.calls[0].args[2].$set.adConfig).toEqual({foo: 'bar'});
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, {id: 'o-4567'}, 'editAdConfig');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the org if the updates contain illegal fields', function(done) {
            orgSvc.updateValidator.validate.andReturn(false);
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgSvc.updateValidator.validate).toHaveBeenCalled();
                expect(orgColl.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findAndModify).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            orgColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) {
                cb('Error!', null);
            });
            orgSvc.updateOrg(req, orgColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findAndModify).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('deleteOrg', function() {
        var orgColl, fakeCursor, userColl;
        beforeEach(function() {
            orgColl = {
                findOne: jasmine.createSpy('orgs.findOne').andCallFake(function(query, cb) {
                    cb(null, 'original');
                }),
                update: jasmine.createSpy('orgs.update').andCallFake(function(query,obj,opts,cb) {
                    cb(null, 1);
                })
            };
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, []);
                })
            };
            userColl = {
                find: jasmine.createSpy('users.find').andReturn(fakeCursor)
            };
            req.params = { id: 'o-4567' };
            req.user = { id: 'u-1234' , org: 'o-1234', permissions: {orgs: {delete: Scope.All}}};
            spyOn(orgSvc, 'checkScope').andReturn(true);
        });
        
        it('should fail if the user is trying to delete their own org', function(done) {
            req.params.id = 'o-1234';
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You cannot delete your own org');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully mark an org as deleted', function(done) {
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(orgColl.findOne.calls[0].args[0]).toEqual({id: 'o-4567'});
                expect(userColl.find).toHaveBeenCalledWith({org:'o-4567',status:'active'});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(orgColl.update).toHaveBeenCalled();
                expect(orgColl.update.calls[0].args[0]).toEqual({id: 'o-4567'});
                var updates = orgColl.update.calls[0].args[1];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.status).toBe(Status.Deleted);
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(orgColl.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete a nonexistent org', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).not.toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete an org the requester is not authorized to delete', function(done) {
            delete req.user.permissions;
            orgSvc.checkScope.andReturn(false);
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this org');
                expect(orgColl.findOne).not.toHaveBeenCalled();
                expect(userColl.find).not.toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit the org if they have already been deleted', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) {
                cb(null, {id: 'o-4567', status: Status.Deleted});
            });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).not.toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete the org if it still has active users', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, ['user1', 'user2']); });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Org still has active users');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if findOne fails', function(done) {
            orgColl.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).not.toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if users.find fails', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb('Error!', null);
            });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).toHaveBeenCalled();
                expect(orgColl.update).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            orgColl.update.andCallFake(function(query, obj, ops, cb) {
                cb('Error!', null);
            });
            orgSvc.deleteOrg(req, orgColl, userColl).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(orgColl.findOne).toHaveBeenCalled();
                expect(userColl.find).toHaveBeenCalled();
                expect(orgColl.update).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

});
