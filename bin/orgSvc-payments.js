(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        Status          = require('../lib/enums').Status,
        
        payModule = {};

    // Adds extra middleware to orgSvc for custom payment methods. gateway === braintree client
    payModule.extendSvc = function(orgSvc, gateway) {
        var fetchOrg = payModule.fetchOrg.bind(payModule, orgSvc),
            canEditOrg = payModule.canEditOrg.bind(payModule, orgSvc),
            getExistingPayMethod = payModule.getExistingPayMethod.bind(payModule, gateway);
            
        orgSvc.use('getClientToken', fetchOrg);
        
        orgSvc.use('getPaymentMethods', fetchOrg);
        
        orgSvc.use('createPaymentMethod', fetchOrg);
        orgSvc.use('createPaymentMethod', canEditOrg);

        orgSvc.use('editPaymentMethod', fetchOrg);
        orgSvc.use('editPaymentMethod', canEditOrg);
        orgSvc.use('editPaymentMethod', getExistingPayMethod);

        orgSvc.use('deletePaymentMethod', fetchOrg);
        orgSvc.use('deletePaymentMethod', canEditOrg);
        orgSvc.use('deletePaymentMethod', getExistingPayMethod);
        orgSvc.use('deletePaymentMethod', payModule.checkMethodInUse.bind(payModule, orgSvc));

        orgSvc.use('getPayments', fetchOrg);
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
        
        formatted.campaignId = orig.customFields && orig.customFields.campaign;
        
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
    payModule.fetchOrg = function(orgSvc, req, next, done) {
        var log = logger.getLog(),
            orgId = req.query.org || req.user.org;
            
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

        if (!orgSvc.checkScope(req.user, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return done({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        next();
    };
    
    /* Middleware to get an existing payment method. First fetches the org's braintree customer;
     * thus this will return 400 if the payment method does not exist for this customer. */
    payModule.getExistingPayMethod = function(gateway, req, next, done) {
        var log = logger.getLog(),
            token = req.params.token;

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

    // Checks if the payment method is in use unfinished campaigns
    payModule.checkMethodInUse = function(orgSvc, req, next, done) {
        var log = logger.getLog(),
            query = {
                paymentMethod: req.params.token,
                status: { $nin: [Status.Deleted, Status.Expired, Status.Canceled] }
            };
            
        return q.npost(orgSvc._db.collection('campaigns'), 'count', [query])
        .then(function(campCount) {
            if (campCount > 0) {
                log.info('[%1] Payment Method %2 still used by %3 campaigns',
                         req.uuid, req.params.token, campCount);

                return done({ code: 400, body: 'Payment method still in use by campaigns' });
            }
            
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for campaigns: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };
    
    /* Attempt to handle expected braintree errors (from invalid input or declined cards).
     * Returns a 400 + msg if the error is handled, otherwise rejects the original error. */
    payModule.handleBraintreeErrors = function(req, error) {
        var log = logger.getLog(),
            validationErrors = [];
        
        error = error || {};
        
        // attempt to find validationErrors nested in braintree's error object
        try {
            var errorColls = error.errors.errorCollections;
            ['customer', 'paymentMethod', 'creditCard', 'paypal'].forEach(function(type) {
                if (errorColls[type] && Object.keys(errorColls[type]).length !== 0) {
                    var obj = {};
                    obj[type] = errorColls[type];
                    validationErrors.push(obj);
                }
            });
        } catch(e) {}
        
        if (validationErrors.length !== 0) {
            log.info(
                '[%1] Validation errors on payment method for %2: %3',
                req.uuid,
                req.org && req.org.braintreeCustomer ? req.org.braintreeCustomer : 'new BT cust',
                error.message
            );
            log.trace('[%1] errors: %2', req.uuid, JSON.stringify(validationErrors, null, 2));
            return q({ code: 400, body: 'Invalid payment method' });
        }
        
        // also handle processor declined + gateway rejected errors
        if (error.verification && error.verification.status === 'processor_declined') {
            log.info(
                '[%1] Processor declined payment method for %2: code - %3, text - %4',
                req.uuid,
                req.org && req.org.braintreeCustomer ? req.org.braintreeCustomer : 'new BT cust',
                error.verification.processorResponseCode,
                error.verification.processorResponseText
            );
            
            return q({ code: 400, body: 'Processor declined payment method' });
        }
        else if (error.verification && error.verification.status === 'gateway_rejected') {
            log.info(
                '[%1] Gateway rejected payment method for %2: reason - %3',
                req.uuid,
                req.org && req.org.braintreeCustomer ? req.org.braintreeCustomer : 'new BT cust',
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
    
    // Decorate payments with campaign names by querying mongo for campaigns
    payModule.decoratePayments = function(payments, orgSvc, req) {
        var log = logger.getLog(),
            campIds = [],
            cursor;
            
        payments.forEach(function(payment) {
            if (payment.campaignId) {
                campIds.push(payment.campaignId);
            }
        });
        
        if (campIds.length === 0) {
            return q(payments);
        }
            
        // Note this query bypasses perm checks, and can get deleted campaigns
        cursor = orgSvc._db.collection('campaigns').find(
            { id: { $in: campIds } },
            { id: 1, name: 1 }
        );
        
        return q.npost(cursor, 'toArray').then(function(campaigns) {
            var mapping = campaigns.reduce(function(map, camp) {
                map[camp.id] = camp.name;
                return map;
            }, {});
            
            payments.forEach(function(payment) {
                payment.campaignName = mapping[payment.campaignId];
                
                if (payment.campaignId && !payment.campaignName) {
                    log.warn('[%1] Campaign %2 from payment %3 not found in db',
                             req.uuid, payment.campaignId, payment.id);
                }
            });
        })
        .catch(function(error) {
            log.error('[%1] Error looking up campaigns for payments: %2',
                      req.uuid, util.inspect(error));
        })
        .then(function() { // always show payments, even if we fail to decorate them
            return payments;
        });
    };

    /* Gets all transactions made by the org. Fetches transactions for all payment methods, even
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
                log.info('[%1] Received %2 transaction records for BT customer %3',
                         req.uuid, results.length, req.org.braintreeCustomer);
                         
                return payModule.decoratePayments(results, orgSvc, req);
            }).then(function(decorated) {
                return q({ code: 200, body: decorated });
            })
            .catch(function(error) {
                log.error('[%1] Error generating braintree client token: %2', req.uuid, error);
                return q.reject('Braintree error');
            });
        });
    };
    
    // Get existing payment methods for the org
    payModule.getPaymentMethods = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'getPaymentMethods', function() {
            if (!req.org.braintreeCustomer) {
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
        .catch(payModule.handleBraintreeErrors.bind(payModule, req))
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
            .catch(payModule.handleBraintreeErrors.bind(payModule, req))
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
            .catch(payModule.handleBraintreeErrors.bind(payModule, req))
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

    payModule.setupEndpoints = function(app, orgSvc, gateway, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/payments'; // prefix to these endpoints
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetOrg = authUtils.middlewarify({orgs: 'read'});
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
        
        var authPutOrg = authUtils.middlewarify({orgs: 'edit'});
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
                    res.send(500, { error: 'Error retrieving payment methods',detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = payModule;
}());

