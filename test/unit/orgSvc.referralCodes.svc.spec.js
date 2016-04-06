var flush = true;
describe('orgSvc-referralCodes (UT)', function() {
    var refModule, q, mockLog, logger, CrudSvc, Model, mockDb, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        refModule       = require('../../bin/orgSvc-referralCodes');
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

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
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
            svc = refModule.setupSvc(mockDb);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'referralCodes' });
            expect(svc.objName).toBe('referralCodes');
            expect(svc._prefix).toBe('ref');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(refModule.refSchema);
        });
        
        it('should generate a code on create', function() {
            expect(svc._middleware.create).toContain(refModule.generateCode);
        });
    });
    
    describe('referralCode validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = refModule.setupSvc(mockDb);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { referralCodes: {} } };
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
                origObj.name = 'old name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old name' });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });
        });

        describe('when handling clientId', function() {
            it('should fail if the field is not a string', function() {
                newObj.clientId = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'clientId must be in format: string' });
            });
            
            it('should allow the field to be set', function() {
                newObj.clientId = 'boris';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.clientId).toEqual('boris');
            });
        });
        
        describe('when handling code', function() {
            it('should not allow anyone to set the field', function() {
                requester.fieldValidation.referralCodes.code = { __allowed: true };
                newObj.code = 'beepboop';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });
        });
    });
    
    describe('counter', function() {
        it('should be a random integer between 0 and 1296', function() {
            expect(refModule.counter).toBeGreaterThan(-1);
            expect(refModule.counter).toBeLessThan(1296);
        });
    });

    describe('generateCode', function() {
        beforeEach(function() {
            refModule.counter = 100;
            req.body = { name: 'foo' };
        });
        
        it('should generate a 10-character code', function() {
            refModule.generateCode(req, nextSpy, doneSpy);
            expect(req.body.code).toMatch(/^\w{8}2s/);
            expect(nextSpy).toHaveBeenCalled();
        });
        
        it('should use the counter to ensure two codes produced at the same time are different', function() {
            var req1 = { body: { name: 'foo' } }, req2 = { body: { name: 'bar' } };
            refModule.generateCode(req1, nextSpy, doneSpy);
            refModule.generateCode(req2, nextSpy, doneSpy);

            expect(req1.body.code).toMatch(/^\w{8}2s/);
            expect(req2.body.code).toMatch(/^\w{8}2t/);
        });
        
        it('should appropriately cycle the counter', function() {
            refModule.counter = 1295;
            refModule.generateCode(req, nextSpy, doneSpy);
            expect(req.body.code).toMatch(/^\w{8}zz/);
            expect(refModule.counter).toEqual(0);
        });
    });
});
