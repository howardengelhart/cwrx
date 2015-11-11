var flush = true;
var q = require('q');

describe('ads-campaignUpdates (UT)', function() {
    var mockLog, CrudSvc, Model, logger, updateModule, campaignUtils, requestUtils, Status,
        mongoUtils, campModule, email, nextSpy, doneSpy, errorSpy, req, mockDb;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        updateModule    = require('../../bin/ads-campaignUpdates');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        mongoUtils      = require('../../lib/mongoUtils');
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
        
        updateModule.config.campaigns = {
            statusDelay: 1000, statusAttempts: 10, campaignTypeId: 454545,
            dateDelays: { start: 100, end: 200 }
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
            }
        };
        updateModule.config.emails = {
            sender: 'no-reply@c6.com',
            supportAddress: 'support@c6.com',
            reviewLink: 'http://selfie.com/campaigns/:campId/admin',
            dashboardLink: 'http://seflie.c6.com/review/campaigns'
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
             'unlockCampaign', 'applyUpdate', 'notifyOwner'].forEach(function(method) {
                var fn = updateModule[method];
                spyOn(fn, 'bind').and.returnValue(fn);
            });
            spyOn(CrudSvc.prototype.setupObj, 'bind').and.returnValue(CrudSvc.prototype.setupObj);

            fakeCampModel = new Model('campaigns', {});
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
            expect(CrudSvc.prototype.setupObj.bind).toHaveBeenCalledWith(svc);
            expect(fakeAutoApproveModel.midWare.bind).toHaveBeenCalledWith(fakeAutoApproveModel, 'create');
        });
    });
    
    describe('campaignUpdate validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = updateModule.setupSvc(mockDb, campModule.setupSvc(mockDb, updateModule.config), updateModule.config);
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
        
        describe('autoApproved', function() {
            it('should always default to false', function() {
                requester.fieldValidation.campaignUpdates.autoApproved = { __allowed: true };
                newObj.autoApproved = true;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.autoApproved).toBe(false);
            });
        });
        
        describe('campaign', function() {
            it('should not be settable', function() {
                requester.fieldValidation.campaignUpdates.campaign = { __allowed: true };
                newObj.campaign = 'cam-fake';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaign).not.toBeDefined();
            });
        });
        
        describe('rejectionReason', function() {
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
        
        describe('data', function() {
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
        var campSvc, mockCamp;
        beforeEach(function() {
            mockCamp = { id: 'cam-1', name: 'camp 1', updateRequest: 'ur-1', user: 'u-1', org: 'o-1' };
            campSvc = campModule.setupSvc(mockDb, updateModule.config);
            spyOn(campSvc, 'getObjs').and.callFake(function() { return q({ code: 200, body: mockCamp }); });
            req.params.campId = 'cam-1';
            req.body = { data: { foo: 'bar' } };
            req.origObj = { id: 'ur-1' };
            req.user.permissions = { campaigns: { read: 'own', edit: 'own' } };
        });
        
        it('should attach the campaign as req.campaign and call next if it is found', function(done) {
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual(mockCamp);
                expect(req.body).toEqual({ campaign: 'cam-1', data: { foo: 'bar' } });
                done();
            });
        });
        
        it('should call done if a 4xx is returned', function(done) {
            campSvc.getObjs.and.returnValue(q({ code: 404, body: 'Campaign not found' }));
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 404, body: 'Campaign not found' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if the campaign has a different pending update request', function(done) {
            mockCamp.updateRequest = 'ur-2';
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Update request does not apply to this campaign' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done if the user does not have permission to edit the campaign', function(done) {
            mockCamp.user = 'u-2';
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to edit this campaign' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if campSvc.getObjs rejects', function(done) {
            campSvc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.fetchCamp(campSvc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                done();
            });
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
            expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.user);
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
                cards: undefined
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
                campaign: { campaign: 11, adtechName: 'adtech 1' }
            }];
            req.campaign.cards = [
                {
                    id: 'rc-1',
                    title: 'card 1',
                    campaign: { campaign: 11, adtechName: 'old name', startDate: 'right now' }
                },
                {
                    id: 'rc-2',
                    title: 'card 2',
                    campaign: { campaign: 12, adtechName: 'adtech 2' }
                }
            ];
            updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.user);
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
                campaign: { campaign: 11, adtechName: 'adtech 1' }
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
                        campaign: { campaign: 12, adtechName: 'adtech 2.1' }
                    }]
                } };
            });

            it('should preserve props from the origObj', function() {
                updateModule.validateData(model, req, nextSpy, doneSpy).catch(errorSpy);
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(model.validate).toHaveBeenCalledWith('create', req.body.data, req.campaign, req.user);
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
                    campaign: { campaign: 12, adtechName: 'adtech 2.1' }
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
            expect(campaignUtils.validatePricing).toHaveBeenCalledWith({ newCampaign: 'yes' }, { oldCampaign: 'yes' }, req.user, model, true);
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
    
    describe('handleInitialSubmit', function() {
        var svc;
        beforeEach(function() {
            req.campaign = {
                id: 'cam-1',
                status: Status.Draft,
                statusHistory: [{ userId: 'u-2', user: 'me@c6.com', date: new Date(), status: Status.Draft }]
            };
            req.body = { campaign: 'cam-1', data: {
                pricing: { budget: 1000, dailyLimit: 200, cost: 0.15, model: 'cpv' },
                paymentMethod: 'infinite money',
                status: Status.Active
            } };
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
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
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(req1.body.initialSubmit).not.toBeDefined();
                expect(req2.body.initialSubmit).not.toBeDefined();
                done();
            });
        });
        
        it('should check that required fields exist and then change the status of the campaign', function(done) {
            var statHistory = [
                { userId: 'u-1', user: 'selfie@c6.com', date: jasmine.any(Date), status: Status.Pending },
                { userId: 'u-2', user: 'me@c6.com', date: jasmine.any(Date), status: Status.Draft }
            ];
            updateModule.handleInitialSubmit(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.initialSubmit).toBe(true);
                expect(req.body.data.statusHistory).toEqual(statHistory);
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' }, {
                    status: Status.Pending,
                    statusHistory: statHistory
                }, 'cam-1');
                done();
            });
        });
        
        it('should call done if the campaign is missing certain required fields', function(done) {
            q.all(['paymentMethod', 'pricing', ['pricing', 'budget'], ['pricing', 'dailyLimit'], ['pricing', 'cost']].map(function(field) {
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
                expect(doneSpy.calls.count()).toBe(5);
                expect(doneSpy.calls.argsFor(0)).toEqual([{ code: 400, body: 'Missing required field: paymentMethod' }]);
                expect(doneSpy.calls.argsFor(1)).toEqual([{ code: 400, body: 'Missing required field: pricing' }]);
                expect(doneSpy.calls.argsFor(2)).toEqual([{ code: 400, body: 'Missing required field: budget' }]);
                expect(doneSpy.calls.argsFor(3)).toEqual([{ code: 400, body: 'Missing required field: dailyLimit' }]);
                expect(doneSpy.calls.argsFor(4)).toEqual([{ code: 400, body: 'Missing required field: cost' }]);
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done, done.fail);
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            updateModule.handleInitialSubmit(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
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
                    'selfie@c6.com',
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
                findAndModify: jasmine.createSpy('coll.findAndModify').and.callFake(function(query, sort, updates, opts, cb) {
                    cb();
                })
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
                expect(mockColl.findAndModify).toHaveBeenCalledWith(
                    { id: 'cam-1' }, { id: 1 },
                    {
                        $set: { lastUpdated: jasmine.any(Date), updateRequest: 'ur-1' },
                        $unset: { rejectionReason: 1 },
                    },
                    { w: 1, journal: true, new: true }, jasmine.any(Function)
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mockColl.findAndModify.and.callFake(function(query, sort, updates, opts, cb) { cb('I GOT A PROBLEM'); });
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
                findAndModify: jasmine.createSpy('coll.findAndModify').and.callFake(function(query, sort, updates, opts, cb) {
                    cb();
                })
            };
            mockDb.collection.and.returnValue(mockColl);
            req.body = { id: 'ur-1', campaign: 'cam-1', data: {}, status: Status.Approved };
            req.origObj = { id: 'ur-1', campaign: 'cam-1', data: {}, status: Status.Pending };
            req.campaign = {
                id: 'cam-1', name: 'camp 1', updateRequest: 'u-1', status: Status.Active,
                statusHistory: [{ userId: 'u-2', user: 'me@c6.com', status: Status.Active, date: new Date() }]
            };
            svc = { _db: mockDb };
        });
        
        it('should remove the updateRequest prop on the campaign and call next', function(done) {
            updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.findAndModify).toHaveBeenCalledWith(
                    { id: 'cam-1' }, { id: 1 },
                    {
                        $set: { lastUpdated: jasmine.any(Date) },
                        $unset: { updateRequest: 1 },
                    },
                    { w: 1, journal: true, new: true }, jasmine.any(Function)
                );
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        describe('if the updateRequest is being rejected', function() {
            beforeEach(function() {
                req.body.status = Status.Rejected;
                req.body.rejectionReason = 'worst campaign ever';
            });
    
            it('should also save the rejectionReason on the campaign', function(done) {
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(mockColl.findAndModify).toHaveBeenCalledWith(
                        { id: 'cam-1' }, { id: 1 },
                        {
                            $set: { lastUpdated: jasmine.any(Date), rejectionReason: 'worst campaign ever' },
                            $unset: { updateRequest: 1 },
                        },
                        { w: 1, journal: true, new: true }, jasmine.any(Function)
                    );
                    done();
                });
            });
            
            it('should switch the status back to draft if the update was an initial approval request', function(done) {
                req.campaign.status = Status.Pending;
                req.campaign.statusHistory[0].status = Status.Pending;
                req.body.data.status = Status.Active;
                updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy);
                process.nextTick(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                    expect(mockColl.findAndModify).toHaveBeenCalledWith(
                        { id: 'cam-1' }, { id: 1 },
                        {
                            $set: {
                                lastUpdated: jasmine.any(Date),
                                rejectionReason: 'worst campaign ever',
                                status: Status.Draft,
                                statusHistory: [
                                    { userId: 'u-1', user: 'selfie@c6.com', status: Status.Draft, date: jasmine.any(Date) },
                                    { userId: 'u-2', user: 'me@c6.com', status: Status.Pending, date: jasmine.any(Date) }
                                ]
                            },
                            $unset: { updateRequest: 1 },
                        },
                        { w: 1, journal: true, new: true }, jasmine.any(Function)
                    );
                    done();
                });
            });
        });

        it('should skip if the update is not being approved or rejected', function(done) {
            req.body.status = Status.Pending;
            updateModule.unlockCampaign(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.findAndModify).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if editing the campaign fails', function(done) {
            mockColl.findAndModify.and.callFake(function(query, sort, updates, opts, cb) { cb('I GOT A PROBLEM'); });
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
            spyOn(requestUtils, 'qRequest').and.returnValue(q({ response: { statusCode: 200 }, body: { camp: 'yes' } }));
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            svc = { _db: mockDb };
        });
        
        it('should edit the campaign with a PUT request', function(done) {
            updateModule.applyUpdate(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest).toHaveBeenCalledWith('put', {
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
            updateModule.applyUpdate(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should still edit the campaign if the request is autoApproved', function(done) {
            delete req.origObj;
            req.body.autoApproved = true;
            updateModule.applyUpdate(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(requestUtils.qRequest).toHaveBeenCalledWith('put', {
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
                        requestUtils.qRequest.and.returnValue(caseObj.respValue);
                    });
                    
                    it('should attempt to re-lock the campaign and reject', function(done) {
                        updateModule.applyUpdate(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                            expect(errorSpy).toHaveBeenCalledWith('Failed editing campaign: ' + caseObj.expected);
                            expect(requestUtils.qRequest).toHaveBeenCalled();
                            expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' },
                                { updateRequest: 'ur-1', status: Status.Error }, 'cam-1');
                            expect(mockLog.error.calls.count()).toBe(1);
                            done();
                        });
                    });
                    
                    it('should log an additional error if re-locking the campaign fails', function(done) {
                        mongoUtils.editObject.and.returnValue(q.reject('Oh man everything is breaking'));
                        updateModule.applyUpdate(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(doneSpy).not.toHaveBeenCalled();
                            expect(errorSpy).toHaveBeenCalledWith('Failed editing campaign: ' + caseObj.expected);
                            expect(requestUtils.qRequest).toHaveBeenCalled();
                            expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'campaigns' },
                                { updateRequest: 'ur-1', status: Status.Error }, 'cam-1');
                            expect(mockLog.error.calls.count()).toBe(2);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe('notifyOwner', function() {
        var svc, mockColl;
        beforeEach(function() {
            mockColl = {
                findOne: jasmine.createSpy('coll.findOne').and.callFake(function(query, opts, cb) {
                    cb(null, { id: 'u-2', email: 'owner@c6.com' });
                })
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
                expect(mockColl.findOne).toHaveBeenCalledWith({ id: 'u-2' }, { fields: { id: 1, email: 1 } }, jasmine.any(Function));
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
                expect(mockColl.findOne).toHaveBeenCalled();
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
                expect(mockColl.findOne).not.toHaveBeenCalled();
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should warn and continue if the user is not found', function(done) {
            mockColl.findOne.and.callFake(function(query, opts, cb) { cb(); });
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).toHaveBeenCalled();
                expect(email.updateApproved).not.toHaveBeenCalled();
                expect(email.updateRejected).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });

        
        it('should warn and continue if looking up the user fails', function(done) {
            mockColl.findOne.and.callFake(function(query, opts, cb) { cb('I GOT A PROBLEM'); });
            updateModule.notifyOwner(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockColl.findOne).toHaveBeenCalled();
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
                expect(mockColl.findOne).toHaveBeenCalled();
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
});

