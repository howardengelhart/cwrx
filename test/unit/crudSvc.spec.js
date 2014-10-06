var flush = true;
describe('CrudSvc', function() {
    var q, mockLog, logger, CrudSvc, enums, uuid, mongoUtils, FieldValidator, mockColl, anyFunc,
        req, svc;
    
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
        req = { uuid: '1234', user: { id: 'u1' } };

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
        
        svc = new CrudSvc(mockColl, 't');
        spyOn(svc, 'formatOutput').andReturn('formatted');
        spyOn(svc, 'runMiddleware').andCallThrough();
    });

    describe('initialization', function() {
        it('should correctly initialize', function() {
            expect(svc._coll).toBe(mockColl);
            expect(svc._prefix).toBe('t');
            expect(svc.objName).toBe('thangs');
            expect(svc.createValidator instanceof FieldValidator).toBe(true);
            expect(svc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(svc.editValidator instanceof FieldValidator).toBe(true);
            expect(svc.editValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(svc._middleware).toEqual({
                read: [],
                create: [svc.createValidator.midWare],
                edit: [svc.checkExisting, svc.editValidator.midWare],
                delete: [svc.checkExisting]
            });
            expect(svc.createValidator.midWare.bind).toHaveBeenCalledWith(svc.createValidator);
            expect(svc.editValidator.midWare.bind).toHaveBeenCalledWith(svc.editValidator);
            expect(svc.checkExisting.bind).toHaveBeenCalledWith(svc, 'edit');
            expect(svc.checkExisting.bind).toHaveBeenCalledWith(svc, 'delete');
        });
        
        it('should allow overriding the objName', function() {
            svc = new CrudSvc(mockColl, 't', 'bananas');
            expect(svc.objName).toBe('bananas');
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
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, user: 'u-1' });
        });
        
        it('should check if the org owns the object if they have Scope.Org', function() {
            user.permissions.thangs.read = Scope.Org;
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, $or: [{org: 'o-1'}, {user: 'u-1'}] });
        });
        
        it('should log a warning if the user has an invalid scope', function() {
            user.permissions.thangs.read = 'arghlblarghl';
            expect(svc.userPermQuery(query, user))
                .toEqual({ type: 'foo', status: { $ne: Status.Deleted }, user: 'u-1' });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('formatOutput', function() {
        it('should delete the _id and call unescapeKeys', function() {
            svc.formatOutput.andCallThrough();
            expect(svc.formatOutput({_id: 'mongoId', id: 't1', foo: 'bar'})).toEqual({id: 't1', foo: 'bar'});
            expect(mongoUtils.unescapeKeys).toHaveBeenCalledWith({id: 't1', foo: 'bar'});
        });
    });
    
    describe('setupObject', function() {
        //TODO
    });
    
    describe('_checkExisting', function() {
        //TODO
    });
    
    describe('use', function() {
        it('should push the function onto the appropriate middleware array', function() {
            var foo = function() {}, bar = function() {};
            svc.use('read', foo);
            svc.use('edit', bar);
            expect(svc._middleware).toEqual({
                read: [foo], create: [anyFunc], edit: [anyFunc, anyFunc, bar], delete: [anyFunc]
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
                expect(resp).toEqual({code: 200, body: ['formatted']});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'read', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(svc.userPermQuery).toHaveBeenCalledWith({ type: 'foo' }, { id: 'u1' });
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: { id: 1 }, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(svc.formatOutput).toHaveBeenCalledWith({id: 't1'}, 0, [{id: 't1'}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: ['formatted']});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            svc.getObjs(query, req, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: ['formatted']});
                expect(mockColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
                
        it('should set resp.pagination if multiExp is true', function(done) {
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({code: 200, body: ['formatted'], pagination: {start: 11, end: 30, total: 50}});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({code: 200, body: ['formatted'], pagination: {start: 46, end: 50, total: 50}});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc.use('read', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(mockColl.find).not.toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should not call mongo if a middleware function rejects', function(done) {
            svc.use('read', function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockColl.find).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            svc.getObjs(query, req, true).then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'No thangs found', pagination: {start: 0, end: 0, total: 0}});
                expect(resp.body).toEqual('No thangs found');
                expect(resp.pagination).toEqual({start: 0, end: 0, total: 0});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(svc.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
        });
    });
    
    describe('createObj', function() {
        beforeEach(function() {
            req.body = { name: 'foo' };
            svc._middleware.create[0] = jasmine.createSpy('fakeValidate')
                                       .andCallFake(function(req, next, done) { next(); });
            spyOn(svc, 'setupObj').andReturn({ id: 't1', setup: true });
            mockColl.insert.andCallFake(function(obj, opts, cb) { cb(); });
        });
        
        it('should setup the new object and insert it', function(done) {
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 201, body: 'formatted'});
                expect(svc.runMiddleware).toHaveBeenCalledWith(req, 'create', anyFunc);
                expect(svc.runMiddleware.callCount).toBe(2);
                expect(svc._middleware.create[0]).toHaveBeenCalledWith(req, anyFunc, anyFunc);
                expect(svc.setupObj).toHaveBeenCalledWith(req);
                expect(mockColl.insert).toHaveBeenCalledWith({id:'t1',setup:true},{w:1,journal:true},anyFunc);
                expect(svc.formatOutput).toHaveBeenCalledWith({ id: 't1', setup: true });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not call mongo if a middleware function breaks out early', function(done) {
            svc._middleware.create[0].andCallFake(function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.createObj(req).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'NOPE'});
                expect(svc.runMiddleware.callCount).toBe(1);
                expect(svc.setupObj).not.toHaveBeenCalled();
                expect(mockColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
        });
    });
    
    describe('editObj', function() {
        beforeEach(function() {
            req.body = { name: 'foo' };
            req.params = { id: 't1' };
            svc._middleware.edit = [jasmine.createSpy('fakeValidate')
                                    .andCallFake(function(req, next, done) { next(); })];
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
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
        });
    });
    
    describe('deleteObj', function() {
        beforeEach(function() {
            req.params = { id: 't1' };
            svc._middleware.delete = [jasmine.createSpy('fakeMidWare')
                                      .andCallFake(function(req, next, done) { next(); })];
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
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
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
            }).finally(done);
        });
    });
});

