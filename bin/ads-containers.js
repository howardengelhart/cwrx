(function(){
    'use strict';

    var express     = require('express'),
        CrudSvc     = require('../lib/crudSvc'),
        objUtils    = require('../lib/objUtils'),
        authUtils   = require('../lib/authUtils'),

        conModule = {};
    
    conModule.conSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true,
            __unchangeable: true
        },
        label: {
            __allowed: true,
            __type: 'string'
        },
        defaultTagParams: {
            __type: 'object',
            __default: {},
            __required: true
        }
    };

    conModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('containers'), 'con', opts, conModule.conSchema);
        svc._db = db;
        
        var validateUniqueName  = svc.validateUniqueProp.bind(svc, 'name', /^[\w-]+$/);
        
        svc.use('create', validateUniqueName);
        svc.use('create', conModule.copyName);

        svc.use('edit', validateUniqueName);
        svc.use('edit', conModule.copyName);
        
        return svc;
    };
    
    // copy top-level name to defaultTagParams.container
    conModule.copyName = function(req, next/*, done*/) {
        var name = req.body.name || req.origObj.name;
        
        Object.keys(req.body.defaultTagParams).filter(function(key) {
            return objUtils.isPOJO(req.body.defaultTagParams[key]);
        }).forEach(function(tagType) {
            req.body.defaultTagParams[tagType].container = name;
        });
        
        next();
    };

    conModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/containers?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('containers', { allowApps: true });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving container', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
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
                    res.send(500, { error: 'Error retrieving containers', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating container', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating container', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting container', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = conModule;
}());
