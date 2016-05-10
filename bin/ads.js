#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var aws             = require('aws-sdk'),
        path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        expressUtils    = require('../lib/expressUtils'),
        logger          = require('../lib/logger'),
        journal         = require('../lib/journal'),
        JobManager      = require('../lib/jobManager'),
        advertModule    = require('./ads-advertisers'),
        updateModule    = require('./ads-campaignUpdates'),
        campModule      = require('./ads-campaigns'),
        conModule       = require('./ads-containers'),
        placeModule     = require('./ads-placements'),
        siteModule      = require('./ads-sites'),
        beesAdverts     = require('./ads-beeswax/advertisers'),
        
        state   = {},
        ads = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'ads',
        appDir: __dirname,
        caches : { //TODO: may want to rename this now...
            run     : path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            placements: {
                freshTTL: 1,
                maxTTL: 4
            },
            cloudFront: 5
        },
        emails: {
            awsRegion: 'us-east-1',
            sender: 'no-reply@cinema6.com',
            supportAddress: 'c6e2eTester@gmail.com',
            reviewLink: 'http://localhost:9000/#/apps/selfie/campaigns/manage/:campId/admin',
            manageLink: 'http://localhost:9000/#/apps/selfie/campaigns/manage/:campId/manage',
            dashboardLink: 'http://localhost:9000/#/apps/selfie/campaigns',
            enabled: true
        },
        api: {
            root: 'http://localhost',   // for proxying requests
            experiences: {
                endpoint: '/api/content/experiences/'
            },
            cards: {
                endpoint: '/api/content/cards/'
            },
            advertisers: {
                endpoint: '/api/account/advertisers/'
            },
            campaigns: {
                endpoint: '/api/campaigns/'
            },
            creditCheck: {
                endpoint: '/api/accounting/credit-check/'
            },
            zipcodes: {
                endpoint: '/api/geo/zipcodes'
            }
        },
        beeswax: {
            apiRoot: 'https://stingersbx.api.beeswax.com'
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
        secretsPath: path.join(process.env.HOME,'.ads.secrets.json'),
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
            urlPrefix: '/api/adjobs',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        },
        kinesis: {
            streamName: 'devCwrxStream',
            region: 'us-east-1'
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
            appCreds     = state.rcAppCreds,
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            advertSvc    = advertModule.setupSvc(state.dbs.c6Db.collection('advertisers')),
            campSvc      = campModule.setupSvc(state.dbs.c6Db, state.config),
            updateSvc    = updateModule.setupSvc(state.dbs.c6Db, campSvc, state.config, appCreds),
            siteSvc      = siteModule.setupSvc(state.dbs.c6Db.collection('sites')),
            conSvc       = conModule.setupSvc(state.dbs.c6Db),
            placeSvc     = placeModule.setupSvc(state.dbs.c6Db, state.config),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
        //TODO: load beeswax secrets in cookbook
        var beesAdvertSvc = beesAdverts.setupSvc(state.dbs.c6Db,state.config,state.secrets.beeswax);

        // Nodemailer will automatically get SES creds, but need to set region here
        aws.config.region = state.config.emails.awsRegion;

        app.set('trust proxy', 1);
        app.set('json spaces', 2);
        
        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());
        app.use(bodyParser.json());

        app.get('/api/adjobs/:id', function(req, res) {
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
        
        // Beeswax modules MUST come first!
        beesAdverts.setupEndpoints(app, beesAdvertSvc, state.sessions, audit, jobManager);
        
        advertModule.setupEndpoints(app, advertSvc, state.sessions, audit, jobManager);
        
        // Update module endpoints MUST be added before campaign endpoints!
        updateModule.setupEndpoints(app, updateSvc, state.sessions, audit, jobManager);

        campModule.setupEndpoints(app, campSvc, state.sessions, audit, jobManager);
        siteModule.setupEndpoints(app, siteSvc, state.sessions, audit, jobManager);
        conModule.setupEndpoints(app, conSvc, state.sessions, audit, jobManager);
        placeModule.setupEndpoints(app, placeSvc, state.sessions, audit, jobManager);
        
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
