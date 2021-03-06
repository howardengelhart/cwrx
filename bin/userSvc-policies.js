(function(){
    'use strict';

    var express         = require('express'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,

        polModule = { config: {} };

    polModule.policySchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __required: true
        },
        priority: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 1
        },
        createdBy: {
            __allowed: false,
            __type: 'string'
        },
        lastUpdatedBy: {
            __allowed: false,
            __type: 'string'
        },
        applications: {
            __allowed: false,
            __type: 'stringArray',
            __entries: {
                __acceptableValues: []
            }
        },
        entitlements: {
            __allowed: false,
            __type: 'object'
        },
        
        // at run time, will be filled in to forbid everything in config.policies.allEntities
        permissions: {
            __type: 'object'
        },
        fieldValidation: {
            __type: 'object'
        }
    };

    polModule.setupSvc = function(db, config) {
        polModule.config.policies = config.policies;
        config.policies.allEntities.forEach(function(objName) {
            polModule.policySchema.permissions[objName] = {
                __allowed: false,
                __type: 'object'
            };
            
            polModule.policySchema.fieldValidation[objName] = {
                __allowed: false,
                __type: 'object'
            };
        });

        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('policies'), 'p', opts, polModule.policySchema);
        
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', /^\w+$/),
            validateApplications = polModule.validateApplications.bind(polModule, svc);
        
        svc.use('create', validateUniqueName);
        svc.use('create', polModule.setChangeTrackProps);
        svc.use('create', polModule.validatePermissions);
        svc.use('create', validateApplications);
        
        svc.use('edit', validateUniqueName);
        svc.use('edit', polModule.setChangeTrackProps);
        svc.use('edit', polModule.validatePermissions);
        svc.use('edit', validateApplications);
        
        svc.use('delete', polModule.checkPolicyInUse.bind(polModule, svc));

        return svc;
    };

    // Set properties that track who created + last updated the policy
    polModule.setChangeTrackProps = function(req, next/*, done*/) {
        if (!req.origObj) {
            req.body.createdBy = req.requester.id;
        }
        
        req.body.lastUpdatedBy = req.requester.id;
        
        return next();
    };

    // Ensure permissions is valid (only uses recognized verbs and scopes)
    polModule.validatePermissions = function(req, next/*, done*/) {
        var log = logger.getLog(),
            allowedVerbs = ['read', 'create', 'edit', 'delete'];
            
        if (!req.body.permissions) {
            return next();
        }
        
        // don't actually restrict allowed objNames to facilitate introducing new ones
        for (var objName in req.body.permissions) {
            for (var verb in req.body.permissions[objName]) {
                if (allowedVerbs.indexOf(verb) === -1) {
                    log.info('[%1] Verb %2 not allowed, trimming permissions.%3.%2',
                             req.uuid, verb, objName);
                    delete req.body.permissions[objName][verb];
                }
                else if (!Scope.isScope(req.body.permissions[objName][verb])) {
                    log.info('[%1] Scope %2 not allowed, trimming permissions.%3.%4',
                             req.uuid, req.body.permissions[objName][verb], objName, verb);
                    delete req.body.permissions[objName][verb];
                }
            }
        }
        
        next();
    };

    // Check that all of the policy's applications exist
    polModule.validateApplications = function(svc, req, next, done) {
        var log = logger.getLog();
        
        if (!req.body.applications || req.body.applications.length === 0) {
            return q(next());
        }
        
        return q(svc._db.collection('experiences').find(
            { id: { $in: req.body.applications }, 'status.0.status': { $ne: Status.Deleted } },
            { fields: { id: 1 } }
        ).toArray())
        .then(function(fetched) {
            if (fetched.length === req.body.applications.length) {
                return next();
            }
            
            var missing = req.body.applications.filter(function(reqApp) {
                return fetched.every(function(app) { return app.id !== reqApp; });
            });
            
            var msg = 'These applications were not found: [' + missing.join(',') + ']';
            
            log.info('[%1] Not saving policy: %2', req.uuid, msg);
            return done({ code: 400, body: msg });
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for experiences: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    // Return a 400 if the policy is still in use by users or roles
    polModule.checkPolicyInUse = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { policies: req.origObj.name, status: { $ne: Status.Deleted } };
        
        return q.all([
            q(svc._db.collection('roles').count(query)),
            q(svc._db.collection('users').count(query)),
        ]).spread(function(roleCount, userCount) {
            if (roleCount + userCount > 0) {
                log.info('[%1] Policy %2 still used by %3 roles and %4 users',
                         req.uuid, req.origObj.name, roleCount, userCount);

                return done({ code: 400, body: 'Policy still in use by users or roles' });
            }
            
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for roles and users: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    
    polModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/polic(y|ies)'; // prefix to all endpoints declared here

        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('policies', { allowApps: true });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving policy', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving policies', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating policy', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating policy', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting policy', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = polModule;
}());
