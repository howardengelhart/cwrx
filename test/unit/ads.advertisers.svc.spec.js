var flush = true;
describe('ads-advertisers (UT)', function() {
    var mockLog, CrudSvc, Model, logger, q, advertModule, nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        advertModule    = require('../../bin/ads-advertisers');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');

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
    });

    describe('setupSvc', function() {
        var svc, mockColl;
        beforeEach(function() {
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').and.returnValue(CrudSvc.prototype.validateUniqueProp);
            mockColl = { collectionName: 'advertisers' };
            svc = advertModule.setupSvc(mockColl);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'advertisers' });
            expect(svc.objName).toBe('advertisers');
            expect(svc._prefix).toBe('a');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(advertModule.advertSchema);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);
        });
    });
    
    describe('advertiser validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = advertModule.setupSvc({ collectionName: 'advertisers' });
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { advertisers: {} } };
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
        
        ['defaultLinks', 'defaultLogos'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not an object', function() {
                    newObj[field] = 123;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: object' });
                });
                
                it('should allow the field to be set', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual({ foo: 'bar' });
                });
            });
        });
    });
});
