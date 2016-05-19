(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        uuid            = require('rc-uuid'),
        logger          = require('./logger'),
        mongoUtils      = require('./mongoUtils'),
        MiddleManager   = require('./middleManager'),
        FieldValidator  = require('./fieldValidator'),
        expressUtils    = require('./expressUtils'),
        requestUtils    = require('./requestUtils'),
        historian       = require('./historian'),
        Model           = require('./model'),
        enums           = require('./enums'),
        Scope           = enums.Scope,
        Status          = enums.Status;

    /**
     * Create a generalized CRUD service, with methods for retrieving, creating, editing, and
     * deleting objects. coll should be a mongo collection, and prefix the one letter prefix for the
     * object ids. This extends the MiddleManager, and so includes its middleware system.
     *
     * schema is an object that will be passed as the second arg to new Model().
     * opts is an optional hash of options, including these options:
     *  - objName: name of the objects in user permissions (default: collection name)
     *  - userProp: if true, the user property will be set on new objects (default: true)
     *  - orgProp: if true, the org prop will be set on new objects (default: true)
     *  - allowPublic: if true, 'active' objects will be retrievable by anyone (default: false)
     *  - statusHistory: if true, will manage a `statusHistory` prop on the object (default: false)
     *  - ownedByUser: if false, the 'own' scope will allow actions on an object if the requester
     *      belongs to the object, rather than if the requester owns the object (defaults to true)
     *  - maxReadLimit: if a number, the limit for getObjs() will be defaulted to this
     */
    function CrudSvc(coll, prefix, opts, schema) {
        MiddleManager.call(this);

        opts = opts || {};

        var self = this;
        self._coll = coll;
        self._prefix = prefix;
        self.objName = opts.objName || coll.collectionName;
        self.maxReadLimit = opts.maxReadLimit || null;
        self._userProp = opts.userProp !== undefined ? opts.userProp : true;
        self._orgProp = opts.orgProp !== undefined ? opts.orgProp : true;
        self._allowPublic = opts.allowPublic !== undefined ? opts.allowPublic : false;
        self._ownedByUser = opts.ownedByUser !== undefined ? opts.ownedByUser : true;

        self.use('edit', self.checkExisting.bind(self, 'edit'));
        self.use('delete', self.checkExisting.bind(self, 'delete'));

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
            var statusHistory = historian.middlewarify('status', 'statusHistory');

            self.use('create', statusHistory);
            self.use('edit', statusHistory);
            self.use('delete', statusHistory);
        }
    }
    
    util.inherits(CrudSvc, MiddleManager);

    /////////////// STATIC METHODS ///////////////

    // Helper function to return the singular version of an objName
    CrudSvc.singularizeName = function(objName) {
        var exceptions = [
                { prefix: /categor/, singular: 'category' },
                { prefix: /polic/, singular: 'policy' }
            ],
            exception;
        
        exceptions.forEach(function(obj) {
            if (obj.prefix.test(objName)) {
                exception = obj.singular;
            }
        });
        
        return exception || objName.replace(/s$/, '');
    };


    /**
     * Check if a user has permission to perform the given action (verb) on the object, according
     * to their permissions. Called from checkExisting for the edit and delete functions.
     */
    CrudSvc.checkScope = function(objName, ownedByUser, req, obj, verb) {
        var prop = CrudSvc.singularizeName(objName),
            requester = req.requester || {};

        function matchUser() {
            return req.user && (!!ownedByUser ? (req.user.id === obj.user)
                                              : (req.user[prop] === obj.id));
        }
        function matchOrg() {
            return req.user && req.user.org === obj.org;
        }
        
        return !!( requester.permissions && requester.permissions[objName] &&
                   requester.permissions[objName][verb] &&
             ( requester.permissions[objName][verb] === Scope.All ||
              (requester.permissions[objName][verb] === Scope.Org && (matchOrg() || matchUser())) ||
              (requester.permissions[objName][verb] === Scope.Own && matchUser() )
             )
        );
    };

    /**
     * Proxy a request to get a related entity from our api, and attach it to the request.
     * opts must contain:
     * - objName: name of collection (e.g. 'campaigns', 'promotions', etc.)
     * - idPath: String referencing nested prop in req where id is (e.g. 'query.org'), or an Array
     *   of fallback choices.
     * 
     * opts may also contain a resultPath prop, which is where this will attach the fetched entity
     * (defaults to req[singular(objName)]
     * apiCfg should be the service's config.api.
     */
    CrudSvc.fetchRelatedEntity = function(opts, apiCfg, req, next, done) {
        if (!opts || !opts.idPath || !opts.objName) {
            throw new Error('Must provide opts.idPath and opts.objName');
        }
        
        apiCfg[opts.objName].baseUrl = apiCfg[opts.objName].baseUrl || urlUtils.resolve(
            apiCfg.root,
            apiCfg[opts.objName].endpoint
        );
        
        var log = logger.getLog(),
            singular = CrudSvc.singularizeName(opts.objName),
            id;
        opts.idPath = (typeof opts.idPath === 'string') ? [ opts.idPath ] : opts.idPath;
        opts.resultPath = opts.resultPath || singular;
            
        opts.idPath.forEach(function(path) {
            id = id || ld.get(req, path, undefined);
        });
        if (!id) {
            log.info('[%1] Could not find an id to fetch %2', req.uuid, opts.objName);
            return done({
                code: 400,
                body: 'Must specify a ' + singular + ' id to fetch'
            });
        }
        id = String(id);

        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(apiCfg[opts.objName].baseUrl, id)
        })
        .then(function(resp) {
            if (resp && resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch %3 %4: %5, %6',
                     req.uuid,
                     req.requester.id,
                     singular,
                     id,
                     resp.response.statusCode,
                     resp.body
                 );
                return done({ code: 400, body: 'Cannot fetch this ' + singular });
            }
            ld.set(req, opts.resultPath, resp.body);
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching %2 %3: %4',
                      req.uuid, singular, id, util.inspect(error));
            return q.reject('Error fetching ' + singular);
        });
    };
    //////////////////////////////////////////////

    /**
     * Instanced version of checkScope above, uses instance settings. Called from checkExisting for
     * the edit and delete functions. Can be overriden elsewhere (e.g. a setupSvc() method) to
     * provide different functionality.
     */
    CrudSvc.prototype.checkScope = function(req, obj, verb) {
        return CrudSvc.checkScope(this.objName, this._ownedByUser, req, obj, verb);
    };

    /**
     * Effectively translates the logic in checkScope into mongo query fields for only retrieving
     * objects that the user can see.
     */
    CrudSvc.prototype.userPermQuery = function(query, req) {
        var self = this,
            newQuery = JSON.parse(JSON.stringify(query)),
            readScope = (req.requester.permissions &&
                         req.requester.permissions[self.objName] || {}).read,
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
                orClause = { $or: [ { user: req.user && req.user.id || '' } ] };
            } else {
                var parentId = (req.user && req.user[CrudSvc.singularizeName(self.objName)]);
                orClause = { $or: [ { id: parentId || { $exists: false } } ] };
            }
            if (readScope === Scope.Org) {
                orClause.$or.push({ org: req.user && req.user.org || '' });
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

        req.body.id = self._prefix + '-' + uuid.createUuid();
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

            if (!self.checkScope(req, orig, action)) {
                log.info('[%1] Requester %2 is not authorized to %3 %4',
                         req.uuid, req.requester.id, action, id);
                return done({ code: 403, body: 'Not authorized to ' + action + ' this' });
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
            log.info('[%1] Requester %2 trying to create object with invalid %3: %4',
                     req.uuid, req.requester.id, field, req.body[field]);
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
            log = logger.getLog();
        req._query = query || {};

        if (!!self.maxReadLimit) {
            limit = (limit <= 0) ? self.maxReadLimit : Math.min(limit, self.maxReadLimit);
        }

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

        return self.runAction(req, 'read', function() {
            var opts = { sort: sortObj, limit: limit, skip: skip, fields: fieldsObj };

            log.info(
                '[%1] Requester %2 getting %3 with query %4, opts: %5',
                req.uuid,
                req.requester.id,
                self.objName,
                JSON.stringify(req._query),
                JSON.stringify(opts)
            );

            var permQuery = self.userPermQuery(req._query, req),
                cursor = self._coll.find(
                    permQuery,
                    opts
                ),
                promise = multiGet ? q(cursor.count()) : q(),
                resp = {};

            log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));

            return promise.then(function(count) {
                if (count !== undefined) {
                    resp.headers = {
                        'content-range': expressUtils.formatContentRange(count, limit, skip)
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
                return q(resp);
            })
            .catch(function(err) {
                log.error('[%1] Error getting %2: %3',req.uuid,self.objName,err&&err.stack || err);
                return q.reject(err);
            });
        });
    };

    // Create a new object. By default, this will call validation middleware and setupObj
    CrudSvc.prototype.createObj = function(req) {
        var self = this;
            
        return self.runAction(req, 'create', function() {
            return mongoUtils.createObject(self._coll, req.body)
            .then(self.transformMongoDoc.bind(self))
            .then(function(obj) {
                return q({ code: 201, body: self.formatOutput(obj) });
            });
        });
    };

    // Edit an existing object. By default, this will call validation and checkExisting middleware.
    CrudSvc.prototype.editObj = function(req) {
        var self = this;

        return self.runAction(req, 'edit', function() {
            return mongoUtils.editObject(self._coll, req.body, req.params.id)
            .then(self.transformMongoDoc.bind(self))
            .then(function(obj) {
                return q({ code: 200, body: self.formatOutput(obj) });
            });
        });
    };

    // Delete an existing object. By default, this will call checkExisting as middleware.
    CrudSvc.prototype.deleteObj = function(req) {
        var self = this;

        req.body = { status: Status.Deleted };

        return self.runAction(req, 'delete', function() {
            return mongoUtils.editObject(self._coll, req.body, req.params.id)
            .then(function(/*obj*/) {
                return q({ code: 204 });
            });
        });
    };
    
    // Retrieve object's schema; if req.query.personalized === true, merge with requester's fieldVal
    CrudSvc.prototype.getSchema = function(req) {
        var self = this,
            perms = req.requester.permissions || {};
        
        if (!perms[self.objName] || !( perms[self.objName].create || perms[self.objName].edit ) ) {
            return q({ code: 403, body: 'Cannot create or edit ' + self.objName });
        }
        
        if (!self.model) {
            return q({ code: 501, body: 'No schema for ' + self.objName });
        }
        
        if (req.query && req.query.personalized === 'true') {
            return q({ code: 200, body: self.model.personalizeSchema(req.requester) });
        } else {
            return q({ code: 200, body: self.model.schema });
        }
    };

    // Simplifies adding custom methods to extend the CrudSvc framework.
    CrudSvc.prototype.customMethod = MiddleManager.prototype.runAction;

    module.exports = CrudSvc;
}());
