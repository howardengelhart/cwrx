#!/usr/bin/env node
(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        path            = require('path'),
        service         = require('../lib/service'),
        uuid            = require('../lib/uuid'),
        promise         = require('../lib/promise'),
        logger          = require('../lib/logger'),
        FieldValidator  = require('../lib/fieldValidator'),
        authUtils       = require('../lib/authUtils')(),
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
        cacheTTLs: {
            auth: {
                freshTTL: 1,
                maxTTL: 10
            }
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
            this._items[itemId] = { };
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

    ElectionDb.prototype.getElectionFromCache = function(electionId){
        return this._cache[electionId];
    };

    ElectionDb.prototype.getCachedElections = function(){
        var result = [], self = this;
        Object.keys(self._cache).forEach(function(key){
            result.push(self._cache[key]);
        });

        return result;
    };

    ElectionDb.prototype.updateVoteCounts = function(){
        var self = this, updates = [], log = logger.getLog();
        Object.keys(self._cache).forEach(function(key){
            var election = self._cache[key], u = {};
            if ((election.votingBooth) && (election.votingBooth.dirty)){
                u.election = election;
                election.votingBooth.each(function(ballotId,vote,count){
                    if (u.voteCounts === undefined) {
                        u.voteCounts = {};
                    }
                    u.voteCounts['ballot.' + ballotId + '.' + vote] = count;
                });
                updates.push(u);
            }
        });

        log.trace('updates to save: %1',updates.length);
        return q.allSettled(updates.map(function(update){
            var deferred = q.defer();
            q.ninvoke(self._coll,'update',
                { 'id' : update.election.id }, { $inc : update.voteCounts }, { w : 1 })
                .then(function(){
                    update.election.votingBooth.clear();
                    deferred.resolve(update);
                })
                .catch(function(err){
                    err.update = update;
                    deferred.reject(err);
                });
            return deferred.promise;
        }));
    };

    ElectionDb.prototype.getElection = function(electionId, timeout, user) {
        var self = this,
            deferred = self._keeper.getDeferred(electionId),
            election = self._cache[electionId],
            log = logger.getLog(),
            voteCounts, promise;
        function filter(election) {
            if (election &&
                !(app.checkScope(user,election,'read') || election.status === Status.Active)) {
                log.info('User %1 not allowed to read election %2',
                          user && user.id || 'guest', electionId);
                return q();
            } else {
                return q(election);
            }
        }

        if (deferred) {
            promise = deferred.promise.then(filter);
            if (timeout) {
                return promise.timeout(timeout);
            }
            return promise;
        }

        if (election && election.data && !self.shouldSync(election.lastSync) && !user){
            return filter(election.data);
        }

        deferred = self._keeper.defer(electionId);

        if (election && (election.votingBooth) && (election.votingBooth.dirty)){
            election.votingBooth.each(function(ballotId,vote,count){
                if (voteCounts === undefined) {
                    voteCounts = {};
                }
                voteCounts['ballot.' + ballotId + '.' + vote] = count;
            });
        }

        if (voteCounts) {
            log.trace('findAndModify: [%1] %2',electionId, JSON.stringify(voteCounts));
            self._coll.findAndModify({ 'id' : electionId }, null,
                { '$inc' : voteCounts }, { new : true }, function(err, result){
                if (err) {
                    log.error('getElection::findAndModify - %1:',err.message);
                } else {
                    log.trace('getElection::findAndModify item: %1',JSON.stringify(result));
                }

                var deferred = self._keeper.remove(electionId);
                if (!deferred){
                    log.error('Promise of findAndModify call for %1 has been removed or resolved',
                              electionId);
                    return;
                }

                if (err){
                    err.httpCode = 400;
                    deferred.reject(err);
                }
                else if (result === null) {
                    log.warn('Unable to find cached election [%1] in db, removing from cache',
                             electionId);
                    delete self._cache[electionId];
                    deferred.resolve();
                } else {
                    delete result._id;
                    election.lastSync   = new Date();
                    election.data       = result;
                    election.votingBooth.clear();
                    deferred.resolve(election.data);
                }
            });
        } else {
            log.trace('findOne: [%1]',electionId);
            self._coll.findOne({'id' : electionId}, function(err,item){
                if (err) {
                    log.error('getElection::findOne - %1:',err.message);
                } else {
                    log.trace('getElection::findOne item: %1',JSON.stringify(item));
                }
                var deferred = self._keeper.remove(electionId);
                if (!deferred){
                    log.error('Promise of findOne call for %1 has been removed or resolved',
                              electionId);
                    return;
                }
                if (err) {
                    err.httpCode = 400;
                    deferred.reject(err);
                }
                else if (item === null){
                    log.info('Unable to find election [%1], removing from cache',electionId);
                    delete self._cache[electionId];
                    deferred.resolve();
                } else {
                    delete item._id;
                    election            = self._cache[electionId] || {};
                    election.id         = electionId;
                    election.lastSync   = new Date();
                    election.data       = item;
                    if (!election.votingBooth) {
                        election.votingBooth = new VotingBooth(electionId);
                    }
                    self._cache[electionId] = election;

                    deferred.resolve(election.data);
                }
            });
        }

        promise = deferred.promise.then(filter);
        if (timeout) {
            return promise.timeout(timeout);
        }

        return promise;
    };

    ElectionDb.prototype.recordVote     = function(vote){
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
    
    app.convertObjectValsToPercents = function(object){
        var sum = 0, result = {};

        Object.keys(object).forEach(function(key){
            result[key] = 0;
            sum += object[key];
        });

        if (sum > 0){
            Object.keys(object).forEach(function(key){
                result[key] = Math.round( (object[key] / sum) * 100) / 100;
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

    app.syncElections = function(elDb){
        var log = logger.getLog(),
            cached = elDb.getCachedElections();
        return q.allSettled(cached.map(function(election){
            if (election.votingBooth.dirty){
                log.trace('sync Election %1', election.id);
                return elDb.getElection(election.id);
            }
            return q(true);
        }))
        .catch(function(error){
            log.trace('Failed with: %1',error.message);
        });
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
    app.updateValidator = new FieldValidator({ forbidden: ['id', 'org', 'created'] });

    app.createElection = function(req, elections) {
        var obj = req.body,
            user = req.user,
            log = logger.getLog(),
            now = new Date();

        if (!obj || typeof obj !== 'object') {
            return q({code: 400, body: 'You must provide an object in the body'});
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
        return q.npost(elections, 'insert', [obj, {w: 1, journal: true}])
        .then(function() {
            log.info('[%1] User %2 successfully created election %3', req.uuid, user.id, obj.id);
            return q({code: 201, body: obj});
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
            var opts = {w: 1, journal: true, new: true};
            return q.npost(elections, 'findAndModify', [{id: id}, {id: 1}, {$set: updates}, opts])
            .then(function(results) {
                var updated = results[0];
                log.info('[%1] User %2 successfully updated election %3',
                         req.uuid, user.id, updated.id);
                deferred.resolve({code: 200, body: updated});
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
        var log         = logger.getLog(),
            elections   = state.dbs.voteDb.collection('elections'),
            users       = state.dbs.c6Db.collection('users'),
            elDb        = new ElectionDb(elections, state.config.idleSyncTimeout),
            started     = new Date(),
            authTTLs    = state.config.cacheTTLs.auth,
            webServer;
        authUtils = require('../lib/authUtils')(authTTLs.freshTTL, authTTLs.maxTTL, users);
        
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }

        state.onSIGTERM = function(){
            log.info('Received sigterm, sync and exit.');
            return elDb.updateVoteCounts().then(function(results){
                log.trace('results: %1',JSON.stringify(results));
            });
        };

        log.info('Running as cluster worker, proceed with setting up web server.');
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
            if ((!req.body.election) || (!req.body.ballotItem) ||  (!req.body.vote)) {
                res.send(400, 'Invalid request.\n');
                return;
            }

            elDb.recordVote(req.body);
            res.send(200);
        });

        webServer.post('/api/vote', function(req, res){
            if ((!req.body.election) || (!req.body.ballotItem) ||  (!req.body.vote)) {
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
        webServer.get('/api/election/:electionId', sessions, authGetElec, function(req, res){
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
        webServer.post('/api/election', sessions, authPostElec, function(req, res) {
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
        webServer.put('/api/election/:id', sessions, authPutElec, function(req, res) {
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
        webServer.delete('/api/election/:id', sessions, authDelElec, function(req, res) {
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
                app.syncElections(elDb);
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
