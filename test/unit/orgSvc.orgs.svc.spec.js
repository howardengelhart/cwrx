var flush = true;
var objUtils = require('../../lib/objUtils');
var util = require('util');
var ld = require('lodash');

describe('orgSvc-orgs (UT)', function() {
    var orgModule, q, mockLog, mockLogger, logger, CrudSvc, Model, enums, Status, Scope,
        mockDb, mockGateway, req, nextSpy, doneSpy, errorSpy, requestUtils, moment, mongoUtils, mockConfig;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        orgModule       = require('../../bin/orgSvc-orgs');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        enums           = require('../../lib/enums');
        mongoUtils      = require('../../lib/mongoUtils');
        streamUtils     = require('../../lib/streamUtils');
        requestUtils    = require('../../lib/requestUtils');
        moment          = require('moment');
        Status          = enums.Status;
        Scope           = enums.Scope;

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
        spyOn(streamUtils, 'createProducer');
        spyOn(streamUtils, 'produceEvent');
        spyOn(orgModule, 'producePaymentPlanChanged').and.callFake(function (req, resp) {
            return q.resolve(resp);
        });

        jasmine.clock().install();
        jasmine.clock().mockDate(new Date());

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' }, requester: { id: 'u-1', permissions: {} } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        orgModule.api = {
            root: 'https://test.com',
            transactions: {
                baseUrl: 'https://test.com/api/transactions/',
                endpoint: '/api/transactions/'
            }
        };
        mockGateway = {
            customer: {
                delete: jasmine.createSpy('gateway.customer.delete()')
            }
        };
        mockConfig = {
            kinesis: {
                foo: 'bar'
            }
        };
    });

    afterEach(function () {
        jasmine.clock().uninstall();
    });

    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            [CrudSvc.prototype.validateUniqueProp, orgModule.activeUserCheck].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });

            svc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'orgs' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('orgs');
            expect(svc._prefix).toBe('o');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._ownedByUser).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(orgModule.orgSchema);
        });

        it('should check special permissions on create', function() {
            expect(svc._middleware.create).toContain(orgModule.createPermCheck);
        });

        it('should setup the org\'s config on create', function() {
            expect(svc._middleware.create).toContain(orgModule.setupConfig);
        });

        it('should make sure the name is unique on create and edit', function() {
            expect(svc._middleware.create).toContain(svc.validateUniqueProp);
            expect(svc._middleware.edit).toContain(svc.validateUniqueProp);
            expect(CrudSvc.prototype.validateUniqueProp.bind).toHaveBeenCalledWith(svc, 'name', null);
        });

        it('should check special permissions on delete', function() {
            expect(svc._middleware.delete).toContain(orgModule.deletePermCheck);
        });

        it('should prevent deleting active orgs with active users', function() {
            expect(svc._middleware.delete).toContain(orgModule.activeUserCheck);
            expect(orgModule.activeUserCheck.bind).toHaveBeenCalledWith(orgModule, svc);
        });

        it('should create a producer', function () {
            expect(streamUtils.createProducer).toHaveBeenCalledWith(mockConfig.kinesis);
        });
    });

    describe('org validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { orgs: {} } };
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

        describe('when handling adConfig', function() {
            it('should trim the field if set', function() {
                newObj.adConfig = { ads: 'yes' };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });

            it('should be able to allow some requesters to set the field', function() {
                newObj.adConfig = { ads: 'yes' };
                requester.fieldValidation.orgs.adConfig = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test', adConfig: { ads: 'yes' } });
            });

            it('should fail if the field is not an object', function() {
                newObj.adConfig = [{ ads: 'yes' }, { moreAds: 'no' }];
                requester.fieldValidation.orgs.adConfig = { __allowed: true };

                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'adConfig must be in format: object' });
            });
        });

        // config objects
        ['config', 'waterfalls'].forEach(function(field) {
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

        ['braintreeCustomer', 'referralCode', 'paymentPlanId'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = '123456';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test' });
                });

                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = '123456';
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('123456');
                });

                it('should fail if the field is not a string', function() {
                    newObj[field] = 123456;
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
            });
        });

        ['paymentPlanStart'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should trim the field if set', function() {
                    newObj[field] = new Date().toISOString();
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj).toEqual({ name: 'test' });
                });

                it('should be able to allow some requesters to set the field', function() {
                    newObj[field] = new Date().toISOString();
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(new Date());
                });

                it('should fail if the field is not a Date', function() {
                    newObj[field] = 'whaddup homes';
                    requester.fieldValidation.orgs[field] = { __allowed: true };

                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: Date' });
                });
            });
        });

        describe('when handling promotions', function() {
            beforeEach(function() {
                requester.fieldValidation.orgs.promotions = {};
            });

            it('should trim the field if set', function() {
                newObj.promotions = [{ id: 'pro-1', date: new Date() }];
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.promotions).not.toBeDefined();
            });

            describe('if the requester can set the field', function() {
                beforeEach(function() {
                    requester.fieldValidation.orgs.promotions.__allowed = true;
                });

                it('should succeed', function() {
                    newObj.promotions = [{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Active
                    }];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.promotions).toEqual([{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Active
                    }]);
                });

                it('should cast string dates into Date objects', function() {
                    newObj.promotions = [{
                        id: 'pro-1',
                        created: '2016-02-20T00:25:32.645Z',
                        lastUpdated: '2016-04-10T00:25:32.645Z',
                        status: Status.Canceled
                    }];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.promotions).toEqual([{
                        id: 'pro-1',
                        created: new Date('2016-02-20T00:25:32.645Z'),
                        lastUpdated: new Date('2016-04-10T00:25:32.645Z'),
                        status: Status.Canceled
                    }]);
                });

                it('should fail if the field is not an object array', function() {
                    newObj.promotions = ['foo', 'bar'];
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'promotions must be in format: objectArray' });
                });

                it('should fail if any entry subfields are in the wrong format', function() {
                    var base = {
                        id: 'pro-1',
                        created: '2016-02-20T00:25:32.645Z',
                        lastUpdated: '2016-04-10T00:25:32.645Z',
                        status: Status.Canceled
                    };

                    var resps = [{ id: 123 }, { created: 'today' }, { lastUpdated: 432 }, { status: 4331 }].map(function(obj) {
                        newObj.promotions = [obj];
                        objUtils.extend(newObj.promotions[0], base);
                        return svc.model.validate('create', newObj, origObj, requester);
                    });
                    expect(resps[0]).toEqual({ isValid: false, reason: 'promotions[0].id must be in format: string' });
                    expect(resps[1]).toEqual({ isValid: false, reason: 'promotions[0].created must be in format: Date' });
                    expect(resps[2]).toEqual({ isValid: false, reason: 'promotions[0].lastUpdated must be in format: Date' });
                    expect(resps[3]).toEqual({ isValid: false, reason: 'promotions[0].status must be in format: string' });
                });
            });
        });
    });

    describe('createPermCheck', function() {
        beforeEach(function() {
            req.requester.permissions = { orgs: { create: Scope.All } };
        });

        it('should call next if the requester has admin-level create priviledges', function(done) {
            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if the requester does not have admin-level create priviledges', function(done) {
            req.requester.permissions.orgs.create = Scope.Own;

            orgModule.createPermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to create orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('setupConfig', function() {
        beforeEach(function() {
            req.body = { id: 'o-1', name: 'new org' };
        });

        it('should initialize some props on the new org and call next', function(done) {
            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({});
                expect(req.body.waterfalls).toEqual({ video: ['cinema6'], display: ['cinema6'] });
                done();
            });
        });

        it('should respect user-defined values', function(done) {
            req.body.config = { foo: 'bar' };
            req.body.waterfalls = { video: ['mine'] };

            orgModule.setupConfig(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();

                expect(req.body.config).toEqual({ foo: 'bar' });
                expect(req.body.waterfalls).toEqual({ video: ['mine'], display: ['cinema6'] });
                done();
            });
        });
    });

    describe('deletePermCheck', function() {
        beforeEach(function() {
            req.requester.permissions = { orgs: { delete: Scope.All } };
            req.params = { id: 'o-2' };
        });

        it('should call done if a user tries deleting their own org', function(done) {
            req.params.id = req.user.org;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'You cannot delete your own org' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done if a user does not have admin delete priviledges', function(done) {
            req.requester.permissions.orgs.delete = Scope.Own;
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to delete orgs' });
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if everything checks out', function(done) {
            orgModule.deletePermCheck(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('activeUserCheck', function() {
        var orgSvc, mockColl;
        beforeEach(function() {
            req.params = { id: 'o-2' };

            mockColl = {
                count: jasmine.createSpy('cursor.count').and.returnValue(q(3))
            };
            mockDb.collection.and.returnValue(mockColl);

            orgSvc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
        });

        it('should call done if the org still has active users', function(done) {
            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has active users' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('users');
                expect(mockColl.count).toHaveBeenCalledWith({ org: 'o-2', status: { $ne: Status.Deleted } });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if the org has no active users', function(done) {
            mockColl.count.and.returnValue(q(0));

            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));

            orgModule.activeUserCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('runningCampaignCheck', function() {
        var orgSvc, mockColl;
        beforeEach(function() {
            req.params = { id: 'o-2' };

            mockColl = {
                count: jasmine.createSpy('cursor.count').and.returnValue(q(3))
            };
            mockDb.collection.and.returnValue(mockColl);

            orgSvc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
        });

        it('should call done if the org still has unfinished campaigns', function(done) {
            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Org still has unfinished campaigns' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.count).toHaveBeenCalledWith({
                    org: 'o-2',
                    status: { $in: [Status.Active, Status.Paused] }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call next if the org has no unfinished campaigns', function(done) {
            mockColl.count.and.returnValue(q(0));

            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));

            orgModule.runningCampaignCheck(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('deleteBraintreeCustomer', function() {
        beforeEach(function() {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                cb();
            });

            req.origObj = { id: 'o-1', braintreeCustomer: '123456' };
        });

        it('should successfully delete a braintree customer', function(done) {
            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).toHaveBeenCalledWith('123456', jasmine.any(Function));
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if no braintreeCustomer is on the org', function(done) {
            delete req.origObj.braintreeCustomer;
            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should just log a warning if the customer does not exist', function(done) {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                var error = new Error('Customer not found');
                error.name = 'notFoundError';
                cb(error);
            });

            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockGateway.customer.delete).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if braintree returns a different error', function(done) {
            mockGateway.customer.delete.and.callFake(function(id, cb) {
                var error = new Error('I GOT A PROBLEM');
                error.name = 'badError';
                cb(error);
            });

            orgModule.deleteBraintreeCustomer(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Braintree error');
                expect(mockGateway.customer.delete).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('producePaymentPlanChanged', function () {
        beforeEach(function () {
            this.org = {
                id: 'o-123',
                status: 'active',
                paymentPlanId: 'pp-456'
            };
            this.resp = {
                code: 200,
                body: { }
            }
            req.origObj = {
                id: 'o-123',
                status: 'active',
                paymentPlanId: 'pp-123'
            };
            orgModule.producePaymentPlanChanged.and.callThrough();
        });

        it('should produce an event if the payment plan changed', function (done) {
            var self = this;
            self.resp.body.paymentPlanId = 'pp-456';
            streamUtils.produceEvent.and.returnValue(q.resolve());
            orgModule.producePaymentPlanChanged(req, self.resp, self.org).then(function (resp) {
                expect(streamUtils.produceEvent).toHaveBeenCalledWith('paymentPlanChanged', {
                    date: new Date(),
                    org: self.org,
                    previousPaymentPlanId: 'pp-123',
                    currentPaymentPlanId: 'pp-456'
                });
                expect(resp).toBe(self.resp);
            }).then(done, done.fail);
        });

        it('should not produce an event if the payment plan did not change', function(done) {
            var self = this;
            self.resp.body.paymentPlanId = 'pp-123';
            streamUtils.produceEvent.and.returnValue(q.resolve());
            orgModule.producePaymentPlanChanged(req, self.resp, self.org).then(function (resp) {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                expect(resp).toBe(self.resp);
            }).then(done, done.fail);
        });

        it('should handle a failure to produce the event', function (done) {
            var self = this;
            streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
            orgModule.producePaymentPlanChanged(req, self.resp, self.org).then(function (resp) {
                expect(mockLog.error).toHaveBeenCalled();
                expect(resp).toBe(self.resp);
            }).then(done, done.fail);
        });

        it('should not produce an event if the resposne has an unsuccessful status code', function (done) {
            var self = this;
            self.resp.code = 500;
            orgModule.producePaymentPlanChanged(req, self.resp, self.org).then(function (resp) {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
                expect(resp).toBe(self.resp);
            }).then(done, done.fail);
        });
    });

    describe('getPaymentPlan', function() {
        beforeEach(function() {
            this.req = {
                params: {
                    id: 'o-123'
                },
                query: { }
            };
            this.mockOrg = {
                id: 'o-123',
                paymentPlanId: 'pp-123',
                nextPaymentPlanId: 'pp-456'
            };
            this.svc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
            spyOn(this.svc, 'getObjs').and.returnValue(q.resolve({
                code: 200,
                body: [this.mockOrg]
            }));
            spyOn(requestUtils, 'proxyRequest').and.returnValue(q.resolve({
                response: {
                    statusCode: 200
                },
                body: {
                    cycleEnd: new Date()
                }
            }));
        });

        it('should get the requested org\'s payment plan from mongo', function(done) {
            var self = this;
            orgModule.getPaymentPlan(self.svc, this.req).then(function() {
                expect(self.svc.getObjs).toHaveBeenCalledWith({ id: 'o-123' }, {
                    params: {
                        id: 'o-123'
                    },
                    query: {
                        fields: 'paymentPlanId,nextPaymentPlanId'
                    }
                }, false);
            }).then(done, done.fail);
        });

        it('should proxy a request to the accountant service to get the billing cycle end', function(done) {
            var self = this;
            orgModule.getPaymentPlan(self.svc, self.req).then(function(result) {
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(self.req, 'get', {
                    url: 'https://test.com/api/transactions/showcase/current-payment',
                    qs: {
                        org: 'o-123'
                    }
                });
            }).then(done, done.fail);
        });

        it('should be able to resolve with a 200 and any current and pending payment plan', function(done) {
            orgModule.getPaymentPlan(this.svc, this.req).then(function(result) {
                expect(result).toEqual({
                    code: 200,
                    body: {
                        id: 'o-123',
                        paymentPlanId: 'pp-123',
                        nextPaymentPlanId: 'pp-456',
                        effectiveDate: moment().add(1, 'day').startOf('day').utcOffset(0).toDate()
                    }
                });
            }).then(done, done.fail);
        });

        it('should properly set the effective date in the response when there is not a next payment plan', function(done) {
            this.mockOrg.nextPaymentPlanId = null;
            orgModule.getPaymentPlan(this.svc, this.req).then(function(result) {
                expect(result).toEqual({
                    code: 200,
                    body: {
                        id: 'o-123',
                        paymentPlanId: 'pp-123',
                        nextPaymentPlanId: null,
                        effectiveDate: null
                    }
                });
            }).then(done, done.fail);
        });

        it('should be able to resolve with a 404 if there is no such org', function(done) {
            this.svc.getObjs.and.returnValue(q.resolve({
                code: 404,
                body: 'Object not found'
            }));
            orgModule.getPaymentPlan(this.svc, this.req).then(function(result) {
                expect(result).toEqual({
                    code: 404,
                    body: 'Object not found'
                });
            }).then(done, done.fail);
        });

        it('should reject if an error occurs querying from mongo', function(done) {
            this.svc.getObjs.and.returnValue(q.reject(new Error('epic fail')));
            orgModule.getPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                expect(error.message).toBe('epic fail');
            }).then(done, done.fail);
        });

        it('should handle when the request for the billing cycle responds with an unsuccessful status code', function(done) {
            requestUtils.proxyRequest.and.returnValue(q.resolve({
                response: {
                    statusCode: 404
                },
                body: 'epic fail'
            }));
            orgModule.getPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                expect(error.message).toBe('there was an error finding the current payment cycle');
                expect(mockLog.warn).toHaveBeenCalled();
            }).then(done, done.fail);
        });

        it('should reject if an error occurs proxying a request to the accountant service', function(done) {
            requestUtils.proxyRequest.and.returnValue(q.reject(new Error('epic fail')));
            orgModule.getPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                expect(error.message).toBe('epic fail');
            }).then(done, done.fail);
        });
    });

    describe('setPaymentPlan', function() {
        beforeEach(function() {
            var self = this;

            self.req = {
                body: { },
                params: {
                    id: 'o-123'
                },
                query: {
                    foo: 'bar'
                }
            };
            self.svc = orgModule.setupSvc(mockDb, mockGateway, mockConfig);
            self.paymentPlans = [
                { id: 'pp-123', price: 10 },
                { id: 'pp-456', price: 20 },
                { id: 'pp-789', price: 30 }
            ];
            mockColl = {
                find: jasmine.createSpy('find').and.callFake(function (query) {
                    var ids = query.id.$in ? query.id.$in : [query.id];
                    var docs = ids.map(function (id) {
                        return ld.find(self.paymentPlans, function (paymentPlan) {
                            return paymentPlan.id === id;
                        });
                    }).filter(function (found) {
                        return found;
                    });
                    return {
                        toArray: function () {
                            return q.resolve(docs);
                        }
                    };
                })
            };
            mockDb.collection.and.returnValue(mockColl);
            streamUtils.produceEvent.and.returnValue(q.resolve());
            var futureDate = new Date(2100);
            self.mockOrg = {
                id: 'o-123',
                paymentPlanId: null,
                nextPaymentPlanId: null,
                nextPaymentDate: futureDate
            };
            spyOn(self.svc, 'getObjs').and.callFake(function () {
                return q.resolve({
                    code: 200,
                    body: [ld.assign({ }, self.mockOrg)]
                });
            });
            spyOn(mongoUtils, 'editObject').and.callFake(function (coll, updates) {
                return q.resolve(ld.assign(self.mockOrg, updates));
            });
            spyOn(requestUtils, 'proxyRequest').and.returnValue(q.resolve({
                response: {
                    statusCode: 200
                },
                body: {
                    cycleEnd: new Date()
                }
            }));
        });

        it('should resolve with a 400 if not given a payment plan id', function(done) {
            orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                expect(result).toEqual({
                    code: 400,
                    body: 'Must provide the id of the payment plan'
                });
            }).then(done, done.fail);
        });

        describe('getting the org', function() {
            beforeEach(function() {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-456';
            });

            it('should work', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function() {
                    var args = self.svc.getObjs.calls.mostRecent().args;
                    expect(args.length).toBe(3);
                    expect(args[0]).toEqual({ id: 'o-123' });
                    expect(args[1]).toEqual(jasmine.objectContaining({
                        query: {
                            fields: 'paymentPlanId,nextPaymentPlanId'
                        }
                    }));
                    expect(args[2]).toBe(false);
                }).then(done, done.fail);
            });

            it('should exit if the org does not exist', function(done) {
                var getObjsResult = {
                    code: 404,
                    body: 'Object not found'
                };
                this.svc.getObjs.and.returnValue(q.resolve(getObjsResult));
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(result).toEqual(getObjsResult);
                }).then(done, done.fail);
            });

            it('should reject if getting the org fails', function(done) {
                this.svc.getObjs.and.returnValue(q.reject(new Error('epic fail')));
                orgModule.setPaymentPlan(this.svc, this.req).then(function(value) {
                    done.fail('should not have fulfilled with ' + util.inspect(value));
                }).catch(function(error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });

            it('should store the original object on the request', function (done) {
                var self = this;
                var origOrg = ld.assign({ }, self.mockOrg);
                orgModule.setPaymentPlan(self.svc, self.req).then(function () {
                    expect(self.req.origObj).toEqual(origOrg);
                }).then(done, done.fail);
            });
        });

        describe('getting the payment plans from mongo', function() {
            it('should not happen if the payment plans are identical', function(done) {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-456';
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(mockDb.collection).not.toHaveBeenCalledWith('paymentPlans');
                    expect(mockColl.find).not.toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should happen if the payment plans are different', function(done) {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-789';
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(mockDb.collection).toHaveBeenCalledWith('paymentPlans');
                    expect(mockColl.find).toHaveBeenCalledWith({
                        id: {
                            $in: ['pp-456', 'pp-789']
                        }
                    }, {
                        _id: 0
                    });
                }).then(done, done.fail);
            });

            it('should 400 if the given payment plan does not exist in mongo', function(done) {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-789';
                this.paymentPlans = [{ id: 'pp-789' }];
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(result).toEqual({
                        code: 400,
                        body: 'that payment plan does not exist'
                    });
                }).then(done, done.fail);
            });

            it('should handle if the payment plan on the org does not exist in mongo', function(done) {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-789';
                this.paymentPlans = [{ id: 'pp-456' }];
                orgModule.setPaymentPlan(this.svc, this.req).then(function () {
                    done.fail('the promise should not have resolved');
                }).catch(function(error) {
                    expect(error.message).toBe('there is a problem with the current payment plan');
                    expect(mockLog.error).toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should reject if there is a problem querying mongo for the payment plans', function(done) {
                this.req.body.id = 'pp-456';
                this.mockOrg.paymentPlanId = 'pp-789';
                mockColl.find.and.returnValue({
                    toArray: function () {
                        return q.reject(new Error('epic fail'));
                    }
                });
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });
        });

        describe('when upgrading the payment plan', function() {
            beforeEach(function() {
                this.mockOrg.paymentPlanId = 'pp-456';
                this.req.body.id = 'pp-789';
            });

            it('should edit the org with payment plan ids', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function() {
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(self.svc._coll, {
                        id: 'o-123',
                        paymentPlanId: 'pp-789',
                        nextPaymentPlanId: null
                    }, 'o-123');
                }).then(done, done.fail);
            });

            it('should be able to resolve with a 200', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(result).toEqual({
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-789',
                            nextPaymentPlanId: null,
                            effectiveDate: new Date()
                        }
                    });
                }).then(done, done.fail);
            });

            it('should not make a request to get the end date of the billing cycle', function(done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should reject if editing the org fails', function(done) {
                mongoUtils.editObject.and.returnValue(q.reject(new Error('epic fail')));
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });

            it('should potentially produce an event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(orgModule.producePaymentPlanChanged).toHaveBeenCalledWith(self.req, {
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-789',
                            nextPaymentPlanId: null,
                            effectiveDate: new Date()
                        }
                    }, self.mockOrg);
                }).then(done, done.fail);
            });

            it('should not produce a payment plan pending event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    var calls = streamUtils.produceEvent.calls.all();
                    calls.forEach(function (call) {
                        expect(call.args[0]).not.toBe('pendingPaymentPlanChanged');
                    });
                }).then(done, done.fail);
            });
        });

        describe('when downgrading the payment plan', function() {
            beforeEach(function() {
                this.mockOrg.paymentPlanId = 'pp-456';
                this.req.body.id = 'pp-123';
            });

            it('should edit the org with payment plan ids', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function() {
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(self.svc._coll, {
                        id: 'o-123',
                        paymentPlanId: 'pp-456',
                        nextPaymentPlanId: 'pp-123'
                    }, 'o-123');
                }).then(done, done.fail);
            });

            it('should be able to resolve with a 200', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(result).toEqual({
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-456',
                            nextPaymentPlanId: 'pp-123',
                            effectiveDate: moment().add(1, 'day').startOf('day').utcOffset(0).toDate()
                        }
                    });
                }).then(done, done.fail);
            });

            it('should make a request to get the end date of the billing cycle', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(requestUtils.proxyRequest).toHaveBeenCalledWith(self.req, 'get', {
                        url: 'https://test.com/api/transactions/showcase/current-payment',
                        qs: {
                            org: 'o-123'
                        }
                    });
                }).then(done, done.fail);
            });

            it('should handle if the billing cycle response indicates a failure', function(done) {
                requestUtils.proxyRequest.and.returnValue(q.resolve({
                    response: {
                        statusCode: 500
                    }
                }));
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function (error) {
                    expect(error.message).toBe('there was an error finding the current payment cycle');
                    expect(mockLog.warn).toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should reject if the request for the billing cycle fails', function(done) {
                requestUtils.proxyRequest.and.returnValue(q.reject(new Error('epic fail')));
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function (error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });

            it('should reject if editing the org fails', function(done) {
                mongoUtils.editObject.and.returnValue(q.reject(new Error('epic fail')));
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });

            it('should potentially produce an event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(orgModule.producePaymentPlanChanged).toHaveBeenCalledWith(self.req, {
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-456',
                            nextPaymentPlanId: 'pp-123',
                            effectiveDate: moment().add(1, 'day').startOf('day').utcOffset(0).toDate()
                        }
                    }, self.mockOrg);
                }).then(done, done.fail);
            });

            it('should produce a payment plan pending event', function (done) {
                var self = this;

                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(streamUtils.produceEvent).toHaveBeenCalledWith('pendingPaymentPlanChanged', {
                        date: jasmine.any(Date),
                        org: jasmine.any(Object),
                        currentPaymentPlan: self.paymentPlans[1],
                        pendingPaymentPlan: self.paymentPlans[0],
                        effectiveDate: moment().add(1, 'day').startOf('day').utcOffset(0).toDate()
                    });
                }).then(done, done.fail);
            });

            it('should not produce a payment plan pending event if the pending payment plan is not being changed', function (done) {
                var self = this;
                this.mockOrg.nextPaymentPlanId = 'pp-123';
                orgModule.setPaymentPlan(self.svc, self.req).then(function (result) {
                    var calls = streamUtils.produceEvent.calls.all();
                    calls.forEach(function (call) {
                        expect(call.args[0]).not.toBe('pendingPaymentPlanChanged');
                    });
                }).then(done, done.fail);
            });

            it('should handle if producing the payment plan pending event fails', function (done) {
                var self = this;
                streamUtils.produceEvent.and.returnValue(q.reject('epic fail'));
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(mockLog.error).toHaveBeenCalled();
                }).then(done, done.fail);
            });
        });

        describe('when setting the payment plan for the first time', function() {
            beforeEach(function() {
                this.mockOrg.paymentPlanId = null;
                this.req.body.id = 'pp-123';
            });

            it('should edit the org with payment plan ids', function(done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function() {
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(self.svc._coll, {
                        id: 'o-123',
                        paymentPlanId: 'pp-123',
                        nextPaymentPlanId: null
                    }, 'o-123');
                }).then(done, done.fail);
            });

            it('should be able to resolve with a 200', function(done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(result).toEqual({
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-123',
                            nextPaymentPlanId: null,
                            effectiveDate: new Date()
                        }
                    });
                }).then(done, done.fail);
            });

            it('should not make a request to get the end date of the billing cycle', function(done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should reject if editing the org fails', function(done) {
                mongoUtils.editObject.and.returnValue(q.reject(new Error('epic fail')));
                orgModule.setPaymentPlan(this.svc, this.req).then(done.fail, function(error) {
                    expect(error.message).toBe('epic fail');
                }).then(done, done.fail);
            });

            it('should potentially produce an event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    expect(orgModule.producePaymentPlanChanged).toHaveBeenCalledWith(self.req, {
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-123',
                            nextPaymentPlanId: null,
                            effectiveDate: new Date()
                        }
                    }, self.mockOrg);
                }).then(done, done.fail);
            });

            it('should not produce a payment plan pending event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    var calls = streamUtils.produceEvent.calls.all();
                    calls.forEach(function (call) {
                        expect(call.args[0]).not.toBe('pendingPaymentPlanChanged');
                    });
                }).then(done, done.fail);
            });
        });

        describe('when setting a payment plan which is already set', function() {
            beforeEach(function() {
                this.mockOrg.paymentPlanId = 'pp-456';
                this.req.body.id = 'pp-456';
            });

            it('should set the next payment plan id to null', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function() {
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(self.svc._coll, {
                        nextPaymentPlanId: null
                    }, 'o-123');
                }).then(done, done.fail);
            });

            it('should not make a request to get the end date of the billing cycle', function(done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should be able to resolve with a 200', function(done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(result).toEqual({
                        code: 200,
                        body: {
                            id: 'o-123',
                            paymentPlanId: 'pp-456',
                            nextPaymentPlanId: null,
                            effectiveDate: new Date()
                        }
                    });
                }).then(done, done.fail);
            });

            it('should not produce an event', function (done) {
                orgModule.setPaymentPlan(this.svc, this.req).then(function(result) {
                    expect(orgModule.producePaymentPlanChanged).not.toHaveBeenCalled();
                }).then(done, done.fail);
            });

            it('should not produce a payment plan pending event', function (done) {
                var self = this;
                orgModule.setPaymentPlan(self.svc, self.req).then(function(result) {
                    var calls = streamUtils.produceEvent.calls.all();
                    calls.forEach(function (call) {
                        expect(call.args[0]).not.toBe('pendingPaymentPlanChanged');
                    });
                }).then(done, done.fail);
            });
        });
    });
});
