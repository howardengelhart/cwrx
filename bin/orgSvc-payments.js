(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        express         = require('express'),
        braintree       = require('braintree'),
        rcKinesis       = require('rc-kinesis'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        requestUtils    = require('../lib/requestUtils'),
        
        payModule = { config: {} };

    // Adds extra middleware to orgSvc for custom payment methods. gateway === braintree client
    payModule.extendSvc = function(orgSvc, gateway, config) {
        payModule.config.kinesis = config.kinesis;
        payModule.config.minPayment = config.minPayment;
        payModule.config.api = config.api;
        Object.keys(payModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            payModule.config.api[key].baseUrl = urlUtils.resolve(
                payModule.config.api.root,
                payModule.config.api[key].endpoint
            );
        });
    
        var fetchAnyOrg = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'orgs',
            idPath: ['query.org', 'user.org']
        }, payModule.config.api);
        var fetchOwnOrg = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'orgs',
            idPath: ['user.org']
        }, payModule.config.api);
        
        var canEditOrg = payModule.canEditOrg.bind(payModule, orgSvc),
            getExistingPayMethod = payModule.getExistingPayMethod.bind(payModule, gateway);
            
        orgSvc.use('getClientToken', fetchOwnOrg);
        
        orgSvc.use('getPaymentMethods', fetchAnyOrg);
        
        orgSvc.use('createPaymentMethod', fetchOwnOrg);
        orgSvc.use('createPaymentMethod', canEditOrg);

        orgSvc.use('editPaymentMethod', fetchOwnOrg);
        orgSvc.use('editPaymentMethod', canEditOrg);
        orgSvc.use('editPaymentMethod', getExistingPayMethod);

        orgSvc.use('deletePaymentMethod', fetchOwnOrg);
        orgSvc.use('deletePaymentMethod', canEditOrg);
        orgSvc.use('deletePaymentMethod', getExistingPayMethod);

        orgSvc.use('getPayments', fetchAnyOrg);
        
        orgSvc.use('createPayment', payModule.checkPaymentEntitlement);
        orgSvc.use('createPayment', payModule.validatePaymentBody);
        orgSvc.use('createPayment', fetchAnyOrg);
        orgSvc.use('createPayment', getExistingPayMethod);
    };
    
    // Format braintree transaction records for returning to the client
    payModule.formatPaymentOutput = function(orig) {
        var formatted = {};
        
        ['id', 'status', 'type', 'createdAt', 'updatedAt'].forEach(function(key) {
            formatted[key] = orig[key];
        });
        formatted.amount = parseFloat(orig.amount);
        
        if (orig.paymentInstrumentType === 'credit_card') {
            formatted.method = payModule.formatMethodOutput(orig.creditCard);
        } else {
            formatted.method = payModule.formatMethodOutput(orig.paypal);
        }
        
        return formatted;
    };
    
    // Format braintree payment method records for returning to the client
    payModule.formatMethodOutput = function(orig) {
        var formatted = {};
        
        ['token', 'createdAt', 'updatedAt', 'imageUrl', 'default'].forEach(function(key) {
            formatted[key] = orig[key];
        });
        
        formatted.type = !!orig.cardType ? 'creditCard' : 'paypal';
        
        if (formatted.type === 'creditCard') {
            ['cardType', 'cardholderName', 'expirationDate', 'last4'].forEach(function(key) {
                formatted[key] = orig[key];
            });
        } else {
            formatted.email = orig.email || orig.payerEmail;
        }
        
        return formatted;
    };
    
    // Middleware to check if the requester can edit the org they're operating on (req.org)
    payModule.canEditOrg = function(orgSvc, req, next, done) {
        var log = logger.getLog();

        if (!orgSvc.checkScope(req, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return done({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        next();
    };
    
    /* Middleware to get an existing payment method. First fetches the org's braintree customer;
     * thus this will return 400 if the payment method does not exist for this customer. */
    payModule.getExistingPayMethod = function(gateway, req, next, done) {
        var log = logger.getLog(),
            token = (req.params && req.params.token) || (req.body && req.body.paymentMethod);

        if (!req.org.braintreeCustomer) {
            log.info('[%1] No BT customer for org %2, not making changes', req.uuid, req.org.id);
            return q(done({ code: 400, body: 'No payment methods for this org' }));
        }
        
        return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
        .then(function(cust) {
            var existing = (cust.paymentMethods || []).filter(function(method) {
                return method.token === token;
            })[0];

            if (!existing) {
                log.info('[%1] Payment method %2 does not exist for BT cust %3',
                         req.uuid, token, req.org.braintreeCustomer);
                         
                if (req.method.toLowerCase() === 'delete') {
                    return done({ code: 204 });
                } else {
                    return done({
                        code: 404,
                        body: 'That payment method does not exist for this org'
                    });
                }
            }
            
            req.paymentMethod = existing;
            
            next();
        })
        .catch(function(error) {
            if (error && error.name === 'notFoundError') {
                log.warn('[%1] BT customer %2 on org %3 not found',
                         req.uuid, req.org.braintreeCustomer, req.org.id);

                return done({
                    code: 400,
                    body: 'Braintree customer for this org does not exist'
                });
            } else {
                log.error('[%1] Error retrieving customer %2: %3',
                          req.uuid, req.org.braintreeCustomer, util.inspect(error));
                return q.reject('Braintree error');
            }
        });
    };
    
    /* Check requester for entitlement allowing them to make payments, also using it to decide
     * whether to allow a custom value for req.query.org */
    payModule.checkPaymentEntitlement = function(req, next, done) {
        var log = logger.getLog(),
            requesterOrg = (req.user && req.user.org) || null;

        // If requester has makePaymentForAny, allow req.query.org to be set & proceed
        if (req.requester.entitlements.makePaymentForAny === true) {
            return next();
        }
        else if (req.requester.entitlements.makePayment === true) {
            // Otherwise if req.query.org is set and not the requester's org, return 403
            if (!!req.query.org && req.query.org !== requesterOrg) {
                log.info('[%1] Requester %2 trying to make payment for other org %3',
                         req.uuid, req.requester.id, req.query.org);
                return done({
                    code: 403,
                    body: 'Cannot make payment for another org'
                });
            }

            // Allow the request if not specifying different org id
            return next();
        }
        
        // Return 403 if requester has no makePayment entitlement
        return done({
            code: 403,
            body: 'Forbidden'
        });
    };

    // Check that all parameters are set + valid for POSTing a new payment
    payModule.validatePaymentBody = function(req, next, done) {
        var log = logger.getLog();
        
        var model = new Model('payments', {
            amount: {
                __allowed: true,
                __type: 'number',
                __required: true,
                __min: payModule.config.minPayment,
                __locked: true
            },
            paymentMethod: {
                __allowed: true,
                __type: 'string',
                __required: true,
                __locked: true
            },
            description: {
                __allowed: true,
                __type: 'string',
                __length: 255
            }
        });

        var validResp = model.validate('create', req.body, {}, req.requester);
        
        if (!validResp.isValid) {
            log.info('[%1] Invalid payment body: %2', req.uuid, validResp.reason);
            return done({
                code: 400,
                body: validResp.reason
            });
        }
        
        next();
    };
    
    /* Attempt to handle expected braintree errors (from invalid input or declined cards).
     * Returns a 400 + msg if the error is handled, otherwise rejects the original error. */
    payModule.handlePaymentMethodErrors = function(req, error) {
        var log = logger.getLog(),
            validationErrors = [];
        
        error = error || {};
        
        // attempt to find validationErrors nested in braintree's error object
        try {
            validationErrors = error.errors.deepErrors();
        } catch(e) {}
        
        if (validationErrors.length !== 0) {
            log.info(
                '[%1] Failed payment method for %2: validation errors: %3',
                req.uuid,
                req.org.id,
                JSON.stringify(validationErrors, null, 2)
            );
            return q({ code: 400, body: 'Invalid payment method' });
        }
        
        // also handle processor declined + gateway rejected errors
        if (error.verification && error.verification.status === 'processor_declined') {
            log.info(
                '[%1] Failed payment method for %2: processor decline, code - %3, text - %4',
                req.uuid,
                req.org.id,
                error.verification.processorResponseCode,
                error.verification.processorResponseText
            );
            return q({ code: 400, body: 'Processor declined payment method' });
        }
        else if (error.verification && error.verification.status === 'gateway_rejected') {
            log.info(
                '[%1] Failed payment method for %2: gateway rejection: reason - %3',
                req.uuid,
                req.org.id,
                error.verification.gatewayRejectionReason
            );
            return q({ code: 400, body: 'Gateway declined payment method' });
        }
        
        return q.reject(error);
    };

    // Generate a braintree client token, which may be customized for the org's braintreeCustomer
    payModule.getClientToken = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'getClientToken', function() {
            var cfg = {};
            
            if (req.org && req.org.braintreeCustomer) {
                cfg.customerId = req.org.braintreeCustomer;
            }
            
            return q.npost(gateway.clientToken, 'generate', [cfg])
            .then(function(response) {
                var custMsg = cfg.customerId ? 'BT customer ' + cfg.customerId : 'new BT customer';

                log.info(
                    '[%1] Successfully generated braintree client token for %2',
                    req.uuid,
                    custMsg
                );
                return q({ code: 200, body: { clientToken: response.clientToken } });
            })
            .catch(function(error) {
                log.error('[%1] Error generating braintree client token: %2',
                          req.uuid, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    // Get existing payment methods for the org
    payModule.getPaymentMethods = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'getPaymentMethods', function() {
            if (!req.org.braintreeCustomer) {
                log.info('[%1] No braintree customer for org %2', req.uuid, req.org.id);
                return q({ code: 200, body: [] });
            }
            
            return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
            .then(function(customer) {
                log.info('[%1] Successfully got BT customer %2',req.uuid,req.org.braintreeCustomer);
                return q({
                    code: 200,
                    body: (customer.paymentMethods || []).map(payModule.formatMethodOutput)
                });
            })
            .catch(function(error) {
                if (error && error.name === 'notFoundError') {
                    log.warn('[%1] BT customer %2 on org %3 not found',
                             req.uuid, req.org.braintreeCustomer, req.org.id);

                    return q({
                        code: 400,
                        body: 'Braintree customer for this org does not exist'
                    });
                } else {
                    log.error('[%1] Error retrieving BT customer %2: %3',
                              req.uuid, req.org.braintreeCustomer, util.inspect(error));
                    return q.reject('Braintree error');
                }
            });
        });
    };
    
    /* Create a new braintree customer with the payment method from the request. Called by
     * createPaymentMethod() if the org has no existing braintree customer. Updates the org with
     * the new customer's id (direct edit bypassing permission checks). */
    payModule.createCustomerWithMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog(),
            failOnDup = gateway.config.environment === braintree.Environment.Production;
        
        var newCust = {
            company: req.org.name,
            paymentMethodNonce: req.body.paymentMethodNonce,
            creditCard: {
                options: {
                    failOnDuplicatePaymentMethod: failOnDup
                }
            }
        };
        
        if (req.body.cardholderName) {
            newCust.creditCard.cardholderName = req.body.cardholderName;
        }
        
        if (req.user.org === req.org.id) {
            newCust.firstName = req.user.firstName;
            newCust.lastName = req.user.lastName;
            newCust.email = req.user.email;
            newCust.company = req.user.company || newCust.company;
        }
        
        return q.npost(gateway.customer, 'create', [newCust])
        .then(function(result) {
            if (!result.success) {
                return q.reject(result);
            }
        
            log.info('[%1] Successfully created BT customer %2 for org %3',
                     req.uuid, result.customer.id, req.org.id);
            
            // directly edit to bypass restrictions on braintreeCustomer field
            return mongoUtils.editObject(
                orgSvc._coll,
                { braintreeCustomer: result.customer.id },
                req.org.id
            ).then(function() {
                return q({
                    code: 201,
                    body: payModule.formatMethodOutput(result.customer.paymentMethods[0])
                });
            });
        })
        .catch(payModule.handlePaymentMethodErrors.bind(payModule, req))
        .catch(function(error) {
            log.error('[%1] Error creating customer for org %2: %3',
                      req.uuid, req.org.id, util.inspect(error));
            return q.reject('Braintree error');
        });
    };
    
    // Create a new payment method for the org. Creates a new braintree customer if needed.
    payModule.createPaymentMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog(),
            cardName = req.body.cardholderName,
            failOnDup = gateway.config.environment === braintree.Environment.Production;
        
        if (!req.body.paymentMethodNonce) {
            log.info('[%1] Request has no paymentMethodNonce', req.uuid);
            return q({ code: 400, body: 'Must include a paymentMethodNonce' });
        }
        
        if (!!cardName && (typeof cardName !== 'string' || cardName.length > 175)) {
            log.info('[%1] Invalid cardholderName %2', req.uuid, cardName);
            return q({ code: 400, body: 'Invalid cardholderName' });
        }

        return orgSvc.customMethod(req, 'createPaymentMethod', function() {

            if (!req.org.braintreeCustomer) {
                return payModule.createCustomerWithMethod(gateway, orgSvc, req);
            }
            
            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: req.org.braintreeCustomer,
                cardholderName: cardName || undefined,
                paymentMethodNonce: req.body.paymentMethodNonce,
                options: {
                    makeDefault: !!req.body.makeDefault,
                    failOnDuplicatePaymentMethod: failOnDup
                }
            }])
            .then(function(result) {
                if (!result.success) {
                    return q.reject(result);
                }

                log.info('[%1] Successfully created payment method %2 for BT customer %3',
                         req.uuid, result.paymentMethod.token, req.org.braintreeCustomer);
                return q({
                    code: 201,
                    body: payModule.formatMethodOutput(result.paymentMethod)
                });
            })
            .catch(payModule.handlePaymentMethodErrors.bind(payModule, req))
            .catch(function(error) {
                log.error('[%1] Error creating paymentMethod for BT customer %2: %3',
                          req.uuid, req.org.braintreeCustomer, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    /* Edit an existing payment method for the org. req.body must either include a
     * paymentMethodNonce or only include a makeDefault flag */
    payModule.editPaymentMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog(),
            cardName = req.body.cardholderName,
            token = req.params.token,
            switchingDefault = false; // if only switching default, relax card verification
            
        if (req.body.makeDefault !== undefined && Object.keys(req.body).length === 1) {
            switchingDefault = true;
        } else if (!req.body.paymentMethodNonce) {
            log.info('[%1] Request has no paymentMethodNonce', req.uuid);
            return q({ code: 400, body: 'Must include a paymentMethodNonce' });
        }
        
        if (!!cardName && (typeof cardName !== 'string' || cardName.length > 175)) {
            log.info('[%1] Invalid cardholderName %2', req.uuid, cardName);
            return q({ code: 400, body: 'Invalid cardholderName' });
        }
        
        return orgSvc.customMethod(req, 'editPaymentMethod', function() {

            return q.npost(gateway.paymentMethod, 'update', [token, {
                cardholderName: cardName || undefined,
                paymentMethodNonce: req.body.paymentMethodNonce || undefined,
                options: {
                    makeDefault: !!req.body.makeDefault,
                    verifyCard: !switchingDefault
                }
            }])
            .then(function(result) {
                if (!result.success) {
                    return q.reject(result);
                }

                log.info('[%1] Successfully updated payment method %2 for BT customer %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({
                    code: 200,
                    body: payModule.formatMethodOutput(result.paymentMethod)
                });
            })
            .catch(payModule.handlePaymentMethodErrors.bind(payModule, req))
            .catch(function(error) {
                log.error('[%1] Error editing payment method %2: %3',
                          req.uuid, token, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    // Deletes the payment method specified in req.params.token (if tied to the org)
    payModule.deletePaymentMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog(),
            token = req.params.token;
        
        return orgSvc.customMethod(req, 'deletePaymentMethod', function() {
            
            return q.npost(gateway.paymentMethod, 'delete', [token])
            .then(function() {
                log.info('[%1] Successfully deleted payment method %2 for BT customer %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({ code: 204 });
            })
            .catch(function(error) {
                log.error('[%1] Error deleting payment method %2: %3',
                          req.uuid, token, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    
    /* Gets all payments made by the org. Fetches payments for all payment methods, even
     * methods that have since been deleted. */
    payModule.getPayments = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'getPayments', function() {
            var ids;

            if (!req.org.braintreeCustomer) {
                log.info('[%1] No braintreeCustomer for org %2, so no payments to show',
                         req.uuid, req.org.id);
                return q({ code: 200, body: [] });
            }
            if ('ids' in req.query) {
                ids = String(req.query.ids).split(',');
            }
            
            var streamDeferred = q.defer(),
                results = [];

            var stream = gateway.transaction.search(function(search) {
                search.customerId().is(req.org.braintreeCustomer);
                if (ids) {
                    search.ids().in(ids);
                }
            });
            
            stream.on('data', function(result) {
                results.push(payModule.formatPaymentOutput(result));
            })
            .on('error', function(error) {
                streamDeferred.reject('Error streaming transaction data: ' + util.inspect(error));
            })
            .on('end', function() {
                streamDeferred.resolve();
            });
            
            return streamDeferred.promise.then(function() {
                log.info('[%1] Received %2 payment records for BT customer %3',
                         req.uuid, results.length, req.org.braintreeCustomer);
                         
                return q({ code: 200, body: results });
            })
            .catch(function(error) {
                log.error('[%1] Error generating braintree client token: %2', req.uuid, error);
                return q.reject('Braintree error');
            });
        });
    };
    
    /* Produce a 'paymentMade' event into configured kinesis stream. The data for this event will
     * include the payment, a user from the org, and the org's account balance */
    payModule.producePaymentEvent = function(req, payment) {
        var log = logger.getLog(),
            producer = new rcKinesis.JsonProducer(payModule.config.kinesis.streamName, {
                region: payModule.config.kinesis.region
            }),
            userPromise, balancePromise;
        
        // If requester belongs to affected org, send receipt to them
        if (!!req.user && (req.org.id === req.user.org)) {
            userPromise = q(req.user);
        } else {
            // Otherwise, find a user from affected org to email
            log.info('[%1] Requester %2 looking up user from %3 to send receipt to',
                     req.uuid, req.requester.id, req.org.id);
            
            userPromise = requestUtils.proxyRequest(req, 'get', {
                url: payModule.config.api.users.baseUrl,
                qs: { org: req.org.id, limit: 1 }
            })
            .then(function(resp) {
                if (resp.response.statusCode !== 200) {
                    return q.reject({
                        message: 'Failed looking up user for ' + req.org.id,
                        reason: {
                            code: resp.response.statusCode,
                            body: resp.body
                        }
                    });
                }
                if (resp.body.length === 0) {
                    return q.reject({
                        message: 'Failed looking up user for ' + req.org.id,
                        reason: 'No users found'
                    });
                }
                
                return resp.body[0];
            });
        }
        
        // Fetch org's account balance to display in receipt
        balancePromise = requestUtils.proxyRequest(req, 'get', {
            url: payModule.config.api.balance.baseUrl,
            qs: { org: req.org.id }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 200) {
                return q.reject({
                    message: 'Failed looking up balance for ' + req.org.id,
                    reason: {
                        code: resp.response.statusCode,
                        body: resp.body
                    }
                });
            }
            
            return resp.body.balance;
        });
        
        return q.all([userPromise, balancePromise]).spread(function(user, balance) {
            log.info('[%1] Producing paymentMade event, user is %2, email %3',
                     req.uuid, user.id, user.email);
            return producer.produce({
                type: 'paymentMade',
                data: {
                    payment: payment,
                    balance: balance,
                    user: user,
                    target: req.query.target || undefined
                }
            });
        })
        .then(function(/*resp*/) {
            log.info('[%1] Produced paymentMade event for payment %2', req.uuid, payment.id);
        })
        .catch(function(error) {
            log.error('[%1] Failed producing paymentMade event for payment %2: %3',
                      req.uuid, payment.id, util.inspect(error));
        })
        .thenResolve(); // always resolve so a successful request does not fail b/c of watchman
    };
    
    // Attempt to handle errors from braintree's transaction.sale. May return a 400 response
    payModule.handlePaymentErrors = function(result, req) {
        var log = logger.getLog();

        // Attempt to handle processor decline errors as 400s
        if (result.success === false) {
            if (ld.get(result, 'transaction.status', null) === 'processor_declined') {
                log.info(
                    '[%1] Processor declined payment for BT cust %2, org %3: %4 - %5',
                    req.uuid,
                    req.org.braintreeCustomer,
                    req.org.id,
                    result.transaction.processorResponseCode,
                    result.transaction.processorResponseText
                );
                return q({ code: 400, body: 'Payment method declined' });
            }
            // attempt to handle gateway rejections as 400s, but log.warn()
            else if (ld.get(result, 'transaction.status', null) === 'gateway_rejected') {
                log.warn('[%1] Gateway rejected payment for BT cust %2, org %3: %4',
                         req.uuid, req.org.braintreeCustomer, req.org.id, result.message);
                return q({ code: 400, body: result.message });
            }
        }
        
        // If not a processor or gateway decline, error is unexpected, so log.error() and reject
        var errMsg;
        try { // attempt to find validationErrors nested in braintree's error object
            var validationErrors = result.errors.deepErrors();
            errMsg = (validationErrors.length > 0) ? util.inspect(validationErrors) : '';
        } catch(e) {}
        
        errMsg = errMsg || result.message || util.inspect(result);
        
        log.error('[%1] Failed creating payment for BT cust %2, org %3: %4',
                  req.uuid, req.org.braintreeCustomer, req.org.id, errMsg);
                  
        return q.reject('Failed to charge payment method');
    };
    
    // Charge a user's paymentMethod in braintree + create a corresponding transaction in our db
    payModule.createPayment = function(gateway, orgSvc, appCreds, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'createPayment', function() {
            return q.npost(gateway.transaction, 'sale', [{
                amount: req.body.amount.toFixed(2),
                paymentMethodToken: req.body.paymentMethod,
                options: {
                    submitForSettlement: true
                }
            }])
            .then(function(result) {
                if (!result.success) {
                    return q.reject(result);
                } else {
                    return q(result);
                }
            })
            .catch(function(error) {
                return payModule.handlePaymentErrors(error, req);
            })
            .then(function(result) {
                // break out of this if we have a 4xx response
                if (result.code && !result.transaction) {
                    return q(result);
                }

                log.info('[%1] Successfully created payment %2 for BT customer %3, org %4',
                         req.uuid, result.transaction.id, req.org.braintreeCustomer, req.org.id);
                
                return requestUtils.makeSignedRequest(appCreds, 'post', {
                    url: payModule.config.api.transactions.baseUrl,
                    json: {
                        amount      : req.body.amount,
                        org         : req.org.id,
                        braintreeId : result.transaction.id,
                        description : req.body.description
                    }
                })
                .then(function(resp) {
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    log.info('[%1] Successfully created transaction %2 for payment %3, org %4',
                             req.uuid, resp.body.id, req.body.paymentMethod, req.org.id);
                             
                    var formatted = payModule.formatPaymentOutput(result.transaction);
                    
                    return payModule.producePaymentEvent(req, formatted)
                    .thenResolve({
                        code: 201,
                        body: formatted
                    });
                })
                .catch(function(error) {
                    log.error(
                        '[%1] Failed to create transaction for payment %2 ($%3) for org %4: %5',
                        req.uuid,
                        result.transaction.id,
                        req.body.amount,
                        req.org.id,
                        util.inspect(error)
                    );
                    
                    return q.reject('Failed to create transaction for payment');
                });
            });
        });
    };


    payModule.setupEndpoints = function(app, orgSvc, gateway, appCreds, sessions, audit,
                                                                                  jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/payments?'; // prefix to these endpoints
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetOrg = authUtils.middlewarify({ allowApps: true, permissions: { orgs: 'read' } }),
            authPutOrg = authUtils.middlewarify({ permissions: { orgs: 'edit' } });

        router.get('/clientToken', sessions, authGetOrg, audit, function(req, res) {
            delete req.query.org; // unsupported for this endpoint

            var promise = payModule.getClientToken(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error generating clientToken', detail: error });
                });
            });
        });

        router.get('/methods?/', sessions, authGetOrg, audit, function(req, res) {
            var promise = payModule.getPaymentMethods(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving payment methods', detail: error });
                });
            });
        });
        
        router.post('/methods?/', sessions, authPutOrg, audit, function(req, res) {
            delete req.query.org; // unsupported for this endpoint

            var promise = payModule.createPaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating payment method', detail: error });
                });
            });
        });

        router.put('/methods?/:token', sessions, authPutOrg, audit, function(req, res) {
            delete req.query.org; // unsupported for this endpoint

            var promise = payModule.editPaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing payment method', detail: error });
                });
            });
        });
        
        router.delete('/methods?/:token', sessions, authPutOrg, audit, function(req, res) {
            delete req.query.org; // unsupported for this endpoint

            var promise = payModule.deletePaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting payment method', detail: error });
                });
            });
        });
        
        router.get('/', sessions, authGetOrg, audit, function(req, res) {
            var promise = payModule.getPayments(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving payment methods', detail: error });
                });
            });
        });

        var authMakePayment = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read' }
        });
        router.post('/', sessions, authMakePayment, audit, function(req, res) {
            var promise = payModule.createPayment(gateway, orgSvc, appCreds, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating payment', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = payModule;
}());

