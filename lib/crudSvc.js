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
    
    CrudSvc.prototype.checkScope = function(user, obj, verb) {
        return !!(user && user.permissions && user.permissions[this.objName] &&
                  user.permissions[this.objName][verb] &&
             (user.permissions[this.objName][verb] === Scope.All ||
             (user.permissions[this.objName][verb] === Scope.Org && (user.org === obj.org ||
                                                                     user.id === obj.user)) ||
             (user.permissions[this.objName][verb] === Scope.Own && user.id === obj.user) ));
    };
    
    CrudSvc.prototype.userPermQuery = function(query, requester) { //TODO
    
    };

    CrudSvc.prototype.createValidator = new FieldValidator({ forbidden: ['id', 'created'] });
    CrudSvc.prototype.editValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });
    
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
    
    //TODO: not sure how i feel about this multi-purpose method
    CrudSvc.prototype._checkExisting = function(action, req, next) {
        var self = this,
            id = req.params.id,
            deferred = q.defer(),
            log = logger.getLog();
        
        q.npost(self._coll, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist', req.uuid, id);
                return deferred.resolve(action === 'delete' ? { code: 204 }
                                        : {code: 404, body: 'That does not exist'});
            }
            
            if (!self.checkScope(req.user, orig, action)) {
                log.info('[%1] User %2 is not authorized to %3 %4',req.uuid,req.user.id,action,id);
                return deferred.resolve({code: 403, body: 'Not authorized to' + action + ' this'});
            }
            
            if (action === 'delete' && orig.status === Status.Deleted) {
                log.info('[%1] Object %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            
            req.origObj = orig;
            next();
        })
        .catch(deferred.reject);
        
        return deferred.promise;
    };

    CrudSvc.prototype._middleware = {
        read   : [],
        create : [this.createValidator.midWare],
        edit   : [this._checkExisting.bind(this, 'edit'), this.editValidator.midWare],
        delete : [this._checkExisting.bind(this, 'delete')]
    };
    
    CrudSvc.prototype.use = function(action, func) {
        this._middleware[action].push(func);
    };
    
    CrudSvc.prototype.runMiddleware = function(req, action, done, idx, deferred) {
        var self = this;
        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self._middleware[action][idx]) {
            done();
            return deferred.promise;
        }
        
        self._middleware[action][idx](req, function() {
            self.runMiddleware(req, action, done, ++idx, deferred);
        })
        .then(deferred.resolve)
        .catch(deferred.reject);
        
        return deferred.promise;
    };

    CrudSvc.prototype.getObjs = function(query, req, multiGet) {
        var self = this,
            limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog(),
            deferred = q.defer();
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
             !(req.user.permissions &&
               req.user.permissions[self.objName] &&
               req.user.permissions[self.objName].read &&
               req.user.permissions[self.objName].read === Scope.All)) {
            log.info('[%1] User %2 is not authorized to read all %3',
                     req.uuid, req.user.id, self.objName);
            return q({code: 403, body: 'Not authorized to read all ' + self.objName});
        }
        
        self.runMiddleware(req, 'read', function() {
            log.info('[%1] User %2 getting %3 with query %4, sort %5, limit %6, skip %7', req.uuid,
                     req.user.id, self.objName, JSON.stringify(query), JSON.stringify(sortObj),
                     limit, skip);

            var permQuery = self.userPermQuery(query, req.user),
                cursor = self._coll.find(permQuery, {sort: sortObj, limit: limit, skip: skip}),
                promise = multiGet ? q.npost(cursor, 'count') : q(),
                resp = {};
            
            log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));
            
            promise.then(function(count) {
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
                deferred.resolve(resp);
            })
            .catch(function(error) {
                log.error('[%1] Error getting %2: %3', req.uuid, self.objName, error);
                deferred.reject(error);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing find', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(error) {
            log.error('[%1] Failed running middleware for find: %2', req.uuid, error);
            deferred.reject(error);
        });
        
        return deferred.promise;
    };

    CrudSvc.prototype.createObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();

        self.runMiddleware(req, 'create', function() {
            var newObj = self.setupObj(req.body);
            log.trace('[%1] User %2 is creating %3', req.uuid, req.user.id, newObj.id);
            
            q.npost(self._coll, 'insert', [newObj, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully created %3', req.uuid, req.user.id, newObj.id);
                return deferred.resolve({ code: 201, body: self.formatOutput(newObj) });
            })
            .catch(function(error) {
                log.error('[%1] Failed doing create: %2', req.uuid, error);
                deferred.reject(error);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing create', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(error) {
            log.error('[%1] Failed running middleware for create: %2', req.uuid, error);
            deferred.reject(error);
        });
        
        return deferred.promise;
    };
    
    CrudSvc.prototype.editObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();

        self.runMiddleware(req, 'edit', function() {
            req.body.lastUpdated = new Date();
            var updateObj = { $set: mongoUtils.escapeKeys(req.body) };
            var opts = {w: 1, journal: true, new: true};

            q.npost(self._coll, 'findAndModify', [{id: req.params.id}, {id: 1}, updateObj, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated %3', req.uuid, req.user.id, updated.id);
                deferred.resolve({code: 200, body: self.formatOutput(updated) });
            })
            .catch(function(error) {
                log.error('[%1] Failed doing update: %2', req.uuid, error);
                deferred.reject(error);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing update', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(error) {
            log.error('[%1] Failed running middleware for update: %2', req.uuid, error);
            deferred.reject(error);
        });
        
        return deferred.promise;
    };
    
    CrudSvc.prototype.deleteObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();
        
        self.runMiddleware(req, 'delete', function() {
            var updates = { $set: { lastUpdated: new Date(), status: Status.Deleted } };

            q.npost(self._coll, 'update', [{id: req.params.id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted %3',req.uuid,req.user.id,req.params.id);
                return q({code: 204});
            })
            .catch(function(error) {
                log.error('[%1] Failed doing delete: %2', req.uuid, error);
                deferred.reject(error);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing delete', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(error) {
            log.error('[%1] Failed running middleware for delete: %2', req.uuid, error);
            deferred.reject(error);
        });
        
        return deferred.promise;
    };
    
    //////////////////////////////////////////////////////////////////////////////////

    /*
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
    */
    
    /*
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
    */

    /*
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
    */
    
    /*
    CrudSvc.prototype.deleteObj = function(req) {
        var self = this,
            id = req.params.id,
            requester = req.user,
            log = logger.getLog();
            
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
    */

    module.exports = CrudSvc;
}());
