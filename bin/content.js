#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        urlUtils        = require('url'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        mongoUtils      = require('../lib/mongoUtils'),
        journal         = require('../lib/journal'),
        objUtils        = require('../lib/objUtils'),
        QueryCache      = require('../lib/queryCache'),
        FieldValidator  = require('../lib/fieldValidator'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        cardModule      = require('./content-cards'),
        catModule       = require('./content-categories'),
        Status          = enums.Status,
        Access          = enums.Access,
        Scope           = enums.Scope,

        state   = {},
        content = { brandCache: {} }; // for exporting functions to unit tests

    // This is the template for content's configuration
    state.defaultConfig = {
        appName: 'content',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            cards: { //TODO: update cookbook; also set all maxTTLs to 4 there
                freshTTL: 1,
                maxTTL: 4
            },
            experiences: {
                freshTTL: 1,
                maxTTL: 4
            },
            orgs: {
                freshTTL: 1,
                maxTTL: 4
            },
            sites: {
                freshTTL: 1,
                maxTTL: 4
            },
            campaigns: {
                freshTTL: 1,
                maxTTL: 4
            },
            cloudFront: 5
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            minAge: 60*1000, // TTL for cookies for unauthenticated users
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        defaultSiteConfig: {
            branding: 'default',
            placementId: null,
            wildCardPlacement: null
        },
        siteExceptions: {
            public: ['www.cinema6.com', 'demo.cinema6.com'],
            cinema6: ['c-6.co', 'ci6.co']
        },
        secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true,
                requiredIndices: {
                    experiences: ['user', 'org']
                }
            },
            c6Journal: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };
    
    content.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            user:   FieldValidator.userFunc('experiences', 'create'),
            org:    FieldValidator.orgFunc('experiences', 'create')
        }
    });
    content.updateValidator = new FieldValidator({
        forbidden: ['id', 'created', '_id'],
        condForbidden: {
            user:   FieldValidator.userFunc('experiences', 'edit'),
            org:    FieldValidator.orgFunc('experiences', 'edit')
        }
    });
    
    // Find and parse the origin, storing useful properties on the request
    content.parseOrigin = function(req, siteExceptions) {
        req.origin = req.headers && (req.headers.origin || req.headers.referer) || '';
        req.originHost = req.origin && String(urlUtils.parse(req.origin).hostname) || '';
        req.isC6Origin = (req.origin && req.origin.match('cinema6.com') || false) &&
                         !siteExceptions.public.some(function(s) { return req.originHost === s;}) ||
                         siteExceptions.cinema6.some(function(s) { return req.originHost === s;});
    };

    content.formatOutput = function(experience, isGuest) {
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
    content.checkScope = function(user, experience, object, verb) {
        return !!(user && user.permissions && user.permissions[object] &&
                  user.permissions[object][verb] &&
             (user.permissions[object][verb] === Scope.All ||
             (user.permissions[object][verb] === Scope.Org && (user.org === experience.org ||
                                                               user.id === experience.user)) ||
             (user.permissions[object][verb] === Scope.Own && user.id === experience.user) ));
    };

    // Check whether a user can retrieve an experience
    content.canGetExperience = function(exp, user, isC6Origin) {
        user = user || {};

        return exp.status !== Status.Deleted &&
               !!( (exp.status === Status.Active && !isC6Origin)                    ||
                   (exp.access === Access.Public && isC6Origin)                     ||
                   content.checkScope(user, exp, 'experiences', 'read')             ||
                   (user.applications && user.applications.indexOf(exp.id) >= 0)    );
    };

    /* Adds fields to a find query to filter out experiences the user can't see, effectively
     * replicating the logic of canGetExperience through the query */
    content.userPermQuery = function(query, user, isC6Origin) {
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
    content.formatTextQuery = function(query) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            textParts = newQuery.text.trim().split(/\s+/);
            
        newQuery['data.0.data.title'] = {$regex: '.*' + textParts.join('.*') + '.*', $options: 'i'};
        delete newQuery.text;
        return newQuery;
    };

    // Ensure experience has adConfig, getting from its org if necessary
    content.getAdConfig = function(exp, orgId, orgCache) {
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
    content.buildHostQuery = function(host, container) {
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
    content.chooseSite = function(results) {
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
     * with the same brandString, using content.brandCache to keep track of the indexes */
    content.chooseBranding = function(brandString, prefix, expId) {
        if (!brandString || !brandString.match(/(\w+,)+\w+/)) {
            return brandString;
        }

        var log         = logger.getLog(),
            brands      = brandString.split(','),
            key         = prefix + ':' + brandString,
            idx         = content.brandCache[key] || 0,
            selected    = brands[idx];
            
        log.info('Selected brand %1, idx %2, from %3 for %4', selected, idx, key, expId);

        content.brandCache[key] = (++idx >= brands.length) ? 0 : idx;
        return selected;
    };

    // Ensure experience has branding and placements, getting from current site or org if necessary
    content.getSiteConfig = function(exp, orgId, qps, host, siteCache, orgCache, defaults) {
        var log = logger.getLog(),
            props = ['branding', 'placementId', 'wildCardPlacement'],
            siteQuery;
        qps = qps || {};

        function setProps(exp, obj, src) {
            exp.data.placementId = exp.data.placementId || obj.placementId;
            exp.data.wildCardPlacement = exp.data.wildCardPlacement || obj.wildCardPlacement;
            exp.data.branding = exp.data.branding ||
                                content.chooseBranding(obj.branding, src, exp.id);
        }

        if (!exp.data) {
            log.warn('Experience %1 does not have data!', exp.id);
            return q(exp);
        }
        
        exp.data.branding = content.chooseBranding(exp.data.branding, exp.id, exp.id);
        setProps(exp, qps, 'queryParams', exp.id);
        if (props.every(function(prop) { return !!exp.data[prop]; })) {
            return q(exp);
        }

        siteQuery = content.buildHostQuery(host, qps.container);

        return ( !!siteQuery ? siteCache.getPromise(siteQuery) : q([]) ).then(function(results) {
            var site = content.chooseSite(results);
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
    content.swapCard = function(req, exp, idx, camp, cardSvc) {
        var log = logger.getLog(),
            oldId = exp.data.deck[idx].id,
            newId = camp.staticCardMap[exp.id][oldId],
            adtechId = (camp.cards && camp.cards.filter(function(cardObj) {
                return cardObj.id === newId;
            })[0] || {}).adtechId;
        
        if (!adtechId) {
            log.warn('[%1] No adtechId for %2 in cards list of %3', req.uuid, newId, camp.id);
            return q();
        }
        
        log.trace('[%1] Swapping card %2 for placeholder %3 in experience %4',
                  req.uuid, newId, oldId, exp.id);
        
        return cardSvc.getPublicCard(newId, req)
        .then(function(newCard) {
            if (!newCard) {
                log.warn('[%1] Could not retrieve card %2 for experience %3',
                         req.uuid, newId, exp.id);
                return q();
            } else {
                newCard.adtechId = adtechId;
                exp.data.deck[idx] = newCard;
            }
        });
    };
    
    /* Look up campaign by campId. If it has staticCardPlacements for this exp, look up those cards
     * and insert them in the appropriate slots */
    content.handleCampaign = function(req, exp, campId, campCache, cardSvc) {
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
                return q();
            }
            
            return q.all(exp.data.deck.map(function(card, idx) {
                if (!mapping[card.id]) {
                    return q();
                }

                return content.swapCard(req, exp, idx, camp, cardSvc);
            }));
        })
        .thenResolve(exp);
    };


    content.getPublicExp = function(id, req, caches, cardSvc, defaults) {
        var log = logger.getLog(),
            qps = req.query,
            query = {id: id};

        log.info('[%1] Guest user trying to get experience %2', req.uuid, id);

        return caches.experiences.getPromise(query).then(function(results) {
            var experiences = results.map(function(result) {
                var formatted = content.formatOutput(result, true);
                if (!content.canGetExperience(formatted, null, req.isC6Origin)) {
                    return null;
                } else {
                    return formatted;
                }
            });

            if (!experiences[0]) {
                return q({code: 404, body: 'Experience not found'});
            }
            log.info('[%1] Retrieved experience %2', req.uuid, id);

            return content.getAdConfig(experiences[0], results[0].org, caches.orgs)
            .then(function(exp) {
                return content.getSiteConfig(exp, results[0].org, qps, req.originHost, caches.sites,
                                             caches.orgs, defaults);
            })
            .then(function(exp) {
                return content.handleCampaign(req, exp, qps.campaign, caches.campaigns, cardSvc);
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

    content.getExperiences = function(query, req, experiences, multiExp) {
        var limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            resp = {},
            log = logger.getLog(),
            promise;
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
            query = content.formatTextQuery(query);
        }

        log.info('[%1] User %2 getting experiences with %3, sort %4, limit %5, skip %6',
                 req.uuid,req.user.id,JSON.stringify(query),JSON.stringify(sortObj),limit,skip);

        var permQuery = content.userPermQuery(query, req.user, req.isC6Origin),
            opts = {sort: sortObj, limit: limit, skip: skip},
            cursor;

        log.trace('[%1] permQuery = %2', req.uuid, JSON.stringify(permQuery));

        if (permQuery.user) {
            opts.hint = { user: 1 }; // These hints ensure mongo uses indices wisely when searching
        } else if (permQuery.org) {
            opts.hint = { org: 1 };
        }

        cursor = experiences.find(permQuery, opts);

        if (multiExp) {
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
            var exps = results.map(function(exp) {
                return content.formatOutput(exp, false);
            });
            log.info('[%1] Showing the user %2 experiences', req.uuid, exps.length);
            resp.code = 200;
            resp.body = exps;
            return q(resp);
        })
        .catch(function(error) {
            log.error('[%1] Error getting experiences: %2', req.uuid, error);
            return q.reject(error);
        });
    };


    content.createExperience = function(req, experiences) {
        var obj = req.body,
            user = req.user,
            log = logger.getLog(),
            now = new Date();
        if (!obj || typeof obj !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        if (!content.createValidator.validate(obj, {}, user)) {
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

        if (obj.data) {
            if (obj.data.adConfig && !content.checkScope(user, obj, 'experiences', 'editAdConfig')){
                log.info('[%1] User %2 not authorized to set adConfig of new exp',req.uuid,user.id);
                return q({ code: 403, body: 'Not authorized to set adConfig' });
            }

            var versionId = uuid.hashText(JSON.stringify(obj.data)).substr(0, 8);
            obj.data = [ { user: user.email, userId: user.id, date: now,
                           data: obj.data, versionId: versionId } ];
            if (obj.status[0].status === Status.Active) {
                obj.data[0].active = true;
            }
        }

        return q.npost(experiences, 'insert', [mongoUtils.escapeKeys(obj), {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created experience %3', req.uuid, user.id, obj.id);
            return q({code: 201, body: content.formatOutput(obj)});
        }).catch(function(error) {
            log.error('[%1] Error creating experience %2 for user %3: %4',
                      req.uuid, obj.id, user.id, error);
            return q.reject(error);
        });
    };

    content.formatUpdates = function(req, orig, updates, user) {
        var log = logger.getLog(),
            now = new Date();

        if (!(orig.data instanceof Array)) {
            log.warn('[%1] Original exp %2 does not have an array of data', req.uuid, orig.id);
            var oldVersion = uuid.hashText(JSON.stringify(orig.data || {})).substr(0, 8);
            orig.data = [ { user: user.email, userId: user.id, date: orig.created, data: orig.data,
                            versionId: oldVersion } ];
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
                if (orig.status[0].status === Status.Active) {
                    dataWrapper.active = true;
                    orig.data.unshift(dataWrapper);
                } else if (orig.data[0].active) { // preserve previously active data
                    orig.data.unshift(dataWrapper);
                } else {
                    orig.data[0] = dataWrapper;
                }
                updates.data = orig.data;
            } else {
                delete updates.data;
            }
        }

        if (updates.status) {
            if (updates.status !== orig.status[0].status) {
                var statWrapper = {user:user.email,userId:user.id,date:now,status:updates.status};
                if (updates.status === Status.Active) {
                    orig.data[0].active = true;
                    updates.data = orig.data;
                } else if (updates.data) {
                    delete updates.data[0].active;
                }
                orig.status.unshift(statWrapper);
                updates.status = orig.status;
            } else {
                delete updates.status;
            }
        }

        updates.lastUpdated = now;
        return mongoUtils.escapeKeys(updates);
    };

    content.updateExperience = function(req, experiences) {
        var updates = req.body,
            id = req.params.id,
            user = req.user,
            log = logger.getLog();
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }

        // these props are copied from elsewhere when returning to the client, so don't allow them
        // to be set here
        delete updates.title;
        delete updates.versionId;
        delete updates.lastPublished;
        delete updates.lastStatusChange;

        log.info('[%1] User %2 is attempting to update experience %3',req.uuid,user.id,id);
        return q.npost(experiences, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist; not creating it', req.uuid, id);
                return q({code: 404, body: 'That experience does not exist'});
            }
            if (orig.status && orig.status[0] && orig.status[0].status === Status.Deleted) {
                log.info('[%1] User %2 trying to update deleted experience %3',req.uuid,user.id,id);
                return q({code: 404, body: 'That experience does not exist'});
            }
            if (!content.updateValidator.validate(updates, orig, user)) {
                log.warn('[%1] updates contain illegal fields', req.uuid);
                log.trace('exp: %1  |  orig: %2  |  requester: %3',
                          JSON.stringify(updates), JSON.stringify(orig), JSON.stringify(user));
                return q({code: 400, body: 'Invalid request body'});
            }
            if (!content.checkScope(user, orig, 'experiences', 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
                return q({ code: 403, body: 'Not authorized to edit this experience' });
            }

            var origAdConfig = orig.data && orig.data[0] && orig.data[0].data.adConfig || null;

            if (updates.data && updates.data.adConfig &&
                !objUtils.compareObjects(updates.data.adConfig, origAdConfig) &&
                !content.checkScope(user, orig, 'experiences', 'editAdConfig')) {
                log.info('[%1] User %2 not authorized to edit adConfig of %3',req.uuid,user.id,id);
                return q({ code: 403, body: 'Not authorized to edit adConfig of this experience' });
            }

            updates = content.formatUpdates(req, orig, updates, user);

            return q.npost(experiences, 'findAndModify',
                           [{id: id}, {id: 1}, {$set: updates}, {w: 1, journal: true, new: true}])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated experience %3',
                         req.uuid, user.id, updated.id);
                return q({code: 200, body: content.formatOutput(updated)});
            });
        }).catch(function(error) {
            log.error('[%1] Error updating experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            return q.reject(error);
        });
    };

    content.deleteExperience = function(req, experiences) {
        var id = req.params.id,
            user = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        log.info('[%1] User %2 is attempting to delete experience %3', req.uuid, user.id, id);
        q.npost(experiences, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Experience %2 does not exist', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            if (!content.checkScope(user, orig, 'experiences', 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return deferred.resolve({
                    code: 403,
                    body: 'Not authorized to delete this experience'
                });
            }

            if (orig.status[0] && orig.status[0].status === Status.Deleted) {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }

            var updates = { status: Status.Deleted };
            content.formatUpdates(req, orig, updates, user);

            return q.npost(experiences, 'update', [{id: id}, {$set: updates}, {w:1, journal:true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted experience %3', req.uuid, user.id, id);
                deferred.resolve({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting experience %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    ///////////////////////////////////////////////////////////////////////////

    content.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var express      = require('express'),
            app          = express(),
            collKeys     = ['experiences','orgs','users','sites','campaigns','cards','categories'],
            cacheKeys    = ['experiences', 'orgs', 'sites', 'campaigns'],
            collections  = {},
            caches       = {},
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName),
            audit        = auditJournal.middleware.bind(auditJournal),
            catSvc, cardSvc;
            
        collKeys.forEach(function(key) {
            collections[key] = state.dbs.c6Db.collection(key);
        });
        cacheKeys.forEach(function(key) {
            var ttls = state.config.cacheTTLs[key];
            caches[key] = new QueryCache(ttls.freshTTL, ttls.maxTTL, collections[key]);
        });

        authUtils._coll = collections.users;
        cardSvc = cardModule.setupCardSvc(collections.cards, state.config);
        catSvc = catModule.setupCatSvc(collections.categories);


        app.use(express.bodyParser());
        app.use(express.cookieParser(state.secrets.cookieParser || ''));

        var sessions = express.session({
            key: state.config.sessions.key,
            cookie: {
                httpOnly: false,
                maxAge: state.config.sessions.minAge
            },
            store: state.sessionStore
        });

        state.dbStatus.c6Db.on('reconnected', function() { //TODO: probs need to retest this
            collKeys.forEach(function(key) {
                collections[key] = state.dbs.c6Db.collection(key);
            });
            cacheKeys.forEach(function(key) {
                caches[key]._coll = collections[key];
            });
            
            cardSvc._coll = collections.cards;
            catSvc._coll = collections.categories;
            authUtils._coll = collections.users;
            log.info('Recreated collections from restarted c6Db');
        });

        state.dbStatus.sessions.on('reconnected', function() {
            sessions = express.session({
                key: state.config.sessions.key,
                cookie: {
                    httpOnly: false,
                    maxAge: state.config.sessions.minAge
                },
                store: state.sessionStore
            });
            log.info('Recreated session store from restarted db');
        });

        state.dbStatus.c6Journal.on('reconnected', function() {
            auditJournal.resetColl(state.dbs.c6Journal.collection('audit'));
            log.info('Reset journal\'s collection from restarted db');
        });
        
        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }

        app.use(function(req, res, next) {
            content.parseOrigin(req, state.config.siteExceptions);
            next();
        });

        app.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        app.all('*', function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-Health/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });
        
        // Used for handling public requests for experiences by id methods:
        function handlePublicGet(req, res) {
            return content.getPublicExp(req.params.id, req, caches, cardSvc,
                                        state.config.defaultSiteConfig)
            .then(function(resp) {
                if (!req.originHost.match(/(portal|staging).cinema6.com/)) {
                    res.header('cache-control', 'max-age=' + state.config.cacheTTLs.cloudFront*60);
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

        var authGetExp = authUtils.middlewarify({experiences: 'read'});
        
        // private get experience by id
        app.get('/api/content/experience/:id', sessWrap, authGetExp, audit, function(req, res) {
            content.getExperiences({id:req.params.id}, req, collections.experiences)
            .then(function(resp) {
                if (resp.body && resp.body instanceof Array) {
                    if (resp.body.length === 0) {
                        res.send(404, 'Experience not found');
                    } else {
                        res.send(resp.code, resp.body[0]);
                    }
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving content', detail: error });
            });
        });

        // private get experience by query
        app.get('/api/content/experiences', sessWrap, authGetExp, audit, function(req, res) {
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
                return res.send(400, 'Must specify at least one supported query param');
            }

            content.getExperiences(query, req, collections.experiences, true)
            .then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error retrieving content', detail: error });
            });
        });

        var authPostExp = authUtils.middlewarify({experiences: 'create'});
        app.post('/api/content/experience', sessWrap, authPostExp, audit, function(req, res) {
            content.createExperience(req, collections.experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error creating experience', detail: error });
            });
        });

        var authPutExp = authUtils.middlewarify({experiences: 'edit'});
        app.put('/api/content/experience/:id', sessWrap, authPutExp, audit, function(req, res) {
            content.updateExperience(req, collections.experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error updating experience', detail: error });
            });
        });

        var authDelExp = authUtils.middlewarify({experiences: 'delete'});
        app.delete('/api/content/experience/:id', sessWrap, authDelExp, audit, function(req, res) {
            content.deleteExperience(req, collections.experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, { error: 'Error deleting experience', detail: error });
            });
        });
        
        // adds endpoints for managing cards
        cardModule.setupEndpoints(app, cardSvc, sessWrap, audit);
        
        // adds endpoints for managing categories
        catModule.setupEndpoints(app, catSvc, sessWrap, audit);

        app.get('/api/content/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/content/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(function(err, req, res, next) {
            if (err) {
                log.error('Error: %1', err);
                res.send(500, 'Internal error');
            } else {
                next();
            }
        });

        app.listen(state.cmdl.port);
        log.info('Service is listening on port: ' + state.cmdl.port);

        return state;
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(service.initMongo)
        .then(service.initSessionStore)
        .then(service.ensureIndices)
        .then(content.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.stack || err);
            log.error(err.stack || err);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = content;
    }
}());
