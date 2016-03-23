(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        express         = require('express'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        requestUtils    = require('../lib/requestUtils'),
        
        payModule = { config: {} };

    // Adds extra middleware to orgSvc for custom payment methods. gateway === braintree client
    payModule.extendSvc = function(orgSvc, gateway, config) {
        payModule.config.api = config.api;
        payModule.config.api.transactions.baseUrl = urlUtils.resolve(
            payModule.config.api.root,
            payModule.config.api.transactions.endpoint
        );
    
        var fetchAnyOrg = payModule.fetchOrg.bind(payModule, orgSvc, true),
            fetchOwnOrg = payModule.fetchOrg.bind(payModule, orgSvc, false),
            canEditOrg = payModule.canEditOrg.bind(payModule, orgSvc),
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
        
        orgSvc.use('createPayment', payModule.validatePaymentBody);
        orgSvc.use('createPayment', fetchOwnOrg);
        orgSvc.use('createPayment', getExistingPayMethod);
    };
    
    // Format braintree transaction records for returning to the client
    payModule.formatPaymentOutput = function(orig) {
        var formatted = {};
        
        ['id', 'status', 'type', 'amount', 'createdAt', 'updatedAt'].forEach(function(key) {
            formatted[key] = orig[key];
        });
        
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
    
    // Middleware to fetch the org and attach it as req.org.
    // If useParam is true, will allow fetching req.query.org; otherwise default to req.user.org
    payModule.fetchOrg = function(orgSvc, useParam, req, next, done) {
        var log = logger.getLog(),
            orgId = (!!useParam && req.query.org) || req.user.org;
            
        log.trace('[%1] Fetching org %2', req.uuid, String(orgId));
        return orgSvc.getObjs({ id: String(orgId) }, req, false)
        .then(function(resp) {
            if (resp.code !== 200) {
                return done(resp);
            }
            
            req.org = resp.body;
            next();
        });
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

    // Check that all parameters are set + valid for POSTing a new payment
    payModule.validatePaymentBody = function(req, next, done) {
        var log = logger.getLog();
        
        var model = new Model('payments', {
            amount: {
                __allowed: true,
                __type: 'number',
                __required: true,
                __min: 50,
                __locked: true
            },
            paymentMethod: {
                __allowed: true,
                __type: 'string',
                __required: true,
                __locked: true
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
        var log = logger.getLog();
        
        var newCust = {
            company: req.org.name,
            paymentMethodNonce: req.body.paymentMethodNonce
        };
        
        if (req.body.cardholderName) {
            newCust.creditCard = {
                cardholderName: req.body.cardholderName
            };
        }
        
        if (req.user.org === req.org.id) {
            newCust.firstName = req.user.firstName;
            newCust.lastName = req.user.lastName;
            newCust.email = req.user.email;
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
            cardName = req.body.cardholderName;
        
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
                    makeDefault: !!req.body.makeDefault
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

            if (!req.org.braintreeCustomer) {
                log.info('[%1] No braintreeCustomer for org %2, so no payments to show',
                         req.uuid, req.org.id);
                return q({ code: 200, body: [] });
            }
            
            var streamDeferred = q.defer(),
                results = [];

            var stream = gateway.transaction.search(function(search) {
                search.customerId().is(req.org.braintreeCustomer);
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
    
    // Charge a user's paymentMethod in braintree + create a corresponding transaction in our db
    payModule.createPayment = function(gateway, orgSvc, appCreds, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'createPayment', function() {
            return q.npost(gateway.transaction, 'sale', [{
                amount: String(req.body.amount),
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
            .catch(function(result) {
                // Attempt to handle processor decline errors as 400s
                if (result.success === false && result.transaction &&
                    result.transaction.status === 'processor_declined') {
                    
                    log.info(
                        '[%1] Failed creating payment for BT cust %2, org %3: %4 - %5',
                        req.uuid,
                        req.org.braintreeCustomer,
                        req.org.id,
                        result.transaction.processorResponseCode,
                        result.transaction.processorResponseText
                    );
                    return q({
                        code: 400,
                        body: 'Payment method declined'
                    });
                }
                
                // If not a processor decline, error is unexpected, so log.error() and reject
                var errMsg;
                try { // attempt to find validationErrors nested in braintree's error object
                    errMsg = util.inspect(result.errors.deepErrors());
                } catch(e) {
                    errMsg = result.message || util.inspect(result);
                }
                
                log.error('[%1] Failed creating payment for BT cust %2, org %3: %4',
                          req.uuid, req.org.braintreeCustomer, req.org.id, errMsg);
                          
                return q.reject('Failed to charge payment method');
            })
            .then(function(result) {
                // break out of this if we have a 4xx response
                if (result.code && !result.transaction) { //TODO: this still feels real awkward
                    return q(result);
                }

                log.info('[%1] Successfully created payment %2 for BT customer %3, org %4',
                         req.uuid, result.transaction.id, req.org.braintreeCustomer, req.org.id);
                
                return requestUtils.makeSignedRequest(appCreds, 'post', {
                    url: payModule.config.api.transactions.baseUrl,
                    json: {
                        amount      : req.body.amount,
                        org         : req.org.id,
                        braintreeId : result.transaction.id
                    }
                })
                .then(function(resp) {
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    log.info('[%1] Successfully created transaction %2 for payment %3, org %4',
                             req.uuid, resp.body.id, req.body.paymentMethod, req.org.id);
                             
                    //TODO: publish watchman event
                             
                    return q({
                        code: 201,
                        body: payModule.formatPaymentOutput(result.transaction)
                    });
                })
                .catch(function(error) {
                    log.error('[%1] Failed to create transaction for successful payment %2: %3',
                              req.uuid, result.transaction.id, util.inspect(error));
                    
                    //TODO: do anything else here? void BT transaction? or just rely on manual fix?
                    
                    return q.reject('Failed to create transaction for payment');
                });
            });
        });
    };


    payModule.setupEndpoints = function(app, orgSvc, gateway, appCreds, sessions, audit,
                                                                                  jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/payments'; // prefix to these endpoints
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetOrg = authUtils.middlewarify({ permissions: { orgs: 'read' } }),
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
            permissions: { orgs: 'read' },
            entitlements: { makePayment: true }
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

