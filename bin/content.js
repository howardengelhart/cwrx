#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var path        = require('path'),
    q           = require('q'),
    logger      = require('../lib/logger'),
    uuid        = require('../lib/uuid'),
    mongoUtils  = require('../lib/mongoUtils'),
    authUtils   = require('../lib/authUtils')(),
    service     = require('../lib/service'),
    promise     = require('../lib/promise'),
    
    state       = {},
    content = {}; // for exporting functions to unit tests

state.name = 'content';
// This is the template for content's configuration
state.defaultConfig = {
    appDir: __dirname,
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
    },
    cacheTTLs: {  // units here are minutes
        experiences: 5,
        auth: 30
    },
    sessions: {
        key: 'c6Auth',
        maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
        db: 'sessions'
    },
    secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
    mongo: {
        host: 'localhost',
        port: 27017,
        db: 'c6Db',
        retryConnect : true
    }
};

///////////////////////////////

content.QueryCache = function(cacheTTL, coll) {
    var self = this;
    if (!cacheTTL || !coll) {
        throw new Error("Must provide a cacheTTL and mongo collection");
    }
    self.cacheTTL = cacheTTL*60*1000;
    self._coll = coll;
    self._keeper = new promise.Keeper();
};

content.QueryCache.sortQuery = function(query) {
    var self = this,
        newQuery = {};
    if (typeof query !== 'object') {
        return query;
    }
    if (query instanceof Array) {
        newQuery = [];
    }
    Object.keys(query).sort().forEach(function(key) {
        newQuery[key] = content.QueryCache.sortQuery(query[key]);
    });
    return newQuery;
};

content.QueryCache.formatQuery = function(query, userId) {
    var self = this;
    Object.keys(query).forEach(function(key) {
        if (query[key] instanceof Array) {
            query[key] = {$in: query[key]};
        }
    });
    var log = logger.getLog();
    if (!userId || (query.user && (query.user !== userId))) {
        query.status = 'active';
        query.access = 'public';
        return content.QueryCache.sortQuery(query);
    } else if (query.user) {
        return content.QueryCache.sortQuery(query);
    }
    var publicQuery = JSON.parse(JSON.stringify(query)); // copy, since we'll 2 queries for an $or
    query.user = userId; // the "private" query for experiences owned by the user
    publicQuery.status = 'active'; // the "public" query for other publicly viewable experiences
    publicQuery.access = 'public';
    return content.QueryCache.sortQuery({$or: [query, publicQuery]});
};

content.QueryCache.prototype.getPromise = function(reqId, query, sort, limit, skip) {
    var self = this,
        log = logger.getLog(),
        key = uuid.hashText(JSON.stringify({query:query,sort:sort,limit:limit,skip:skip})).substr(0,18),
        deferred = self._keeper.getDeferred(key, true);
    if (deferred) {
        log.info("[%1] Query %2 cache hit", reqId, key);
        return deferred.promise;
    }
    log.info("[%1] Query %2 cache miss", reqId, key);
    deferred = self._keeper.defer(key);
    q.npost(self._coll.find(query, {sort: sort, limit: limit, skip: skip}), 'toArray')
        .then(deferred.resolve)
        .catch(function(error) { // don't cache mongo errors; may change depending on what mongo errors we could expect
            self._keeper.remove(key, true);
            deferred.reject(error);
        });
    
    setTimeout(function() {
        log.trace("Removing query %1 from the cache", key);
        self._keeper.remove(key, true);
    }, self.cacheTTL);
    
    return deferred.promise;
};
///////////////////////////////

