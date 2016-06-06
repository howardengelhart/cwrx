var flush = true;
describe('orgSvc-payments (UT)', function() {
    var payModule, orgModule, events, q, mockLog, mockLogger, logger, Model, mongoUtils, Scope, requestUtils, rcKinesis, braintree,
        CrudSvc, objUtils, util, mockDb, mockGateway, mockPayment, mockPaymentMethod, orgSvc, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        events          = require('events');
        q               = require('q');
        util            = require('util');
        rcKinesis       = require('rc-kinesis');
        braintree       = require('braintree');
        payModule       = require('../../bin/orgSvc-payments');
        orgModule       = require('../../bin/orgSvc-orgs');
        logger          = require('../../lib/logger');
        CrudSvc         = require('../../lib/crudSvc');
        mongoUtils      = require('../../lib/mongoUtils');
        requestUtils    = require('../../lib/requestUtils');
        objUtils        = require('../../lib/objUtils');
        Model           = require('../../lib/model');
        Scope           = require('../../lib/enums').Scope;
        
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

        payModule.config.api = {
            root: 'https://test.com',
            balance: {
                baseUrl: 'https://test.com/api/accounting/balance/',
                endpoint: '/api/accounting/balance/'
            },
            transactions: {
                baseUrl: 'https://test.com/api/transactions/',
                endpoint: '/api/transactions/'
            },
            users: {
                baseUrl: 'https://test.com/api/account/users/',
                endpoint: '/api/account/users/'
            }
        };
        payModule.config.noDuplicateMethods = false;
        payModule.config.minPayment = 1;
        payModule.config.kinesis = {
            region      : 'us-east-1',
            streamName  : 'utStream'
        };

        req = {
            uuid: '1234',
            user: { id: 'u-1', org: 'o-1' },
            requester: { id: 'u-1', permissions: {}, entitlements: {} }
        };
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
            amount: '10.12',
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
            config: { environment: braintree.Environment.Sandbox },
            customer: {
                find: jasmine.createSpy('gateway.customer.find()'),
                create: jasmine.createSpy('gateway.customer.create()'),
            },
            transaction: {
                search: jasmine.createSpy('gateway.transaction.search()'),
                sale: jasmine.createSpy('gateway.transaction.sale()')
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
        spyOn(payModule, 'handlePaymentMethodErrors').and.callThrough();
    });
    
    describe('extendSvc', function() {
        var config, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

        beforeEach(function() {
            boundFns = [];
            var bind = Function.prototype.bind;
            
            [CrudSvc.fetchRelatedEntity, payModule.canEditOrg, payModule.getExistingPayMethod].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });
            
            config = {
                api: {
                    root: 'https://foo.com',
                    balance: {
                        endpoint: '/api/accounting/balance/'
                    },
                    transactions: {
                        endpoint: '/api/transactions/'
                    },
                    users: {
                        endpoint: '/api/account/users/'
                    }
                },
                minPayment: 50,
                kinesis: {
                    region      : 'us-east-66',
                    streamName  : 'devCwrxStream'
                }
            };

            payModule.extendSvc(orgSvc, mockGateway, config);
        });
        
        it('should save some config locally', function() {
            expect(payModule.config.api).toEqual({
                root: 'https://foo.com',
                balance: {
                    endpoint: '/api/accounting/balance/',
                    baseUrl: 'https://foo.com/api/accounting/balance/'
                },
                transactions: {
                    endpoint: '/api/transactions/',
                    baseUrl: 'https://foo.com/api/transactions/'
                },
                users: {
                    endpoint: '/api/account/users/',
                    baseUrl: 'https://foo.com/api/account/users/'
                }
            });
            expect(payModule.config.minPayment).toBe(50);
            expect(payModule.config.kinesis).toEqual({
                region: 'us-east-66',
                streamName: 'devCwrxStream'
            });
        });
        
        it('should initialize middleware for payment endpoints', function() {
            expect(orgSvc._middleware.getClientToken).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.getPaymentMethods).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.createPaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.editPaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.deletePaymentMethod).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.getPayments).toEqual(jasmine.any(Array));
            expect(orgSvc._middleware.createPayment).toEqual(jasmine.any(Array));
        });

        it('should add middleware to fetch the org for every payment endpoint', function() {
            var fetchOwnOrg = getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'orgs',
                idPath: ['user.org']
            }, payModule.config.api]);
            var fetchAnyOrg = getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'orgs',
                idPath: ['query.org', 'user.org']
            }, payModule.config.api]);

            expect(orgSvc._middleware.getClientToken).toContain(fetchOwnOrg);
            expect(orgSvc._middleware.getPaymentMethods).toContain(fetchAnyOrg);
            expect(orgSvc._middleware.createPaymentMethod).toContain(fetchOwnOrg);
            expect(orgSvc._middleware.editPaymentMethod).toContain(fetchOwnOrg);
            expect(orgSvc._middleware.deletePaymentMethod).toContain(fetchOwnOrg);
            expect(orgSvc._middleware.getPayments).toContain(fetchAnyOrg);
            expect(orgSvc._middleware.createPayment).toContain(fetchAnyOrg);
        });
        
        it('should add middleware to check if the requester can edit the org when modifying payment methods', function() {
            expect(orgSvc._middleware.createPaymentMethod).toContain(getBoundFn(payModule.canEditOrg, [payModule, orgSvc]));
            expect(orgSvc._middleware.editPaymentMethod).toContain(getBoundFn(payModule.canEditOrg, [payModule, orgSvc]));
            expect(orgSvc._middleware.deletePaymentMethod).toContain(getBoundFn(payModule.canEditOrg, [payModule, orgSvc]));
        });
        
        it('should add middleware to get the existing payment method when working with a payment method', function() {
            expect(orgSvc._middleware.editPaymentMethod).toContain(getBoundFn(payModule.getExistingPayMethod, [payModule, mockGateway]));
            expect(orgSvc._middleware.deletePaymentMethod).toContain(getBoundFn(payModule.getExistingPayMethod, [payModule, mockGateway]));
            expect(orgSvc._middleware.createPayment).toContain(getBoundFn(payModule.getExistingPayMethod, [payModule, mockGateway]));
        });
        
        it('should add middleware to validate the body when creating a payment', function() {
            expect(orgSvc._middleware.createPayment).toContain(payModule.validatePaymentBody);
        });

        it('should add middleware to check entitlements when creating a payment', function() {
            expect(orgSvc._middleware.createPayment).toContain(payModule.checkPaymentEntitlement);
        });
    });
    
    describe('formatPaymentOutput', function() {
        it('should format a payment for returning to the client', function() {
            expect(payModule.formatPaymentOutput(mockPayment)).toEqual({
                id: '1234',
                status: 'settled',
                type: 'sale',
                amount: 10.12,
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
                amount: 10.12,
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
    
    describe('canEditOrg', function() {
        beforeEach(function() {
            req.org = { id: 'o-1' };
            req.requester.permissions = { orgs: { edit: Scope.Own } };
            spyOn(orgSvc, 'checkScope').and.callThrough();
        });

        it('should call next if the requester is allowed to edit the org', function(done) {
            payModule.canEditOrg(orgSvc, req, nextSpy, doneSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalledWith();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req, req.org, 'edit');
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
                expect(orgSvc.checkScope).toHaveBeenCalledWith(req, req.org, 'edit');
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
    
    describe('checkPaymentEntitlement', function() {
        beforeEach(function() {
            req.query = { org: 'o-5678' };
        });
        
        it('should allow the request if the requester has makePaymentForAny', function() {
            req.requester.entitlements.makePaymentForAny = true;
            payModule.checkPaymentEntitlement(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.query.org).toBe('o-5678');
        });

        it('should allow the request if the requester has makePayment and is not specifying a different org', function() {
            req.query.org = req.user.org;
            req.requester.entitlements.makePayment = true;
            payModule.checkPaymentEntitlement(req, nextSpy, doneSpy);

            delete req.query.org;
            payModule.checkPaymentEntitlement(req, nextSpy, doneSpy);

            expect(nextSpy.calls.count()).toBe(2);
            expect(doneSpy).not.toHaveBeenCalled();
        });

        it('should return a 403 if the requester has makePayment and is specifying a different org', function() {
            req.requester.entitlements.makePayment = true;
            payModule.checkPaymentEntitlement(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Cannot make payment for another org' });
        });
        
        it('should return a 403 if the requester has neither', function() {
            payModule.checkPaymentEntitlement(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Forbidden' });
        });
    });
    
    describe('validatePaymentBody', function() {
        beforeEach(function() {
            req.body = { amount: 100, paymentMethod: 'asdf1234', description: 'foo' };
        });

        it('should call next if the body is valid', function() {
            payModule.validatePaymentBody(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if the body is missing required fields', function() {
            [{ amount: 100 }, { paymentMethod: 'asdf1234' }].forEach(function(body) {
                req.body = body;
                payModule.validatePaymentBody(req, nextSpy, doneSpy);
            });
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(2);
            expect(doneSpy.calls.argsFor(0)).toEqual([{ code: 400, body: 'Missing required field: paymentMethod' }]);
            expect(doneSpy.calls.argsFor(1)).toEqual([{ code: 400, body: 'Missing required field: amount' }]);
        });
        
        it('should call done if the amount is too low', function() {
            [-123, 0, 0.24].forEach(function(amount) {
                req.body.amount = amount;
                payModule.validatePaymentBody(req, nextSpy, doneSpy);
            });
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(3);
            doneSpy.calls.allArgs().forEach(function(args) {
                expect(args).toEqual([{ code: 400, body: 'amount must be greater than the min: 1' }]);
            });
        });
        
        it('should call done if the description is too long', function() {
            req.body.description = new Array(300).join(',').split(',').map(function() { return 'a'; }).join('');
            payModule.validatePaymentBody(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'description must have at most 255 characters' });
        });
        
        it('should call done if any field is the wrong type', function() {
            [
                { amount: 'many dollars', paymentMethod: 'asdf1234' },
                { amount: 100, paymentMethod: 10 },
                { amount: 100, paymentMethod: 'asdf1234', description: { eventType: 'credit' } }
            ].forEach(function(body) {
                req.body = body;
                payModule.validatePaymentBody(req, nextSpy, doneSpy);
            });
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy.calls.count()).toBe(3);
            expect(doneSpy.calls.argsFor(0)).toEqual([{ code: 400, body: 'amount must be in format: number' }]);
            expect(doneSpy.calls.argsFor(1)).toEqual([{ code: 400, body: 'paymentMethod must be in format: string' }]);
            expect(doneSpy.calls.argsFor(2)).toEqual([{ code: 400, body: 'description must be in format: string' }]);
        });
        
        it('should not allow overriding the model through fieldValidation', function() {
            req.requester.fieldValidation = { payments: { amount: { __required: false } } };
            req.body = { paymentMethod: 'asdf1234' };
            payModule.validatePaymentBody(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Missing required field: amount' });
        });
    });
    
    describe('handlePaymentMethodErrors', function() {
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
            payModule.handlePaymentMethodErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Invalid payment method' });
                expect(mockLog.info).toHaveBeenCalled();
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
            
            payModule.handlePaymentMethodErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Processor declined payment method' });
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain('2000');
                expect(mockLog.info.calls.mostRecent().args).toContain('Do Not Honor');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle gateway rejections', function(done) {
            error.verification = {
                status: 'gateway_rejected',
                gatewayRejectionReason: 'cvv'
            };
            
            payModule.handlePaymentMethodErrors(req, error).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Gateway declined payment method' });
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain('cvv');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with the error otherwise', function(done) {
            payModule.handlePaymentMethodErrors(req, error).then(function(resp) {
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
        var mockSearch;
        beforeEach(function() {
            mockSearch = {
                customerId: jasmine.createSpy('search.customerId()').and.callFake(function() { return mockSearch._customerId; }),
                _customerId: {
                    is: jasmine.createSpy('customerId().is()')
                },
                ids: jasmine.createSpy('search.ids()').and.callFake(function() { return mockSearch._ids; }),
                _ids: {
                    in: jasmine.createSpy('customerId().in()')
                }
            };
            
            mockGateway.transaction.search.and.callFake(function(queryCb) {
                var mockStream = new events.EventEmitter();
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
            req.org = { id: 'o-1', braintreeCustomer: '123456' };
            req.query = {};
        });
        
        it('should get payments for the org', function(done) {
            payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    {
                        id: 'p1',
                        status: undefined,
                        type: undefined,
                        amount: 10.0,
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
                        }
                    },
                    {
                        id: 'p2',
                        status: undefined,
                        type: undefined,
                        amount: 20.0,
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
                        }
                    }
                ]);
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'getPayments', jasmine.any(Function));
                expect(mockGateway.transaction.search).toHaveBeenCalledWith(jasmine.any(Function));
                expect(mockSearch.customerId).toHaveBeenCalledWith();
                expect(mockSearch._customerId.is).toHaveBeenCalledWith('123456');
                expect(mockSearch.ids).not.toHaveBeenCalled();
                expect(payModule.formatPaymentOutput.calls.count()).toBe(2);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the ids query param is set', function() {
            beforeEach(function() {
                req.query.ids = 'p1,p2,pfake';
            });

            it('should apply the filter to the braintree search', function(done) {
                payModule.getPayments(mockGateway, orgSvc, req).then(function(resp) {
                    expect(resp.code).toEqual(200);
                    expect(resp.body.length).toBe(2);
                    expect(mockGateway.transaction.search).toHaveBeenCalledWith(jasmine.any(Function));
                    expect(mockSearch.customerId).toHaveBeenCalledWith();
                    expect(mockSearch._customerId.is).toHaveBeenCalledWith('123456');
                    expect(mockSearch.ids).toHaveBeenCalledWith();
                    expect(mockSearch._ids.in).toHaveBeenCalledWith(['p1', 'p2', 'pfake']);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should handle invalid or weird param values', function(done) {
                q.all(['p1,,,,', 'p1', { $gt: '' }].map(function(val) {
                    var reqCopy = JSON.parse(JSON.stringify(req));
                    reqCopy.query.ids = val;
                    return payModule.getPayments(mockGateway, orgSvc, reqCopy);
                }))
                .then(function(results) {
                    results.forEach(function(resp) {
                        expect(resp.code).toEqual(200);
                    });
                    expect(mockSearch._ids.in.calls.count()).toBe(3);
                    expect(mockSearch._ids.in.calls.argsFor(0)).toEqual([['p1', '', '', '', '']]);
                    expect(mockSearch._ids.in.calls.argsFor(1)).toEqual([['p1']]);
                    expect(mockSearch._ids.in.calls.argsFor(2)).toEqual([['[object Object]']]);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
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
                var mockStream = new events.EventEmitter();
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
                    paymentMethodNonce: 'thisislegit',
                    creditCard: {
                        options: { failOnDuplicatePaymentMethod: false }
                    }
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'orgs' }, { braintreeCustomer: '123456' }, 'o-1');
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                        cardholderName: 'Johnny Testmonkey',
                        options: { failOnDuplicatePaymentMethod: false }
                    },
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should include the failOnDuplicatePaymentMethod in production', function(done) {
            mockGateway.config.environment = braintree.Environment.Production;
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toBeDefined();
                expect(mockGateway.customer.create).toHaveBeenCalledWith(jasmine.objectContaining({
                    creditCard: {
                        options: { failOnDuplicatePaymentMethod: true }
                    }
                }), jasmine.any(Function));
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                    paymentMethodNonce: 'thisislegit',
                    creditCard: {
                        options: { failOnDuplicatePaymentMethod: false }
                    }
                }, jasmine.any(Function));
                expect(mongoUtils.editObject).toHaveBeenCalledWith({ collectionName: 'orgs' }, { braintreeCustomer: '123456' }, 'o-1');
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should use the user\'s company for the customer\'s company if defined', function(done) {
            req.user.company = 'Heinz';
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toEqual(jasmine.objectContaining({ token: 'asdf1234' }));
                expect(mockGateway.customer.create).toHaveBeenCalledWith({
                    company: 'Heinz',
                    firstName: 'Unit',
                    lastName: 'Tests',
                    email: 'unit@tests.com',
                    paymentMethodNonce: 'thisislegit',
                    creditCard: {
                        options: { failOnDuplicatePaymentMethod: false }
                    }
                }, jasmine.any(Function));
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req,
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handlePaymentMethodErrors handles the error', function(done) {
            payModule.handlePaymentMethodErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.customer.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createCustomerWithMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.customer.create).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
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
                        makeDefault: true,
                        failOnDuplicatePaymentMethod: false
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalledWith({ token: 'asdf1234', cardType: 'visa' });
                expect(payModule.createCustomerWithMethod).not.toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                        makeDefault: false,
                        failOnDuplicatePaymentMethod: false
                    }
                }, jasmine.any(Function));
                expect(payModule.formatMethodOutput).toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should include the failOnDuplicatePaymentMethod in production', function(done) {
            mockGateway.config.environment = braintree.Environment.Production;
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp.code).toEqual(201);
                expect(resp.body).toBeDefined();
                expect(mockGateway.paymentMethod.create).toHaveBeenCalledWith({
                    customerId: '123456',
                    cardholderName: undefined,
                    paymentMethodNonce: 'thisislegit',
                    options: {
                        makeDefault: true,
                        failOnDuplicatePaymentMethod: true
                    }
                }, jasmine.any(Function));
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req,
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handleBraintreeError handles the error', function(done) {
            payModule.handlePaymentMethodErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.paymentMethod.create.and.callFake(function(id, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.createPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.paymentMethod.create).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).not.toHaveBeenCalled();
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req,
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
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should resolve if handleBraintreeError handles the error', function(done) {
            payModule.handlePaymentMethodErrors.and.returnValue(q({code: 400, body: 'Your card is bad' }));
            mockGateway.paymentMethod.update.and.callFake(function(token, cfg, cb) {
                cb('I GOT A PROBLEM');
            });
            payModule.editPaymentMethod(mockGateway, orgSvc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Your card is bad' });
                expect(mockGateway.paymentMethod.update).toHaveBeenCalled();
                expect(payModule.formatMethodOutput).not.toHaveBeenCalled();
                expect(payModule.handlePaymentMethodErrors).toHaveBeenCalledWith(req, 'I GOT A PROBLEM');
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
    
    describe('producePaymentEvent', function() {
        var payment, resps;
        beforeEach(function() {
            payment = { id: 'pay1', amount: 666.66 };
            req.org = { id: 'o-1' };
            req.user = { id: 'u-1', org: 'o-1', email: 'foo@test.com' };
            req.query = {};

            resps = {
                user: {
                    response: { statusCode: 200 },
                    body: [{ id: 'u-2', org: 'o-1', email: 'bar@test.com' }]
                },
                balance: {
                    response: { statusCode: 200 },
                    body: { balance: 9001.12, outstandingBudget: 500.43 }
                }
            };
            spyOn(requestUtils, 'proxyRequest').and.callFake(function(req, method, opts) {
                if (/balance/.test(opts.url)) return q(resps.balance);
                else return q(resps.user);
            });

            mockProducer = {
                produce: jasmine.createSpy('producer.produce()').and.returnValue(q({ success: 'yes' }))
            };
            spyOn(rcKinesis, 'JsonProducer').and.returnValue(mockProducer);
        });
        
        it('should produce an event into the kinesis stream', function(done) {
            payModule.producePaymentEvent(req, payment).then(function() {
                expect(rcKinesis.JsonProducer).toHaveBeenCalledWith('utStream', { region: 'us-east-1' });
                expect(mockProducer.produce).toHaveBeenCalledWith({
                    type: 'paymentMade',
                    data: {
                        payment: { id: 'pay1', amount: 666.66 },
                        user: { id: 'u-1', org: 'o-1', email: 'foo@test.com' },
                        balance: 9001.12,
                        target: undefined
                    }
                });
                expect(requestUtils.proxyRequest.calls.count()).toBe(1);
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'https://test.com/api/accounting/balance/',
                    qs: { org: 'o-1' }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass the target into the event body, if defined', function(done) {
            req.query.target = 'bob';
            payModule.producePaymentEvent(req, payment).then(function() {
                expect(rcKinesis.JsonProducer).toHaveBeenCalledWith('utStream', { region: 'us-east-1' });
                expect(mockProducer.produce).toHaveBeenCalledWith({
                    type: 'paymentMade',
                    data: {
                        payment: { id: 'pay1', amount: 666.66 },
                        user: { id: 'u-1', org: 'o-1', email: 'foo@test.com' },
                        balance: 9001.12,
                        target: 'bob'
                    }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the requester does not belong to the affected org', function() {
            beforeEach(function() {
                req.user.org = 'o-2';
            });
            
            it('should look up a user in the org to email', function(done) {
                payModule.producePaymentEvent(req, payment).then(function() {
                    expect(mockProducer.produce).toHaveBeenCalledWith({
                        type: 'paymentMade',
                        data: {
                            payment: { id: 'pay1', amount: 666.66 },
                            user: { id: 'u-2', org: 'o-1', email: 'bar@test.com' },
                            balance: 9001.12,
                            target: undefined
                        }
                    });
                    expect(requestUtils.proxyRequest.calls.count()).toBe(2);
                    expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                        url: 'https://test.com/api/account/users/',
                        qs: { org: 'o-1', limit: 1 }
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should resolve and log an error if the user request finds no users', function(done) {
                resps.user = {
                    response: { statusCode: 200 },
                    body: []
                };
            
                payModule.producePaymentEvent(req, payment).then(function() {
                    expect(mockProducer.produce).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect({
                        message: 'Failed looking up user for o-1',
                        reason: 'No users found'
                    }));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            ['balance', 'user'].forEach(function(type) {
                it('should resolve and log an error if the ' + type + ' request returns a 4xx', function(done) {
                    resps[type] = {
                        response: { statusCode: 400 },
                        body: 'I got a problem with YOU'
                    };
                
                    payModule.producePaymentEvent(req, payment).then(function() {
                        expect(mockProducer.produce).not.toHaveBeenCalled();
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect({
                            message: 'Failed looking up ' + type + ' for o-1',
                            reason: { code: 400, body: 'I got a problem with YOU' }
                        }));
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                    }).done(done);
                });

                it('should resolve and log an error if the ' + type + ' request rejects', function(done) {
                    resps[type] = q.reject('I GOT A PROBLEM');
                
                    payModule.producePaymentEvent(req, payment).then(function() {
                        expect(mockProducer.produce).not.toHaveBeenCalled();
                        expect(mockLog.error).toHaveBeenCalled();
                        expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('I GOT A PROBLEM'));
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                    }).done(done);
                });
            });
        });
        
        it('should resolve and log an error if producing the event fails', function(done) {
            mockProducer.produce.and.returnValue(q.reject('I GOT A PROBLEM'));
        
            payModule.producePaymentEvent(req, payment).then(function() {
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('I GOT A PROBLEM'));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('handlePaymentErrors', function() {
        var result;
        beforeEach(function() {
            result = {};
            req.org = { id: 'o-1', braintreeCustomer: 'cust1' };
            req.body = { amount: 100, paymentMethod: 'method1', description: 'foobar' };
        });
        
        it('should return a 400 if the payment method is declined', function(done) {
            result = {
                success: false,
                transaction: {
                    id: 'trans1',
                    status: 'processor_declined',
                    processorResponseCode: '2001',
                    processorResponseText: 'Insufficient Funds'
                }
            };
            
            payModule.handlePaymentErrors(result, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Payment method declined' });
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain('2001');
                expect(mockLog.info.calls.mostRecent().args).toContain('Insufficient Funds');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done); 
        });
        
        it('should return a 400 if the gateway rejects the transaction', function(done) {
            result = {
                success: false,
                message: 'Gateway rejected - not good',
                transaction: {
                    id: 'trans1',
                    status: 'gateway_rejected',
                    processorResponseCode: '2001',
                    processorResponseText: 'Insufficient Funds'
                }
            };
            
            payModule.handlePaymentErrors(result, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Gateway rejected - not good' });
                expect(mockLog.info).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('Gateway rejected - not good');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done); 
        });

        it('should reject if there are validation errors', function(done) {
            result = {
                success: false,
                errors: {
                    deepErrors: function() { return [{ attribute: 'amount', code: '123', message: 'TOO MUCH' }]; }
                }
            };

            payModule.handlePaymentErrors(result, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed to charge payment method');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('[ { attribute: \'amount\', code: \'123\', message: \'TOO MUCH\' } ]');
            }).done(done);
        });
        
        it('should reject if there is another unsuccessful response', function(done) {
            result = {
                success: false,
                message: 'i dunno what to tell you'
            };

            payModule.handlePaymentErrors(result, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed to charge payment method');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('i dunno what to tell you');
            }).done(done);
        });
    });
    
    describe('createPayment', function() {
        var transResp, appCreds;
        beforeEach(function() {
            appCreds = { key: 'cwrx', secret: 'omgsosecret' };
            req.org = { id: 'o-1', braintreeCustomer: 'cust1' };
            req.body = { amount: 100, paymentMethod: 'method1', description: 'foobar' };

            transResp = {
                success: true,
                transaction: {                       
                    id: 'trans1',
                    status: 'submitted_for_settlement',
                    amount: '100.00',
                    paymentInstrumentType: 'credit_card',
                    creditCard: { token: 'method1', cardType: 'visa' }
                }
            };
            mockGateway.transaction.sale.and.callFake(function(obj, cb) { cb(null, transResp); });
            
            spyOn(requestUtils, 'makeSignedRequest').and.returnValue(q({
                response: { statusCode: 201 },
                body: { id: 't-1234' }
            }));
            spyOn(payModule, 'producePaymentEvent').and.returnValue(q());
            spyOn(payModule, 'handlePaymentErrors').and.callFake(function(result, req) {
                if (result.success === false) {
                    return q({ code: 400, body: 'everything is under control' });
                } else {
                    return q.reject('EVERYTHING IS NOT UNDER CONTROL');
                }
            });
        });
        
        it('should create a transaction in braintree and in our system', function(done) {
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: jasmine.objectContaining({
                        id: 'trans1',
                        status: 'submitted_for_settlement',
                        amount: 100.0,
                        method: jasmine.objectContaining({
                            token: 'method1',
                            type: 'creditCard',
                            cardType: 'visa'
                        })
                    })
                });
                expect(orgSvc.customMethod).toHaveBeenCalledWith(req, 'createPayment', jasmine.any(Function));
                expect(mockGateway.transaction.sale).toHaveBeenCalledWith({
                    amount: '100.00',
                    paymentMethodToken: 'method1',
                    options: { submitForSettlement: true }
                }, jasmine.any(Function));
                expect(requestUtils.makeSignedRequest).toHaveBeenCalledWith(appCreds, 'post', {
                    url: 'https://test.com/api/transactions/',
                    json: { amount: 100, org: 'o-1', braintreeId: 'trans1', description: 'foobar' }
                });
                expect(payModule.producePaymentEvent).toHaveBeenCalledWith(req, resp.body);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 4xx and not create a transaction in our db if there is a handled braintree error', function(done) {
            transResp = { success: false, message: 'pretty sure you can handle me brah' };
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 400,
                    body: 'everything is under control'
                });
                expect(mockGateway.transaction.sale).toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).not.toHaveBeenCalled();
                expect(payModule.producePaymentEvent).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if there is an unhandled braintree error', function(done) {
            mockGateway.transaction.sale.and.callFake(function(obj, cb) { cb('I GOT A PROBLEM'); });
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('EVERYTHING IS NOT UNDER CONTROL');
                expect(mockGateway.transaction.sale).toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).not.toHaveBeenCalled();
                expect(payModule.producePaymentEvent).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if creating a transaction in our system fails with a 4xx', function(done) {
            requestUtils.makeSignedRequest.and.returnValue(q({
                response: { statusCode: 400 },
                body: 'Cant let you do that, sixxy'
            }));
        
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed to create transaction for payment');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect({ code: 400, body: 'Cant let you do that, sixxy' }));
                expect(payModule.producePaymentEvent).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if creating a transaction in our system rejects', function(done) {
            requestUtils.makeSignedRequest.and.returnValue(q.reject('honey, you got a big storm comin'));
        
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed to create transaction for payment');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('honey, you got a big storm comin'));
                expect(payModule.producePaymentEvent).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should return the result of customMethod if it returns early', function(done) {
            orgSvc.customMethod.and.returnValue(q({ code: 400, body: 'Yo request is bad' }));
            payModule.createPayment(mockGateway, orgSvc, appCreds, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Yo request is bad' });
                expect(mockGateway.transaction.sale).not.toHaveBeenCalled();
                expect(requestUtils.makeSignedRequest).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(payModule.producePaymentEvent).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
});
