#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        FieldValidator  = require('../lib/fieldValidator'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        
        state   = {},
        siteSvc = {}; // for exporting functions to unit tests

    state.name = 'siteSvc';
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
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
        secretsPath: path.join(process.env.HOME,'.siteSvc.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };

    siteSvc.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            org:    function(site, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('sites', 'create', Scope.All);
                        return eqFunc(site, orig, requester) || scopeFunc(site, orig, requester);
                    }
        }
    });
    siteSvc.updateValidator = new FieldValidator({
        forbidden: ['id', 'created', '_id'],
        condForbidden: {
            org:    function(site, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('sites', 'edit', Scope.All);
                        return eqFunc(site, orig, requester) || scopeFunc(site, orig, requester);
                    }
        }
    });
    
    // Return true if host is a root followed by tld (with optional country-code extension)
    siteSvc.validateHost = function(host) {
        return !!host.match(/^\w+[\w-]+\.[a-z]{2,4}(\.[a-z]{2})?$/);
    };

    // Check whether the requester can operate on the target site according to their scope
    siteSvc.checkScope = function(requester, site, verb) {
        return !!(requester && requester.permissions && requester.permissions.sites &&
                  requester.permissions.sites[verb] &&
             (requester.permissions.sites[verb] === Scope.All ||
             (requester.permissions.sites[verb] === Scope.Org && requester.org === site.org) ||
             (requester.permissions.sites[verb] === Scope.Own && requester.org === site.org) ));
    };

    // Adds fields to a find query to filter out sites the requester can't see
    siteSvc.userPermQuery = function(query, requester) {
        var newQuery = JSON.parse(JSON.stringify(query)),
            readScope = requester.permissions.sites.read,
            log = logger.getLog();
        
        newQuery.status = {$ne: Status.Deleted}; // never show deleted sites
        
        if (!Scope.isScope(readScope)) {
            log.warn('User has invalid scope ' + readScope);
            readScope = Scope.Own;
        }
        
        if (readScope !== Scope.All) {
            newQuery.org = requester.org;
        }
        
        return newQuery;
    };
    
    siteSvc.getSites = function(query, req, sites, multiGet) {
        var limit = req.query && Number(req.query.limit) || 0,
            skip = req.query && Number(req.query.skip) || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog(),
            resp = {},
            promise;
        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }

        if (!(req.user.permissions &&
              req.user.permissions.sites &&
              req.user.permissions.sites.read &&
              req.user.permissions.sites.read === Scope.All)) {
            if (!Object.keys(query).length) {
                log.info('[%1] User %2 is not authorized to read all sites', req.uuid, req.user.id);
                return q({code: 403, body: 'Not authorized to read all sites'});
            } else if (query.org && query.org !== req.user.org) {
                log.info('[%1] User %2 is not authorized to read sites outside their org',
                         req.uuid, req.user.id);
                return q({code: 403, body: 'Not authorized to read non-org sites'});
            }
        }
        
        query = query || {};
        
        log.info('[%1] User %2 getting sites with query %3, sort %4, limit %5, skip %6',req.uuid,
                 req.user.id, JSON.stringify(query), JSON.stringify(sortObj), limit, skip);

        var permQuery = siteSvc.userPermQuery(query, req.user),
            cursor = sites.find(permQuery, {sort: sortObj, limit: limit, skip: skip});
        
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
            var siteList = results.map(function(site) {
                delete site._id;
                return mongoUtils.unescapeKeys(site);
            });
            log.info('[%1] Showing the requester %2 site documents', req.uuid, siteList.length);
            if (siteList.length === 0) {
                resp.code = 404;
                resp.body = 'No sites found';
            } else {
                resp.code = 200;
                resp.body = siteList;
            }
            return q(resp);
        })
        .catch(function(error) {
            log.error('[%1] Error getting sites: %2', req.uuid, error);
            return q.reject(error);
        });
    };
    
    siteSvc.setupSite = function(newSite) {
        var now = new Date();
        newSite.id = 's-' + uuid.createUuid().substr(0,14);
        newSite.created = now;
        newSite.lastUpdated = now;
        if (!newSite.status) {
            newSite.status = Status.Active;
        }
        return mongoUtils.escapeKeys(newSite);
    };
    
    siteSvc.createSite = function(req, sites) {
        var newSite = req.body,
            requester = req.user,
            log = logger.getLog();
        if (!newSite || typeof newSite !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        } else if (!newSite.host) {
            return q({code: 400, body: 'New site object must have a host property'});
        }
        
        if (!siteSvc.validateHost(newSite.host)) {
            log.info('[%1] New site object has invalid host %2', req.uuid, newSite.host);
            return q({code: 400, body: 'Host property must be the root domain'});
        }
        
        // check if a site already exists with that host
        return q.npost(sites, 'findOne', [{host: newSite.host}])
        .then(function(site) {
            if (site) {
                log.info('[%1] Site %2 already exists', req.uuid, req.body.host);
                return q({ code: 409, body: 'A site with that host already exists' });
            }
            if (!siteSvc.createValidator.validate(newSite, {}, requester)) {
                log.warn('[%1] newSite contains illegal fields', req.uuid);
                log.trace('newSite: %1  |  requester: %2',
                          JSON.stringify(newSite), JSON.stringify(requester));
                return q({code: 400, body: 'Illegal fields'});
            }
            
            newSite = siteSvc.setupSite(newSite);
            log.trace('[%1] User %2 is creating site %3', req.uuid, requester.id, newSite.id);

            return q.npost(sites, 'insert', [newSite, {w: 1, journal: true}])
            .then(function() {
                delete newSite._id;
                log.info('[%1] User %2 successfully created site %3 with id: %4',
                         req.uuid, requester.id, newSite.host, newSite.id);
                return q({ code: 201, body: mongoUtils.unescapeKeys(newSite) });
            });
        }).catch(function(error) {
            log.error('[%1] Error creating site %2 for user %3: %4',
                      req.uuid, newSite.id, requester.id, error);
            return q.reject(error);
        });
    };

    siteSvc.updateSite = function(req, sites) {
        var updates = req.body,
            id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            promise;
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        if (updates.host && !siteSvc.validateHost(updates.host)) {
            log.info('[%1] Update object has invalid host %2', req.uuid, updates.host);
            return q({code: 400, body: 'Host property must be the root domain'});
        }
        
        log.info('[%1] User %2 is attempting to update site %3', req.uuid, requester.id, id);
        return q.npost(sites, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Site %2 does not exist; not creating them', req.uuid, id);
                return q({code: 404, body: 'That site does not exist'});
            }
            if (!siteSvc.checkScope(requester, orig, 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, requester.id, id);
                return q({code: 403, body: 'Not authorized to edit this site'});
            }
            if (!siteSvc.updateValidator.validate(updates, orig, requester)) {
                log.warn('[%1] Updates contain illegal fields', req.uuid);
                log.trace('updates: %1  |  orig: %2  |  requester: %3', JSON.stringify(updates),
                          JSON.stringify(orig), JSON.stringify(requester));
                return q({code: 400, body: 'Illegal fields'});
            }
            
            if (updates.host) {
                promise = q.npost(sites, 'findOne', [{ host: updates.host, id: { $ne: id } }]);
            } else {
                promise = q();
            }
            
            return promise.then(function(existing) {
                if (existing) {
                    log.info('[%1] Trying to change host of %2 to %3, but %4 already has that host',
                             req.uuid, id, updates.host, existing.id);
                    return q({ code: 409, body: 'A site with that host already exists' });
                }
                
                updates.lastUpdated = new Date();
                var updateObj = { $set: mongoUtils.escapeKeys(updates) };
                var opts = { w: 1, journal: true, new: true };

                return q.npost(sites, 'findAndModify', [{id: id}, {id: 1}, updateObj, opts])
                .then(function(results) {
                    var updated = results[0];
                    delete updated._id;
                    log.info('[%1] User %2 successfully updated site %3',
                             req.uuid, requester.id, updated.id);
                    return q({code: 200, body: mongoUtils.unescapeKeys(updated)});
                });
            });
        }).catch(function(error) {
            log.error('[%1] Error updating site %2 for user %3: %4',req.uuid,id,requester.id,error);
            return q.reject(error);
        });
    };

    siteSvc.deleteSite = function(req, sites) {
        var id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            now;

        log.info('[%1] User %2 is attempting to delete site %3', req.uuid, requester.id, id);
        return q.npost(sites, 'findOne', [{id: id}])
        .then(function(orig) {
            now = new Date();
            if (!orig) {
                log.info('[%1] Site %2 does not exist', req.uuid, id);
                return q({code: 204});
            }
            if (!siteSvc.checkScope(requester, orig, 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, requester.id, id);
                return q({code: 403, body: 'Not authorized to delete this site'});
            }
            if (orig.status === Status.Deleted) {
                log.info('[%1] Site %2 has already been deleted', req.uuid, id);
                return q({code: 204});
            }
            var updates = {$set: {lastUpdated: now, status: Status.Deleted}};
            return q.npost(sites, 'update', [{id:id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted site %3', req.uuid, requester.id, id);
                return q({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting site %2 for user %3: %4',req.uuid,id,requester.id,error);
            return q.reject(error);
        });
    };
    
    siteSvc.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
            
        var express     = require('express'),
            app         = express(),
            users       = state.dbs.c6Db.collection('users'),
            sites    = state.dbs.c6Db.collection('sites');
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
            users = state.dbs.c6Db.collection('users');
            sites = state.dbs.c6Db.collection('sites');
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

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessionsWrapper(req, res, next) {
            sessions(req, res, next);
        }

        app.all('*', function(req, res, next) {
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
        
        app.get('/api/site/meta', function(req, res) {
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });
        
        app.get('/api/site/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        var authGetSite = authUtils.middlewarify({sites: 'read'});
        app.get('/api/site/:id', sessionsWrapper, authGetSite, function(req,res){
            siteSvc.getSites({ id: req.params.id }, req, sites, false)
            .then(function(resp) {
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving site',
                    detail: error
                });
            });
        });
        
        app.get('/api/sites', sessionsWrapper, authGetSite, function(req, res) {
            var query = {};
            if (req.query && req.query.org) {
                query.org = String(req.query.org);
            }
            if (req.query && req.query.host) {
                query.host = String(req.query.host);
            }
            siteSvc.getSites(query, req, sites, true)
            .then(function(resp) {
                if (resp.pagination) {
                    res.header('content-range', 'items ' + resp.pagination.start + '-' +
                                                resp.pagination.end + '/' + resp.pagination.total);
                    
                }
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving sites',
                    detail: error
                });
            });
        });
        
        var authPostSite = authUtils.middlewarify({sites: 'create'});
        app.post('/api/site', sessionsWrapper, authPostSite, function(req, res) {
            siteSvc.createSite(req, sites)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating site',
                    detail: error
                });
            });
        });
        
        var authPutSite = authUtils.middlewarify({sites: 'edit'});
        app.put('/api/site/:id', sessionsWrapper, authPutSite, function(req, res) {
            siteSvc.updateSite(req, sites)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating site',
                    detail: error
                });
            });
        });
        
        var authDelSite = authUtils.middlewarify({sites: 'delete'});
        app.delete('/api/site/:id', sessionsWrapper, authDelSite, function(req, res) {
            siteSvc.deleteSite(req, sites)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting site',
                    detail: error
                });
            });
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
        .then(siteSvc.main)
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
        module.exports = siteSvc;
    }
}());