content.getExperiences = function(query, req, cache) {
    var limit = req.query && req.query.limit || 0,
        skip = req.query && req.query.skip || 0,
        sort = req.query && req.query.sort,
        sortObj = {},
        log = logger.getLog(),
        promise;
    if (sort) {
        var sortParts = sort.split(',');
        if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
            log.info('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
        } else {
            sortObj[sortParts[0]] = Number(sortParts[1]);
        }
    }
        
    query = content.QueryCache.formatQuery(query, req.session.user || '');
    
    log.info('[%1] Getting Experiences with %2, sort %3, limit %4, skip %5',
             req.uuid, JSON.stringify(query), JSON.stringify(sortObj), limit, skip);
    promise = cache.getPromise(req.uuid, query, sortObj, limit, skip);
    return promise.then(function(experiences) {
        log.info('[%1] Retrieved %2 experiences', req.uuid, experiences.length);
        return q({code: 200, body: experiences});
    }).catch(function(error) {
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
        return q({code: 400, body: "You must provide an object in the body"});
    }
    
    obj.id = 'e-' + uuid.createUuid().substr(0,14);
    log.info('[%1] User %2 is creating experience %3', req.uuid, user.id, obj.id);
    obj.created = now;
    obj.lastUpdated = now;
    obj.user = user.id;
    if (!obj.status) obj.status = 'active';
    if (!obj.access) obj.access = 'public';
    return q.npost(experiences, 'insert', [obj, {w: 1, journal: true}])
    .then(function() {
        log.info('[%1] User %2 successfully created experience %3', req.uuid, user.id, obj.id);
        return q({code: 201, body: obj});
    }).catch(function(error) {
        log.error('[%1] Error creating experience %2 for user %3: %4', req.uuid, obj.id, user.id, error);
        return q.reject(error);
    });
};

content.updateExperience = function(req, experiences) {
    var obj = req.body,
        id = req.params.id,
        user = req.user,
        log = logger.getLog(),
        deferred = q.defer(),
        now;
    if (!obj || typeof obj !== 'object') {
        return q({code: 400, body: "You must provide an object in the body"});
    }
    if (obj.id !== id) {
        return q({code: 400, body: "Cannot change the id of an experience"});
    }
    
    log.info('[%1] User %2 is attempting to update experience %3', req.uuid, user.id, obj.id);
    q.npost(experiences, 'findOne', [{id: id}])
    .then(function(orig) {
        if (!orig) {
            log.info('[%1] Experience %2 does not exist; not creating it', req.uuid, id);
            return deferred.resolve({code: 404, body: "That experience does not exist"});
        }
        if (orig.user !== user.id) {
            log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
            return deferred.resolve({code: 403, body: "Not authorized to edit this experience"});
        }
        obj._id = orig._id;
        now = new Date();
        obj.lastUpdated = now;
        return q.npost(experiences, 'findAndModify', 
                       [{id: id}, {id: 1}, obj, {w: 1, journal: true, new: true}])
        .then(function(results) {
            var updated = results[0];
            log.info('[%1] User %2 successfully updated experience %3', req.uuid, user.id, updated.id);
            deferred.resolve({code: 201, body: updated});
        });
    }).catch(function(error) {
        log.error('[%1] Error updating experience %2 for user %3: %4', req.uuid, id, user.id, error);
        deferred.reject(error);
    });
    return deferred.promise;
};

content.deleteExperience = function(req, experiences) {
    var id = req.params.id,
        user = req.user,
        log = logger.getLog(),
        deferred = q.defer(),
        now;
    log.info('[%1] User %2 is attempting to delete experience %3', req.uuid, user.id, id);
    q.npost(experiences, 'findOne', [{id: id}])
    .then(function(orig) {
        now = new Date();
        if (!orig) {
            log.info('[%1] Experience %2 does not exist', req.uuid, id);
            return deferred.resolve({code: 200, body: "Success"});
        } else {
            if (orig.user !== user.id) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return deferred.resolve({code: 403, body: "Not authorized to delete this experience"});
            }
            if (orig.status === 'deleted') {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 200, body: "Success"});
            }
        }
        return q.npost(experiences, 'update', [{id: id},
                       {$set: {lastUpdated: now, status: 'deleted'}}, {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully deleted experience %3', req.uuid, user.id, id);
            deferred.resolve({code: 200, body: "Success"});
        });
    }).catch(function(error) {
        log.error('[%1] Error deleting experience %2 for user %3: %4', req.uuid, id, user.id, error);
        deferred.reject(error);
    });
    return deferred.promise;
};

content.main = function(state) {
    var log = logger.getLog();
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }
    log.info('Running as cluster worker, proceed with setting up web server.');
        
    var express     = require('express'),
        MongoStore  = require('connect-mongo')(express),
        app         = express();
    // set auth cacheTTL now that we've loaded config
    authUtils = require('../lib/authUtils')(state.config.cacheTTLs.auth);

    // if connection to mongo is down; immediately reject all requests
    // otherwise the request will hang trying to get the session from mongo
    app.use(function(req, res, next) {
        mongoUtils.checkRunning(state.config.mongo.host, state.config.mongo.port)
        .then(function() {
            next();
        }).catch(function(error) {
            log.error('Connection to mongo is down: %1', error);
            res.send(500, 'Connection to database is down');
        });
    });

    app.use(express.bodyParser());
    app.use(express.cookieParser(state.secrets.cookieParser || ''));
    app.use(express.session({
        key: state.config.sessions.key,
        cookie: {
            httpOnly: false,
            maxAge: state.config.sessions.maxAge
        },
        store: new MongoStore({
            db: state.sessionsDb
        })
    }));

    app.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", 
                   "Origin, X-Requested-With, Content-Type, Accept");
        res.header("cache-control", "max-age=0");

        if (req.method.toLowerCase() === "options") {
            res.send(200);
        } else {
            next();
        }
    });

    app.all('*', function(req, res, next) {
        req.uuid = uuid.createUuid().substr(0,10);
        if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
            log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                req.method, req.url, req.httpVersion);
        } else {
            log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                req.method, req.url, req.httpVersion);
        }
        next();
    });
    
    var experiences = state.db.collection('experiences');
    var expCache = new content.QueryCache(state.config.cacheTTLs.experiences, experiences);
    
    // simple get active experience by id, public
    app.get('/api/content/experience/:id', function(req, res, next) {
        content.getExperiences({id: req.params.id}, req, expCache)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error retrieving content'
            });
        });
    });

    // robust get experience by query, require authenticated user; currently no perms required
    var authGetExp = authUtils.middlewarify(state.db, {});
    app.get('/api/content/experiences', authGetExp, function(req, res, next) {
        log.info(JSON.stringify(req.query));
        if (!req.query || (!req.query.ids && !req.query.user)) {
            log.info('[%1] Cannot GET /content/experiences without ids or user specified', req.uuid);
            return res.send(400, "Must specify ids or user param");
        }
        var query = {};
        if (req.query.ids) {
            query.id = req.query.ids.split(',');
        }
        if (req.query.user) {
            query.user = req.query.user;
        }
        content.getExperiences(query, req, expCache)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error retrieving content'
            });
        });
    });
    
    var authPostExp = authUtils.middlewarify(state.db, {createExperience: true});
    app.post('/api/content/experience', authPostExp, function(req, res, next) {
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
    
    var authPutExp = authUtils.middlewarify(state.db, {createExperience: true});
    app.put('/api/content/experience/:id', authPutExp, function(req, res, next) {
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
    
    var authDelExp = authUtils.middlewarify(state.db, {deleteExperience: true});
    app.delete('/api/content/experience/:id', authDelExp, function(req, res, next) {
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
    
    app.get('/api/content/meta', function(req, res, next){
        var data = {
            version: state.config.appVersion
        };
        res.send(200, data);
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
