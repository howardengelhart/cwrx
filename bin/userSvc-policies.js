(function(){
    'use strict';

    var express         = require('express'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc.js'),
        enums           = require('../lib/enums'),
        AccessLevel     = enums.AccesLevel,
        Status          = enums.Status,

        polModule = {};

    var allEntities = [ //TODO: comment, should this be configurable?
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
            _actions: ['create'],
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
        permissions: allEntities.reduce(function(schemaObj, objName) { //TODO: comment
            schemaObj[objName] = {
                _accessLevel: AccessLevel.Forbidden,
                _type: 'object'
            };
            
            return schemaObj;
        }, {}),
        fieldValidation: allEntities.reduce(function(schemaObj, objName) {
            schemaObj[objName] = {
                _accessLevel: AccessLevel.Forbidden,
                _type: 'object'
            };
            
            return schemaObj;
        }, {}),
        entitlements: {
            _accessLevel: AccessLevel.Forbidden
        }
    };

    polModule.setupSvc = function setupSvc(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('policies'), 'p', opts, polModule.policySchema);
        
        svc._db = db;
        
        var validateUniqueName = svc.validateUniqueProp.bind(svc, 'name', /^\w+$/);
        
        //TODO: do additional validation on format of permissions, fieldVal, and entitlements?
        
        svc.use('create', validateUniqueName);
        svc.use('create', polModule.setUserTrackProps);

        svc.use('edit', validateUniqueName);
        svc.use('edit', polModule.setUserTrackProps);
        
        svc.use('delete', polModule.checkPolicyInUse.bind(polModule, svc));

        return svc;
    };


    polModule.setUserTrackProps = function(req, next/*, done*/) { //TODO: rename. move to crudSvc?
        if (!req.origObj) {
            req.body.createdBy = req.user.id;
        }
        
        req.body.lastUpdatedBy = req.user.id;
        
        return next();
    };


    polModule.checkPolicyInUse = function(svc, req, next, done) { //TODO: rename
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
