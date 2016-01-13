(function(){
    'use strict';

    var q           = require('q'),
        util        = require('util'),
        express     = require('express'),
        logger      = require('../lib/logger'),
        CrudSvc     = require('../lib/crudSvc'),
        authUtils   = require('../lib/authUtils'),
        Status      = require('../lib/enums').Status,

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
            }
        }
    };

    conModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('containers'), 'con', opts, conModule.conSchema);
        svc._db = db;
        
        var validateUniqueName  = svc.validateUniqueProp.bind(svc, 'name', /^[\w-]+$/),
            validateDataRefs    = conModule.validateDataRefs.bind(conModule, svc);
        
        svc.use('create', validateUniqueName);
        svc.use('create', conModule.copyName);
        svc.use('create', validateDataRefs);

        svc.use('edit', validateUniqueName);
        svc.use('edit', conModule.copyName);
        svc.use('edit', validateDataRefs);
        
        return svc;
    };
    
    // copy top-level name to defaultData.container
    conModule.copyName = function(req, next/*, done*/) {
        var name = req.body.name || req.origObj.name;

        req.body.defaultData.container = name;
        
        next();
    };

    // Check that references to other C6 objects in data hash are valid
    conModule.validateDataRefs = function(svc, req, next, done) {
        var log = logger.getLog(),
            doneCalled = false;
        
        function checkExistence(prop, query) {
            // pass check w/o querying mongo if prop doesn't exist
            if (!req.body.defaultData[prop]) {
                return q();
            }
            
            log.trace('[%1] Checking that %2 %3 exists',req.uuid, prop, req.body.defaultData[prop]);
            
            return q(svc._db.collection(prop + 's').count(query))
            .then(function(count) {
                if (count > 0) {
                    return;
                }

                var msg = util.format('%s %s not found', prop, req.body.defaultData[prop]);
                log.info('[%1] %2 with query %3, not saving container',
                         req.uuid, msg, util.inspect(query));

                if (!doneCalled) {
                    doneCalled = true;
                    done({ code: 400, body: msg });
                }
            })
            .catch(function(error) {
                log.error('[%1] Error counting %2s: %3', req.uuid, prop, util.inspect(error));
                return q.reject(new Error('Mongo error'));
            });
        }
        
        return q.all([
            checkExistence('card', {
                id: req.body.defaultData.card,
                campaignId: req.body.defaultData.campaign,
                status: { $ne: Status.Deleted }
            }),
            checkExistence('campaign', {
                id: req.body.defaultData.campaign,
                status: { $nin: [Status.Deleted, Status.Canceled, Status.Expired] } //TODO: confirm?
            }),
            checkExistence('experience', {
                id: req.body.defaultData.experience,
                'status.0.status': { $ne: Status.Deleted }
            })
        ])
        .then(function() {
            if (!doneCalled) {
                return next();
            }
        });
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
