#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var path            = require('path'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        service         = require('../lib/service'),
        journal         = require('../lib/journal'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        expressUtils    = require('../lib/expressUtils'),
        
        state = {},
        geo = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'geo',
        appDir: __dirname,
        caches : {
            run: path.normalize('/usr/local/share/cwrx/' + state.name + '/caches/run/'),
        },
        api: {
            root: 'http://localhost',   // for proxying requests
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
        maxReadLimit: 500,
        secretsPath: path.join(process.env.HOME,'.geo.secrets.json'),
        mongo: {
            c6Db: {
                host: null,
                port: null,
                retryConnect : true
            },
            geoDb: { //TODO: is there a good reason this should really be a different db?
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

/*TODO: Mongo to-dos
- consider adding functionality for creating 2dsphere indexes
- consider adding functionality for creating unique indexes
*/

    geo.setupZipSvc = function(coll, config) {
        var opts = {
            userProp: false,
            orgProp: false,
            allowPublic: true,
            maxReadLimit: config.maxReadLimit
        };
        
        var svc = new CrudSvc(coll, null, opts, {}); //TODO: this feels...dangerous
            
        return svc;
    };


    geo.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app     = express(),
            zipSvc  = geo.setupZipSvc(state.dbs.geoDb.collection('zipcodes'), state.config),
            auditJournal = new journal.AuditJournal(
                state.dbs.c6Journal.collection('audit'),
                state.config.appVersion,
                state.config.appName
            );
        authUtils._db = state.dbs.c6Db;

        app.set('trust proxy', 1);
        app.set('json spaces', 2);
        
        var audit = auditJournal.middleware.bind(auditJournal);

        app.use(expressUtils.basicMiddleware());

        app.get('/api/geo/meta', function(req, res){
            var data = {
                version: state.config.appVersion,
                started : started.toISOString(),
                status : 'OK'
            };
            res.send(200, data);
        });

        app.get('/api/geo/version', function(req, res) {
            res.send(200, state.config.appVersion);
        });
        
        
        var authGetZip = authUtils.middlewarify({});
        app.get('/api/geo/zipcodes?/:code', state.sessions, authGetZip, audit, function(req, res) {
            zipSvc.getObjs({ zipcode: req.params.code }, req, false).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error retrieving zipcode',
                        detail: error
                    }
                });
            });
        });

        app.get('/api/geo/zipcodes?/', state.sessions, authGetZip, audit, function(req, res) {
            var query = {};
            if ('zipcodes' in req.query) {
                query.zipcode = String(req.query.zipcodes).split(',');
            }

            zipSvc.getObjs(query, req, true).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error retrieving zipcodes',
                        detail: error
                    }
                });
            });
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
        .then(geo.main)
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
        module.exports = geo;
    }
}());
