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
        Status          = enums.Status,
        Access          = enums.Access,
        Scope           = enums.Scope,

        state   = {},
        content = {}; // for exporting functions to unit tests

    // This is the template for content's configuration
    state.defaultConfig = {
        appName: 'content',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            experiences: {
                freshTTL: 1,
                maxTTL: 10
            },
            orgs: {
                freshTTL: 1,
                maxTTL: 10
            },
            sites: {
                freshTTL: 1,
                maxTTL: 10
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
            user:    function(exp, orig, requester) {
                        var scopeFunc = FieldValidator.scopeFunc('experiences','create',Scope.All);
                        return requester.id === exp.user || scopeFunc(exp, orig, requester);
                    },
            org:    function(exp, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('experiences','create',Scope.All);
                        return eqFunc(exp, orig, requester) || scopeFunc(exp, orig, requester);
                    }
        }
    });
    content.updateValidator = new FieldValidator({ forbidden: ['id', 'org', 'created', '_id'] });

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

        function statusReduce(a, b) {
            if (b.status === Status.Active && (!a || b.date > a.date)) {
                return b;
            } else {
                return a;
            }
        }

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
                    var lastActive = experience.status.reduce(statusReduce, null);
                    if (lastActive) {
                        newExp.lastPublished = lastActive.date;
                    }
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
        if (container === 'veeseo') {
            return { host: 'veeseo.com' };
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

    // Ensure experience has branding and placements, getting from current site or org if necessary
    content.getSiteConfig = function(exp, orgId, qps, host, siteCache, orgCache, defaultSiteCfg) {
        var log = logger.getLog(),
            props = ['branding', 'placementId', 'wildCardPlacement'],
            setProps = function(exp, obj) {
                props.forEach(function(prop) { exp.data[prop] = exp.data[prop] || obj[prop]; });
            },
            query;
        qps = qps || {};

        if (!exp.data) {
            log.warn('Experience %1 does not have data!', exp.id);
            return q(exp);
        }

        setProps(exp, qps);
        if (qps.context === 'mr2') {
            exp.data.mode = 'lightbox';
        }
        if (props.every(function(prop) { return !!exp.data[prop]; })) {
            return q(exp);
        }

        query = content.buildHostQuery(host, qps && qps.container);

        return ( !!host ? siteCache.getPromise(query) : q([]) ).then(function(results) {
            var site = content.chooseSite(results);
            if (!site) {
                if (!!host) {
                    log.warn('Site %1 not found', host);
                }
            } else {
                setProps(exp, site);
            }
            if (exp.data.branding) {
                return q();
            }
            return orgCache.getPromise({id: orgId});
        }).then(function(results) {
            if (results && results.length !== 0 && results[0].status === Status.Active) {
                exp.data.branding = exp.data.branding || results[0].branding;
            }
            setProps(exp, defaultSiteCfg);
            return q(exp);
        });

    };


    content.getPublicExp = function(id, req, expCache, orgCache, siteCache, defaultSiteCfg) {
        var log = logger.getLog(),
            qps = req.query,
            query = {id: id};

        log.info('[%1] Guest user trying to get experience %2', req.uuid, id);

        return expCache.getPromise(query).then(function(results) {
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

            return content.getAdConfig(experiences[0], results[0].org, orgCache)
            .then(function(exp) {
                return content.getSiteConfig(exp, results[0].org, qps, req.originHost, siteCache,
                                             orgCache, defaultSiteCfg);
            })
            .then(function(exp) {
                return q({code: 200, body: exp});
            });
        })
        .catch(function(error) {
            log.error('[%1] Error getting experiences: %2', req.uuid, error);
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
        if (query.status) {
            if (query.status === Status.Deleted) {
                log.warn('[%1] User %2 attempting to get deleted experiences',req.uuid,req.user.id);
                return q({code: 400, body: 'Cannot get deleted experiences'});
            }
            query['status.0.status'] = query.status;
            delete query.status;
        }
        if (query.sponsoredType) {
            query['data.0.data.sponsoredType'] = query.sponsoredType;
            delete query.sponsoredType;
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
            return q({code: 400, body: 'Illegal fields'});
        }

        obj.id = 'e-' + uuid.createUuid().substr(0,14);
        log.trace('[%1] User %2 is creating experience %3', req.uuid, user.id, obj.id);

        delete obj.versionId; // only allow these properties to be set in the data
        delete obj.title;
        delete obj.lastPublished;

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
        delete updates.lastPublished;
        delete updates.versionId;

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
                return q({code: 400, body: 'Illegal fields'});
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

    content.generatePreviewLink = function(id, req, expCache, orgCache, siteCache, defaultSiteCfg) {
        var log = logger.getLog();
        log.info('[%1] User attempting to generate preview link for experience %2', req.uuid, id);
        return content.getPublicExp(id, req, expCache, orgCache, siteCache, defaultSiteCfg)
        .then(function(resp) {
            if (resp.code !== 200) {
                return q(resp);
            }

            if(resp.body && resp.body.id && resp.body.title &&
                resp.body.data && resp.body.data.splash &&
                resp.body.data.splash.theme && resp.body.data.splash.ratio) {
                var splashData = resp.body.data.splash;
                var urlObject = {
                    query: {
                        preload: '',
                        exp: resp.body.id,
                        title: resp.body.title,
                        splash: splashData.theme + ':' + splashData.ratio.replace('-', '/')
                    }
                };
                var url = '/#/preview/minireel' + urlUtils.format(urlObject);
                return q({url: url});
            } else {
                log.warn('[%1] Experience %2 does not have required fields.', req.uuid, id);
                return q({code: 500, body: 'Response does not have required fields.'});
            }
        }).catch(function(error) {
            log.error('[%1] Error generating preview link for experience %2', req.uuid, id);
            return q.reject(error);
        });
    };

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
            experiences  = state.dbs.c6Db.collection('experiences'),
            users        = state.dbs.c6Db.collection('users'),
            orgs         = state.dbs.c6Db.collection('orgs'),
            sites        = state.dbs.c6Db.collection('sites'),
            expTTLs      = state.config.cacheTTLs.experiences,
            expCache     = new QueryCache(expTTLs.freshTTL, expTTLs.maxTTL, experiences),
            orgTTLs      = state.config.cacheTTLs.orgs,
            orgCache     = new QueryCache(orgTTLs.freshTTL, orgTTLs.maxTTL, orgs),
            siteTTLs     = state.config.cacheTTLs.sites,
            siteCache    = new QueryCache(siteTTLs.freshTTL, siteTTLs.maxTTL, sites),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._coll = users;

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

        state.dbStatus.c6Db.on('reconnected', function() {
            experiences = state.dbs.c6Db.collection('experiences');
            users = state.dbs.c6Db.collection('users');
            orgs = state.dbs.c6Db.collection('orgs');
            sites = state.dbs.c6Db.collection('sites');
            expCache._coll = experiences;
            orgCache._coll = orgs;
            siteCache._coll = sites;
            authUtils._coll = users;
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
            return content.getPublicExp(req.params.id, req, expCache, orgCache, siteCache,
                                        state.config.defaultSiteConfig)
            .then(function(resp) {
                res.header('cache-control', 'max-age=' + state.config.cacheTTLs.cloudFront*60);
                return q(resp);
            }).catch(function(error) {
                res.header('cache-control', 'max-age=60');
                return q({code: 500, body: {
                    error: 'Error retrieving content',
                    detail: error
                }});
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

        app.get('/preview/:id', function(req, res) {
            content.generatePreviewLink(req.params.id, req, expCache, orgCache, siteCache,
                state.config.defaultSiteConfig)
            .then(function(resp) {
                if(resp.url) {
                    res.redirect(resp.url);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error generating preview link',
                    detail: error
                });
            });
        });

        var authGetExp = authUtils.middlewarify({experiences: 'read'}),
            audit = auditJournal.middleware.bind(auditJournal);
        
        // private get experience by id
        app.get('/api/content/experience/:id', sessWrap, authGetExp, audit, function(req, res) {
            content.getExperiences({id:req.params.id}, req, experiences)
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
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });

        // private get experience by query
        app.get('/api/content/experiences', sessWrap, authGetExp, audit, function(req, res) {
            var query = {};
            ['ids', 'user', 'org', 'type', 'sponsoredType', 'status', 'text']
            .forEach(function(field) {
                if (req.query[field]) {
                    if (field === 'ids') {
                        query.id = req.query.ids.split(',');
                    } else {
                        query[field] = String(req.query[field]);
                    }
                }
            });
            if (!Object.keys(query).length) {
                log.info('[%1] Cannot GET /content/experiences with no query params',req.uuid);
                return res.send(400, 'Must specify at least one supported query param');
            }

            content.getExperiences(query, req, experiences, true)
            .then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);

                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving content',
                    detail: error
                });
            });
        });

        var authPostExp = authUtils.middlewarify({experiences: 'create'});
        app.post('/api/content/experience', sessWrap, authPostExp, audit, function(req, res) {
            content.createExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating experience',
                    detail: error
                });
            });
        });

        var authPutExp = authUtils.middlewarify({experiences: 'edit'});
        app.put('/api/content/experience/:id', sessWrap, authPutExp, audit, function(req, res) {
            content.updateExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating experience',
                    detail: error
                });
            });
        });

        var authDelExp = authUtils.middlewarify({experiences: 'delete'});
        app.delete('/api/content/experience/:id', sessWrap, authDelExp, audit, function(req, res) {
            content.deleteExperience(req, experiences)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting experience',
                    detail: error
                });
            });
        });

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
            console.log(err.message || err);
            log.error(err.message || err);
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
