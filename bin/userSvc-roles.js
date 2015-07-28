(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),

        roleModule  = {};

    roleModule.setupSvc = function setupSvc(collection) {
        var roleSvc = new CrudSvc(collection, 'ro', { userProp: false, orgProp: false });
        
        //TODO: interesting perm questions: what roles can you edit? what policies can you pass?
        
        
        return roleSvc;
    };

    
    roleModule.setupEndpoints = function(app, svc, sessions, audit) {
        var router      = express.Router(),
            mountPath   = '/api/account/roles?'; // prefix to all endpoints declared here
        
        
        var authGetRole = authUtils.middlewarify({roles: 'read'});
        router.get('/:id', sessions, authGetRole, audit, function(req,res){
            svc.getObjs({ id: req.params.id }, req, false)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving role',
                    detail: error
                });
            });
        });

        router.get('/', sessions, authGetRole, audit, function(req, res) {
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
                    error: 'Error retrieving roles',
                    detail: error
                });
            });
        });

        var authPostRole = authUtils.middlewarify({roles: 'create'});
        router.post('/', sessions, authPostRole, audit, function(req, res) {
            svc.createObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating role',
                    detail: error
                });
            });
        });

        var authPutRole = authUtils.middlewarify({roles: 'edit'});
        router.put('/:id', sessions, authPutRole, audit, function(req, res) {
            svc.editObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating role',
                    detail: error
                });
            });
        });

        var authDelRole = authUtils.middlewarify({roles: 'delete'});
        router.delete('/:id', sessions, authDelRole, audit, function(req, res) {
            svc.deleteObj(req)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting role',
                    detail: error
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = roleModule;
}());
