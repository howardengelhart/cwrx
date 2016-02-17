#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        expressUtils    = require('../lib/expressUtils'),
        logger          = require('../lib/logger'),
        journal         = require('../lib/journal'),
        QueryCache      = require('../lib/queryCache'),
        authUtils       = require('../lib/authUtils'),
        signatures      = require('../lib/signatures'),
        service         = require('../lib/service'),
        JobManager      = require('../lib/jobManager'),
        cardModule      = require('./content-cards'),
        catModule       = require('./content-categories'),
        expModule       = require('./content-experiences'),

        state   = {},
        content = {}; // for exporting functions to unit tests

    // This is the template for content's configuration
    state.defaultConfig = {
        appName: 'content',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/content/caches/run/'),
        },
        cacheTTLs: {  // units here are minutes
            cards: {
                freshTTL: 1,
                maxTTL: 4
            },
            experiences: {
                freshTTL: 1,
                maxTTL: 4
            },
            orgs: {
                freshTTL: 1,
                maxTTL: 4
            },
            sites: {
                freshTTL: 1,
                maxTTL: 4
            },
            campaigns: {
                freshTTL: 1,
                maxTTL: 4
            },
            cloudFront: 5
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
        defaultSiteConfig: {
            branding: 'default'
        },
        siteExceptions: {
            public: ['www.cinema6.com', 'demo.cinema6.com'],
            cinema6: ['c-6.co', 'ci6.co']
        },
        trackingPixel: '//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif',
        secretsPath: path.join(process.env.HOME,'.content.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true,
                requiredIndices: {
                    experiences: ['user', 'org']
                }
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
            urlPrefix: '/api/content/job',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        }
    };
    
    ///////////////////////////////////////////////////////////////////////////

    content.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            sigVerifier  = new signatures.Verifier(state.dbs.c6Db),
            collections  = {},
            caches       = {},
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName),
            audit        = auditJournal.middleware.bind(auditJournal),
            catSvc, cardSvc, metagetta;
            
        ['experiences', 'users', 'campaigns', 'cards', 'categories'].forEach(function(key) {
            collections[key] = state.dbs.c6Db.collection(key);
        });
        ['experiences', 'campaigns', 'cards'].forEach(function(key) {
            var ttls = state.config.cacheTTLs[key];
            caches[key] = new QueryCache(ttls.freshTTL, ttls.maxTTL, collections[key]);
        });

        authUtils._db = state.dbs.c6Db;

        if (!state.secrets.googleKey) {
            metagetta = require('metagetta');
            metagetta.hasGoogleKey = false;
        } else {
            metagetta = require('metagetta').withConfig({
                youtube: { key: state.secrets.googleKey }
            });
            metagetta.hasGoogleKey = true;
        }
                
        cardSvc = cardModule.setupSvc(state.dbs.c6Db, state.config, caches, metagetta);
        catSvc = catModule.setupSvc(collections.categories);

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        app.use(expressUtils.basicMiddleware());
        
        app.use(function(req, res, next) {
            res.header('Access-Control-Allow-Origin', '*');
            next();
        });

        app.use(bodyParser.json());

        app.use(function(req, res, next) {
            expModule.parseOrigin(req, state.config.siteExceptions);
            next();
        });
        
        app.get('/api/content/job/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.get('/api/content/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/content/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        // adds endpoints for managing experiences
        expModule.setupEndpoints(app, collections.experiences, caches, cardSvc, state.config,
                                 state.sessions, audit, jobManager);
        
        // adds endpoints for managing cards
        cardModule.setupEndpoints(app, cardSvc, state.sessions, sigVerifier, audit, state.config,
                                  jobManager);
        
        // adds endpoints for managing categories
        catModule.setupEndpoints(app, catSvc, state.sessions, audit, jobManager);

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
        .then(service.ensureIndices)
        .then(content.main)
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
        module.exports = content;
    }
}());
