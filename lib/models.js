(function(){
    'use strict';
    
    var q               = require('q'),
        enums           = require('./enums'),
        uuid            = require('./uuid'),
        mongoUtils      = require('./mongoUtils'),
        logger          = require('./logger'),
        FieldValidator  = require('./fieldValidator'),
        Scope           = enums.Scope,
        Status          = enums.Status;

    function CrudSvc(coll, prefix, objName) {
        this._coll = coll;
        this.prefix = prefix;
        this.objName = objName || coll.collectionName;
    }
    
    CrudSvc.prototype.checkScope = function() { //TODO
    
    };
    
    CrudSvc.prototype.userPermQuery = function(query, requester) { //TODO
    
    };
    
    CrudSvc.prototype.createValidator = new FieldValidator({ forbidden: ['id', 'created'] });
    CrudSvc.prototype.updateValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });
    
    CrudSvc.prototype.formatOutput = function(obj) {
        delete obj._id;
        return mongoUtils.unescapeKeys(obj);
    };
    
    CrudSvc.prototype.setupObj = function(newObj) {
        var self = this,
            now = new Date();

        newObj.id = self.prefix + '-' + uuid.createUuid().substr(0,14);
        newObj.created = now;
        newObj.lastUpdated = now;
        if (!newObj.status) {
            newObj.status = Status.Active;
        }

        return mongoUtils.escapeKeys(newObj);
    };
    
    CrudSvc.prototype.getObjs = function(query, req, multiGet) {
        var self = this,
            limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog(),
            requester = req.user,
            resp = {},
            promise;
        query = query || {};

        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }

        if ( (!Object.keys(query).length) &&
             !(requester.permissions &&
               requester.permissions[self.objName] &&
               requester.permissions[self.objName].read &&
               requester.permissions[self.objName].read === Scope.All)) {
            log.info('[%1] User %2 is not authorized to read all %3',
                     req.uuid, requester.id, self.objName);
            return q({code: 403, body: 'Not authorized to read all ' + self.objName});
        }
        
        log.info('[%1] User %2 getting %3 with query %4, sort %5, limit %6, skip %7', req.uuid,
                 requester.id, self.objName, JSON.stringify(query), JSON.stringify(sortObj),
                 limit, skip);

        var permQuery = self.userPermQuery(query, requester),
            cursor = self._coll.find(permQuery, {sort: sortObj, limit: limit, skip: skip});
        
        log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));
        
        if (multiGet) {
            promise = q.npost(cursor, 'count');
        } else {
            promise = q();
        }
        return promise.then(function(count) {
            if (count !== undefined) {
                resp.pagination = {
                    start: count !== 0 ? skip + 1 : 0,
                    end: limit ? Math.min(skip + limit , count) : count,
                    total: count
                };
            }
            return q.npost(cursor, 'toArray');
        })
        .then(function(results) {
            var objList = results.map(self.formatOutput);

            log.info('[%1] Showing the requester %2 documents', req.uuid, objList.length);

            if (objList.length === 0) {
                resp.code = 404;
                resp.body = 'No ' + self.objName + ' found';
            } else {
                resp.code = 200;
                resp.body = objList;
            }
            return q(resp);
        })
        .catch(function(error) {
            log.error('[%1] Error getting %2: %3', req.uuid, self.objName, error);
            return q.reject(error);
        });
    };
    
    CrudSvc.prototype.createObj = function(req) {
        var self = this,
            newObj = req.body,
            requester = req.user,
            log = logger.getLog();
            
        if (!newObj || typeof newObj !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        //TODO: handle required fields
        //TODO: check requester perm scope?
        //TODO: check for existing with unique field
        
        if (!self.createValidator.validate(newObj, {}, requester)) {
            log.warn('[%1] newObj contains illegal fields', req.uuid);
            log.trace('newObj: %1  |  requester: %2',
                      JSON.stringify(newObj), JSON.stringify(requester));
            return q({code: 400, body: 'Illegal fields'}); //TODO: would be nice to give better msg
        }
        
        newObj = self.setupObj(newObj);
        log.trace('[%1] User %2 is creating %3', req.uuid, requester.id, newObj.id);
        
        return q.npost(self._coll, 'insert', [newObj, {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created %3', req.uuid, requester.id, newObj.id);
            return q({ code: 201, body: self.formatOutput(newObj) });
        })
        .catch(function(error) {
            log.error('[%1] Error creating %2 for user %3: %4',
                      req.uuid, newObj.id, requester.id, error);
            return q.reject(error);
        });
    };
    
    ///////////////////////////////////////////////////////////////////////////////////
    //TODO: WIP skeleton with middleware
    
    CrudSvc.prototype.middleware = {
        update: {
            pre: [Function, Function],
            post: [Function, Function]
        },
        create: {
            // ...
        }
    };
    
    CrudSvc.prototype.use = function(action, stage, func) {
        this.middleware[action][stage].push(func);
    };
    
    //TODO: this could work, but would probs be nicer to use next() style so we can break out early
    /*runMiddleware = function(req, action, stage) {
        return self.middleware[action][stage].reduce(function(reqPromise, func) {
            return reqPromise.then(func);
        }, q(req));
    };*/

    CrudSvc.prototype.runMiddleware = function(req, action, stage, done, idx, deferred) {
        var self = this;
        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self.middleware[action][stage][idx]) {
            done(req);
            return deferred.promise;
        }
        
        self.middleware[action][stage][idx](req, function() {
            self.runMiddleware(req, action, stage, done, ++idx, deferred)
        })
        .then(function(resp) {
            deferred.resolve(resp);
        }).catch(function(error) {
            //TODO: log?
            deferred.reject(error);
        });
        
        return deferred.promise;
    };
    
    testUpdate = function(req) {
        /* setup vars, etc. */
        
        return self.runMiddleware(req, 'update', 'pre', function(req) {
            // TODO: do findAndModify
            //       then self.runMiddleware(req, 'update', 'post', someFunc)
        })
        .then(function(resp) {
            return q(resp);
        }).catch(function(error) {
            // handle error
        });
    };
    
    //////////////////////////////////////////////////////////////////////////////////
    
    CrudSvc.prototype.updateObj = function(req) {
        var self = this,
            id = req.params.id,
            updates = req.body,
            requester = req.user,
            log = logger.getLog();
            
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        //TODO: trim fields?
        //TODO: check for existing with unique fields? (e.g. host for sites)
        
        return q.npost(self._coll, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist; not creating it', req.uuid, id);
                return q({code: 404, body: 'That does not exist'});
            }
            
            if (!self.checkScope(requester, orig, 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, requester.id, id);
                return q({code: 403, body: 'Not authorized to edit this'});
            }

            if (!self.updateValidator.validate(updates, orig, requester)) {
                log.warn('[%1] Updates contain illegal fields', req.uuid);
                log.trace('updates: %1  |  orig: %2  |  requester: %3', JSON.stringify(updates),
                          JSON.stringify(orig), JSON.stringify(requester));
                return q({code: 400, body: 'Illegal fields'});
            }
            
            //TODO: format updates?
            updates.lastUpdated = new Date();
            var updateObj = { $set: mongoUtils.escapeKeys(updates) };
            var opts = {w: 1, journal: true, new: true};

            return q.npost(self._coll, 'findAndModify', [{id: id}, {id: 1}, updateObj, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated %3',req.uuid,requester.id,updated.id);
                return q({code: 200, body: self.formatOutput(updated) });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error updating %2 for user %3: %4', req.uuid, id, requester.id, error);
            return q.reject(error);
        });
    };
    
    CrudSvc.prototype.deleteObj = function(req) {
        var self = this,
            id = req.params.id,
            requester = req.user,
            log = logger.getLog();
            
        //TODO: check + reject if id somehow is own?
        log.info('[%1] User %2 is attempting to delete %3', req.uuid, requester.id, id);

        return q.npost(self._coll, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist', req.uuid, id);
                return q({code: 204});
            }

            if (!self.checkScope(requester, orig, 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, requester.id, id);
                return q({code: 403, body: 'Not authorized to delete this'});
            }

            if (orig.status === Status.Deleted) {
                log.info('[%1] Object %2 has already been deleted', req.uuid, id);
                return q({code: 204});
            }

            var updates = { $set: { lastUpdated: new Date(), status: Status.Deleted } };

            return q.npost(self._coll, 'update', [{id: id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted %3', req.uuid, requester.id, id);
                return q({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting %2 for user %3: %4', req.uuid,id, requester.id, error);
            return q.reject(error);
        });
    };

    module.exports = CrudSvc;
}());
