#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var q               = require('q'),
        path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        journal         = require('../lib/journal'),
        JobManager      = require('../lib/jobManager'),
        advertModule    = require('./ads-advertisers'),
        custModule      = require('./ads-customers'),
        campModule      = require('./ads-campaigns'),
        siteModule      = require('./ads-sites'),
        groupModule     = require('./ads-groups'),
        adtech          = require('adtech'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        
        state   = {},
        ads = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'ads',
        appDir: __dirname,
        caches : { //TODO: may want to rename this now...
            run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
        },
        adtechCreds: {
            keyPath: path.join(process.env.HOME, '.ssh/adtech.key'),
            certPath: path.join(process.env.HOME, '.ssh/adtech.crt')
        },
        campaigns: {
            statusDelay: 1000,      // How long to delay between polls for campaigns' statuses
            statusAttempts: 60,     // How many times to try polling for campaigns' statuses
            campaignTypeId: 26954,  // id for Open Campaign type; differs across networks
            dateDelays: {
                start: 24*60*60*1000,   // new campaigns default to starting now + this (ms)
                end: 366*24*60*60*1000  // new campaigns default to ending now + this (ms)
            }
        },
        api: {
            root: 'http://localhost'    // for proxying requests
        },
        minireelGroups: {
            advertiserId: null,     // C6 advertiser id; must be overriden in a config file
            customerId: null        // C6 customer id; must be overriden in a config file
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
        secretsPath: path.join(process.env.HOME,'.ads.secrets.json'),
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
        pubsub: {
            cacheCfg: {
                port: 21211,
                isPublisher: false
            }
        },
        cache: {
            timeouts: {},
            servers: null
        },
        jobTimeouts: {
            enabled: true,
            urlPrefix: '/api/ads/job',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        }
    };

    ads.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            advertSvc    = advertModule.setupSvc(state.dbs.c6Db.collection('advertisers')),
            custSvc      = custModule.setupSvc(state.dbs.c6Db),
            campSvc      = campModule.setupSvc(state.dbs.c6Db, state.config),
            groupSvc     = groupModule.setupSvc(state.dbs.c6Db, state.config),
            siteSvc      = siteModule.setupSvc(state.dbs.c6Db.collection('sites')),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
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
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);

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
            auditJournal.resetColl(state.dbs.c6Journal.collection('audit'));
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

        app.get('/api/ads/job/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.get('/api/ads/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/ads/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });
        
        advertModule.setupEndpoints(app, advertSvc, sessWrap, audit, jobManager);
        custModule.setupEndpoints(app, custSvc, sessWrap, audit, jobManager);
        campModule.setupEndpoints(app, campSvc, sessWrap, audit, jobManager);
        siteModule.setupEndpoints(app, siteSvc, sessWrap, audit, jobManager);
        groupModule.setupEndpoints(app, groupSvc, sessWrap, audit, jobManager);
        
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
        .then(function(state) { // NOTE: adtech.createClient() blocks for ~2-3s!
            var log = logger.getLog();
            log.info('Creating adtech client');
            return adtech.createClient(
                state.config.adtechCreds.keyPath,
                state.config.adtechCreds.certPath
            ).then(function() {
                log.info('Finished creating adtech client');
                return q(state);
            });
        })
        .then(service.initMongo)
        .then(service.initSessionStore)
        .then(service.initPubSubChannels)
        .then(service.initCache)
        .then(ads.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.stack || err);
            log.error(err.stack || err);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = ads;
    }
}());
