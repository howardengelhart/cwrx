var flush = true;
describe('CrudSvc', function() {
    var q, mockLog, logger, CrudSvc, uuid, mongoUtils, FieldValidator, Model, mockColl, anyFunc,
        req, svc, enums, Scope, Status, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        CrudSvc         = require('../../lib/crudSvc');
        enums           = require('../../lib/enums');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        mongoUtils      = require('../../lib/mongoUtils');
        FieldValidator  = require('../../lib/fieldValidator');
        Model           = require('../../lib/model');
        Scope           = enums.Scope;
        Status          = enums.Status;
        anyFunc = jasmine.any(Function);

        mockColl = {
            collectionName: 'thangs',
            find: jasmine.createSpy('coll.find'),
            findOne: jasmine.createSpy('coll.findOne'),
            insert: jasmine.createSpy('coll.insert'),
            update: jasmine.createSpy('coll.update'),
            findAndModify: jasmine.createSpy('coll.findAndModify'),
        };
        req = { uuid: '1234', user: { id: 'u1', org: 'o1' } };
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
        spyOn(Model.prototype.midWare, 'bind').and.returnValue(Model.prototype.midWare);
        spyOn(FieldValidator.prototype.midWare, 'bind').and.returnValue(FieldValidator.prototype.midWare);
        spyOn(FieldValidator, 'userFunc').and.callThrough();
        spyOn(FieldValidator, 'orgFunc').and.callThrough();
        spyOn(CrudSvc.prototype.checkExisting, 'bind').and.returnValue(CrudSvc.prototype.checkExisting);
        spyOn(CrudSvc.prototype.setupObj, 'bind').and.returnValue(CrudSvc.prototype.setupObj);

        svc = new CrudSvc(mockColl, 't');
        spyOn(svc, 'formatOutput').and.returnValue('formatted');
        spyOn(svc, 'runMiddleware').and.callThrough();

    });

    describe('initialization', function() {
        it('should correctly initialize', function() {
            expect(svc._coll).toBe(mockColl);
            expect(svc._prefix).toBe('t');
            expect(svc.objName).toBe('thangs');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(false);
            expect(svc._parentOfUser).toBe(false);

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
                read: [],
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
                objName: 'bananas', allowPublic: true, parentOfUser: true
            };
            svc = new CrudSvc(mockColl, 't', opts);
            expect(svc.objName).toBe('bananas');
            expect(svc._allowPublic).toBe(true);
            expect(svc._parentOfUser).toBe(true);
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
            expect(svc._middleware.create).toContain(svc.handleStatusHistory);
            expect(svc._middleware.edit).toContain(svc.handleStatusHistory);
            expect(svc._middleware.delete).toContain(svc.handleStatusHistory);
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
    
    describe('singularizeName', function() {
        function createSvc(name) {
            return new CrudSvc({ collectionName: name }, 'x');
        }

        it('should return the singular version of the internal objName', function() {
            expect(createSvc('experiences').singularizeName()).toBe('experience');
            expect(createSvc('cards').singularizeName()).toBe('card');
            expect(createSvc('orgs').singularizeName()).toBe('org');
            expect(createSvc('brownies').singularizeName()).toBe('brownie');
        });
        
        it('should handle nouns with non-standard plurals properly', function() {
            expect(createSvc('categories').singularizeName()).toBe('category');
            expect(createSvc('policies').singularizeName()).toBe('policy');
        });
    });

    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var user = {
                id: 'u-1234', org: 'o-1234',
                permissions: { thangs: { read: Scope.All, edit: Scope.Org, delete: Scope.Own } }
            };
            var thangs = [{ id: 't-1', user: 'u-1234', org: 'o-1234'},
                          { id: 't-2', user: 'u-4567', org: 'o-1234'},
                          { id: 't-3', user: 'u-1234', org: 'o-4567'},
                          { id: 't-4', user: 'u-4567', org: 'o-4567'}];

            expect(thangs.filter(function(thang) {
                return svc.checkScope(user, thang, 'read');
            })).toEqual(thangs);

            expect(thangs.filter(function(thang) {
                return svc.checkScope(user, thang, 'edit');
            })).toEqual([thangs[0], thangs[1], thangs[2]]);

            expect(thangs.filter(function(thang) {
                return svc.checkScope(user, thang, 'delete');
            })).toEqual([thangs[0], thangs[2]]);
        });

        it('should sanity-check the user permissions object', function() {
            var thang = { id: 't-1' };
            expect(svc.checkScope({}, thang, 'read')).toBe(false);
            var user = { id: 'u-1234', org: 'o-1234' };
            expect(svc.checkScope(user, thang, 'read')).toBe(false);
            user.permissions = {};
            expect(svc.checkScope(user, thang, 'read')).toBe(false);
            user.permissions.thangs = {};
            user.permissions.orgs = { read: Scope.All };
            expect(svc.checkScope(user, thang, 'read')).toBe(false);
            user.permissions.thangs.read = '';
            expect(svc.checkScope(user, thang, 'read')).toBe(false);
        });
        
        describe('if parentOfUser is set on the svc', function() {
            var user, thangs;
            beforeEach(function() {
                user = {
                    id: 'u-1',
                    org: 'o-1',
                    thang: 't-1',
                    permissions: { thangs: { read: Scope.All, edit: Scope.Org, delete: Scope.Own } }
                };
                thangs = [
                    { id: 't-1', status: Status.Active, org: 'o-2' },
                    { id: 't-2', status: Status.Active, org: 'o-1' },
                    { id: 't-3', status: Status.Active }
                ];
                svc._parentOfUser = true;
            });
            
            it('should allow users with own/org scope to get entities they belong to', function() {
                // 'all' scope should still work the same
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'read');
                })).toEqual(thangs);
                
                // 'org' scope should get thangs owned by the org + the user's thang
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'edit');
                })).toEqual([thangs[0], thangs[1]]);

                // 'own' scope should only get the user's thang
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'delete');
                })).toEqual([thangs[0]]);
            });

            it('should handle users without a parent object id', function() {
                delete user.thang;
                // 'all' scope should still work the same
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'read');
                })).toEqual(thangs);
                
                // 'org' scope should only get thangs owned by the org
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'edit');
                })).toEqual([thangs[1]]);

                // 'own' scope should get nothing
                expect(thangs.filter(function(thang) {
                    return svc.checkScope(user, thang, 'delete');
                })).toEqual([]);
            });
        });
    });

    describe('userPermQuery', function() {
        var query, user;
        beforeEach(function() {
            query = { type: 'foo' };
            user = { id: 'u-1', org: 'o-1', permissions: { thangs: { read: Scope.Own } } };
        });

        it('should just check that the entity is not deleted if the user is an admin', function() {
            user.permissions.thangs.read = Scope.All;
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted } });
            expect(query).toEqual({type: 'foo'});
        });

        it('should check if the user owns the object if they have Scope.Own', function() {
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [{user: 'u-1'}] });
        });

        it('should check if the org owns the object if they have Scope.Org', function() {
            user.permissions.thangs.read = Scope.Org;
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [{user: 'u-1'}, {org: 'o-1'}] });
        });

        it('should log a warning if the user has an invalid scope', function() {
            user.permissions.thangs.read = 'arghlblarghl';
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [{user: 'u-1'}] });
            expect(mockLog.warn).toHaveBeenCalled();
        });

        it('should let users view active objects if allowPublic is true', function() {
            svc._allowPublic = true;
            expect(svc.userPermQuery(query, user)).toEqual({ type: 'foo', status: { $ne: Status.Deleted },
                                                             $or: [{user: 'u-1'}, {status: Status.Active}] });
            user.permissions = {};
            expect(svc.userPermQuery(query, user)).toEqual({ type: 'foo', status: Status.Active });
        });
        
        it('should preserve existing $or clauses', function() {
            user.permissions.thangs.read = Scope.Org;
            query.$or = [ { name: 'foo' }, { advertiserDisplayName: 'foo' } ];
            expect(svc.userPermQuery(query, user)).toEqual({
                type: 'foo',
                status: { $ne: Status.Deleted },
                $and: [
                    { $or: [ { name: 'foo' }, { advertiserDisplayName: 'foo' } ] },
                    { $or: [ { user: 'u-1' }, { org: 'o-1' } ] }
                ]
            });
        });
        
        describe('if parentOfUser is set on the svc', function() {
            beforeEach(function() {
                svc._parentOfUser = true;
                user.thang = 't-1';
            });

            it('should just check that the entity is not deleted if the user is an admin', function() {
                user.permissions.thangs.read = Scope.All;
                expect(svc.userPermQuery(query, user))
                    .toEqual({ type: 'foo', status: { $ne: Status.Deleted } });
            });
            
            it('should check if the user belongs to the object if they have Scope.Own', function() {
                expect(svc.userPermQuery(query, user))
                    .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [ { id: 't-1' } ] });
            });

            it('should also check if the org owns the object if they have Scope.Org', function() {
                user.permissions.thangs.read = Scope.Org;
                expect(svc.userPermQuery(query, user))
                    .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [ { id: 't-1' }, { org: 'o-1' } ] });
            });
            
            it('should handle users without a parent object id', function() {
                delete user.thang;
                expect(svc.userPermQuery(query, user))
                    .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [ { id: { $exists: false } } ] });
            });
        });

        describe('if the requester is querying by status', function() {
            it('should not overwrite the existing filter', function() {
                query = { status: Status.Active };
                expect(svc.userPermQuery(query, user)).toEqual({ status: Status.Active, $or: [{user: 'u-1'}] });

                query = { status: { $in: [Status.Active, Status.Inactive] } };
                expect(svc.userPermQuery(query, user)).toEqual({ status: { $in: [Status.Active, Status.Inactive] }, $or: [{user: 'u-1'}] });
                expect(mockLog.warn).not.toHaveBeenCalled();
            });

            it('should overwrite the existing filter if the user is querying for deleted objects', function() {
                query = { status: Status.Deleted };
                expect(svc.userPermQuery(query, user)).toEqual({ status: { $ne: Status.Deleted }, $or: [{user: 'u-1'}] });
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should trim the existing filter if the user is querying for deleted objects', function() {
                query = { status: { $in: [Status.Active, Status.Deleted] } };
                expect(svc.userPermQuery(query, user)).toEqual({ status: { $in: [Status.Active] }, $or: [{user: 'u-1'}] });
                expect(mockLog.warn).toHaveBeenCalled();
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
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(uuid.createUuid).toHaveBeenCalled();
        });

        it('should allow a custom status', function() {
            req.body.status = Status.Pending;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Pending});
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should default in the user and org if those props are enabled', function() {
            svc._userProp = true; svc._orgProp = true;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar', user: 'u1',
                                      org: 'o1', lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should not default user and org if the request is unauthenticated', function() {
            svc._userProp = true; svc._orgProp = true;
            delete req.user;
            svc.setupObj(req, nextSpy, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Active});
            expect(nextSpy).toHaveBeenCalledWith();
        });
    });

    describe('handleStatusHistory', function() {
        beforeEach(function() {
            req.body = { foo: 'bar', status: Status.Active };
            req.origObj = {
                status: Status.Pending,
                statusHistory: [{
                    status: Status.Pending,
                    userId: 'u-2',
                    user: 'admin@c6.com',
                    date: new Date()
                }]
            };
            req.user = { id: 'u-1', email: 'foo@bar.com' };
        });

        it('should do nothing if req.body.status is not defined', function() {
            delete req.body.status;
            svc.handleStatusHistory(req, nextSpy, doneSpy);
            expect(req.body.statusHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should do nothing if the status is unchanged', function() {
            req.body.status = Status.Pending;
            svc.handleStatusHistory(req, nextSpy, doneSpy);
            expect(req.body.statusHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should add an entry to the statusHistory', function() {
            svc.handleStatusHistory(req, nextSpy, doneSpy);
            expect(req.body.statusHistory).toEqual([
                { status: Status.Active, userId: 'u-1', user: 'foo@bar.com', date: jasmine.any(Date) },
                { status: Status.Pending, userId: 'u-2', user: 'admin@c6.com', date: jasmine.any(Date) }
            ]);
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should initalize the statusHistory if not defined', function() {
            delete req.origObj;
            svc.handleStatusHistory(req, nextSpy, doneSpy);
            expect(req.body.statusHistory).toEqual([
                { status: Status.Active, userId: 'u-1', user: 'foo@bar.com', date: jasmine.any(Date) }
            ]);
            expect(nextSpy).toHaveBeenCalledWith();
        });

        it('should delete the existing statusHistory off req.body', function() {
            req.body = {
                statusHistory: [{ status: Status.Inactive, userId: 'u-3', user: 'me@c6.com', date: new Date() }]
            };
            svc.handleStatusHistory(req, nextSpy, doneSpy);
            expect(req.body.statusHistory).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalledWith();
        });
    });

    describe('checkExisting', function() {
        var transformedObject;

        beforeEach(function() {
            transformedObject = { tranformed: 'origObject' };
            mockColl.findOne.and.callFake(function(query, cb) { cb(null, 'origObject'); });
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
                expect(mockColl.findOne).toHaveBeenCalledWith({id: 't1'}, anyFunc);
                expect(svc.checkScope).toHaveBeenCalledWith({id: 'u1', org: 'o1'}, transformedObject, 'edit');
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
                expect(mockColl.findOne).toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 404 if nothing is found', function(done) {
            mockColl.findOne.and.callFake(function(query, cb) { cb(); });
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
            mockColl.findOne.and.callFake(function(query, cb) { cb(); });
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
            mockColl.findOne.and.callFake(function(query, cb) { cb('I GOT A PROBLEM'); });
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

    describe('preventGetAll', function() {
        beforeEach(function() {
            req._query = {};
            req.user.permissions = {};
        });

        it('should prevent non-admins from querying with #nofilter', function() {
            svc.preventGetAll(req, nextSpy, doneSpy);
            req.user.permissions.thangs = {};
            svc.preventGetAll(req, nextSpy, doneSpy);
            req.user.permissions.thangs.read = Scope.Own;
            svc.preventGetAll(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(3);
            doneSpy.calls.all().forEach(function(call) {
                expect(call.args).toEqual([{code: 403, body: 'Not authorized to read all thangs'}]);
            });
        });

        it('should allow admins to query with #nofilter', function() {
            req.user.permissions.thangs = { read: Scope.All };
            svc.preventGetAll(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });

        it('should let anyone query with a filter', function() {
            req._query.selfie = 'hawt';
            svc.preventGetAll(req, nextSpy, doneSpy);
            req.user.permissions.thangs = { read: Scope.All };
            svc.preventGetAll(req, nextSpy, doneSpy);
            expect(nextSpy.calls.count()).toBe(2);
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('validateUniqueProp', function() {
        var transformedObject;

        beforeEach(function() {
            transformedObject = { transformed: { cat: 'yes' } };
            spyOn(svc, 'transformMongoDoc').and.returnValue(q(transformedObject));
            mockColl.findOne.and.callFake(function(query, cb) { cb(null, null); });
            req.body = { name: 'scruffles' };
        });

        it('should call next if no object exists with the request property', function(done) {
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(svc.transformMongoDoc).not.toHaveBeenCalled();
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).toHaveBeenCalledWith({name: 'scruffles'}, anyFunc);
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
                expect(mockColl.findOne).toHaveBeenCalledWith({name: 'scruffles', id: {$ne: 'cat-1'}}, anyFunc);
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
                expect(mockColl.findOne).not.toHaveBeenCalled();
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
                expect(mockColl.findOne).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if an object exists with the request field', function(done) {
            mockColl.findOne.and.callFake(function(query, cb) { cb(null, { cat: 'yes' }); });
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
            mockColl.findOne.and.callFake(function(query, cb) { cb('CAT IS TOO CUTE HALP'); });
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

    describe('use', function() {
        it('should push the function onto the appropriate middleware array', function() {
            var foo = function() {}, bar = function() {};
            svc.use('read', foo);
            svc.use('edit', bar);
            expect(svc._middleware).toEqual({
                read: [foo],
                create: [svc.createValidator.midWare, svc.setupObj],
                edit: [svc.checkExisting, svc.editValidator.midWare, bar],
                delete: [svc.checkExisting]
            });
        });

        it('should initialize the array first if it is undefined', function() {
            var foo = function() {};
            svc.use('test', foo);
            expect(svc._middleware.test).toEqual([foo]);
        });
    });

    describe('runMiddleware', function() {
        var mw, req, resolve, reject;
        beforeEach(function() {
            req = 'fakeReq';
            mw = [
                jasmine.createSpy('mw1').and.callFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw2').and.callFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw3').and.callFake(function(req, next, done) { next(); }),
            ];
            svc._middleware.test = mw;
            resolve = jasmine.createSpy('resolved');
            reject = jasmine.createSpy('rejected');
        });

        it('should call a chain of middleware and then call done', function(done) {
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                mw.forEach(function(mwFunc) { expect(mwFunc).toHaveBeenCalledWith(req, anyFunc, anyFunc); });
                expect(svc.runMiddleware.calls.count()).toBe(4);
                expect(svc.runMiddleware.calls.all()[1].args).toEqual([req, 'test', doneSpy, 1, jasmine.any(Object)]);
                expect(svc.runMiddleware.calls.all()[2].args).toEqual([req, 'test', doneSpy, 2, jasmine.any(Object)]);
                expect(svc.runMiddleware.calls.all()[3].args).toEqual([req, 'test', doneSpy, 3, jasmine.any(Object)]);
                done();
            });
        });

        it('should break out and resolve if one of the middleware funcs calls done', function(done) {
            mw[1].and.callFake(function(req, next, done) { done('a response'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(2);
                done();
            });
        });

        it('should only allow next to be called once per middleware func', function(done) {
            mw[1].and.callFake(function(req, next, done) { next(); next(); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(4);
                mw.forEach(function(mwFunc) { expect(mwFunc.calls.count()).toBe(1); });
                expect(doneSpy.calls.count()).toBe(1);
                done();
            });
        });

        it('should only allow done to be called once per middleware func', function(done) {
            mw[1].and.callFake(function(req, next, done) { done('a response'); done('poop'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(resolve.calls.count()).toBe(1);
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(2);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs throws an error', function(done) {
            mw[2].and.callFake(function(req, next, done) { throw new Error('Catch this!'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith(new Error('Catch this!'));
                expect(svc.runMiddleware.calls.count()).toBe(3);
                done();
            });
        });

        it('should handle the case where there is no middleware', function(done) {
            svc.runMiddleware(req, 'fake', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(1);
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
                toArray: jasmine.createSpy('cursor.toArray').and.callFake(function(cb) { cb(null, [{id: 't1'}]); }),
                count: jasmine.createSpy('cursor.count').and.callFake(function(cb) { cb(null, 50); })
            };
            mockColl.find.and.returnValue(fakeCursor);
            spyOn(svc, 'userPermQuery').and.returnValue('userPermQuery');
        });

        it('should format the query and call coll.find', function(done) {
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(1);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, { id: 'u1', org: 'o1' });
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
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(1);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, { id: 'u1', org: 'o1' });
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
            req = { uuid: '1234', user: 'fakeUser' };
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
                }, { id: 'u1', org: 'o1' });
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
            fakeCursor.toArray.and.callFake(function(cb) { cb(null, []); });
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
            fakeCursor.toArray.and.callFake(function(cb) { cb(null, []); });
            fakeCursor.count.and.callFake(function(cb) { cb(null, 0); });
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
            fakeCursor.toArray.and.callFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.and.callFake(function(cb) { cb('Count Error!'); });
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
            fakeCursor.toArray.and.callFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.and.callFake(function(cb) { cb('Count Error!'); });
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
        });

        it('should setup the new object and insert it', function(done) {
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'create', anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(1);
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
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
        });

        it('should successfully update an object', function(done) {
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'edit', anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if coll.findAndModify fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.editObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
        });

        it('should successfully update an object', function(done) {
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 204});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'delete', anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
                expect(svc.runMiddleware.calls.count()).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if coll.update fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.deleteObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.calls.count()).toBe(2);
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
            req.user.permissions = { thangs: { create: 'own' } };
            req.user.fieldValidation = { thangs: {
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
            delete req.user.permissions.thangs.create;
            svc.getSchema(req).then(function(resp) {
                expect(resp).toEqual({ code: 403, body: 'Cannot create or edit thangs' });
                delete req.user.permissions.thangs;
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
        var cb;
        beforeEach(function() {
            svc._middleware.foo = [jasmine.createSpy('fakeMidware').and.callFake(function(req, next, done) {
                req.myProp = 'myVal';
                next();
            })];
            cb = jasmine.createSpy('cb').and.callFake(function() {
                return q(req.myProp + ' - updated');
            });
        });

        it('should run a custom middleware stack and then call a callback', function(done) {
            svc.customMethod(req, 'foo', cb).then(function(resp) {
                expect(resp).toBe('myVal - updated');
                expect(svc._middleware.foo[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(svc.runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should still resolve if there is no middleware for the custom action', function(done) {
            svc.customMethod(req, 'bar', cb).then(function(resp) {
                expect(resp).toBe('undefined - updated');
                expect(svc._middleware.foo[0]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.calls.count()).toBe(1);
                expect(cb).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call the callback if a middleware function breaks out early', function(done) {
            svc.use('foo', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.customMethod(req, 'foo', cb).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'NOPE' });
                expect(svc.runMiddleware.calls.count()).toBe(2);
                expect(cb).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call the callback if a middleware function rejects', function(done) {
            svc.use('foo', function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.customMethod(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.calls.count()).toBe(2);
                expect(cb).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the callback rejects', function(done) {
            cb.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.customMethod(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the callback throws an error', function(done) {
            cb.and.callFake(function() { throw new Error('I GOT A PROBLEM'); });
            svc.customMethod(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
            }).done(done);
        });
    });
});
