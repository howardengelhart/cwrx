(function(){
    'use strict';

    var express         = require('express'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        enums           = require('../lib/enums'),
        AccessLevel     = enums.AccessLevel,
        Status          = enums.Status,
        Scope           = enums.Scope,

        polModule = {};

    // list of all entity names, used for validating permissions and fieldValidations props
    var allEntities = [
        'advertisers',
        'campaigns',
        'cards',
        'categories',
        'customers',
        'elections',
        'experiences',
        'minireelGroups',
        'orgs',
        'policies',
        'roles',
        'sites',
        'users'
    ];

    polModule.policySchema = {
        name: {
            _accessLevel: AccessLevel.Allowed,
            _type: 'string',
            _createOnly: true,
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
        
        // permissions.advertisers etc. will be forbidden
        permissions: allEntities.reduce(function(schemaObj, objName) {
            schemaObj[objName] = {
                _accessLevel: AccessLevel.Forbidden,
                _type: 'object'
            };
            
            return schemaObj;
        }, { _type: 'object' }),

        // fieldValidation.advertisers etc. will be forbidden
        fieldValidation: allEntities.reduce(function(schemaObj, objName) {
            schemaObj[objName] = {
                _accessLevel: AccessLevel.Forbidden,
                _type: 'object'
            };
            
            return schemaObj;
        }, { _type: 'object' }),

        entitlements: {
            _accessLevel: AccessLevel.Forbidden,
            _type: 'object'
        }
    };

    polModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('policies'), 'p', opts, polModule.policySchema);
        
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', /^\w+$/);
        
        svc.use('create', validateUniqueName);
        svc.use('create', polModule.setChangeTrackProps);
        svc.use('create', polModule.validatePermissions);
        
        //TODO: are you suuuuure you don't want to validate fieldValidation?

        svc.use('edit', validateUniqueName);
        svc.use('edit', polModule.setChangeTrackProps);
        svc.use('edit', polModule.validatePermissions);
        
        svc.use('delete', polModule.checkPolicyInUse.bind(polModule, svc));

        return svc;
    };


    polModule.setChangeTrackProps = function(req, next/*, done*/) {
        if (!req.origObj) {
            req.body.createdBy = req.user.id;
        }
        
        req.body.lastUpdatedBy = req.user.id;
        
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

    polModule.checkPolicyInUse = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { policies: req.origObj.name, status: { $ne: Status.Deleted } };
        
        return q.all([
            q.npost(svc._db.collection('roles'), 'count', [query]),
            q.npost(svc._db.collection('users'), 'count', [query])
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
