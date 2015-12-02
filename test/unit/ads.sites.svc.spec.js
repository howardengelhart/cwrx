var flush = true;
describe('ads-sites (UT)', function() {
    var mockLog, CrudSvc, logger, q, siteModule, FieldValidator,
        nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        siteModule      = require('../../bin/ads-sites');
        FieldValidator  = require('../../lib/fieldValidator');
        CrudSvc         = require('../../lib/crudSvc');

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
        it('should setup the site service', function() {
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').and.returnValue(CrudSvc.prototype.validateUniqueProp);
            spyOn(FieldValidator, 'orgFunc').and.callThrough();
            var mockColl = { collectionName: 'sites' },
                svc = siteModule.setupSvc(mockColl);

            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('sites', 'create');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('sites', 'edit');
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'host', /^([\w-]+\.)+[\w-]+$/);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('s');
            expect(svc.objName).toBe('sites');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toBe(mockColl);
            expect(svc.createValidator._required).toContain('host');
            expect(svc.createValidator._required).toContain('name');
            expect(svc.createValidator._formats.containers).toEqual(['object']);
            expect(svc.editValidator._formats.containers).toEqual(['object']);
            expect(svc.createValidator._condForbidden.org).toEqual(jasmine.any(Function));
            expect(svc.editValidator._condForbidden.org).toEqual(jasmine.any(Function));

            expect(svc._middleware.create).toEqual([jasmine.any(Function), jasmine.any(Function),
                CrudSvc.prototype.validateUniqueProp, CrudSvc.prototype.validateUniqueProp,
                siteModule.validateContainers]);
            expect(svc._middleware.edit).toEqual([jasmine.any(Function), jasmine.any(Function),
                CrudSvc.prototype.validateUniqueProp, CrudSvc.prototype.validateUniqueProp,
                siteModule.validateContainers]);
        });
    });
    
    describe('validateContainers', function() {
        it('should do nothing if there are no containers', function(done) {
            req.body = { name: 'site 1' };
            siteModule.validateContainers(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({name: 'site 1'});
                done();
            });
        });
        
        it('should call next if all the containers are valid', function(done) {
            req.body = { containers: [{id: 'a', type: 'a'}, {id: 'a_1'}, {id: 'b', type: 'a'}] };
            siteModule.validateContainers(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if not all containers have an id', function(done) {
            req.body = { containers: [{id: 'a', type: 'a'}, {id: 'a_1'}, {type: 'a'}] };
            siteModule.validateContainers(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'All containers must have an id'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 400 if not all ids are unique', function(done) {
            req.body = { containers: [{id: 'a', type: 'a'}, {id: 'a_1'}, {id: 'a', type: 'b'}] };
            siteModule.validateContainers(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'Container ids must be unique'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should only call done once', function(done) {
            req.body = { containers: [{id: 'a', type: 'a'}, {type: 'a_1'}, {id: 'a', type: 'b'}] };
            siteModule.validateContainers(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(1);
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'All containers must have an id'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
});

