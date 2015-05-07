(function(){
    'use strict';

    var authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        enums           = require('../lib/enums'),
        logger          = require('../lib/logger'),
        Scope           = enums.Scope,

        catModule = {};

    catModule.setupCatSvc = function(catColl, jobManager) {
        var opts = {
            userProp: false,
            orgProp: false,
            allowPublic: true
        };
        var catSvc = new CrudSvc(catColl, 'cat', opts, jobManager);
            
        catSvc.createValidator._required.push('name');
        catSvc.editValidator._forbidden.push('name');
        
        catSvc.use('create', catModule.adminCreateCheck);
        catSvc.use('create', catSvc.validateUniqueProp.bind(catSvc, 'name', /^\w+$/));
        
        return catSvc;
    };

    // only allow admins to create categories
    catModule.adminCreateCheck = function(req, next, done) {
        var log = logger.getLog();
        if (!(req.user.permissions &&
              req.user.permissions.categories &&
              req.user.permissions.categories.create === Scope.All)) {
            log.info('[%1] User %2 not authorized to create categories', req.uuid, req.user.id);
            return done({code: 403, body: 'Not authorized to create categories'});
        }
        
        next();
    };
    
    catModule.setupEndpoints = function(app, catSvc, sessions, audit) {
        var authGetCat = authUtils.middlewarify({});
        app.get('/api/content/category/:id', sessions, authGetCat, audit, function(req, res) {
            catSvc.getObjs({id: req.params.id}, req, res, false).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving category', detail: error });
            });
        });

        app.get('/api/content/categories', sessions, authGetCat, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }

            catSvc.getObjs(query, req, res, true).then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving categories', detail: error });
            });
        });

        var authPostCat = authUtils.middlewarify({categories: 'create'});
        app.post('/api/content/category', sessions, authPostCat, audit, function(req, res) {
            catSvc.createObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating category', detail: error });
            });
        });

        var authPutCat = authUtils.middlewarify({categories: 'edit'});
        app.put('/api/content/category/:id', sessions, authPutCat, audit, function(req, res) {
            catSvc.editObj(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating category', detail: error });
            });
        });

        var authDelCat = authUtils.middlewarify({categories: 'delete'});
        app.delete('/api/content/category/:id', sessions, authDelCat, audit, function(req, res) {
            catSvc.deleteObj(req, res)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting category', detail: error });
            });
        });
    };
    
    module.exports = catModule;
}());
