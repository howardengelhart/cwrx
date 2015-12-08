(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        util            = require('util'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        Status          = require('../lib/enums').Status,

        custModule = {};
    
    custModule.custSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        advertisers: {
            __allowed: true,
            __type: 'stringArray'
        }
    };

    custModule.setupSvc = function(db) {
        var coll = db.collection('customers'),
            opts = { userProp: false, orgProp: false, parentOfUser: true },
            svc = new CrudSvc(coll, 'cu', opts, custModule.custSchema);
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', null),
            validateAdvertisers = custModule.validateAdvertisers.bind(custModule, svc);
        
        svc.use('create', validateUniqueName);
        svc.use('create', validateAdvertisers);

        svc.use('edit', validateUniqueName);
        svc.use('edit', validateAdvertisers);

        return svc;
    };
    

    // Check that all advertisers in req.body.advertisers exist
    custModule.validateAdvertisers = function(svc, req, next, done) {
        var log = logger.getLog();
        
        if (!req.body.advertisers || req.body.advertisers.length === 0) {
            return q(next());
        }

        var cursor = svc._db.collection('advertisers').find(
            { id: { $in: req.body.advertisers }, status: { $ne: Status.Deleted } },
            { fields: { id: 1 } }
        );

        return q.npost(cursor, 'toArray').then(function(fetched) {
            if (fetched.length === req.body.advertisers.length) {
                return next();
            }

            var missing = req.body.advertisers.filter(function(advrId) {
                return fetched.every(function(advert) { return advert.id !== advrId; });
            });

            var msg = 'These advertisers were not found: [' + missing.join(',') + ']';

            log.info('[%1] Not saving customer: %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for advertisers: %2', req.uuid, util.inspect(error));
            return q.reject(new Error('Mongo error'));
        });
    };
        
    custModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/customers?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetCust = authUtils.middlewarify({customers: 'read'});
        router.get('/:id', sessions, authGetCust, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving customer', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCust, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if (req.query.name) {
                query.name = String(req.query.name);
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving customers', detail: error });
                });
            });
        });

        var authPostCust = authUtils.middlewarify({customers: 'create'});
        router.post('/', sessions, authPostCust, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating customer', detail: error });
                });
            });
        });

        var authPutCust = authUtils.middlewarify({customers: 'edit'});
        router.put('/:id', sessions, authPutCust, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating customer', detail: error });
                });
            });
        });

        var authDelCust = authUtils.middlewarify({customers: 'delete'});
        router.delete('/:id', sessions, authDelCust, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting customer', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = custModule;
}());
