(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        moment          = require('moment'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        requestUtils    = require('../lib/requestUtils'),
        enums           = require('../lib/enums'),
        ld              = require('lodash'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        orgModule = {}; // for exporting functions to unit tests

    orgModule.orgSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        adConfig: {
            __allowed: false,
            __type: 'object'
        },
        config: {
            __allowed: true,
            __type: 'object'
        },
        waterfalls: {
            __allowed: true,
            __type: 'object'
        },
        braintreeCustomer: {
            __allowed: false,
            __type: 'string'
        },
        referralCode: {
            __allowed: false,
            __type: 'string'
        },
        promotions: {
            __allowed: false,
            __type: 'objectArray',
            __entries: {
                id: {
                    __allowed: true,
                    __type: 'string'
                },
                created: {
                    __allowed: true,
                    __type: 'Date'
                },
                lastUpdated: {
                    __allowed: true,
                    __type: 'Date'
                },
                status: {
                    __allowed: true,
                    __type: 'string'
                }
            }
        },
        paymentPlanId: {
            __allowed: false,
            __type: 'string'
        },
        paymentPlanStart: {
            __allowed: false,
            __type: 'Date'
        }
    };

    orgModule.setupSvc = function(db, gateway) {
        var opts = { userProp: false, orgProp: false, ownedByUser: false },
            svc = new CrudSvc(db.collection('orgs'), 'o', opts, orgModule.orgSchema);

        svc._db = db;

        svc.use('create', orgModule.createPermCheck);
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', orgModule.setupConfig);

        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));

        svc.use('delete', orgModule.deletePermCheck);
        svc.use('delete', orgModule.activeUserCheck.bind(orgModule, svc));
        svc.use('delete', orgModule.runningCampaignCheck.bind(orgModule, svc));
        svc.use('delete', orgModule.deleteBraintreeCustomer.bind(orgModule, gateway));

        return svc;
    };

    // Only allow creating org if requester has admin priviledges
    orgModule.createPermCheck = function(req, next, done) {
        var log = logger.getLog();

        if (req.requester.permissions.orgs.create !== Scope.All) {
            log.info('[%1] Requester %2 is not authorized to create orgs',
                     req.uuid, req.requester.id);
            return q(done({ code: 403, body: 'Not authorized to create orgs' }));
        }

        return q(next());
    };

    // Setup some default waterfalls
    orgModule.setupConfig = function(req, next/*, done*/) {
        if (!req.body.config) {
            req.body.config = {};
        }

        if (!req.body.waterfalls) {
            req.body.waterfalls = {};
        }

        objUtils.extend(req.body.waterfalls, {
            video: ['cinema6'],
            display: ['cinema6']
        });

        return q(next());
    };

    // Only allow org to be deleted if not requester's org + they have admin priviledges
    orgModule.deletePermCheck = function(req, next, done) {
        var log = logger.getLog();

        if (req.user && req.params.id === req.user.org) {
            log.info('[%1] User %2 tried to delete their own org', req.uuid, req.requester.id);
            return q(done({ code: 400, body: 'You cannot delete your own org' }));
        }

        if (req.requester.permissions.orgs.delete !== Scope.All) {
            log.info('[%1] User %2 is not authorized to delete orgs', req.uuid, req.requester.id);
            return q(done({ code: 403, body: 'Not authorized to delete orgs' }));
        }

        return q(next());
    };

    // Only allow org to be deleted if it has no active users
    orgModule.activeUserCheck = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { org: req.params.id, status: { $ne: Status.Deleted } };

        return q(svc._db.collection('users').count(query))
        .then(function(count) {
            if (count > 0) {
                log.info('[%1] Can\'t delete org %2 since it still has %3 active users',
                         req.uuid, req.params.id, count);
                return done({ code: 400, body: 'Org still has active users' });
            }

            return q(next());
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for users: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    /* Checks if the org still has unfinished campaigns. */
    orgModule.runningCampaignCheck = function(orgSvc, req, next, done) {
        var log = logger.getLog(),
            query = {
                org: req.params.id,
                status: { $in: [Status.Active, Status.Paused] }
            };

        return q(orgSvc._db.collection('campaigns').count(query))
        .then(function(campCount) {
            if (campCount > 0) {
                log.info('[%1] Org %2 still has %3 unfinished campaigns',
                         req.uuid, req.params.id, campCount);

                return done({ code: 400, body: 'Org still has unfinished campaigns' });
            }

            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for campaigns: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    // Delete the org's braintreeCustomer, if it exists
    orgModule.deleteBraintreeCustomer = function(gateway, req, next/*, done*/) {
        var log = logger.getLog();

        if (!req.origObj.braintreeCustomer) {
            log.trace('[%1] No braintreeCustomer on org %2', req.uuid, req.origObj.id);
            return q(next());
        }

        return q.npost(gateway.customer, 'delete', [req.origObj.braintreeCustomer])
        .then(function() {
            log.info(
                '[%1] Successfully deleted BT customer %2 on org %3',
                 req.uuid,
                 req.origObj.braintreeCustomer,
                 req.origObj.id
             );
            return q(next());
        })
        .catch(function(error) {
            if (error && error.name === 'notFoundError') {
                log.warn(
                    '[%1] BT customer %2 on org %3 not found',
                    req.uuid,
                    req.origObj.braintreeCustomer,
                    req.origObj.id
                );

                return q(next());
            } else {
                log.error(
                    '[%1] Error deleting BT customer %2 on org %3: %4',
                     req.uuid,
                     req.origObj.braintreeCustomer,
                     req.origObj.id,
                     util.inspect(error)
                 );
                return q.reject('Braintree error');
            }
        });
    };

    orgModule.getEffectiveDate = function (req, org) {
        var currentPaymentEndpoint = urlUtils.resolve(orgModule.api.transactions.baseUrl,
            'showcase/current-payment');

        // If the org does not have a next payment plan
        if (!org.nextPaymentPlanId) {
            return q.resolve(null);
        }

        // Make a request to get the end date of the billing cycle
        return requestUtils.proxyRequest(req, 'get', {
            url: currentPaymentEndpoint,
            qs: { org: org.id }
        }).then(function (response) {
            // If getting the end date of the billing cycle failed
            if (response.response.statusCode !== 200) {
                throw new Error('there was an error finding the current payment cycle');
            }

            // Calculate the effective date of the next payment plan
            return moment(response.body.cycleEnd).add(1, 'day').startOf('day').utcOffset(0)
                .toDate();
        });
    };

    orgModule.getPaymentPlan = function (svc, req) {
        var orgId = req.params.id;

        // Get the org
        return svc.getObjs({
            id: orgId
        }, ld.set(req, 'query', {
            fields: ['paymentPlanId','nextPaymentPlanId'].join(',')
        }), false).then(function (orgResponse) {
            var orgBody = orgResponse.body;
            var org = ld.isArray(orgBody) ? orgBody[0] : orgBody;

            // If getting the org failed
            if (orgResponse.code !== 200) {
                return orgResponse;
            }

            // Construct the response
            return orgModule.getEffectiveDate(req, org).then(function (date) {
                return ld.chain(orgResponse).set('body', org)
                    .set('body.effectiveDate', date).value();
            });
        });
    };

    orgModule.setPaymentPlan = function (svc, req) {
        // If an id is not provided in the request body
        if (!req.body.id) {
            return q.resolve({
                code: 400,
                body: 'Must provide the id of the payment plan'
            });
        }

        // Get the org
        return svc.getObjs({
            id: req.params.id
        }, ld.set(req, 'query', {
            fields: [
                'paymentPlanId',
                'nextPaymentPlanId'
            ].join(',')
        }), false).then(function(result) {
            // If getting the org failed
            if (result.code !== 200) {
                return result;
            }

            // Reference payment plan ids
            var now = new Date();
            var org = result.body;
            var newPaymentPlanId = req.body.id;
            var currentPaymentPlanId = org.paymentPlanId;

            function composeResponse(code, org, date) {
                return {
                    code: code,
                    body: ld.chain(org).pick([
                        'id',
                        'paymentPlanId',
                        'nextPaymentPlanId'
                    ]).assign({
                        effectiveDate: date
                    }).value()
                };
            }

            // If the payment plan is not changing
            if (newPaymentPlanId === currentPaymentPlanId) {
                return composeResponse(304, org, null);
            }

            // Get relevent payment plan entities from mongo
            var paymentPlanIds = ld.compact([newPaymentPlanId, currentPaymentPlanId]);
            return svc._db.collection('paymentPlans').find({
                id: { $in: paymentPlanIds }
            }, {
                price: 1
            }).toArray().then(function (paymentPlans) {
                function findPaymentPlan(id) {
                    return ld.find(paymentPlans, function (paymentPlan) {
                        return paymentPlan.id === id;
                    });
                }

                // Organize payment plan entities
                var newPaymentPlan = findPaymentPlan(newPaymentPlanId);
                var currentPaymentPlan = findPaymentPlan(currentPaymentPlanId);

                // If the requested payment plan does not exist
                if (!newPaymentPlan) {
                    return {
                        code: 400,
                        body: 'that payment plan does not exist'
                    };
                }

                // If the existing payment plan does not exist
                if (currentPaymentPlanId && !currentPaymentPlan) {
                    throw new Error('there is a problem with the current payment plan');
                }

                // Calculate updates to the org
                var effectiveImmediately = !currentPaymentPlanId ||
                    (newPaymentPlan.price >= currentPaymentPlan.price);
                var updates = effectiveImmediately ? {
                    paymentPlanId: newPaymentPlanId,
                    nextPaymentPlanId: null
                } : {
                    paymentPlanId: currentPaymentPlanId,
                    nextPaymentPlanId: newPaymentPlanId
                };
                updates.id = org.id;

                // Get the effective date of the next payment plan
                return orgModule.getEffectiveDate(req, updates).then(function (date) {

                    // Edit the org with the necessary updates
                    return svc.editObj(ld.assign(req, {
                        body: updates
                    })).then(function (response) {
                        var org = response.body;

                        return composeResponse(200, org, date || now);
                    });
                });
            });
        });
    };

    orgModule.setupEndpoints = function(app, svc, sessions, audit, jobManager, config) {
        var router      = express.Router(),
            mountPath   = '/api/account/orgs?'; // prefix to all endpoints declared here

        orgModule.api = config.api;

        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authMidware = authUtils.crudMidware('orgs', { allowApps: true });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving org', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if (req.query.braintreeCustomer) {
                query.braintreeCustomer = String(req.query.braintreeCustomer);
            }
            if ('hasPaymentPlan' in req.query) {
                query.paymentPlanId = { $exists: req.query.hasPaymentPlan === 'true' };
            }
            if ('promotion' in req.query) {
                query.promotions = { $elemMatch: { id: String(req.query.promotion) } };
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving orgs', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating org', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing org', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting org', detail: error });
                });
            });
        });

        router.get('/:id/payment-plan', sessions, authMidware.read, audit, function(req, res) {
            var promise = orgModule.getPaymentPlan(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error getting org payment plan', detail: error });
                });
            });
        });

        router.post('/:id/payment-plan', sessions, authMidware.create, audit, function(req, res) {
            var promise = orgModule.setPaymentPlan(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error setting org payment plan', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = orgModule;
}());
