(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        historian       = require('../lib/historian'),
        QueryCache      = require('../lib/queryCache'),
        Status          = require('../lib/enums').Status,
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),

        placeModule = { config: {} };
    
    placeModule.placeSchema = {
        label: {
            __allowed: true,
            __type: 'string'
        },
        tagType: {
            __allowed: true,
            __type: 'string'
        },
        startDate: {
            __allowed: true,
            __type: 'Date'
        },
        endDate: {
            __allowed: true,
            __type: 'Date'
        },
        budget: {
            daily: {
                __allowed: true,
                __type: 'number'
            },
            total: {
                __allowed: true,
                __type: 'number'
            }
        },
        externalCost: {
            event: {
                __allowed: true,
                __type: 'string'
            },
            cost: {
                __allowed: true,
                __type: 'number'
            }
        },
        costHistory: {
            __allowed: false,
            __type: 'objectArray',
            __locked: true
        },
        tagParams: {
            __type: 'object',
            __required: true,
            type: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            container: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            campaign: {
                __type: 'string',
                __allowed: true,
                __required: true
            },
            experience: {
                __allowed: true,
                __type: 'string'
            },
            card: {
                __allowed: true,
                __type: 'string'
            }
        }
    };

    placeModule.setupSvc = function(db, config) {
        placeModule.config.cacheTTLs = config.cacheTTLs;
    
        var svc = new CrudSvc(db.collection('placements'), 'pl', {}, placeModule.placeSchema);
        svc._db = db;
        
        var validateExtRefs = placeModule.validateExtRefs.bind(placeModule, svc),
            costHistory     = historian.middlewarify('externalCost', 'costHistory');
        
        svc.use('create', validateExtRefs);
        svc.use('create', costHistory);
        
        svc.use('edit', validateExtRefs);
        svc.use('edit', costHistory);
        
        var cache = new QueryCache(
            config.cacheTTLs.placements.freshTTL,
            config.cacheTTLs.placements.maxTTL,
            db.collection('placements')
        );
        svc.getPublicPlacement = placeModule.getPublicPlacement.bind(placeModule, svc, cache);
        
        return svc;
    };
    
    // Check that references to other C6 objects in tagParams hash are valid
    placeModule.validateExtRefs = function(svc, req, next, done) {
        var log = logger.getLog(),
            doneCalled = false;
        
        function checkExistence(prop, query) {
            // pass check w/o querying mongo if prop doesn't exist
            if (!req.body.tagParams[prop]) {
                return q();
            }
            
            log.trace('[%1] Checking that %2 %3 exists', req.uuid, prop, req.body.tagParams[prop]);
            
            return q(svc._db.collection(prop + 's').count(query))
            .then(function(count) {
                if (count > 0) {
                    return;
                }

                var msg = util.format('%s %s not found', prop, req.body.tagParams[prop]);
                log.info('[%1] %2 with query %3, not saving placement',
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
        
        var campFinished = [Status.Deleted, Status.Canceled, Status.Expired, Status.OutOfBudget];
        
        return q.all([
            checkExistence('container', {
                name: req.body.tagParams.container,
                status: { $ne: Status.Deleted }
            }),
            checkExistence('card', {
                id: req.body.tagParams.card,
                campaignId: req.body.tagParams.campaign,
                status: { $ne: Status.Deleted }
            }),
            checkExistence('campaign', {
                id: req.body.tagParams.campaign,
                status: { $nin: campFinished }
            }),
            checkExistence('experience', {
                id: req.body.tagParams.experience,
                'status.0.status': { $ne: Status.Deleted }
            })
        ])
        .then(function() {
            if (!doneCalled) {
                return next();
            }
        });
    };
    
    placeModule.getPublicPlacement = function(svc, cache, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user', 'externalCost', 'costHistory', 'budget'];

        log.info('[%1] Guest user trying to get placement %2', req.uuid, id);

        return cache.getPromise({ id: id })
        .spread(function(placement) {
            // only show active placements
            if (!placement || placement.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved placement %2', req.uuid, id);
            
            privateFields.forEach(function(key) { delete placement[key]; });
            placement = svc.formatOutput(placement);
            
            return placement;
        })
        .catch(function(error) {
            log.error('[%1] Error getting placement %2: %3', req.uuid, id, util.inspect(error));
            return q.reject('Mongo error');
        });
    };
    
    placeModule.handlePublicGet = function(req, res, svc) {
        var cacheControl = placeModule.config.cacheTTLs.cloudFront * 60;

        return svc.getPublicPlacement(req.params.id, req)
        .then(function(placement) {
            // don't cache requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + cacheControl);
            }
            
            if (!placement) {
                return q({ code: 404, body: 'Placement not found' });
            }
            
            // if ext === 'js', return placement as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(placement) + ';'});
            } else {
                return q({ code: 200, body: placement });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving placement', detail: error }});
        });
    };
    
    
    placeModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        app.get('/api/public/placements?/:id([^.]+).?:ext?', function(req, res) {
            placeModule.handlePublicGet(req, res, svc).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        var router      = express.Router(),
            mountPath   = '/api/placements?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('placements', { allowApps: true });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving placement', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            ['user', 'org', 'tagParams.container', 'tagParams.experience',
             'tagParams.card', 'tagParams.campaign'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving placements', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating placement', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating placement', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting placement', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = placeModule;
}());
