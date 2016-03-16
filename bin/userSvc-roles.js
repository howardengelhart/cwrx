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
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __required: true
        },
        createdBy: {
            __allowed: false,
            __type: 'string'
        },
        lastUpdatedBy: {
            __allowed: false,
            __type: 'string'
        },
        policies: {
            __allowed: true,
            __type: 'stringArray'
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

    // Check that all of the role's policies exist
    roleModule.validatePolicies = function(svc, req, next, done) {
        var log = logger.getLog();
        
        if (!req.body.policies || req.body.policies.length === 0) {
            return q(next());
        }
        
        return q(svc._db.collection('policies').find(
            { name: { $in: req.body.policies }, status: { $ne: Status.Deleted } },
            { fields: { name: 1 } }
        ).toArray())
        .then(function(fetched) {
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
            req.body.createdBy = req.requester.id;
        }
        
        req.body.lastUpdatedBy = req.requester.id;
        
        return next();
    };

    // Return a 400 if the role is still in use by users
    roleModule.checkRoleInUse = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { roles: req.origObj.name, status: { $ne: Status.Deleted } };
        
        return q(svc._db.collection('users').count(query))
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

    
    roleModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/roles?'; // prefix to all endpoints declared here

        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('roles', { allowApps: true });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving role', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }
            if (req.query.policy) {
                query.policies = String(req.query.policy);
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving roles', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating role', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating role', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting role', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = roleModule;
}());
