(function(){
    'use strict';

    var q               = require('q'),
        uuid            = require('./uuid'),
        mongoUtils      = require('./mongoUtils'),
        logger          = require('./logger'),
        FieldValidator  = require('./fieldValidator'),
        Model           = require('./model'),
        enums           = require('./enums'),
        Scope           = enums.Scope,
        Status          = enums.Status;

    /**
     * Create a generalized CRUD service, with methods for retrieving, creating, editing, and
     * deleting objects. coll should be a mongo collection, and prefix the one letter prefix for the
     * object ids.
     * schema is an object that will be passed as the second arg to new Model().
     * opts is an optional hash of options, including these options:
     *  - objName: name of the objects in user permissions (default: collection name)
     *  - userProp: if true, the user property will be set on new objects (default: true)
     *  - orgProp: if true, the org prop will be set on new objects (default: true)
     *  - allowPublic: if true, 'active' objects will be retrievable by anyone (default: false)
     *  - statusHistory: if true, will manage a `statusHistory` prop on the object (default: false)
     *  - ownedByUser: if false, the 'own' scope will allow actions on an object if the requester
     *      belongs to the object, rather than if the requester owns the object (defaults to true)
     */
    function CrudSvc(coll, prefix, opts, schema) {
        opts = opts || {};

        var self = this;
        self._coll = coll;
        self._prefix = prefix;
        self.objName = opts.objName || coll.collectionName;
        self._userProp = opts.userProp !== undefined ? opts.userProp : true;
        self._orgProp = opts.orgProp !== undefined ? opts.orgProp : true;
        self._allowPublic = opts.allowPublic !== undefined ? opts.allowPublic : false;
        self._ownedByUser = opts.ownedByUser !== undefined ? opts.ownedByUser : true;

        self._middleware = {
            read   : [],
            create : [],
            edit   : [self.checkExisting.bind(self, 'edit')],
            delete : [self.checkExisting.bind(self, 'delete')]
        };

        // eventually should always use schema; but for now allow defaulting to fieldValidator
        if (schema) {
            schema.id = {
                __allowed: false,
                __type: 'string',
                __locked: true
            };
            schema._id = {
                __allowed: false,
                __locked: true
            };
            schema.created = {
                __allowed: false,
                __type: 'Date',
                __locked: true
            };
            schema.lastUpdated = {
                __allowed: false,
                __type: 'Date',
                __locked: true
            };

            self.model = new Model(self.objName, schema);
            self.use('create', self.model.midWare.bind(self.model, 'create'));
            self.use('edit', self.model.midWare.bind(self.model, 'edit'));
        }
        else {
            self.createValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });
            self.editValidator = new FieldValidator({ forbidden: ['id', 'created', '_id'] });

            self.use('create', self.createValidator.midWare.bind(self.createValidator));
            self.use('edit', self.editValidator.midWare.bind(self.editValidator));
        }

        self.use('create', self.setupObj.bind(self));

        if (self._userProp) {
            if (self.model) {
                self.model.schema.user = {
                    __allowed: false,
                    __type: 'string'
                };
            } else {
                self.createValidator._condForbidden.user = FieldValidator.userFunc(
                    self.objName,
                    'create'
                );
                self.editValidator._condForbidden.user = FieldValidator.userFunc(
                    self.objName,
                    'edit'
                );
            }
        }

        if (self._orgProp) {
            if (self.model) {
                self.model.schema.org = {
                    __allowed: false,
                    __type: 'string'
                };
            } else {
                self.createValidator._condForbidden.org = FieldValidator.orgFunc(
                    self.objName,
                    'create'
                );
                self.editValidator._condForbidden.org = FieldValidator.orgFunc(
                    self.objName,
                    'edit'
                );
            }
        }

        if (opts.statusHistory) {
            if (self.model) {
                self.model.schema.statusHistory = {
                    __allowed: false,
                    __type: 'objectArray',
                    __locked: true
                };
            } else {
                self.createValidator._forbidden.push('statusHistory');
                self.editValidator._forbidden.push('statusHistory');
            }

            self.use('create', self.handleStatusHistory);
            self.use('edit', self.handleStatusHistory);
            self.use('delete', self.handleStatusHistory);
        }
    }
    
    // Helper function to return the singular version of the service's objName
    CrudSvc.prototype.singularizeName = function() {
        var name = this.objName,
            exceptions = [
                { prefix: /categor/, singular: 'category' },
                { prefix: /polic/, singular: 'policy' }
            ],
            exception;
        
        exceptions.forEach(function(obj) {
            if (obj.prefix.test(name)) {
                exception = obj.singular;
            }
        });
        
        return exception || name.replace(/s$/, '');
    };

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
        if (typeof func !== 'function') {
            throw new Error('Cannot push item of type ' + (typeof func) + ' onto midware stack');
        }
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
        var self = this,
            next = q.defer();

        deferred = deferred || q.defer();
        idx = idx || 0;

        if (!self._middleware[action] || !self._middleware[action][idx]) {
            done();
            return deferred.promise;
        }

        next.promise.then(function() {
            return self.runMiddleware(req, action, done, ++idx, deferred);
        });

        q.fcall(self._middleware[action][idx], req, next.resolve, deferred.resolve)
        .catch(deferred.reject);

        return deferred.promise;
    };


    /**
     * Check if a user has permission to perform the given action (verb) on the object, according
     * to their permissions. Called from checkExisting for the edit and delete functions.
     */
    CrudSvc.prototype.checkScope = function(user, obj, verb) {
        var self = this,
            name = self.objName;

        function matchesUser() {
            return !!self._ownedByUser ? (user.id === obj.user)
                                       : (user[self.singularizeName()] === obj.id);
        }
        function matchesOrg() {
            return user.org === obj.org;
        }
        
        return !!( user && user.permissions && user.permissions[name] &&
                   user.permissions[name][verb] &&
             ( user.permissions[name][verb] === Scope.All ||
              (user.permissions[name][verb] === Scope.Org && (matchesOrg() || matchesUser())) ||
              (user.permissions[name][verb] === Scope.Own && matchesUser() )
             )
        );
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

        if (!newQuery.status) {
            newQuery.status = { $ne: Status.Deleted };
        } else {
            if (!!newQuery.status.$in) {
                if (newQuery.status.$in.indexOf(Status.Deleted) !== -1) {
                    log.warn('Requester querying for deleted %1, trimming filter', self.objName);
                    newQuery.status.$in = newQuery.status.$in.filter(function(status) {
                        return status !== Status.Deleted;
                    });
                }
            } else {
                if (newQuery.status === Status.Deleted) {
                    log.warn('Requester querying for deleted %1, ignoring filter', self.objName);
                    newQuery.status = { $ne: Status.Deleted };
                }
            }
        }

        if (!Scope.isScope(readScope)) {
            log.warn('Requester has invalid scope ' + readScope);
            readScope = Scope.Own;
        }
        
        var orClause;

        if (readScope === Scope.Own || readScope === Scope.Org) {
            if (!!self._ownedByUser) {
                orClause = { $or: [ { user: requester.id } ] };
            } else {
                var parentId = requester[self.singularizeName()];
                orClause = { $or: [ { id: parentId || { $exists: false } } ] };
            }
            if (readScope === Scope.Org) {
                orClause.$or.push({ org: requester.org });
            }
        }
        
        // if the user is not an admin, show active objects if allowed for this service
        if (self._allowPublic && orClause) {
            orClause.$or.push({ status: Status.Active });
        }
        
        mongoUtils.mergeORQuery(newQuery, orClause);

        return newQuery;
    };

    // Format an object for returning to the client.
    CrudSvc.prototype.formatOutput = function(obj) {
        delete obj._id;
        return mongoUtils.unescapeKeys(obj);
    };

    /* Transform documents after they are retrieved from a mongo collection. This should be
     * overridden by a service if it needs to modify any documents from mongo. It will be called
     * anytime a document is fetched from mongo. This method can optionally return a promise.
     */
    CrudSvc.prototype.transformMongoDoc = function(doc) {
        return doc;
    };

    /**
     * Setup a new object, adding id, created, lastUpdated, and status fields to req.body. If
     * self._userProp and self._orgProp are enabled, the service will pay attention to the user and
     * org props: it will default them to the requester's id and org if not defined, and if they are
     * defined on the body, it will return a 403 if the requester is not an admin and the props are
     * different than their own id/org.
     */
    CrudSvc.prototype.setupObj = function(req, next/*, done*/) {
        var self = this,
            now = new Date();

        req.body.id = self._prefix + '-' + uuid.createUuid().substr(0,14);
        req.body.created = now;
        req.body.lastUpdated = now;
        if (!req.body.status) {
            req.body.status = Status.Active;
        }

        if (self._userProp && !req.body.user && req.user) {
            req.body.user = req.user.id;
        }

        if (self._orgProp && !req.body.org && req.user) {
            req.body.org = req.user.org;
        }

        next();
    };

    // Middleware to update/initialize the statusHistory prop when the status is changed.
    CrudSvc.prototype.handleStatusHistory = function(req, next/*, done*/) {
        var orig = req.origObj || {};

        delete req.body.statusHistory;

        if (req.body.status && req.body.status !== orig.status) {
            req.body.statusHistory = orig.statusHistory || [];

            var wrapper = {
                status  : req.body.status,
                userId  : req.user.id,
                user    : req.user.email,
                date    : new Date()
            };

            req.body.statusHistory.unshift(wrapper);
        }

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

        return mongoUtils.findObject(self._coll, { id: id })
        .then(function(orig) {
            if (!orig) { return orig; }

            return self.transformMongoDoc(orig);
        })
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] %2 does not exist', req.uuid, id);
                return done(action === 'delete' ? { code: 204 }
                                                : { code: 404, body: 'That does not exist' });
            }
            if (orig.status === Status.Deleted) {
                log.info('[%1] %2 has been deleted', req.uuid, id);
                return done(action === 'delete' ? { code: 204 }
                                                : { code: 404, body: 'That has been deleted' });
            }

            if (!self.checkScope(req.user, orig, action)) {
                log.info('[%1] User %2 is not authorized to %3 %4',req.uuid,req.user.id,action,id);
                return done({code: 403, body: 'Not authorized to ' + action + ' this'});
            }

            req.origObj = orig;
            next();
        });
    };

    // Make sure req.body[field] matches a regex, and that no other object exists with the same val
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

        return mongoUtils.findObject(self._coll, query).then(function(doc) {
            if (doc) {
                return self.transformMongoDoc(doc);
            }

            return doc;
        }).then(function(doc) {
            if (doc) {
                log.info('[%1] Object %2 already has %3 %4',req.uuid,doc.id,field,req.body[field]);
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
            limit = (req.query && Number(req.query.limit)) || 0,
            skip = (req.query && Number(req.query.skip)) || 0,
            sort = req.query && req.query.sort,
            fields = req.query && req.query.fields && String(req.query.fields),
            fieldsObj = {},
            sortObj = {},
            log = logger.getLog(),
            deferred = q.defer();
        req._query = query || {};

        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.info('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }

        if (fields) {
            var fieldsSplit = fields.split(',');
            fieldsSplit.forEach(function(field) {
                fieldsObj[field] = 1;
            });

            fieldsObj.id = 1; // always show the id
        }

        if (limit < 0) {
            log.info('[%1] Limit %2 is invalid, ignoring', req.uuid, limit);
            limit = 0;
        }
        if (skip < 0) {
            log.info('[%1] Skip %2 is invalid, ignoring', req.uuid, skip);
            skip = 0;
        }

        Object.keys(req._query).forEach(function(key) {
            if (req._query[key] instanceof Array) {
                req._query[key] = { $in: req._query[key] };
            }
        });

        self.runMiddleware(req, 'read', function() {
            log.info('[%1] User %2 getting %3 with query %4, sort %5, limit %6, skip %7, fields %8',
                     req.uuid, req.user.id, self.objName, JSON.stringify(req._query),
                     JSON.stringify(sortObj), limit, skip, JSON.stringify(fieldsObj));

            var permQuery = self.userPermQuery(req._query, req.user),
                cursor = self._coll.find(
                    permQuery,
                    { sort: sortObj, limit: limit, skip: skip, fields: fieldsObj }
                ),
                promise = multiGet ? q(cursor.count()) : q(),
                resp = {};

            log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));

            promise.then(function(count) {
                if (count !== undefined) {
                    var start = count !== 0 ? skip + 1 : 0,
                        end = limit ? Math.min(skip + limit , count) : count;

                    resp.headers = {
                        'content-range': 'items ' + start + '-' + end + '/' + count
                    };
                }
                return q(cursor.toArray());
            })
            .then(function(results) {
                return q.all(results.map(function(result) {
                    return q(self.transformMongoDoc(result))
                        .then(self.formatOutput);
                }));
            }).then(function(results) {
                log.info('[%1] Showing the requester %2 documents', req.uuid, results.length);

                if (multiGet) {
                    resp.code = 200;
                    resp.body = results;
                } else {
                    resp.code = results.length > 0 ? 200 : 404;
                    resp.body = results.length > 0 ? results[0] : 'Object not found';
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
            mongoUtils.createObject(self._coll, req.body)
            .then(self.transformMongoDoc.bind(self))
            .then(function(obj) {
                deferred.resolve({ code: 201, body: self.formatOutput(obj) });
            })
            .catch(deferred.reject);
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
            mongoUtils.editObject(self._coll, req.body, req.params.id)
            .then(self.transformMongoDoc.bind(self))
            .then(function(obj) {
                deferred.resolve({ code: 200, body: self.formatOutput(obj) });
            })
            .catch(deferred.reject);
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

        req.body = { status: Status.Deleted };

        self.runMiddleware(req, 'delete', function() {
            mongoUtils.editObject(self._coll, req.body, req.params.id)
            .then(function(/*obj*/) {
                deferred.resolve({code: 204});
            })
            .catch(deferred.reject);
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
    
    // Retrieve object's schema; if req.query.personalized === true, merge with user's fieldVal
    CrudSvc.prototype.getSchema = function(req) {
        var self = this;
        
        if (!req.user.permissions[self.objName] || !( req.user.permissions[self.objName].create ||
                                                      req.user.permissions[self.objName].edit ) ) {
            return q({ code: 403, body: 'Cannot create or edit ' + self.objName });
        }
        
        if (!self.model) {
            return q({ code: 501, body: 'No schema for ' + self.objName });
        }
        
        if (req.query && req.query.personalized === 'true') {
            return q({ code: 200, body: self.model.personalizeSchema(req.user) });
        } else {
            return q({ code: 200, body: self.model.schema });
        }
    };

    /* Simplifies adding custom methods to extend the CrudSvc framework.
     * Runs the middleware stack for actionName, and on success calls the provided cb. The cb should
     * return a promise, and customMethod will resolve/reject with that promise's value/reason. */
    CrudSvc.prototype.customMethod = function(req, actionName, cb) {
        var self = this,
            deferred = q.defer(),
            log = logger.getLog();

        self.runMiddleware(req, actionName, function() {
            q.fcall(cb)
            .then(deferred.resolve)
            .catch(deferred.reject);
        })
        .then(function(resp) {
            log.info('[%1] Broke out of middleware, not doing %2', req.uuid, actionName);
            deferred.resolve(resp);
        })
        .catch(function(err) {
            log.error('[%1] Failed running middleware for %2: %3',
                      req.uuid, actionName, err && err.stack || err);
            deferred.reject(err);
        });

        return deferred.promise;
    };

    module.exports = CrudSvc;
}());
