(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        Status          = require('../lib/enums').Status,
        expressUtils    = require('../lib/expressUtils'),
        requestUtils    = require('../lib/requestUtils'),
        MiddleManager   = require('../lib/middleManager'),

        statsModule = { config: {} };
        
    // Schema for validating body of credit check request
    statsModule.creditCheckSchema = {
        org: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        campaign: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        newBudget: {
            __allowed: true,
            __type: 'number'
        }
    };

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
        
        var svc = new MiddleManager(),
            creditCheckModel = new Model('creditCheck', statsModule.creditCheckSchema);
        svc._db = db;
        
        svc.use('balanceStats', statsModule.fetchOrg);
        
        svc.use('creditCheck', creditCheckModel.midWare.bind(creditCheckModel, 'create'));
        svc.use('creditCheck', statsModule.fetchOrg);
        svc.use('creditCheck', statsModule.fetchCampaign);
        
        return svc;
    };
    
    
    // Fetch the org requester is querying for, for permissions purposes
    statsModule.fetchOrg = function(req, next, done) {
        var log = logger.getLog(),
            orgId = req.query.org || req.body.org;

        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(statsModule.config.api.orgs.baseUrl, orgId)
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
                    body: 'Cannot fetch this org'
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

    // Fetch the campaign requester is doing credit check for
    statsModule.fetchCampaign = function(req, next, done) {
        var log = logger.getLog(),
            campId = req.body.campaign,
            orgId = req.body.org;

        return requestUtils.proxyRequest(req, 'get', {
            url: urlUtils.resolve(statsModule.config.api.campaigns.baseUrl, campId)
        })
        .then(function(resp) {
            if (resp && resp.response.statusCode !== 200) {
                log.info(
                    '[%1] Requester %2 could not fetch campaign %3: %4, %5',
                    req.uuid,
                    req.requester.id,
                    campId,
                    resp.response.statusCode,
                    resp.body
                );
                return done({
                    code: 400,
                    body: 'Cannot fetch this campaign'
                });
            }
            
            req.campaign = resp.body;
            
            if (req.campaign.org !== orgId) {
                log.info('[%1] Campaign %2 belongs to %3, not %4 in req.body',
                         req.uuid, req.campaign.id, req.campaign.org, orgId);
                return done({
                    code: 400,
                    body: 'Campaign ' + campId + ' does not belong to ' + orgId
                });
            }

            next();
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching campaign %2: %3',req.uuid, campId, util.inspect(error));
            return q.reject('Error fetching campaign');
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
    
    // Get total budget of org's running campaigns, using budget from update requests if possible
    statsModule.getTotalBudget = function(orgId, c6Db, req, opts) {
        opts = opts || {};
        opts.excludeCamps = opts.excludeCamps || [];
        
        var log = logger.getLog(),
            statuses = [Status.Active, Status.Paused, Status.Pending],
            campaigns, updates;
        
        // Find campaigns in org w/ right status excluding certain campaigns
        var query = {
            org     : orgId,
            status  : { $in: statuses },
            id      : { $nin: opts.excludeCamps }
        };
        
        return q(c6Db.collection('campaigns').find(
            query,
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
                var budget = ld.get(camp, 'pricing.budget', 0);
                
                // If camp has update request, use max of current budget and update's budget
                if (camp.updateRequest) {
                    var update = updates.filter(function(ur) {
                        return ur.id === camp.updateRequest;
                    })[0];
                    
                    budget = Math.max(budget, ld.get(update, 'data.pricing.budget', 0));
                }
                
                return total + budget;
            }, 0);
            
            return {
                totalBudget: Math.round(totalBudget * 100) / 100,
                campaigns: campaigns
            };
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching campaigns for %2: %3',
                      req.uuid, orgId, util.inspect(error));
            return q.reject('Failed fetching campaigns');
        });
    };

    // Get total spend for list of campaigns
    statsModule.getCampSpend = function(orgId, campIds, req) {
        var log = logger.getLog();

        var statement = [
            'SELECT sum(amount) as spend from fct.billing_transactions',
            'where org_id = $1',
            'and campaign_id = ANY($2::text[])',
            'and sign = -1'
        ];
        var values = [ orgId, campIds ];
        
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            var spend = parseFloat((result.rows[0] && result.rows[0].spend) || 0);
                
            log.trace('[%1] Got campaign spend of %2 for %3', req.uuid, spend, orgId);
            
            return q({ spend: spend });
        });
    };

    // Fetch the org's outstanding budget, checking campaign budgets vs. campaign spend.
    statsModule.getOutstandingBudget = function(orgId, c6Db, req) {
        var log = logger.getLog(),
            totalBudget;
        
        return statsModule.getTotalBudget(orgId, c6Db, req)
        .then(function(resp) {
            totalBudget = resp.totalBudget;
            
            if (totalBudget === 0) { // If totalBudget is 0, don't need to calculate spend
                return q({ spend: 0 });
            }
            
            var campIds = resp.campaigns.map(function(camp) { return camp.id; });
            
            return statsModule.getCampSpend(orgId, campIds, req);
        })
        .then(function(resp) {
            var outstandingBudget = Math.round((totalBudget - resp.spend) * 100) / 100;
                    
            log.info('[%1] Got outstandingBudget of %2 for %3', req.uuid, outstandingBudget, orgId);
            
            return q({ outstandingBudget: outstandingBudget });
        });
    };
    
    // Get account balance + outstanding budget, for /api/accounting/balance endpoint
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

    // Check if an org has sufficient funds to make a campaign change
    statsModule.creditCheck = function(svc, req) {
        var log = logger.getLog();
        
        return svc.runAction(req, 'creditCheck', function() {
            var campId = req.campaign.id,
                orgId = req.org.id,
                balance, totalBudget;
            
            // Exclude campId from getTotalBudget b/c we have the newest budget in body
            return q.all([
                statsModule.getAccountBalance(orgId, req),
                statsModule.getTotalBudget(orgId, svc._db, req, { excludeCamps: [campId] })
            ])
            .spread(function(balanceResp, totalBudgetResp) {
                balance = balanceResp.balance;
                totalBudget = totalBudgetResp.totalBudget;
                
                // Re-include campId in campaign spend calculation
                var campIds = totalBudgetResp.campaigns.map(function(camp) { return camp.id; });
                campIds.push(campId);
                
                return statsModule.getCampSpend(orgId, campIds, req);
            })
            .then(function(spendResp) {
                var spend = spendResp.spend;
                var campBudget = req.body.newBudget || ld.get(req.campaign, 'pricing.budget', 0);
                    
                var outstandingBudget = totalBudget + campBudget - spend;
                var deficit = Math.round((outstandingBudget - balance) * 100) / 100;
                
                if (deficit > 0) {
                    log.info('[%1] Changes to %2 incur deficit of %3 for %4',
                             req.uuid, campId, deficit, orgId);
                    return q({
                        code: 402,
                        body: {
                            message: 'Insufficient funds for changes to campaign',
                            depositAmount: Math.max(deficit, 1.00)
                        }
                    });
                }
                
                log.info('[%1] Org %2 has account surplus %3', req.uuid, orgId, Math.abs(deficit));
                
                return q({ code: 204 });
            });
        });
    };
    
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

        var authCredChk = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read', campaigns: 'read' }
        });
        app.post('/api/accounting/credit-check', sessions, authCredChk, audit, function(req, res) {
            return statsModule.creditCheck(svc, req).then(function(resp) {
                expressUtils.sendResponse(res, resp);
            }).catch(function(error) {
                expressUtils.sendResponse(res, {
                    code: 500,
                    body: {
                        error: 'Error checking credit',
                        detail: error
                    }
                });
            });
        });
    };
    
    module.exports = statsModule;
}());
