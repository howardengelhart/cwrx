var flush = true;
describe('ads-customers (UT)', function() {
    var mockLog, CrudSvc, logger, q, custModule, Status, mockDb, nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        custModule      = require('../../bin/ads-customers');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        Status          = require('../../lib/enums').Status;

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

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
    });

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            [CrudSvc.prototype.validateUniqueProp, custModule.validateAdvertisers].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });
            svc = custModule.setupSvc(mockDb);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'customers' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('customers');
            expect(svc._prefix).toBe('cu');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._parentOfUser).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(custModule.custSchema);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);
        });

        it('should validate the advertisers on create and edit', function() {
            expect(svc._middleware.create).toContain(custModule.validateAdvertisers);
            expect(svc._middleware.edit).toContain(custModule.validateAdvertisers);
            expect(custModule.validateAdvertisers.bind).toHaveBeenCalledWith(custModule, svc);
        });
    });
    
    describe('customer validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = custModule.setupSvc(mockDb);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { customers: {} } };
        });
        
        describe('when handling name', function() {
            it('should fail if the field is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old org name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old org name' });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });
        });
        
        describe('when handling advertisers', function() {
            it('should fail if the field is not a string array', function() {
                newObj.advertisers = 'a-1';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'advertisers must be in format: stringArray' });
                    
                newObj.advertisers = [{ id: 'a-1' }, { id: 'a-2' }];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'advertisers must be in format: stringArray' });
            });
            
            it('should allow the field to be set', function() {
                newObj.advertisers = ['a-1', 'a-2'];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.advertisers).toEqual(['a-1', 'a-2']);
            });
        });
    });
    
    describe('validateAdvertisers', function() {
        var svc, advertisers, mockColl;
        beforeEach(function() {
            svc = custModule.setupSvc(mockDb);
            advertisers = [
                { id: 'a-1', name: 'a-1' },
                { id: 'a-2', name: 'a-2' },
                { id: 'a-3', name: 'a-3' }
            ];
            mockColl = {
                find: jasmine.createSpy('coll.find()').and.callFake(function() {
                    return {
                        toArray: function(cb) {
                            cb(null, advertisers);
                        }
                    };
                })
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { advertisers: ['a-1', 'a-2', 'a-3'] };
        });
        
        it('should call next if all advertisers on the request body exist', function(done) {
            custModule.validateAdvertisers(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('advertisers');
                expect(mockColl.find).toHaveBeenCalledWith(
                    { id: { $in: ['a-1', 'a-2', 'a-3'] }, status: { $ne: Status.Deleted } },
                    { fields: { id: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if there are no advertisers on the request body', function(done) {
            delete req.body.advertisers;
            custModule.validateAdvertisers(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all advertisers are found', function(done) {
            req.body.advertisers.push('a-4', 'a-5');
            custModule.validateAdvertisers(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'These advertisers were not found: [a-4,a-5]' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalledWith(
                    { id: { $in: ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'] }, status: { $ne: Status.Deleted } },
                    { fields: { id: 1 } }
                );
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            mockColl.find.and.returnValue({ toArray: function(cb) { cb('I GOT A PROBLEM'); } });
            custModule.validateAdvertisers(svc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockColl.find).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});

