#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var q               = require('q'),
        util            = require('util'),
        path            = require('path'),
        express         = require('express'),
        uuid            = require('rc-uuid'),
        bodyParser      = require('body-parser'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        service         = require('../lib/service'),
        journal         = require('../lib/journal'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        expressUtils    = require('../lib/expressUtils'),
        
        state = {},
        accounting = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'accounting', //TODO: or 'accountant'?
        appDir: __dirname,
        pidDir: path.resolve(__dirname, '../pids'),
        sessions: { //TODO: do we even need user sessions?
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
        secretsPath: path.join(process.env.HOME,'.accounting.secrets.json'),
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
        pg: { //TODO: understand + modify these values
            defaults: {
                poolSize        : 20,
                poolIdleTimeout : 900000
            }
        }
    };
    
    accounting.transactionSchema = { //TODO: are id, created, or units necessary here?
        amount: {
            __allowed: true,
            __type: 'number', //TODO: min/max?
            __required: true
        },
        org: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        braintreeId: {
            __allowed: true,
            __type: 'string'
        },
        promotion: {
            __allowed: true,
            __type: 'string'
        },
        campaign: {
            __allowed: true,
            __type: 'string'
        },
        description: {
            __allowed: true,
            __type: 'string'
        }
    };
    

    accounting.formatTransOutput = function(row) { //TODO: rename?
        /* jshint camelcase: false */
        return {
            id          : row.id,
            created     : new Date(row.rec_ts),
            amount      : row.amount,
            org         : row.org_id,
            campaign    : row.campaign_id,
            braintreeId : row.braintree_id,
            promotion   : row.promotion_id,
            description : row.description
        };
        /* jshint camelcase: true */
    };

    accounting.createTransaction = function(req) {
        var log = logger.getLog(),
            model = new Model('transactions', accounting.transactionSchema);
        
        var validResp = model.validate('create', req.body, {}, req.requester);
        
        if (!validResp.isValid) {
            log.info('[%1] Invalid transaction body: %2', req.uuid, validResp.reason);
            return q({
                code: 400,
                body: validResp.reason
            });
        }
        
        req.body.id = 't-' + uuid.createUuid();
        req.body.created = new Date();
        req.body.units = 1; //TODO: ensure this is ok?
        
        var statement = [
            'INSERT INTO dim.transactions ',
            '    (id,rec_ts,amount,units,org_id,campaign_id,braintree_id,promotion_id,description)',
            'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            'RETURNING *'
        ];
        
        var values = [
            req.body.id,
            req.body.created.toISOString(),
            req.body.amount,
            req.body.units,
            req.body.org.substr(0, 20), //TODO: we sure bout this? or verify these are real?
            req.body.campaign.substr(0, 20),
            req.body.braintreeId.substr(0, 20),
            req.body.promotion.substr(0, 20),
            req.body.description
        ];
        
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            var formatted = accounting.formatTransOutput(result.rows[0]);
            log.info('[%1] Created transaction %2', req.uuid, formatted.id);
            
            //TODO: remember to add watchman publishing
            
            return q({ code: 200, body: formatted });
        });
    };


    accounting.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app     = express(),
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

        app.use(bodyParser.json());

        
        //TODO: hahaha these perms are def not right, come back to this
        var authPostTrans = authUtils.middlewarify({ allowApps: true });
        app.post('/api/transaction', state.sessions, authPostTrans, audit, function(req, res) {
            return accounting.createTransaction(req).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error creating transaction',
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
        .then(service.initPostgres)
        .then(accounting.main)
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
        module.exports = accounting;
    }
}());
