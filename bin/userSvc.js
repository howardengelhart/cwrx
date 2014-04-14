#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        bcrypt          = require('bcrypt'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        FieldValidator  = require('../lib/fieldValidator'),
        mongoUtils      = require('../lib/mongoUtils'),
        authUtils       = require('../lib/authUtils')(),
        service         = require('../lib/service'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        
        state       = {},
        userSvc     = {}; // for exporting functions to unit tests

    state.name = 'user';
    // This is the template for user's configuration
    state.defaultConfig = {
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/userSvc/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
        },
        sessions: {
            key: 'c6Auth',
            maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
            minAge: 60*1000, // TTL for cookies for unauthenticated users
            mongo: {
                host: null,
                port: null
            }
        },
        secretsPath: path.join(process.env.HOME,'.userSvc.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };

    // Check whether the requester can operate on the target user according to their scope
    userSvc.checkScope = function(requester, user, verb) {
        return !!(requester && requester.permissions && requester.permissions.users &&
                  requester.permissions.users[verb] &&
             (requester.permissions.users[verb] === Scope.All ||
             (requester.permissions.users[verb] === Scope.Org && (requester.org === user.org ||
                                                                  requester.id === user.id)) ||
             (requester.permissions.users[verb] === Scope.Own && requester.id === user.id) ));
    };
    
    // make sure requester can't edit own perms or set perms that are greater than their own
    userSvc.permsCheck = function(updates, orig, requester) {
        var log = logger.getLog();
        if (!requester.permissions) {
            log.trace('Requester has no permissions');
            return false;
        }
        if (orig.id && (orig.id === requester.id)) {
            log.trace('Requester trying to change own permissions');
            return false;
        }
        return Object.keys(updates.permissions).every(function(key) {
            if (!requester.permissions[key]) {
                log.trace('Can\'t set perms for %1 since requester has no perms for %1', key);
                return false;
            }
            var updateObj = updates.permissions[key];
            var requesterObj = requester.permissions[key];
            return Object.keys(updates.permissions[key]).every(function(verb) {
                if (Scope.compare(updateObj[verb], requesterObj[verb]) > 0) {
                    log.trace('Can\'t set perm %1: %2: %3 when requester has %1: %2: %4',
                              key, verb, updateObj[verb], requesterObj[verb]);
                    return false;
                }
                return true;
            });
        });
    };

    userSvc.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            permissions: userSvc.permsCheck,
            org:    function(user, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('users', 'create', Scope.All);
                        return eqFunc(user, orig, requester) || scopeFunc(user, orig, requester);
                    }
        }
    });
    userSvc.updateValidator = new FieldValidator({
        forbidden: ['id', 'org', 'password', 'created'],
        condForbidden: { permissions: userSvc.permsCheck }
    });

    userSvc.getUsers = function(query, req, users) {
        var limit = req.query && req.query.limit || 0,
            skip = req.query && req.query.skip || 0,
            sort = req.query && req.query.sort,
            sortObj = {},
            log = logger.getLog();
        if (sort) {
            var sortParts = sort.split(',');
            if (sortParts.length !== 2 || (sortParts[1] !== '-1' && sortParts[1] !== '1' )) {
                log.warn('[%1] Sort %2 is invalid, ignoring', req.uuid, sort);
            } else {
                sortObj[sortParts[0]] = Number(sortParts[1]);
            }
        }
        log.info('[%1] User %2 getting users with query %3, sort %4, limit %5, skip %6', req.uuid,
                 req.user.id, JSON.stringify(query), JSON.stringify(sortObj), limit, skip);
        return q.npost(users.find(query, {sort: sortObj, limit: limit, skip: skip}), 'toArray')
        .then(function(results) {
            log.trace('[%1] Retrieved %2 users', req.uuid, results.length);
            var users = results.filter(function(result) {
                return userSvc.checkScope(req.user, result, 'read');
            });
            users = users.map(mongoUtils.safeUser);
            log.info('[%1] Showing the requester %2 user documents', req.uuid, users.length);
            if (users.length === 0) {
                if (results.length !== 0) {
                    return q({code: 403, body: 'Not authorized to get those users'});
                }
                return q({code: 404, body: 'No users found'});
            } else {
                return q({code: 200, body: users});
            }
        }).catch(function(error) {
            log.error('[%1] Error getting users: %2', req.uuid, error);
            return q.reject(error);
        });
    };
    
    // Setup a new user with reasonable defaults and hash their password
    userSvc.setupUser = function(newUser, requester) {
        var now = new Date();

        newUser.id = 'u-' + uuid.createUuid().substr(0,14);
        newUser.created = now;
        newUser.lastUpdated = now;
        if (requester.org && !newUser.org) {
            newUser.org = requester.org;
        }
        if (!newUser.status) {
            newUser.status = Status.Active;
        }
        if (!newUser.permissions) {
            newUser.permissions = {};
        }
        var defaultPerms = { // ensure that every user at least has these permissions
            experiences: {
                read: Scope.Own,
                create: Scope.Own,
                edit: Scope.Own,
                delete: Scope.Own
            },
            users: {
                read: Scope.Own,
                edit: Scope.Own
            },
            orgs: {
                read: Scope.Own
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
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!newUser || typeof newUser !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        } else if (!newUser.username || !newUser.password) {
            return q({code: 400, body: 'New user object must have a username and password'});
        }
        
        // check if a user already exists with that username
        q.npost(users, 'findOne', [{username: newUser.username}])
        .then(function(userAccount) {
            if (userAccount) {
                log.info('[%1] User %2 already exists', req.uuid, req.body.username);
                return deferred.resolve({
                    code: 409,
                    body: 'A user with that username already exists'
                });
            }
            if (!userSvc.createValidator.validate(newUser, {}, requester)) {
                log.warn('[%1] newUser contains illegal fields', req.uuid);
                log.trace('newUser: %1  |  requester: %2',
                          JSON.stringify(newUser), JSON.stringify(requester));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            return userSvc.setupUser(newUser, requester).then(function() {
                log.trace('[%1] User %2 is creating user %3', req.uuid, requester.id, newUser.id);
                return q.npost(users, 'insert', [newUser, {w: 1, journal: true}]);
            }).then(function() {
                log.info('[%1] User %2 successfully created user %3 with id: %4',
                         req.uuid, requester.id, newUser.username, newUser.id);
                deferred.resolve({ code: 201, body: mongoUtils.safeUser(newUser) });
            });
        }).catch(function(error) {
            log.error('[%1] Error creating user %2 for user %3: %4',
                      req.uuid, newUser.id, requester.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    userSvc.updateUser = function(req, users) {
        var updates = req.body,
            id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        log.info('[%1] User %2 is attempting to update user %3', req.uuid, requester.id, id);
        q.npost(users, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] User %2 does not exist; not creating them', req.uuid, id);
                return deferred.resolve({code: 404, body: 'That user does not exist'});
            }
            if (!userSvc.checkScope(requester, orig, 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, requester.id, id);
                return deferred.resolve({code: 403, body: 'Not authorized to edit this user'});
            }
            if (!userSvc.updateValidator.validate(updates, orig, requester)) {
                log.warn('[%1] Updates contain illegal fields', req.uuid);
                log.trace('updates: %1  |  orig: %2  |  requester: %3', JSON.stringify(updates),
                          JSON.stringify(orig), JSON.stringify(requester));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            updates.lastUpdated = new Date();
            var updateObj = { $set: updates };
            var opts = {w: 1, journal: true, new: true};
            return q.npost(users, 'findAndModify', [{id: id}, {id: 1}, updateObj, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated user %3',
                         req.uuid, requester.id, updated.id);
                deferred.resolve({code: 200, body: mongoUtils.safeUser(updated)});
            });
        }).catch(function(error) {
            log.error('[%1] Error updating user %2 for user %3: %4',req.uuid,id,requester.id,error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    userSvc.deleteUser = function(req, users) {
        var id = req.params.id,
            requester = req.user,
            log = logger.getLog(),
            deferred = q.defer(),
            now;
        if (id === requester.id) {
            log.warn('[%1] User %2 tried to delete themselves', req.uuid, requester.id);
            return q({code: 400, body: 'You cannot delete yourself'});
        }
        log.info('[%1] User %2 is attempting to delete user %3', req.uuid, requester.id, id);
        q.npost(users, 'findOne', [{id: id}])
        .then(function(orig) {
            now = new Date();
            if (!orig) {
                log.info('[%1] User %2 does not exist', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            if (!userSvc.checkScope(requester, orig, 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, requester.id, id);
                return deferred.resolve({code: 403, body: 'Not authorized to delete this user'});
            }
            if (orig.status === Status.Deleted) {
                log.info('[%1] User %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            var updates = {$set: {lastUpdated: now, status: Status.Deleted}};
            return q.npost(users, 'update', [{id:id}, updates, {w: 1, journal: true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted user %3', req.uuid, requester.id, id);
                deferred.resolve({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting user %2 for user %3: %4',req.uuid,id,requester.id,error);
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
            app         = express(),
            users       = state.dbs.c6Db.collection('users'),
            authTTLs    = state.config.cacheTTLs.auth;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);

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
        
        app.get('/api/account/user/meta', function(req, res/*, next*/){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });
        
        app.get('/api/account/user/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });
        
        var authGetUser = authUtils.middlewarify({users: 'read'});
        app.get('/api/account/user/:id', sessions, authGetUser, function(req, res/*, next*/) {
            userSvc.getUsers({ id: req.params.id }, req, users)
            .then(function(resp) {
                if (resp.body && resp.body instanceof Array) {
                    res.send(resp.code, resp.body[0]);
                } else {
                    res.send(resp.code, resp.body);
                }
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving user',
                    detail: error
                });
            });
        });
        
        app.get('/api/account/users', sessions, authGetUser, function(req, res/*, next*/) {
            if (!req.query || !req.query.org) {
                log.info('[%1] Cannot GET /api/users without org specified',req.uuid);
                return res.send(400, 'Must specify org param');
            }
            userSvc.getUsers({ org: req.query.org }, req, users)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error retrieving users',
                    detail: error
                });
            });
        });
        
        var authPostUser = authUtils.middlewarify({users: 'create'});
        app.post('/api/account/user', sessions, authPostUser, function(req, res/*, next*/) {
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
        
        var authPutUser = authUtils.middlewarify({users: 'edit'});
        app.put('/api/account/user/:id', sessions, authPutUser, function(req, res/*, next*/) {
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
        
        var authDelUser = authUtils.middlewarify({users: 'delete'});
        app.delete('/api/account/user/:id', sessions, authDelUser, function(req, res/*, next*/) {
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
}());
