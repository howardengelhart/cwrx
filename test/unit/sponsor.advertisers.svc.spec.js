var flush = true;
describe('sponsor-advertisers (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, mockClient, nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        advertModule    = require('../../bin/sponsor-advertisers');
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
        delete require.cache[require.resolve('adtech/lib/customer')];
        adtech = require('adtech');
        adtech.customerAdmin = require('adtech/lib/customer');
        Object.keys(adtech.customerAdmin).forEach(function(prop) {
            if (typeof adtech.customerAdmin[prop] !== 'function') {
                return;
            }
            adtech.customerAdmin[prop] = adtech.customerAdmin[prop].bind(adtech.customerAdmin, mockClient);
            spyOn(adtech.customerAdmin, prop).andCallThrough();
        });
    });

    describe('setupSvc', function() {
        it('should setup the advertiser service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            var mockColl = { collectionName: 'advertisers' },
                svc = advertModule.setupSvc(mockColl);

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('a');
            expect(svc.objName).toBe('advertisers');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toBe(mockColl);
            expect(svc.createValidator._required).toContain('name');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(svc._middleware.create).toContain(advertModule.createAdtechAdvert);
            expect(svc._middleware.edit).toContain(advertModule.editAdtechAdvert);
            expect(svc._middleware.delete).toContain(advertModule.deleteAdtechAdvert);
        });
    });
    
    describe('formatAdtechAdvert', function() {
        it('should create a new record if there is no original', function() {
            var record = advertModule.formatAdtechAdvert({id: 'a-1', name: 'testy'});
            expect(record).toEqual({ companyData: { address: {}, url: 'http://cinema6.com' },
                                     extId: 'a-1', name: 'testy' });
        });
        
        it('should modify the original record, if there is one', function() {
            var orig = {
                archiveDate: new Date(),
                apples: null,
                companyData: { address: {}, url: 'http://cinema6.com' },
                contacts: [{email: 'test@foo.com', firstName: 'Johnny', lastName: 'Testmonkey'}],
                extId: 'a-1',
                id: 123,
                name: 'old name'
            };
            var record = advertModule.formatAdtechAdvert({id: 'a-1', name: 'testy'}, orig);
            expect(record).toEqual({
                companyData: { address: {}, url: 'http://cinema6.com' },
                contacts: { Items: {
                    attributes: { 'xmlns:cm' : 'http://systinet.com/wsdl/de/adtech/helios/UserManagement/' },
                    Item: [{
                        attributes: { 'xsi:type': 'cm:ContactData' },
                        email: 'test@foo.com',
                        firstName: 'Johnny',
                        lastName: 'Testmonkey'
                    }]
                } },
                extId: 'a-1',
                id: 123,
                name: 'testy'
            });
        });
    });
    
    describe('createAdtechAdvert', function() {
        beforeEach(function() {
            req.body = { id: 'a-1', name: 'testy' };
            adtech.customerAdmin.createAdvertiser.andReturn(q({id: 123}));
        });
        
        it('should create a new advertiser in adtech', function(done) {
            advertModule.createAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.adtechId).toBe(123);
                expect(adtech.customerAdmin.createAdvertiser).toHaveBeenCalledWith({
                    companyData: {address: {}, url: 'http://cinema6.com'}, extId: 'a-1', name: 'testy'});
                done();
            });
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.customerAdmin.createAdvertiser.andReturn(q.reject('I GOT A PROBLEM'));
            advertModule.createAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(req.body.adtechId).not.toBeDefined();
                done();
            });
        });
    });

    describe('editAdtechAdvert', function() {
        beforeEach(function() {
            req.body = { name: 'new name' };
            req.origObj = { id: 'a-1', name: 'testy', adtechId: 123 };
            adtech.customerAdmin.getAdvertiserById.andReturn(q({old: true, id: 123}));
            adtech.customerAdmin.updateAdvertiser.andReturn(q({id: 123}));
            spyOn(advertModule, 'formatAdtechAdvert').andReturn({formatted: true});
        });

        it('should edit an advertiser in adtech', function(done) {
            advertModule.editAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getAdvertiserById).toHaveBeenCalledWith(123);
                expect(advertModule.formatAdtechAdvert).toHaveBeenCalledWith({name: 'new name'}, {old: true, id: 123});
                expect(adtech.customerAdmin.updateAdvertiser).toHaveBeenCalledWith({formatted: true});
                done();
            });
        });
    
        it('should do nothing if the name is unchanged', function(done) {
            req.body.name = 'testy';
            advertModule.editAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getAdvertiserById).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.updateAdvertiser).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if finding the existing advertiser fails', function(done) {
            adtech.customerAdmin.getAdvertiserById.andReturn(q.reject('I GOT A PROBLEM'));
            advertModule.editAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(adtech.customerAdmin.getAdvertiserById).toHaveBeenCalled();
                expect(adtech.customerAdmin.updateAdvertiser).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if updating the advertiser fails', function(done) {
            adtech.customerAdmin.updateAdvertiser.andReturn(q.reject('I GOT A PROBLEM'));
            advertModule.editAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(adtech.customerAdmin.getAdvertiserById).toHaveBeenCalled();
                expect(adtech.customerAdmin.updateAdvertiser).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('deleteAdtechAdvert', function() {
        beforeEach(function() {
            req.origObj = { id: 'a-1', name: 'testy', adtechId: 123 };
            adtech.customerAdmin.deleteAdvertiser.andReturn(q());
        });
        
        it('should delete an advertiser in adtech', function(done) {
            advertModule.deleteAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.deleteAdvertiser).toHaveBeenCalledWith(123);
                done();
            });
        });
        
        it('should log a warning if the original object has no adtechId', function(done) {
            delete req.origObj.adtechId;
            advertModule.deleteAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(adtech.customerAdmin.deleteAdvertiser).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.customerAdmin.deleteAdvertiser.andReturn(q.reject('I GOT A PROBLEM'));
            advertModule.deleteAdtechAdvert(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                done();
            });
        });
    });
});
