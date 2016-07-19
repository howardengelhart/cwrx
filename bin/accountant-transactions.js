(function(){
    'use strict';

    var q               = require('q'),
        express         = require('express'),
        uuid            = require('rc-uuid'),
        Model           = require('../lib/model'),
        inspect         = require('util').inspect,
        logger          = require('../lib/logger'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        streamUtils     = require('../lib/streamUtils'),
        Scope           = require('../lib/enums').Scope,
        expressUtils    = require('../lib/expressUtils'),
        MiddleManager   = require('../lib/middleManager'),

        transModule = { config: {} };
    
    transModule.transactionSchema = {
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
            __type: 'string',
            __length: 255
        },
        targetUsers: {
            __allowed: true,
            __type: 'number'
        },
        cycleEnd: {
            __allowed: true,
            __type: 'Date'
        },
        cycleStart: {
            __allowed: true,
            __type: 'Date'
        },
        paymentPlanId: {
            __allowed: true,
            __type: 'string'
        },
        application: {
            __allowed: true,
            __type: 'string',
            __default: 'selfie'
        }
    };

    transModule.setupSvc = function(/*config*/) {
        var svc = new MiddleManager(),
            model = new Model('transactions', transModule.transactionSchema);
            
        svc.use('read', transModule.checkReadPermissions);
        
        svc.use('create', model.midWare.bind(model, 'create'));
        svc.use('create', transModule.setupTransaction);
        
        return svc;
    };

    
    // For translating between JSON representation of field + PG column name
    transModule.fieldToColumn = {
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
        description     : 'description',
        targetUsers     : 'view_target',
        cycleEnd        : 'cycle_end',
        cycleStart      : 'cycle_start',
        paymentPlanId   : 'paymentplan_id',
        application     : 'application'
    };
    
    // Format a transaction row as a JSON doc for returning to the client
    transModule.formatTransOutput = function(row) {
        var retObj = {};
        Object.keys(transModule.fieldToColumn).forEach(function(field) {
            retObj[field] = row[transModule.fieldToColumn[field]];
        });
        
        retObj.amount = retObj.amount ? parseFloat(retObj.amount) : retObj.amount;
        
        ['created', 'transactionTS', 'cycleEnd', 'cycleStart'].forEach(function(field) {
            retObj[field] = retObj[field] ? new Date(retObj[field]) : retObj[field];
        });
        
        return retObj;
    };
    
    // Parse pagination query params for getTransactions endpoint
    transModule.parseQueryParams = function(req) {
        var params = {
            limit: Math.max((Number(req.query.limit) || 0), 0),
            skip: Math.max((Number(req.query.skip) || 0), 0)
        };
        
        params.sort = (function() {
            var sortParts = String(req.query.sort || '').split(',');
            
            return [
                transModule.fieldToColumn[sortParts[0]] || 'transaction_id',
                sortParts[1] === '-1' ? 'DESC' : 'ASC'
            ].join(' ');
        })();

        params.fields = (function() {
            var fieldParam = String(req.query.fields || '');
            
            if (!fieldParam) {
                return '*';
            }

            var fields = fieldParam.split(',').map(function(field) {
                return transModule.fieldToColumn[field];
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
    
    // Check if requester can read transactions they're querying for
    transModule.checkReadPermissions = function(req, next, done) {
        var log = logger.getLog();
        
        // Return 403 if requester doesn't have permission to read another org's transactions
        if (req.requester.permissions.transactions.read !== Scope.All &&
            (!req.user || req.user.org !== req.query.org)) {
            log.info('[%1] Requester %2 not authorized to read other transactions for other org %3',
                     req.uuid, req.requester.id, req.query.org);
            return done({
                code: 403,
                body: 'Not authorized to get transactions for this org'
            });
        }
        
        return next();
    };
    
    // Set additional fields on req.body needed for new transaction entity
    transModule.setupTransaction = function(req, next, done) {
        var log = logger.getLog();

        if (req.body.sign === 1 && !req.body.promotion && !req.body.braintreeId) {
            log.info('[%1] %2 attempting to create credit not tied to promotion or payment',
                     req.uuid, req.requester.id);
            return done({
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
                eventType: req.body.sign === 1 ? 'credit' : 'debit',
                source: src
            });
        }
        
        return next();
    };

    
    // Fetch multiple transaction records for a given org.
    transModule.getTransactions = function(svc, req) {
        var log = logger.getLog();

        // Default query org to user's org; 400 if an app is requesting without an org
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({
                code: 400,
                body: 'Must provide an org id'
            });
        }

        return svc.runAction(req, 'read', function() {
            var fetchParams = transModule.parseQueryParams(req);

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
                    return transModule.formatTransOutput(row);
                });
                
                return q(resp);
            });
        });
    };

    // Fetch the latest payment for a given org.
    transModule.getCurrentPayment = function(svc, req) {
        var log = logger.getLog();

        // Default query org to user's org; 400 if an app is requesting without an org
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({
                code: 400,
                body: 'Must provide an org id'
            });
        }

        return svc.runAction(req, 'read', function() {
            log.info('[%1] Requester %2 getting payment for %3',
                     req.uuid, req.requester.id, req.query.org);

            var statement = [
                'SELECT p.application, p.transaction_id as "transactionId",',
                '   p.transaction_ts as "transactionTimestamp", p.org_id as "orgId",',
                '   p.amount, p.braintree_id as "braintreeId", ',
                '   p.promotion_id as "promotionId", p.paymentplan_id as "paymentPlanId",',
                '   p.cycle_start as "cycleStart", p.cycle_end as "cycleEnd",',
                '   p.view_target::integer as "planViews", ',
                '   sum(coalesce(b.view_target,0))::integer as "bonusViews",',
                '   (p.view_target + sum(coalesce(b.view_target,0)))::integer as "totalViews"',
                'FROM  (',
                '   SELECT application, transaction_id,transaction_ts,org_id,amount,',
                '       braintree_id,promotion_id,paymentplan_id,view_target,',
                '       cycle_start,cycle_end',
                '   FROM fct.billing_transactions',
                '   WHERE org_id = $1 AND sign=1 AND cycle_end > current_timestamp',
                '           AND application = \'showcase\' AND NOT paymentplan_id is NULL',
                '   ORDER BY cycle_end desc ',
                '   LIMIT 1',
                ') p',
                'LEFT JOIN (',
                '   SELECT org_id,transaction_ts,view_target',
                '   FROM fct.billing_transactions',
                '   WHERE org_id = $1 and paymentplan_id is null and ',
                '       sign = 1 and application = \'showcase\'',
                ')b on p.org_id = b.org_id AND ',
                '   b.transaction_ts between p.cycle_start and p.cycle_end',
                'GROUP BY 1,2,3,4,5,6,7,8,9,10,11'
            ];

            var values = [
                req.query.org
            ];

            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                var resp = {};
                log.info('[%1] Fetched %2 records', req.uuid, result.rows.length);
            
                if (result.rows.length > 0 ) {
                    resp.code = 200;
                    resp.body = result.rows[0];
                } else {
                    resp.code = 404;
                    resp.body = 'Unable to locate currentPayment.' ;
                }
                
                return q(resp);
            });
        });
    };


    // Insert a new transaction record into the database
    transModule.createTransaction = function(svc, req) {
        var log = logger.getLog();
        
        return svc.runAction(req, 'create', function() {
            var statement = [
                'INSERT INTO fct.billing_transactions ',
                '    (rec_ts,transaction_id,transaction_ts,org_id,amount,sign,units,campaign_id,',
                '     braintree_id,promotion_id,description,view_target,cycle_end,cycle_start,',
                '     paymentplan_id,application)',
                'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
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
                req.body.description,
                req.body.targetUsers,
                req.body.cycleEnd,
                req.body.cycleStart,
                req.body.paymentPlanId,
                req.body.application
            ];
            
            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                var formatted = transModule.formatTransOutput(result.rows[0]);
                log.info('[%1] Created transaction %2', req.uuid, formatted.id);
                
                return q({ code: 201, body: formatted });
            });
        });
    };

    transModule.produceCreation = function(req, result) {
        return q().then(function() {
            var log = logger.getLog();
            var uuid = req.uuid;
            var transaction = result.body;

            if (result.code !== 201) {
                return result;
            }

            return streamUtils.produceEvent('transactionCreated', {
                transaction: transaction
            }).catch(function(reason) {
                log.error('[%1] Failed to produce "transactionCreated": %2', uuid, inspect(reason));
            }).thenResolve(result);
        });
    };

    
    transModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/transactions?'; // prefix to all endpoints declared here

        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('transactions', { allowApps: true });

        router.get('/showcase/current-payment',
                sessions, authMidware.read, audit, function(req, res) {
            var promise = transModule.getCurrentPayment(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error fetching transactions', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var promise = transModule.getTransactions(svc, req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error fetching transactions', detail: error });
                });
            });
        });

        // No sessions middleware here so users cannot create transactions
        router.post('/', authMidware.create, audit, function(req, res) {
            var promise = transModule.createTransaction(svc, req).then(function(resp) {
                return transModule.produceCreation(req, resp);
            });
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating transaction', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = transModule;
}());
