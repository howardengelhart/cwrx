#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var path        = require('path'),
    q           = require('q'),
    bcrypt      = require('bcrypt'),
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

// Check whether the parent user can operate on the target user according to their scope
userSvc.checkScope = function(parent, user, verb) {
    return !!(parent && parent.permissions && parent.permissions.users && parent.permissions.users[verb] &&
         (parent.permissions.users[verb] === 'all' ||
         (parent.permissions.users[verb] === 'org' && (parent.org === user.org ||
                                                       parent.id === user.id)) ||
         (parent.permissions.users[verb] === 'own' && parent.id === user.id) ));
};

// TODO no getUser function here since we just use authUtils.getUser instead

// Setup a new user with reasonable defaults and hash their password
userSvc.setupUser = function(newUser, parent) {
    var log = logger.getLog(),
        now = new Date();

    newUser.id = 'u-' + uuid.createUuid().substr(0,14);
    log.trace('[%1] User %2 is creating user %3', req.uuid, parent.id, newUser.id);
    newUser.created = now;
    newUser.lastUpdated = now;
    if (parent.org && !newUser.org) newUser.org = parent.org;
    if (!newUser.status) newUser.status = 'active';
    if (!newUser.permissions) newUser.permissions = {};
    var defaultPerms = { // ensure that every user at least has these permissions
        users: {
            read: "own",
            create: "own",
            edit: "own",
            delete: "own"
        },
        users: {
            read: "own",
            edit: "own"
        },
        org: {
            read: "own"
        }
    };
    Object.keys(defaultPerms).forEach(function(key) {
        if (!newUser.permissions[key]) {
            newUser.permissions[key] = defaultPerms[key];
        } else {
            Object.keys(defaultPerms[key]).forEach(function(action) {
                if (!newUser.permissions[key][action]) {
                    newUser.permissions[key][action] = defaultPerms[key][action];
                }
            });
        }
    });
    return q.npost(bcrypt, 'hash', [newUser.password, bcrypt.genSaltSync()])
    .then(function(hashed) {
        newUser.password = hashed;
    });
};

userSvc.createUser = function(req, users) {
    var newUser = req.body,
        parent = req.user,
        log = logger.getLog(),
        deferred = q.defer();
    if (!newUser || typeof newUser !== 'object') {
        return q({code: 400, body: "You must provide an object in the body"});
    } else if (!newUser.username || !newUser.password) {
        return q({code: 400, body: "New user object must have a username and password"});
    }
    
    // check if a user already exists with that username
    q.npost(users, 'findOne', [{username: newUser.username}])
    .then(function(userAccount) {
        if (userAccount) {
            log.info('[%1] User %2 already exists', req.uuid, req.body.username);
            return deferred.resolve({
                code: 400, 
                body: 'A user with that username already exists'
            });
        }
        if (parent.org !== newUser.org && parent.permissions.users.create !== 'all') {
            log.warn('[%1] User %2 in org %3 cannot create users in org %4',
                     req.uuid, parent.id, parent.org, newUser.org);
            return deferred.resolve({
                code: 400,
                body: 'Cannot create users outside of your organization'
            });
        }
        userSvc.setupUser(newUser, parent).then(function() {
            return q.npost(users, 'insert', [newUser, {w: 1, journal: true}])
        }).then(function() {
            log.info('[%1] User %2 successfully created user %3 with id: %4',
                     req.uuid, parent.id, newUser.username, newUser.id);
            deferred.resolve({ code: 201, body: mongoUtils.safeUser(newUser) });
        });
    }).catch(function(error) {
        log.error('[%1] Error creating user %2 for user %3: %4',
                  req.uuid, newUser.id, parent.id, error);
        deferred.reject(error);
    });
    return deferred.promise;
};

// Prune out illegal updates and convert to $set format
userSvc.formatUpdates = function(updates, orig, parent, reqId) {
    var log = logger.getLog();
    if (updates.id && (updates.id !== orig.id)) {
        log.warn('[%1] User %2 is trying to change the id of user %3 to %4',
                 reqId, parent.id, orig.id, updates.id);
        delete updates.id;
    }
    if (updates.org !== orig.org) {
        log.warn('[%1] User %2 is trying to change the org of user %3 to %4',
                 reqId, parent.id, orig.id, updates.org);
        delete updates.org;
    }
    if (updates.permissions && (orig.id === parent.id)) {
        log.warn('[%1] User %2 is trying to change their permissions', reqId, parent.id);
        delete updates.permissions;
    }
    if (updates.password) {
        log.warn('[%1] User %2 is trying to change the password of user %3',reqId,parent.id,orig.id);
        delete updates.password;
    }
    return { $set: updates };
};

