(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),

        conModule = {};
    
    conModule.conSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true,
            __unchangeable: true
        },
        //TODO: also label prop?
        defaultData: {
            __type: 'object',
            __default: {},
            __required: true,
            container: {    // set automatically by svc to current object's name
                __type: 'string',
                __allowed: false,
                __locked: true
            },
            campaign: { //TODO: confirm this?
                __allowed: false,
                __locked: true
            }
        }
    };

    conModule.setupSvc = function(coll) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(coll, 'con', opts, conModule.conSchema);
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', null);
        
        svc.use('create', validateUniqueName);
        svc.use('create', conModule.copyName);

        svc.use('edit', validateUniqueName);
        svc.use('edit', conModule.copyName);
        
        //TODO: any other midware to check existence of card ids, or exp ids?
        
        return svc;
    };
    
    // copy top-level name to defaultData.container
    conModule.copyName = function(req, next/*, done*/) {
        var name = req.body.name || req.origObj.name;

        req.body.defaultData.container = name;
        
        next();
    };
    
    conModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/containers?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetCon = authUtils.middlewarify({containers: 'read'});
        router.get('/:id', sessions, authGetCon, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving container', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetCon, audit, function(req, res) {
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

        var authPostCon = authUtils.middlewarify({containers: 'create'});
        router.post('/', sessions, authPostCon, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating container', detail: error });
                });
            });
        });

        var authPutCon = authUtils.middlewarify({containers: 'edit'});
        router.put('/:id', sessions, authPutCon, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating container', detail: error });
                });
            });
        });

        var authDelCon = authUtils.middlewarify({containers: 'delete'});
        router.delete('/:id', sessions, authDelCon, audit, function(req,res) {
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
