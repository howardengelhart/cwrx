#!/usr/bin/env node
(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        path            = require('path'),
        util            = require('util'),
        service         = require('../lib/service'),
        uuid            = require('../lib/uuid'),
        promise         = require('../lib/promise'),
        logger          = require('../lib/logger'),
        mongoUtils      = require('../lib/mongoUtils'),
        FieldValidator  = require('../lib/fieldValidator'),
        authUtils       = require('../lib/authUtils'),
        enums           = require('../lib/enums'),
        Status          = enums.Status,
        Scope           = enums.Scope,
        __ut__          = (global.jasmine !== undefined) ? true : false,
        app             = {},
        state           = {};

    state.defaultConfig = {
        appName : 'vote',
        appDir  : __dirname,
        cacheControl : {
            default         : 'max-age=0',
            getElection     : 'max-age=300',
            getBallotItem   : 'max-age=300'
        },
        log    : {
            logLevel : 'info',
            media    : [ { type : 'console' } ]
        },
        pidFile : 'vote.pid',
        pidDir  : './',
        requestTimeout : 2000,
        idleSyncTimeout : 60000,
        secretsPath: path.join(process.env.HOME,'.vote.secrets.json'),
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
        mongo : {
            voteDb: {
                host: null,
                port: null,
                retryConnect : true
            },
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            }
        }
    };

    app.checkScope = function(user, election, verb) {
        return !!(user && user.permissions && user.permissions.elections &&
                  user.permissions.elections[verb] &&
             (user.permissions.elections[verb] === Scope.All ||
             (user.permissions.elections[verb] === Scope.Org && (user.org === election.org ||
                                                                 user.id === election.user)) ||
             (user.permissions.elections[verb] === Scope.Own && user.id === election.user) ));
    };

    function VotingBooth(electionId){
        var self        = this;
        self._id        = electionId;
        self._items     = {};

        if (!electionId){
            throw new SyntaxError('ElectionId is required.');
        }

        Object.defineProperty(self,'electionId', {
            get : function() {
                return self._id;
            }
        });

        Object.defineProperty(self,'dirty', {
            get : function() {
                return Object.keys(self._items).length > 0;
            }
        });
    }

    VotingBooth.prototype.clear = function(){
        this._items     = {};
    };

    VotingBooth.prototype.voteForBallotItem = function(itemId,vote){
        if (!this._items[itemId]){
            this._items[itemId] = typeof vote === 'number' ? [] : {};
        }

        if (!this._items[itemId][vote]){
            this._items[itemId][vote] = 0;
        }

        this._items[itemId][vote] += 1;

        return this;
    };

    VotingBooth.prototype.each = function(callback){
        var self = this;
        Object.keys(self._items).forEach(function(itemId){
            Object.keys(self._items[itemId]).forEach(function(vote){
                callback(itemId, vote, self._items[itemId][vote]);
            });
        });
        return this;
    };

    function ElectionDb(coll,syncIval){
        this._coll          = coll;
        this._syncIval      = syncIval;
        this._cache         = {};
        this._keeper        = new promise.Keeper();

        if (!this._coll){
            throw new Error('A mongo db connection is required.');
        }

        if (!this._syncIval){
            this._syncIval = 10000;
        }

        if (this._syncIval < 1000){
            throw new Error('ElectionDb syncIval cannot be less than 1000 ms.');
        }
    }

    ElectionDb.prototype.shouldSync = function(lastSync){
        if (!lastSync){
            return true;
        }

        if (this._syncIval < 60000){
            return ((new Date()).valueOf() - lastSync.valueOf()) >= this._syncIval;
        }

        return ((Math.ceil((new Date()).valueOf() / 1000) * 1000) -
                (Math.floor(lastSync.valueOf() / 1000) * 1000)) >= this._syncIval;
    };

    ElectionDb.prototype.getCachedElections = function(){
        var result = [], self = this;
        Object.keys(self._cache).forEach(function(key){
            result.push(self._cache[key]);
        });

        return result;
    };
    
    // Call syncElections with the elections in the cache that have pending votes.
    ElectionDb.prototype.syncCached = function() {
        var self = this,
            updates = self.getCachedElections().filter(function(election) {
                return election && election.votingBooth && election.votingBooth.dirty;
            });
        
        return self.syncElections(updates.map(function(election) {
            return election.id;
        }));
    };

    // Retrieve elections, verify all pending votes for them, and then write them to the database.
    ElectionDb.prototype.syncElections = function(electionIds) {
        var self = this,
            foundElections = [],
            log = logger.getLog();
            
        if (!(electionIds instanceof Array)) {
            log.warn('syncElections got %1 instead of an array of ids', typeof electionIds);
            return q.reject('Must pass an array of ids');
        }
        
        if (electionIds.length === 0) {
            return q([]);
        }

        return q.npost(self._coll.find({ id: { '$in': electionIds } }), 'toArray')
        .then(function(items) {
            return q.allSettled(items.map(function(item) {
                var election = self._cache[item.id],
                    voteCounts;

                function finishSync(item) {
                    log.info('Synced election %1 successfully', item.id);
                    
                    delete item._id;
                    var election        = self._cache[item.id] || {};
                    election.id         = item.id;
                    election.lastSync   = new Date();
                    election.data       = item;
                    if (!election.votingBooth) {
                        election.votingBooth = new VotingBooth(item.id);
                    } else {
                        election.votingBooth.clear();
                    }
                    self._cache[item.id] = election;

                    return q(election.data);
                }
                
                // leave electionIds as an array of unfound cached elections that should be removed
                foundElections.push(item.id);

                if (!election || !election.votingBooth || !election.votingBooth.dirty) {
                    return finishSync(item);
                }
                
                election.votingBooth.each(function(ballotId, vote, count) {
                    if (item.ballot[ballotId] && item.ballot[ballotId][vote] !== undefined) {
                        if (voteCounts === undefined) {
                            voteCounts = {};
                        }
                        if (typeof count !== 'number') {
                            count = 0;
                        }
                        voteCounts['ballot.' + ballotId + '.' + vote] = count;
                    } else {
                        log.info('%1.%2 not found in election %3, so not writing it',
                                 ballotId, vote, item.id);
                    }
                });
                
                if (!voteCounts) {
                    log.info('No valid votes for election %1, not writing to database', item.id);
                    return finishSync(item);
                }
                
                log.info('Saving %1 updates to election %2',Object.keys(voteCounts).length,item.id);
                var args = [{'id':item.id},null,{'$inc':voteCounts},{new:true,w:0,journal:true}];

                return q.npost(self._coll, 'findAndModify', args).then(function(results) {
                    return finishSync(results[0]);
                })
                .catch(function(error) {
                    log.error('Error syncing election %1: %2', item.id, util.inspect(error));
                    return q(item); // still show client these elections even if write failed
                });
            }));
        })
        .then(function(responses) {
            var results = [];
            
            responses.forEach(function(response) {
                if (response.state === 'fulfilled') {
                    results.push(response.value);
                }
            });
            electionIds.forEach(function(id) {
                if (foundElections.indexOf(id) < 0) {
                    log.info('Unable to find election [%1], removing from cache', id);
                    delete self._cache[id];
                }
            });
            
            return q(results);
        })
        .catch(function(error) {
            log.error('Error syncing elections: %1', util.inspect(error));
            return q.reject(error);
        });
    };

    ElectionDb.prototype.getElection = function(electionId, timeout, user) {
        var self = this,
            log = logger.getLog(),
            deferred = self._keeper.getDeferred(electionId),
            election = self._cache[electionId],
            promise;

        function filter(election) {
            if (election && (election.status === Status.Deleted ||
                !(app.checkScope(user,election,'read') || election.status === Status.Active))) {
                log.info('User %1 not allowed to read election %2',
                          user && user.id || 'guest', electionId);
                return q();
            } else {
                return q(mongoUtils.unescapeKeys(election));
            }
        }

        if (election && election.data && !self.shouldSync(election.lastSync) && !user) {
            return filter(election.data);
        }

        if (!deferred) {
            deferred = self._keeper.defer(electionId);
            self.syncElections([electionId]).then(function(items) {
                deferred.resolve(items[0]);
            }).catch(function(error) {
                deferred.reject(error);
            }).finally(function() {
                self._keeper.remove(electionId);
            });
        }
            
        promise = deferred.promise.then(filter);
        if (timeout) {
            return promise.timeout(timeout);
        }
        return promise;
    };

    ElectionDb.prototype.recordVote = function(vote){
        var self = this, election = self._cache[vote.election];

        if (!election){
            election = {
                id          : vote.election,
                data        : null,
                votingBooth : null,
                lastSync    : new Date()
            };
            self._cache[vote.election] = election;
        }

        if (!election.votingBooth){
            election.votingBooth = new VotingBooth(vote.election);
        }

        election.votingBooth.voteForBallotItem(vote.ballotItem, vote.vote);

        if (election.data){
            if (election.data.ballot[vote.ballotItem]) {
                if (election.data.ballot[vote.ballotItem][vote.vote]){
                    election.data.ballot[vote.ballotItem][vote.vote] += 1;
                } else {
                    election.data.ballot[vote.ballotItem][vote.vote] = 1;
                }
            }
        }

        return self;
    };
    
    app.convertObjectValsToPercents = function(ballotItem){
        var sum = 0,
            result = ballotItem instanceof Array ? [] : {};

        Object.keys(ballotItem).forEach(function(key){
            result[key] = 0;
            sum += ballotItem[key];
        });

        if (sum > 0){
            Object.keys(ballotItem).forEach(function(key){
                result[key] = Math.round( (ballotItem[key] / sum) * 100) / 100;
            });
        }

        return result;
    };

    app.convertElection = function(election){
        var result = {};
        result.id = election.id;
        result.ballot = {};
        Object.keys(election.ballot).forEach(function(ballotId){
            result.ballot[ballotId] = app.convertObjectValsToPercents(election.ballot[ballotId]);
        });

        return result;
    };

    app.createValidator = new FieldValidator({
        forbidden: ['id', 'created'],
        condForbidden: {
            org:    function(elec, orig, requester) {
                        var eqFunc = FieldValidator.eqReqFieldFunc('org'),
                            scopeFunc = FieldValidator.scopeFunc('elections', 'create', Scope.All);
                        return eqFunc(elec, orig, requester) || scopeFunc(elec, orig, requester);
                    }
        }
    });
    app.updateValidator = new FieldValidator({ forbidden: ['id', 'org', 'created', '_id'] });

    app.createElection = function(req, elections) {
        var obj = req.body,
            user = req.user,
            log = logger.getLog(),
            now = new Date();

        if (typeof obj !== 'object' || Object.keys(obj).length === 0) {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        if (typeof obj.ballot !== 'object' || Object.keys(obj.ballot).length === 0) {
            log.info('[%1] User %2 tried to create election with empty ballot', req.uuid, user.id);
            return q({code: 400, body: 'Must provide non-empty ballot'});
        }
        if (!app.createValidator.validate(obj, {}, user)) {
            log.warn('[%1] election contains illegal fields', req.uuid);
            log.trace('obj: %1  |  requester: %2', JSON.stringify(obj), JSON.stringify(user));
            return q({code: 400, body: 'Illegal fields'});
        }
        obj.id = 'el-' + uuid.createUuid().substr(0,14);
        log.trace('[%1] User %2 is creating election %3', req.uuid, user.id, obj.id);
        obj.created = now;
        obj.lastUpdated = now;
        obj.user = user.id;
        if (!obj.status) {
            obj.status = Status.Active;
        }
        if (user.org) {
            obj.org = user.org;
        }
        return q.npost(elections, 'insert', [mongoUtils.escapeKeys(obj), {w: 1, journal: true}])
        .then(function() {
            delete obj._id;
            log.info('[%1] User %2 successfully created election %3', req.uuid, user.id, obj.id);
            return q({code: 201, body: mongoUtils.unescapeKeys(obj)});
        }).catch(function(error) {
            log.error('[%1] Error creating election %2 for user %3: %4',
                      req.uuid, obj.id, user.id, error);
            return q.reject(error);
        });
    };
    
    app.updateElection = function(req, elections) {
        var updates = req.body,
            id = req.params.id,
            user = req.user,
            log = logger.getLog(),
            deferred = q.defer();
        if (!updates || typeof updates !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
        }
        
        log.info('[%1] User %2 is attempting to update election %3',req.uuid,user.id,id);
        q.npost(elections, 'findOne', [{id: id}])
        .then(function(orig) {
            if (!orig) {
                log.info('[%1] Election %2 does not exist; not creating it', req.uuid, id);
                return deferred.resolve({code: 404, body: 'That election does not exist'});
            }
            if (!app.updateValidator.validate(updates, orig, user)) {
                log.warn('[%1] updates contain illegal fields', req.uuid);
                log.trace('updates: %1  |  orig: %2  |  requester: %3',
                          JSON.stringify(updates), JSON.stringify(orig), JSON.stringify(user));
                return deferred.resolve({code: 400, body: 'Illegal fields'});
            }
            if (!app.checkScope(user, orig, 'edit')) {
                log.info('[%1] User %2 is not authorized to edit %3', req.uuid, user.id, id);
                return deferred.resolve({
                    code: 403,
                    body: 'Not authorized to edit this election'
                });
            }
            
            updates.lastUpdated = new Date();
            updates = mongoUtils.escapeKeys(updates);

            if (updates.ballot) {
                var ballotUpdates = updates.ballot;
                delete updates.ballot;
                if (typeof ballotUpdates === 'object' && !(ballotUpdates instanceof Array)) {
                    Object.keys(ballotUpdates).forEach(function(key) {
                        if (!orig.ballot[key]) {
                            updates['ballot.' + key] = ballotUpdates[key];
                        }
                    });
                }
            }

            var opts = {w: 1, journal: true, new: true};
            return q.npost(elections, 'findAndModify', [{id: id}, {id: 1}, {$set: updates}, opts])
            .then(function(results) {
                var updated = results[0];
                delete updated._id;
                log.info('[%1] User %2 successfully updated election %3',
                         req.uuid, user.id, updated.id);
                deferred.resolve({code: 200, body: mongoUtils.unescapeKeys(updated)});
            });
        }).catch(function(error) {
            log.error('[%1] Error updating election %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };
    
    app.deleteElection = function(req, elections) {
        var id = req.params.id,
            user = req.user,
            log = logger.getLog(),
            deferred = q.defer(),
            now;
        log.info('[%1] User %2 is attempting to delete election %3', req.uuid, user.id, id);
        q.npost(elections, 'findOne', [{id: id}])
        .then(function(orig) {
            now = new Date();
            if (!orig) {
                log.info('[%1] Election %2 does not exist', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            if (!app.checkScope(user, orig, 'delete')) {
                log.info('[%1] User %2 is not authorized to delete %3', req.uuid, user.id, id);
                return deferred.resolve({
                    code: 403,
                    body: 'Not authorized to delete this election'
                });
            }
            if (orig.status === Status.Deleted) {
                log.info('[%1] Election %2 has already been deleted', req.uuid, id);
                return deferred.resolve({code: 204});
            }
            var updates = { $set: { lastUpdated:now, status:Status.Deleted } };
            return q.npost(elections, 'update', [{id: id}, updates, {w:1, journal:true}])
            .then(function() {
                log.info('[%1] User %2 successfully deleted election %3', req.uuid, user.id, id);
                deferred.resolve({code: 204});
            });
        }).catch(function(error) {
            log.error('[%1] Error deleting election %2 for user %3: %4',
                      req.uuid, id, user.id, error);
            deferred.reject(error);
        });
        return deferred.promise;
    };

    app.main = function(state){
        var log = logger.getLog();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
        
        var elections   = state.dbs.voteDb.collection('elections'),
            users       = state.dbs.c6Db.collection('users'),
            elDb        = new ElectionDb(elections, state.config.idleSyncTimeout),
            started     = new Date(),
            webServer;
        authUtils._coll = users;
        

        state.onSIGTERM = function(){
            log.info('Received sigterm, sync and exit.');
            return elDb.syncCached().then(function(results){
                log.trace('results: %1',JSON.stringify(results));
            });
        };

        webServer = express();
        webServer.use(express.bodyParser());
        webServer.use(express.cookieParser(state.secrets.cookieParser || ''));

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
            authUtils._coll = users;
            log.info('Recreated collections from restarted c6Db');
        });

        state.dbStatus.voteDb.on('reconnected', function() {
            elections = state.dbs.voteDb.collection('elections');
            elDb._coll = elections;
            log.info('Recreated collections from restarted voteDb');
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

        webServer.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', state.config.cacheControl.default);

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        webServer.all('*',function(req, res, next){
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] ||
                    !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method,req.url,req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method,req.url,req.httpVersion);
            }
            next();
        });
        
        webServer.post('/api/public/vote', function(req, res){
            if ((!req.body.election) || (!req.body.ballotItem) || (req.body.vote === undefined)) {
                res.send(400, 'Invalid request.\n');
                return;
            }

            elDb.recordVote(req.body);
            res.send(200);
        });

        webServer.post('/api/vote', function(req, res){
            if ((!req.body.election) || (!req.body.ballotItem) || (req.body.vote === undefined)) {
                res.send(400, 'Invalid request.\n');
                return;
            }

            elDb.recordVote(req.body);
            res.send(200);
        });

        webServer.get('/api/public/election/:electionId', function(req, res){
            if (!req.params || !req.params.electionId ) {
                res.send(400, 'You must provide the electionId in the request url.\n');
                return;
            }

            elDb.getElection(req.params.electionId, state.config.requestTimeout)
                .then(function(election){
                    res.header('cache-control', state.config.cacheControl.getElection);
                    if (!election) {
                        res.send(404, 'Unable to locate election');
                    } else {
                        res.send(200,app.convertElection(election));
                    }
                })
                .catch(function(err){
                    if (err.message.match(/Timed out after/)){
                        err.httpCode = 408;
                    }
                    log.error('getElection Error: %1',err.message);
                    if (err.httpCode){
                        res.send(err.httpCode,err.message + '\n');
                    } else {
                        res.send(500,'Internal error.\n' );
                    }
                });
        });

        var authGetElec = authUtils.middlewarify({elections: 'read'});
        webServer.get('/api/election/:electionId', sessionsWrapper, authGetElec, function(req,res){
            if (!req.params || !req.params.electionId ) {
                res.send(400, 'You must provide the electionId in the request url.\n');
                return;
            }

            elDb.getElection(req.params.electionId, state.config.requestTimeout, req.user)
                .then(function(election){
                    if (!election) {
                        res.send(404, 'Unable to locate election');
                    } else {
                        res.send(200, election);
                    }
                })
                .catch(function(err){
                    if (err.message.match(/Timed out after/)){
                        err.httpCode = 408;
                    }
                    log.error('getElection Error: %1',err.message);
                    if (err.httpCode){
                        res.send(err.httpCode,err.message + '\n');
                    } else {
                        res.send(500,'Internal error.\n' );
                    }
                });
        });

        var authPostElec = authUtils.middlewarify({elections: 'create'});
        webServer.post('/api/election', sessionsWrapper, authPostElec, function(req, res) {
            app.createElection(req, elections)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error creating election',
                    detail: error
                });
            });
        });
        
        var authPutElec = authUtils.middlewarify({elections: 'edit'});
        webServer.put('/api/election/:id', sessionsWrapper, authPutElec, function(req, res) {
            app.updateElection(req, elections)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error updating election',
                    detail: error
                });
            });
        });
        
        var authDelElec = authUtils.middlewarify({elections: 'delete'});
        webServer.delete('/api/election/:id', sessionsWrapper, authDelElec, function(req, res) {
            app.deleteElection(req, elections)
            .then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, {
                    error: 'Error deleting election',
                    detail: error
                });
            });
        });


        webServer.get('/api/vote/meta',function(req, res ){
            res.send(200, {
                version : state.config.appVersion,
                started : started.toISOString(),
                status  : 'OK'
            });
        });

        webServer.get('/api/vote/version',function(req, res ){
            res.send(200, state.config.appVersion );
        });

        webServer.listen(state.cmdl.port);
        log.info('Service is listening on port: ' + state.cmdl.port);

        if(state.config.idleSyncTimeout > 0){
            setInterval(function(){
                log.trace('Idle Sync timeout.');
                elDb.syncCached();
            }, state.config.idleSyncTimeout);
        }

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
        .then(app.main)
        .catch( function(err){
            var log = logger.getLog();
            console.log(err.message);
            log.error(err.message);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        })
        .done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = {
            'app'         : app,
            'ElectionDb'  : ElectionDb,
            'VotingBooth' : VotingBooth
        };
    }
}());
