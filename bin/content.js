#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        logger          = require('../lib/logger'),
        journal         = require('../lib/journal'),
        uuid            = require('../lib/uuid'),
        QueryCache      = require('../lib/queryCache'),
        authUtils       = require('../lib/authUtils'),
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
            maxAge: 14*24*60*60*1000,   // 14 days; unit here is milliseconds
            minAge: 60*1000,            // TTL for cookies for unauthenticated users
            secure: false,              // true == HTTPS-only; set to true for staging/production
            mongo: {
                host: null,
                port: null,
                retryConnect : true
            }
        },
        defaultSiteConfig: {
            branding: 'default',
            placementId: null,
            wildCardPlacement: null
        },
        siteExceptions: {
            public: ['www.cinema6.com', 'demo.cinema6.com'],
            cinema6: ['c-6.co', 'ci6.co']
        },
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
            collKeys     = ['experiences','orgs','users','sites','campaigns','cards','categories'],
            cacheKeys    = ['experiences', 'orgs', 'sites', 'campaigns', 'cards'],
            collections  = {},
            caches       = {},
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName),
            audit        = auditJournal.middleware.bind(auditJournal),
            catSvc, cardSvc;
            
        collKeys.forEach(function(key) {
            collections[key] = state.dbs.c6Db.collection(key);
        });
        cacheKeys.forEach(function(key) {
            var ttls = state.config.cacheTTLs[key];
            caches[key] = new QueryCache(ttls.freshTTL, ttls.maxTTL, collections[key]);
        });

        authUtils._coll = collections.users;
        cardSvc = cardModule.setupCardSvc(collections.cards, caches.cards);
        catSvc = catModule.setupCatSvc(collections.categories);

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

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }

        state.dbStatus.c6Db.on('reconnected', function() {
            collKeys.forEach(function(key) {
                collections[key] = state.dbs.c6Db.collection(key);
            });
            cacheKeys.forEach(function(key) {
                caches[key]._coll = collections[key];
            });
            
            cardSvc._coll = collections.cards;
            catSvc._coll = collections.categories;
            authUtils._coll = collections.users;
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
            res.header('Access-Control-Allow-Origin', '*');
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
                                 sessWrap, audit, jobManager);
        
        // adds endpoints for managing cards
        cardModule.setupEndpoints(app, cardSvc, sessWrap, audit, state.config, jobManager);
        
        // adds endpoints for managing categories
        catModule.setupEndpoints(app, catSvc, sessWrap, audit, jobManager);

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
