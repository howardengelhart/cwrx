var flush = true;
var q = require('q');

describe('ads-campaignUpdates (UT)', function() {
    var mockLog, CrudSvc, Model, logger, updateModule, campaignUtils, requestUtils, Status, objUtils,
        historian, mongoUtils, campModule, email, nextSpy, doneSpy, errorSpy, req, mockDb, appCreds, streamUtils;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        logger          = require('../../lib/logger');
        updateModule    = require('../../bin/ads-campaignUpdates');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        requestUtils    = require('../../lib/requestUtils');
        streamUtils     = require('../../lib/streamUtils');
        mongoUtils      = require('../../lib/mongoUtils');
        historian       = require('../../lib/historian');
        objUtils        = require('../../lib/objUtils');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        email           = require('../../lib/email');
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
        
        updateModule.config.api = {
            root: 'https://test.com',
            cards: {
                baseUrl: 'https://test.com/api/content/cards/',
                endpoint: '/api/content/cards/'
            },
            experiences: {
                baseUrl: 'https://test.com/api/content/experiences/',
                endpoint: '/api/content/experiences/'
            },
            campaigns: {
                baseUrl: 'https://test.com/api/campaigns/',
                endpoint: '/api/campaigns/'
            },
            creditCheck: {
                baseUrl: 'https://test.com/api/accounting/credit-check/',
                endpoint: '/api/accounting/credit-check/'
            },
            zipcodes: {
                baseUrl: 'https://test.com/api/geo/zipcodes/',
                endpoint: '/api/geo/zipcodes/'
            }
        };
        updateModule.config.emails = {
            sender: 'no-reply@c6.com',
            supportAddress: 'support@c6.com',
            reviewLink: 'http://selfie.com/campaigns/:campId/admin',
            dashboardLink: 'http://seflie.c6.com/review/campaigns',
            enabled: true
        };
        updateModule.config.kinesis = {
            streamName: 'utStream',
            region: 'narnia'
        };
        appCreds = {
            key: 'ads-service',
            secret: 'supersecret'
        };
        
        req = {
            uuid: '1234',
            headers: { cookie: 'chocolate' },
            requester: { id: 'u-1', permissions: {} },
            user: { id: 'u-1', email: 'selfie@c6.com' },
            params: {}, query: {}
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });
    
    describe('setupSvc', function() {
        var config, svc, campSvc, fakeCampModel, fakeAutoApproveModel, histMidware, mockProducer, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

        beforeEach(function() {
            config = JSON.parse(JSON.stringify(updateModule.config));
            updateModule.config = {};

            fakeCampModel = new Model('campaigns', {});
            fakeAutoApproveModel = new Model('campaignUpdates', {});
            
            spyOn(updateModule, 'createCampModel').and.returnValue(fakeCampModel);
            spyOn(updateModule, 'createAutoApproveModel').and.returnValue(fakeAutoApproveModel);
            
            histMidware = jasmine.createSpy('handleStatHist');
            spyOn(historian, 'middlewarify').and.returnValue(histMidware);
            
            boundFns = [];
            [updateModule.validateData, updateModule.extraValidation, updateModule.handleInitialSubmit,
             updateModule.handleRenewal, updateModule.lockCampaign, updateModule.unlockCampaign, updateModule.applyUpdate,
             updateModule.notifyOwner, fakeAutoApproveModel.midWare, updateModule.canEditCampaign, CrudSvc.fetchRelatedEntity].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = Function.prototype.bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });
            spyOn(CrudSvc.prototype.setupObj, 'bind').and.returnValue(CrudSvc.prototype.setupObj);
            
            campSvc = { model: new Model('campaigns', {}) };
            
            spyOn(streamUtils, 'createProducer');

            svc = updateModule.setupSvc(mockDb, campSvc, config, appCreds);
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
        
        it('should save some config variables locally', function() {
            expect(updateModule.config.api).toBeDefined();
            expect(updateModule.config.emails).toBeDefined();
        });
        
        it('should create a JsonProducer', function() {
            expect(streamUtils.createProducer).toHaveBeenCalledWith(config.kinesis);
        });
        
        it('should enable statusHistory', function() {
            expect(historian.middlewarify).toHaveBeenCalledWith('status', 'statusHistory');
            expect(svc._middleware.create).toContain(histMidware);
            expect(svc._middleware.edit).toContain(histMidware);
            expect(svc._middleware.delete).toContain(histMidware);
            expect(svc._middleware.autoApprove).toContain(histMidware);
            expect(svc.model.schema.statusHistory).toBeDefined();
        });
        
        it('should include middleware for create', function() {
            expect(svc._middleware.create).toContain(getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'campaigns',
                idPath: ['params.campId']
            }, updateModule.config.api]));
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.canEditCampaign, [updateModule, campSvc]));
            expect(svc._middleware.create).toContain(updateModule.enforceLock);
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.validateData, [updateModule, fakeCampModel]));
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.extraValidation, [updateModule, fakeCampModel]));
            expect(svc._middleware.create).toContain(updateModule.validateCards);
            expect(svc._middleware.create).toContain(updateModule.validateZipcodes);
            expect(svc._middleware.create).toContain(updateModule.checkAvailableFunds);
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.handleInitialSubmit, [updateModule, svc]));
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.handleRenewal, [updateModule, svc]));
            expect(svc._middleware.create).toContain(updateModule.notifySupport);
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.lockCampaign, [updateModule, svc]));

            updateModule.config.emails.enabled = false;
            svc = updateModule.setupSvc(mockDb, campSvc, config, appCreds);
            expect(svc._middleware.create).not.toContain(getBoundFn(updateModule.notifySupport, [updateModule, svc]));
        });
        
        it('should include middleware for edit', function() {
            expect(svc._middleware.edit).toContain(updateModule.ignoreCompleted);
            expect(svc._middleware.edit).toContain(getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'campaigns',
                idPath: ['params.campId']
            }, updateModule.config.api]));
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.canEditCampaign, [updateModule, campSvc]));
            expect(svc._middleware.edit).toContain(updateModule.requireReason);
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.validateData, [updateModule, fakeCampModel]));
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.extraValidation, [updateModule, fakeCampModel]));
            expect(svc._middleware.edit).toContain(updateModule.validateCards);
            expect(svc._middleware.edit).toContain(updateModule.validateZipcodes);
            expect(svc._middleware.edit).toContain(updateModule.checkAvailableFunds);
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.unlockCampaign, [updateModule, svc]));
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.applyUpdate, [updateModule, svc, appCreds]));
            expect(svc._middleware.edit).toContain(getBoundFn(updateModule.notifyOwner, [updateModule, svc]));

            updateModule.config.emails.enabled = false;
            svc = updateModule.setupSvc(mockDb, campSvc, config, appCreds);
            expect(svc._middleware.create).not.toContain(getBoundFn(updateModule.notifyOwner, [updateModule, svc]));
        });
        
        it('should include middleware for autoApprove', function() {
            expect(svc._middleware.autoApprove).toContain(getBoundFn(fakeAutoApproveModel.midWare, [fakeAutoApproveModel, 'create']));
            expect(svc._middleware.autoApprove).toContain(svc.setupObj);
            expect(svc._middleware.create).toContain(getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'campaigns',
                idPath: ['params.campId']
            }, updateModule.config.api]));
            expect(svc._middleware.create).toContain(getBoundFn(updateModule.canEditCampaign, [updateModule, campSvc]));
            expect(svc._middleware.autoApprove).toContain(updateModule.enforceLock);
            expect(svc._middleware.autoApprove).toContain(updateModule.validateZipcodes);
            expect(svc._middleware.autoApprove).toContain(updateModule.checkAvailableFunds);
            expect(svc._middleware.autoApprove).toContain(getBoundFn(updateModule.applyUpdate, [updateModule, svc, appCreds]));
        });
    });
    
    describe('campaignUpdate validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = updateModule.setupSvc(mockDb, campModule.setupSvc(mockDb, updateModule.config), updateModule.config, appCreds);
            newObj = { data: {} };
            origObj = {};
            requester = { fieldValidation: { campaignUpdates: {} } };
        });

        describe('when handling status', function() {
            it('should switch the field to a default if set', function() {
                newObj.status = Status.Active;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.status).toBe(Status.Pending);
            });
            
            it('should allow some requesters to set the field to one of a limited set of values', function() {
                requester.fieldValidation.campaignUpdates.status = { __allowed: true };
                newObj.status = Status.Active;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.status).toBe(Status.Active);
                
                newObj.status = 'plz start right now kthx';
                var resp = svc.model.validate('create', newObj, origObj, requester);
                expect(resp.isValid).toBe(false);
                expect(resp.reason).toMatch(/^status is UNACCEPTABLE! acceptable values are: \[.+]/);
            });
        });
        
        ['autoApproved', 'initialSubmit', 'renewal'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should always default to false', function() {
                    requester.fieldValidation.campaignUpdates[field] = { __allowed: true };
                    newObj[field] = true;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toBe(false);
                });
            });
        });
        
        describe('when handling campaign', function() {
            it('should not be settable', function() {
                requester.fieldValidation.campaignUpdates.campaign = { __allowed: true };
                newObj.campaign = 'cam-fake';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaign).not.toBeDefined();
            });
        });
        
        describe('when handling rejectionReason', function() {
            it('should trim the field if set', function() {
                newObj.rejectionReason = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.rejectionReason).not.toBeDefined();
            });
            
            it('should be able to allow some requesters to set the field', function() {
                requester.fieldValidation.campaignUpdates.rejectionReason = { __allowed: true };
                newObj.rejectionReason = 'you stink';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.rejectionReason).toBe('you stink');
            });

            it('should fail if the field is not a string', function() {
                requester.fieldValidation.campaignUpdates.rejectionReason = { __allowed: true };
                newObj.rejectionReason = 1234;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'rejectionReason must be in format: string' });
            });
        });
        
        describe('when handling data', function() {
            it('should fail if the field is not an object', function() {
                newObj.data = 'start this campaign';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'data must be in format: object' });
            });
            
            it('should allow the field to be set on create', function() {
                newObj.data.foo = 'bar';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({ foo: 'bar' });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.data;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: data' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.data;
                origObj.data = { foo: 'baz' };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({ foo: 'baz' });
            });

            it('should allow the field to be changed', function() {
                newObj.data.foo = 'bar';
                origObj.data = { foo: 'baz' };
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({ foo: 'bar' });
            });
        });
    });
    
    describe('approvingUpdate', function() {
        beforeEach(function() {
            req.body = { id: 'ur-1', status: Status.Approved, data: {} };
            req.origObj = { id: 'ur-1', status: Status.Pending, data: {} };
        });

        it('should return true if the status of the update request is changing pending --> approved', function() {
            expect(updateModule.approvingUpdate(req)).toBe(true);
        });
        
        it('should return false for other status transitions', function() {
            [{ newStatus: Status.Pending }, { oldStatus: Status.Approved },
             { newStatus: Status.Rejected }, { oldStatus: Status.Rejected }].forEach(function(obj) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body.status = obj.newStatus || reqCopy.body.status;
                reqCopy.origObj.status = obj.oldStatus || reqCopy.origObj.status;
                expect(updateModule.approvingUpdate(reqCopy)).toBe(false);
            });
        });
        
        it('should return false if there is no origObj', function() {
            delete req.origObj;
            expect(updateModule.approvingUpdate(req)).toBe(false);
        });
    });
    
    describe('rejectingUpdate', function() {
        beforeEach(function() {
            req.body = { id: 'ur-1', status: Status.Rejected, data: {} };
            req.origObj = { id: 'ur-1', status: Status.Pending, data: {} };
        });

        it('should return true if the status of the update request is changing pending --> rejected', function() {
            expect(updateModule.rejectingUpdate(req)).toBe(true);
        });
        
        it('should return false for other status transitions', function() {
            [{ newStatus: Status.Pending }, { oldStatus: Status.Approved },
             { oldStatus: Status.Rejected }, { newStatus: Status.Approved }].forEach(function(obj) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.body.status = obj.newStatus || reqCopy.body.status;
                reqCopy.origObj.status = obj.oldStatus || reqCopy.origObj.status;
                expect(updateModule.rejectingUpdate(reqCopy)).toBe(false);
            });
        });
        
        it('should return false if there is no origObj', function() {
            delete req.origObj;
            expect(updateModule.rejectingUpdate(req)).toBe(false);
        });
    });
    
    describe('isInitSubmit', function() {
        beforeEach(function() {
            req.body = { id: 'ur-1', status: Status.Pending, data: {} };
            req.origObj = { id: 'ur-1', status: Status.Pending, data: {} };
            req.campaign = { id: 'cam-1', status: Status.Active };
        });

        it('should return true if the body has initialSubmit === true', function() {
            req.body.initialSubmit = true;
            expect(updateModule.isInitSubmit(req)).toBe(true);
            req.body.initialSubmit = false;
            expect(updateModule.isInitSubmit(req)).toBe(false);
        });

        it('should return true if the origObj has initialSubmit === true', function() {
            req.origObj.initialSubmit = true;
            expect(updateModule.isInitSubmit(req)).toBe(true);
            req.origObj.initialSubmit = false;
            expect(updateModule.isInitSubmit(req)).toBe(false);
        });

        it('should return true if the data contains the right status change', function() {
            req.body.data.status = Status.Pending;
            req.campaign.status = Status.Draft;
            expect(updateModule.isInitSubmit(req)).toBe(true);
            // this should still work, for now
            req.body.data.status = Status.Active;
            expect(updateModule.isInitSubmit(req)).toBe(true);
        });
        
        it('should return false otherwise', function() {
            expect(updateModule.isInitSubmit(req)).toBe(false);
            req.campaign.status = Status.Draft;
            expect(updateModule.isInitSubmit(req)).toBe(false);
            req.body.data.status = Status.Draft;
            expect(updateModule.isInitSubmit(req)).toBe(false);
        });
    });
    
    describe('isRenewal', function() {
        beforeEach(function() {
            req.body = { id: 'ur-1', status: Status.Pending, data: {} };
            req.origObj = { id: 'ur-1', status: Status.Pending, data: {} };
            req.campaign = { id: 'cam-1', status: Status.Active };
        });

        it('should return true if the body has renewal === true', function() {
            req.body.renewal = true;
            expect(updateModule.isRenewal(req)).toBe(true);
            req.body.renewal = false;
            expect(updateModule.isRenewal(req)).toBe(false);
        });

        it('should return true if the origObj has renewal === true', function() {
            req.origObj.renewal = true;
            expect(updateModule.isRenewal(req)).toBe(true);
            req.origObj.renewal = false;
            expect(updateModule.isRenewal(req)).toBe(false);
        });

        it('should return true if the data contains the right status change', function() {
            [Status.Expired, Status.OutOfBudget, Status.Canceled].forEach(function(campStatus) {
                req.campaign.status = campStatus;
                req.body.data.status = Status.Pending;
                expect(updateModule.isRenewal(req)).toBe(true);
                // this should still work, for now
                req.body.data.status = Status.Active;
                expect(updateModule.isRenewal(req)).toBe(true);
            });
        });
        
        it('should return false otherwise', function() {
            expect(updateModule.isRenewal(req)).toBe(false);
            req.body.data.status = Status.Pending;
            expect(updateModule.isRenewal(req)).toBe(false);
            req.campaign.status = Status.Draft;
            expect(updateModule.isRenewal(req)).toBe(false);
        });
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
        beforeEach(function() {
            req.body = { campaign: 'cam-1', data: { paymentMethod: 'infinite money' } };
            req.requester.entitlements = {};
            req.requester.fieldValidation = { campaigns: {} };
        });

        it('should return true if the paymentMethod is the only thing being changed', function() {
            expect(updateModule.canAutoApprove(req)).toBe(true);
            req.body.data.foo = 'bar';
            expect(updateModule.canAutoApprove(req)).toBe(false);
            req.body.data = { status: 'active' };
            expect(updateModule.canAutoApprove(req)).toBe(false);
        });

        it('should also return true if the user has the autoApproveUpdates entitlement and can edit a campaigns\' status', function() {
            req.body.data.foo = 'bar';
            req.requester.entitlements.autoApproveUpdates = true;
            expect(updateModule.canAutoApprove(req)).toBe(false);

            req.requester.fieldValidation.campaigns.status = { __allowed: true };
            expect(updateModule.canAutoApprove(req)).toBe(true);

            req.requester.entitlements.autoApproveUpdates = false;
            expect(updateModule.canAutoApprove(req)).toBe(false);
        });
    });

    describe('canEditCampaign', function() {
        var campSvc;
        beforeEach(function() {
            req.campaign = {
                id: 'cam-1',
                name: 'camp 1',
                updateRequest: 'ur-1',
                user: 'u-1',
                org: 'o-1',
                cards: [{ id: 'rc-1', decorated: 'yes' }]
            };
            req.body = { data: { foo: 'bar' } };
            req.origObj = { id: 'ur-1' };
            req.requester.permissions = { campaigns: { read: 'own', edit: 'own' } };
            campSvc = campModule.setupSvc(mockDb, updateModule.config);
        });
        
        it('should call next normally', function() {
            updateModule.canEditCampaign(campSvc, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual({ campaign: 'cam-1', data: { foo: 'bar' } });
        });
        
        it('should call done if the campaign has a different pending update request', function() {
            req.campaign.updateRequest = 'ur-2';
            updateModule.canEditCampaign(campSvc, req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Update request does not apply to this campaign' });
            expect(errorSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if the user does not have permission to edit the campaign', function() {
            req.campaign.user = 'u-2';
            updateModule.canEditCampaign(campSvc, req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to edit this campaign' });
            expect(errorSpy).not.toHaveBeenCalled();
        });
    });
    
    describe('enforceLock', function() {
        it('should call next if there is no updateRequest on the object', function() {  
            req.campaign = { id: 'cam-1', name: 'camp 1' };
            updateModule.enforceLock(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if there is an updateRequest on the object', function() {
            req.campaign = { id: 'cam-1', name: 'camp 1', updateRequest: 'ur-1' };
            updateModule.enforceLock(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign locked until existing update request resolved' });
        });
    });

    describe('validateData', function() {
        var model;
        beforeEach(function() {
            req.body = { id: 'ur-1', campaign: 'cam-1', data: {
                name: 'camp 1 updated',
                tag: 'foo',
                targeting: {
                    demographics: {
                        age: ['18-24', '24-36'],
                    },
                    interests: ['cat-3']
                }
            } };
            req.campaign = {
                id: 'cam-1',
                name: 'camp 1',
                status: Status.Pending,
                targeting: {
                    demographics: {
                        age: ['18-24'],
                        gender: ['male']
                    },
                    interests: ['cat-1', 'cat-2']
                }
            };
            model = new Model('campaigns', {});
            spyOn(model, 'validate').and.returnValue({ isValid: true });
        });

        it('should merge the data with the campaign and call model.validate()', function() {
            updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.requester);
            expect(req.body).toEqual({ id: 'ur-1', campaign: 'cam-1', data: {
                id: 'cam-1',
                name: 'camp 1 updated',
                status: Status.Pending,
                tag: 'foo',
                targeting: {
                    demographics: {
                        age: ['18-24', '24-36'],
                        gender: ['male']
                    },
                    interests: ['cat-3']
                }
            } });
        });
        
        it('should call done if model.validate() returns invalid', function() {
            model.validate.and.returnValue({ isValid: false, reason: 'you did a bad thing' });
            updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'you did a bad thing' });
            expect(errorSpy).not.toHaveBeenCalled();
        });
        
        it('should preserve the cards defined in req.body.data', function() {
            req.body.data.cards = [{
                id: 'rc-1',
                title: 'card 1',
                campaign: { startDate: 'right now' }
            }];
            req.campaign.cards = [
                {
                    id: 'rc-1',
                    title: 'card 1',
                    campaign: { startDate: 'eventually', endDate: 'never' }
                },
                {
                    id: 'rc-2',
                    title: 'card 2',
                    campaign: { startDate: 'tomorrow' }
                }
            ];
            updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.requester);
            expect(req.body).toEqual({ id: 'ur-1', campaign: 'cam-1', data: {
                id: 'cam-1',
                name: 'camp 1 updated',
                status: Status.Pending,
                tag: 'foo',
                targeting: {
                    demographics: {
                        age: ['18-24', '24-36'],
                        gender: ['male']
                    },
                    interests: ['cat-3']
                },
                cards: jasmine.any(Array)
            } });
            expect(req.body.data.cards).toEqual([{
                id: 'rc-1',
                title: 'card 1',
                campaign: { startDate: 'right now' }
            }]);
        });
        
        describe('if an origObj is defined', function() {
            beforeEach(function() {
                req.origObj = { id: 'ur-1', campaign: 'cam-1', data: {
                    name: 'camp 1 is cool',
                    targeting: {
                        demographics: {
                            age: ['18-24', '24-36', '50-100']
                        },
                        geo: {
                            states: ['new jersey']
                        }
                    },
                    cards: [{
                        id: 'rc-2',
                        title: 'card 2 is da best',
                        campaign: { startDate: 'a long long time ago' }
                    }]
                } };
            });

            it('should preserve props from the origObj', function() {
                updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.requester);
                expect(req.body).toEqual({ id: 'ur-1', campaign: 'cam-1', data: {
                    id: 'cam-1',
                    name: 'camp 1 updated',
                    status: Status.Pending,
                    tag: 'foo',
                    targeting: {
                        demographics: {
                            age: ['18-24', '24-36'],
                            gender: ['male']
                        },
                        geo: {
                            states: ['new jersey']
                        },
                        interests: ['cat-3']
                    },
                    cards: jasmine.any(Array)
                } });
                expect(req.body.data.cards).toEqual([{
                    id: 'rc-2',
                    title: 'card 2 is da best',
                    campaign: { startDate: 'a long long time ago' }
                }]);
            });
        });
    });

    describe('extraValidation', function() {
        var model;
        beforeEach(function() {
            req.body = { data: { newCampaign: 'yes' } };
            req.campaign = { oldCampaign: 'yes' };
            spyOn(campaignUtils, 'ensureUniqueIds').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validateAllDates').and.returnValue({ isValid: true });
            spyOn(campaignUtils, 'validatePricing').and.returnValue({ isValid: true });
            model = new Model('campaigns', {});
        });
        
        it('should call next if all validation passes', function() {
            updateModule.extraValidation(model, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(campaignUtils.ensureUniqueIds).toHaveBeenCalledWith({ newCampaign: 'yes' });
            expect(campaignUtils.validateAllDates).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' }, req.requester, '1234');
            expect(campaignUtils.validatePricing).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' }, req.requester, model, true);
        });
        
        it('should call done if any of the methods fail', function() {
            var methods = ['ensureUniqueIds', 'validateAllDates', 'validatePricing'];
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
    
    describe('validateCards', function() {
        var ModelSpy;
        beforeEach(function() {
            req.body = { data: {
                cards: [
                    { id: 'rc-1', new: 'yes' },
                    { id: 'rc-2', new: 'yes' }
                ]
            } };
            req.campaign = {
                id: 'cam-1',
                cards: [
                    { id: 'rc-1', old: 'yes' },
                    { id: 'rc-2', old: 'yes' }
                ]
            };
            spyOn(requestUtils, 'proxyRequest').and.returnValue(q({
                response: { statusCode: 200 },
                body: { schema: 'yes' }
            }));
            spyOn(Model.prototype, 'validate').and.returnValue({ isValid: true });
            ModelSpy = jasmine.createSpy('Model()').and.callFake(function(objName, schema) {
                return new Model(objName, schema);
            });

            var config = updateModule.config;
            require.cache[require.resolve('../../lib/model')] = { exports: ModelSpy };
            delete require.cache[require.resolve('../../bin/ads-campaignUpdates')];
            updateModule = require('../../bin/ads-campaignUpdates');
            updateModule.config = config;
        });
        
        afterEach(function() {
            delete require.cache[require.resolve('../../bin/ads-campaignUpdates')];
            delete require.cache[require.resolve('../../lib/model')];
        });
        
        it('should get the card schema and validate all cards', function(done) {
            updateModule.validateCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'https://test.com/api/content/cards/schema'
                });
                expect(ModelSpy).toHaveBeenCalledWith('cards', { schema: 'yes' });
                expect(Model.prototype.validate.calls.count()).toBe(2);
                expect(Model.prototype.validate).toHaveBeenCalledWith('edit', { id: 'rc-1', new: 'yes' }, { id: 'rc-1', old: 'yes' }, req.requester);
                expect(Model.prototype.validate).toHaveBeenCalledWith('edit', { id: 'rc-2', new: 'yes' }, { id: 'rc-2', old: 'yes' }, req.requester);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should be able to handle new cards', function(done) {
            req.body.data.cards.push({ title: 'my new card' });
            updateModule.validateCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(ModelSpy).toHaveBeenCalledWith('cards', { schema: 'yes' });
                expect(Model.prototype.validate.calls.count()).toBe(3);
                expect(Model.prototype.validate).toHaveBeenCalledWith('edit', { id: 'rc-1', new: 'yes' }, { id: 'rc-1', old: 'yes' }, req.requester);
                expect(Model.prototype.validate).toHaveBeenCalledWith('edit', { id: 'rc-2', new: 'yes' }, { id: 'rc-2', old: 'yes' }, req.requester);
                expect(Model.prototype.validate).toHaveBeenCalledWith('create', { title: 'my new card' }, undefined, req.requester);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should call done if one of the cards is invalid', function(done) {
            Model.prototype.validate.and.returnValue({ isValid: false, reason: 'this card stinks' });
            updateModule.validateCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'cards[0] is invalid: this card stinks' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(Model.prototype.validate.calls.count()).toBe(1);
                expect(Model.prototype.validate).toHaveBeenCalledWith('edit', { id: 'rc-1', new: 'yes' }, { id: 'rc-1', old: 'yes' }, req.requester);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should call done if the get schema endpoint returns a 4xx response', function(done) {
            requestUtils.proxyRequest.and.returnValue(q({ response: { statusCode: 403 }, body: 'Cannot create/edit cards' }));
            updateModule.validateCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Cannot create/edit cards' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(Model.prototype.validate).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should reject if the request for the schema fails', function(done) {
            requestUtils.proxyRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.validateCards(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error fetching card schema');
                expect(Model.prototype.validate).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done, done.fail);
        });
    });
    
    describe('validateZipcodes', function() {
        beforeEach(function() {
            req.body = { data: { newCampaign: 'yes' } };
            req.campaign = { oldCampaign: 'yes' };
            spyOn(campaignUtils, 'validateZipcodes').and.returnValue(q({ isValid: true }));
        });
        
        it('should call next if the zipcodes is valid', function(done) {
            updateModule.validateZipcodes(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateZipcodes).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' },
                    req.requester, 'https://test.com/api/geo/zipcodes/', req);
            }).done(done, done.fail);
        });
        
        it('should call done if the zipcodes are not valid', function(done) {
            campaignUtils.validateZipcodes.and.returnValue(q({ isValid: false, reason: 'you better pay up buddy' }));
            updateModule.validateZipcodes(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'you better pay up buddy' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.validateZipcodes).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' },
                    req.requester, 'https://test.com/api/geo/zipcodes/', req);
            }).done(done, done.fail);
        });
        
        it('should reject if campaignUtils.validateZipcodes fails', function(done) {
            campaignUtils.validateZipcodes.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.validateZipcodes(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(campaignUtils.validateZipcodes).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' },
                    req.requester, 'https://test.com/api/geo/zipcodes/', req);
            }).done(done, done.fail);
        });
    });
    
    describe('setPending', function() {
        var svc;
        beforeEach(function() {
            req.campaign = {
                id: 'cam-1',
                status: Status.Draft,
                statusHistory: [{ userId: 'u-2', user: 'me@c6.com', date: new Date(), status: Status.Draft }]
            };
            req.body = { campaign: 'cam-1', data: { status: Status.Active } };

            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            spyOn(historian, 'historify').and.callThrough();
            svc = { _db: mockDb };
        });
        
        it('should set the existing campaign to pending', function(done) {
            var statHistory = [
                { userId: 'u-1', user: 'selfie@c6.com', date: jasmine.any(Date), status: Status.Pending },
                { userId: 'u-2', user: 'me@c6.com', date: jasmine.any(Date), status: Status.Draft }
            ];
            updateModule.setPending(svc, req).then(function(resp) {
                expect(req.body.data.statusHistory).toEqual(statHistory);
                expect(historian.historify).toHaveBeenCalledWith('status', 'statusHistory',
                    jasmine.objectContaining({ status: Status.Pending }), req.campaign, req);
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' }, {
                    status: Status.Pending,
                    statusHistory: statHistory
                }, 'cam-1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.setPending(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('handleInitialSubmit', function() {
        var svc;
        beforeEach(function() {
            req.campaign = {
                id: 'cam-1',
                status: Status.Draft
            };
            req.body = { campaign: 'cam-1', data: {
                pricing: { budget: 1000, dailyLimit: 200, cost: 0.15, model: 'cpv' },
                status: Status.Active
            } };
            req.requester.entitlements = {};
            spyOn(updateModule, 'setPending').and.returnValue(q());
            svc = { _db: mockDb };
        });

        it('should skip if this is not the campaign\'s initial submit', function(done) {
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
            req1.body.data.status = Status.Canceled;
            req2.campaign.status = Status.Paused;
            updateModule.handleInitialSubmit(svc, req1, nextSpy, doneSpy).catch(errorSpy);
            updateModule.handleInitialSubmit(svc, req2, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy.calls.count()).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(updateModule.setPending).not.toHaveBeenCalled();
                expect(req1.body.initialSubmit).not.toBeDefined();
                expect(req2.body.initialSubmit).not.toBeDefined();
                done();
            });
        });
        
        it('should check that required fields exist and then change the status of the campaign', function(done) {
            updateModule.handleInitialSubmit(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.initialSubmit).toBe(true);
                expect(updateModule.setPending).toHaveBeenCalledWith(svc, req);
                done();
            });
        });
        
        it('should call done if the campaign is missing certain pricing fields', function(done) {
            q.all(['pricing', ['pricing', 'budget'], ['pricing', 'cost']].map(function(field) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                if (field instanceof Array) {
                    delete reqCopy.body.data[field[0]][field[1]];
                } else {
                    delete reqCopy.body.data[field];
                }
                return updateModule.handleInitialSubmit(svc, reqCopy, nextSpy, doneSpy).catch(errorSpy);
            })).then(function(results) {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.count()).toBe(3);
                expect(doneSpy.calls.argsFor(0)).toEqual([{ code: 400, body: 'Missing required field: pricing.budget' }]);
                expect(doneSpy.calls.argsFor(1)).toEqual([{ code: 400, body: 'Missing required field: pricing.budget' }]);
                expect(doneSpy.calls.argsFor(2)).toEqual([{ code: 400, body: 'Missing required field: pricing.cost' }]);
                expect(updateModule.setPending).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should reject if editing the campaign fails', function(done) {
            updateModule.setPending.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.handleInitialSubmit(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('handleRenewal', function() {
        var svc;
        beforeEach(function() {
            req.campaign = { id: 'cam-1', status: Status.Canceled };
            req.body = { campaign: 'cam-1', data: { status: Status.Active } };
            spyOn(updateModule, 'setPending').and.returnValue(q());
            svc = { _db: mockDb };
        });
        
        it('should set the renewal prop and set the campaign to pending', function(done) {
            updateModule.handleRenewal(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.renewal).toBe(true);
                expect(updateModule.setPending).toHaveBeenCalledWith(svc, req);
                done();
            });
        });
        
        it('should handle all possible renewal status transitions', function(done) {
            q.all([Status.Canceled, Status.Expired, Status.OutOfBudget].map(function(status) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.campaign.status = status;
                return updateModule.handleRenewal(svc, reqCopy, nextSpy, doneSpy).catch(errorSpy);
            })).then(function(results) {
                expect(nextSpy.calls.count()).toBe(3);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(updateModule.setPending.calls.count()).toBe(3);
            }).then(done, done.fail);
        });
        
        it('should skip if the update is not a campaign renewal', function(done) {
            q.all([{ oldStatus: Status.Paused }, { oldStatus: Status.Draft }, { newStatus: Status.Draft }].map(function(obj) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                reqCopy.campaign.status = obj.oldStatus || reqCopy.campaign.status;
                reqCopy.body.data.status = obj.newStatus || reqCopy.body.data.status;
                return updateModule.handleRenewal(svc, reqCopy, nextSpy, doneSpy).catch(errorSpy);
            })).then(function(results) {
                expect(nextSpy.calls.count()).toBe(3);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(updateModule.setPending).not.toHaveBeenCalled();
            }).then(done, done.fail);
        });
        
        it('should fail if editing the campaign fails', function(done) {
            updateModule.setPending.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.handleRenewal(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });

    describe('checkAvailableFunds', function() {
        var checkResp;
        beforeEach(function() {
            req.body = {
                id: 'ur-1',
                campaign: 'cam-1',
                data: {
                    pricing: { budget: 400 }
                }
            };
            req.campaign = {
                id: 'cam-1',
                status: Status.Draft,
                org: 'o-1',
                pricing: { budget: 100 }
            };

            checkResp = { response: { statusCode: 204 }, body: '' };
            spyOn(requestUtils, 'proxyRequest').and.callFake(function() { return q(checkResp); });
        });
        
        it('should check and call next if the account has enough budget for the campaign', function(done) {
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'post', {
                    url: 'https://test.com/api/accounting/credit-check/',
                    json: { org: 'o-1', campaign: 'cam-1', newBudget: 400 }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if the credit check returns a 402', function(done) {
            checkResp.response.statusCode = 402;
            checkResp.body = { message: 'Insufficient funds', depositAmount: 500 };
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 402, body: { message: 'Insufficient funds', depositAmount: 500 } });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.proxyRequest).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if the budget is not changing', function(done) {
            req.body.data.pricing.budget = 100;
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if no new budget is defined', function(done) {
            delete req.body.data.pricing;
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        describe('if the update request is an initial campaign submission', function() {
            beforeEach(function() {
                delete req.body.data.pricing;
            });

            it('should always perform the check', function(done) {
                // Test that "initial submit" recognized thru statuses + initialSubmit prop
                var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
                req1.body.data.status = Status.Active;
                req2.body.initialSubmit = true;
                
                q.all([
                    updateModule.checkAvailableFunds(req1, nextSpy, doneSpy).catch(errorSpy),
                    updateModule.checkAvailableFunds(req2, nextSpy, doneSpy).catch(errorSpy)
                ]).then(function(results) {
                    expect(nextSpy.calls.count()).toBe(2);
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(requestUtils.proxyRequest.calls.count()).toBe(2);
                    requestUtils.proxyRequest.calls.all().forEach(function(call) {
                        expect(call.args).toEqual([jasmine.any(Object), 'post', {
                            url: 'https://test.com/api/accounting/credit-check/',
                            json: { org: 'o-1', campaign: 'cam-1', newBudget: null }
                        }]);
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
        });

        describe('if the update request is a renewal', function() {
            beforeEach(function() {
                delete req.body.data.pricing;
                req.body.data.status = Status.Active;
            });

            it('should always perform the check', function(done) {
                // Test that "renewal" recognized thru statuses + renewal prop
                var reqs = [req, req, req, req].map(function(obj) { return JSON.parse(JSON.stringify(obj)); });
                reqs[0].campaign.status = Status.Expired;
                reqs[1].campaign.status = Status.Canceled;
                reqs[2].campaign.status = Status.OutOfBudget;
                reqs[0].body.renewal = true;
                delete reqs[0].body.data.status;
                
                q.all(reqs.map(function(reqCopy) {
                    return updateModule.checkAvailableFunds(reqCopy, nextSpy, doneSpy).catch(errorSpy);
                })).then(function(results) {
                    expect(nextSpy.calls.count()).toBe(4);
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(requestUtils.proxyRequest.calls.count()).toBe(4);
                    requestUtils.proxyRequest.calls.all().forEach(function(call) {
                        expect(call.args).toEqual([jasmine.any(Object), 'post', {
                            url: 'https://test.com/api/accounting/credit-check/',
                            json: { org: 'o-1', campaign: 'cam-1', newBudget: null }
                        }]);
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('if editing an existing update request', function() {
            beforeEach(function() {
                req.origObj = { data: { pricing: { budget: 9000 } } };
            });
            
            it('should ignore the origObj if a budget is defined on the body', function(done) {
                updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'post', {
                        url: 'https://test.com/api/accounting/credit-check/',
                        json: { org: 'o-1', campaign: 'cam-1', newBudget: 400 }
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
            
            it('should use the origObj if the budget is not defined on the body', function(done) {
                delete req.body.data.pricing.budget;
                updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'post', {
                        url: 'https://test.com/api/accounting/credit-check/',
                        json: { org: 'o-1', campaign: 'cam-1', newBudget: 9000 }
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
        });
        
        it('should return a 4xx if the credit check returns a 400', function(done) {
            checkResp.response.statusCode = 400;
            checkResp.body = 'No way, buddy';
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'No way, buddy' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if the credit check request fails', function(done) {
            checkResp = q.reject('I GOT A PROBLEM');
            updateModule.checkAvailableFunds(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Failed making credit check');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
                done();
            });
        });
    });

    describe('notifySupport', function() {
        beforeEach(function() {
            req.campaign = { id: 'cam-1', name: 'my first campaign' };
            spyOn(email, 'newUpdateRequest').and.returnValue(q());
        });
        
        it('should send an email and call next', function(done) {
            updateModule.notifySupport(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(email.newUpdateRequest).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'support@c6.com',
                    req,
                    'my first campaign',
                    'http://selfie.com/campaigns/cam-1/admin'
                );
                done();
            });
        });
        
        it('should reject if sending the email fails', function(done) {
            email.newUpdateRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.notifySupport(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
        });
    });

    describe('lockCampaign', function() {
        var svc, mockColl;
        beforeEach(function() {
            mockColl = {
                findOneAndUpdate: jasmine.createSpy('coll.findOneAndUpdate').and.returnValue(q())
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { id: 'ur-1', campaign: 'cam-1', data: {} };
            req.campaign = { id: 'cam-1', name: 'camp 1' };
            svc = { _db: mockDb };
        });
        
        it('should directly edit the original campaign', function(done) {
            updateModule.lockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                    { id: 'cam-1' },
                    {
                        $set: { lastUpdated: jasmine.any(Date), updateRequest: 'ur-1' },
                        $unset: { rejectionReason: 1 },
                    },
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mockColl.findOneAndUpdate.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.lockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('ignoreCompleted', function() {
        beforeEach(function() {
            req.origObj = { id: 'ur-1', status: Status.Pending, campaign: 'cam-1', data: {} };
        });
        
        it('should call done if the update request has been approved or rejected', function() {
            [Status.Approved, Status.Rejected].forEach(function(status) {
                req.origObj.status = status;
                updateModule.ignoreCompleted(req, nextSpy, doneSpy);
            });
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(2);
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Update has already been approved' });
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Update has already been rejected' });
        });
        
        it('should call next otherwise', function() {
            updateModule.ignoreCompleted(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('requireReason', function() {
        beforeEach(function() {
            req.body = { id: 'ur-1', status: Status.Rejected, data: {}, campaign: 'cam-1' };
            req.origObj = { id: 'ur-1', status: Status.Pending, data: {}, campaign: 'cam-1' };
        });

        it('should call done if rejecting the update without a reason', function() {
            updateModule.requireReason(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot reject update without a reason' });
        });
        
        it('should call next otherwise', function() {
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req)), req3 = JSON.parse(JSON.stringify(req));
            req1.body.status = Status.Approved;
            req2.origObj.status = Status.Rejected;
            req3.body.rejectionReason = 'you stink';
            updateModule.requireReason(req1, nextSpy, doneSpy);
            updateModule.requireReason(req2, nextSpy, doneSpy);
            updateModule.requireReason(req3, nextSpy, doneSpy);
            expect(nextSpy.calls.count()).toBe(3);
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('unlockCampaign', function() {
        var svc, mockColl;
        beforeEach(function() {
            mockColl = {
                findOneAndUpdate: jasmine.createSpy('coll.findOneAndUpdate').and.returnValue(q())
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { id: 'ur-1', campaign: 'cam-1', data: {}, status: Status.Approved };
            req.origObj = { id: 'ur-1', campaign: 'cam-1', data: {}, status: Status.Pending };
            req.campaign = {
                id: 'cam-1',
                name: 'camp 1',
                updateRequest: 'u-1',
                status: Status.Active,
                statusHistory: [
                    { userId: 'u-2', user: 'me@c6.com', status: Status.Active, date: new Date('2016-04-26T20:43:14.321Z') },
                    { userId: 'u-2', user: 'me@c6.com', status: Status.Draft, date: new Date('2016-04-25T20:43:14.321Z') }
                ]
            };
            spyOn(historian, 'historify').and.callThrough();
            svc = { _db: mockDb };
        });
        
        it('should remove the updateRequest prop on the campaign and call next', function(done) {
            updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                    { id: 'cam-1' },
                    {
                        $set: { lastUpdated: jasmine.any(Date) },
                        $unset: { updateRequest: 1 },
                    },
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        describe('if the updateRequest is being rejected', function() {
            beforeEach(function() {
                req.body.status = Status.Rejected;
                req.body.rejectionReason = 'worst campaign ever';
            });
    
            it('should also save the rejectionReason on the campaign', function(done) {
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'cam-1' },
                        {
                            $set: { lastUpdated: jasmine.any(Date), rejectionReason: 'worst campaign ever' },
                            $unset: { updateRequest: 1 },
                        },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    expect(mockLog.warn).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should revert the status if the update was an initial approval request', function(done) {
                req.campaign.status = Status.Pending;
                req.campaign.statusHistory[0].status = Status.Pending;
                req.body.data.status = Status.Pending;
                req.body.initialSubmit = true;
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(historian.historify).toHaveBeenCalledWith('status', 'statusHistory', jasmine.any(Object), req.campaign, req);
                    expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'cam-1' },
                        { $set: jasmine.any(Object), $unset: { updateRequest: 1 } },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    var setObj = mockColl.findOneAndUpdate.calls.argsFor(0)[1].$set;
                    expect(setObj.lastUpdated).toEqual(jasmine.any(Date));
                    expect(setObj.rejectionReason).toEqual('worst campaign ever');
                    expect(setObj.status).toEqual(Status.Draft);
                    expect(setObj.statusHistory).toEqual([
                        { userId: 'u-1', user: 'selfie@c6.com', status: Status.Draft, date: jasmine.any(Date) },
                        { userId: 'u-2', user: 'me@c6.com', status: Status.Pending, date: new Date('2016-04-26T20:43:14.321Z') },
                        { userId: 'u-2', user: 'me@c6.com', status: Status.Draft, date: new Date('2016-04-25T20:43:14.321Z') }
                    ]);
                    expect(mockLog.warn).not.toHaveBeenCalled();
                }).done(done);
            });

            it('should revert the status if the update was a renewal request', function(done) {
                req.campaign.status = Status.Pending;
                req.campaign.statusHistory = [
                    { userId: 'u-2', user: 'me@c6.com', status: Status.Pending, date: new Date('2016-04-26T20:43:14.321Z') },
                    { userId: 'u-2', user: 'me@c6.com', status: Status.OutOfBudget, date: new Date('2016-04-25T20:43:14.321Z') },
                    { userId: 'u-2', user: 'me@c6.com', status: Status.Draft, date: new Date('2016-04-24T20:43:14.321Z') }
                ];
                req.body.data.status = Status.Pending;
                req.body.renewal = true;
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(historian.historify).toHaveBeenCalledWith('status', 'statusHistory', jasmine.any(Object), req.campaign, req);
                    expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'cam-1' },
                        { $set: jasmine.any(Object), $unset: { updateRequest: 1 } },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    var setObj = mockColl.findOneAndUpdate.calls.argsFor(0)[1].$set;
                    expect(setObj.lastUpdated).toEqual(jasmine.any(Date));
                    expect(setObj.rejectionReason).toEqual('worst campaign ever');
                    expect(setObj.status).toEqual(Status.OutOfBudget);
                    expect(setObj.statusHistory).toEqual([
                        { userId: 'u-1', user: 'selfie@c6.com', status: Status.OutOfBudget, date: jasmine.any(Date) },
                        { userId: 'u-2', user: 'me@c6.com', status: Status.Pending, date: new Date('2016-04-26T20:43:14.321Z') },
                        { userId: 'u-2', user: 'me@c6.com', status: Status.OutOfBudget, date: new Date('2016-04-25T20:43:14.321Z') },
                        { userId: 'u-2', user: 'me@c6.com', status: Status.Draft, date: new Date('2016-04-24T20:43:14.321Z') }
                    ]);
                    expect(mockLog.warn).not.toHaveBeenCalled();
                }).done(done);
            });
            
            it('should warn and not revert the status if a previous status cannot be found', function(done) {
                req.campaign.status = Status.Pending;
                req.campaign.statusHistory = [
                    { userId: 'u-2', user: 'me@c6.com', status: Status.Pending, date: new Date('2016-04-26T20:43:14.321Z') },
                ];
                req.body.data.status = Status.Pending;
                req.body.initialSubmit = true;
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(historian.historify).not.toHaveBeenCalled();
                    expect(mockColl.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'cam-1' },
                        {
                            $set: { lastUpdated: jasmine.any(Date), rejectionReason: 'worst campaign ever' },
                            $unset: { updateRequest: 1 },
                        },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    expect(mockLog.warn).toHaveBeenCalled();
                }).done(done);
            });
        });

        it('should skip if the update is not being approved or rejected', function(done) {
            req.body.status = Status.Pending;
            updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.findOneAndUpdate).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mockColl.findOneAndUpdate.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('applyUpdate', function() {
        var svc;
        beforeEach(function() {
            req.body = { id: 'ur-1', campaign: 'cam-1', data: { foo: 'bar' }, status: Status.Approved };
            req.origObj = { id: 'ur-1', campaign: 'cam-1', data: { foo: 'baz' }, status: Status.Pending };
            req.campaign = { id: 'cam-1', name: 'camp 1', updateRequest: 'u-1' };
            spyOn(requestUtils, 'makeSignedRequest').and.returnValue(q({ response: { statusCode: 200 }, body: { camp: 'yes' } }));
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            svc = { _db: mockDb };
        });
        
        it('should edit the campaign with a PUT request', function(done) {
            updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'put', {
                    url: 'https://test.com/api/campaigns/cam-1',
                    json: { foo: 'bar' },
                    headers: { cookie: 'chocolate' }
                });
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if the update request is not being approved', function(done) {
            req.body.status = Status.Rejected;
            updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should still edit the campaign if the request is autoApproved', function(done) {
            delete req.origObj;
            req.body.autoApproved = true;
            updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'put', {
                    url: 'https://test.com/api/campaigns/cam-1',
                    json: { foo: 'bar' },
                    headers: { cookie: 'chocolate' }
                });
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        describe('if the edit to the campaign fails', function() {
            [
                {
                    description: 'with a 4xx',
                    respValue: q({ response: { statusCode: 400 }, body: 'no editing campaigns for you' }),
                    expected: '{ code: 400, body: \'no editing campaigns for you\' }'
                },
                {
                    description: 'with a 5xx',
                    respValue: q.reject('I GOT A PROBLEM'),
                    expected: '\'I GOT A PROBLEM\''
                }
            ].forEach(function(caseObj) {
                describe(caseObj.description, function() {
                    beforeEach(function() {
                        requestUtils.makeSignedRequest.and.returnValue(caseObj.respValue);
                    });
                    
                    it('should attempt to re-lock the campaign and reject', function(done) {
                        updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                            expect(errorSpy).toHaveBeenCalledWith('Failed editing campaign: ' + caseObj.expected);
                            expect(requestUtils.makeSignedRequest).toHaveBeenCalled();
                            expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' },
                                { updateRequest: 'ur-1', status: Status.Error }, 'cam-1');
                            expect(mockLog.error.calls.count()).toBe(1);
                            done();
                        });
                    });
                    
                    it('should log an additional error if re-locking the campaign fails', function(done) {
                        mongoUtils.editObject.and.returnValue(q.reject('Oh man everything is breaking'));
                        updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                            expect(errorSpy).toHaveBeenCalledWith('Failed editing campaign: ' + caseObj.expected);
                            expect(requestUtils.makeSignedRequest).toHaveBeenCalled();
                            expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' },
                                { updateRequest: 'ur-1', status: Status.Error }, 'cam-1');
                            expect(mockLog.error.calls.count()).toBe(2);
                            done();
                        });
                    });

                    it('should not attempt to re-lock the campaign if the update was auto-approved', function(done) {
                        delete req.origObj;
                        req.body.autoApproved = true;
                        updateModule.applyUpdate(svc, appCreds, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                            expect(errorSpy).toHaveBeenCalledWith('Failed editing campaign: ' + caseObj.expected);
                            expect(requestUtils.makeSignedRequest).toHaveBeenCalled();
                            expect(mongoUtils.editObject).not.toHaveBeenCalled();
                            expect(mockLog.error.calls.count()).toBe(1);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe('notifyOwner', function() {
        var svc, mockColl, mockCursor;
        beforeEach(function() {
            mockCursor = {
                next: jasmine.createSpy('cursor.next()').and.returnValue(q({ id: 'u-2', email: 'owner@c6.com' }))
            };
            mockColl = {
                find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor)
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { id: 'ur-1', campaign: 'cam-1', data: { foo: 'bar' }, status: Status.Approved };
            req.origObj = { id: 'ur-1', campaign: 'cam-1', data: { foo: 'baz' }, status: Status.Pending };
            req.campaign = { id: 'cam-1', name: 'camp 1', updateRequest: 'u-1', user: 'u-2' };
            spyOn(email, 'updateApproved').and.returnValue(q());
            spyOn(email, 'updateRejected').and.returnValue(q());
            svc = { _db: mockDb };
        });

        it('should look up the owner\'s email and send them a notification', function(done) {
           updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalledWith({ id: 'u-2' }, { fields: { id: 1, email: 1 }, limit: 1 });
                expect(email.updateApproved).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'owner@c6.com',
                    false,
                    'camp 1',
                    'http://seflie.c6.com/review/campaigns'
                );
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should send an alternate message if the update is being rejected', function(done) {
           req.body.status = Status.Rejected;
           req.body.rejectionReason = 'worst campaign ever';
           updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.updateRejected).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'owner@c6.com',
                    false,
                    'camp 1',
                    'http://seflie.c6.com/review/campaigns',
                    'worst campaign ever'
                );
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should inform the email lib if the update was an initial submit', function(done) {
            req.origObj.initialSubmit = true;
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
            req2.body.status = Status.Rejected;
            req2.body.rejectionReason = 'worst campaign ever';
            q.all([
                updateModule.notifyOwner(svc, req1, nextSpy, doneSpy).catch(errorSpy),
                updateModule.notifyOwner(svc, req2, nextSpy, doneSpy).catch(errorSpy)
            ]).then(function() {
                expect(nextSpy.calls.count()).toBe(2);
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(email.updateApproved).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'owner@c6.com',
                    true,
                    'camp 1',
                    'http://seflie.c6.com/review/campaigns'
                );
                expect(email.updateRejected).toHaveBeenCalledWith(
                    'no-reply@c6.com',
                    'owner@c6.com',
                    true,
                    'camp 1',
                    'http://seflie.c6.com/review/campaigns',
                    'worst campaign ever'
                );
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip if not approving or rejecting the update', function(done) {
            req.body.status = Status.Pending;
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).not.toHaveBeenCalled();
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should warn and continue if the user is not found', function(done) {
            mockCursor.next.and.returnValue(q());
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });

        
        it('should warn and continue if looking up the user fails', function(done) {
            mockCursor.next.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });
        
        it('should warn and continue if emailing the user fails', function(done) {
            email.updateApproved.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.find).toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('autoApprove', function() {
        var svc;
        beforeEach(function() {
            req.body = { status: Status.Pending, data: { foo: 'bar' } };
            svc = {
                customMethod: jasmine.createSpy('svc.customMethod()').and.callFake(function(req, action, cb) { return cb(); }),
                transformMongoDoc: jasmine.createSpy('svc.transformMongoDoc').and.callFake(function(obj) { return obj; }),
                formatOutput: jasmine.createSpy('svc.formatOutput').and.returnValue({ formatted: 'yes' }),
                _coll: 'fakeCollection'
            };
            spyOn(mongoUtils, 'createObject').and.returnValue(q({ id: 'cam-1', campaign: 'cam-1', created: 'yes' }));
        });
        
        it('should call customMethod and then create an object', function(done) {
            updateModule.autoApprove(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: { formatted: 'yes' } });
                expect(svc.customMethod).toHaveBeenCalledWith(req, 'autoApprove', jasmine.any(Function));
                expect(mongoUtils.createObject).toHaveBeenCalledWith('fakeCollection',
                    { status: Status.Approved, data: { foo: 'bar' }, autoApproved: true });
                expect(svc.transformMongoDoc).toHaveBeenCalledWith({ id: 'cam-1', campaign: 'cam-1', created: 'yes' });
                expect(svc.formatOutput).toHaveBeenCalledWith({ id: 'cam-1', campaign: 'cam-1', created: 'yes' });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done, done.fail);
        });
        
        it('should return the result of customMethod if it returns early', function(done) {
            svc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            updateModule.autoApprove(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mongoUtils.createObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if creating the object fails', function(done) {
            mongoUtils.createObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.autoApprove(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mongoUtils.createObject).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('produceNewUpdateRequest', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
            req.campaign = 'campaign';
            req.application = 'app';
            req.user = 'user';
        });
        
        it('should produce a newUpdateRequest event', function(done) {
            var mockResp = {
                code: 201,
                body: {
                    id: 'ur-123'
                }
            };
            req.campaign = 'campaign';
            streamUtils.produceEvent.and.returnValue(q());
            updateModule.produceNewUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('newUpdateRequest', {
                    application: 'app',
                    campaign: 'campaign',
                    updateRequest: {
                        id: 'ur-123'
                    },
                    user: 'user'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(resp).toBe(mockResp);
            }).then(done, done.fail);
        });
        
        it('should resolve and log an error if producing the event fails', function(done) {
            var mockResp = {
                code: 201,
                body: { }
            };
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            updateModule.produceNewUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
    });
    
    describe('produceEditUpdateRequest', function() {
        beforeEach(function() {
            spyOn(streamUtils, 'produceEvent');
            req.campaign = 'campaign';
        });
        
        it('should produce campaignApproved if approving an initial submit', function(done) {
            req.origObj = {
                status: 'pending',
                initialSubmit: true
            };
            req.body = {
                status: 'approved'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'approved'
                }
            };
            streamUtils.produceEvent.and.returnValue(q());
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('campaignApproved', {
                    campaign: 'campaign',
                    updateRequest: {
                        status: 'approved'
                    }
                });
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should produce campaignRejected if rejecting an initial submit', function(done) {
            req.origObj = {
                status: 'pending',
                initialSubmit: true
            };
            req.body = {
                status: 'rejected'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'rejected'
                }
            };
            streamUtils.produceEvent.and.returnValue(q());
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('campaignRejected', {
                    campaign: 'campaign',
                    updateRequest: {
                        status: 'rejected'
                    }
                });
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should produce campaignUpdateApproved if approving a subsequent update', function(done) {
            req.origObj = {
                status: 'pending',
                initialSubmit: false
            };
            req.body = {
                status: 'approved'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'approved'
                }
            };
            streamUtils.produceEvent.and.returnValue(q());
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('campaignUpdateApproved', {
                    campaign: 'campaign',
                    updateRequest: {
                        status: 'approved'
                    }
                });
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should produce campaignUpdateRejected if rejecting a subsequent update', function(done) {
            req.origObj = {
                status: 'pending',
                initialSubmit: false
            };
            req.body = {
                status: 'rejected'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'rejected'
                }
            };
            streamUtils.produceEvent.and.returnValue(q());
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('campaignUpdateRejected', {
                    campaign: 'campaign',
                    updateRequest: {
                        status: 'rejected'
                    }
                });
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should resolve an log and error if producing the event fails', function(done) {
            req.origObj = {
                status: 'pending',
                initialSubmit: false
            };
            req.body = {
                status: 'rejected'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'rejected'
                }
            };
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });

        it('should not produce if the edit does not approve or reject the request', function(done) {
            req.origObj = {
                status: 'pending'
            };
            var mockResp = {
                code: 200,
                body: {
                    status: 'pending'
                }
            };
            updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                expect(resp).toEqual(mockResp);
            }).then(done, done.fail);
        });
        
        it('should not produce if not given a successfull response', function(done) {
            q.all([{ code: 400, body: { } }, { code: 200, body: 'not an object' }].map(function(mockResp) {
                return updateModule.produceEditUpdateRequest(req, mockResp).then(function(resp) {
                    expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(resp).toEqual(mockResp);
                });
            })).then(done, done.fail);
        });
    });
});
