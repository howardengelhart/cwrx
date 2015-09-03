(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        
        payModule = {}; // for exporting functions to unit tests

// TODO: consider some sort of middleware system here (CrudSvc or express) to modularize things

    payModule.formatPaymentOutput = function(payment) {
        //TODO: trim some fields, etc?
        return payment;
    };
    
    payModule.formatMethodOutput = function(method) {
        //TODO: trim some fields, etc?
        return method;
    };
    
    payModule.fetchOrg = function(orgSvc, req, res, next) {
        var log = logger.getLog();
        
        log.trace('[%1] Fetching org %2', req.uuid, req.params.orgId);
        return orgSvc.getObjs({ id: String(req.params.orgId) }, req, false)
        .then(function(resp) {
            if (resp.code !== 200) {
                return res.send(resp.code, resp.body);
            }
            
            req.org = resp.body;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Error fetching org %2 for payment endpoint: %3',
                      req.uuid, req.params.orgId, error && error.stack || error);
            res.send(500, {
                error: 'Error retrieving org',
                detail: error
            });
        });
    };
    
    payModule.generateClientToken = function(gateway, req) {
        var log = logger.getLog(),
            cfg = {};
            
        if (req.org.braintreeCustomer) {
            cfg.customerId = req.org.braintreeCustomer;
        }
        
        return q.npost(gateway.clientToken, 'generate', [cfg])
        .then(function(response) {
            log.info(
                '[%1] Successfully generated braintree client token for %2',
                req.uuid,
                cfg.customerId ? ('braintree customer ' + cfg.customerId) : 'new braintree customer'
            );
            return q({ code: 200, body: { clientToken: response.clientToken } });
        })
        .catch(function(error) {
            log.error('[%1] Error generating braintree client token: %2',
                      req.uuid, util.inspect(error));
            return q.reject('Braintree error');
        });
    };
    
    payModule.getPaymentMethods = function(gateway, req) {
        var log = logger.getLog();
        
        if (!req.org.braintreeCustomer) {
            return q({ code: 200, body: [] });
        }
        
        /*
        return q.delay(6000).then(function() { //TODO: remove this
            return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
        })*/
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
    };
    
    payModule.createCustomerWithMethod = function(gateway, orgSvc, req) {
        var log = logger.getLog();
        
        return q.npost(gateway.customer, 'create', [{
            company: req.org.name, //TODO: can we fill in any other customer fields?
            paymentMethodNonce: req.body.paymentMethodNonce
        }])
        .then(function(result) {
            if (!result.success) { //TODO: should eventually handle + 4xx for some results
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
                    code: 200,
                    body: payModule.formatMethodOutput(result.customer.paymentMethods[0])
                });
            });
        })
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
        
        if (!orgSvc.checkScope(req.user, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return q({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        if (!req.org.braintreeCustomer) {
            return payModule.createCustomerWithMethod(gateway, orgSvc, req);
        }
        
        return q.npost(gateway.paymentMethod, 'create', [{
            customerId: req.org.braintreeCustomer,
            paymentMethodNonce: req.body.paymentMethodNonce
        }])
        .then(function(result) {
            if (!result.success) {
                return q.reject({ message: result.message, errors: result.errors });
            }

            log.info('[%1] Successfully created payment method %2 for BT customer %3',
                     req.uuid, result.paymentMethod.token, req.org.braintreeCustomer);
            return q({
                code: 200,
                body: payModule.formatMethodOutput(result.paymentMethod)
            });
        })
        .catch(function(error) {
            log.error('[%1] Error creating paymentMethod for BT customer %2: %3',
                      req.uuid, req.org.braintreeCustomer, util.inspect(error));
            return q.reject('Braintree error');
        });
    };
    
    payModule.editPaymentMethod = function(gateway, orgSvc, token, req) {
        var log = logger.getLog();
        
        if (!req.body.paymentMethodNonce) {
            log.info('[%1] Request has no paymentMethodNonce', req.uuid);
            return q({ code: 400, body: 'Must include a paymentMethodNonce' });
        }
        
        if (!orgSvc.checkScope(req.user, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return q({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        if (!req.org.braintreeCustomer) {
            log.info('[%1] No BT customer for org %2, not editing anything', req.uuid, req.org.id);
            return q({ code: 400, body: 'No payment methods for this org' });
        }
        
        return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
        .then(function(cust) {
            var existsForCust = (cust.paymentMethods || []).some(function(method) {
                return method.token === token;
            });
            
            if (!existsForCust) {
                log.info('[%1] Payment method %2 does not exist for BT cust %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({
                    code: 400,
                    body: 'That payment method does not exist for this org'
                });
            }
            
            return q.npost(gateway.paymentMethod, 'update', [token, {
                paymentMethodNonce: req.body.paymentMethodNonce
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
            });
        }, function(error) {
            if (error && error.name === 'Not Found') { //TODO: should this actually be log.error?
                log.warn('[%1] BT customer %2 on org %3 not found',
                         req.uuid, req.org.braintreeCustomer, req.org.id);
                return q({
                    code: 400,
                    body: 'Braintree customer for this org does not exist'
                });
            } else {
                return q.reject(error);
            }
        })
        .catch(function(error) {
            log.error('[%1] Error editing payment method %2: %3',
                      req.uuid, token, util.inspect(error));
            return q.reject('Braintree error');
        });
    };
    
    //TODO: what happens to transactions/campaigns that will use this payment method?
    payModule.deletePaymentMethod = function(gateway, orgSvc, token, req) {
        var log = logger.getLog();
        
        if (!orgSvc.checkScope(req.user, req.org, 'edit')) {
            log.info('[%1] Requester cannot edit org %2', req.uuid);
            return q({ code: 403, body: 'Not authorized to edit this org' });
        }
        
        if (!req.org.braintreeCustomer) {
            log.info('[%1] No BT customer for org %2, not deleting anything', req.uuid, req.org.id);
            return q({ code: 400, body: 'No payment methods for this org' });
        }
        
        return q.npost(gateway.customer, 'find', [req.org.braintreeCustomer])
        .then(function(cust) {
            var existsForCust = (cust.paymentMethods || []).some(function(method) {
                return method.token === token;
            });
            
            if (!existsForCust) {
                log.info('[%1] Payment method %2 does not exist for BT cust %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({
                    code: 400,
                    body: 'That payment method does not exist for this org'
                });
            }
            
            return q.npost(gateway.paymentMethod, 'delete', [token])
            .then(function() {
                log.info('[%1] Successfully deleted payment method %2 for BT customer %3',
                         req.uuid, token, req.org.braintreeCustomer);
                return q({ code: 204 });
            });
        }, function(error) {
            if (error && error.name === 'Not Found') { //TODO: should this actually be log.error?
                log.warn('[%1] BT customer %2 on org %3 not found',
                         req.uuid, req.org.braintreeCustomer, req.org.id);
                return q({
                    code: 400,
                    body: 'Braintree customer for this org does not exist'
                });
            } else {
                return q.reject(error);
            }
        })
        .catch(function(error) {
            log.error('[%1] Error deleting payment method %2: %3',
                      req.uuid, token, util.inspect(error));
            return q.reject('Braintree error');
        });
    };


    // TODO: should this be able to just search for payments by org id, not requiring BT customer?
    payModule.getPayments = function(gateway, req) {
        var log = logger.getLog();

        if (!req.org.braintreeCustomer) {
            log.info('[%1] No braintreeCustomer for org %2, so no payments to show',
                     req.uuid, req.org.id);
            return q({ code: 200, body: [] });
        }
        
        var streamDeferred = q.defer(),
            results = [];

        //TODO: handle pagination...
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
    };
    
    payModule.setupEndpoints = function(app, orgSvc, gateway, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/account/orgs?/:orgId/payments', // prefix to these endpoints
            fetchOrg    = payModule.fetchOrg.bind(payModule, orgSvc);
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        //TODO TODO: FINISH FIGURING OUT WHY THESE JOBS AREN'T CANCELING TIMEOUTS PROPERLY

        var authGetOrg = authUtils.middlewarify({orgs: 'read'});
        router.get('/clientToken', sessions, authGetOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.generateClientToken(gateway, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error generating clientToken', detail: error });
                });
            });
        });

        router.get('/methods?/', sessions, authGetOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.getPaymentMethods(gateway, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving payment methods', detail: error });
                });
            });
        });
        
        var authPutOrg = authUtils.middlewarify({orgs: 'edit'});
        router.post('/methods?/', sessions, authPutOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.createPaymentMethod(gateway, orgSvc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error generating clientToken',detail: error });
                });
            });
        });

        router.put('/methods?/:token', sessions, authPutOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.editPaymentMethod(gateway, orgSvc, req.params.token, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error generating clientToken',detail: error });
                });
            });
        });
        
        router.delete('/methods?/:token', sessions, authPutOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.deletePaymentMethod(gateway, orgSvc, req.params.token, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error generating clientToken',detail: error });
                });
            });
        });
        
        router.get('/', sessions, authGetOrg, fetchOrg, audit, function(req, res) {
            var promise = payModule.getPayments(gateway, req);
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

