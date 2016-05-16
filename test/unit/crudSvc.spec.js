var flush = true;
describe('CrudSvc', function() {
    var q, mockLog, logger, CrudSvc, uuid, mongoUtils, FieldValidator, Model, MiddleManager, mockColl, anyFunc,
        historian, req, svc, enums, Scope, Status, nextSpy, doneSpy, errorSpy, histMidware;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        uuid            = require('rc-uuid');
        CrudSvc         = require('../../lib/crudSvc');
        enums           = require('../../lib/enums');
        logger          = require('../../lib/logger');
        mongoUtils      = require('../../lib/mongoUtils');
        FieldValidator  = require('../../lib/fieldValidator');
        historian       = require('../../lib/historian');
        Model           = require('../../lib/model');
        MiddleManager   = require('../../lib/middleManager');
        Scope           = enums.Scope;
        Status          = enums.Status;
        anyFunc = jasmine.any(Function);

        mockColl = {
            collectionName: 'thangs',
            find: jasmine.createSpy('coll.find')
        };
        req = {
            uuid: '1234',
            requester: { id: 'u1', permissions: {} },
            user: { id: 'u1', org: 'o1' }
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

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
        spyOn(mongoUtils, 'findObject');
        spyOn(Model.prototype.midWare, 'bind').and.returnValue(Model.prototype.midWare);
        spyOn(FieldValidator.prototype.midWare, 'bind').and.returnValue(FieldValidator.prototype.midWare);
        spyOn(FieldValidator, 'userFunc').and.callThrough();
        spyOn(FieldValidator, 'orgFunc').and.callThrough();
        spyOn(CrudSvc.prototype.checkExisting, 'bind').and.returnValue(CrudSvc.prototype.checkExisting);
        spyOn(CrudSvc.prototype.setupObj, 'bind').and.returnValue(CrudSvc.prototype.setupObj);
        
        histMidware = jasmine.createSpy('handleStatHist()');
        spyOn(historian, 'middlewarify').and.returnValue(histMidware);

        svc = new CrudSvc(mockColl, 't');
        spyOn(svc, 'formatOutput').and.returnValue('formatted');
    });

    describe('initialization', function() {
        it('should correctly initialize', function() {
            expect(svc).toEqual(jasmine.any(MiddleManager));
            expect(svc._coll).toBe(mockColl);
            expect(svc._prefix).toBe('t');
            expect(svc.objName).toBe('thangs');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(false);
            expect(svc._ownedByUser).toBe(true);
            expect(svc.maxReadLimit).toBe(null);

            expect(svc.createValidator instanceof FieldValidator).toBe(true);
            expect(svc.createValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(svc.editValidator instanceof FieldValidator).toBe(true);
            expect(svc.editValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(svc.model).not.toBeDefined();

            expect(FieldValidator.userFunc).toHaveBeenCalledWith('thangs', 'create');
            expect(FieldValidator.userFunc).toHaveBeenCalledWith('thangs', 'edit');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('thangs', 'create');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('thangs', 'edit');
            expect(svc.createValidator._condForbidden.user).toEqual(jasmine.any(Function));
            expect(svc.createValidator._condForbidden.org).toEqual(jasmine.any(Function));
            expect(svc.editValidator._condForbidden.user).toEqual(jasmine.any(Function));
            expect(svc.editValidator._condForbidden.org).toEqual(jasmine.any(Function));

            expect(svc._middleware).toEqual({
                create: [svc.createValidator.midWare, svc.setupObj],
                edit: [svc.checkExisting, svc.editValidator.midWare],
                delete: [svc.checkExisting]
            });
            expect(svc.createValidator.midWare.bind).toHaveBeenCalledWith(svc.createValidator);
            expect(svc.editValidator.midWare.bind).toHaveBeenCalledWith(svc.editValidator);
            expect(svc.checkExisting.bind).toHaveBeenCalledWith(svc, 'edit');
            expect(svc.checkExisting.bind).toHaveBeenCalledWith(svc, 'delete');
        });

        it('should allow setting various simple options', function() {
            var opts = {
                objName: 'bananas', allowPublic: true, ownedByUser: false, maxReadLimit: 666
            };
            svc = new CrudSvc(mockColl, 't', opts);
            expect(svc.objName).toBe('bananas');
            expect(svc._allowPublic).toBe(true);
            expect(svc._ownedByUser).toBe(false);
            expect(svc.maxReadLimit).toBe(666);
        });

        it('should allow disabling the user + org props', function() {
            svc = new CrudSvc(mockColl, 't', { userProp: false, orgProp: false });
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc.createValidator._condForbidden.user).not.toBeDefined();
            expect(svc.createValidator._condForbidden.org).not.toBeDefined();
            expect(svc.editValidator._condForbidden.user).not.toBeDefined();
            expect(svc.editValidator._condForbidden.org).not.toBeDefined();
        });

        it('should support the statusHistory option', function() {
            svc = new CrudSvc(mockColl, 't', { statusHistory: true });
            expect(svc.createValidator._forbidden).toContain('statusHistory');
            expect(svc.editValidator._forbidden).toContain('statusHistory');
            expect(historian.middlewarify).toHaveBeenCalledWith('status', 'statusHistory');
            expect(svc._middleware.create).toContain(histMidware);
            expect(svc._middleware.edit).toContain(histMidware);
            expect(svc._middleware.delete).toContain(histMidware);
        });

        describe('if a schema is provided', function() {
            beforeEach(function() {
                svc = new CrudSvc(mockColl, 't', {}, { foo: { __type: 'string' } });
            });

            it('should setup a model instead of FieldValidators', function() {
                expect(svc.model).toEqual(jasmine.any(Model));
                expect(svc.model.schema.foo).toEqual({ __type: 'string' });
                expect(svc.createValidator).not.toBeDefined();
                expect(svc.editValidator).not.toBeDefined();
                expect(svc._middleware.create).toContain(svc.model.midWare);
            });

            describe('creates a model that', function() {
                var newObj, origObj, requester;
                beforeEach(function() {
                    newObj = { foo: 'bar' };
                    origObj = {};
                    requester = { fieldValidation: { thangs: {} } };
                });

                // overriden system fields
                ['id', '_id', 'created', 'lastUpdated'].forEach(function(field) {
                    describe('when handling ' + field, function() {
                        it('should not allow any requesters to set the field', function() {
                            requester.fieldValidation.thangs[field] = { __allowed: true };
                            newObj[field] = 't-myownid';
                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: true, reason: undefined });
                            expect(newObj).toEqual({ foo: 'bar' });
                        });
                    });
                });

                // ownership fields
                ['user', 'org'].forEach(function(field) {
                    describe('when handling ' + field, function() {
                        it('should trim the field if set', function() {
                            newObj[field] = 'someguy';
                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: true, reason: undefined });
                            expect(newObj).toEqual({ foo: 'bar' });
                        });

                        it('should allow some requesters to set the field', function() {
                            requester.fieldValidation.thangs[field] = { __allowed: true };
                            newObj[field] = 'someguy';
                            expect(svc.model.validate('create', newObj, origObj, requester))
                                .toEqual({ isValid: true, reason: undefined });
                            expect(newObj[field]).toEqual('someguy');
                        });
                    });
                });

                describe('when handling statusHistory', function() {
                    beforeEach(function() {
                        svc = new CrudSvc(mockColl, 't', { statusHistory: true }, {});
                    });

                    it('should not allow any requesters to set the field', function() {
                        requester.fieldValidation.thangs.statusHistory = { __allowed: true };
                        newObj.statusHistory = [{ status: 'bad', date: 'yesterday' }];
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj).toEqual({ foo: 'bar' });
                    });
                });
            });
        });
    });
    
    describe('CrudSvc.singularizeName', function() {
        it('should return the singular version of the internal objName', function() {
            expect(CrudSvc.singularizeName('experiences')).toBe('experience');
            expect(CrudSvc.singularizeName('cards')).toBe('card');
            expect(CrudSvc.singularizeName('orgs')).toBe('org');
            expect(CrudSvc.singularizeName('brownies')).toBe('brownie');
        });
        
        it('should handle nouns with non-standard plurals properly', function() {
            expect(CrudSvc.singularizeName('categories')).toBe('category');
            expect(CrudSvc.singularizeName('policies')).toBe('policy');
        });
    });

    describe('CrudSvc.checkScope', function() {
        var req, thangs;
        beforeEach(function() {
            req = {
                uuid: '1234',
                requester: {
                    id: 'u-1234',
                    permissions: { thangs: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    } }
                },
                user: {
                    id: 'u-1234',
                    org: 'o-1234'
                }
            };
            thangs = [{ id: 't-1', user: 'u-1234', org: 'o-1234'},
                      { id: 't-2', user: 'u-4567', org: 'o-1234'},
                      { id: 't-3', user: 'u-1234', org: 'o-4567'},
                      { id: 't-4', user: 'u-4567', org: 'o-4567'}];
        });

        it('should correctly handle the scopes', function() {
            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'read');
            })).toEqual(thangs);

            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'edit');
            })).toEqual([thangs[0], thangs[1], thangs[2]]);

            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'delete');
            })).toEqual([thangs[0], thangs[2]]);
        });
        
        it('should handle a case where there is no req.user', function() {
            delete req.user;
            req.requester.id = 'app-1';
            req.application = { id: 'app-1', key: 'watchman' };
            
            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'read');
            })).toEqual(thangs);

            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'edit');
            })).toEqual([]);

            expect(thangs.filter(function(thang) {
                return CrudSvc.checkScope('thangs', true, req, thang, 'delete');
            })).toEqual([]);
        });

        it('should sanity-check the user permissions object', function() {
            var thang = { id: 't-1' };
            
            req.requester.permissions.thangs.read = '';
            expect(CrudSvc.checkScope('thangs', true, {}, thang, 'read')).toBe(false);

            req.requester.permissions.thangs = {};
            req.requester.permissions.orgs = { read: Scope.All };
            expect(CrudSvc.checkScope('thangs', true, {}, thang, 'read')).toBe(false);
            
            req.requester.permissions = {};
            expect(CrudSvc.checkScope('thangs', true, {}, thang, 'read')).toBe(false);
            
            delete req.requester;
            expect(CrudSvc.checkScope('thangs', true, {}, thang, 'read')).toBe(false);
        });
        
        describe('if handling entities not owned by users', function() {
            beforeEach(function() {
                req.user = {
                    id: 'u-1234',
                    org: 'o-1',
                    thang: 't-1'
                };
                thangs = [
                    { id: 't-1', status: Status.Active, org: 'o-2' },
                    { id: 't-2', status: Status.Active, org: 'o-1' },
                    { id: 't-3', status: Status.Active }
                ];
            });
            
            it('should allow users with own/org scope to get entities they belong to', function() {
                // 'all' scope should still work the same
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'read');
                })).toEqual(thangs);
                
                // 'org' scope should get thangs owned by the org + the user's thang
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'edit');
                })).toEqual([thangs[0], thangs[1]]);

                // 'own' scope should only get the user's thang
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'delete');
                })).toEqual([thangs[0]]);
            });

            it('should handle users without a parent object id', function() {
                delete req.user.thang;
                // 'all' scope should still work the same
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'read');
                })).toEqual(thangs);
                
                // 'org' scope should only get thangs owned by the org
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'edit');
                })).toEqual([thangs[1]]);

                // 'own' scope should get nothing
                expect(thangs.filter(function(thang) {
                    return CrudSvc.checkScope('thangs', false, req, thang, 'delete');
                })).toEqual([]);
            });
        });
    });
    
    describe('CrudSvc.prototype.checkScope', function() {
        var req, obj, action;
        beforeEach(function() {
            req = { uuid: '1234' };
            obj = { foo: 'bar' };
            action = 'edit';
            spyOn(CrudSvc, 'checkScope').and.returnValue(true);
        });

        it('should call the static method correctly', function() {
            expect(svc.checkScope(req, obj, action)).toBe(true);
            expect(CrudSvc.checkScope).toHaveBeenCalledWith('thangs', true, req, obj, action);
            
            CrudSvc.checkScope.calls.reset();
            svc.objName = 'undapants';
            svc._ownedByUser = false;
            expect(svc.checkScope(req, obj, action)).toBe(true);
            expect(CrudSvc.checkScope).toHaveBeenCalledWith('undapants', false, req, obj, action);
        });
    });

    describe('userPermQuery', function() {
        var query, req;
        beforeEach(function() {
            query = { type: 'foo' };
            req = {
                uuid: '1234',
                requester: {
                    id: 'u-1',
                    permissions: { thangs: { read: Scope.Own } }
                },
                user: {
                    id: 'u-1',
                    org: 'o-1'
                }
            };
        });

        it('should just check that the entity is not deleted if the user is an admin', function() {
            req.requester.permissions.thangs.read = Scope.All;
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted }
            });
            expect(query).toEqual({ type: 'foo' });
        });

        it('should check if the user owns the object if they have Scope.Own', function() {
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $or: [{ user: 'u-1' }]
            });
        });

        it('should check if the org owns the object if they have Scope.Org', function() {
            req.requester.permissions.thangs.read = Scope.Org;
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $or: [{ user: 'u-1' }, { org: 'o-1' }]
            });
        });

        it('should log a warning if the user has an invalid scope', function() {
            req.requester.permissions.thangs.read = 'arghlblarghl';
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $or: [{ user: 'u-1' }]
            });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it('should let users view active objects if allowPublic is true', function() {
            svc._allowPublic = true;
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $or: [{ user: 'u-1' }, { status: Status.Active }]
            });
            req.requester.permissions = {};
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: Status.Active
            });
        });
        
        it('should preserve existing $or clauses', function() {
            req.requester.permissions.thangs.read = Scope.Org;
            query.$or = [ { name: 'foo' }, { advertiserDisplayName: 'foo' } ];
            expect(svc.userPermQuery(query, req)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $and: [
                    { $or: [ { name: 'foo' }, { advertiserDisplayName: 'foo' } ] },
                    { $or: [ { user: 'u-1' }, { org: 'o-1' } ] }
                ]
            });
        });
        
        describe('if handling entities not owned by users', function() {
            beforeEach(function() {
                svc._ownedByUser = false;
                req.user.thang = 't-1';
            });

            it('should just check that the entity is not deleted if the user is an admin', function() {
                req.requester.permissions.thangs.read = Scope.All;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted }
                });
            });
            
            it('should check if the user belongs to the object if they have Scope.Own', function() {
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [ { id: 't-1' } ]
                });
            });

            it('should also check if the org owns the object if they have Scope.Org', function() {
                req.requester.permissions.thangs.read = Scope.Org;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [ { id: 't-1' }, { org: 'o-1' } ]
                });
            });
            
            it('should handle users without a parent object id', function() {
                delete req.user.thang;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [ { id: { $exists: false } } ]
                });
            });
        });

        describe('if the requester is querying by status', function() {
            it('should not overwrite the existing filter', function() {
                query = { status: Status.Active };
                expect(svc.userPermQuery(query, req)).toEqual({
                    status: Status.Active,
                    $or: [{ user: 'u-1' }]
                });

                query = { status: { $in: [Status.Active, Status.Inactive] } };
                expect(svc.userPermQuery(query, req)).toEqual({
                    status: { $in: [Status.Active, Status.Inactive] },
                    $or: [{ user: 'u-1' }]
                });
                expect(mockLog.warn).not.toHaveBeenCalled();
            });

            it('should overwrite the existing filter if the user is querying for just deleted objects', function() {
                query = { status: Status.Deleted };
                expect(svc.userPermQuery(query, req)).toEqual({
                    status: { $ne: Status.Deleted },
                    $or: [{ user: 'u-1' }]
                });
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should trim the existing filter if the user is querying for deleted objects, among other statuses', function() {
                query = { status: { $in: [Status.Active, Status.Deleted] } };
                expect(svc.userPermQuery(query, req)).toEqual({
                    status: { $in: [Status.Active] },
                    $or: [{user: 'u-1' }]
                });
                expect(mockLog.warn).toHaveBeenCalled();
            });
        });
        
        describe('if the request is coming from an app, not a user', function() {
            beforeEach(function() {
                delete req.user;
                req.requester.id = 'app-1';
                req.application = { id: 'app-1', key: 'watchman' };
            });

            it('should still allow access if the requester has Scope.All', function() {
                req.requester.permissions.thangs.read = Scope.All;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted }
                });
            });
            
            it('should not allow access if the requester has Scope.Own or Scope.Org', function() {
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [{ user: '' }]
                });

                req.requester.permissions.thangs.read = Scope.Org;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [{ user: '' }, { org: '' }]
                });
            });
            
            it('should also handle the case where the entities are not owned by users', function() {
                svc._ownedByUser = false;

                req.requester.permissions.thangs.read = Scope.All;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted }
                });

                req.requester.permissions.thangs.read = Scope.Own;
                expect(svc.userPermQuery(query, req)).toEqual({
                    type: 'foo',
                    status: { $ne: Status.Deleted },
                    $or: [{ id: { $exists: false } }]
                });
            });
        });
    });

    describe('formatOutput', function() {
        it('should delete the _id and call unescapeKeys', function() {
            svc.formatOutput.and.callThrough();
            expect(svc.formatOutput({_id: 'mongoId', id: 't1', foo: 'bar'})).toEqual({id: 't1', foo: 'bar'});
            expect(mongoUtils.unescapeKeys).toHaveBeenCalledWith({id: 't1', foo: 'bar'});
        });
    });

    describe('transformMongoDoc(doc)', function() {
        var doc;
        var result;

        beforeEach(function() {
            doc = { foo: 'bar' };
            result = svc.transformMongoDoc(doc);
        });

        it('should return the object passed to it', function() {
            expect(result).toBe(doc);
        });
    });

    describe('setupObj', function() {
        var anyDate;
        beforeEach(function() {
            svc._userProp = false;
            svc._orgProp = false;
            req.body = { foo: 'bar' };
            spyOn(uuid, 'createUuid').and.returnValue('1234567890abcdef');
            anyDate = jasmine.any(Date);
        });

        it('should setup some properties on the object and call next', function() {
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcdef', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(uuid.createUuid).toHaveBeenCalled();
        });

        it('should allow a custom status', function() {
            req.body.status = Status.Pending;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcdef', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Pending});
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should default in the user and org if those props are enabled', function() {
            svc._userProp = true; svc._orgProp = true;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcdef', created: anyDate, foo: 'bar', user: 'u1',
                                      org: 'o1', lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should not default user and org if the request is unauthenticated', function() {
            svc._userProp = true; svc._orgProp = true;
            delete req.user;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcdef', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
        });
    });

    describe('checkExisting', function() {
        var transformedObject;

        beforeEach(function() {
            transformedObject = { tranformed: 'origObject' };
            mongoUtils.findObject.and.returnValue(q('origObject'));
            req.params = { id: 't1' };
            spyOn(svc, 'checkScope').and.returnValue(true);
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObject));
        });

        it('should find an existing object and copy it onto the request', function(done) {
            svc.checkExisting('edit', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(svc.transformMongoDoc).toHaveBeenCalledWith('origObject');
                expect(req.origObj).toBe(transformedObject);
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, { id: 't1' });
                expect(svc.checkScope).toHaveBeenCalledWith(req, transformedObject, 'edit');
                done();
            });
        });

        it('should call done with a 403 if checkScope returns false', function(done) {
            svc.checkScope.and.returnValue(false);
            svc.checkExisting('modify', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Not authorized to modify this'});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 404 if nothing is found', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            svc.checkExisting('edit', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 404, body: 'That does not exist'});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 204 if nothing is found and the action is delete', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            svc.checkExisting('delete', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 204});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if coll.findOne fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.checkExisting('edit', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('validateUniqueProp', function() {
        var transformedObject;

        beforeEach(function() {
            transformedObject = { transformed: { cat: 'yes' } };
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObject));
            mongoUtils.findObject.and.returnValue(q());
            req.body = { name: 'scruffles' };
        });

        it('should call next if no object exists with the request property', function(done) {
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, { name: 'scruffles' });
                done();
            });
        });

        it('should exclude the current object in the mongo search for PUTs', function(done) {
            req.params = {id: 'cat-1'};
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).toHaveBeenCalledWith(mockColl, { name: 'scruffles', id: { $ne: 'cat-1' } });
                done();
            });
        });

        it('should call next if the request body does not contain the field', function(done) {
            svc.validateUniqueProp('fluffy', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if the field is invalid', function(done) {
            q.all(['good cat', 'c@t', 'cat\n', '@#)($*)[['].map(function(name) {
                req.body.name = name;
                return svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            })).then(function(results) {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(4);
                doneSpy.calls.all().forEach(function(call) {
                    expect(call.args).toEqual([{code: 400, body: 'Invalid name'}]);
                });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if an object exists with the request field', function(done) {
            mongoUtils.findObject.and.returnValue(q({ cat: 'yes' }));
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ cat: 'yes' });
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 409, body: 'An object with that name already exists'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo encounters an error', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('CAT IS TOO CUTE HALP'));
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('CAT IS TOO CUTE HALP');
                done();
            });
        });
    });

    describe('getObjs', function() {
        var query, fakeCursor;
        var transformedObj;

        beforeEach(function() {
            transformedObj = { id: 't1', transformed: true };
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObj));
            req.query = { sort: 'id,1', limit: 20, skip: 10 };
            query = {type: 'foo'};
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').and.returnValue(q([{ id: 't1' }])),
                count: jasmine.createSpy('cursor.count').and.returnValue(q(50))
            };
            mockColl.find.and.returnValue(fakeCursor);
            spyOn(svc, 'userPermQuery').and.returnValue('userPermQuery');
            spyOn(svc, 'runAction').and.callThrough();
        });

        it('should format the query and call coll.find', function(done) {
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runAction).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, req);
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: {} });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).toHaveBeenCalledWith(transformedObj);
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ id: 't1' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should work if transformMongoDoc() does not return a promise', function(done) {
            svc.transformMongoDoc.and.returnValue(transformedObj);

            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runAction).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, req);
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: {} });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).toHaveBeenCalledWith(transformedObj);
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ id: 't1' });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should use defaults if some params are not defined', function(done) {
            delete req.query;
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: {}, limit: 0, skip: 0, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: {}, limit: 20, skip: 10, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should ignore the limit param if invalid', function(done) {
            req.query.limit = -123.4;
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 0, skip: 10, fields: {} });

                mockColl.find.calls.reset();
                req.query.limit = { foo: 'bar' };
                return svc.getObjs(query, req, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 0, skip: 10, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should ignore the skip param if invalid', function(done) {
            req.query.skip = -123.4;
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 0, fields: {} });

                mockColl.find.calls.reset();
                req.query.skip = { foo: 'bar' };
                return svc.getObjs(query, req, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 0, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if a maxReadLimit is set for the service', function(done) {
            beforeEach(function() {
                svc.maxReadLimit = 100;
                req.query.limit = 120;
            });
            
            it('should cap the limit param if set', function(done) {
                svc.getObjs(query, req, false).then(function(resp) {
                    expect(resp).toEqual({code: 200, body: 'formatted'});
                    expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', jasmine.objectContaining({ limit: 100 }));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should set the limit param if unset or invalid', function(done) {
                delete req.query.limit;
                svc.getObjs(query, req, false).then(function(resp) {
                    expect(resp).toEqual({code: 200, body: 'formatted'});
                    expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', jasmine.objectContaining({ limit: 100 }));

                    mockColl.find.calls.reset();
                    req.query.limit = -80;
                    return svc.getObjs(query, req, false);
                }).then(function(resp) {
                    expect(resp).toEqual({code: 200, body: 'formatted'});
                    expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', jasmine.objectContaining({ limit: 100 }));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not change the limit if less than the maxReadLimit', function(done) {
                req.query.limit = 80;
                svc.getObjs(query, req, false).then(function(resp) {
                    expect(resp).toEqual({code: 200, body: 'formatted'});
                    expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', jasmine.objectContaining({ limit: 80 }));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        it('should allow specifiying which fields to return', function(done) {
            req.query.fields = 'id,user,data.nest.foo';
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { id: 1, user: 1, 'data.nest.foo': 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should always include the id field', function(done) {
            req.query.fields = 'user,org';
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { id: 1, user: 1, org: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should guard against non-string fields params', function(done) {
            req.query.fields = { foo: 'bar' };
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { '[object Object]': 1, id: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should construct queries with Array values', function(done) {
            query = { type: 'foo', id: ['u-bbe668b7376b76', 'u-c78552acd80e22'] };

            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.userPermQuery).toHaveBeenCalledWith({
                    type: 'foo',
                    id: { $in: ['u-bbe668b7376b76', 'u-c78552acd80e22'] }
                }, req);
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should set resp.pagination if multiExp is true', function(done) {
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: ['formatted'],
                                       headers: { 'content-range': 'items 11-30/50' } });
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: ['formatted'],
                                       headers: { 'content-range': 'items 46-50/50' } });
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('read', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(mockColl.find).not.toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc.use('read', function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockColl.find).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should return a 404 if nothing was found and multiGet is false', function(done) {
            fakeCursor.toArray.and.returnValue(q([]));
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'Object not found'});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing was found and multiGet is true', function(done) {
            fakeCursor.toArray.and.returnValue(q([]));
            fakeCursor.count.and.returnValue(q(0));
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [],
                                       headers: { 'content-range': 'items 0-0/0' } });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.and.returnValue(q.reject('Find Error!'));
            fakeCursor.count.and.returnValue(q.reject('Count Error!'));
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Find Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if cursor.count has an error and multiExp is true', function(done) {
            fakeCursor.toArray.and.returnValue(q.reject('Find Error!'));
            fakeCursor.count.and.returnValue(q.reject('Count Error!'));
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Count Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('createObj', function() {
        var transformedObj;

        beforeEach(function() {
            req.body = { name: 'foo' };
            svc._middleware.create = [jasmine.createSpy('fakeMidware').and.callFake(function(req, next, done) {
                req.body = { id: 't1', setup: true };
                next();
            })];
            transformedObj = { inserted: 'yes', transformed: true };
            spyOn(mongoUtils, 'createObject').and.returnValue(q({ inserted: 'yes' }));
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObj));
            spyOn(svc, 'runAction').and.callThrough();
        });

        it('should setup the new object and insert it', function(done) {
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: 'formatted'});
                expect(svc.runAction).toHaveBeenCalledWith(req, 'create', anyFunc);
                expect(svc._middleware.create[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mongoUtils.createObject).toHaveBeenCalledWith(svc._coll, { id: 't1', setup: true });
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ inserted: 'yes' });
                expect(svc.transformMongoDoc.calls.mostRecent().object).toBe(svc);
                expect(svc.formatOutput).toHaveBeenCalledWith(transformedObj);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc._middleware.create[0].and.callFake(function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(mongoUtils.createObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc.use('create', function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.createObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._middleware.create[0]).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mongoUtils.createObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if inserting the object fails', function(done) {
            mongoUtils.createObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.createObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.createObject).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('editObj', function() {
        var origObj;
        var transformedObj;

        beforeEach(function() {
            req.body = { name: 'foo' };
            req.params = { id: 't1' };
            origObj = { id: 't1', status: Status.Active };
            svc._middleware.edit = [jasmine.createSpy('fakeValidate').and.callFake(function(req, next, done) {
                req.origObj = origObj;
                next();
            })];
            spyOn(mongoUtils, 'editObject').and.returnValue(q({ edited: 'yes' }));
            transformedObj = { edited: 'yes', transformed: true };
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObj));
            spyOn(svc, 'runAction').and.callThrough();
        });

        it('should successfully update an object', function(done) {
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runAction).toHaveBeenCalledWith(req, 'edit', anyFunc);
                expect(svc._middleware.edit[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mongoUtils.editObject).toHaveBeenCalledWith(svc._coll, { name: 'foo' }, 't1');
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ edited: 'yes' });
                expect(svc.transformMongoDoc.calls.mostRecent().object).toBe(svc);
                expect(svc.formatOutput).toHaveBeenCalledWith(transformedObj);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('edit', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc._middleware.edit[0]).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc._middleware.edit[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.editObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._middleware.edit[0]).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if mongoUtils.editObject fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.editObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.editObject).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('deleteObj', function() {
        beforeEach(function() {
            req.params = { id: 't1' };
            svc._middleware.delete = [jasmine.createSpy('fakeMidWare').and.callFake(function(req, next, done) {
                req.origObj = { id: 't1', status: Status.Active };
                next();
            })];
            spyOn(mongoUtils, 'editObject').and.returnValue(q({ edited: 'yes' }));
            spyOn(svc, 'runAction').and.callThrough();
        });

        it('should successfully update an object', function(done) {
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 204});
                expect(svc.runAction).toHaveBeenCalledWith(req, 'delete', anyFunc);
                expect(svc._middleware.delete[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mongoUtils.editObject).toHaveBeenCalledWith(svc._coll, { status: Status.Deleted }, 't1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('delete', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc._middleware.delete[0]).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc._middleware.delete[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._middleware.delete[0]).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if mongoUtils.editObject fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.deleteObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.editObject).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('getSchema', function() {
        beforeEach(function() {
            svc = new CrudSvc(mockColl, 't', {}, {
                name: {
                    __type: 'string',
                    __allowed: false
                },
                isDog: {
                    __type: 'boolean',
                    __allowed: false,
                    __default: true,
                    __locked: true
                },
                paws: {
                    __type: 'number',
                    __allowed: true,
                    __min: 2,
                    __max: 4
                }
            });
            req.requester.permissions = { thangs: { create: 'own' } };
            req.requester.fieldValidation = { thangs: {
                name: {
                    __allowed: true
                },
                isDog: {
                    __allowed: true,
                    __default: false
                },
                paws: {
                    __min: 0,
                    __max: 5
                }
            } };
            req.query = { personalized: 'false' };
        });
        
        it('should return a 403 if the user does not have create or edit permissions', function(done) {
            delete req.requester.permissions.thangs.create;
            svc.getSchema(req).then(function(resp) {
                expect(resp).toEqual({ code: 403, body: 'Cannot create or edit thangs' });
                delete req.requester.permissions.thangs;
                return svc.getSchema(req);
            }).then(function(resp) {
                expect(resp).toEqual({ code: 403, body: 'Cannot create or edit thangs' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 501 if no model is defined', function(done) {
            svc = new CrudSvc(mockColl, 't', {});
            svc.getSchema(req).then(function(resp) {
                expect(resp.code).toEqual(501);
                expect(resp.body).toEqual('No schema for thangs');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the internal schema', function(done) {
            svc.getSchema(req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toBe(svc.model.schema);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    name: {
                        __type: 'string',
                        __allowed: false
                    },
                    isDog: {
                        __type: 'boolean',
                        __allowed: false,
                        __default: true,
                        __locked: true
                    },
                    paws: {
                        __type: 'number',
                        __allowed: true,
                        __min: 2,
                        __max: 4
                    }
                }));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a personalized schema if the personalized query param is set', function(done) {
            req.query.personalized = 'true';
            svc.getSchema(req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).not.toEqual(svc.model.schema);
                expect(resp.body.name).toEqual({ __allowed: true, __type: 'string' });
                expect(resp.body.paws).toEqual({
                    __type: 'number',
                    __allowed: true,
                    __min: 0,
                    __max: 5
                });
                expect(resp.body.isDog).toEqual({
                    __type: 'boolean',
                    __allowed: false,
                    __default: true,
                    __locked: true
                });
                expect(resp.body.id).toEqual(svc.model.schema.id);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });

    describe('customMethod', function() {
        it('should be runAction', function() {
            expect(svc.customMethod).toBe(svc.runAction);
        });
    });
});
