var flush = true;
describe('ads-sites (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, siteModule, FieldValidator, mockClient,
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
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockClient = {client: 'yes'};
        delete require.cache[require.resolve('adtech/lib/website')];
        delete require.cache[require.resolve('adtech/lib/customer')];
        adtech = require('adtech');
        adtech.websiteAdmin = require('adtech/lib/website');
        adtech.customerAdmin = require('adtech/lib/customer');
        ['websiteAdmin', 'customerAdmin'].forEach(function(admin) {
            Object.keys(adtech[admin]).forEach(function(prop) {
                if (typeof adtech[admin][prop] !== 'function') {
                    return;
                }
                adtech[admin][prop] = adtech[admin][prop].bind(adtech[admin], mockClient);
                spyOn(adtech[admin], prop).andCallThrough();
            });
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
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);

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

            expect(svc._middleware.read).toEqual([svc.preventGetAll]);
            expect(svc._middleware.create).toEqual([jasmine.any(Function), jasmine.any(Function),
                CrudSvc.prototype.validateUniqueProp, CrudSvc.prototype.validateUniqueProp,
                siteModule.validateContainers, siteModule.createAdtechSite, siteModule.createPlacements]);
            expect(svc._middleware.edit).toEqual([jasmine.any(Function), jasmine.any(Function),
                CrudSvc.prototype.validateUniqueProp, CrudSvc.prototype.validateUniqueProp,
                siteModule.validateContainers, siteModule.cleanPlacements, siteModule.createPlacements,
                siteModule.editAdtechSite]);
            expect(svc._middleware.delete).toEqual([jasmine.any(Function), siteModule.deleteAdtechSite]);
        });
    });
    
    describe('formatAdtechSite', function() {
        it('should create a new record if there is no original', function() {
            expect(siteModule.formatAdtechSite({id: 's-1', name: 'site 1', host: 'foo.com'}))
                .toEqual({URL: 'http://foo.com', contact: {email: 'ops@cinema6.com'}, extId: 's-1', name: 'site 1'});
        });
        
        it('should modify the original record if there is one', function() {
            var now = new Date();
            var orig = {
                URL: 'http://foo.com',
                archiveDate: now,
                assignedUsers: ['1234'],
                apples: null,
                contact: { firstName: 'Johnny', lastName: 'Testmonkey' },
                extId: 's-1',
                id: 123,
                name: 'site 1',
                pageList: [{
                    id: 456,
                    name: 'Default',
                    placementList: [{id: 987, name: 'content'}, {id: 876, name: 'display'}]
                }]
            };
            
            expect(siteModule.formatAdtechSite({name: 'site 1.1'}, orig)).toEqual({
                URL: 'http://foo.com', archiveDate: now.toISOString(),
                assignedUsers: { Items: {
                    attributes: { 'xmlns:cm': 'http://www.w3.org/2001/XMLSchema' },
                    Item: [{ attributes: { 'xsi:type': 'cm:long' }, $value: '1234' }]
                } },
                contact: { firstName: 'Johnny', lastName: 'Testmonkey' },
                extId: 's-1', id: 123, name: 'site 1.1',
                pageList: { Items: {
                    attributes: { 'xmlns:cm': 'http://systinet.com/wsdl/de/adtech/helios/WebsiteManagement/' },
                    Item: [{
                        attributes: { 'xsi:type': 'cm:Page' },
                        id: 456, name: 'Default',
                        placementList: { Items: {
                            attributes: { 'xmlns:cm': 'http://systinet.com/wsdl/de/adtech/helios/WebsiteManagement/' },
                            Item: [
                                { attributes: { 'xsi:type': 'cm:Placement' }, id: 987, name: 'content' },
                                { attributes: { 'xsi:type': 'cm:Placement' }, id: 876, name: 'display' },
                            ]
                        } }
                    }]
                } }
            });
        });
        
        it('should not set list properties if not defined on the original', function() {
            var orig = { URL: 'http://foo.com', extId: 's-1', id: 123, name: 'site 1' };
            
            expect(siteModule.formatAdtechSite({host: 'bar.foo.com'}, orig)).toEqual({
                URL: 'http://bar.foo.com', extId: 's-1', id: 123, name: 'site 1'
            });
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
                expect(doneSpy.calls.length).toBe(1);
                expect(doneSpy).toHaveBeenCalledWith({code: 400, body: 'All containers must have an id'});
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('cleanPlacements', function() {
        beforeEach(function() {
            req.origObj = {id: 's-1', containers: [
                {id: 'a', contentPlacementId: 123, displayPlacementId: 234},
                {id: 'b', displayPlacementId: 345},
                {id: 'c', displayPlacementId: 456, contentPlacementId: 567},
            ]};
            req.body = { id: 's-1', containers: [{id: 'c'}, {id: 'd'}] };
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
            req.body = { id: 's-1', containers: [{id: 'a'}, {id: 'b'}] };
            adtech.websiteAdmin.createPlacement.andCallFake(function(placement) {
                return q({id: this.createPlacement.calls.length*100});
            });
        });
        
        it('should skip if there is no containers property', function(done) {
            delete req.body.containers;
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).not.toBeDefined();
                expect(adtech.websiteAdmin.createPlacement).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should create a batch of banners', function(done) {
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([
                    { id: 'a', contentPlacementId: 100, displayPlacementId: 200 },
                    { id: 'b', contentPlacementId: 300, displayPlacementId: 400 }
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
            req.body.containers = [{id: 'a', contentPlacementId: 321}];
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([{id: 'a', displayPlacementId: 100, contentPlacementId: 321}]);
                expect(adtech.websiteAdmin.createPlacement.calls.length).toBe(1);
                expect(adtech.websiteAdmin.createPlacement).toHaveBeenCalledWith({name: 'a_display', pageId: 234, websiteId: 123});
                done();
            });
        });
        
        it('should not recreate placements that already exist', function(done) {
            req.origObj.containers = [{id: 'a', displayPlacementId: 321}];
            siteModule.createPlacements(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.containers).toEqual([
                    { id: 'a', contentPlacementId: 100, displayPlacementId: 321 },
                    { id: 'b', contentPlacementId: 200, displayPlacementId: 300 }
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
                expect(adtech.websiteAdmin.createWebsite).toHaveBeenCalledWith(
                    {URL: 'http://foo.com', contact: {email: 'ops@cinema6.com'}, extId: 's-1', name: 'site 1'});
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
            adtech.websiteAdmin.getWebsiteById.andReturn(q({id: 123, extId: 's-1'}));
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
                    {URL: 'http://bar.com', extId: 's-1', id: 123, name: 'new name'});
                done();
            });
        });

        it('should do nothing if the name and url are not defined in the request', function(done) {
            req.body = { id: 's-1', containers: [{id: 'a'}] };
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({ id: 's-1', containers: [{id: 'a'}] });
                expect(adtech.websiteAdmin.updateWebsite).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should do nothing if there is no adtechId on the original object', function(done) {
            delete req.origObj.adtechId;
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({id: 's-1', host: 'bar.com', name: 'new name'});
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

        it('should reject if finding the existing website fails', function(done) {
            adtech.websiteAdmin.getWebsiteById.andReturn(q.reject('I GOT A PROBLEM'));
            siteModule.editAdtechSite(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
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

