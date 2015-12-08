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

    advertModule.setupSvc = function(coll) {
        var opts = { userProp: false, orgProp: false, parentOfUser: true },
            svc = new CrudSvc(coll, 'a', opts, advertModule.advertSchema);
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', null);
        
        svc.use('create', validateUniqueName);
        svc.use('edit', validateUniqueName);
        
        return svc;
    };
    
    advertModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/advertisers?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetAd = authUtils.middlewarify({advertisers: 'read'});
        router.get('/:id', sessions, authGetAd, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertiser', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetAd, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
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

        var authPostAd = authUtils.middlewarify({advertisers: 'create'});
        router.post('/', sessions, authPostAd, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating advertiser', detail: error });
                });
            });
        });

        var authPutAd = authUtils.middlewarify({advertisers: 'edit'});
        router.put('/:id', sessions, authPutAd, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating advertiser', detail: error });
                });
            });
        });

        var authDelAd = authUtils.middlewarify({advertisers: 'delete'});
        router.delete('/:id', sessions, authDelAd, audit, function(req,res) {
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
