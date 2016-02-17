(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        urlUtils        = require('url'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        objUtils        = require('../lib/objUtils'),
        FieldValidator  = require('../lib/fieldValidator'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Access          = enums.Access,
        Scope           = enums.Scope,

        expModule = { brandCache: {} };

    // Find and parse the origin, storing useful properties on the request
    expModule.parseOrigin = function(req, siteExceptions) {
        req.origin = req.headers && (req.headers.origin || req.headers.referer) || '';
        req.originHost = req.origin && String(urlUtils.parse(req.origin).hostname) || '';
        req.isC6Origin = (req.origin && req.origin.match(/(cinema6|reelcontent)\.com/) || false) &&
                         !siteExceptions.public.some(function(s) { return req.originHost === s;}) ||
                         siteExceptions.cinema6.some(function(s) { return req.originHost === s;});
    };

    expModule.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            user:   FieldValidator.userFunc('experiences', 'create'),
            org:    FieldValidator.orgFunc('experiences', 'create')
        }
    });

    expModule.updateValidator = new FieldValidator({
        forbidden: ['id', 'created', '_id'],
        condForbidden: {
            user:   FieldValidator.userFunc('experiences', 'edit'),
            org:    FieldValidator.orgFunc('experiences', 'edit')
        }
    });

    expModule.formatOutput = function(experience, isGuest) {
        var log = logger.getLog(),
            privateFields = ['user', 'org'],
            newExp = {};
        
        for (var key in experience) {
            if (key === 'data') {
                if (!(experience.data instanceof Array)) {
                    log.warn('Experience %1 does not have array of data, not getting most recent',
                             experience.id);
                    newExp.data = experience.data;
                } else {
                    newExp.data = experience.data[0].data;
                    newExp.versionId = experience.data[0].versionId;
                }
                if (newExp.data.title) {
                    newExp.title = newExp.data.title;
                }
            } else if (key === 'status') {
                if (!(experience.status instanceof Array)) {
                    log.warn('Experience %1 does not have status array, not getting most recent',
                             experience.id);
                    newExp.status = experience.status;
                } else {
                    newExp.status = experience.status[0].status;
                    newExp.lastStatusChange = experience.status[0].date;
                    // Remove lastPublished when frontend stops using it
                    newExp.lastPublished = experience.status[0].date;
                }
            } else if (key !== '_id' && !(isGuest && privateFields.indexOf(key) >= 0)) {
                newExp[key] = experience[key];
            }
        }
        return mongoUtils.unescapeKeys(newExp);
    };

    // Check whether the user can operate on the experience according to their scope
    expModule.checkScope = function(user, experience, object, verb) {
        return !!(user && user.permissions && user.permissions[object] &&
                  user.permissions[object][verb] &&
             (user.permissions[object][verb] === Scope.All ||
             (user.permissions[object][verb] === Scope.Org && (user.org === experience.org ||
                                                               user.id === experience.user)) ||
             (user.permissions[object][verb] === Scope.Own && user.id === experience.user) ));
    };

    // Check whether a user can retrieve an experience
    expModule.canGetExperience = function(exp, user, isC6Origin) {
        user = user || {};

        return exp.status !== Status.Deleted &&
               !!( (exp.status === Status.Active && !isC6Origin)                    ||
                   (exp.access === Access.Public && isC6Origin)                     ||
                   expModule.checkScope(user, exp, 'experiences', 'read')             ||
                   (user.applications && user.applications.indexOf(exp.id) >= 0)    );
    };

    /* Adds fields to a find query to filter out experiences the user can't see, effectively
     * replicating the logic of canGetExperience through the query */
    expModule.userPermQuery = function(query, user, isC6Origin) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            readScope = user.permissions.experiences.read,
            log = logger.getLog(),
            orClause;

        if (!newQuery['status.0.status']) {
            newQuery['status.0.status'] = {$ne: Status.Deleted}; // never show deleted exps
        }

        if (!Scope.isScope(readScope)) {
            log.warn('User has invalid scope ' + readScope);
            readScope = Scope.Own;
        }

        if (readScope === Scope.Own) {
            orClause = { $or: [ { user: user.id } ] };
        } else if (readScope === Scope.Org) {
            orClause = { $or: [ { org: user.org }, { user: user.id } ] };
        }

        if (!!orClause) { // additional conditions where non-admins may be able to get exps
            if (isC6Origin) {
                orClause.$or.push({ access: Access.Public });
            } else {
                orClause.$or.push({ 'status.0.status': Status.Active });
            }
            if (user.applications && user.applications instanceof Array) {
                orClause.$or.push({ id: { $in: user.applications } });
            }
        }
        
        mongoUtils.mergeORQuery(newQuery, orClause);

        return newQuery;
    };
    
    // Format a 'text' query. Currently, turns this into a regex search on the title field.
    expModule.formatTextQuery = function(query) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            textParts = newQuery.text.trim().split(/\s+/);
            
        newQuery['data.0.data.title'] = {$regex: '.*' + textParts.join('.*') + '.*', $options: 'i'};
        delete newQuery.text;
        return newQuery;
    };
    
    /* Swap the placeholder in the exp deck at position idx with the appropriate card, retrieved
     * from the cardSvc. */
    expModule.swapCard = function(cardSvc, camp, exp, idx, req) {
        var log = logger.getLog(),
            oldId = exp.data.deck[idx].id,
            newId = camp.staticCardMap[exp.id][oldId];
        
        log.trace('[%1] Swapping card %2 for placeholder %3 in experience %4',
                  req.uuid, newId, oldId, exp.id);
        
        return cardSvc.getPublicCard(newId, req)
        .then(function(newCard) {
            if (!newCard) {
                log.warn('[%1] Could not retrieve card %2 for experience %3',
                         req.uuid, newId, exp.id);
                return q();
            } else {
                exp.data.deck[idx] = newCard;
            }
        });
    };
    
    /* Look up campaign by campId. If it has staticCardPlacements for this exp, look up those cards
     * and insert them in the appropriate slots */
    expModule.handleCampaign = function(cardSvc, campCache, campId, exp, req) {
        var log = logger.getLog();
        
        if (!campId) {
            return q(exp);
        }
        if (!exp.data || !exp.data.deck || !exp.data.deck.length) {
            log.info('[%1] Experience %2 has no cards', req.uuid, exp.id);
            return q(exp);
        }
        
        return campCache.getPromise({ id: String(campId) }).then(function(results) {
            var camp = results[0];

            if (!camp) {
                log.warn('[%1] Campaign %2 not found', req.uuid, campId);
                return q();
            }

            // don't use campaign if it's deleted
            if (camp.status === Status.Deleted) {
                log.info('[%1] Not using deleted campaign %2', req.uuid, camp.id);
                return q();
            }
            
            var mapping = camp.staticCardMap && camp.staticCardMap[exp.id];
            if (!mapping || Object.keys(mapping).length === 0) {
                log.trace('[%1] No static mapping for %2 in %3', req.uuid, exp.id, camp.id);
                return q();
            }
            
            return q.all(exp.data.deck.map(function(card, idx) {
                if (!mapping[card.id]) {
                    return q();
                }

                return expModule.swapCard(cardSvc, camp, exp, idx, req);
            }));
        })
        .thenResolve(exp);
    };

    expModule.getPublicExp = function(cardSvc, caches, config, id, req) {
        var log = logger.getLog(),
            qps = req.query,
            defaultCfg = config.defaultSiteConfig,
            query = { id: id };

        log.info('[%1] Guest user trying to get experience %2', req.uuid, id);

        return caches.experiences.getPromise(query).spread(function(experience) {
            if (!experience) {
                return q({ code: 404, body: 'Experience not found' });
            }
            var exp = expModule.formatOutput(experience, true);
            if (!expModule.canGetExperience(exp, null, req.isC6Origin)) {
                return q({ code: 404, body: 'Experience not found' });
            }

            log.info('[%1] Retrieved experience %2', req.uuid, id);

            exp.data = exp.data || {};
            exp.data.campaign = exp.data.campaign || {};
            exp.data.branding = exp.data.branding || qps.branding || defaultCfg.branding;

            return expModule.handleCampaign(cardSvc, caches.campaigns, qps.campaign, exp, req)
            .then(function(exp) {
                return q({ code: 200, body: exp });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error getting experience %2: %3', req.uuid, id, error);
            return q.reject(error);
        });
    };

    expModule.getExperiences = function(query, req, experiences, multiGet) {
        var limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            fields = req.query && req.query.fields && String(req.query.fields),
            fieldsObj = {},
            sortObj = {},
            resp = {},
            log = logger.getLog();
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
                if (/^data/.test(field)) {
                    fieldsObj['data.' + field] = 1;
                } else {
                    fieldsObj[field] = 1;
                }
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
        
        if (query.id instanceof Array) {
            query.id = {$in: query.id};
        }
        if (query.categories instanceof Array) {
            query.categories = {$in: query.categories};
        }
        if (query.sponsored !== undefined) {
            query.campaignId = query.sponsored ? {$exists: true} : {$exists: false};
            delete query.sponsored;
        }
        
        if (query.status) {
            if (query.status === Status.Deleted) {
                log.warn('[%1] User %2 attempting to get deleted experiences',req.uuid,req.user.id);
                return q({code: 400, body: 'Cannot get deleted experiences'});
            }
            query['status.0.status'] = query.status;
            delete query.status;
        }
        if (query.text) {
            query = expModule.formatTextQuery(query);
        }

        log.info('[%1] User %2 getting experiences with %3, sort %4, limit %5, skip %6, fields %7',
                 req.uuid, req.user.id, JSON.stringify(query), JSON.stringify(sortObj), limit, skip,
                 JSON.stringify(fieldsObj));

        var permQuery = expModule.userPermQuery(query, req.user, req.isC6Origin),
            opts = { sort: sortObj, limit: limit, skip: skip, fields: fieldsObj },
            cursor;

        log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));

        if (permQuery.user) {
            opts.hint = { user: 1 }; // These hints ensure mongo uses indices wisely when searching
        } else if (permQuery.org) {
            opts.hint = { org: 1 };
        }

        cursor = experiences.find(permQuery, opts);

        return (multiGet ? q(cursor.count()) : q())
        .then(function(count) {
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
            var exps = results.map(function(exp) {
                return expModule.formatOutput(exp, false);
            });

            log.info('[%1] Showing the user %2 experiences', req.uuid, exps.length);

            if (multiGet) {
                resp.code = 200;
                resp.body = exps;
            } else {
                resp.code = exps.length > 0 ? 200 : 404;
                resp.body = exps.length > 0 ? exps[0] : 'Experience not found';
            }
            return q(resp);
        })
        .catch(function(error) {
            log.error('[%1] Error getting experiences: %2', req.uuid, error);
            return q.reject(error);
        });
    };


    expModule.createExperience = function(req, experiences) {
        var obj = req.body,
            user = req.user,
            log = logger.getLog(),
            now = new Date();

        if (!obj || typeof obj !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        if (!expModule.createValidator.validate(obj, {}, user)) {
            log.warn('[%1] experience contains illegal fields', req.uuid);
            log.trace('exp: %1  |  requester: %2', JSON.stringify(obj), JSON.stringify(user));
            return q({code: 400, body: 'Invalid request body'});
        }

        obj.id = 'e-' + uuid.createUuid().substr(0,14);
        log.trace('[%1] User %2 is creating experience %3', req.uuid, user.id, obj.id);

        delete obj.versionId; // only allow these properties to be set in the data
        delete obj.title;
        delete obj.lastPublished;
        delete obj.lastStatusChange;

        obj.created = now;
        obj.lastUpdated = now;
        if (!obj.user) {
            obj.user = user.id;
        }
        if (!obj.org) {
            obj.org = user.org;
        }
        if (!obj.status) {
            obj.status = Status.Pending;
        }
        obj.status = [ { user: user.email, userId: user.id, date: now, status: obj.status } ];
        if (!obj.access) {
            obj.access = Access.Public;
        }
        obj.data = obj.data || {};

        var versionId = uuid.hashText(JSON.stringify(obj.data)).substr(0, 8);
        obj.data = [ { user: user.email, userId: user.id, date: now,
                       data: obj.data, versionId: versionId } ];

        return mongoUtils.createObject(experiences, obj)
        .then(function(exp) {
            return q({ code: 201, body: expModule.formatOutput(exp) });
        });
    };

    // Format updates to an experience; trimming virtual props & formatting data + status arrays
    expModule.formatUpdates = function(req, orig, updates, user) {
        var log = logger.getLog(),
            now = new Date();

        // don't allow client to set virtual props (which are copied from elsewhere)
        delete updates.title;
        delete updates.versionId;
        delete updates.lastPublished;
        delete updates.lastStatusChange;

        if (!(orig.data instanceof Array)) {
            log.warn('[%1] Original exp %2 does not have an array of data', req.uuid, orig.id);
            orig.data = [{}];
        }
        if (!(orig.status instanceof Array)) {
            log.warn('[%1] Original exp %2 does not have an array of statuses', req.uuid, orig.id);
            orig.status = [{user:user.email,userId:user.id,date:orig.created,status:orig.status}];
        }

        if (updates.data) {
            if (!objUtils.compareObjects(orig.data[0].data, updates.data)) {
                var versionId = uuid.hashText(JSON.stringify(updates.data)).substr(0, 8),
                    dataWrapper = { user: user.email, userId: user.id, date: now,
                                    data: updates.data, versionId: versionId };
                updates.data = [ dataWrapper ];
            } else {
                delete updates.data;
            }
        }

        if (updates.status) {
            if (updates.status !== orig.status[0].status) {
                var statWrapper = {user:user.email,userId:user.id,date:now,status:updates.status};
                orig.status.unshift(statWrapper);
                updates.status = orig.status;
            } else {
                delete updates.status;
            }
        }

        updates.lastUpdated = now;
        return mongoUtils.escapeKeys(updates);
    };

    expModule.updateExperience = function(req, experiences) {
        var updates = req.body,
            id = req.params.id,
            user = req.user,
            log = logger.getLog();

        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }

        log.info('[%1] User %2 is attempting to update experience %3',req.uuid,user.id,id);
        return mongoUtils.findObject(experiences, { id: id })
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist; not creating it', req.uuid, id);
                return q({
                    code: 404,
                    body: 'That experience does not exist'
                });
            }
            if (orig.status && orig.status[0] && orig.status[0].status === Status.Deleted) {
                log.info('[%1] User %2 trying to update deleted experience %3',req.uuid,user.id,id);
                return q({
                    code: 404,
                    body: 'That experience does not exist'
                });
            }
            if (!expModule.updateValidator.validate(updates, orig, user)) {
                log.warn('[%1] updates contain illegal fields', req.uuid);
                log.trace('exp: %1  |  orig: %2  |  requester: %3',
                          JSON.stringify(updates), JSON.stringify(orig), JSON.stringify(user));
                return q({
                    code: 400,
                    body: 'Invalid request body'
                });
            }
            if (!expModule.checkScope(user, orig, 'experiences', 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
                return q({
                    code: 403,
                    body: 'Not authorized to edit this experience'
                });
            }

            updates = expModule.formatUpdates(req, orig, updates, user);
            
            return mongoUtils.editObject(experiences, updates, id)
            .then(function(updated) {
                return q({ code: 200, body: expModule.formatOutput(updated) });
            });
        })
        .catch(function(error) {
            log.error('[%1] Error updating experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            return q.reject(error);
        });
    };

    expModule.deleteExperience = function(req, experiences) {
        var id = req.params.id,
            user = req.user,
            log = logger.getLog();

        log.info('[%1] User %2 is attempting to delete experience %3', req.uuid, user.id, id);

        return mongoUtils.findObject(experiences, { id: id })
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist', req.uuid, id);
                return q({code: 204});
            }
            if (!expModule.checkScope(user, orig, 'experiences', 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return q({
                    code: 403,
                    body: 'Not authorized to delete this experience'
                });
            }

            if (orig.status[0] && orig.status[0].status === Status.Deleted) {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return q({ code: 204 });
            }

            var updates = { status: Status.Deleted };
            expModule.formatUpdates(req, orig, updates, user);

            return mongoUtils.editObject(experiences, updates, id)
            .then(function(/*updated*/) {
                return q({ code: 204 });
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            return q.reject(error);
        });
    };
    
    // Handle requests for experiences from /api/public/content/experience/:id endpoints
    expModule.handlePublicGet = function(req, res, caches, cardSvc, config) {
        return expModule.getPublicExp(cardSvc, caches, config, req.params.id, req)
        .then(function(resp) {
            // don't cache for requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
            }
            
            if (resp.code < 200 || resp.code >= 300) {
                return q(resp);
            }
            
            // if ext === 'js', return exp as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({
                    code: resp.code,
                    body: 'module.exports = ' + JSON.stringify(resp.body) + ';'
                });
            } else {
                return q(resp);
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving content', detail: error }});
        });
    };

    expModule.setupEndpoints = function(app, expColl, caches, cardSvc, config,
                                        sessions, audit, jobManager) {

        var log = logger.getLog();
        
        // Public get exp; regex at end allows client to optionally specify extension (js|json)
        app.get('/api/public/content/experiences?/:id([^.]+).?:ext?', function(req, res) {
            expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });
        

        // Setup router for non-public card endpoints
        var router      = express.Router(),
            mountPath   = '/api/content/experiences?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authMidware = authUtils.objMidware('experiences', {});
        
        // private get experience by id
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var query = { id: req.params.id },
                promise = expModule.getExperiences(query, req, expColl);

            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving content', detail: error });
                });
            });
        });

        // private get experience by query
        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }
            if ('categories' in req.query) {
                query.categories = String(req.query.categories).split(',');
            }
            if (req.query.sponsored) {
                query.sponsored = req.query.sponsored === 'true' ? true : false;
            }
            ['user', 'org', 'type', 'status', 'text']
            .forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if (!Object.keys(query).length) {
                log.info('[%1] Cannot GET /content/experiences with no query params',req.uuid);
                return jobManager.endJob(req, res, q({
                    code: 400,
                    body: 'Must specify at least one supported query param'
                }).inspect());
            }

            var promise = expModule.getExperiences(query, req, expColl, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving content', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = expModule.createExperience(req, expColl);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating experience', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = expModule.updateExperience(req, expColl);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating experience', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = expModule.deleteExperience(req, expColl);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting experience', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = expModule;
}());
