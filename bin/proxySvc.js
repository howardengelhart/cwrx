#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    var path            = require('path'),
        q               = require('q'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        sessionLib      = require('express-session'),
        requestUtils    = require('../lib/requestUtils'),
        logger          = require('../lib/logger'),
        uuid            = require('../lib/uuid'),
        authUtils       = require('../lib/authUtils'),
        journal         = require('../lib/journal'),
        service         = require('../lib/service'),
        util            = require('util'),

        state   = {},
        proxySvc   = {}; // for exporting functions to unit tests

    // This is the template for proxySvc's configuration
    state.defaultConfig = {
        appName: 'proxySvc',
        appDir: __dirname,
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/proxySvc/caches/run/'),
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
        secretsPath: path.join(process.env.HOME,'.proxySvc.secrets.json'),
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

    proxySvc.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app          = express(),
            users        = state.dbs.c6Db.collection('users'),
            auditJournal = new journal.AuditJournal(state.dbs.c6Journal.collection('audit'),
                                                    state.config.appVersion, state.config.appName);
        authUtils._coll = users;

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

        // Because we may recreate the session middleware, we need to wrap it in the route handlers
        function sessWrap(req, res, next) {
            sessions(req, res, next);
        }
        var audit = auditJournal.middleware.bind(auditJournal);

        state.dbStatus.c6Db.on('reconnected', function() {
            users = state.dbs.c6Db.collection('users');
            authUtils._coll = users;
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

        app.get('/api/proxySvc/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/proxySvc/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });

        app.get('/api/proxySvc/facebook/:id', function(req, res) {
            res.send(200, state.config.appVersion);
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
        .then(proxySvc.main)
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
        module.exports = proxySvc;
    }
}());
