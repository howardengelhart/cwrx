#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var q                 = require('q'),
    path              = require('path'),
    express           = require('express'),
    bodyParser        = require('body-parser'),
    inherits          = require('util').inherits,
    url               = require('url'),
    requestUtils      = require('../lib/requestUtils'),
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

lib.lookupCampaigns = function(req){
    var log = logger.getLog(),
        urlBase = url.resolve(state.config.api.root , '/api/campaigns/'),
        ids = {}, idList = '';

    if (req.params.id) {
        ids[req.params.id] = 1;
    }
    else
    if (req.query.ids) {
        req.query.ids.split(',').forEach(function(id){
            ids[id] = 1;
        });
    }

    ids = Object.keys(ids);
    if( ids.length === 0) {
        return q.reject(new ServiceError('At least one campaignId is required.', 400));
    }

    idList = ids.join(',');
    log.trace('[%1] campaign check: %2, ids=%3', req.uuid,urlBase , idList);
    return requestUtils.proxyRequest(req, 'get', {
        url: urlBase,
        qs : {
            ids    : idList,
            fields : 'id'
        }
    })
    .then(function(resp){
        var result;
        log.trace('[%1] STATUS CODE: %2',req.uuid,resp.response.statusCode);
        if (resp.response.statusCode === 200) {
            log.trace('[%1] campaign found: %2',req.uuid,resp.response.body);
            result = resp.body;
        } else {
            log.error('[%1] Campaign Check Failed with: %2 : %3',
                req.uuid,resp.response.statusCode,resp.body);
            result = [];
        }
        return result;
    });
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
    
    var params = {
        app       : app,
        authUtils : authUtils,
        lib : {
            ServiceError     : lib.ServiceError,
            lookupCampaigns  : lib.lookupCampaigns,
            campaignCacheGet : lib.campaignCacheGet,
            campaignCacheSet : lib.campaignCacheSet
        },
        pgUtils : pgUtils,
        state   : state
    };

    require('./querybot-selfie')(params);
    require('./querybot-ssb_apps')(params);
    
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
