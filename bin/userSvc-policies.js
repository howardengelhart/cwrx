(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),

        polModule  = {};

    polModule.setupSvc = function setupSvc(collection) {
        var svc = new CrudSvc(collection, 'p', { userProp: false, orgProp: false });

        return svc;
    };

    
    polModule.setupEndpoints = function(app, svc, sessions, audit) {
        var router      = express.Router(),
            mountPath   = '/api/account/polic(y|ies)'; // prefix to all endpoints declared here
        
        
        var authGetPol = authUtils.middlewarify({policies: 'read'});
        router.get('/:id', sessions, authGetPol, audit, function(req,res){
            svc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving policy',
                    detail: error
                });
            });
        });

        router.get('/', sessions, authGetPol, audit, function(req, res) {
            var query = {};
            if (req.query.org) {
                query.org = String(req.query.org);
            } else if (req.query.ids) {
                query.id = req.query.ids.split(',');
            }

            svc.getObjs(query, req, true)
            .then(function(resp) {
                if (resp.headers && resp.headers['content-range']) {
                    res.header('content-range', resp.headers['content-range']);
                }

                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving policies',
                    detail: error
                });
            });
        });

        var authPostPol = authUtils.middlewarify({policies: 'create'});
        router.post('/', sessions, authPostPol, audit, function(req, res) {
            svc.createObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating policy',
                    detail: error
                });
            });
        });

        var authPutPol = authUtils.middlewarify({policies: 'edit'});
        router.put('/:id', sessions, authPutPol, audit, function(req, res) {
            svc.editObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating policy',
                    detail: error
                });
            });
        });

        var authDelPol = authUtils.middlewarify({policies: 'delete'});
        router.delete('/:id', sessions, authDelPol, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting policy',
                    detail: error
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = polModule;
}());
