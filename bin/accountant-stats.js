(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        lodash          = require('lodash'),
        logger          = require('../lib/logger'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        Status          = require('../lib/enums').Status,
        expressUtils    = require('../lib/expressUtils'),
        requestUtils    = require('../lib/requestUtils'),
        MiddleManager   = require('../lib/middleManager'),

        statsModule = { config: {} };


    statsModule.setupSvc = function(db, config) {
        statsModule.config.api = config.api;
        Object.keys(statsModule.config.api)
        .filter(function(key) { return key !== 'root'; })
        .forEach(function(key) {
            statsModule.config.api[key].baseUrl = urlUtils.resolve(
                statsModule.config.api.root,
                statsModule.config.api[key].endpoint
            );
        });
        
        var svc = new MiddleManager();
        svc._db = db;
        
        svc.use('balanceStats', statsModule.fetchOrg);
        
        return svc;
    };
    
    
    // Check that requester can read the org, for permissions purposes
    statsModule.fetchOrg = function(req, next, done) { //TODO: test
        var log = logger.getLog(),
            orgId = req.query.org;

        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(statsModule.config.api.orgs.baseUrl, orgId),
            qs: { fields: 'id' }
        })
        .then(function(resp) {
            if (resp && resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch org %3: %4, %5',
                    req.uuid,
                    req.requester.id,
                    orgId,
                    resp.response.statusCode,
                    resp.body
                );
                return done({
                    code: 400,
                    body: 'Cannot fetch balance for this org'
                });
            }
            
            req.org = resp.body;
            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching org %2: %3', req.uuid, orgId, util.inspect(error));
            return q.reject('Error fetching org');
        });
    };


    // Fetch the org's balance and total spend by aggregating transaction records
    statsModule.getAccountBalance = function(orgId, req) {
        var log = logger.getLog();
        
        var statement = [
            'SELECT sign,sum(amount) as total FROM fct.billing_transactions',
            'WHERE org_id = $1',
            'GROUP BY sign'
        ];
        var values = [ orgId ];
    
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            log.info('[%1] Successfuly got balance for %2', req.uuid, orgId);
            
            var spendRow = result.rows.filter(function(row) { return row.sign === -1; })[0],
                spend = parseFloat((spendRow || {}).total || 0);
            
            var balance = result.rows.reduce(function(balance, row) {
                return balance + (parseFloat(row.total || 0) * (row.sign || 1));
            }, 0);
            
            return q({
                balance: Math.round(balance * 100) / 100,
                totalSpend: Math.round(spend * 100) / 100
            });
        });
    };
    
    // Fetch the org's outstanding budget, checking campaign budgets vs. campaign spend
    statsModule.getOutstandingBudget = function(orgId, c6Db, req) {
        var log = logger.getLog();
        
        var statuses = [Status.Active, Status.Paused, Status.Pending],
            campaigns, updates;
        
        // query db directly for campaigns to avoid permissions check
        return q(c6Db.collection('campaigns').find(
            { org: orgId, status: { $in: statuses } },
            { fields: { id: 1, pricing: 1, updateRequest: 1 } }
        ).toArray())
        .then(function(objs) {
            log.trace('[%1] Fetched %2 campaigns for org %3', req.uuid, objs.length, orgId);
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
                return q({ outstandingBudget: 0 });
            }
            
            var campIds = campaigns.map(function(camp) { return camp.id; });
            
            var statement = [
                'SELECT sum(amount * sign) as spend from fct.billing_transactions',
                'where org_id = $1',
                'and campaign_id = ANY($2::text[])',
                'and sign = -1'
            ];
            var values = [ orgId, campIds ];
            
            return pgUtils.query(statement.join('\n'), values)
            .then(function(result) {
                var spend = parseFloat((result.rows[0] && result.rows[0].spend) || 0),
                    outstandingBudget = Math.round((totalBudget + spend) * 100) / 100;
                    
                log.info('[%1] Got outstandingBudget of %2 for %3',
                         req.uuid, outstandingBudget, orgId);
                
                return q({ outstandingBudget: outstandingBudget });
            });
        })
        .catch(function(error) {
            log.error('[%1] Failed computing outstanding budget for %2: %3',
                      req.uuid, orgId, util.inspect(error));
            return q.reject('Error computing outstanding budget');
        });
    };
    
    statsModule.getBalanceStats = function(svc, req) {
        req.query.org = req.query.org || (req.user && req.user.org);
        if (!req.query.org || typeof req.query.org !== 'string') {
            return q({ code: 400, body: 'Must provide an org id' });
        }

        return svc.runAction(req, 'balanceStats', function() {
            return q.all([
                statsModule.getAccountBalance(req.query.org, req),
                statsModule.getOutstandingBudget(req.query.org, svc._db, req)
            ])
            .spread(function(balanceResp, budgetResp) {
                return q({
                    code: 200,
                    body: {
                        balance: balanceResp.balance,
                        totalSpend: balanceResp.totalSpend,
                        outstandingBudget: budgetResp.outstandingBudget
                    }
                });
            });
        });
    };
    
/*
    statsModule.creditCheck = function(req, config) {
        var log = logger.getLog();
        
        
    };
*/
    
    statsModule.setupEndpoints = function(app, svc, sessions, audit) {
        var authGetBal = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read' }
        });
        app.get('/api/accounting/balance', sessions, authGetBal, audit, function(req, res) {
            return statsModule.getBalanceStats(svc, req).then(function(resp) {
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
    };
    
    module.exports = statsModule;
}());
