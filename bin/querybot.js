#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var q               = require('q'),
    path            = require('path'),
    express         = require('express'),
    bodyParser      = require('body-parser'),
    sessionLib      = require('express-session'),
    pg              = require('pg.js'),
    dbpass          = require('../lib/dbpass'),
    logger          = require('../lib/logger'),
    uuid            = require('../lib/uuid'),
    authUtils       = require('../lib/authUtils'),
    service         = require('../lib/service'),
    state   = {},
    lib     = {};

state.defaultConfig = {
    appName: 'querybot',
    appDir: __dirname,
    caches : { //TODO: may want to rename this now...
        run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
    },
    sessions: {
        key: 'c6Auth',
        maxAge: 14*24*60*60*1000,   // 14 days; unit here is milliseconds
        minAge: 60*1000,            // TTL for cookies for unauthenticated users
        secure: false,              // true == HTTPS-only; set to true for staging/production
        mongo: {
            host: null,
            port: null,
            retryConnect : true
        }
    },
    secretsPath: path.join(process.env.HOME,'.querybot.secrets.json'),
    mongo: {
        c6Db: {
            host: null,
            port: null,
            retryConnect : true
        },
        c6Journal: {
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
    }
};

lib.pgInit = function(state) {
    var lookup = dbpass.open();

    ['database','host','user'].forEach(function(key){
        if (!(!!state.config.pg.defaults[key])){
            throw new Error('Missing configuration: pg.defaults.' + key);
        } else {
            pg.defaults[key] = state.config.pg.defaults[key];
        }
    });

    ['port','poolSize','poolIdleTimeout','reapIntervalMillis'].forEach(function(key){
        if (state.config.pg.defaults[key]) {
            pg.defaults[key] = state.config.pg.defaults[key];
        }
    });

    pg.defaults.password = lookup(
        pg.defaults.host,pg.defaults.port,
        pg.defaults.database,pg.defaults.user
    );

    return state;
};

lib.campaignIdsFromRequest = function(req){
    var ids = {};
    
    if (req.params.id) {
        ids[req.params.id] = 1;
    }
    
    if (req.query.id) {
        req.query.id.split(',').forEach(function(id){
            ids[id] = 1;
        });
    }

    req.campaignIds = Object.keys(ids);
    return req;
};

lib.queryCampaignSummarySQL = function(req) {
    var deferred = q.defer(), idCount = req.campaignIds.length, statement;
    
    if (idCount < 1) {
        throw new Error('At least one campaignId is required!');
    }

    statement =
        'SELECT campaign_id,impressions,views,clicks,total_spend ' +
        'FROM fct.v_cpv_campaign_activity_crosstab WHERE campaign_id in ($1)';

    pg.connect(function(err, client, done) {
        if (err) {
            return deferred.reject(err);
        }

        client.query(statement,req.campaignIds,function(err,result){
            done();
            if (err) {
                deferred.reject(err);
            } else {
                req.campaignSummaryResults = result;
                deferred.resolve(req);
            }
        });
    });

    return deferred.promise;
};

lib.getCampaignAnalytics = function(req){
//    var log = logger.getLog();

    lib.campaignIdsFromRequest(req);
    return lib.queryCampaignSummarySQL(req);
};

lib.main = function(state) {
    var log = logger.getLog(),
        started = new Date();
    if (state.clusterMaster){
        log.info('Cluster master, not a worker');
        return state;
    }
    log.info('Running as cluster worker, proceed with setting up web server.');

    var app          = express();
    
    authUtils._db = state.dbs.c6Db;

    var sessionOpts = {
        key: state.config.sessions.key,
        resave: false,
        secret: state.secrets.cookieParser || '',
        cookie: {
            httpOnly: true,
            secure: state.config.sessions.secure,
            maxAge: state.config.sessions.minAge
        },
        store: state.sessionStore
    };
    
    var sessions = sessionLib(sessionOpts);

    app.set('trust proxy', 1);
    app.set('json spaces', 2);
    
    // Because we may recreate the session middleware, we need to wrap it in the route handlers
//    function sessWrap(req, res, next) {
//        sessions(req, res, next);
//    }

    state.dbStatus.c6Db.on('reconnected', function() {
        authUtils._db = state.dbs.c6Db;
        log.info('Recreated collections from restarted c6Db');
    });
    
    state.dbStatus.sessions.on('reconnected', function() {
        sessionOpts.store = state.sessionStore;
        sessions = sessionLib(sessionOpts);
        log.info('Recreated session store from restarted db');
    });

    state.dbStatus.c6Journal.on('reconnected', function() {
        log.info('Reset journal\'s collection from restarted db');
    });


    app.use(function(req, res, next) {
        res.header('Access-Control-Allow-Headers',
                   'Origin, X-Requested-With, Content-Type, Accept');
        res.header('cache-control', 'max-age=0');

        if (req.method.toLowerCase() === 'options') {
            res.send(200);
        } else {
            next();
        }
    });

    app.use(function(req, res, next) {
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
    
    var authAnalCamp = authUtils.middlewarify({campaigns: 'read'});
    app.get('/api/analytics/campaigns/:id', sessions, authAnalCamp, function(req, res) {
        lib.getCampaignAnalytics(req);
        res.send(200,'OK');
    });
    
    app.get('/api/analytics/campaigns/', sessions, authAnalCamp, function(req, res, next) {
        lib.getCampaignAnalytics(req)
        .then(function(){
            res.send(200,'OK');
            next();
        })
        .catch(function(err){
            res.send(500,err.message);
            next();
        });
    });
    
    app.use(function(err, req, res, next) {
        if (err) {
            if (err.status && err.status < 500) {
                log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                res.send(err.status, err.message || 'Bad Request');
            } else {
                log.error('[%1] Internal Error: %2', req.uuid, err && err.message || err);
                res.send(err.status || 500, err.message || 'Internal error');
            }
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
    .then(lib.pgInit)
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
    module.exports = lib;
}
