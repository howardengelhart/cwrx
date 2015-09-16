(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        Status          = require('../lib/enums').Status,
        
        payModule = {}; // for exporting functions to unit tests

    payModule.extendSvc = function(orgSvc, gateway) {
        var fetchOrgRequired = payModule.fetchOrg.bind(payModule, true, orgSvc),
            fetchOrgOptional = payModule.fetchOrg.bind(payModule, false, orgSvc),
            canEditOrg = payModule.canEditOrg.bind(payModule, orgSvc),
            getExistingPayMethod = payModule.getExistingPayMethod.bind(payModule, gateway);
            
        orgSvc.use('getClientToken', fetchOrgOptional);
        
        orgSvc.use('getPaymentMethods', fetchOrgRequired);
        
        orgSvc.use('createPaymentMethod', fetchOrgRequired);
        orgSvc.use('createPaymentMethod', canEditOrg);

        orgSvc.use('editPaymentMethod', fetchOrgRequired);
        orgSvc.use('editPaymentMethod', canEditOrg);
        orgSvc.use('editPaymentMethod', getExistingPayMethod);

        orgSvc.use('deletePaymentMethod', fetchOrgRequired);
        orgSvc.use('deletePaymentMethod', canEditOrg);
        orgSvc.use('deletePaymentMethod', getExistingPayMethod);
        orgSvc.use('deletePaymentMethod', payModule.checkMethodInUse.bind(payModule, orgSvc));

        orgSvc.use('getPayments', fetchOrgRequired);
    };
    

    payModule.formatPaymentOutput = function(orig) {
        //TODO TODO: want to show campaignId or something here!
        var formatted = {};
        
        ['id', 'status', 'type', 'amount', 'createdAt', 'updatedAt'].forEach(function(key) {
            formatted[key] = orig[key];
        });
        
        //TODO: anything to be done about missing default + timestamp fields?
        if (orig.paymentInstrumentType === 'credit_card') {
            formatted.method = payModule.formatMethodOutput(orig.creditCard);
        } else {
            formatted.method = payModule.formatMethodOutput(orig.paypal);
        }
        
        return formatted;
    };
    
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
            formatted.email = orig.email;
        }
        
        return formatted;
    };
    
    payModule.fetchOrg = function(required, orgSvc, req, next, done) {
        var log = logger.getLog();
        
        if (!req.query.org) {
            if (!!required) {
                log.info('[%1] Required query param org not provided', req.uuid);
                return q(done({ code: 400, body: 'org query param is required' }));
            } else {
                return q(next());
            }
        }
        
        log.trace('[%1] Fetching org %2', req.uuid, String(req.query.org));
        return orgSvc.getObjs({ id: String(req.query.org) }, req, false)
        .then(function(resp) {
            if (resp.code !== 200) {
                return done(resp);
            }
            
            req.org = resp.body;
            next();
        })
        .catch(function(error) { //TODO: hand-test this, i think you're gonna get like 3 errors
            log.error('[%1] Error fetching org %2 for payment service: %3',
                      req.uuid, req.query.org, error && error.stack || error);
            return q.reject(error);
        });
    };

    payModule.canEditOrg = function(orgSvc, req, next, done) {
        var log = logger.getLog();

        if (!orgSvc.checkScope(req.user, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return done({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        next();
    };
    
    payModule.getExistingPayMethod = function(gateway, req, next, done) {
        var log = logger.getLog(),
            token = req.params.token;

        if (!req.org.braintreeCustomer) {
            log.info('[%1] No BT customer for org %2, not making changes', req.uuid, req.org.id);
            return done({ code: 400, body: 'No payment methods for this org' });
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
            if (error && error.name === 'Not Found') {
                log.warn('[%1] BT customer %2 on org %3 not found',
                         req.uuid, req.org.braintreeCustomer, req.org.id);

                return done({
                    code: 400,
                    body: 'Braintree customer for this org does not exist'
                });
            } else {
                log.error('[%1] Error retrieving customer %2: %3',
                          req.uuid, req.org.braintreeCustomer, util.inspect(error));
                return q.reject(error);
            }
        });
    };

    payModule.checkMethodInUse = function(orgSvc, req, next, done) {
        var log = logger.getLog(),
            query = {
                paymentMethod: req.paymentMethod.token,
                status: { $nin: [Status.Deleted, Status.Expired, Status.Canceled] }
            };
            
        return q.npost(orgSvc._db.collection('campaigns'), 'count', [query])
        .then(function(campCount) {
            if (campCount > 0) {
                log.info('[%1] Payment Method %2 still used by %3 campaigns',
                         req.uuid, req.paymentMethod.token, campCount);

                return done({ code: 400, body: 'Payment method still in use by campaigns' });
            }
            
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for campaigns: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };
    
    payModule.handleValidationErrors = function(req, error) {
        var log = logger.getLog();

        if (/Credit card type is not accepted/.test(error && error.message)) {
            log.info('[%1] Credit card type not accepted by our merchant account', req.uuid);
            return q({ code: 400, body: 'Credit card type not accepted' });
        }
        //TODO: add in more cases
        
        return q.reject(error);
    };



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
    
    payModule.getPaymentMethods = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return orgSvc.customMethod(req, 'getPaymentMethods', function() {
            if (!req.org.braintreeCustomer) {
                return q({ code: 200, body: [] });
            }
            
            return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
            .then(function(customer) {
                log.info('[%1] Successfully got BT customer %2', req.uuid, req.org.braintreeCustomer);
                return q({
                    code: 200,
                    body: (customer.paymentMethods || []).map(payModule.formatMethodOutput)
                });
            })
            .catch(function(error) {
                log.error('[%1] Error fetching BT customer %2: %3',
                          req.uuid, req.org.braintreeCustomer, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    payModule.createCustomerWithMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        var newCust = {
            company: req.org.name, //TODO: can we fill in any other customer fields?
            paymentMethodNonce: req.body.paymentMethodNonce
        };
        
        if (req.body.cardholderName) {
            newCust.creditCard = { cardholderName: req.body.cardholderName };
        }
        
        return q.npost(gateway.customer, 'create', [newCust])
        .then(function(result) {
            if (!result.success) {
                return q.reject({ message: result.message, errors: result.errors });
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
        .catch(payModule.handleValidationErrors.bind(payModule, req))
        .catch(function(error) {
            log.error('[%1] Error creating customer for org %2: %3',
                      req.uuid, req.org.id, util.inspect(error));
            return q.reject('Braintree error');
        });
    };
    
    payModule.createPaymentMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        if (!req.body.paymentMethodNonce) {
            log.info('[%1] Request has no paymentMethodNonce', req.uuid);
            return q({ code: 400, body: 'Must include a paymentMethodNonce' });
        }

        return orgSvc.customMethod(req, 'createPaymentMethod', function() {

            if (!req.org.braintreeCustomer) {
                return payModule.createCustomerWithMethod(gateway, orgSvc, req);
            }
            
            return q.npost(gateway.paymentMethod, 'create', [{
                customerId: req.org.braintreeCustomer,
                cardholderName: req.body.cardholderName || undefined,
                paymentMethodNonce: req.body.paymentMethodNonce,
                options: {
                    makeDefault: !!req.body.makeDefault
                }
            }])
            .then(function(result) {
                if (!result.success) {
                    return q.reject({ message: result.message, errors: result.errors });
                }

                log.info('[%1] Successfully created payment method %2 for BT customer %3',
                         req.uuid, result.paymentMethod.token, req.org.braintreeCustomer);
                return q({
                    code: 201,
                    body: payModule.formatMethodOutput(result.paymentMethod)
                });
            })
            .catch(payModule.handleValidationErrors.bind(payModule, req))
            .catch(function(error) {
                log.error('[%1] Error creating paymentMethod for BT customer %2: %3',
                          req.uuid, req.org.braintreeCustomer, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
    payModule.editPaymentMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog(),
            token = req.params.token;
        
        if (!req.body.paymentMethodNonce) {
            log.info('[%1] Request has no paymentMethodNonce', req.uuid);
            return q({ code: 400, body: 'Must include a paymentMethodNonce' });
        }
        
        return orgSvc.customMethod(req, 'editPaymentMethod', function() {

            return q.npost(gateway.paymentMethod, 'update', [token, {
                cardholderName: req.body.cardholderName || undefined,
                paymentMethodNonce: req.body.paymentMethodNonce,
                options: {
                    makeDefault: !!req.body.makeDefault
                }
            }])
            .then(function(result) {
                if (!result.success) {
                    return q.reject({ message: result.message, errors: result.errors });
                }

                log.info('[%1] Successfully updated payment method %2 for BT customer %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({
                    code: 200,
                    body: payModule.formatMethodOutput(result.paymentMethod)
                });
            })
            .catch(payModule.handleValidationErrors.bind(payModule, req))
            .catch(function(error) {
                log.error('[%1] Error editing payment method %2: %3',
                          req.uuid, token, util.inspect(error));
                return q.reject('Braintree error');
            });
        });
    };
    
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
                //TODO: other filters here? dates? statuses?
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
                return q({ code: 200, body: results });
            })
            .catch(function(error) {
                log.error('[%1] Error generating braintree client token: %2', req.uuid, error);
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
            var promise = payModule.createPaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating payment method', detail: error });
                });
            });
        });

        router.put('/methods?/:token', sessions, authPutOrg, audit, function(req, res) {
            var promise = payModule.editPaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing payment method', detail: error });
                });
            });
        });
        
        router.delete('/methods?/:token', sessions, authPutOrg, audit, function(req, res) {
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

