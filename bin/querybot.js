#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var q                 = require('q'),
    path              = require('path'),
    express           = require('express'),
    bodyParser        = require('body-parser'),
    inherits          = require('util').inherits,
    expressUtils      = require('../lib/expressUtils'),
    logger            = require('../lib/logger'),
    pgUtils           = require('../lib/pgUtils'),
    authUtils         = require('../lib/authUtils'),
    service           = require('../lib/service'),
    state   = {},
    lib     = {};

function ServiceError(message, status) {
    Error.call(this, message);

    this.message = message;
    this.status = status;
}
inherits(ServiceError, Error);

ServiceError.prototype.toString = function toString() {
    return '[' + this.status + '] ' + this.message;
};

lib.ServiceError = ServiceError;

state.defaultConfig = {
    appName: 'querybot',
    appDir: __dirname,
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
    },
    sessions: {
        key: 'c6Auth',
        maxAge: 30*60*1000,         // 30 minutes; unit here is milliseconds
        minAge: 60*1000,            // TTL for cookies for unauthenticated users
        secure: false,              // true == HTTPS-only; set to true for staging/production
        mongo: {
            host: null,
            port: null,
            retryConnect : true
        }
    },
    secretsPath: path.join(process.env.HOME,'.querybot.secrets.json'),
    rcAppCredsPath: path.join(process.env.HOME,'.rcAppCreds.json'),
    mongo: {
        c6Db: {
            host: null,
            port: null,
            retryConnect : true
        }
    },
    pg : {
        defaults : {
            poolSize        : 20,
            poolIdleTimeout : 900000
        }
    },
    cache: {
        timeouts: {},
        servers: null
    },
    api : {
        root: 'http://localhost/'
    },
    cloudwatch: {
        namespace: 'C6/Querybot',
        region: 'us-east-1',
        sendInterval: (1 * 60 * 1000), // 1 min
        environment : 'Development'
    },
    campaignCacheTTL : 120 * 1000,
    requestMaxAge : 300
};

lib.campaignCacheGet = function(key) {
    if (state.config.campaignCacheTTL > 0) {
        return state.cache.get(key);
    }
    return q();
};

lib.campaignCacheSet = function(key,val) {
    if (state.config.campaignCacheTTL > 0) {
        return state.cache.set(key,val,state.config.campaignCacheTTL);
    }
    return q();
};

lib.main = function(state) {
    var log = logger.getLog(),
        started = new Date();
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }
    log.info('Running as cluster worker, proceed with setting up web server.');
    require('aws-sdk').config.update({ region: state.config.cloudwatch.region });

    var app = express();
    
    authUtils._db = state.dbs.c6Db;

    app.set('trust proxy', 1);
    app.set('json spaces', 2);

    app.use(expressUtils.basicMiddleware());

    app.use(bodyParser.json());

    app.get('/api/analytics/meta', function(req, res){
        var data = {
            version: state.config.appVersion,
            started : started.toISOString(),
            status : 'OK'
        };
        res.send(200, data);
    });

    app.get('/api/analytics/version',function(req, res) {
        res.send(200, state.config.appVersion);
    });
    
    app.use(function(req, res, next) {
        res.header('cache-control', 'max-age=' + state.config.requestMaxAge);
        next();
    });
    
    var sessions = state.sessions;
    
    var authGetCamp = authUtils.middlewarify({
        allowApps: true,
        permissions: { campaigns: 'read' }
    });

    require('./querybot-selfie')({
        app : app,
        lib : lib,
        callbacks : {
            sessions : sessions,
            authGetCamp : authGetCamp
        },
        pgUtils : pgUtils,
        state   : state,
    });
    
    app.use(expressUtils.errorHandler());
    
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
    .then(service.initSessions)
    .then(service.initPubSubChannels)
    .then(service.initCache)
    .then(pgUtils.initConfig)
    .then(lib.main)
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
    lib._state = state;
    module.exports = lib;
}
