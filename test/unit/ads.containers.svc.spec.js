var flush = true;
describe('ads-containers (UT)', function() {
    var mockLog, CrudSvc, Model, Status, logger, q, conModule, nextSpy, doneSpy, errorSpy, req, mockDb;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        conModule       = require('../../bin/ads-containers');
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

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').and.returnValue(CrudSvc.prototype.validateUniqueProp);
            svc = conModule.setupSvc(mockDb);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'containers' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('containers');
            expect(svc._prefix).toBe('con');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(conModule.conSchema);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', /^[\w-]+$/);
        });
        
        it('should copy the name to the defaultData on create and edit', function() {
            expect(svc._middleware.create).toContain(conModule.copyName);
            expect(svc._middleware.edit).toContain(conModule.copyName);
        });
    });
    
    describe('container validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = conModule.setupSvc(mockDb);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { containers: {} } };
        });
        
        describe('when handling name', function() {
            it('should fail if the name is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });
            
            it('should allow the name to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.name).toEqual('test');
            });

            it('should fail if the name is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });
            
            it('should pass if the name was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old container name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.name).toEqual('old container name');
            });

            it('should revert the name if defined on edit', function() {
                origObj.name = 'old container name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.name).toEqual('old container name');
            });
        });
        
        describe('when handling label', function() {
            it('should fail if the field is not a string', function() {
                newObj.label = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'label must be in format: string' });
            });
            
            it('should allow the field to be set', function() {
                newObj.label = 'foo';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.label).toEqual('foo');
            });
        });
        
        describe('when handling defaultData', function() {
            beforeEach(function() {
                newObj.defaultData = {};
                requester.fieldValidation.containers.defaultData = {};
            });

            it('should fail if not an object', function() {
                newObj.defaultData = 'big data big problems';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'defaultData must be in format: object' });
            });
            
            it('should ensure the field is at least set to a default value on create', function() {
                delete newObj.defaultData;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.defaultData).toEqual({});
            });
            
            it('should not allow the field to be unset', function() {
                origObj.defaultData = { big: 'yes' };
                newObj.defaultData = null;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.defaultData).toEqual({ big: 'yes' });
                
                newObj.defaultData = undefined;
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.defaultData).toEqual({ big: 'yes' });
            });
            
            describe('subfield container', function() {
                it('should trim the field if set', function() {
                    newObj.defaultData = { foo: 'bar', container: 'UPS flat rate box' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.defaultData).toEqual({ foo: 'bar' });
                });

                it('should not allow any requesters to set the field', function() {
                    requester.fieldValidation.containers.defaultData.container = { __allowed: true };
                    newObj.defaultData = { foo: 'bar', container: 'UPS flat rate box' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.defaultData).toEqual({ foo: 'bar' });
                });
            });
        });
    });
    
    describe('copyName', function() {
        beforeEach(function() {
            req.body = {
                name: 'heavy duty box',
                defaultData: { foo: 'bar' }
            };
            req.origObj = {
                name: 'small box',
                defaultData: { foo: 'bar', container: 'small box' }
            };
        });
        
        it('should copy the name to defaultData.container', function() {
            conModule.copyName(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(req.body).toEqual({
                name: 'heavy duty box',
                defaultData: { foo: 'bar', container: 'heavy duty box' }
            });
        });
        
        it('should be able to use origObj.name', function() {
            delete req.body.name;
            conModule.copyName(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(req.body).toEqual({
                defaultData: { foo: 'bar', container: 'small box' }
            });
        });
    });
});
