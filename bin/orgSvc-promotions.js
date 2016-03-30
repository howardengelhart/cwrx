(function(){
    'use strict';

    var express         = require('express'),
        CrudSvc         = require('../lib/crudSvc'),
        Model           = require('../lib/model'),
        authUtils       = require('../lib/authUtils'),
        
        promModule = { schemas: {} };
        
    promModule.schemas.promotions = { // schema for all promotion objects
        name: {
            __allowed: true,
            __type: 'string'
        },
        type: {
            __allowed: true,
            __type: 'string',
            __required: true,
            __acceptableValues: ['signupReward'] //TODO: rename?
        },
        data: {
            __allowed: true,
            __type: 'object',
            __required: true,
            __default: {}
        }
    };
    
    promModule.schemas.signupReward = { // schema for data hash on signupReward promotions
        rewardAmount: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0 //TODO: this ok? also __max?
        }
    };
    

    promModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            schema = promModule.schemas.promotions,
            svc = new CrudSvc(db.collection('promotions'), 'pro', opts, schema);
            
        svc.use('create', promModule.validateData);

        svc.use('edit', promModule.validateData);
            
        return svc;
    };
    
    promModule.validateData = function(req, next, done) {
        var type        = req.body.type || (req.origObj && req.origObj.type),
            dataSchema  = promModule.schemas[type],
            dataModel   = new Model('promotions.data', dataSchema),
            action      = (req.method.toLowerCase() === 'PUT') ? 'edit' : 'create',
            origData    = (req.origObj && req.origObj.data) || {};
            
        var validResp = dataModel.validate(action, req.body.data, origData);
        
        if (validResp.isValid) {
            next();
        } else {
            done({ code: 400, body: validResp.reason });
        }
    };

    
    promModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/promotions?'; // prefix to all endpoints declared here
            //TODO: update cookbook with nginx config
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('promotions', { allowApps: true });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving promotions', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            ['type', 'name'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving promotions', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating promotion', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing promotion', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting promotion', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = promModule;
}());

