(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        enums           = require('../lib/enums'),
        logger          = require('../lib/logger'),
        Scope           = enums.Scope,

        catModule = {};
        
    catModule.catSchema = {
        name: {
            __allowed: true,
            __type: 'string'
        },
        label: {
            __allowed: true,
            __type: 'string'
        },
        type: {
            __allowed: true,
            __type: 'string'
        },
        source: {
            __allowed: true,
            __type: 'string'
        },
        externalId: {
            __allowed: true,
            __type: 'string'
        }
    };

    catModule.setupSvc = function(catColl) {
        var opts = {
            userProp: false,
            orgProp: false,
            allowPublic: true
        };
        var catSvc = new CrudSvc(catColl, 'cat', opts, catModule.catSchema);
            
        catSvc.use('create', catModule.adminCreateCheck);
        
        return catSvc;
    };

    // only allow admins to create categories
    catModule.adminCreateCheck = function(req, next, done) {
        var log = logger.getLog();
        if (!(req.requester.permissions &&
              req.requester.permissions.categories &&
              req.requester.permissions.categories.create === Scope.All)) {
            log.info('[%1] Requester %2 not authorized to create categories',
                     req.uuid, req.requester.id);
            return done({code: 403, body: 'Not authorized to create categories'});
        }
        
        next();
    };
    
    catModule.setupEndpoints = function(app, catSvc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/content/categor(y|ies)'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.objMidware('categories', {});

        // want to allow anyone to get categories, so require no permissions
        var authGetCat = authUtils.middlewarify({});
        router.get('/:id', sessions, authGetCat, audit, function(req, res) {
            var promise = catSvc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving category', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCat, audit, function(req, res) {
            var query = {};
            ['name', 'type', 'source', 'externalId', 'label'].forEach(function(prop) {
                if (req.query[prop]) {
                    query[prop] = String(req.query[prop]);
                }
            });
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = catSvc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving categories', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = catSvc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating category', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = catSvc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating category', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = catSvc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting category', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = catModule;
}());
