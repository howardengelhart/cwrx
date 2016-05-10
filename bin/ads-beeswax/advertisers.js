/* jshint camelcase: false */
(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        express         = require('express'),
        logger          = require('../../lib/logger'),
        BeeswaxClient   = require('../../lib/beeswax'),
        authUtils       = require('../../lib/authUtils'),
        mongoUtils      = require('../../lib/mongoUtils'),
        Scope           = require('../../lib/enums').Scope,
        requestUtils    = require('../../lib/requestUtils'),
        MiddleManager   = require('../../lib/middleManager'),
        beesAdverts = { config: {} };
    

    beesAdverts.setupSvc = function(db, config, beeswaxCreds) {
        beesAdverts.config.beeswax = config.beeswax;
        beesAdverts.config.api = config.api;
        Object.keys(beesAdverts.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            beesAdverts.config.api[key].baseUrl = urlUtils.resolve(
                beesAdverts.config.api.root,
                beesAdverts.config.api[key].endpoint
            );
        });

        var svc = new MiddleManager();
        svc._db = db;
        svc.beeswax = new BeeswaxClient({ apiRoot: config.beeswax.apiRoot, creds: beeswaxCreds });
        
        svc.use('read', beesAdverts.fetchC6Advert);

        svc.use('create', beesAdverts.fetchC6Advert);
        svc.use('edit', beesAdverts.canEditAdvert);

        svc.use('edit', beesAdverts.fetchC6Advert);
        svc.use('edit', beesAdverts.canEditAdvert);

        svc.use('delete', beesAdverts.fetchC6Advert);
        svc.use('edit', beesAdverts.canEditAdvert);
        
        return svc;
    };
    
    beesAdverts.fetchC6Advert = function(req, next, done) { //TODO: srsly think about modularizing
        var log = logger.getLog(),
            advertId = req.params.c6Id;
            
        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(beesAdverts.config.api.advertisers.baseUrl, advertId)
        })
        .then(function(resp) {
            if (resp && resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch advertiser %3: %4, %5',
                    req.uuid,
                    req.requester.id,
                    advertId,
                    resp.response.statusCode,
                    resp.body
                );
                return done({
                    code: 400,
                    body: 'Cannot fetch this advertiser'
                });
            }
            
            req.advertiser = resp.body;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching advert %2: %3', req.uuid, advertId,util.inspect(error));
            return q.reject('Error fetching advertiser');
        });
    };

    beesAdverts.canEditAdvert = function(req, next, done) {
        var log = logger.getLog(),
            advPerms = ld.get(req.requester, 'permissions.advertisers', null);
        //TODO: this feels shitty...consider moving checkScope? or passing advertSvc in here?
        var canEdit = !!(advPerms && advPerms.edit && (
            (advPerms.edit === Scope.All) ||
            (advPerms.edit === Scope.Org && (req.user && req.user.org === req.advertiser.org))
        ));
        
        if (!canEdit) {
            log.info('[%1] Requester %2 not allowed to modify advertiser %3',
                     req.uuid, req.requester.id, req.advertiser.id);
            return done({ code: 403, body: 'Not authorized to modify this advertiser' });
        }
        
        return next();
    };

    
    beesAdverts.getAdvertiser = function(svc, req) {
        var log = logger.getLog(),
            c6Id = req.params.c6Id,
            beesId;
        
        return svc.runAction(req, 'read', function() {
            if (!req.advertiser.beeswaxIds || !req.advertiser.beeswaxIds.advertiser) {
                log.info('[%1] C6 advert %2 has no Beeswax advert', req.uuid, c6Id);
                return q({ code: 404, body: 'Advertiser has no Beeswax advertiser' });
            }
            
            beesId = req.advertiser.beeswaxIds.advertiser;
            
            return svc.beeswax.advertisers.find(beesId)
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Finding Beeswax Advertiser %2 failed: %3',
                             req.uuid, beesId, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: resp.message
                    });
                }
                if (!resp.payload) {
                    log.info('[%1] Beeswax advert %2 for %3 not found', req.uuid, beesId, c6Id);
                    return q({ code: 404, body: 'Object not found' });
                }
            
                log.info('[%1] Retrieved Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
                return q({ code: 200, body: resp.payload });
            })
            .catch(function(error) {
                log.error('[%1] Error finding Beeswax advert %2 for %3: %4',
                          req.uuid, beesId, c6Id, error.message || util.inspect(error));
                return q.reject('Error finding Beeswax advertiser');
            });
        });
    };
    
    beesAdverts.handleNameInUse = function(req, c6Id, cb) { //TODO: rename, rethink?
        var log = logger.getLog();
        return cb().catch(function(error) {
            var nameInUse = (error.errors instanceof Array) && error.errors.some(function(str) {
                return (/name already in use/).test(str);
            });
            if (!nameInUse) {
                return q.reject(error);
            }
            
            var newName = req.body.advertiser_name + ' (' + c6Id + ')';
            log.info('[%1] Name %2 already used in Beeswax, trying name %3',
                     req.uuid, req.body.advertiser_name, newName);
            
            req.body.advertiser_name = newName;
            return cb();
        });
    };
    
    beesAdverts.createAdvertiser = function(svc, req) {
        var log = logger.getLog(),
            c6Id = req.params.c6Id;
        
        return svc.runAction(req, 'create', function() {
            if (req.advertiser.beeswaxIds && !req.advertiser.beeswaxIds.advertiser) {
                log.info('[%1] C6 advert %2 already has Beeswax advert %3',
                         req.uuid, c6Id, req.advertiser.beeswaxIds.advertiser);
                return q({ code: 400, body: 'Beeswax advertiser already exists for this' });
            }
            
            //TODO: validate rest of body?
            req.body.alternative_id = c6Id;
            req.body.advertiser_name = req.body.advertiser_name || req.advertiser.name;
            
            return beesAdverts.handleNameInUse(req, c6Id, function createAdvert() {
                return svc.beeswax.advertisers.create(req.body);
            })
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Creating Beeswax Advertiser failed: %2', req.uuid, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: resp.message
                    });
                }

                var beesId = resp.payload.advertiser_id;
                log.info('[%1] Created Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
                
                return mongoUtils.editObject(
                    svc._db.collection('advertisers'),
                    { 'beeswaxIds.advertiser': beesId },
                    c6Id
                )
                .thenResolve({
                    code: 200,
                    body: resp.payload
                });
            })
            .catch(function(error) {
                log.error('[%1] Error creating Beeswax advert for %2: %3',
                          req.uuid, c6Id, error.message || util.inspect(error));
                return q.reject('Error creating Beeswax advertiser');
            });
        });
    };
    
    beesAdverts.editAdvertiser = function(svc, req) {
        var log = logger.getLog(),
            c6Id = req.params.c6Id,
            beesId;
        
        return svc.runAction(req, 'edit', function() {
            if (!req.advertiser.beeswaxIds || !req.advertiser.beeswaxIds.advertiser) {
                log.info('[%1] C6 advert %2 has no Beeswax advert', req.uuid, c6Id);
                return q({ code: 404, body: 'Advertiser has no Beeswax advertiser' });
            }
            
            beesId = req.advertiser.beeswaxIds.advertiser;
            
            return beesAdverts.handleNameInUse(req, c6Id, function editAdvert() {
                return svc.beeswax.advertisers.edit(beesId, req.body);
            })
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Editing Beeswax Advertiser %2 failed: %3',
                             req.uuid, beesId, resp.message);
                    return q({
                        code: resp.code || 400,
                        body: resp.message
                    });
                }
                
                log.info('[%1] Edited Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
                return q({
                    code: 200,
                    body: resp.payload
                });
            })
            .catch(function(error) {
                log.error('[%1] Error editing Beeswax advert %2 for %3: %4',
                          req.uuid, beesId, c6Id, error.message || util.inspect(error));
                return q.reject('Error editing Beeswax advertiser');
            });
        });
    };
    
    beesAdverts.deleteAdvertiser = function(svc, req) {
        var log = logger.getLog(),
            c6Id = req.params.c6Id,
            beesId;
        
        return svc.runAction(req, 'delete', function() {
            if (!req.advertiser.beeswaxIds || !req.advertiser.beeswaxIds.advertiser) {
                log.info('[%1] C6 advert %2 has no Beeswax advert', req.uuid, c6Id);
                return q({ code: 204 });
            }
            
            beesId = req.advertiser.beeswaxIds.advertiser;
            
            return svc.beeswax.advertisers.delete(beesId)
            .then(function(resp) {
                if (!resp.success) {
                    log.warn('[%1] Deleting Beeswax Advertiser %2 failed: %3',
                             req.uuid, beesId, resp.message);
                } else {
                    log.info('[%1] Deleted Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
                }

                return q(svc._db.collection('advertisers').findOneAndUpdate(
                    { id: c6Id },
                    { $set: { lastUpdated: new Date() }, $unset: { 'beeswaxIds.advertiser': 1 } },
                    { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                ))
                .thenResolve({ code: 204 });
            })
            .catch(function(error) {
                var advertInUse = false;
                try {
                    advertInUse = error.payload[0].message.some(function(str) {
                        return (/Cannot delete.*when.*associated with/).test(str);
                    });
                } catch(e) {}
                
                if (!!advertInUse) {
                    log.info('[%1] Advertiser %2 for %3 still in use, cannot delete',
                             req.uuid, beesId, c6Id);
                    return q({ code: 400, body: 'Advertiser still in use' });
                }
                
                log.error('[%1] Error deleting Beeswax advert %2 for %3: %4',
                          req.uuid, beesId, c6Id, error.message || util.inspect(error));
                return q.reject('Error deleting Beeswax advertiser');
            });
        });
    };

    
    beesAdverts.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router({ mergeParams: true }),
            mountPath   = '/api/account/advertisers/:c6Id/beeswax/advertisers'; //TODO
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('advertisers', { allowApps: true });
        
        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var promise = beesAdverts.getAdvertiser(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertiser', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = beesAdverts.createAdvertiser(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating advertiser', detail: error });
                });
            });
        });

        router.put('/', sessions, authMidware.edit, audit, function(req, res) {
            var promise = beesAdverts.editAdvertiser(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating advertiser', detail: error });
                });
            });
        });

        router.delete('/', sessions, authMidware.delete, audit, function(req,res) {
            var promise = beesAdverts.deleteAdvertiser(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting advertiser', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = beesAdverts;
}());
/* jshint camelcase: true */
