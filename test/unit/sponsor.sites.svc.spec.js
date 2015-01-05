var flush = true;
describe('sponsor-sites (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, siteModule, FieldValidator, mockClient,
        nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        siteModule      = require('../../bin/sponsor-sites');
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
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockClient = {client: 'yes'};
        delete require.cache[require.resolve('adtech/lib/website')];
        adtech = require('adtech');
        adtech.websiteAdmin = require('adtech/lib/website');
        Object.keys(adtech.websiteAdmin).forEach(function(prop) {
            if (typeof adtech.websiteAdmin[prop] !== 'function') {
                return;
            }
            adtech.websiteAdmin[prop] = adtech.websiteAdmin[prop].bind(adtech.websiteAdmin, mockClient);
            spyOn(adtech.websiteAdmin, prop).andCallThrough();
        });
    });

    describe('setupSvc', function() {
        it('should setup the site service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').andReturn(CrudSvc.prototype.validateUniqueProp);
            spyOn(FieldValidator, 'orgFunc').andCallThrough();
            var mockColl = { collectionName: 'sites' },
                svc = siteModule.setupSvc(mockColl);

            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('sites', 'create');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('sites', 'edit');
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'host', /^([\w-]+\.)+[\w-]+$/);

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('s');
            expect(svc.objName).toBe('sites');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toBe(mockColl);
            expect(svc.createValidator._required).toContain('host', 'name');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc.createValidator._formats.containers).toEqual(['object']);
            expect(svc.editValidator._formats.containers).toEqual(['object']);
            expect(svc.createValidator._condForbidden.org).toEqual(jasmine.any(Function));
            expect(svc.editValidator._condForbidden.org).toEqual(jasmine.any(Function));
            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(svc._middleware.create).toContain(CrudSvc.prototype.validateUniqueProp,
                siteModule.createAdtechSite, siteModule.createPlacements);
            expect(svc._middleware.edit).toContain(CrudSvc.prototype.validateUniqueProp,
                siteModule.cleanPlacements, siteModule.editAdtechSite, siteModule.createPlacements);
            expect(svc._middleware.delete).toContain(siteModule.deleteAdtechSite);
        });
    });
    
    describe('formatAdtechSite', function() {
        it('should format a site for saving to adtech', function() {
            expect(siteModule.formatAdtechSite({id: 's-1', name: 'site 1', host: 'foo.com'}))
                .toEqual({ URL: 'foo.com', extId: 's-1', name: 'site 1' });
        });

        it('should set the adtechId if defined', function() {
            expect(siteModule.formatAdtechSite({id: 's-1', adtechId: 123, name: 'site 1', host: 'foo.com'}))
                .toEqual({ URL: 'foo.com', extId: 's-1', id: 123, name: 'site 1' });
        });
    });
    
    describe('cleanPlacements', function() {
        beforeEach(function() {
            req.origObj = {id: 's-1', containers: [
                {type: 'a', contentPlacementId: 123, displayPlacementId: 234},
                {type: 'b', displayPlacementId: 345},
                {type: 'c', displayPlacementId: 456, contentPlacementId: 567},
            ]};
            req.body = { id: 's-1', containers: [{type: 'c'}, {type: 'd'}] };
            adtech.websiteAdmin.deletePlacement.andReturn(q());
        });
        
        it('should skip if the new or original site has no containers property defined', function(done) {
            [{origObj: {id: 's-1'}, body: req.body}, {origObj: req.origObj, body: {id: 's-1'}}]
            .map(function(newReq) {
                siteModule.cleanPlacements(newReq, nextSpy, doneSpy).catch(errorSpy);
            });
            process.nextTick(function() {
                expect(nextSpy.calls.length).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.websiteAdmin.deletePlacement).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should delete old placements not set in the new site', function(done) {
            siteModule.cleanPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.websiteAdmin.deletePlacement.calls.length).toBe(3);
                expect(adtech.websiteAdmin.deletePlacement).toHaveBeenCalledWith(123);
                expect(adtech.websiteAdmin.deletePlacement).toHaveBeenCalledWith(234);
                expect(adtech.websiteAdmin.deletePlacement).toHaveBeenCalledWith(345);
                done();
            });
        });
        
        it('should do nothing if there are no containers in the old site', function(done) {
            req.origObj.containers = [];
            siteModule.cleanPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.websiteAdmin.deletePlacement).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle placements that still have active campaigns', function(done) {
            adtech.websiteAdmin.deletePlacement.andCallFake(function(id) {
                if (id === 345) return q();
                else return q.reject({root: {Envelope: {Body: {Fault: {faultstring: 
                    'Placement deletion cannot be performed because 1 campaign(s) run on the affected placement'}}}}});
            });
            siteModule.cleanPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'Cannot delete in-use placements'});
                expect(doneSpy.calls.length).toBe(1);
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(adtech.websiteAdmin.deletePlacement.calls.length).toBe(3);
                done();
            });
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.websiteAdmin.deletePlacement.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.cleanPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(errorSpy.calls.length).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('createPlacements', function() {
        beforeEach(function() {
            req.origObj = { id: 's-1', adtechId: 123, pageId: 234, containers: [] };
            req.body = { id: 's-1', containers: [{type: 'a'}, {type: 'b'}] };
            adtech.websiteAdmin.createPlacement.andCallFake(function(placement) {
                return q({id: this.createPlacement.calls.length*100});
            });
        });
        
        it('should create a batch of banners', function(done) {
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([
                    { type: 'a', contentPlacementId: 100, displayPlacementId: 200 },
                    { type: 'b', contentPlacementId: 300, displayPlacementId: 400 }
                ]);
                expect(adtech.websiteAdmin.createPlacement.calls.length).toBe(4);
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'a_display', pageId: 234, websiteId: 123});
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'a_content', pageId: 234, websiteId: 123});
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'b_display', pageId: 234, websiteId: 123});
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'b_content', pageId: 234, websiteId: 123});
                done();
            });
        });
        
        it('should only create placements if their ids are missing', function(done) {
            req.body.containers = [{type: 'a', contentPlacementId: 321}];
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([{type: 'a', displayPlacementId: 100, contentPlacementId: 321}]);
                expect(adtech.websiteAdmin.createPlacement.calls.length).toBe(1);
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'a_display', pageId: 234, websiteId: 123});
                done();
            });
        });
        
        it('should not recreate placements that already exist', function(done) {
            req.origObj.containers = [{type: 'a', displayPlacementId: 321}];
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([
                    { type: 'a', contentPlacementId: 100, displayPlacementId: 321 },
                    { type: 'b', contentPlacementId: 200, displayPlacementId: 300 }
                ]);
                expect(adtech.websiteAdmin.createPlacement.calls.length).toBe(3);
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'a_content', pageId: 234, websiteId: 123});
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'b_display', pageId: 234, websiteId: 123});
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'b_content', pageId: 234, websiteId: 123});
                done();
            });
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.websiteAdmin.createPlacement.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(errorSpy.calls.length).toBe(1);
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('createAdtechSite', function() {
        beforeEach(function() {
            req.body = { id: 's-1', host: 'foo.com', name: 'site 1' };
            adtech.websiteAdmin.createWebsite.andReturn(q({id: 123}));
            adtech.websiteAdmin.createPage.andReturn(q({id: 456}));
        });
        
        it('should create a website and page', function(done) {
            siteModule.createAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({id: 's-1', host: 'foo.com', name: 'site 1', adtechId: 123, pageId: 456});
                expect(adtech.websiteAdmin.createWebsite).toHaveBeenCalledWith({URL: 'foo.com', extId: 's-1', name: 'site 1'});
                expect(adtech.websiteAdmin.createPage).toHaveBeenCalledWith({name: 'Default', websiteId: 123});
                done();
            });
        });
        
        it('should reject if creating the website fails', function(done) {
            adtech.websiteAdmin.createWebsite.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.createAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.body).toEqual({id: 's-1', host: 'foo.com', name: 'site 1'});
                expect(adtech.websiteAdmin.createPage).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if creating the page fails', function(done) {
            adtech.websiteAdmin.createPage.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.createAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.body).toEqual({id: 's-1', host: 'foo.com', name: 'site 1', adtechId: 123});
                done();
            });
        });
    });
    
    describe('editAdtechSite', function() {
        beforeEach(function() {
            req.origObj = { id: 's-1', host: 'foo.com', name: 'old name', adtechId: 123 };
            req.body = { id: 's-1', host: 'bar.com', name: 'new name' };
            adtech.websiteAdmin.updateWebsite.andReturn(q({id: 123}));
        });
        
        it('should edit a website in adtech', function(done) {
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({id: 's-1', host: 'bar.com', name: 'new name'});
                expect(adtech.websiteAdmin.updateWebsite).toHaveBeenCalledWith(
                    {URL: 'bar.com', extId: 's-1', id: 123, name: 'new name'});
                done();
            });
        });

        it('should do nothing if the name and url are not defined in the request', function(done) {
            req.body = { id: 's-1', containers: [{type: 'a'}] };
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ id: 's-1', containers: [{type: 'a'}] });
                expect(adtech.websiteAdmin.updateWebsite).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should do nothing if the name and url are unchanged', function(done) {
            req.body = { id: 's-1', host: 'foo.com', name: 'old name' };
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ id: 's-1', host: 'foo.com', name: 'old name' });
                expect(adtech.websiteAdmin.updateWebsite).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if updating the website fails', function(done) {
            adtech.websiteAdmin.updateWebsite.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('deleteAdtechSite', function() {
        beforeEach(function() {
            req.origObj = { id: 's-1', host: 'foo.com', name: 'site 1', adtechId: 123 };
            adtech.websiteAdmin.deleteWebsite.andReturn(q());
        });
        
        it('should delete a website from adtech', function(done) {
            siteModule.deleteAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.websiteAdmin.deleteWebsite).toHaveBeenCalledWith(123);
                done();
            });
        });
        
        it('should log a warning if the original object has no adtechId', function(done) {
            delete req.origObj.adtechId;
            siteModule.deleteAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(adtech.websiteAdmin.deleteWebsite).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle websites that still have active campaigns', function(done) {
            adtech.websiteAdmin.deleteWebsite.andReturn(q.reject({root: {Envelope: {Body: {Fault: {faultstring:
                'Website deletion cannot be performed because 1 campaign(s) run on one or more of the affected placements'}}}}}));

            siteModule.deleteAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'Cannot delete in-use placements'});
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.websiteAdmin.deleteWebsite.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.deleteAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
});

