var flush = true;
describe('orgSvc (UT)', function() {
    var mockLog, mockLogger, uuid, logger, orgModule, q, mongoUtils, objUtils, CrudSvc, enums, Status, Scope,
        orgSvc, coll, userColl, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        orgModule       = require('../../bin/orgSvc');
        CrudSvc         = require('../../lib/crudSvc');
        objUtils        = require('../../lib/objUtils');
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

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
        
        coll = { collectionName: 'orgs' };
        userColl = { collectionName: 'users' };
        orgSvc = orgModule.setupSvc(coll, userColl);
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            [CrudSvc.prototype.preventGetAll, CrudSvc.prototype.validateUniqueProp,
             orgModule.activeUserCheck, orgModule.checkAdConfig].forEach(function(fn) {
                spyOn(fn, 'bind').andReturn(fn);
            });

            svc = orgModule.setupSvc(coll, userColl);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toBe(coll);
            expect(svc._userColl).toBe(userColl);
            expect(svc.objName).toBe('orgs');
            expect(svc._prefix).toBe('o');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
        });
        
        it('should override some internal CrudSvc functions', function() {
            expect(svc.userPermQuery).toBe(orgModule.userPermQuery);
            expect(svc.checkScope).toBe(orgModule.checkScope);
        });
        
        it('should prevent getting all orgs', function() {
            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(CrudSvc.prototype.preventGetAll.bind).toHaveBeenCalledWith(svc);
        });
        
        it('should require a name on create', function() {
            expect(svc.createValidator._required).toContain('name');
        });
        
        it('should check that a user is permitted to set the adConfig', function() { 
            expect(svc.createValidator._condForbidden.adConfig).toBe(orgModule.checkAdConfig);
            expect(svc.editValidator._condForbidden.adConfig).toBe(orgModule.checkAdConfig);
            expect(orgModule.checkAdConfig.bind).toHaveBeenCalledWith(orgModule, svc);
        });
        
        it('should check special permissions on create', function() {
            expect(svc._middleware.create).toContain(orgModule.createPermCheck);
        });
        
        it('should setup the org\'s config on create', function() {
            expect(svc._middleware.create).toContain(orgModule.setupConfig);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);
        });
        
        it('should check special permissions on delete', function() {
            expect(svc._middleware.delete).toContain(orgModule.deletePermCheck);
        });
        
        it('should prevent deleting active orgs with active users', function() {
            expect(svc._middleware.delete).toContain(orgModule.activeUserCheck);
            expect(orgModule.activeUserCheck.bind).toHaveBeenCalledWith(orgModule, svc);
        });
    });
    
    describe('checkAdConfig', function() {
        it('should just call svc.checkScope with editAdConfig as the verb', function() {
            spyOn(orgSvc, 'checkScope').andReturn(true);
            expect(orgModule.checkAdConfig(orgSvc, { adConfig: 'new' }, { adConfig: 'orig' }, { id: 'u-1' })).toBe(true);
            expect(orgSvc.checkScope).toHaveBeenCalledWith({ id: 'u-1' }, { adConfig: 'orig' }, 'editAdConfig');
        });
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
                return orgModule.checkScope(requester, target, 'read');
            })).toEqual(orgs);
            expect(orgs.filter(function(target) {
                return orgModule.checkScope(requester, target, 'edit');
            })).toEqual([orgs[0], orgs[1]]);
            expect(orgs.filter(function(target) {
                return orgModule.checkScope(requester, target, 'delete');
            })).toEqual([orgs[0], orgs[1]]);
        });

        it('should sanity-check the user permissions object', function() {
            var target = { id: 'o-1' };
            expect(orgModule.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs = {};
            requester.permissions.users = { read: Scope.All };
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = '';
            expect(orgModule.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.orgs.read = Scope.All;
            expect(orgModule.checkScope(requester, target, 'read')).toBe(true);
        });

    });
    
    describe('userPermQuery', function() {
        var query, requester;
        beforeEach(function() {
            query = {};
            requester = { id: 'u-1', org: 'o-1', permissions: { orgs: { read: Scope.Own } } };
        });
        
        it('should just check that the orgs are not deleted if the requester is an admin', function() {
            requester.permissions.orgs.read = Scope.All;
            expect(orgModule.userPermQuery(query, requester))
                .toEqual({ status: { $ne: Status.Deleted } });
            expect(query).toEqual({});
        });
        
        it('should check that the ids match if the requester has Scope.Own or Scope.Org', function() {
            var expected = { id: 'o-1', status: { $ne: Status.Deleted } };
            expect(orgModule.userPermQuery(query, requester)).toEqual(expected);
            requester.permissions.orgs.read = Scope.Org;
            expect(orgModule.userPermQuery(query, requester)).toEqual(expected);
        });
                
        it('should log a warning if the requester has an invalid scope', function() {
            requester.permissions.orgs.read = 'alfkjdf';
            expect(orgModule.userPermQuery(query, requester))
                .toEqual({ id: 'o-1', status: { $ne: Status.Deleted } });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('createPermCheck', function() {
        beforeEach(function() {
            req.user.permissions = { orgs: { create: Scope.All } };
        });
        
        it('should call next if the user has admin-level create priviledges', function(done) {
            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if the user does not have admin-level create priviledges', function(done) {
            req.user.permissions.orgs.create = Scope.Own;

            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to create orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('setupConfig', function() {
        beforeEach(function() {
            req.body = { id: 'o-1', name: 'new org' };
        });

        it('should initialize some props on the new org and call next', function(done) {
            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({});
                expect(req.body.waterfalls).toEqual({ video: ['cinema6'], display: ['cinema6'] });
                done();
            });
        });
        
        it('should respect user-defined values', function(done) {
            req.body.config = { foo: 'bar' };
            req.body.waterfalls = { video: ['mine'] };

            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({ foo: 'bar' });
                expect(req.body.waterfalls).toEqual({ video: ['mine'], display: ['cinema6'] });
                done();
            });
        });
    });

    describe('deletePermCheck', function() {
        beforeEach(function() {
            req.user.permissions = { orgs: { delete: Scope.All } };
            req.params = { id: 'o-2' };
        });
        
        it('should call done if a user tries deleting their own org', function(done) {
            req.params.id = req.user.org;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'You cannot delete your own org' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if a user does not have admin delete priviledges', function(done) {
            req.user.permissions.orgs.delete = Scope.Own;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to delete orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if everything checks out', function(done) {
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('activeUserCheck', function() {
        var mockCursor;
        beforeEach(function() {
            req.params = { id: 'o-2' };

            mockCursor = {
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) { cb(null, 3); })
            };
            orgSvc._userColl.find = jasmine.createSpy('userColl.find()').andReturn(mockCursor);
        });
        
        it('should call done if the org still has active users', function(done) {
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has active users' });
                expect(errorSpy).not.toHaveBeenCalled();
                
                expect(orgSvc._userColl.find).toHaveBeenCalledWith({ org: 'o-2', status: { $ne: Status.Deleted } });
                expect(mockCursor.count).toHaveBeenCalledWith(jasmine.any(Function));
                done();
            });
        });
        
        it('should call next if the org has no active users', function(done) {
            mockCursor.count.andCallFake(function(cb) { cb(null, 0); });
        
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockCursor.count.andCallFake(function(cb) { cb('I GOT A PROBLEM'); });
        
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
});
