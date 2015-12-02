(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),

        siteModule = {};

    siteModule.setupSvc = function(coll) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(coll, 's', opts);
        svc.createValidator._required.push('host', 'name');
        svc.createValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'create');
        svc.createValidator._formats.containers = ['object'];
        svc.editValidator._formats.containers = ['object'];
        svc.editValidator._condForbidden.org = FieldValidator.orgFunc('sites', 'edit');
        
        var hostRegex = /^([\w-]+\.)+[\w-]+$/;

        svc.use('create', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('create', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('create', siteModule.validateContainers);

        svc.use('edit', svc.validateUniqueProp.bind(svc, 'host', hostRegex));
        svc.use('edit', svc.validateUniqueProp.bind(svc, 'name', null));
        svc.use('edit', siteModule.validateContainers);

        return svc;
    };
    
    siteModule.validateContainers = function(req, next, done) {
        var log = logger.getLog(),
            containers = req.body.containers || [],
            ids = {};
        
        for (var i = 0; i < containers.length; i++) {
            if (!containers[i].id) {
                log.info('[%1] Container #%2 has no id', req.uuid, i);
                return q(done({code: 400, body: 'All containers must have an id'}));
            }

            if (ids[containers[i].id] !== undefined) {
                log.info('[%1] Containers #%2 and #%3 both have id %4',
                         req.uuid, ids[containers[i].id], i, containers[i].id);
                return q(done({code: 400, body: 'Container ids must be unique'}));
            }
            
            ids[containers[i].id] = i;
        }
        
        return q(next());
    };
    
    siteModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/sites?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetSite = authUtils.middlewarify({sites: 'read'});
        router.get('/:id', sessions, authGetSite, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving site', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetSite, audit, function(req, res) {
            var query = {};
            ['name', 'org', 'host'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving sites', detail: error });
                });
            });
        });

        var authPostSite = authUtils.middlewarify({sites: 'create'});
        router.post('/', sessions, authPostSite, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating site', detail: error });
                });
            });
        });

        var authPutSite = authUtils.middlewarify({sites: 'edit'});
        router.put('/:id', sessions, authPutSite, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating site', detail: error });
                });
            });
        });

        var authDelSite = authUtils.middlewarify({sites: 'delete'});
        router.delete('/:id', sessions, authDelSite, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting site', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = siteModule;
}());
