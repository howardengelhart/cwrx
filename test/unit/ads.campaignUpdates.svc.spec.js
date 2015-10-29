var flush = true;
describe('ads-campaignUpdates (UT)', function() {
    var mockLog, CrudSvc, Model, logger, q, updateModule, campaignUtils, requestUtils,
        mongoUtils, nextSpy, doneSpy, errorSpy, req, mockDb;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        updateModule    = require('../../bin/ads-campaignUpdates');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        mongoUtils      = require('../../lib/mongoUtils');
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
        
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        updateModule.config.campaigns = {
            statusDelay: 1000, statusAttempts: 10, campaignTypeId: 454545,
            dateDelays: { start: 100, end: 200 }
        };
        updateModule.config.api = {
            root: 'https://test.com',
            campaigns: {
                baseUrl: 'https://test.com/api/campaigns/',
                endpoint: '/api/campaigns/'
            }
        };
        updateModule.config.emails = {
            supportAddress: 'support@c6.com',
            reviewLink: 'http://selfie.com/campaigns/:campId/admin'
        };
        
        req = {
            uuid: '1234',
            headers: { cookie: 'chocolate' },
            user: { id: 'u-1', email: 'selfie@c6.com' },
            params: {}, query: {}
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var svc, campSvc, fakeCampModel, fakeAutoApproveModel;
        beforeEach(function() {
            var config = JSON.parse(JSON.stringify(updateModule.config));
            updateModule.config = {};
            
            ['fetchCamp', 'validateData', 'extraValidation', 'handleInitialSubmit', 'lockCampaign',
             'unlockCampaign', 'applyUpdate', 'notifyOwner', 'saveRejectionReason'].forEach(function(method) {
                var fn = updateModule[method];
                spyOn(fn, 'bind').and.returnValue(fn);
            });
            spyOn(CrudSvc.prototype.setupObj, 'bind').and.returnValue(CrudSvc.prototype.setupObj);

            fakeCampModel = new Model('campaigns', {}),
            fakeAutoApproveModel = new Model('campaignUpdates', {});
            
            spyOn(updateModule, 'createCampModel').and.returnValue(fakeCampModel);
            spyOn(updateModule, 'createAutoApproveModel').and.returnValue(fakeAutoApproveModel);
            spyOn(fakeAutoApproveModel.midWare, 'bind').and.returnValue(fakeAutoApproveModel.midWare);
            
            campSvc = { model: new Model('campaigns', {}) };
            
            svc = updateModule.setupSvc(mockDb, campSvc, config);
        });
        
        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'campaignUpdates' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('campaignUpdates');
            expect(svc._prefix).toBe('ur');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(updateModule.updateSchema);
        });
        
        //TODO: test autoApprovedSchema????
        
        it('should save some config variables locally', function() {
            expect(updateModule.config.api).toBeDefined();
            expect(updateModule.config.emails).toBeDefined();
            expect(updateModule.config.campaigns).toBeDefined();
        });
        
        it('should enable statusHistory', function() {
            expect(svc._middleware.create).toContain(svc.handleStatusHistory);
            expect(svc._middleware.edit).toContain(svc.handleStatusHistory);
            expect(svc._middleware.delete).toContain(svc.handleStatusHistory);
            expect(svc.model.schema.statusHistory).toBeDefined();
        });
        
        it('should include middleware for create', function() {
            expect(svc._middleware.create).toContain(updateModule.fetchCamp);
            expect(svc._middleware.create).toContain(updateModule.enforceLock);
            expect(svc._middleware.create).toContain(updateModule.validateData);
            expect(svc._middleware.create).toContain(updateModule.extraValidation);
            expect(svc._middleware.create).toContain(updateModule.handleInitialSubmit);
            expect(svc._middleware.create).toContain(updateModule.notifySupport);
            expect(svc._middleware.create).toContain(updateModule.lockCampaign);
        });
        
        it('should include middleware for edit', function() {
            expect(svc._middleware.edit).toContain(updateModule.ignoreCompleted);
            expect(svc._middleware.edit).toContain(updateModule.fetchCamp);
            expect(svc._middleware.edit).toContain(updateModule.requireReason);
            expect(svc._middleware.edit).toContain(updateModule.validateData);
            expect(svc._middleware.edit).toContain(updateModule.extraValidation);
            expect(svc._middleware.edit).toContain(updateModule.unlockCampaign);
            expect(svc._middleware.edit).toContain(updateModule.applyUpdate);
            expect(svc._middleware.edit).toContain(updateModule.notifyOwner);
            expect(svc._middleware.edit).toContain(updateModule.saveRejectionReason);
        });
        
        it('should include middleware for autoApprove', function() {
            expect(svc._middleware.autoApprove).toContain(fakeAutoApproveModel.midWare);
            expect(svc._middleware.autoApprove).toContain(svc.setupObj);
            expect(svc._middleware.autoApprove).toContain(updateModule.fetchCamp);
            expect(svc._middleware.autoApprove).toContain(updateModule.enforceLock);
            expect(svc._middleware.autoApprove).toContain(updateModule.applyUpdate);
        });
        
        it('should bind values into middleware appropriately', function() {
            expect(updateModule.fetchCamp.bind).toHaveBeenCalledWith(updateModule, campSvc);
            expect(updateModule.validateData.bind).toHaveBeenCalledWith(updateModule, fakeCampModel);
            expect(updateModule.extraValidation.bind).toHaveBeenCalledWith(updateModule, fakeCampModel);
            expect(updateModule.handleInitialSubmit.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(updateModule.lockCampaign.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(updateModule.unlockCampaign.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(updateModule.applyUpdate.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(updateModule.notifyOwner.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(updateModule.saveRejectionReason.bind).toHaveBeenCalledWith(updateModule, svc);
            expect(CrudSvc.prototype.setupObj.bind).toHaveBeenCalledWith(svc);
            expect(fakeAutoApproveModel.midWare.bind).toHaveBeenCalledWith(fakeAutoApproveModel, 'create');
        });
    });
    
    describe('campaignUpdate validation', function() { //TODO

    });
    
    describe('createCampModel', function() {
        it('should return a new model with an altered campaign schema', function() {
            var campSvc = { model: new Model('campaigns', campModule.campSchema) };
            var newModel = updateModule.createCampModel(campSvc);
            expect(newModel).toEqual(jasmine.any(Model));
            expect(newModel.objName).toBe('campaigns');
            expect(newModel.schema.status.__allowed).toBe(true);
            expect(campSvc.model.schema.status.__allowed).toBe(false);
            newModel.schema.status.__allowed = false;
            expect(newModel.schema).toEqual(campSvc.model.schema);
        });
    });

    describe('createAutoApproveModel', function() {
        it('should return a new model with an altered campaignUpdate schema', function() {
            var newModel = updateModule.createAutoApproveModel();
            expect(newModel).toEqual(jasmine.any(Model));
            expect(newModel.objName).toBe('campaignUpdates');
            expect(newModel.schema.status.__allowed).toBe(true);
            expect(newModel.schema.autoApproved.__allowed).toBe(true);
            expect(updateModule.updateSchema.status.__allowed).toBe(false);
            expect(updateModule.updateSchema.autoApproved.__allowed).toBe(false);
            newModel.schema.status.__allowed = false;
            newModel.schema.autoApproved.__allowed = false;
            expect(newModel.schema).toEqual(updateModule.updateSchema);
        });
    });
    
    describe('canAutoApprove', function() {
        it('should return true if the paymentMethod is the only thing being changed', function() {
            req.body = { campaign: 'cam-1', data: { paymentMethod: 'infinite money' } };
            expect(updateModule.canAutoApprove(req)).toBe(true);
            req.body.data.foo = 'bar';
            expect(updateModule.canAutoApprove(req)).toBe(false);
            req.body.data = { status: 'active' };
            expect(updateModule.canAutoApprove(req)).toBe(false);
        });
    });

    describe('fetchCamp', function() {
        var campSvc;
        beforeEach(function() {
            campSvc = {
                getObjs: jasmine.createSpy('svc.getObjs()').and.returnValue(q({ code: 200, body: { id: 'cam-1', name: 'camp 1' } }))
            };
            req.params.campId = 'cam-1';
        });
        
        it('should attach the campaign as req.campaign and call next if it is found', function(done) {
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual({ id: 'cam-1', name: 'camp 1' });
                done();
            });
        });
        
        it('should call done if a 4xx is returned', function(done) {
            campSvc.getObjs.and.returnValue(q({ code: 404, body: 'Campaign not found' }));
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 404, body: 'Campaign not found' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if campSvc.getObjs rejects', function(done) {
            campSvc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('enforceLock', function() {
        it('should call next if there is no updateRequest on the object', function(done) {  
            req.campaign = { id: 'cam-1', name: 'camp 1' };
            updateModule.enforceLock(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if there is an updateRequest on the object', function(done) {
            req.campaign = { id: 'cam-1', name: 'camp 1', updateRequest: 'ur-1' };
            updateModule.enforceLock(req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign locked until existing update request resolved' });
                done();
            });
        });
    });

    describe('validateData', function() { //TODO

    });

    describe('extraValidation', function() {
        var model;
        beforeEach(function() {
            req.body = { data: { newCampaign: 'yes' } };
            req.campaign = { oldCampaign: 'yes' };
            spyOn(campaignUtils, 'ensureUniqueIds').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'ensureUniqueNames').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validateAllDates').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validatePricing').and.returnValue({ isValid: true });
            model = new Model('campaigns', {});
        });
        
        it('should call next if all validation passes', function() {
            updateModule.extraValidation(model, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(campaignUtils.ensureUniqueIds).toHaveBeenCalledWith({ newCampaign: 'yes' });
            expect(campaignUtils.ensureUniqueNames).toHaveBeenCalledWith({ newCampaign: 'yes' });
            expect(campaignUtils.validateAllDates).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' }, req.user, { start: 100, end: 200 }, '1234');
            expect(campaignUtils.validatePricing).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' }, req.user, model);
        });
        
        it('should call done if any of the methods fail', function() {
            var methods = ['ensureUniqueIds', 'ensureUniqueNames', 'validateAllDates', 'validatePricing'];
            methods.forEach(function(method) {
                // reset all methods
                methods.forEach(function(meth) { campaignUtils[meth].and.returnValue({ isValid: true }); });
                nextSpy.calls.reset();
                doneSpy.calls.reset();
                
                // change behavior of currently evaluated method
                campaignUtils[method].and.returnValue({ isValid: false, reason: method + ' has failed' });
                
                updateModule.extraValidation(model, req, nextSpy, doneSpy);
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: method + ' has failed' });
            });
        });
    });
    
    describe('handleInitialSubmit', function() { //TODO

    });

    describe('canAutoApprove', function() { //TODO

    });

    describe('notifySupport', function() { //TODO

    });

    describe('lockCampaign', function() { //TODO

    });

    describe('ignoreCompleted', function() { //TODO

    });

    describe('requireReason', function() { //TODO

    });

    describe('unlockCampaign', function() { //TODO

    });

    describe('applyUpdate', function() { //TODO

    });

    describe('notifyOwner', function() { //TODO

    });

    describe('saveRejectionReason', function() { //TODO

    });

    describe('autoApprove', function() { //TODO

    });
});

