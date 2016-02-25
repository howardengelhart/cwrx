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
        journal         = require('../lib/journal'),
        authUtils       = require('../lib/authUtils'),
        service         = require('../lib/service'),
        JobManager      = require('../lib/jobManager'),
        userModule      = require('./userSvc-users'),
        roleModule      = require('./userSvc-roles'),
        polModule       = require('./userSvc-policies'),

        state = {};

    // This is the template for the service's configuration
    state.defaultConfig = {
        appName: 'userSvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/userSvc/caches/run/'),
        },
        emails: {
            awsRegion: 'us-east-1',
            sender: 'no-reply@cinema6.com',
            activationTarget: 'http://localhost:9000/#/confirm?selfie=selfie',
            dashboardLink: 'http://localhost:9000/#/apps/selfie/campaigns',
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
        secretsPath: path.join(process.env.HOME,'.userSvc.secrets.json'),
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
            urlPrefix: '/api/account/users/jobs',
            timeout: 5*1000,
            cacheTTL: 60*60*1000,
        },
        policies: {
            allEntities: [ // all entity names, used for permissions and fieldValidations props
                'advertisers',
                'campaignUpdates',
                'campaigns',
                'cards',
                'categories',
                'customers',
                'elections',
                'experiences',
                'minireelGroups',
                'orgs',
                'policies',
                'roles',
                'sites',
                'users'
            ]
        },
        activationTokenTTL: 1*60*60*1000, // 60 minutes; unit here is milliseconds
        newUserPermissions: {
            roles: ['newUserRole'],
            policies: ['newUserPolicy']
        },
        api: {
            root: 'http://localhost/',
            orgs: {
                endpoint: '/api/account/orgs/'
            },
            advertisers: {
                endpoint: '/api/account/advertisers/'
            }
        },
        systemUserId: 'u-sixxy'
    };

    var main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            appCreds     = state.secrets.rcAppCredentials,
            jobManager   = new JobManager(state.cache, state.config.jobTimeouts),
            userSvc      = userModule.setupSvc(state.dbs.c6Db, state.config, state.cache, appCreds),
            roleSvc      = roleModule.setupSvc(state.dbs.c6Db),
            polSvc       = polModule.setupSvc(state.dbs.c6Db, state.config),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._db = state.dbs.c6Db;

        // Nodemailer will automatically get SES creds, but need to set region here
        aws.config.region = state.config.emails.region;

        app.set('trust proxy', 1);
        app.set('json spaces', 2);

        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());
        app.use(bodyParser.json());

        app.get('/api/account/users?/jobs?/:id', function(req, res) {
            jobManager.getJobResult(req, res, req.params.id).catch(function(error) {
                res.send(500, { error: 'Internal error', detail: error });
            });
        });

        app.get('/api/account/users?/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/account/users?/version',function(req, res) {
            res.send(200, state.config.appVersion);
        });

        userModule.setupEndpoints(app, userSvc, state.sessions, audit, state.sessionStore,
                                  state.config, auditJournal, jobManager);
        roleModule.setupEndpoints(app, roleSvc, state.sessions, audit, jobManager);
        polModule.setupEndpoints(app, polSvc, state.sessions, audit, jobManager);


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
        .then(main)
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
        module.exports = { main: main };
    }
}());
