(function(){
    'use strict';

    var express         = require('express'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,

        roleModule  = {};
        
    roleModule.roleSchema = {
        name: {
            _allowed: true,
            _type: 'string',
            _createOnly: true,
            _required: true
        },
        createdBy: {
            _allowed: false,
            _type: 'string'
        },
        lastUpdatedBy: {
            _allowed: false,
            _type: 'string'
        },
        policies: {
            _allowed: true,
            _type: ['string']
        }
    };

    roleModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('roles'), 'r', opts, roleModule.roleSchema);
        
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', /^\w+$/),
            validatePolicies = roleModule.validatePolicies.bind(roleModule, svc);
        
        svc.use('create', validateUniqueName);
        svc.use('create', validatePolicies);
        svc.use('create', roleModule.setChangeTrackProps);

        svc.use('edit', validateUniqueName);
        svc.use('edit', validatePolicies);
        svc.use('edit', roleModule.setChangeTrackProps);
        
        svc.use('delete', roleModule.checkRoleInUse.bind(roleModule, svc));

        return svc;
    };

    // Check that of the role's policies exist
    roleModule.validatePolicies = function(svc, req, next, done) {
        var log = logger.getLog();
        
        if (!req.body.policies || req.body.policies.length === 0) {
            return q(next());
        }
        
        var cursor = svc._db.collection('policies').find(
            { name: { $in: req.body.policies }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        );
        
        return q.npost(cursor, 'toArray').then(function(fetched) {
            if (fetched.length === req.body.policies.length) {
                return next();
            }
            
            var missing = req.body.policies.filter(function(reqPol) {
                return fetched.every(function(pol) { return pol.name !== reqPol; });
            });
            
            var msg = 'These policies were not found: [' + missing.join(',') + ']';
            
            log.info('[%1] Not saving role: %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for policies: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };
    
    // Set properties that track who created + last updated the role
    roleModule.setChangeTrackProps = function(req, next/*, done*/) {
        if (!req.origObj) {
            req.body.createdBy = req.user.id;
        }
        
        req.body.lastUpdatedBy = req.user.id;
        
        return next();
    };

    // Return a 400 if the role is still in use by users
    roleModule.checkRoleInUse = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { roles: req.origObj.name, status: { $ne: Status.Deleted } };
        
        return q.npost(svc._db.collection('users'), 'count', [query])
        .then(function(userCount) {
            if (userCount > 0) {
                log.info('[%1] Role %2 still used by %3 users',
                         req.uuid, req.origObj.id, userCount);

                return done({ code: 400, body: 'Role still in use by users' });
            }
            
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for users: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
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
            if (req.query.name) {
                query.name = String(req.query.name);
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
