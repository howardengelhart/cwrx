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
        var self = this;
        self._coll = coll;
        self._prefix = prefix;
        self.objName = objName || coll.collectionName;
        
        self.createValidator = new FieldValidator({ forbidden: ['id', 'created'] });
        self.editValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });
        
        self._middleware = {
            read   : [],
            create : [self.createValidator.midWare.bind(self.createValidator)],
            edit   : [self.checkExisting.bind(self, 'edit'),
                      self.editValidator.midWare.bind(self.editValidator)],
            delete : [self.checkExisting.bind(self, 'delete')]
        };
    }
    
    CrudSvc.prototype.checkScope = function(user, obj, verb) {
        return !!(user && user.permissions && user.permissions[this.objName] &&
                  user.permissions[this.objName][verb] &&
             (user.permissions[this.objName][verb] === Scope.All ||
             (user.permissions[this.objName][verb] === Scope.Org && (user.org === obj.org ||
                                                                     user.id === obj.user)) ||
             (user.permissions[this.objName][verb] === Scope.Own && user.id === obj.user) ));
    };
    
    CrudSvc.prototype.userPermQuery = function(query, requester) {
        var self = this,
            newQuery = JSON.parse(JSON.stringify(query)),
            readScope = requester.permissions[self.objName].read,
            log = logger.getLog();
        
        newQuery.status = { $ne: Status.Deleted };
        
        if (!Scope.isScope(readScope)) {
            log.warn('Requester has invalid scope ' + readScope);
            readScope = Scope.Own;
        }
        
        if (readScope === Scope.Own) {
            newQuery.user = requester.id;
        } else if (readScope === Scope.Org) {
            newQuery.$or = [ { org: requester.org }, { user: requester.id } ];
        }
        
        return newQuery;
    };

    CrudSvc.prototype.formatOutput = function(obj) {
        delete obj._id;
        return mongoUtils.unescapeKeys(obj);
    };
    
    CrudSvc.prototype.setupObj = function(req) {
        var self = this,
            now = new Date();

        req.body.id = self._prefix + '-' + uuid.createUuid().substr(0,14);
        req.body.created = now;
        req.body.lastUpdated = now;
        if (!req.body.status) {
            req.body.status = Status.Active;
        }
        if (!req.body.user) { //TODO: only do this if some option passed in?
            req.body.user = req.user.id;
        }
        if (!req.body.org) { //TODO: also should there be some perm check if setting other user+org?
            req.body.org = req.user.org;
        }
        return mongoUtils.escapeKeys(req.body);
    };
    
    //TODO: not sure how i feel about this multi-purpose method
    CrudSvc.prototype.checkExisting = function(action, req, next, done) {
        var self = this,
            id = req.params.id,
            log = logger.getLog();
            
        return q.npost(self._coll, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist', req.uuid, id);
                return done(action === 'delete' ? { code: 204 }
                                        : {code: 404, body: 'That does not exist'});
            }
            
            if (!self.checkScope(req.user, orig, action)) {
                log.info('[%1] User %2 is not authorized to %3 %4',req.uuid,req.user.id,action,id);
                return done({code: 403, body: 'Not authorized to' + action + ' this'});
            }
            
            if (action === 'delete' && orig.status === Status.Deleted) {
                log.info('[%1] Object %2 has already been deleted', req.uuid, id);
                return done({code: 204});
            }
            
            req.origObj = orig;
            next();
        });
    };

    CrudSvc.prototype.use = function(action, func) {
        if (!this._middleware[action]) {
            this._middleware[action] = [];
        }
        this._middleware[action].push(func);
    };
    
    CrudSvc.prototype.runMiddleware = function(req, action, done, idx, deferred) {
        var self = this;
        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self._middleware[action] || !self._middleware[action][idx]) {
            done();
            return deferred.promise;
        }
        
        q.fcall(self._middleware[action][idx], req, function() {
            self.runMiddleware(req, action, done, ++idx, deferred);
        }, deferred.resolve)
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
            var newObj = self.setupObj(req);
            log.trace('[%1] User %2 is creating %3', req.uuid, req.user.id, newObj.id);
            
            q.npost(self._coll, 'insert', [newObj, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully created %3', req.uuid, req.user.id, newObj.id);
                deferred.resolve({ code: 201, body: self.formatOutput(newObj) });
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
            var updateObj = { $set: mongoUtils.escapeKeys(req.body) },
                opts = {w: 1, journal: true, new: true};

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
                deferred.resolve({code: 204});
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
    
    module.exports = CrudSvc;
}());
