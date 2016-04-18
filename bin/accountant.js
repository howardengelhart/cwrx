#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;
    
    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        path            = require('path'),
        lodash          = require('lodash'),
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
        Scope           = require('../lib/enums').Scope,
        
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
        }
    };
    
    accountant.transactionSchema = {
        transactionTS: {
            __allowed: true,
            __type: 'Date'
        },
        org: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        amount: {
            __allowed: true,
            __type: 'number',
            __required: true,
            __min: 0
        },
        sign: {
            __allowed: false,
            __type: 'number',
            __required: true,
            __default: 1,
            __acceptableValues: [ 1, -1 ]
        },
        units: {
            __allowed: false,
            __type: 'number',
            __required: true,
            __default: 1
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
    
    // For translating between JSON representation of field + PG column name
    accountant.fieldToColumn = {
        id              : 'transaction_id',
        created         : 'rec_ts',
        transactionTS   : 'transaction_ts',
        amount          : 'amount',
        sign            : 'sign',
        units           : 'units',
        org             : 'org_id',
        campaign        : 'campaign_id',
        braintreeId     : 'braintree_id',
        promotion       : 'promotion_id',
        description     : 'description'
    };
    
    // Format a transaction row as a JSON doc for returning to the client
    accountant.formatTransOutput = function(row) {
        var retObj = {};
        Object.keys(accountant.fieldToColumn).forEach(function(field) {
            retObj[field] = row[accountant.fieldToColumn[field]];
        });
        
        retObj.amount = retObj.amount ? parseFloat(retObj.amount) : retObj.amount;
        retObj.created = retObj.created ? new Date(retObj.created) : retObj.created;
        retObj.transactionTS = retObj.transactionTS ? new Date(retObj.transactionTS)
                                                    : retObj.transactionTS;
        
        return retObj;
    };
    
    // Parse pagination query params for getTransactions endpoint
    accountant.parseQueryParams = function(req) {
        var params = {
            limit: Math.max((Number(req.query.limit) || 0), 0),
            skip: Math.max((Number(req.query.skip) || 0), 0)
        };
        
        params.sort = (function() {
            var sortParts = String(req.query.sort || '').split(',');
            
            return [
                accountant.fieldToColumn[sortParts[0]] || 'transaction_id',
                sortParts[1] === '-1' ? 'DESC' : 'ASC'
            ].join(' ');
        })();

        params.fields = (function() {
            var fieldParam = String(req.query.fields || '');
            
            if (!fieldParam) {
                return '*';
            }

            var fields = fieldParam.split(',').map(function(field) {
                return accountant.fieldToColumn[field];
            }).filter(function(col) {
                return !!col;
            });
            
            if (fields.indexOf('transaction_id') === -1) { // always show the id
                fields.push('transaction_id');
            }
                
            return fields.join(',');
        })();
        
        return params;
    };
    
    // Fetch multiple transaction records for a given org.
    accountant.getTransactions = function(req) {
        var log = logger.getLog();

        // Default query org to user's org; 400 if an app is requesting without an org
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({
                code: 400,
                body: 'Must provide an org id'
            });
        }
        // Return 403 if requester doesn't have permission to read another org's transactions
        if (req.requester.permissions.transactions.read !== Scope.All &&
            (!req.user || req.user.org !== req.query.org)) {
            log.info('[%1] Requester %2 not authorized to read other transactions for other org %3',
                     req.uuid, req.requester.id, req.query.org);
            return q({
                code: 403,
                body: 'Not authorized to get transactions for this org'
            });
        }
        
        var fetchParams = accountant.parseQueryParams(req);

        log.info('[%1] Requester %2 getting transactions for %3, opts: %4',
                 req.uuid, req.requester.id, req.query.org, JSON.stringify(fetchParams));

        //  NOTE: be sure to carefully parse query params to avoid SQL injection!
        var statement = [
            'SELECT ' + fetchParams.fields + ',count(*) OVER() as fullcount',
            '  from fct.billing_transactions',
            'WHERE org_id = $1 AND sign = 1',
            'ORDER BY ' + fetchParams.sort,
            'LIMIT ' + (fetchParams.limit || 'ALL'),
            'OFFSET ' + fetchParams.skip
        ];
        var values = [
            req.query.org
        ];

        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            log.info('[%1] Fetched %2 records', req.uuid, result.rows.length);
            
            var count = (result.rows[0] && result.rows[0].fullcount) || 0,
                limit = fetchParams.limit,
                skip = fetchParams.skip,
                resp = {};
                
            resp.code = 200;
            resp.headers = {
                'content-range': expressUtils.formatContentRange(count, limit, skip)
            };
            resp.body = result.rows.map(function(row) {
                return accountant.formatTransOutput(row);
            });
            
            return q(resp);
        });
    };

    // Insert a new transaction record into the database
    accountant.createTransaction = function(req) {
        var log = logger.getLog(),
            model = new Model('transactions', accountant.transactionSchema);
        
        var validResp = model.validate('create', req.body, {}, req.requester);
        
        if (!validResp.isValid) {
            log.info('[%1] Invalid transaction body: %2', req.uuid, validResp.reason);
            return q({
                code: 400,
                body: validResp.reason
            });
        }
        
        if (req.body.sign === 1 && !req.body.promotion && !req.body.braintreeId) {
            log.info('[%1] %2 attempting to create credit not tied to promotion or payment',
                     req.uuid, req.requester.id);
            return q({
                code: 400,
                body: 'Cannot create unlinked credit'
            });
        }
        
        req.body.id = 't-' + uuid.createUuid();
        req.body.created = new Date();
        req.body.transactionTS = req.body.transactionTS || req.body.created;
        
        // If no provided description, auto-generate based on amount + linked entities
        if (!req.body.description) {
            var src = (!!req.body.braintreeId && 'braintree') ||
                      (!!req.body.promotion && 'promotion');

            req.body.description = JSON.stringify({
                eventType: req.body.sign === 1 ? 'credit' : -1 ,
                source: src
            });
        }
        
        var statement = [
            'INSERT INTO fct.billing_transactions ',
            '    (rec_ts,transaction_id,transaction_ts,org_id,amount,sign,units,campaign_id,',
            '     braintree_id,promotion_id,description)',
            'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
            'RETURNING *'
        ];
        
        var values = [
            req.body.created.toISOString(),
            req.body.id,
            req.body.transactionTS.toISOString(),
            req.body.org,
            req.body.amount,
            req.body.sign,
            req.body.units,
            req.body.campaign,
            req.body.braintreeId,
            req.body.promotion,
            req.body.description
        ];
        
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            var formatted = accountant.formatTransOutput(result.rows[0]);
            log.info('[%1] Created transaction %2', req.uuid, formatted.id);
            
            //TODO: add watchman publishing
            
            return q({ code: 201, body: formatted });
        });
    };

    // Fetch the org's balance and total spend by aggregating transaction records
    accountant.getAccountBalance = function(req, config) {
        var log = logger.getLog();
        
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({ code: 400, body: 'Must provide an org id' });
        }
        
        // Check that requester can read their org, for permissions purposes
        var url = urlUtils.resolve(
            urlUtils.resolve(config.api.root, config.api.orgs.endpoint),
            req.query.org
        );
        return requestUtils.proxyRequest(req, 'get', {
            url: url,
            qs: { fields: 'id' }
        })
        .then(function(resp) {
            if (resp && resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch org %3: %4, %5',
                    req.uuid,
                    req.requester.id,
                    req.query.org,
                    resp.response.statusCode,
                    resp.body
                );
                return q({
                    code: 400,
                    body: 'Cannot fetch balance for this org'
                });
            }
            
            var statement = [
                'SELECT sign,sum(amount) as total FROM fct.billing_transactions',
                'WHERE org_id = $1',
                'GROUP BY sign'
            ];
            var values = [ req.query.org ];
        
            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                log.info('[%1] Successfuly got balance for %2', req.uuid, req.query.org);
                
                var spendRow = result.rows.filter(function(row) { return row.sign === -1; })[0],
                    spend = parseFloat((spendRow || {}).total || 0);
                
                var balance = result.rows.reduce(function(balance, row) {
                    return balance + (parseFloat(row.total || 0) * (row.sign || 1));
                }, 0);
                
                return q({
                    code: 200,
                    body: {
                        balance: Math.round(balance * 100) / 100,
                        totalSpend: Math.round(spend * 100) / 100
                    }
                });
            });
        }, function(error) {
            log.error('[%1] Failed fetching org %2: %3',
                      req.uuid, req.query.org, util.inspect(error));
            return q.reject('Error fetching org');
        });
    };
    
    // Fetch the org's outstanding budget, checking campaign budgets vs. campaign spend
    accountant.getOutstandingBudget = function(req, config, c6Db) {
        var log = logger.getLog();
        
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({ code: 400, body: 'Must provide an org id' });
        }
        
        var statuses = [Status.Active, Status.Paused, Status.Pending],
            campaigns, updates;
        
        // query db directly for campaigns to avoid permissions check
        return q(c6Db.collection('campaigns').find(
            { org: req.query.org, status: { $in: statuses } },
            { fields: { id: 1, pricing: 1, updateRequest: 1 } }
        ).toArray())
        .then(function(objs) {
            log.trace('[%1] Fetched %2 campaigns for org %3', req.uuid, objs.length, req.query.org);
            campaigns = objs;
            
            // Need to look for campaigns' update requests to get pending budget changes
            var urIds = campaigns.map(function(camp) { return camp.updateRequest; })
                                 .filter(function(id) { return !!id; });
            
            return (urIds.length === 0) ? q([]) : q(c6Db.collection('campaignUpdates').find(
                { id: { $in: urIds } },
                { fields: { id: 1, campaign: 1, 'data.pricing': 1 } }
            ).toArray());
        })
        .then(function(objs) {
            updates = objs;
            
            var totalBudget = campaigns.reduce(function(total, camp) {
                var budget = lodash.get(camp, 'pricing.budget', 0);
                
                // If camp has update request, use max of current budget and update's budget
                if (camp.updateRequest) {
                    var update = updates.filter(function(ur) {
                        return ur.id === camp.updateRequest;
                    })[0];
                    
                    budget = Math.max(budget, lodash.get(update, 'data.pricing.budget', 0));
                }
                
                return total + budget;
            }, 0);
            
            // If sum of campaign budgets is 0, don't need to fetch transactions
            if (totalBudget === 0) {
                return q({ code: 200, body: { outstandingBudget: 0 } });
            }
            
            var campIds = campaigns.map(function(camp) { return camp.id; });
            
            var statement = [
                'SELECT sum(amount * sign) as spend from fct.billing_transactions',
                'where org_id = $1',
                'and campaign_id = ANY($2::text[])',
                'and sign = -1'
            ];
            var values = [ req.query.org, campIds ];
            
            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                var spend = parseFloat(result.rows[0].spend || 0),
                    outstandingBudget = Math.round((totalBudget + spend) * 100) / 100;
                    
                log.info('[%1] Got outstandingBudget of %2 for %3',
                         req.uuid, outstandingBudget, req.query.org);
                
                return q({
                    code: 200,
                    body: { outstandingBudget: outstandingBudget }
                });
            });
        })
        .catch(function(error) {
            log.error('[%1] Failed computing outstanding budget for %2: %3',
                      req.uuid, req.query.org, util.inspect(error));
            return q.reject('Error computing outstanding budget');
        });
    };
    
    accountant.getBalanceStats = function(req, config, c6Db) {
        return q.all([
            accountant.getAccountBalance(req, config),
            accountant.getOutstandingBudget(req, config, c6Db)
        ])
        .spread(function(balanceResp, budgetResp) {
            if (balanceResp.code !== 200) {
                return q(balanceResp);
            } else if (budgetResp.code !== 200) {
                return q(budgetResp);
            }
            
            return q({
                code: 200,
                body: {
                    balance: balanceResp.body.balance,
                    totalSpend: balanceResp.body.totalSpend,
                    outstandingBudget: budgetResp.body.outstandingBudget
                }
            });
        });
    };

    accountant.main = function(state) {
        var log = logger.getLog(),
            started = new Date();
        if (state.clusterMaster) {
            log.info('Cluster master, not a worker');
            return state;
        }
        log.info('Running as cluster worker, proceed with setting up web server.');

        var app = express(),
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

        var authGetTrans = authUtils.middlewarify({
            allowApps: true,
            permissions: { transactions: 'read' }
        });
        app.get('/api/transactions?', state.sessions, authGetTrans, audit, function(req, res) {
            return accountant.getTransactions(req).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error fetching transactions',
                        detail: error
                    }
                });
            });
        });

        var authPostTrans = authUtils.middlewarify({
            allowApps: true,
            permissions: { transactions: 'create' }
        });
        app.post('/api/transactions?', authPostTrans, audit, function(req, res) {
            return accountant.createTransaction(req).then(function(resp) {
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

        var authGetBal = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read' }
        });
        app.get('/api/accounting/balance', state.sessions, authGetBal, audit, function(req, res) {
            return accountant.getBalanceStats(
                req,
                state.config,
                state.dbs.c6Db
            ).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error retrieving balance',
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
        .then(pgUtils.initConfig)
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
