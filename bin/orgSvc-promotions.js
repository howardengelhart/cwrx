(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        QueryCache      = require('../lib/queryCache'),
        Status          = require('../lib/enums').Status,
        
        promModule = { config: {}, schemas: {} };
        
    promModule.schemas.promotions = { // schema for all promotion objects
        name: {
            __allowed: true,
            __type: 'string'
        },
        type: {
            __allowed: true,
            __type: 'string',
            __required: true,
            __acceptableValues: ['signupReward', 'freeTrial']
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
            __min: 0
        }
    };
    
    promModule.schemas.freeTrial = { // schema for data hash on freeTrial promotions
        trialLength: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0
        },
        paymentMethodRequired: {
            __allowed: true,
            __type: 'boolean',
            __default: true
        }
    };
    

    promModule.setupSvc = function(db, config) {
        promModule.config.cacheTTLs = config.cacheTTLs;

        var opts = { userProp: false, orgProp: false },
            schema = promModule.schemas.promotions,
            svc = new CrudSvc(db.collection('promotions'), 'pro', opts, schema);
            
        svc.use('create', promModule.validateData);

        svc.use('edit', promModule.validateData);

        var cache = new QueryCache(
            config.cacheTTLs.promotions.freshTTL,
            config.cacheTTLs.promotions.maxTTL,
            db.collection('promotions')
        );
        svc.getPublicPromotion = promModule.getPublicPromotion.bind(promModule, svc, cache);
            
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

    promModule.getPublicPromotion = function(svc, cache, id, req) {
        var log = logger.getLog();

        log.info('[%1] Guest user trying to get promotion %2', req.uuid, id);

        return cache.getPromise({ id: id })
        .spread(function(promotion) {
            // only show active promotions
            if (!promotion || promotion.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved promotion %2', req.uuid, id);
            
            promotion = svc.formatOutput(promotion);
            
            return promotion;
        })
        .catch(function(error) {
            log.error('[%1] Error getting promotion %2: %3', req.uuid, id, util.inspect(error));
            return q.reject('Mongo error');
        });
    };
    
    promModule.handlePublicGet = function(req, res, svc) {
        var cacheControl = promModule.config.cacheTTLs.cloudFront * 60;

        return svc.getPublicPromotion(req.params.id, req)
        .then(function(promotion) {
            // don't cache requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + cacheControl);
            }
            
            if (!promotion) {
                return q({ code: 404, body: 'Promotion not found' });
            }
            
            // if ext === 'js', return promotion as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(promotion) + ';'});
            } else {
                return q({ code: 200, body: promotion });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving promotion', detail: error }});
        });
    };

    
    promModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        app.get('/api/public/promotions?/:id([^.]+).?:ext?', function(req, res) {
            promModule.handlePublicGet(req, res, svc).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        var router      = express.Router(),
            mountPath   = '/api/promotions?'; // prefix to all endpoints declared here
            
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

