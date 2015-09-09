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
        url             = require('url'),
        Status          = enums.Status,
        Access          = enums.Access,
        Scope           = enums.Scope,

        expModule = { brandCache: {} };

    // Find and parse the origin, storing useful properties on the request
    expModule.parseOrigin = function(req, siteExceptions) {
        req.origin = req.headers && (req.headers.origin || req.headers.referer) || '';
        req.originHost = req.origin && String(urlUtils.parse(req.origin).hostname) || '';
        req.isC6Origin = (req.origin && req.origin.match('cinema6.com') || false) &&
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
            log = logger.getLog();

        if (!newQuery['status.0.status']) {
            newQuery['status.0.status'] = {$ne: Status.Deleted}; // never show deleted exps
        }

        if (!Scope.isScope(readScope)) {
            log.warn('User has invalid scope ' + readScope);
            readScope = Scope.Own;
        }

        if (readScope === Scope.Own) {
            newQuery.$or = [ { user: user.id } ];
        } else if (readScope === Scope.Org) {
            newQuery.$or = [ { org: user.org }, { user: user.id } ];
        }

        if (newQuery.$or) { // additional conditions where non-admins may be able to get exps
            if (isC6Origin) {
                newQuery.$or.push({access: Access.Public});
            } else {
                newQuery.$or.push({'status.0.status': Status.Active});
            }
            if (user.applications && user.applications instanceof Array) {
                newQuery.$or.push({id: {$in: user.applications}});
            }
        }

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

    // Ensure experience has adConfig, getting from its org if necessary
    expModule.getAdConfig = function(exp, orgId, orgCache) {
        var log = logger.getLog();

        if (!exp.data) {
            log.warn('Experience %1 does not have data!', exp.id);
            return q(exp);
        }
        if (exp.data.adConfig) {
            return q(exp);
        }
        return orgCache.getPromise({id: orgId}).then(function(results) {
            if (results.length === 0 || results[0].status !== Status.Active) {
                log.warn('Org %1 not found', orgId);
            } else if (!results[0].adConfig) {
                log.info('Neither experience %1 nor org %2 have adConfig', exp.id, orgId);
            } else {
                exp.data.adConfig = results[0].adConfig;
            }
            return q(exp);
        });
    };

    /* Build a mongo query for a site by host. This transforms the host 'foo.bar.baz.com' into a 
     * query for sites with host 'foo.bar.baz.com', 'bar.baz.com', or 'baz.com' */
    expModule.buildHostQuery = function(host, container) {
        if (container === 'veeseo' || container === 'connatix') {
            return { host: 'cinema6.com' };
        }
        if (!host) {
            return null;
        }
        var query = { host: { $in: [] } };
        do {
            query.host.$in.push(host);
            host = host.substring(host.search(/\./) + 1);
        } while (!!host.match(/\./));
        return query;
    };

    /* Choose a site to return from a list of multiple sites with similar hostnames. It returns an
     * active site with the longest host, which will be the closest match to the request host */
    expModule.chooseSite = function(results) {
        return results.reduce(function(prev, curr) {
            if (!curr || !curr.host || curr.status !== Status.Active) {
                return prev;
            }
            if (prev && prev.host && prev.host.length > curr.host.length) {
                return prev;
            }
            return curr;
        }, null);
    };
    
    /* Chooses a branding string from a csv list of brandings. Chooses the next string for each call
     * with the same brandString, using expModule.brandCache to keep track of the indexes */
    expModule.chooseBranding = function(brandString, prefix, expId) {
        if (!brandString || !brandString.match(/(\w+,)+\w+/)) {
            return brandString;
        }

        var log         = logger.getLog(),
            brands      = brandString.split(','),
            key         = prefix + ':' + brandString,
            idx         = expModule.brandCache[key] || 0,
            selected    = brands[idx];
            
        log.info('Selected brand %1, idx %2, from %3 for %4', selected, idx, key, expId);

        expModule.brandCache[key] = (++idx >= brands.length) ? 0 : idx;
        return selected;
    };

    // Ensure experience has branding and placements, getting from current site or org if necessary
    expModule.getSiteConfig = function(exp, orgId, qps, host, siteCache, orgCache, defaults) {
        var log = logger.getLog(),
            props = ['branding', 'placementId', 'wildCardPlacement'],
            siteQuery;
        qps = qps || {};
        host = qps.pageUrl ? url.parse(qps.pageUrl).host || qps.pageUrl : host;

        function setProps(exp, obj, src) {
            exp.data.placementId = exp.data.placementId || obj.placementId;
            exp.data.wildCardPlacement = exp.data.wildCardPlacement || obj.wildCardPlacement;
            exp.data.branding = exp.data.branding ||
                                expModule.chooseBranding(obj.branding, src, exp.id);
        }

        if (!exp.data) {
            log.warn('Experience %1 does not have data!', exp.id);
            return q(exp);
        }
        
        exp.data.branding = expModule.chooseBranding(exp.data.branding, exp.id, exp.id);
        setProps(exp, qps, 'queryParams', exp.id);
        if (props.every(function(prop) { return !!exp.data[prop]; })) {
            return q(exp);
        }

        siteQuery = expModule.buildHostQuery(host, qps.container);

        return ( !!siteQuery ? siteCache.getPromise(siteQuery) : q([]) ).then(function(results) {
            var site = expModule.chooseSite(results);
            if (!site) {
                if (!!host) {
                    log.info('Site %1 not found', host);
                }
            } else {
                var container = (site.containers || []).filter(function(cont) {
                    return cont.id === qps.container;
                })[0];
                
                if (container) {
                    exp.data.placementId = exp.data.placementId || container.displayPlacementId;
                    exp.data.wildCardPlacement = exp.data.wildCardPlacement ||
                                                 container.contentPlacementId;
                } else {
                    if (!!qps.container && !!site.containers) {
                        log.warn('Container %1 not found for %2', qps.container, host);
                    }
                }
                setProps(exp, site, site.id, exp.id);
            }
            if (exp.data.branding) {
                return q();
            }
            return orgCache.getPromise({id: orgId});
        }).then(function(results) {
            if (results && results.length !== 0 && results[0].status === Status.Active) {
                setProps(exp, results[0], results[0].id, exp.id);
            }
            setProps(exp, defaults, 'default', exp.id);
            return q(exp);
        });
    };
    
    /* Swap the placeholder in the exp deck at position idx with the appropriate card, retrieved
     * from the cardSvc. Also attaches the new card's adtechId from the camp's cards list */
    expModule.swapCard = function(req, exp, idx, camp, cardSvc) {
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
    expModule.handleCampaign = function(req, exp, campId, campCache, cardSvc) {
        var log = logger.getLog();
        
        if (!campId) {
            return q(exp);
        }
        if (!exp.data || !exp.data.deck || !exp.data.deck.length) {
            log.info('[%1] Experience %2 has no cards', req.uuid, exp.id);
            return q(exp);
        }
        
        return campCache.getPromise({id: String(campId)}).then(function(results) {
            var camp = results[0];
            if (!camp || camp.status !== Status.Active) {
                log.warn('[%1] Campaign %2 not found', req.uuid, campId);
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

                return expModule.swapCard(req, exp, idx, camp, cardSvc);
            }));
        })
        .thenResolve(exp);
    };


    expModule.getPublicExp = function(id, req, caches, cardSvc, defaults) {
        var log = logger.getLog(),
            qps = req.query,
            query = {id: id};

        log.info('[%1] Guest user trying to get experience %2', req.uuid, id);

        return caches.experiences.getPromise(query).then(function(results) {
            var experiences = results.map(function(result) {
                var formatted = expModule.formatOutput(result, true);
                if (!expModule.canGetExperience(formatted, null, req.isC6Origin)) {
                    return null;
                } else {
                    return formatted;
                }
            });

            if (!experiences[0]) {
                return q({code: 404, body: 'Experience not found'});
            }
            log.info('[%1] Retrieved experience %2', req.uuid, id);

            return expModule.getAdConfig(experiences[0], results[0].org, caches.orgs)
            .then(function(exp) {
                return expModule.getSiteConfig(exp, results[0].org, qps, req.originHost,
                                               caches.sites, caches.orgs, defaults);
            })
            .then(function(exp) {
                return expModule.handleCampaign(req, exp, qps.campaign, caches.campaigns, cardSvc);
            })
            .then(function(exp) {
                return q({code: 200, body: exp});
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
            sortObj = {},
            resp = {},
            log = logger.getLog();
        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
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

        log.info('[%1] User %2 getting experiences with %3, sort %4, limit %5, skip %6',
                 req.uuid,req.user.id,JSON.stringify(query),JSON.stringify(sortObj),limit,skip);

        var permQuery = expModule.userPermQuery(query, req.user, req.isC6Origin),
            opts = {sort: sortObj, limit: limit, skip: skip},
            cursor;

        log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));

        if (permQuery.user) {
            opts.hint = { user: 1 }; // These hints ensure mongo uses indices wisely when searching
        } else if (permQuery.org) {
            opts.hint = { org: 1 };
        }

        cursor = experiences.find(permQuery, opts);

        return (multiGet ? q.npost(cursor, 'count') : q())
        .then(function(count) {
            if (count !== undefined) {
                var start = count !== 0 ? skip + 1 : 0,
                    end = limit ? Math.min(skip + limit , count) : count;

                resp.headers = {
                    'content-range': 'items ' + start + '-' + end + '/' + count
                };
            }
            return q.npost(cursor, 'toArray');
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

        if (obj.data.adConfig && !expModule.checkScope(user, obj, 'experiences', 'editAdConfig')){
            log.info('[%1] User %2 not authorized to set adConfig of new exp',req.uuid,user.id);
            return q({ code: 403, body: 'Not authorized to set adConfig' });
        }

        var versionId = uuid.hashText(JSON.stringify(obj.data)).substr(0, 8);
        obj.data = [ { user: user.email, userId: user.id, date: now,
                       data: obj.data, versionId: versionId } ];


        return q.npost(experiences, 'insert', [mongoUtils.escapeKeys(obj), {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created experience %3', req.uuid, user.id, obj.id);
            return q({ code: 201, body: expModule.formatOutput(obj) });
        }).catch(function(error) {
            log.error('[%1] Error creating experience %2 for user %3: %4',
                      req.uuid, obj.id, user.id, error);
            return q.reject(error);
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
        return q.npost(experiences, 'findOne', [{id: id}])
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

            var origAdConfig = orig.data && orig.data[0] && orig.data[0].data.adConfig || null;

            if (updates.data && updates.data.adConfig &&
                !objUtils.compareObjects(updates.data.adConfig, origAdConfig) &&
                !expModule.checkScope(user, orig, 'experiences', 'editAdConfig')) {
                log.info('[%1] User %2 not authorized to edit adConfig of %3',req.uuid,user.id,id);
                return q({
                    code: 403,
                    body: 'Not authorized to edit adConfig of this experience'
                });
            }

            updates = expModule.formatUpdates(req, orig, updates, user);

            return q.npost(experiences, 'findAndModify',
                           [{id: id}, {id: 1}, {$set: updates}, {w: 1, journal: true, new: true}])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated experience %3',
                         req.uuid, user.id, updated.id);
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

        return q.npost(experiences, 'findOne', [{id: id}])
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

            return q.npost(experiences, 'update', [{id: id}, {$set: updates}, {w:1, journal:true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted experience %3', req.uuid, user.id, id);
                return q({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            return q.reject(error);
        });
    };

    // Handle requests for cards from /api/public/content/card/:id endpoints
    expModule.handlePublicGet = function(req, res, cardSvc, config) {
        return cardSvc.getPublicCard(req.params.id, req)
        .then(function(card) {
            if (!req.originHost.match(/(portal|staging).cinema6.com/)) {
                res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
            }
            
            if (!card) {
                return q({ code: 404, body: 'Card not found' });
            }
            
            // if ext === 'js', return card as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(card) + ';' });
            } else {
                return q({ code: 200, body: card });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };


    expModule.setupEndpoints = function(app, expColl, caches, cardSvc, config,
                                        sessions, audit, jobManager) {

        var log = logger.getLog();
        
        // Used for handling public requests for experiences by id methods:
        function handlePublicGet(req, res) {
            return expModule.getPublicExp(req.params.id, req, caches, cardSvc,
                                          config.defaultSiteConfig)
            .then(function(resp) {
                if (!req.originHost.match(/(portal|staging).cinema6.com/)) {
                    res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
                }
                return q(resp);
            }).catch(function(error) {
                res.header('cache-control', 'max-age=60');
                return q({code: 500, body: { error: 'Error retrieving content', detail: error }});
            });
        }

        // Retrieve a json representation of an experience
        app.get('/api/public/content/experience/:id.json', function(req, res) {
            handlePublicGet(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });

        // Retrieve a CommonJS style representation of an experience
        app.get('/api/public/content/experience/:id.js', function(req, res) {
            handlePublicGet(req, res).then(function(resp) {
                if (resp.code < 200 || resp.code >= 300) {
                    res.send(resp.code, resp.body);
                } else {
                    res.header('content-type', 'application/javascript');
                    res.send(resp.code, 'module.exports = ' + JSON.stringify(resp.body) + ';');
                }
            });
        });

        // Default for retrieving an experience, which returns JSON
        app.get('/api/public/content/experience/:id', function(req, res) {
            handlePublicGet(req, res).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });
        

        // Setup router for non-public card endpoints
        var router      = express.Router(),
            mountPath   = '/api/content/experiences?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));

        var authGetExp = authUtils.middlewarify({experiences: 'read'});
        
        // private get experience by id
        router.get('/:id', sessions, authGetExp, audit, function(req, res) {
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
        router.get('/', sessions, authGetExp, audit, function(req, res) {
            var query = {};
            if (req.query.ids) {
                query.id = req.query.ids.split(',');
            }
            if (req.query.categories) {
                query.categories = req.query.categories.split(',');
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

        var authPostExp = authUtils.middlewarify({experiences: 'create'});
        router.post('/', sessions, authPostExp, audit, function(req, res) {
            var promise = expModule.createExperience(req, expColl);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating experience', detail: error });
                });
            });
        });

        var authPutExp = authUtils.middlewarify({experiences: 'edit'});
        router.put('/:id', sessions, authPutExp, audit, function(req, res) {
            var promise = expModule.updateExperience(req, expColl);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating experience', detail: error });
                });
            });
        });

        var authDelExp = authUtils.middlewarify({experiences: 'delete'});
        router.delete('/:id', sessions, authDelExp, audit, function(req, res) {
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
