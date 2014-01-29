#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var path        = require('path'),
    q           = require('q'),
    logger      = require('../lib/logger'),
    uuid        = require('../lib/uuid'),
    mongoUtils  = require('../lib/mongoUtils'),
    authUtils   = require('../lib/authUtils')(),
    service     = require('../lib/service'),
    
    state       = {},
    content = {}; // for exporting functions to unit tests

state.name = 'content';
// This is the template for content's configuration
state.defaultConfig = {
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
    },
    sessions: {
        key: 'c6content',
        maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
        db: 'sessions'
    },
    secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
    mongo: {
        host: 'localhost',
        port: 27017,
        db: 'c6Db'
    }
};

//TODO: rework to use Howard's promise library
content.getExperiences = function(query, req, experiences) {
    var sortObj = req.query && (typeof req.query.sort === 'object') && req.query.sort || {},
        limit = req.query && req.query.limit || 0,
        skip = req.query && req.query.skip || 0,
        log = logger.getLog();
    
    log.info('[%1] Getting Experiences with %1, sort %2, limit %3, skip %4',
             req.uuid, JSON.stringify(query), JSON.stringify(sortObj), limit, skip);
    return q.npost(experiences.find(query, {sort: sortObj, limit: limit, skip: skip}), 'toArray')
    .then(function(experiences) {
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
    obj.status = 'active';
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
    
    log.info('[%1] User %2 is attempting to update experience %3', req.uuid, user.id, obj.id);
    q.npost(experiences, 'findOne', [{id: id}])
    .then(function(orig) {
        now = new Date();
        if (orig) {
            if (orig.user !== user.id) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
                return deferred.resolve({code: 401, body: "Not authorized to edit this experience"});
            }
        } else {
            log.info('[%1] Experience %2 does not exist; creating it', req.uuid, id);
            obj.created = now;
            obj.status = 'active';
        }
        obj.lastUpdated = now;
        return q.npost(experiences, 'update', [{id: id}, obj, {w: 1, journal: true, upsert: true}])
        .then(function(old) {
            log.info('[%1] User %2 successfully updated experience %3', req.uuid, user.id, old  .id);
            deferred.resolve({code: 201, body: obj});
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
    log.info('[%1] User %2 is attempting to update experience %3', req.uuid, user.id, id);
    q.npost(experiences, 'findOne', [{id: id}])
    .then(function(orig) {
        now = new Date();
        if (!orig) {
            log.info('[%1] Experience %2 does not exist', req.uuid, id);
            return deferred.resolve({code: 200, body: "That experience does not exist"});
        } else {
            if (orig.user !== user.id) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return deferred.resolve({code: 401, body: "Not authorized to delete this experience"});
            }
            if (orig.status === 'deleted') {
                log.info('[%1] Experience %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 200, body: "That experience has already been deleted"});
            }
        }
        return q.npost(experiences, 'update', [{id: id},
                       {$set: {lastUpdated: now, status: 'deleted'}}, {w: 1, journal: true}])
        .then(function(updated) {
            log.info('[%1] User %2 successfully deleted experience %3', req.uuid, user.id, updated.id);
            deferred.resolve({code: 200, body: "Successfully deleted experience"});
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
    
    var experiences = state.collection('experiences');
    
    // simple get active experience by id, public
    app.get('/content/experiences/:id', function(req, res, next) {
        content.getExperiences({id: req.params.id, status: 'active'}, req, experiences)
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
    app.get('/content/experiences', function(req, res, next) {
        var query = (req.query && req.query.selector) || {}; //TODO: default query????
        query.status = 'active';
        content.getExperiences(query, req, experiences)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error retrieving content'
            });
        });
    });
    
    var authPostExp = authUtils.middlewarify(state.db, {createExperience: true});
    app.post('/content/experiences', authPostExp, function(req, res, next) {
        content.createExperience(req.body, req.user, experiences)
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
    app.put('/content/experiences/:id', authPutExp, function(req, res, next) {
        content.updateExperience(req.params.id, req.body, req.user, experiences)
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
    app.delete('/content/experiences/:id', authDelExp, function(req, res, next) {
        content.deleteExperience(req.params.id, req.user, experiences)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error deleting experience',
                detail: error
            });
        });
    });
    
    app.get('/content/meta', function(req, res, next){
        var data = {
            version: state.config.appVersion,
            config: {
                mongo: state.config.mongo
            }
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
