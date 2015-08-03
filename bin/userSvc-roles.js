(function(){
    'use strict';

    var express         = require('express'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        enums           = require('../lib/enums'),
        AccessLevel     = enums.AccesLevel,
        Status          = enums.Status,

        roleModule  = {};
        
    roleModule.roleSchema = {
        name: {
            _accessLevel: AccessLevel.Allowed,
            _type: 'string',
            _actions: ['create'], //TODO: or should this just be _createOnly?
            _required: true
        },
        createdBy: {
            _accessLevel: AccessLevel.Forbidden,
            _type: 'string'
        },
        lastUpdatedBy: {
            _accessLevel: AccessLevel.Forbidden,
            _type: 'string'
        },
        policies: {
            _accessLevel: AccessLevel.Allowed,
            _type: ['string']
        }
    };

    roleModule.setupSvc = function setupSvc(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('roles'), 'r', opts, roleModule.roleSchema);
        
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', /^\w+$/),
            validatePolicies = roleModule.validatePolicies.bind(roleModule, svc);
        
        svc.use('create', validateUniqueName);
        svc.use('create', validatePolicies);
        svc.use('create', roleModule.setUserTrackProps);

        svc.use('edit', validateUniqueName);
        svc.use('edit', validatePolicies);
        svc.use('edit', roleModule.setUserTrackProps);
        
        svc.use('delete', roleModule.checkRoleInUse.bind(roleModule, svc));

        return svc;
    };

    
    roleModule.validatePolicies = function(svc, req, next, done) {
        var log = logger.getLog(),
            origPols = req.origObj && req.origObj.policies || [];
        
        if (!req.body.policies || req.body.policies.length === 0) {
            return q(next());
        }
        
        // don't bother querying for policies if unchanged
        if (objUtils.compareObjects(req.body.policies.slice().sort(), origPols.slice().sort())) {
            return q(next());
        }
        
        var cursor = svc._db.collection('policies').find(
            { name: { $in: req.body.policies }, status: { $ne: Status.Deleted } },
            { name: 1 }
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
    

    roleModule.setUserTrackProps = function(req, next/*, done*/) { //TODO: rename. move to crudSvc?
        if (!req.origObj) {
            req.body.createdBy = req.user.id;
        }
        
        req.body.lastUpdatedBy = req.user.id;
        
        return next();
    };


    roleModule.checkRoleInUse = function(svc, req, next, done) { //TODO: rename
        var log = logger.getLog(),
            query = { policies: req.origObj.name, status: { $ne: Status.Deleted } };
        
        return q.npost(svc._db.collection('users'), 'count', [query])
        .then(function(userCount) {
            if (userCount > 0) {
                log.info('[%1] Role %2 still used by %3 users',
                         req.uuid, req.origObj.name, userCount);

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
