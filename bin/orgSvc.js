#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        braintree       = require('braintree'),
        expressUtils    = require('../lib/expressUtils'),
        logger          = require('../lib/logger'),
        journal         = require('../lib/journal'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        JobManager      = require('../lib/jobManager'),
        orgModule       = require('./orgSvc-orgs'),
        payModule       = require('./orgSvc-payments'),

        state = {};

    // This is the template for org's configuration
    state.defaultConfig = {
        appName: 'orgSvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/orgSvc/caches/run/'),
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
        secretsPath: path.join(process.env.HOME,'.orgSvc.secrets.json'),
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
            urlPrefix: '/api/account/org/job',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        }
    };
    
    var main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');
        
        var gateway = braintree.connect({
            environment : braintree.Environment[state.secrets.braintree.environment],
            merchantId  : state.secrets.braintree.merchantId,
            publicKey   : state.secrets.braintree.publicKey,
            privateKey  : state.secrets.braintree.privateKey
        });
            
        var app          = express(),
            orgSvc       = orgModule.setupSvc(state.dbs.c6Db, gateway),
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;
        
        payModule.extendSvc(orgSvc, gateway);

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());

        app.get('/api/account/org/job/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.get('/api/account/org/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });
        
        app.get('/api/account/org/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.use(bodyParser.json());

        payModule.setupEndpoints(app, orgSvc, gateway, state.sessions, audit, jobManager);
        orgModule.setupEndpoints(app, orgSvc, state.sessions, audit, jobManager);

        app.use(function(err, req, res, next) {
            if (err) {
                if (err.status && err.status < 500) {
                    log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                    res.send(err.status, err.message || 'Bad Request');
                } else {
                    log.error('[%1] Internal Error: %2', req.uuid, err && err.stack || err);
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
        .then(service.initSessions)
        .then(service.initPubSubChannels)
        .then(service.initCache)
        .then(main)
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
        module.exports = { main: main };
    }
}());
