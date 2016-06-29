(function() {
    'use strict';

    var CrudSvc = require('../lib/crudSvc');
    var express = require('express');
    var authUtils = require('../lib/authUtils');
    var expressUtils = require('../lib/expressUtils');
    var Status = require('../lib/enums').Status;
    var q = require('q');
    var logger = require('../lib/logger');
    var inspect = require('util').inspect;
    var clone = require('lodash').clone;

    var schema = {
        label: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        price: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0
        },
        maxCampaigns: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0
        },
        viewsPerMonth: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0
        }
    };

    function checkIfUsed(orgs) {
        var log = logger.getLog();

        return function middleware(req, next, done) {
            var id = req.params.id;
            var uuid = req.uuid;

            return q(orgs.count({
                status: { $ne: Status.Deleted },
                $or: [
                    { paymentPlanId: id },
                    { nextPaymentPlanId: id }
                ]
            })).then(function check(count) {
                if (count > 0) {
                    log.warn(
                        '[%1] Tried to delete paymentPlan(%2) which is still in use.',
                        uuid, id
                    );

                    return done({ code: 400, body: 'Payment Plan is still in use' });
                }

                return next();
            }).catch(function handleRejection(reason) {
                log.error('[%1] Failed querying for orgs: %2', uuid, inspect(reason));

                throw new Error('There was an Error from mongo');
            });
        };
    }

    function setupSvc(db) {
        var service = new CrudSvc(db.collection('paymentPlans'), 'pp', {
            userProp: false,
            orgProp: false,
            allowPublic: true
        }, clone(schema));

        service.use('delete', checkIfUsed(db.collection('orgs')));

        return service;
    }

    function setupEndpoints(app, service, sessions, audit, jobManager) {
        var router = express.Router();
        var auth = authUtils.crudMidware(service.objName, { allowApps: true });
        var publicAuth = authUtils.middlewarify({ allowApps: true });
        var parseMultiQuery = expressUtils.parseQuery({
            arrays: ['ids']
        });

        router.use(jobManager.setJobTimeout.bind(jobManager));

        router.get('/:id', sessions, publicAuth, audit, function getOne(req, res) {
            var promise = service.getObjs({ id: req.params.id }, req, false);

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect()).catch(function(reason) {
                    return res.send(500, { error: reason.message, detail: reason });
                });
            });
        });

        router.get('/', sessions, publicAuth, audit, parseMultiQuery, function getMany(req, res) {
            var promise = service.getObjs((function(qp) {
                var query = {};

                if ('ids' in qp) {
                    query.id = qp.ids;
                }

                return query;
            }(req.query)), req, true);

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect()).catch(function(reason) {
                    return res.send(500, { error: reason.message, detail: reason });
                });
            });
        });

        router.post('/', sessions, auth.create, audit, function create(req, res) {
            var promise = service.createObj(req);

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect()).catch(function(reason) {
                    return res.send(500, { error: reason.message, detail: reason });
                });
            });
        });

        router.put('/:id', sessions, auth.edit, audit, function edit(req, res) {
            var promise = service.editObj(req);

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect()).catch(function(reason) {
                    return res.send(500, { error: reason.message, detail: reason });
                });
            });
        });

        router.delete('/:id', sessions, auth.delete, audit, function edit(req, res) {
            var promise = service.deleteObj(req);

            promise.finally(function() {
                return jobManager.endJob(req, res, promise.inspect()).catch(function(reason) {
                    return res.send(500, { error: reason.message, detail: reason });
                });
            });
        });

        app.use('/api/payment-plans', router);
    }

    module.exports.setupSvc = setupSvc;
    module.exports.setupEndpoints = setupEndpoints;
}());
