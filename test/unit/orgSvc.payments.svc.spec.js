var flush = true;
describe('orgSvc-payments (UT)', function() {
    var payModule, orgModule, events, q, mockLog, mockLogger, logger, Model, mongoUtils, enums, Status, Scope,
        mockDb, mockGateway, mockPayment, mockPaymentMethod, orgSvc, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        events          = require('events');
        q               = require('q');
        payModule       = require('../../bin/orgSvc-payments');
        orgModule       = require('../../bin/orgSvc-orgs');
        logger          = require('../../lib/logger');
        mongoUtils      = require('../../lib/mongoUtils');
        Model           = require('../../lib/model');
        enums           = require('../../lib/enums');
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

        req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' } };
        nextSpy = jasmine.createSpy('next()');
        doneSpy = jasmine.createSpy('done()');
        errorSpy = jasmine.createSpy('caught error');
        
        mockPaymentMethod = {
            token: 'asdf1234',
            createdAt: '2015-09-21T21:17:31.700Z',
            updatedAt: '2015-09-21T21:50:55.687Z',
            imageUrl: 'http://braintree.com/visa.png',
            default: true,
            cardType: 'visa',
            cardholderName: 'Johnny Testmonkey',
            expirationDate: '10/20',
            last4: '6666',
            email: 'johnny@test.com',
            extraField: 'foo'
        };
        mockPayment = {
            id: '1234',
            status: 'settled',
            type: 'sale',
            amount: '10.00',
            createdAt: '2015-09-21T21:54:50.507Z',
            updatedAt: '2015-09-21T21:55:00.884Z',
            customer: { id: '5678' },
            billing: { address: 'yes' },
            shipping: { address: 'also yes' },
            paymentInstrumentType: 'credit_card',
            creditCard: mockPaymentMethod,
            paypal: mockPaymentMethod
        };
        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        mockGateway = {
            customer: {
                find: jasmine.createSpy('gateway.customer.find()'),
                create: jasmine.createSpy('gateway.customer.create()'),
            },
            transaction: {
                search: jasmine.createSpy('gateway.transaction.search()')
            },
            clientToken: {
                generate: jasmine.createSpy('gateway.clientToken.generate()')
            },
            paymentMethod: {
                create: jasmine.createSpy('gateway.paymentMethod.create()'),
                update: jasmine.createSpy('gateway.paymentMethod.update()'),
                delete: jasmine.createSpy('gateway.paymentMethod.delete()'),
            },
        };
        
        orgSvc = orgModule.setupSvc(mockDb, mockGateway);
        spyOn(orgSvc, 'customMethod').and.callFake(function(req, action, cb) {
            return cb();
        });
        spyOn(payModule, 'formatMethodOutput').and.callThrough();
        spyOn(payModule, 'handleBraintreeErrors').and.callThrough();
    });
    
    describe('extendSvc', function() {
        beforeEach(function() {
            [payModule.fetchOrg, payModule.canEditOrg, payModule.getExistingPayMethod,
             payModule.checkMethodInUse].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });
            
            payModule.extendSvc(orgSvc, mockGateway);
        });
        
        it('should initialize middleware for payment endpoints', function() {
            expect(orgSvc._middleware.getClientToken).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.getPaymentMethods).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.createPaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.editPaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.deletePaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.getPayments).toEqual(jasmine.any(Array));
        });

        it('should add middleware to fetch the org for every payment endpoint', function() {
            expect(orgSvc._middleware.getClientToken).toContain(payModule.fetchOrg);
            expect(orgSvc._middleware.getPaymentMethods).toContain(payModule.fetchOrg);
            expect(orgSvc._middleware.createPaymentMethod).toContain(payModule.fetchOrg);
            expect(orgSvc._middleware.editPaymentMethod).toContain(payModule.fetchOrg);
            expect(orgSvc._middleware.deletePaymentMethod).toContain(payModule.fetchOrg);
            expect(orgSvc._middleware.getPayments).toContain(payModule.fetchOrg);
            expect(payModule.fetchOrg.bind).toHaveBeenCalledWith(payModule, orgSvc);
        });
        
        it('should add middleware to check if the requester can edit the org when modifying payment methods', function() {
            expect(orgSvc._middleware.createPaymentMethod).toContain(payModule.canEditOrg);
            expect(orgSvc._middleware.editPaymentMethod).toContain(payModule.canEditOrg);
            expect(orgSvc._middleware.deletePaymentMethod).toContain(payModule.canEditOrg);
            expect(payModule.canEditOrg.bind).toHaveBeenCalledWith(payModule, orgSvc);
        });
        
        it('should add middleware to get the existing payment method when editing/deleting a payment method', function() {
            expect(orgSvc._middleware.editPaymentMethod).toContain(payModule.getExistingPayMethod);
            expect(orgSvc._middleware.deletePaymentMethod).toContain(payModule.getExistingPayMethod);
            expect(payModule.getExistingPayMethod.bind).toHaveBeenCalledWith(payModule, mockGateway);
        });
        
        it('should add middleware to check if a payment method is in use when deleting a payment method', function() {
            expect(orgSvc._middleware.deletePaymentMethod).toContain(payModule.checkMethodInUse);
            expect(payModule.checkMethodInUse.bind).toHaveBeenCalledWith(payModule, orgSvc);
        });
    });
    
    describe('formatPaymentOutput', function() {
        it('should format a payment for returning to the client', function() {
            expect(payModule.formatPaymentOutput(mockPayment)).toEqual({
                id: '1234',
                status: 'settled',
                type: 'sale',
                amount: '10.00',
                createdAt: '2015-09-21T21:54:50.507Z',
                updatedAt: '2015-09-21T21:55:00.884Z',
                method: {
                    token: 'asdf1234',
                    createdAt: '2015-09-21T21:17:31.700Z',
                    updatedAt: '2015-09-21T21:50:55.687Z',
                    imageUrl: 'http://braintree.com/visa.png',
                    default: true,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: 'Johnny Testmonkey',
                    expirationDate: '10/20',
                    last4: '6666'
                },
                campaignId: undefined
            });
        });
        
        it('should be able to format a payment from a paypal account', function() {
            mockPayment.paymentInstrumentType = 'paypal';
            delete mockPaymentMethod.cardType;
            expect(payModule.formatPaymentOutput(mockPayment)).toEqual({
                id: '1234',
                status: 'settled',
                type: 'sale',
                amount: '10.00',
                createdAt: '2015-09-21T21:54:50.507Z',
                updatedAt: '2015-09-21T21:55:00.884Z',
                method: {
                    token: 'asdf1234',
                    createdAt: '2015-09-21T21:17:31.700Z',
                    updatedAt: '2015-09-21T21:50:55.687Z',
                    imageUrl: 'http://braintree.com/visa.png',
                    default: true,
                    type: 'paypal',
                    email: 'johnny@test.com'
                },
                campaignId: undefined
            });
        });
        
        it('should include the campaign id if defined in the custom fields', function() {
            mockPayment.customFields = { campaign: 'cam-1' };
            expect(payModule.formatPaymentOutput(mockPayment)).toEqual({
                id: '1234',
                status: 'settled',
                type: 'sale',
                amount: '10.00',
                createdAt: '2015-09-21T21:54:50.507Z',
                updatedAt: '2015-09-21T21:55:00.884Z',
                campaignId: 'cam-1',
                method: jasmine.any(Object)
            });
        });
    });
    
    describe('formatMethodOutput', function() {
        it('should format a payment method for returning to the client', function() {
            expect(payModule.formatMethodOutput(mockPaymentMethod)).toEqual({
                token: 'asdf1234',
                createdAt: '2015-09-21T21:17:31.700Z',
                updatedAt: '2015-09-21T21:50:55.687Z',
                imageUrl: 'http://braintree.com/visa.png',
                default: true,
                type: 'creditCard',
                cardType: 'visa',
                cardholderName: 'Johnny Testmonkey',
                expirationDate: '10/20',
                last4: '6666'
            });
        });
        
        it('should be able to format a paypal account', function() {
            delete mockPaymentMethod.cardType;
            expect(payModule.formatMethodOutput(mockPaymentMethod)).toEqual({
                token: 'asdf1234',
                createdAt: '2015-09-21T21:17:31.700Z',
                updatedAt: '2015-09-21T21:50:55.687Z',
                imageUrl: 'http://braintree.com/visa.png',
                default: true,
                type: 'paypal',
                email: 'johnny@test.com'
            });
        });
    });
    
    describe('fetchOrg', function() {
        beforeEach(function() {
            req.query = {};
            spyOn(orgSvc, 'getObjs').and.returnValue(q({code: 200, body: { id: 'o-1', name: 'org 1' } }));
        });
        
        it('should fetch the org and save it as req.org', function(done) {
            payModule.fetchOrg(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).toEqual({ id: 'o-1', name: 'org 1' });
                expect(orgSvc.getObjs).toHaveBeenCalledWith({ id: 'o-1' }, req, false);
                done();
            });
        });
        
        it('should be able to fetch an org from a query param', function(done) {
            req.query.org = 'o-2';
            payModule.fetchOrg(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).toEqual({ id: 'o-1', name: 'org 1' });
                expect(orgSvc.getObjs).toHaveBeenCalledWith({ id: 'o-2' }, req, false);
                done();
            });
        });
        
        it('should call done if the orgSvc returns a non-200 response', function(done) {
            orgSvc.getObjs.and.returnValue(q({ code: 404, body: 'Org not found' }));
            payModule.fetchOrg(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 404, body: 'Org not found' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).not.toBeDefined();
                expect(orgSvc.getObjs).toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if the orgSvc fails', function(done) {
            orgSvc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM CROSBY'));
            payModule.fetchOrg(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('I GOT A PROBLEM CROSBY');
                expect(req.org).not.toBeDefined();
                expect(orgSvc.getObjs).toHaveBeenCalled();
                done();
            });
        });

        it('should defend against query selection injector attacks', function(done) {
            req.query.org = { $gt: '' };
            payModule.fetchOrg(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).toEqual({ id: 'o-1', name: 'org 1' });
                expect(orgSvc.getObjs).toHaveBeenCalledWith({ id: '[object Object]' }, req, false);
                done();
            });
        });
    });
    
    describe('canEditOrg', function() {
        beforeEach(function() {
            req.org = { id: 'o-1' };
            req.user.permissions = { orgs: { edit: Scope.Own } };
            spyOn(orgSvc, 'checkScope').and.callThrough();
        });

        it('should call next if the requester is allowed to edit the org', function(done) {
            payModule.canEditOrg(orgSvc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, req.org, 'edit');
                done();
            });
        });
        
        it('should call done if the requester is not allowed to edit the org', function(done) {
            req.org.id = 'o-234';
            payModule.canEditOrg(orgSvc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to edit this org' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req.user, req.org, 'edit');
                done();
            });
        });
    });
    
    describe('getExistingPayMethod', function() {
        var mockCust;
        beforeEach(function() {
            var altPayMethod = JSON.parse(JSON.stringify(mockPaymentMethod));
            altPayMethod.token = 'qwer5678';
            delete altPayMethod.cardType;

            mockCust = {
                id: '123456',
                paymentMethods: [
                    altPayMethod,
                    mockPaymentMethod
                ]
            };

            req.method = 'PUT';
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            req.params = { token: 'asdf1234' };

            mockGateway.customer.find.and.callFake(function(id, cb) {
                cb(null, mockCust);
            });
        });
        
        it('should find the payment method specified in req.params and attach it to req', function(done) {
            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).toEqual(mockPaymentMethod);
                expect(mockGateway.customer.find).toHaveBeenCalledWith('123456', jasmine.any(Function));
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should skip if the org has no braintreeCustomer', function(done) {
            delete req.org.braintreeCustomer;
            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'No payment methods for this org' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 404 if the payment method is not found', function(done) {
            req.params.token = 'zxcvlkj93847';
            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 404, body: 'That payment method does not exist for this org' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 204 if the payment method is not found and the request is a delete', function(done) {
            req.params.token = 'zxcvlkj93847';
            req.method = 'DELETE';
            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 204 });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should handle a customer with no payment methods', function(done) {
            delete mockCust.paymentMethods;
            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 404, body: 'That payment method does not exist for this org' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should return a 400 if the customer does not exist', function(done) {
            mockGateway.customer.find.and.callFake(function(id, cb) {
                var error = new Error('Customer not found');
                error.name = 'notFoundError';
                cb(error);
            });

            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Braintree customer for this org does not exist' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if finding the customer fails', function(done) {
            mockGateway.customer.find.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });

            payModule.getExistingPayMethod(mockGateway, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Braintree error');
                expect(req.paymentMethod).not.toBeDefined();
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('checkMethodInUse', function() {
        var mockColl;
        beforeEach(function() {
            req.params = { token: 'asdf1234' };
        
            mockColl = {
                count: jasmine.createSpy('cursor.count').and.returnValue(q(3))
            };
            mockDb.collection.and.returnValue(mockColl);
        });
        
        it('should call done if there are campaigns using the payment method', function(done) {
            payModule.checkMethodInUse(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Payment method still in use by campaigns' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mockColl.count).toHaveBeenCalledWith({
                    paymentMethod: 'asdf1234',
                    status: { $nin: [Status.Deleted, Status.Expired, Status.Canceled] },
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call next if there are no campaigns using the payment method', function(done) {
            mockColl.count.and.returnValue(q(0));
        
            payModule.checkMethodInUse(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.and.returnValue(q.reject('I GOT A PROBLEM'));
        
            payModule.checkMethodInUse(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Mongo error'));
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('handleBraintreeErrors', function() {
        var error;
        beforeEach(function() {
            error = {
                success: false,
                errors: {
                    deepErrors: jasmine.createSpy('errors.deepErrors').and.returnValue([])
                },
                verification: {},
                message: 'I GOT A PROBLEM CROSBY'
            };
            req.org = { id: 'o-1', braintreeCustoemr: '123456' };
        });
        
        it('should handle any expected validation errors', function(done) {
            error.errors.deepErrors.and.returnValue([
                { attribute: 'number', code: '123', message: 'card number invalid' },
                { attribute: 'number', code: '456', message: 'and your card is stupid' }
            ]);
            payModule.handleBraintreeErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Invalid payment method' });
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('I GOT A PROBLEM CROSBY');
                expect(mockLog.info.calls.mostRecent().args).toContain(JSON.stringify([
                    { attribute: 'number', code: '123', message: 'card number invalid' },
                    { attribute: 'number', code: '456', message: 'and your card is stupid' }
                ], null, 2));
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle processor declines', function(done) {
            error.verification = {
                status: 'processor_declined',
                processorResponseCode: '2000',
                processorResponseText: 'Do Not Honor'
            };
            
            payModule.handleBraintreeErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Processor declined payment method' });
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('2000');
                expect(mockLog.warn.calls.mostRecent().args).toContain('Do Not Honor');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle gateway rejections', function(done) {
            error.verification = {
                status: 'gateway_rejected',
                gatewayRejectionReason: 'cvv'
            };
            
            payModule.handleBraintreeErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Gateway declined payment method' });
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('cvv');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with the error otherwise', function(done) {
            payModule.handleBraintreeErrors(req, error).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(error);
            }).done(done);
        });
    });
    
    describe('getClientToken', function() {
        beforeEach(function() {
            mockGateway.clientToken.generate.and.callFake(function(cfg, cb) {
                cb(null, { clientToken: 'usemetoinityourclient' });
            });
        });
        
        it('should generate and return a client token', function(done) {
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { clientToken: 'usemetoinityourclient' } });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getClientToken', jasmine.any(Function));
                expect(mockGateway.clientToken.generate).toHaveBeenCalledWith({}, jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass the braintreeCustomer if defined', function(done) {
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { clientToken: 'usemetoinityourclient' } });
                expect(mockGateway.clientToken.generate).toHaveBeenCalledWith({ customerId: '123456' }, jasmine.any(Function));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.clientToken.generate).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if generating the token fails', function(done) {
            mockGateway.clientToken.generate.and.callFake(function(cfg, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.clientToken.generate).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('getPayments', function() {
        var mockStream, mockSearch;
        beforeEach(function() {
            mockStream = new events.EventEmitter();
            mockSearch = {
                customerId: jasmine.createSpy('search.customerId()').and.callFake(function() { return mockSearch._customerId; }),
                _customerId: {
                    is: jasmine.createSpy('customerId().is()')
                }
            };
            
            mockGateway.transaction.search.and.callFake(function(queryCb) {
                queryCb(mockSearch);
                
                process.nextTick(function() {
                    mockStream.emit('data', {
                        id: 'p1',
                        amount: '10.00',
                        paymentInstrumentType: 'credit_card',
                        creditCard: { token: 'asdf1234', cardType: 'visa' }
                    });
                    mockStream.emit('data', {
                        id: 'p2',
                        amount: '20.00',
                        paymentInstrumentType: 'paypal',
                        paypal: { token: 'qwer5678', email: 'jen@test.com' }
                    });
                    mockStream.emit('end');
                });

                return mockStream;
            });
            spyOn(payModule, 'formatPaymentOutput').and.callThrough();
            spyOn(payModule, 'decoratePayments').and.callFake(function(payments, orgSvc, req) {
                return payments.map(function(payment) {
                    payment.decorated = true;
                    return payment;
                });
            });
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
        });
        
        it('should get payments for the org', function(done) {
            payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    {
                        id: 'p1',
                        status: undefined,
                        type: undefined,
                        amount: '10.00',
                        createdAt: undefined,
                        updatedAt: undefined,
                        method: {
                            token: 'asdf1234',
                            createdAt: undefined,
                            updatedAt: undefined,
                            imageUrl: undefined,
                            default: undefined,
                            type: 'creditCard',
                            cardType: 'visa',
                            cardholderName: undefined,
                            expirationDate: undefined,
                            last4: undefined
                        },
                        campaignId: undefined,
                        decorated: true
                    },
                    {
                        id: 'p2',
                        status: undefined,
                        type: undefined,
                        amount: '20.00',
                        createdAt: undefined,
                        updatedAt: undefined,
                        method: {
                            token: 'qwer5678',
                            createdAt: undefined,
                            updatedAt: undefined,
                            imageUrl: undefined,
                            default: undefined,
                            type: 'paypal',
                            email: 'jen@test.com'
                        },
                        campaignId: undefined,
                        decorated: true
                    }
                ]);
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPayments', jasmine.any(Function));
                expect(mockGateway.transaction.search).toHaveBeenCalledWith(jasmine.any(Function));
                expect(mockSearch.customerId).toHaveBeenCalledWith();
                expect(mockSearch._customerId.is).toHaveBeenCalledWith('123456');
                expect(payModule.formatPaymentOutput.calls.count()).toBe(2);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 200 and [] if the org has no braintreeCustomer', function(done) {
            delete req.org.braintreeCustomer;
            payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [] });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPayments', jasmine.any(Function));
                expect(mockGateway.transaction.search).not.toHaveBeenCalled();
                expect(payModule.formatPaymentOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the result if customMethod if returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPayments', jasmine.any(Function));
                expect(mockGateway.transaction.search).not.toHaveBeenCalled();
                expect(payModule.formatPaymentOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if streaming the results encounters an error', function(done) {
            mockGateway.transaction.search.and.callFake(function(queryCb) {
                queryCb(mockSearch);
                
                process.nextTick(function() {
                    mockStream.emit('error', 'I GOT A PROBLEM');
                    mockStream.emit('end');
                });

                return mockStream;
            });
            
            payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPayments', jasmine.any(Function));
                expect(mockGateway.transaction.search).toHaveBeenCalled();
                expect(payModule.formatPaymentOutput).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('decoratePayments', function() {
        var payments, camps, mockColl, mockCursor;
        beforeEach(function() {
            payments = [
                { id: 'p1', amount: '10', campaignId: 'cam-1' },
                { id: 'p2', amount: '20' },
                { id: 'p3', amount: '30', campaignId: 'cam-2' },
                { id: 'p4', amount: '40', campaignId: 'cam-3' }
            ];
            camps = [
                { id: 'cam-1', name: 'campaign 1' },
                { id: 'cam-2', name: 'campaign 2' },
                { id: 'cam-3', name: 'campaign 3' }
            ];
            mockCursor = {
                toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function() { return q(camps); })
            };
            mockColl = {
                find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor)
            };
            mockDb.collection.and.returnValue(mockColl);
        });
        
        it('should decorate each payment that has a campaignId with a campaignName', function(done) {
            payModule.decoratePayments(payments, orgSvc, req).then(function(decorated) {
                expect(decorated).toEqual([
                    { id: 'p1', amount: '10', campaignId: 'cam-1', campaignName: 'campaign 1' },
                    { id: 'p2', amount: '20', campaignName: undefined },
                    { id: 'p3', amount: '30', campaignId: 'cam-2', campaignName: 'campaign 2' },
                    { id: 'p4', amount: '40', campaignId: 'cam-3', campaignName: 'campaign 3' }
                ]);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if there are no payments with campaign ids', function(done) {
            payments = [ payments[1] ];
            payModule.decoratePayments(payments, orgSvc, req).then(function(decorated) {
                expect(decorated).toEqual([
                    { id: 'p2', amount: '20' }
                ]);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should log warnings if some campaigns are not found', function(done) {
            camps.pop();
            payModule.decoratePayments(payments, orgSvc, req).then(function(decorated) {
                expect(decorated).toEqual([
                    { id: 'p1', amount: '10', campaignId: 'cam-1', campaignName: 'campaign 1' },
                    { id: 'p2', amount: '20', campaignName: undefined },
                    { id: 'p3', amount: '30', campaignId: 'cam-2', campaignName: 'campaign 2' },
                    { id: 'p4', amount: '40', campaignId: 'cam-3', campaignName: undefined }
                ]);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log an error but not reject if mongo fails', function(done) {
            mockCursor.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
            payModule.decoratePayments(payments, orgSvc, req).then(function(decorated) {
                expect(decorated).toEqual([
                    { id: 'p1', amount: '10', campaignId: 'cam-1' },
                    { id: 'p2', amount: '20' },
                    { id: 'p3', amount: '30', campaignId: 'cam-2' },
                    { id: 'p4', amount: '40', campaignId: 'cam-3' }
                ]);
                expect(mockLog.error).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('getPaymentMethods', function() {
        var mockCust;
        beforeEach(function() {
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            mockCust = {
                id: '123456',
                paymentMethods: [
                    { token: 'asdf1234', cardType: 'visa' },
                    { token: 'qwer5678', cardType: 'amex' }
                ]
            };
            mockGateway.customer.find.and.callFake(function(cfg, cb) {
                cb(null, mockCust);
            });
        });
        
        it('should get a customer and its payment methods', function(done) {
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    {
                        token: 'asdf1234',
                        createdAt: undefined,
                        updatedAt: undefined,
                        imageUrl: undefined,
                        default: undefined,
                        type: 'creditCard',
                        cardType: 'visa',
                        cardholderName: undefined,
                        expirationDate: undefined,
                        last4: undefined
                    },
                    {
                        token: 'qwer5678',
                        createdAt: undefined,
                        updatedAt: undefined,
                        imageUrl: undefined,
                        default: undefined,
                        type: 'creditCard',
                        cardType: 'amex',
                        cardholderName: undefined,
                        expirationDate: undefined,
                        last4: undefined
                    }
                ]);
                expect(mockGateway.customer.find).toHaveBeenCalledWith('123456', jasmine.any(Function));
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPaymentMethods', jasmine.any(Function));
                expect(payModule.formatMethodOutput.calls.count()).toBe(2);
                expect(payModule.formatMethodOutput.calls.all()[0].args[0]).toEqual({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.formatMethodOutput.calls.all()[1].args[0]).toEqual({ token: 'qwer5678', cardType: 'amex' });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if there is no braintreeCustomer for the org', function(done) {
            delete req.org.braintreeCustomer;
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [] });
                expect(resp.body).toEqual([]);
                expect(mockGateway.customer.find).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 200 if the customer has no payment methods', function(done) {
            delete mockCust.paymentMethods;
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [] });
                expect(resp.body).toEqual([]);
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.customer.find).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('return a 400 and log a warning if the braintreeCustomer does not exist', function(done) {
            mockGateway.customer.find.and.callFake(function(id, cb) {
                var error = new Error('Customer not found');
                error.name = 'notFoundError';
                cb(error);
            });
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Braintree customer for this org does not exist' });
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if getting the customer fails', function(done) {
            mockGateway.customer.find.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.customer.find).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('createCustomerWithMethod', function() {
        beforeEach(function() {
            var mockCust = {
                id: '123456',
                paymentMethods: [
                    { token: 'asdf1234', cardType: 'visa' }
                ]
            };
            mockGateway.customer.create.and.callFake(function(cfg, cb) {
                cb(null, { success: true, customer: mockCust });
            });
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            req.user.firstName = 'Unit';
            req.user.lastName = 'Tests';
            req.user.email = 'unit@tests.com';
            req.org = { id: 'o-1', name: 'org 1' };
            req.body = { paymentMethodNonce: 'thisislegit' };
        });
        
        it('should create a new customer with the payment method', function(done) {
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(mockGateway.customer.create).toHaveBeenCalledWith({
                    company: 'org 1',
                    firstName: 'Unit',
                    lastName: 'Tests',
                    email: 'unit@tests.com',
                    paymentMethodNonce: 'thisislegit'
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'orgs' }, { braintreeCustomer: '123456' }, 'o-1');
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should include the cardholderName if defined', function(done) {
            req.body.cardholderName = 'Johnny Testmonkey';
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(mockGateway.customer.create).toHaveBeenCalledWith({
                    company: 'org 1',
                    firstName: 'Unit',
                    lastName: 'Tests',
                    email: 'unit@tests.com',
                    paymentMethodNonce: 'thisislegit',
                    creditCard: {
                        cardholderName: 'Johnny Testmonkey'
                    }
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not include user-specific info if the org is not the requester\'s', function(done) {
            req.user.org = 'o-other';
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual(jasmine.objectContaining({ token: 'asdf1234' }));
                expect(mockGateway.customer.create).toHaveBeenCalledWith({
                    company: 'org 1',
                    paymentMethodNonce: 'thisislegit'
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'orgs' }, { braintreeCustomer: '123456' }, 'o-1');
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if creating the customer returns an unsuccessful response', function(done) {
            mockGateway.customer.create.and.callFake(function(id, cb) {
                cb(null, { success: false, message: 'Not enough brains on trees' });
            });
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.customer.create).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req,
                    { success: false, message: 'Not enough brains on trees' });
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if creating the customer fails', function(done) {
            mockGateway.customer.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.customer.create).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handleBraintreeErrors handles the error', function(done) {
            payModule.handleBraintreeErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.customer.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.customer.create).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if editing the org fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.customer.create).toHaveBeenCalled();
                expect(mongoUtils.editObject).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('createPaymentMethod', function() {
        beforeEach(function() {
            mockGateway.paymentMethod.create.and.callFake(function(cfg, cb) {
                cb(null, { success: true, paymentMethod: { token: 'asdf1234', cardType: 'visa' } });
            });
            spyOn(payModule, 'createCustomerWithMethod').and.returnValue(q(
                { code: 201, body: { token: 'asdf1234', type: 'creditCard', cardType: 'visa' } }));
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            req.body = { paymentMethodNonce: 'thisislegit', makeDefault: true };
        });
        
        it('should create a new payment method', function(done) {
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'createPaymentMethod', jasmine.any(Function));
                expect(mockGateway.paymentMethod.create).toHaveBeenCalledWith({
                    customerId: '123456',
                    cardholderName: undefined,
                    paymentMethodNonce: 'thisislegit',
                    options: {
                        makeDefault: true
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.createCustomerWithMethod).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to pass in the cardholderName', function(done) {
            req.body.cardholderName = 'Johnny Testmonkey';
            req.body.makeDefault = false;
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(mockGateway.paymentMethod.create).toHaveBeenCalledWith({
                    customerId: '123456',
                    cardholderName: 'Johnny Testmonkey',
                    paymentMethodNonce: 'thisislegit',
                    options: {
                        makeDefault: false
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the body has no paymentMethodNonce', function(done) {
            delete req.body.paymentMethodNonce;
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must include a paymentMethodNonce' });
                expect(orgSvc.customMethod).not.toHaveBeenCalled();
                expect(mockGateway.paymentMethod.create).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the body has an invalid cardholderName', function(done) {
            q.all([
                { foo: 'bar' },
                new Array(176).join(',').split(',').map(function() { return 'a'; }).join('')
            ].map(function(badName) {
                var thisReq = JSON.parse(JSON.stringify(req));
                thisReq.body.cardholderName = badName;
                return payModule.createPaymentMethod(mockGateway, orgSvc, thisReq);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp).toEqual({ code: 400, body: 'Invalid cardholderName' });
                });
                expect(orgSvc.customMethod).not.toHaveBeenCalled();
                expect(mockGateway.paymentMethod.create).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should call createCustomerWithMethod if the org has no braintreeCustomer', function(done) {
            delete req.org.braintreeCustomer;
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual({ token: 'asdf1234', type: 'creditCard', cardType: 'visa' });
                expect(orgSvc.customMethod).toHaveBeenCalled();
                expect(mockGateway.paymentMethod.create).not.toHaveBeenCalled();
                expect(payModule.createCustomerWithMethod).toHaveBeenCalledWith(mockGateway, orgSvc, req);
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.paymentMethod.create).not.toHaveBeenCalled();
                expect(payModule.createCustomerWithMethod).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if creating the payment method returns an unsuccessful response', function(done) {
            mockGateway.paymentMethod.create.and.callFake(function(id, cb) {
                cb(null, { success: false, message: 'Not enough brains on trees' });
            });
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.paymentMethod.create).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req,
                    { success: false, message: 'Not enough brains on trees' });
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if creating the payment method fails', function(done) {
            mockGateway.paymentMethod.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.paymentMethod.create).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if creating a customer is needed and fails', function(done) {
            payModule.createCustomerWithMethod.and.returnValue(q.reject('I GOT A PROBLEM'));
            delete req.org.braintreeCustomer;
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('I GOT A PROBLEM');
                expect(mockGateway.paymentMethod.create).not.toHaveBeenCalled();
                expect(payModule.createCustomerWithMethod).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handleBraintreeError handles the error', function(done) {
            payModule.handleBraintreeErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.paymentMethod.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.paymentMethod.create).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('editPaymentMethod', function() {
        beforeEach(function() {
            mockGateway.paymentMethod.update.and.callFake(function(token, cfg, cb) {
                cb(null, { success: true, paymentMethod: { token: 'asdf1234', cardType: 'visa' } });
            });
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            req.body = { paymentMethodNonce: 'thisislegit', makeDefault: true };
            req.params = { token: 'asdf1234' };
        });
        
        it('should edit a payment method', function(done) {
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'editPaymentMethod', jasmine.any(Function));
                expect(mockGateway.paymentMethod.update).toHaveBeenCalledWith('asdf1234', {
                    cardholderName: undefined,
                    paymentMethodNonce: 'thisislegit',
                    options: {
                        makeDefault: true,
                        verifyCard: true
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to pass in a new cardholderName', function(done) {
            req.body.cardholderName = 'Jenny Testmonkey';
            req.body.makeDefault = false;
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(mockGateway.paymentMethod.update).toHaveBeenCalledWith('asdf1234', {
                    cardholderName: 'Jenny Testmonkey',
                    paymentMethodNonce: 'thisislegit',
                    options: {
                        makeDefault: false,
                        verifyCard: true
                    }
                }, jasmine.any(Function));
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the body has no paymentMethodNonce', function(done) {
            req.body = { cardholderName: 'Jenny Testmonkey' };
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must include a paymentMethodNonce' });
                expect(orgSvc.customMethod).not.toHaveBeenCalled();
                expect(mockGateway.paymentMethod.update).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the body has an invalid cardholderName', function(done) {
            q.all([
                { foo: 'bar' },
                new Array(176).join(',').split(',').map(function() { return 'a'; }).join('')
            ].map(function(badName) {
                var thisReq = JSON.parse(JSON.stringify(req));
                thisReq.body.cardholderName = badName;
                return payModule.editPaymentMethod(mockGateway, orgSvc, thisReq);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp).toEqual({ code: 400, body: 'Invalid cardholderName' });
                });
                expect(orgSvc.customMethod).not.toHaveBeenCalled();
                expect(mockGateway.paymentMethod.update).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to just make an existing method their default', function(done) {
            req.body = { makeDefault: false };
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual({
                    token: 'asdf1234',
                    createdAt: undefined,
                    updatedAt: undefined,
                    imageUrl: undefined,
                    default: undefined,
                    type: 'creditCard',
                    cardType: 'visa',
                    cardholderName: undefined,
                    expirationDate: undefined,
                    last4: undefined
                });
                expect(mockGateway.paymentMethod.update).toHaveBeenCalledWith('asdf1234', {
                    cardholderName: undefined,
                    paymentMethodNonce: undefined,
                    options: {
                        makeDefault: false,
                        verifyCard: false
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.paymentMethod.update).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if editing the payment method returns an unsuccessful response', function(done) {
            mockGateway.paymentMethod.update.and.callFake(function(token, cfg, cb) {
                cb(null, { success: false, message: 'Not enough brains on trees' });
            });
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.paymentMethod.update).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req,
                    { success: false, message: 'Not enough brains on trees' });
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if editing the payment method fails', function(done) {
            mockGateway.paymentMethod.update.and.callFake(function(token, cfg, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.paymentMethod.update).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handleBraintreeError handles the error', function(done) {
            payModule.handleBraintreeErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.paymentMethod.update.and.callFake(function(token, cfg, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.paymentMethod.update).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handleBraintreeErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('deletePaymentMethod', function() {
        beforeEach(function() {
            mockGateway.paymentMethod.delete.and.callFake(function(token, cb) {
                cb();
            });
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            req.params = { token: 'asdf1234' };
        });
        
        it('should successfully delete a payment method', function(done) {
            payModule.deletePaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'deletePaymentMethod', jasmine.any(Function));
                expect(mockGateway.paymentMethod.delete).toHaveBeenCalledWith('asdf1234', jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.deletePaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.paymentMethod.delete).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if deleting the payment method fails', function(done) {
            mockGateway.paymentMethod.delete.and.callFake(function(token, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.deletePaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Braintree error');
                expect(mockGateway.paymentMethod.delete).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
});
