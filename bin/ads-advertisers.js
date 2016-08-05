(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        advertModule = {};

    advertModule.advertSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        defaultLinks: {
            __allowed: true,
            __type: 'object'
        },
        defaultLogos: {
            __allowed: true,
            __type: 'object'
        }
    };

    advertModule.setupSvc = function(coll ) {
        var opts = { userProp: false },
            svc = new CrudSvc(coll, 'a', opts, advertModule.advertSchema);

        return svc;
    };

    advertModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/advertisers?'; // prefix to all endpoints declared here

        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authMidware = authUtils.crudMidware('advertisers', { allowApps: true });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertiser', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }
            if (req.query.org) {
                query.org = String(req.query.org);
            }
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertisers', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating advertiser', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating advertiser', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting advertiser', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = advertModule;
}());
