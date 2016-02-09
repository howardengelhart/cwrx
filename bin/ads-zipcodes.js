(function(){
    'use strict';

    var express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),

        zipModule = {};

    zipModule.setupSvc = function(coll) {
        var opts = { userProp: false, orgProp: false, allowPublic: true, maxReadLimit: 1000 },
            svc = new CrudSvc(coll, null, opts); //TODO: this feels...dangerous
            
        return svc;
    };
    
    zipModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/zipcodes?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authGetZip = authUtils.middlewarify({});
        router.get('/:code', sessions, authGetZip, audit, function(req, res) {
            var promise = svc.getObjs({ zipCode: req.params.code }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving zipcode', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetZip, audit, function(req, res) {
            var query = {};
            if ('zipcodes' in req.query) {
                query.zipcode = String(req.query.zipcodes).split(',');
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving zipcodes', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = zipModule;
}());