userSvc.updateUser = function(req, users) {
    var updates = req.body,
        id = req.params.id,
        parent = req.user,
        log = logger.getLog(),
        deferred = q.defer();
    if (!updates || typeof updates !== 'object') {
        return q({code: 400, body: "You must provide an object in the body"});
    }
    
    log.info('[%1] User %2 is attempting to update user %3', req.uuid, parent.id, id);
    q.npost(users, 'findOne', [{id: id}])
    .then(function(orig) {
        if (!orig) {
            log.info('[%1] User %2 does not exist; not creating them', req.uuid, id);
            return deferred.resolve({code: 404, body: 'That user does not exist'});
        }
        if (!userSvc.checkScope(parent, orig, 'users', 'edit')) {
            log.info('[%1] User %2 is not authorized to edit %3', req.uuid, parent.id, id);
            return deferred.resolve({code: 403, body: 'Not authorized to edit this user'});
        }
        var updateObj = userSvc.formatUpdates(updates, orig, parent, req.uuid);
            //TODO: check if updates is now blank??
        q.npost(users, 'findAndModify', [{id:id}, {id:1}, updateObj, {w:1,journal:true,new:true}])
        .then(function(results) {
            var updated = results[0];
            log.info('[%1] User %2 successfully updated user %3', req.uuid, parent.id, updated.id);
            delete userCache[id];
            deferred.resolve({code: 201, body: updated});
        });
    }).catch(function(error) {
        log.error('[%1] Error updating user %2 for user %3: %4', req.uuid, id, parent.id, error);
        deferred.reject(error);
    });
    return deferred.promise;
};

userSvc.deleteUser = function(req, users) {
    var id = req.params.id,
        parent = req.user,
        log = logger.getLog(),
        deferred = q.defer(),
        now;
    if (id === parent.id) {
        log.warn('[%1] User %2 tried to delete themselves', req.uuid, parent.id);
        return q({code; 400, body: 'You cannot delete yourself'});
    }
    log.info('[%1] User %2 is attempting to delete user %3', req.uuid, parent.id, id);
    q.npost(users, 'findOne', [{id: id}])
    .then(function(orig) {
        now = new Date();
        if (!orig) {
            log.info('[%1] User %2 does not exist', req.uuid, id);
            return deferred.resolve({code: 200, body: "Success"});
        }
        if (!userSvc.checkScope(parent, orig, 'users', 'delete')) {
            log.info('[%1] User %2 is not authorized to delete %3', req.uuid, parent.id, id);
            return deferred.resolve({code: 403, body: "Not authorized to delete this user"});
        }
        if (orig.status === 'deleted') {
            log.info('[%1] User %2 has already been deleted', req.uuid, id);
            return deferred.resolve({code: 200, body: "Success"});
        }
        q.npost(users, 'update', [{id: id}, {$set: {lastUpdated: now, status: 'deleted'}}, 
                {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully deleted user %3', req.uuid, parent.id, id);
            delete userCache[id];
            deferred.resolve({code: 200, body: "Success"});
        });
    }).catch(function(error) {
        log.error('[%1] Error deleting user %2 for user %3: %4', req.uuid, id, parent.id, error);
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
    
    var users = state.db.collection('users');
    
    var authGetUser = authUtils.middlewarify(state.db, {users: "read"});
    app.get('/api/user/:id', authGetUser, function(req, res, next) {
        authUtils.getUser(req.params.id, state.db).then(function(userAccount) {
            log.info('[%1] Retrieved document for user %2', req.uuid, req.params.id);
            res.send(200, userAccount);
        }).catch(function(error) {
            log.error('[%1] Error retrieving user %2: %3',
                      req.uuid, req.params.id, JSON.stringify(error));
            res.send(500, {
                error: 'Error retrieving user',
                detail: error
            });
        });
    });
    
    app.get('/api/users', authGetUser, function(req, res, next) {
        userSvc.getUsers(req.params.id, state.db).then(function(userAccount) {
            res.send(200, userAccount); //TODO
        }).catch(function(error) {
            res.send(500, {
                error: 'Error retrieving users'
                detail: error
            });
        });
    });
    
    var authPostUser = authUtils.middlewarify(state.db, {users: 'create'});
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
    
    var authPutUser = authUtils.middlewarify(state.db, {users: 'edit'});
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
    
    var authDelUser = authUtils.middlewarify(state.db, {users: 'delete'});
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
