var flush = true;
describe('orgSvc-payments (UT)', function() {
    var payModule, orgModule, q, mockLog, mockLogger, logger, Model, enums, Status, Scope,
        mockDb, mockGateway, mockPayment, mockPaymentMethod, orgSvc, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        payModule       = require('../../bin/orgSvc-payments');
        orgModule       = require('../../bin/orgSvc-orgs');
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
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

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
            collection: jasmine.createSpy('db.collection()').andCallFake(function(objName) {
                return { collectionName: objName };
            })
        };
        mockGateway = {
            customer: {
                find: jasmine.createSpy('gateway.customer.find()'),
                create: jasmine.createSpy('gateway.customer.create()'),
            },
            transaction: {
                generate: jasmine.createSpy('gateway.transaction.search()')
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
        spyOn(orgSvc, 'customMethod').andCallFake(function(req, action, cb) {
            return cb();
        });
    });
    
    describe('extendSvc', function() {
        beforeEach(function() {
            [payModule.fetchOrg, payModule.canEditOrg, payModule.getExistingPayMethod, 
             payModule.checkMethodInUse].forEach(function(fn) {
                spyOn(fn, 'bind').andReturn(fn);
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
                }
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
                }
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
                campaign: 'cam-1',
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
            spyOn(orgSvc, 'getObjs').andReturn(q({code: 200, body: { id: 'o-1', name: 'org 1' } }));
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
            orgSvc.getObjs.andReturn(q({ code: 404, body: 'Org not found' }));
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
            orgSvc.getObjs.andReturn(q.reject('I GOT A PROBLEM CROSBY'));
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
            spyOn(orgSvc, 'checkScope').andCallThrough();
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

            mockGateway.customer.find.andCallFake(function(id, cb) {
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
            mockGateway.customer.find.andCallFake(function(id, cb) {
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
            mockGateway.customer.find.andCallFake(function(id, cb) {
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
                count: jasmine.createSpy('cursor.count').andCallFake(function(query, cb) { cb(null, 3); })
            };
            mockDb.collection.andReturn(mockColl);
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
                }, jasmine.any(Function));
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call next if there are no campaigns using the payment method', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb(null, 0); });
        
            payModule.checkMethodInUse(orgSvc, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo has an error', function(done) {
            mockColl.count.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
        
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
                    errorCollections: {}
                },
                verification: {},
                message: 'I GOT A PROBLEM CROSBY'
            };
            req.org = { id: 'o-1', braintreeCustoemr: '123456' };
        });
        
        it('should handle any expected validation errors', function(done) {
            q.all(['customer', 'paymentMethod', 'creditCard', 'paypal'].map(function(type) {
                var err = JSON.parse(JSON.stringify(error));
                err.errors.errorCollections[type] = { validationErrors: { paymentMethodNonce: {
                    attribute: 'payment_method_nonce',
                    code: '93103',
                    message: 'Nonce is required.'
                } } };
                
                return payModule.handleBraintreeErrors(req, err);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp).toEqual({ code: 400, body: 'Invalid payment method' });
                });
                expect(mockLog.info.calls.length).toBe(4);
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
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.mostRecentCall.args).toContain('2000');
                expect(mockLog.info.mostRecentCall.args).toContain('Do Not Honor');
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
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.mostRecentCall.args).toContain('cvv');
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
            mockGateway.clientToken.generate.andCallFake(function(cfg, cb) {
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
            orgSvc.customMethod.andReturn(q({ code: 400, body: 'Yo request is bad' }));
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.clientToken.generate).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if generating the token fails', function(done) {
            mockGateway.clientToken.generate.andCallFake(function(cfg, cb) {
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
            mockGateway.customer.find.andCallFake(function(cfg, cb) {
                cb(null, mockCust);
            });
            spyOn(payModule, 'formatMethodOutput').andCallThrough();
        });
        
        it('should get a customer and its payment methods', function(done) {
            payModule.getPaymentMethods(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    {
                        token: 'asdf1234',
                        type: 'creditCard',
                        cardType: 'visa'
                    },
                    {
                        token: 'qwer5678',
                        type: 'creditCard',
                        cardType: 'amex'
                    }
                ]);
                expect(mockGateway.customer.find).toHaveBeenCalledWith('123456', jasmine.any(Function));
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPaymentMethods', jasmine.any(Function));
                expect(payModule.formatMethodOutput.calls.length).toBe(2);
                expect(payModule.formatMethodOutput.calls[0].args[0]).toEqual({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.formatMethodOutput.calls[1].args[0]).toEqual({ token: 'qwer5678', cardType: 'amex' });
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
            orgSvc.customMethod.andReturn(q({ code: 400, body: 'Yo request is bad' }));
            payModule.getClientToken(mockGateway, orgSvc, req).then(function(resp) {
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
            mockGateway.customer.find.andCallFake(function(id, cb) {
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
            mockGateway.customer.find.andCallFake(function(id, cb) {
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
    
    });
    
    describe('createPaymentMethod', function() {
    
    });
    
    describe('editPaymentMethod', function() {
    
    });
    
    describe('deletePaymentMethod', function() {
    
    });
    
    describe('getPayments', function() {
    
    });
});
