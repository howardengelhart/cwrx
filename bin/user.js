#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var path        = require('path'),
    q           = require('q'),
    logger      = require('../lib/logger'),
    uuid        = require('../lib/uuid'),
    mongoUtils  = require('../lib/mongoUtils'),
    authUtils   = require('../lib/authUtils')(),
    service     = require('../lib/service'),
    
    userCache   = {},
    state       = {},
    userSvc     = {}; // for exporting functions to unit tests

state.name = 'user';
// This is the template for user's configuration
state.defaultConfig = {
    appDir: __dirname,
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/user/caches/run/'),
    },
    cacheTTLs: {  // units here are minutes
        users: 30 // authUtils + service use same cache
    },
    sessions: {
        key: 'c6Auth',
        maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
        db: 'sessions'
    },
    secretsPath: path.join(process.env.HOME,'.user.secrets.json'),
    mongo: {
        host: 'localhost',
        port: 27017,
        db: 'c6Db',
        retryConnect : true
    }
};

// no getUser function here since we just use authUtils.getUser instead

userSvc.createUser = function(req, users) {
    var obj = req.body,
        user = req.user,
        log = logger.getLog(),
        now = new Date();
    if (!obj || typeof obj !== 'object') {
        return q({code: 400, body: "You must provide an object in the body"});
    } else if (!obj.username || !obj.password) {
        return q({code: 400, body: "New user object must have a username and password"});
    }
    
    // check if a user already exists with that username
    q.npost(users, 'findOne', [{username: obj.username}]).then(function(userAccount) {
        if (userAccount) {
            log.info('[%1] User %2 already exists', req.uuid, req.body.username);
            deferred.resolve({ // TODO: return or deferred.resolve?
                code: 400,
                body: 'A user with that username already exists'
            });
            return q();
        }    
        obj.id = 'u-' + uuid.createUuid().substr(0,14);
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
        
    }).catch(function(error) {
    // TODO
    });
};

userSvc.updateUser = function(req, experiences) {
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

userSvc.deleteUser = function(req, experiences) {
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

userSvc.main = function(state) {
    var log = logger.getLog(),
        started = new Date();
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }
    log.info('Running as cluster worker, proceed with setting up web server.');
        
    var express     = require('express'),
        MongoStore  = require('connect-mongo')(express),
        deferred    = q.defer(),
        app         = express();
    // set auth cacheTTL now that we've loaded config
    authUtils = require('../lib/authUtils')(state.config.cacheTTLs.users, userCache);

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
        store: state.sessionStore
    }));

    app.all('*', function(req, res, next) {
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
    
    var users = state.db.collection('experiences');
    //TODO: FIGURE OUT ALL THESE PERMISSIONS
    
    var authGetUser = authUtils.middlewarify(state.db, {});
    app.get('/api/user/:id', authGetUser, function(req, res, next) {
        authUtils.getUser(req.params.id, state.db).then(function(userAccount) {
            log.info('[%1] Retrieved document for user %2', req.uuid, req.params.id);
            res.send(200, userAccount);
        }).catch(function(error) {
            log.error('[%1] Error retrieving user %2: %3',
                      req.uuid, req.params.id, JSON.stringify(error));
            res.send(500, {
                error: 'Error retrieving user'
            });
        });
    });
    
    var authPostUser = authUtils.middlewarify(state.db, {});
    app.post('/api/user', authPostUser, function(req, res, next) {
        userSvc.createUser(req, users)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error creating user',
                detail: error
            });
        });
    });
    
    var authPutUser = authUtils.middlewarify(state.db, {});
    app.put('/api/user/:id', authPutUser, function(req, res, next) {
        userSvc.updateUser(req, users)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error updating user',
                detail: error
            });
        });
    });
    
    var authDelUser = authUtils.middlewarify(state.db, {});
    app.delete('/api/user/:id', authDelUser, function(req, res, next) {
        userSvc.deleteUser(req, users)
        .then(function(resp) {
            res.send(resp.code, resp.body);
        }).catch(function(error) {
            res.send(500, {
                error: 'Error deleting user',
                detail: error
            });
        });
    });
    
    app.get('/api/user/meta', function(req, res, next){
        var data = {
            version: state.config.appVersion,
            started : started.toISOString(),
            status : 'OK'
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
    .then(service.initSessionStore)
    .then(userSvc.main)
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
    module.exports = userSvc;
}
