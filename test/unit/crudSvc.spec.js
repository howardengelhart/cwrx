var flush = true;
describe('CrudSvc', function() {
    var q, mockLog, logger, CrudSvc, uuid, mongoUtils, FieldValidator, mockColl, anyFunc,
        req, svc, enums, Scope, Status;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        CrudSvc         = require('../../lib/crudSvc');
        enums           = require('../../lib/enums');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        mongoUtils      = require('../../lib/mongoUtils');
        FieldValidator  = require('../../lib/fieldValidator');
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
        spyOn(FieldValidator.prototype.midWare, 'bind').andReturn(FieldValidator.prototype.midWare);
        spyOn(CrudSvc.prototype.checkExisting, 'bind').andReturn(CrudSvc.prototype.checkExisting);
        spyOn(CrudSvc.prototype.setupObj, 'bind').andReturn(CrudSvc.prototype.setupObj);
        
        svc = new CrudSvc(mockColl, 't');
        spyOn(svc, 'formatOutput').andReturn('formatted');
        spyOn(svc, 'runMiddleware').andCallThrough();
        
    });

    describe('initialization', function() {
        it('should correctly initialize', function() {
            expect(svc._coll).toBe(mockColl);
            expect(svc._prefix).toBe('t');
            expect(svc.objName).toBe('thangs');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(false);
            expect(svc.createValidator instanceof FieldValidator).toBe(true);
            expect(svc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(svc.editValidator instanceof FieldValidator).toBe(true);
            expect(svc.editValidator._forbidden).toEqual(['id', 'created', '_id']);
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
        
        it('should allow setting various options', function() {
            var opts = {
                objName: 'bananas', userProp: false, orgProp: false, allowPublic: true,
            };
            svc = new CrudSvc(mockColl, 't', opts);
            expect(svc.objName).toBe('bananas');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(true);
            svc = new CrudSvc(mockColl, 't', {orgProp: false});
            expect(svc.objName).toBe('thangs');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
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
    });
    
    describe('userPermQuery', function() {
        var query, user;
        beforeEach(function() {
            query = { type: 'foo' };
            user = { id: 'u-1', org: 'o-1', permissions: { thangs: { read: Scope.Own } } };
        });
        
        it('should just check that the experience is not deleted if the user is an admin', function() {
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
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [{org: 'o-1'}, {user: 'u-1'}] });
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
    });
    
    describe('formatOutput', function() {
        it('should delete the _id and call unescapeKeys', function() {
            svc.formatOutput.andCallThrough();
            expect(svc.formatOutput({_id: 'mongoId', id: 't1', foo: 'bar'})).toEqual({id: 't1', foo: 'bar'});
            expect(mongoUtils.unescapeKeys).toHaveBeenCalledWith({id: 't1', foo: 'bar'});
        });
    });
    
    describe('setupObj', function() {
        var next, doneSpy, anyDate;
        beforeEach(function() {
            svc._userProp = false;
            svc._orgProp = false;
            req.body = { foo: 'bar' };
            req.user.permissions = { thangs: { create: Scope.Org } };
            next = jasmine.createSpy('next spy');
            doneSpy = jasmine.createSpy('done spy');
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdef');
            anyDate = jasmine.any(Date);
        });
        
        it('should setup some properties on the object and call next', function() {
            svc.setupObj(req, next, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Active});
            expect(next).toHaveBeenCalledWith();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(uuid.createUuid).toHaveBeenCalled();
            expect(mongoUtils.escapeKeys).toHaveBeenCalledWith(req.body);
        });
        
        it('should allow overriding the status', function() {
            req.body.status = Status.Pending;
            svc.setupObj(req, next, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar',
                                      lastUpdated: anyDate, status: Status.Pending});
            expect(next).toHaveBeenCalledWith();
        });
        
        it('should default in the user and org if those props are enabled', function() {
            svc._userProp = true; svc._orgProp = true;
            svc.setupObj(req, next, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, foo: 'bar', user: 'u1',
                                      org: 'o1', lastUpdated: anyDate, status: Status.Active});
            expect(next).toHaveBeenCalledWith();
        });
        
        it('should return a 403 if a non-admin is creating an object for a different user/org', function() {
            svc._userProp = true; svc._orgProp = true;
            req.body = { user: 'u2' };
            svc.setupObj(req, next, doneSpy);
            expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Not authorized to create objects for another user'});
            req.body = { org: 'o2' };
            svc.setupObj(req, next, doneSpy);
            expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Not authorized to create objects for another org'});
            expect(next).not.toHaveBeenCalled();
        });
        
        it('should allow an admin to create an object for a different user/org', function() {
            svc._userProp = true; svc._orgProp = true;
            req.user.permissions.thangs.create = Scope.All;
            req.body = { user: 'u2' };
            svc.setupObj(req, next, doneSpy);
            expect(next).toHaveBeenCalledWith();
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, user: 'u2',
                                      org: 'o1', lastUpdated: anyDate, status: Status.Active});
            req.body = { org: 'o2' };
            svc.setupObj(req, next, doneSpy);
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, user: 'u1',
                                      org: 'o2', lastUpdated: anyDate, status: Status.Active});
            expect(next.callCount).toBe(2);
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('shouldn\'t pay attention to the user and org props if they are disabled', function() {
            req.body = { user: 'u2', org: 'o2' };
            svc.setupObj(req, next, doneSpy);
            expect(next).toHaveBeenCalledWith();
            expect(req.body).toEqual({id: 't-1234567890abcd', created: anyDate, user: 'u2',
                                      org: 'o2', lastUpdated: anyDate, status: Status.Active});
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });
    
    describe('checkExisting', function() {
        var next, doneSpy, reject;
        beforeEach(function() {
            mockColl.findOne.andCallFake(function(query, cb) { cb(null, 'origObject'); });
            req.params = { id: 't1' };
            spyOn(svc, 'checkScope').andReturn(true);
            next = jasmine.createSpy('next spy');
            reject = jasmine.createSpy('rejected');
            doneSpy = jasmine.createSpy('done spy');
        });
        
        it('should find an existing object and copy it onto the request', function(done) {
            svc.checkExisting('edit', req, next, doneSpy).catch(reject);
            process.nextTick(function() {
                expect(next).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(req.origObj).toBe('origObject');
                expect(mockColl.findOne).toHaveBeenCalledWith({id: 't1'}, anyFunc);
                expect(svc.checkScope).toHaveBeenCalledWith({id: 'u1', org: 'o1'}, 'origObject', 'edit');
                done();
            });
        });
        
        it('should call done with a 403 if checkScope returns false', function(done) {
            svc.checkScope.andReturn(false);
            svc.checkExisting('modify', req, next, doneSpy).catch(reject);
            process.nextTick(function() {
                expect(next).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 403, body: 'Not authorized to modify this'});
                expect(reject).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(mockColl.findOne).toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 404 if nothing is found', function(done) {
            mockColl.findOne.andCallFake(function(query, cb) { cb(); });
            svc.checkExisting('edit', req, next, doneSpy).catch(reject);
            process.nextTick(function() {
                expect(next).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 404, body: 'That does not exist'});
                expect(reject).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 204 if nothing is found and the action is delete', function(done) {
            mockColl.findOne.andCallFake(function(query, cb) { cb(); });
            svc.checkExisting('delete', req, next, doneSpy).catch(reject);
            process.nextTick(function() {
                expect(next).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 204});
                expect(reject).not.toHaveBeenCalled();
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if coll.findOne fails', function(done) {
            mockColl.findOne.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
            svc.checkExisting('edit', req, next, doneSpy).catch(reject);
            process.nextTick(function() {
                expect(next).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(req.origObj).not.toBeDefined();
                expect(svc.checkScope).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('preventGetAll', function() {
        var req, nextSpy, doneSpy;
        beforeEach(function() {
            req = { uuid: '1234', _query: {}, user: { id: 'u1', permissions: {} } };
            nextSpy = jasmine.createSpy('next');
            doneSpy = jasmine.createSpy('done');
        });

        it('should prevent non-admins from querying with #nofilter', function() {
            svc.preventGetAll(req, nextSpy, doneSpy);
            req.user.permissions.thangs = {};
            svc.preventGetAll(req, nextSpy, doneSpy);
            req.user.permissions.thangs.read = Scope.Own;
            svc.preventGetAll(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.length).toBe(3);
            doneSpy.calls.forEach(function(call) {
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
            expect(nextSpy.calls.length).toBe(2);
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('validateUniqueProp', function() {
        var req, nextSpy, doneSpy, catchSpy;
        beforeEach(function() {
            mockColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            req = { uuid: '1234', user: { id: 'u1' }, body: { name: 'scruffles' } };
            nextSpy = jasmine.createSpy('next');
            doneSpy = jasmine.createSpy('done');
            catchSpy = jasmine.createSpy('errorCatcher');
        });
        
        it('should call next if no object exists with the request property', function(done) {
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).toHaveBeenCalledWith({name: 'scruffles'}, anyFunc);
                done();
            });
        });
        
        it('should exclude the current object in the mongo search for PUTs', function(done) {
            req.params = {id: 'cat-1'};
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).toHaveBeenCalledWith({name: 'scruffles', id: {$ne: 'cat-1'}}, anyFunc);
                done();
            });
        });
        
        it('should call next if the request body does not contain the field', function(done) {
            svc.validateUniqueProp('fluffy', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if the field is invalid', function(done) {
            q.all(['good cat', 'c@t', 'cat\n', '@#)($*)[['].map(function(name) {
                req.body.name = name;
                return svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            })).then(function(results) {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.length).toBe(4);
                doneSpy.calls.forEach(function(call) {
                    expect(call.args).toEqual([{code: 400, body: 'Invalid name'}]);
                });
                expect(catchSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if an object exists with the request field', function(done) {
            mockColl.findOne.andCallFake(function(query, cb) { cb(null, { cat: 'yes' }); });
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 409, body: 'An object with that name already exists'});
                expect(catchSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if mongo encounters an error', function(done) {
            mockColl.findOne.andCallFake(function(query, cb) { cb('CAT IS TOO CUTE HALP'); });
            svc.validateUniqueProp('name', /^\w+$/, req, nextSpy, doneSpy).catch(catchSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(catchSpy).toHaveBeenCalledWith('CAT IS TOO CUTE HALP');
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
        var mw, req, resolve, reject, doneSpy;
        beforeEach(function() {
            req = 'fakeReq';
            mw = [
                jasmine.createSpy('mw1').andCallFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw2').andCallFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw3').andCallFake(function(req, next, done) { next(); }),
            ];
            svc._middleware.test = mw;
            resolve = jasmine.createSpy('resolved');
            reject = jasmine.createSpy('rejected');
            doneSpy = jasmine.createSpy('done');
        });
        
        it('should call a chain of middleware and then call done', function(done) {
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                mw.forEach(function(mwFunc) { expect(mwFunc).toHaveBeenCalledWith(req, anyFunc, anyFunc); });
                expect(svc.runMiddleware.callCount).toBe(4);
                expect(svc.runMiddleware.calls[1].args).toEqual([req, 'test', doneSpy, 1, jasmine.any(Object)]);
                expect(svc.runMiddleware.calls[2].args).toEqual([req, 'test', doneSpy, 2, jasmine.any(Object)]);
                expect(svc.runMiddleware.calls[3].args).toEqual([req, 'test', doneSpy, 3, jasmine.any(Object)]);
                done();
            });
        });
        
        it('should break out and resolve if one of the middleware funcs calls done', function(done) {
            mw[1].andCallFake(function(req, next, done) { done('a response'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(2);
                done();
            });
        });
        
        it('should only allow next to be called once per middleware func', function(done) {
            mw[1].andCallFake(function(req, next, done) { next(); next(); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(4);
                mw.forEach(function(mwFunc) { expect(mwFunc.calls.length).toBe(1); });
                expect(doneSpy.calls.length).toBe(1);
                done();
            });
        });
        
        it('should only allow done to be called once per middleware func', function(done) {
            mw[1].andCallFake(function(req, next, done) { done('a response'); done('poop'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(resolve.calls.length).toBe(1);
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(2);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].andCallFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].andCallFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs throws an error', function(done) {
            mw[2].andCallFake(function(req, next, done) { throw new Error('Catch this!'); });
            svc.runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith(new Error('Catch this!'));
                expect(svc.runMiddleware.callCount).toBe(3);
                done();
            });
        });
        
        it('should handle the case where there is no middleware', function(done) {
            svc.runMiddleware(req, 'fake', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(1);
                done();
            });
        });
    });
    
    describe('getObjs', function() {
        var query, fakeCursor;
        beforeEach(function() {
            req.query = { sort: 'id,1', limit: 20, skip: 10 };
            query = {type: 'foo'};
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) { cb(null, [{id: 't1'}]); }),
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) { cb(null, 50); })
            };
            mockColl.find.andReturn(fakeCursor);
            spyOn(svc, 'userPermQuery').andReturn('userPermQuery');
        });
        
        it('should format the query and call coll.find', function(done) {
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, { id: 'u1', org: 'o1' });
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: { id: 1 }, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).toHaveBeenCalledWith({id: 't1'}, 0, [{id: 't1'}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
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
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'Object not found'});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 200 and [] if nothing was found and multiGet is true', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [],
                                       headers: { 'content-range': 'items 0-0/0' } });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
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
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
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
        beforeEach(function() {
            req.body = { name: 'foo' };
            svc._middleware.create = [jasmine.createSpy('fakeMidware').andCallFake(function(req, next, done) {
                req.body = { id: 't1', setup: true };
                next();
            })];
            spyOn(svc, 'setupObj').andReturn({ id: 't1', setup: true });
            mockColl.insert.andCallFake(function(obj, opts, cb) { cb(); });
        });
        
        it('should setup the new object and insert it', function(done) {
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'create', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(svc._middleware.create[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mockColl.insert).toHaveBeenCalledWith({id:'t1',setup:true},{w:1,journal:true},anyFunc);
                expect(svc.formatOutput).toHaveBeenCalledWith({ id: 't1', setup: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc._middleware.create[0].andCallFake(function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(mockColl.insert).not.toHaveBeenCalled();
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
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.insert).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if coll.insert fails', function(done) {
            mockColl.insert.andCallFake(function(obj, opts, cb) { cb('I GOT A PROBLEM'); });
            svc.createObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.insert).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('editObj', function() {
        var origObj;
        beforeEach(function() {
            req.body = { name: 'foo' };
            req.params = { id: 't1' };
            origObj = { id: 't1', status: Status.Active };
            svc._middleware.edit = [jasmine.createSpy('fakeValidate').andCallFake(function(req, next, done) {
                req.origObj = origObj;
                next();
            })];
            mockColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) { cb(null, [{id: 't1', updated: true}]); });
        });
        
        it('should successfully update an object', function(done) {
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'edit', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(svc._middleware.edit[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mongoUtils.escapeKeys).toHaveBeenCalledWith({name: 'foo', lastUpdated: jasmine.any(Date)});
                expect(mockColl.findAndModify).toHaveBeenCalledWith({id: 't1'}, {id: 1},
                    {$set: {lastUpdated: jasmine.any(Date), name: 'foo'}},{w:1,journal:true,new:true},anyFunc);
                expect(svc.formatOutput).toHaveBeenCalledWith({ id: 't1', updated: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not call mongo if the original object was deleted', function(done) {
            origObj.status = Status.Deleted;
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'That does not exist'});
                expect(svc._middleware.edit[0]).toHaveBeenCalled();
                expect(mockColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('edit', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.editObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc._middleware.edit[0]).toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc._middleware.edit[0].andCallFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.editObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._middleware.edit[0]).toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.findAndModify).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if coll.findAndModify fails', function(done) {
            mockColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) { cb('I GOT A PROBLEM'); });
            svc.editObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.findAndModify).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('deleteObj', function() {
        beforeEach(function() {
            req.params = { id: 't1' };
            svc._middleware.delete = [jasmine.createSpy('fakeMidWare').andCallFake(function(req, next, done) {
                req.origObj = { id: 't1', status: Status.Active };
                next();
            })];
            mockColl.update.andCallFake(function(query, obj, opts, cb) { cb(); });
        });
        
        it('should successfully update an object', function(done) {
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 204});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'delete', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(svc._middleware.delete[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(mockColl.update).toHaveBeenCalledWith({id: 't1'},
                    {$set: {lastUpdated: jasmine.any(Date), status: Status.Deleted}},{w:1,journal:true},anyFunc);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update the object if it is already deleted', function(done) {
            svc._middleware.delete[0].andCallFake(function(req, next, done) {
                req.origObj = { id: 't1', status: Status.Deleted };
                next();
            });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 204});
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockColl.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('delete', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc._middleware.delete[0]).toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockColl.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc._middleware.delete[0].andCallFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._middleware.delete[0]).toHaveBeenCalled();
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.update).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if coll.update fails', function(done) {
            mockColl.update.andCallFake(function(query, obj, opts, cb) { cb('I GOT A PROBLEM'); });
            svc.deleteObj(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockColl.update).toHaveBeenCalled();
            }).done(done);
        });
    });
});
