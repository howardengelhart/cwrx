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

    /**
     * Create a generalized CRUD service, with methods for retrieving, creating, editing, and
     * deleting objects. coll should be a mongo collection, and prefix the one letter prefix for the
     * object ids.
     * opts is an optional hash of options, including these options:
     *     objName: name of the objects in user permissions (default: collection name)
     *     userProp: if true, the user property will be set on new objects (default: true)
     *     orgProp: if true, the org prop will be set on new objects (default: true)
     *     allowPublic: if true, 'active' objects will be retrievable by anyone (default: false)
     */
    function CrudSvc(coll, prefix, opts) {
        opts = opts || {};
        var self = this;
        self._coll = coll;
        self._prefix = prefix;
        self.objName = opts.objName || coll.collectionName;
        self._userProp = opts.userProp !== undefined ? opts.userProp : true;
        self._orgProp = opts.orgProp !== undefined ? opts.orgProp : true;
        self._allowPublic = opts.allowPublic !== undefined ? opts.allowPublic : false;
        
        self.createValidator = new FieldValidator({ forbidden: ['id', 'created'] });
        self.editValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });
        
        self._middleware = {
            read   : [],
            create : [self.createValidator.midWare.bind(self.createValidator),
                      self.setupObj.bind(self)],
            edit   : [self.checkExisting.bind(self, 'edit'),
                      self.editValidator.midWare.bind(self.editValidator)],
            delete : [self.checkExisting.bind(self, 'delete')]
        };
    }

    /**
     * This module uses a middleware system to allow client code to easily customize endpoints of a
     * service with different checks or other preprocessing functions. Middleware is stored in
     * self._middleware, with a different array of functions for each action (read, create, edit,
     * delete).
     * Each middleware function will be called with req, next, and done; next should be called
     * (with no args) to proceed to the next middleware step, and done should be called with a
     * response object ({code: #, body: '...'}) to break out of the route early. In the event of an
     * unexpected error, the middleware function should return a rejected promise or throw an error.
     */
     
    // Adds the func to the list of middleware for the appropriate action.
    CrudSvc.prototype.use = function(action, func) {
        if (!this._middleware[action]) {
            this._middleware[action] = [];
        }
        this._middleware[action].push(func);
    };

    /**
     * A recursive method that runs through all the middleware for the given action. done will be
     * called if all the middleware completes successfully; otherwise, this will return a resolved
     * or rejected promise depending on whether the failure was expected (4xx) or unexpected (5xx).
     */
    CrudSvc.prototype.runMiddleware = function(req, action, done, idx, deferred) {
        var self = this;
        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self._middleware[action] || !self._middleware[action][idx]) {
            done();
            return deferred.promise;
        }
        
        //TODO: consider rewriting with promises to avoid calling next or done multiple times?
        q.fcall(self._middleware[action][idx], req, function() {
            self.runMiddleware(req, action, done, ++idx, deferred);
        }, deferred.resolve)
        .catch(deferred.reject);
        
        return deferred.promise;
    };
    
    /**
     * Check if a user has permission to perform the given action (verb) on the object, according
     * to their permissions. Called from checkExisting for the edit and delete functions.
     */
    CrudSvc.prototype.checkScope = function(user, obj, verb) {
        return !!(user && user.permissions && user.permissions[this.objName] &&
                  user.permissions[this.objName][verb] &&
             (user.permissions[this.objName][verb] === Scope.All ||
             (user.permissions[this.objName][verb] === Scope.Org && (user.org === obj.org ||
                                                                     user.id === obj.user)) ||
             (user.permissions[this.objName][verb] === Scope.Own && user.id === obj.user) ));
    };
    
    /**
     * Effectively translates the logic in checkScope into mongo query fields for only retrieving
     * objects that the user can see.
     */
    CrudSvc.prototype.userPermQuery = function(query, requester) {
        var self = this,
            newQuery = JSON.parse(JSON.stringify(query)),
            readScope = (requester.permissions[self.objName] || {}).read,
            log = logger.getLog();
        
        // if user has no permission to read these, show them active objects if allowed for this svc
        if (!readScope && self._allowPublic) {
            newQuery.status = Status.Active;
            return newQuery;
        }
        
        newQuery.status = { $ne: Status.Deleted };
        
        if (!Scope.isScope(readScope)) {
            log.warn('Requester has invalid scope ' + readScope);
            readScope = Scope.Own;
        }
        
        if (readScope === Scope.Own) {
            newQuery.$or = [ { user: requester.id } ];
        } else if (readScope === Scope.Org) {
            newQuery.$or = [ { org: requester.org }, { user: requester.id } ];
        }
        
        // if the user is not an admin, show active objects if allowed for this service
        if (self._allowPublic && newQuery.$or) {
            newQuery.$or.push({status: Status.Active});
        }
        
        return newQuery;
    };

    // Format an object for returning to the client.
    CrudSvc.prototype.formatOutput = function(obj) {
        delete obj._id;
        return mongoUtils.unescapeKeys(obj);
    };
    
    /**
     * Setup a new object, adding id, created, lastUpdated, and status fields to req.body. If 
     * self._userProp and self._orgProp are enabled, the service will pay attention to the user and
     * org props: it will default them to the requester's id and org if not defined, and if they are
     * defined on the body, it will return a 403 if the requester is not an admin and the props are
     * different than their own id/org.
     */
    CrudSvc.prototype.setupObj = function(req, next, done) {
        var self = this,
            log = logger.getLog(),
            now = new Date();

        req.body.id = self._prefix + '-' + uuid.createUuid().substr(0,14);
        req.body.created = now;
        req.body.lastUpdated = now;
        if (!req.body.status) {
            req.body.status = Status.Active;
        }

        if (self._userProp) {
            if (!req.body.user) {
                req.body.user = req.user.id;
            } else if (req.body.user !== req.user.id &&
                       req.user.permissions[self.objName].create !== Scope.All) {
                log.info('[%1] User %2 attempting to create object for user %3',
                         req.uuid, req.user.id, req.body.user);
                return done({code: 403, body: 'Not authorized to create objects for another user'});
            }
        }
        
        if (self._orgProp) {
            if (!req.body.org) {
                req.body.org = req.user.org;
            } else if (req.body.org !== req.user.org &&
                       req.user.permissions[self.objName].create !== Scope.All) {
                log.info('[%1] User %2 attempting to create object for org %3',
                         req.uuid, req.user.id, req.body.org);
                return done({code: 403, body: 'Not authorized to create objects for another org'});
            }
        }

        req.body = mongoUtils.escapeKeys(req.body);
        next();
    };
    
    /**
     * Retrieve an existing object with id == req.params.id, and perform some basic checks on it.
     * Meant to be used for edit and delete actions.
     */
    CrudSvc.prototype.checkExisting = function(action, req, next, done) {
        var self = this,
            id = req.params.id,
            log = logger.getLog();
            
        return q.npost(self._coll, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist', req.uuid, id);
                return done(action === 'delete' ? { code: 204 }
                                                : { code: 404, body: 'That does not exist' });
            }
            
            if (!self.checkScope(req.user, orig, action)) {
                log.info('[%1] User %2 is not authorized to %3 %4',req.uuid,req.user.id,action,id);
                return done({code: 403, body: 'Not authorized to ' + action + ' this'});
            }
            
            req.origObj = orig;
            next();
        });
    };
    
    // Prevent non-admin users from retrieving all objects; should be used as middleware
    CrudSvc.prototype.preventGetAll = function(req, next, done) {
        var log = logger.getLog(),
            self = this;
        
        if ( (!Object.keys(req._query).length) &&
             !(req.user.permissions &&
               req.user.permissions[self.objName] &&
               req.user.permissions[self.objName].read &&
               req.user.permissions[self.objName].read === Scope.All)) {
            log.info('[%1] User %2 is not authorized to read all %3',
                     req.uuid, req.user.id, self.objName);
            return done({code: 403, body: 'Not authorized to read all ' + self.objName});
        }
        next();
    };
    
    // TODO: comment and test
    CrudSvc.prototype.validateUniqueProp = function(field, regex, req, next, done) {
        var log = logger.getLog(),
            query = {},
            self = this;
            
        if (!req.body[field]) {
            return q(next());
        }
        
        if (regex && !req.body[field].match(regex)) {
            log.info('[%1] User %2 trying to create object with invalid %3: %4',
                     req.uuid, req.user.id, field, req.body[field]);
            return q(done({code: 400, body: 'Invalid ' + field}));
        }
        
        query[field] = req.body[field];
        if (req.params && req.params.id) { // for PUTs, exclude this object in search for existing
            query.id = { $ne: req.params.id };
        }
            
        return q.npost(self._coll, 'findOne', [query]).then(function(cat) {
            if (cat) {
                log.info('[%1] Object %2 already has %3 %4',req.uuid,cat.id,field,req.body[field]);
                return done({code: 409, body: 'An object with that ' + field + ' already exists'});
            }
            
            next();
        });
    };
    

    /**
     * Retrieve objects using the query, as well as limit, skip, and sort options in req.query.
     * if multiGet is true, this will return a pagination object in the resp that can be used to 
     * construct a Content-Range header.
     */
    CrudSvc.prototype.getObjs = function(query, req, multiGet) {
        var self = this,
            limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog(),
            deferred = q.defer();
        req._query = query || {};

        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }

        self.runMiddleware(req, 'read', function() {
            log.info('[%1] User %2 getting %3 with query %4, sort %5, limit %6, skip %7', req.uuid,
                     req.user.id, self.objName, JSON.stringify(req._query), JSON.stringify(sortObj),
                     limit, skip);

            var permQuery = self.userPermQuery(req._query, req.user),
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

                if (multiGet) {
                    resp.code = 200;
                    resp.body = objList;
                } else {
                    resp.code = objList.length > 0 ? 200 : 404;
                    resp.body = objList.length > 0 ? objList[0] : 'Object not found';
                }
                deferred.resolve(resp);
            })
            .catch(function(err) {
                log.error('[%1] Error getting %2: %3',req.uuid,self.objName,err&&err.stack || err);
                deferred.reject(err);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing find', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for find: %2',
                      req.uuid, err && err.stack || err);
            deferred.reject(err);
        });
        
        return deferred.promise;
    };

    /**
     * Create a new object. By default, this will call createValidator.midWare and setupObj as 
     * middleware.
     */
    CrudSvc.prototype.createObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();

        self.runMiddleware(req, 'create', function() {
            log.trace('[%1] User %2 is creating %3', req.uuid, req.user.id, req.body.id);
            
            q.npost(self._coll, 'insert', [req.body, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully created %3',req.uuid,req.user.id,req.body.id);
                deferred.resolve({ code: 201, body: self.formatOutput(req.body) });
            })
            .catch(function(err) {
                log.error('[%1] Failed doing create: %2', req.uuid, err && err.stack || err);
                deferred.reject(err);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing create', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for create: %2',
                      req.uuid, err && err.stack || err);
            deferred.reject(err);
        });
        
        return deferred.promise;
    };
    
    /**
     * Edit an existing object. By default, this will call editValidator.midWare and checkExisting
     * as middleware.
     */
    CrudSvc.prototype.editObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();
            
        self.runMiddleware(req, 'edit', function() {
            if (req.origObj.status === Status.Deleted) {
                log.info('[%1] User %2 trying to update deleted object %3',
                         req.uuid, req.user.id, req.params.id);
                return deferred.resolve({code: 404, body: 'That does not exist'});
            }
        
            req.body.lastUpdated = new Date();
            var updateObj = { $set: mongoUtils.escapeKeys(req.body) },
                opts = {w: 1, journal: true, new: true};

            q.npost(self._coll, 'findAndModify', [{id: req.params.id}, {id: 1}, updateObj, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated %3', req.uuid, req.user.id, updated.id);
                deferred.resolve({code: 200, body: self.formatOutput(updated) });
            })
            .catch(function(err) {
                log.error('[%1] Failed doing update: %2', req.uuid, err && err.stack || err);
                deferred.reject(err);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing update', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for edit: %2',
                      req.uuid, err && err.stack || err);
            deferred.reject(err);
        });
        
        return deferred.promise;
    };
    
    // Delete an existing object. By default, this will call checkExisting as middleware.
    CrudSvc.prototype.deleteObj = function(req) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();
        
        self.runMiddleware(req, 'delete', function() {
            if (req.origObj.status === Status.Deleted) {
                log.info('[%1] Object %2 has already been deleted', req.uuid, req.params.id);
                return deferred.resolve({code: 204});
            }

            var updates = { $set: { lastUpdated: new Date(), status: Status.Deleted } };
            q.npost(self._coll, 'update', [{id: req.params.id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted %3',req.uuid,req.user.id,req.params.id);
                deferred.resolve({code: 204});
            })
            .catch(function(err) {
                log.error('[%1] Failed doing delete: %2', req.uuid, err && err.stack || err);
                deferred.reject(err);
            });
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing delete', req.uuid);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for delete: %2',
                      req.uuid, err && err.stack || err);
            deferred.reject(err);
        });
        
        return deferred.promise;
    };
    
    module.exports = CrudSvc;
}());
