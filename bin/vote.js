#!/usr/bin/env node
var q           = require('q'),
    express     = require('express'),
    service     = require('../lib/service'),
    uuid        = require('../lib/uuid'),
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

function VoteData(db,syncIval){
    this._db            = db;
    this._syncIval      = syncIval;
    this._cache         = {};

    this._deferred = {};

    if (!this._db){
        throw new Error('A mongo db connection is required.');
    }

    if (!this._syncIval){
        this._syncIval = 10000;
    }

    if (this._syncIval < 1000){
        throw new Error('VoteData syncIval cannot be less than 1000 ms.');
    }
}

VoteData.prototype.shouldSync = function(lastSync){
    if (!lastSync){
        return true;
    }

    return ((new Date()).valueOf() - lastSync) > this._syncIval;
};

VoteData.prototype.getElection    = function(electionId){
    if (this._deferred[electionId]){
        return this._deferred[electionId].promise;
    }

    var self = this, election = self._cache[electionId] ;

    if (election && !self.shouldSync(election.lastSync)){
        return q(election.data);
    }
   
    self._deferred[electionId] = q.defer();
    
    self._db.findOne({'electionId' : electionId}, function(err,item){
        var deferred = self._deferred[electionId];
        delete self._deferred[electionId];
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
            self._cache[electionId] = election;
            deferred.resolve(election.data);
        }
    });

    return self._deferred[electionId].promise;
};

VoteData.prototype.getBallotItem  = function(electionId,itemId){
    var defKey = electionId + '::' + itemId, self = this;
    if (self._deferred[defKey]){
        return self._deferred[defKey];
    }

    self._deferred[defKey] = q.defer();

    self.getElection(electionId)
        .then(function(election){
            var deferred = self._deferred[defKey];
            delete self._deferred[defKey];   

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
                deferred.resolve(election.ballot[itemId]);
            }
        })
        .catch(function(err){
            var deferred = self._deferred[defKey];
            delete self._deferred[defKey];   
            deferred.reject(err);
        });

    return self._deferred[defKey].promise;
};

VoteData.prototype.recordVote     = function(ballot){

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
        'app'       : app,
        'VoteData'  : VoteData
    };
}
