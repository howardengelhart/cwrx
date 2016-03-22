(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        util            = require('util'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        objUtils        = require('../lib/objUtils'),
        authUtils       = require('../lib/authUtils'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        
        orgModule = {}; // for exporting functions to unit tests
        
    orgModule.orgSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        adConfig: {
            __allowed: false,
            __type: 'object'
        },
        config: {
            __allowed: true,
            __type: 'object'
        },
        waterfalls: {
            __allowed: true,
            __type: 'object'
        },
        braintreeCustomer: {
            __allowed: false,
            __type: 'string'
        },
        referralCode: {
            __allowed: false,
            __type: 'string'
        }
    };

    orgModule.setupSvc = function(db, gateway) {
        var opts = { userProp: false, orgProp: false, ownedByUser: false },
            svc = new CrudSvc(db.collection('orgs'), 'o', opts, orgModule.orgSchema);
            
        svc._db = db;
        
        svc.use('create', orgModule.createPermCheck);
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', orgModule.setupConfig);

        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));
        
        svc.use('delete', orgModule.deletePermCheck);
        svc.use('delete', orgModule.activeUserCheck.bind(orgModule, svc));
        svc.use('delete', orgModule.runningCampaignCheck.bind(orgModule, svc));
        svc.use('delete', orgModule.deleteBraintreeCustomer.bind(orgModule, gateway));
        
        return svc;
    };
    
    // Only allow creating org if requester has admin priviledges
    orgModule.createPermCheck = function(req, next, done) {
        var log = logger.getLog();

        if (req.requester.permissions.orgs.create !== Scope.All) {
            log.info('[%1] Requester %2 is not authorized to create orgs',
                     req.uuid, req.requester.id);
            return q(done({ code: 403, body: 'Not authorized to create orgs' }));
        }

        return q(next());
    };

    // Setup some default waterfalls
    orgModule.setupConfig = function(req, next/*, done*/) {
        if (!req.body.config) {
            req.body.config = {};
        }

        if (!req.body.waterfalls) {
            req.body.waterfalls = {};
        }
        
        objUtils.extend(req.body.waterfalls, {
            video: ['cinema6'],
            display: ['cinema6']
        });
        
        return q(next());
    };
    
    // Only allow org to be deleted if not requester's org + they have admin priviledges
    orgModule.deletePermCheck = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.user && req.params.id === req.user.org) {
            log.info('[%1] User %2 tried to delete their own org', req.uuid, req.requester.id);
            return q(done({ code: 400, body: 'You cannot delete your own org' }));
        }

        if (req.requester.permissions.orgs.delete !== Scope.All) {
            log.info('[%1] User %2 is not authorized to delete orgs', req.uuid, req.requester.id);
            return q(done({ code: 403, body: 'Not authorized to delete orgs' }));
        }

        return q(next());
    };
    
    // Only allow org to be deleted if it has no active users
    orgModule.activeUserCheck = function(svc, req, next, done) {
        var log = logger.getLog(),
            query = { org: req.params.id, status: { $ne: Status.Deleted } };

        return q(svc._db.collection('users').count(query))
        .then(function(count) {
            if (count > 0) {
                log.info('[%1] Can\'t delete org %2 since it still has %3 active users',
                         req.uuid, req.params.id, count);
                return done({ code: 400, body: 'Org still has active users' });
            }
            
            return q(next());
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for users: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    /* Checks if the org still has unfinished campaigns. */
    orgModule.runningCampaignCheck = function(orgSvc, req, next, done) { //TODO: update tests
        var log = logger.getLog(),
            query = {
                org: req.params.id,
                status: { $in: [Status.Active, Status.Paused] }
            };
            
        return q(orgSvc._db.collection('campaigns').count(query))
        .then(function(campCount) {
            if (campCount > 0) {
                log.info('[%1] Org %2 still has %3 unfinished campaigns',
                         req.uuid, req.params.id, campCount);

                return done({ code: 400, body: 'Org still has unfinished campaigns' });
            }
            
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed querying for campaigns: %2', req.uuid, error);
            return q.reject(new Error('Mongo error'));
        });
    };

    // Delete the org's braintreeCustomer, if it exists
    orgModule.deleteBraintreeCustomer = function(gateway, req, next/*, done*/) {
        var log = logger.getLog();
        
        if (!req.origObj.braintreeCustomer) {
            log.trace('[%1] No braintreeCustomer on org %2', req.uuid, req.origObj.id);
            return q(next());
        }
        
        return q.npost(gateway.customer, 'delete', [req.origObj.braintreeCustomer])
        .then(function() {
            log.info(
                '[%1] Successfully deleted BT customer %2 on org %3',
                 req.uuid,
                 req.origObj.braintreeCustomer,
                 req.origObj.id
             );
            return q(next());
        })
        .catch(function(error) {
            if (error && error.name === 'notFoundError') {
                log.warn(
                    '[%1] BT customer %2 on org %3 not found',
                    req.uuid,
                    req.origObj.braintreeCustomer,
                    req.origObj.id
                );

                return q(next());
            } else {
                log.error(
                    '[%1] Error deleting BT customer %2 on org %3: %4',
                     req.uuid,
                     req.origObj.braintreeCustomer,
                     req.origObj.id,
                     util.inspect(error)
                 );
                return q.reject('Braintree error');
            }
        });
    };

    
    orgModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/orgs?'; // prefix to all endpoints declared here
            
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('orgs', { allowApps: true });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving org', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if (req.query.braintreeCustomer) {
                query.braintreeCustomer = String(req.query.braintreeCustomer);
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving orgs', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating org', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing org', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting org', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = orgModule;
}());

