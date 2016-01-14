(function(){
    'use strict';

    var express         = require('express'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        
        refModule = {};
        
    // Used to generate codes: produces a max 2-character string when converted to base 36
    refModule.counter = Math.floor(Math.random() * 1296);

    refModule.refSchema = {
        name: {
            __allowed: true,
            __required: true,
            __type: 'string'
        },
        clientId: {
            __allowed: true,
            __type: 'string'
        },
        code: {
            __allowed: false,
            __type: 'string',
            __locked: true
        }
    };

    refModule.setupSvc = function(db) {
        var opts = { userProp: false, orgProp: false },
            svc = new CrudSvc(db.collection('referralCodes'), 'ref', opts, refModule.refSchema);
            
        svc.use('create', refModule.generateCode);
        
        return svc;
    };
    
    // Generate req.body.code: concats epoch time in base 36 + increasing counter in base 36
    refModule.generateCode = function(req, next/*, done*/) {
        var counterStr = refModule.counter.toString(36);
        if (counterStr.length === 1) {
            counterStr = '0' + counterStr;
        }
        
        req.body.code = Date.now().toString(36) + counterStr;

        if (++refModule.counter >= 1296) {
            refModule.counter = 0;
        }
        
        next();
    };
    
    refModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/referral-codes?'; // prefix to all endpoints declared here
            
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetRef = authUtils.middlewarify({ referralCodes: 'read' });
        router.get('/:id', sessions, authGetRef, audit, function(req, res) {
            var promise = svc.getObjs({ id: req.params.id }, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving referralCode', detail: error });
                });
            });
        });

        router.get('/', sessions, authGetRef, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            ['name', 'clientId', 'code'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving referralCodes', detail: error });
                });
            });
        });

        var authPostRef = authUtils.middlewarify({ referralCodes: 'create' });
        router.post('/', sessions, authPostRef, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating referralCode', detail: error });
                });
            });
        });

        var authPutRef = authUtils.middlewarify({ referralCodes: 'edit' });
        router.put('/:id', sessions, authPutRef, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error editing referralCode', detail: error });
                });
            });
        });

        var authDelRef = authUtils.middlewarify({ referralCodes: 'delete' });
        router.delete('/:id', sessions, authDelRef, audit, function(req, res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting referralCode', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };

    module.exports = refModule;
}());

