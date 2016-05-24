#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        aws             = require('aws-sdk'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        expressUtils    = require('../lib/expressUtils'),
        logger          = require('../lib/logger'),
        authUtils       = require('../lib/authUtils'),
        journal         = require('../lib/journal'),
        service         = require('../lib/service'),
        JobManager      = require('../lib/jobManager'),

        scrapeModule    = require('./collateral-scrape'),
        imagesModule    = require('./collateral-images'),

        state      = {},
        collateral = {}; // for exporting functions to unit tests

    // This is the template for collateral's configuration
    state.defaultConfig = {
        appName: 'collateral',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/collateral/caches/run/'),
        },
        cacheControl: { // Note: Only used for uploaded images, not for public scraping endpoints
            default: 'max-age=31556926'
        },
        splash: {
            quality: 75,            // some integer between 0 and 100
            maxDimension: 1000,     // pixels, either height or width, to provide basic sane limit
            cacheTTL: 24*3600*1000, // max age of md5 in cache; units = ms
            maxCacheKeys: 30000,    // max number of cached md5s in the in-memory cache
            clearInterval: 60*1000, // how often to check for old cached md5s; units = ms
            timeout: 10*1000        // timeout for entire splash generation process; units = ms
        },
        scraper: {
            timeout: 5*1000,        // 5 seconds.
            agent: 'Reelcontent Web Scraper'
        },
        maxFileSize: 25*1000*1000,  // 25MB
        maxFiles: 10,               // max number of files svc will handle in a request
        maxDownloadTime: 15*1000,   // timeout for downloading image uris from 3rd-party server
        s3: {
            bucket: 'c6.dev',
            path: 'collateral/',
            region: 'us-east-1'
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
        secretsPath: path.join(process.env.HOME,'.collateral.secrets.json'),
        rcAppCredsPath: path.join(process.env.HOME,'.rcAppCreds.json'),
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
            urlPrefix: '/api/collateral/job',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        }
    };

    collateral.main = function(state) {
        var log = logger.getLog(),
            started = new Date();

        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;

        // If running locally, you need to put AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in env
        aws.config.region = state.config.s3.region;

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());
        app.use(bodyParser.json());

        scrapeModule.setupEndpoints(app, state, audit, jobManager);
        imagesModule.setupEndpoints(app, state, audit, jobManager);

        app.get('/api/collateral/job/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.get('/api/collateral/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/collateral/version', function(req, res) {
            res.send(200, state.config.appVersion);
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
        .then(collateral.main)
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
        module.exports = collateral;
    }
}());
