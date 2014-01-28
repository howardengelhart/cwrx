#!/usr/bin/env node
var q           = require('q'),
    express     = require('express'),
    path        = require('path'),
    service     = require('../lib/service'),
    uuid        = require('../lib/uuid'),
    promise     = require('../lib/promise'),
    logger      = require('../lib/logger'),
    __ut__      = (global.jasmine !== undefined) ? true : false,
    app         = {},
    state       = {};

state.name = 'vote';
state.defaultConfig = {
    log    : {
        logLevel : 'info',
        media    : [ { type : 'console' } ]
    },
    pidFile : 'vote.pid',
    pidDir  : './',
    secretsPath: path.join(process.env.HOME,'.auth.secrets.json'),
    mongo : {
        host: null,
        port: null,
        db  : null,
        retryConnect : true
    }
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
    var ballotItem;
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
    this._voteCache     = {};
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

    return ((new Date()).valueOf() - lastSync.valueOf()) > this._syncIval;
};

ElectionDb.prototype.getElection = function(electionId, timeout) {
    var self = this, deferred = self._keeper.getDeferred(electionId),
        election = self._cache[electionId], voteCounts;

    if (deferred) {
        if (timeout) {
            return deferred.promise.timeout(timeout);
        }
        return deferred.promise;
    }

    if (election && !self.shouldSync(election.lastSync)){
        return q(election.data);
    }
  
    deferred    = self._keeper.defer(electionId);

    if (election && (election.votingBooth) && (election.votingBooth.dirty)){
        election.votingBooth.each(function(ballotId,vote,count){
            if (voteCounts === undefined) {
                voteCounts = {};
            }
            voteCounts['ballot.' + ballotId + '.returns.' + vote] = count;
        });
    }

    if (voteCounts) {
        self._coll.findAndModify({ 'id' : electionId }, null,
            { $inc : voteCounts }, { new : true }, function(err, result){

            var deferred = self._keeper.remove(electionId);
            if (!deferred){
            // log error here
                return;
            }

            if (err){
                err.httpCode = 400;
                deferred.reject(err);
            }
            else if ((result === null) || (result[0] === null)){
                var error = new Error('Unable to locate election.');
                error.httpCode = 404;
                deferred.reject(error);
            } else {
                delete result[0]._id;
                election.lastSync   = new Date();
                election.data       = result[0];
                election.votingBooth.clear();
                deferred.resolve(election.data);
            }
        });
    } else {
        self._coll.findOne({'id' : electionId}, function(err,item){
            var deferred = self._keeper.remove(electionId);
            if (!deferred){
            // log error here
                return;
            }
            if (err) {
                err.httpCode = 400;
                deferred.reject(err);
            }
            else if (item === null){
                var error = new Error('Unable to locate election.');
                error.httpCode = 404;
                deferred.reject(error);
            } else {
                delete item._id;
                election            = self._cache[electionId] || {};
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

    if (timeout) {
        return deferred.promise.timeout(timeout);
    }

    return deferred.promise;
};

ElectionDb.prototype.getBallotItem  = function(id,itemId,timeout){
    var defKey = id + '::' + itemId, self = this, deferred = self._keeper.getDeferred(defKey);
    if (deferred){
        if (timeout) {
            return deferred.promise.timeout(timeout);
        }

        return deferred.promise;
    }

    deferred = self._keeper.defer(defKey);

    self.getElection(id)
        .then(function(election){
            var deferred = self._keeper.remove(defKey);

            if (!election.ballot){
                deferred.reject(
                    new Error('Corrupt election, missing ballot.')
                );
            }
            else if (!election.ballot[itemId]){
                deferred.reject(
                    new Error('Unable to locate ballot item.')
                );
            } else {
                deferred.resolve({
                    election    : id,
                    ballotItem  : itemId,
                    votes       : election.ballot[itemId]
                });
            }
        })
        .catch(function(err){
            var deferred = self._keeper.remove(defKey);
            deferred.reject(err);
        });

    if (timeout) {
        return deferred.promise.timeout(timeout);
    }

    return deferred.promise;
};

ElectionDb.prototype.recordVote     = function(vote){
    var self = this, election = self._cache[vote.election];

    if (!election){
        election = {
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



app.main = function(state){
    var log = logger.getLog(), webServer,
        elDb = new ElectionDb(state.db.collection('elections'));
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }

    log.info('Running as cluster worker, proceed with setting up web server.');
    webServer = express();
    webServer.use(express.bodyParser());

    webServer.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", 
                   "Origin, X-Requested-With, Content-Type, Accept");
//        res.header("cache-control", "max-age=0");

        if (req.method.toLowerCase() === "options") {
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

    webServer.get('/election/:electionId', function(req, res, next){
        if (!req.params || !req.params.electionId ) {
            res.send(400, 'You must provide the electionId in the request url.\n');
            return;
        }

        elDb.getElection(req.params.electionId,2000)
            .then(function(election){
                res.send(200,election);
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

    webServer.get('/election/:electionId/ballot/:itemId', function(req, res, next){
        if (!req.params || !req.params.electionId || !req.params.itemId) {
            res.send(400, 'You must provide the electionId and itemId in the request url.\n');
            return;
        }
        res.send(200,
            'Election is: ' + req.params.electionId + '\n' + 
            'Item id is: ' + req.params.itemId + '\n');
    });

    webServer.listen(state.cmdl.port);
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
        'ElectionDb'  : ElectionDb,
        'VotingBooth' : VotingBooth
    };
}
