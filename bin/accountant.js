#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var util            = require('util'),
        path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        logger          = require('../lib/logger'),
        service         = require('../lib/service'),
        journal         = require('../lib/journal'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        JobManager      = require('../lib/jobManager'),
        expressUtils    = require('../lib/expressUtils'),
        statsModule     = require('./accountant-stats'),
        transModule     = require('./accountant-transactions'),
        streamUtils     = require('../lib/streamUtils'),
        
        state = {},
        accountant = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'accountant',
        appDir: __dirname,
        pidDir: path.resolve(__dirname, '../pids'),
        api: {
            root: 'http://localhost',   // for proxying requests
            campaigns: {
                endpoint: '/api/campaigns/'
            },
            orgs: {
                endpoint: '/api/account/orgs/'
            }
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
        secretsPath: path.join(process.env.HOME,'.accountant.secrets.json'),
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
        pg: {
            defaults: {
                poolSize        : 20,
                poolIdleTimeout : 900000
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
            urlPrefix: '/api/accounting/jobs',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        },
        kinesis: {
            streamName: 'devCwrxStream',
            region: 'us-east-1'
        }
    };

    accountant.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster) {
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            transSvc     = transModule.setupSvc(state.config),
            statsSvc     = statsModule.setupSvc(state.dbs.c6Db, state.config),
            auditJournal = new journal.AuditJournal(
                state.dbs.c6Journal.collection('audit'),
                state.config.appVersion,
                state.config.appName
            );
        authUtils._db = state.dbs.c6Db;

        streamUtils.createProducer(state.config.kinesis);

        app.set('trust proxy', 1);
        app.set('json spaces', 2);
        
        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());

        app.get('/api/accounting/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/accounting/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.get('/api/accounting/jobs?/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.use(bodyParser.json());

        transModule.setupEndpoints(app, transSvc, state.sessions, audit, jobManager);
        statsModule.setupEndpoints(app, statsSvc, state.sessions, audit, jobManager);
        
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
        .then(pgUtils.initConfig)
        .then(service.initPubSubChannels)
        .then(service.initCache)
        .then(accountant.main)
        .catch(function(err) {
            var log = logger.getLog();
            console.log(err.stack || err);
            log.error(err.stack || util.inspect(err));
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        }).done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = accountant;
    }
}());
