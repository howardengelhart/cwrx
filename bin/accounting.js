#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var q               = require('q'),
        urlUtils        = require('url'),
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
        requestUtils    = require('../lib/requestUtils'),
        Status          = require('../lib/enums').Status,
        
        state = {},
        accounting = {}; // for exporting functions to unit tests

    state.defaultConfig = {
        appName: 'accounting', //TODO: or 'accountant'?
        appDir: __dirname,
        pidDir: path.resolve(__dirname, '../pids'),
        api: {
            root: 'http://localhost',   // for proxying requests
            campaigns: {
                endpoint: '/api/campaigns/'
            }
        },
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
            units       : row.units,
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
        
        if (req.body.amount > 0 && !req.body.promotion && !req.body.braintreeId) {
            log.info('[%1] %2 attempting to create credit not tied to promotion or payment',
                     req.uuid, req.requester.id);
            return q({
                code: 400,
                body: 'Cannot create unlinked credit'
            });
        }
        
        req.body.id = 't-' + uuid.createUuid();
        req.body.created = new Date();
        req.body.units = 1;

        // ensure these id fields are not too long
        //TODO: we sure bout this? or verify these are real?
        ['org', 'campaign', 'braintreeId', 'promotion'].forEach(function(field) {
            if (typeof req.body[field] === 'string') {
                req.body[field] = req.body[field].substr(0, 20);
            }
        });
        
        // If no provided description, auto-generate based on amount + linked entities
        if (!req.body.description) {
            var src = (!!req.body.braintreeId ? ('payment ' + req.body.braintreeId) : null) ||
                      (!!req.body.promotion ? ('promotion ' + req.body.promotion) : null) ||
                      (!!req.body.campaign ? ('campaign ' + req.body.campaign) : null) ||
                      'unknown source';

            req.body.description = util.format(
                'Account %s for %s from %s',
                (amount > 0) ? 'credit' : 'debit',
                req.body.org,
                src
            );
        }
        
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
            req.body.org,
            req.body.campaign,
            req.body.braintreeId,
            req.body.promotion,
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

    /*
     * TODO: can probably have one endpoint that gets balance + oustandingBudget + calls both these
     * functions, but I would double check how endpoint(s) would be used first
     */
    accounting.getBalance = function(req) {
        var log = logger.getLog();
        
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({ code: 400, body: 'Must provide an org id' });
        }
        
        //TODO: should probably attempt to fetch org from orgSvc for permissions?
        
        var statement = [
            'SELECT sum(amount) as balance from dim.transactions',
            'where org_id = $1'
        ];
        var values = [ req.query.org ];
        
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            log.info('[%1] Successfuly got balance for %2', req.uuid, req.query.org);
            return q({
                code: 200,
                body: { balance: parseFloat(result.rows[0].balance) }
            });
        });
    };
    
    //TODO: break up this big ass function? use middleware somehow?
    accounting.getOutstandingBudget = function(req, config) {
        var log = logger.getLog();
        
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({ code: 400, body: 'Must provide an org id' });
        }
        
        var statuses = [Status.Active, Status.Paused]; //TODO: reconsider? include Status.Error?
        
        // TODO: rely on user being able to fetch org's campaigns? or authenticate as an app here?
        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(config.api.root, config.api.campaigns.endpoint),
            qs: {
                org: req.query.org,
                statuses: statuses.join(','),
                fields: 'id,pricing'
            }
        })
        .then(function(resp) {
            if (resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch campaigns for %3: %4, %5',
                    req.uuid,
                    req.requester.id,
                    req.query.org,
                    resp.response.statusCode,
                    resp.body
                );
                return q({
                    code: 400,
                    body: 'Cannot fetch campaigns for this org'
                });
            }
            log.trace('[%1] Requester %2 fetched %3 campaigns for org %4',
                      req.uuid, req.requester.id, resp.body.length, req.query.org);
            
            var totalBudget = 0, campIds = [];
            
            resp.body.forEach(function(camp) {
                totalBudget += (camp.pricing && camp.pricing.budget) || 0;
                campIds.push(camp.id);
            });
            
            // If sum of campaign budgets is 0, don't need to fetch transactions
            if (totalBudget === 0) {
                return q({
                    code: 200,
                    body: {
                        outstandingBudget: 0
                    }
                });
            }
            
            var statement = [
                'SELECT sum(amount) as spend from dim.transactions',
                'where org_id = $1',
                'and campaign_id = ANY($2::text[])',
                'and amount < 0'
            ];
            var values = [ req.query.org, campIds ];
            
            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                var spend = parseFloat(result.rows[0].spend || 0),
                    outstandingBudget = totalBudget + spend;
                    
                log.info('[%1] Got outstandingBudget of %2 for %3',
                         req.uuid, outstandingBudget, req.query.org);
                
                return q({
                    code: 200,
                    body: {
                        outstandingBudget: outstandingBudget
                    }
                });
            });
        }, function(error) {
            log.error('[%1] Failed fetching campaigns for %2: %3',
                      req.uuid, req.query.org, util.inspect(error));
            return q.reject('Error fetching campaigns');
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

        var authGetBal = authUtils.middlewarify({ allowApps: true, permissions: { orgs: 'read' } });
        app.get('/api/accounting/balance', state.sessions, authGetBal, audit, function(req, res) {
            return accounting.getBalance(req).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error getting balance',
                        detail: error
                    }
                });
            });
        });
        
        var authGetBudg = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read', campaigns: 'read' }
        });
        app.get('/api/accounting/budget', state.sessions, authGetBudg, audit, function(req, res) {
            return accounting.getOutstandingBudget(req, state.config).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error getting balance',
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
