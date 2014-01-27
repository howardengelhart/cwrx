#!/usr/bin/env node
var q           = require('q'),
    express     = require('express'),
    service     = require('../lib/service'),
    uuid        = require('../lib/uuid'),
    promise    = require('../lib/promise'),
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
    pidDir  : './'
};


function VotingBooth(electionId){
    var self        = this;
    self._id        = electionId;
    self._items     = {};
    self._lastSync  = new Date();

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
    
    Object.defineProperty(self,'lastSync', {
        get : function() {
            return self._lastSync;
        }
    });
}

VotingBooth.prototype.markSynced = function(){
    this._items     = {};
    this._lastSync  =  new Date();
};

VotingBooth.prototype.clear = function(){
    this._items     = {};
    this._lastSync = null;
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

    return ((new Date()).valueOf() - lastSync) > this._syncIval;
};

ElectionDb.prototype.getElection    = function(id,timeout){
    var self = this, election, votingBooth, voteCount, deferred = self._keeper.getDeferred(id);

    if (deferred){
        if (timeout) {
            return deferred.promise.timeout(timeout);
        }
        return deferred.promise;
    }

    election = self._cache[id] ;

    if (election && !self.shouldSync(election.lastSync)){
        return q(election.data);
    }
   
    deferred    = self._keeper.defer(id);
    votingBooth = self._voteCache[id];

    if (votingBooth && votingBooth.dirty){
        votingBooth.each(function(ballotId,vote,count){
            if (voteCount === undefined) {
                voteCount = {};
            }
            voteCount['ballot.' + ballotId + '.returns.' + vote] = count;
        });
    }

    if (voteCount) {
        self._coll.findAndModify({ 'id' : id }, null, { $inc : voteCount }, { new : true },
                function(err, result){
            var deferred = self._keeper.remove(id);

            if (err){
                deferred.reject(err);
            }
            else if ((result === null) || (result[0] === null)){
                deferred.reject(new Error('Unable to locate election'));
            } else {
                election = {
                    lastSync : (new Date()).valueOf(),
                    data     : result[0]
                };
                
                delete election.data._id;
                self._cache[id] = election;
                deferred.resolve(election.data);
            }
        });
        votingBooth.markSynced();
    } else {
        self._coll.findOne({'id' : id}, function(err,item){
            var deferred = self._keeper.remove(id);
            if (err) {
                deferred.reject(err);
            }
            else if (item === null){
                deferred.reject(new Error('Unable to locate election'));
            } else {
                election = {
                    lastSync : (new Date()).valueOf(),
                    data     : item
                };

                delete election.data._id;
                self._cache[id] = election;
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
    var self = this, voteCache = self._voteCache, votingBooth, voteCount;

    if (!voteCache[vote.election]){
        voteCache[vote.election] = new VotingBooth(vote.election);
    }
    votingBooth = voteCache[vote.election];
    votingBooth.voteForBallotItem(vote.ballotItem, vote.vote);

    if (self._cache[vote.election]){
        if (self._cache[vote.election].data.ballot[vote.ballotItem]) {
            if (self._cache[vote.election].data.ballot[vote.ballotItem][vote.vote]){
                self._cache[vote.election].data.ballot[vote.ballotItem][vote.vote] += 1;
            } else {
                self._cache[vote.election].data.ballot[vote.ballotItem][vote.vote] = 1;
            }
        }
    }

    if (self.shouldSync(votingBooth.lastSync)){
        votingBooth.each(function(ballotId,vote,count){
            if (voteCount === undefined) {
                voteCount = {};
            }
            voteCount['ballot.' + ballotId + '.returns.' + vote] = count;
        });
        self._coll.findAndModify({ 'id' : vote.election },
                    null, { $inc : voteCount }, { new : true }, function(err, result){
            if (err){
                //deferred.reject(err);
            }
            else if ((result === null) || (result[0] === null)){
                //deferred.reject(new Error('Unable to locate election'));
            } else {
                var election = {
                    lastSync : (new Date()).valueOf(),
                    data     : result[0]
                };
                
                delete election.data._id;
                self._cache[id] = election;
                //deferred.resolve(election.data);
            }
        });
        votingBooth.markSynced();
    }

    return self;
};



app.main = function(state){
    var log = logger.getLog(), webServer;
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
        res.send(200,'Election is: ' + req.params.electionId + '\n');
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
