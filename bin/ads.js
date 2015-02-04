#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var path            = require('path'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        journal         = require('../lib/journal'),
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
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
        },
        adtechCreds: {
            keyPath: path.join(process.env.HOME, '.ssh/adtech.key'),
            certPath: path.join(process.env.HOME, '.ssh/adtech.crt')
        },
        campaigns: {
            statusDelay: 1000,      // How long to delay between polls for campaigns' statuses
            statusAttempts: 10      // How many times to try polling for campaigns' statuses
        },
        contentHost: 'localhost',   // Hostname of the content service to proxy delete requests to
        minireelGroups: {
            advertiserId: null,     // Adtech advertiser id; must be overriden in a config file
            customerId: null        // Adtech customer id; must be overriden in a config file
        },
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
            
        var express      = require('express'),
            app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            advertSvc    = advertModule.setupSvc(state.dbs.c6Db.collection('advertisers')),
            custSvc      = custModule.setupSvc(state.dbs.c6Db),
            campSvc      = campModule.setupSvc(state.dbs.c6Db, state.config),
            groupSvc     = groupModule.setupSvc(state.dbs.c6Db, state.config),
            siteSvc      = siteModule.setupSvc(state.dbs.c6Db.collection('sites')),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._coll = users;

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

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');

            authUtils._coll = users;
            log.info('Recreated collections from restarted c6Db');
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

        state.dbStatus.c6Journal.on('reconnected', function() {
            auditJournal.resetColl(state.dbs.c6Journal.collection('audit'));
            log.info('Reset journal\'s collection from restarted db');
        });

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);

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


        
        advertModule.setupEndpoints(app, advertSvc, sessWrap, audit);
        custModule.setupEndpoints(app, custSvc, sessWrap, audit);
        campModule.setupEndpoints(app, campSvc, sessWrap, audit);
        siteModule.setupEndpoints(app, siteSvc, sessWrap, audit);
        groupModule.setupEndpoints(app, groupSvc, sessWrap, audit);

        
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
        .then(function(state) {
            return adtech.createClient(
                state.config.adtechCreds.keyPath,
                state.config.adtechCreds.certPath
            ).thenResolve(state);
        }).then(ads.main)
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
        module.exports = ads;
    }
}());
