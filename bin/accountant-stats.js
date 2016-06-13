/*jshint camelcase: false */
(function(){
    'use strict';

    var q               = require('q'),
        urlUtils        = require('url'),
        util            = require('util'),
        ld              = require('lodash'),
        Model           = require('../lib/model'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        pgUtils         = require('../lib/pgUtils'),
        authUtils       = require('../lib/authUtils'),
        Scope           = require('../lib/enums').Scope,
        Status          = require('../lib/enums').Status,
        expressUtils    = require('../lib/expressUtils'),
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
        
        var fetchOrg = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'orgs',
            idPath: ['body.org']
        }, statsModule.config.api);
        var fetchCampaign = CrudSvc.fetchRelatedEntity.bind(CrudSvc, {
            objName: 'campaigns',
            idPath: ['body.campaign']
        }, statsModule.config.api);
        
        svc.use('creditCheck', creditCheckModel.midWare.bind(creditCheckModel, 'create'));
        svc.use('creditCheck', fetchOrg);
        svc.use('creditCheck', fetchCampaign);
        svc.use('creditCheck', statsModule.checkCampaignOwnership);
        
        return svc;
    };


    // Check that campaign belongs to org in req.body
    statsModule.checkCampaignOwnership = function(req, next, done) {
        var log = logger.getLog();

        if (req.campaign.org !== req.org.id) {
            log.info('[%1] Campaign %2 belongs to %3, not %4 in req.body',
                     req.uuid, req.campaign.id, req.campaign.org, req.org.id);
            return done({
                code: 400,
                body: 'Campaign ' + req.campaign.id + ' does not belong to ' + req.org.id
            });
        }
        next();
    };

    // TODO: should this be used for credit check endpoint?
    statsModule.fetchOrgs = function(c6Db, orgIds, req) { //TODO: test, comment
        var log = logger.getLog(),
            readScope = ld.get(req, 'requester.permissions.orgs.read', Scope.Own),
            ownOrg = ld.get(req, 'user.org', null);
        
        if (!orgIds || orgIds.length === 0) {
            return q([]);
        }
        
        return q(c6Db.collection('orgs').find({
            id: (readScope === Scope.All) ? { $in: orgIds } : ownOrg,
            status: { $ne: Status.Deleted }
        }).toArray())
        .then(function(orgs) {
            log.info('[%1] Requester %2 could fetch %3 of %4 requested orgs',
                     req.uuid, req.requester.id, orgs.length, orgIds.length);
            return q(orgs);
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching orgs for %2: %3',
                      req.uuid, req.requester.id, util.inspect(error));
            return q.reject('Mongo error');
        });
    };

    // Fetch the org's balance and total spend by aggregating transaction records
    statsModule.getAccountBalance = function(orgIds, req) {
        var log = logger.getLog();
        
        var statement = [
            'SELECT org_id,sign,sum(amount) as total FROM fct.billing_transactions',
            'WHERE org_id = ANY($1::text[])',
            'GROUP BY org_id,sign'
        ];
        var values = [ orgIds ];
    
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            log.info('[%1] Successfuly got balance for %2 orgs', req.uuid, orgIds.length);
            
            var respObj = {};
            
            result.rows.forEach(function(row) {
                respObj[row.org_id] = respObj[row.org_id] || { balance: 0 };

                var amount = Math.round((parseFloat(row.total || 0) * (row.sign || 1)) * 100) / 100;

                if (row.sign === -1) { // return totalSpend as positive
                    respObj[row.org_id].totalSpend = Math.abs(amount);
                }
                respObj[row.org_id].balance += amount;
            });
            
            return q(respObj);
        });
    };
    
    // Get total budget of org's running campaigns, using budget from update requests if possible
    statsModule.getTotalBudget = function(orgIds, c6Db, req, opts) {
        opts = opts || {};
        opts.excludeCamps = opts.excludeCamps || [];
        
        var log = logger.getLog(),
            statuses = [Status.Active, Status.Paused, Status.Pending],
            campaigns;
        
        // Find campaigns in org w/ right status excluding certain campaigns
        var query = {
            org     : { $in: orgIds },
            status  : { $in: statuses },
            id      : { $nin: opts.excludeCamps }
        };
        
        return q(c6Db.collection('campaigns').find(
            query,
            { fields: { id: 1, pricing: 1, updateRequest: 1, org: 1 } }
        ).toArray())
        .then(function(objs) {
            log.trace('[%1] Fetched %2 campaigns for %3 orgs',req.uuid, objs.length, orgIds.length);
            campaigns = objs;
            
            // Need to look for campaigns' update requests to get pending budget changes
            var urIds = campaigns.map(function(camp) { return camp.updateRequest; })
                                 .filter(function(id) { return !!id; });
            
            return (urIds.length === 0) ? q([]) : q(c6Db.collection('campaignUpdates').find(
                { id: { $in: urIds } },
                { fields: { id: 1, campaign: 1, 'data.pricing': 1 } }
            ).toArray());
        })
        .then(function(updates) {
            var respObj = {};
            
            campaigns.forEach(function(camp) {
                respObj[camp.org] = respObj[camp.org] || { totalBudget: 0 };
                
                var budget = ld.get(camp, 'pricing.budget', 0);
                
                // If camp has update request, use max of current budget and update's budget
                if (camp.updateRequest) {
                    var update = updates.filter(function(ur) {
                        return ur.id === camp.updateRequest;
                    })[0];
                    
                    budget = Math.max(budget, ld.get(update, 'data.pricing.budget', 0));
                }
                
                respObj[camp.org].totalBudget += budget;
            });
            
            respObj.campaigns = campaigns;

            return q(respObj);
        })
        .catch(function(error) {
            log.error('[%1] Failed fetching campaigns: %2', req.uuid, util.inspect(error));
            return q.reject('Failed fetching campaigns');
        });
    };

    // Get total spend for list of campaigns
    statsModule.getCampSpend = function(orgIds, campIds, req) {
        var log = logger.getLog();

        var statement = [
            'SELECT org_id,sum(amount) as spend from fct.billing_transactions',
            'WHERE org_id = ANY($1::text[])',
            'AND campaign_id = ANY($2::text[])',
            'AND sign = -1',
            'GROUP BY org_id'
        ];
        var values = [ orgIds, campIds ];
        
        return pgUtils.query(statement.join('\n'), values)
        .then(function(result) {
            log.trace('[%1] Got campaign spend for %2 orgs', req.uuid, orgIds.length);

            var respObj = {};
            result.rows.forEach(function(row) {
                respObj[row.org_id] = { spend: parseFloat(row.spend || 0) };
            });
            return q(respObj);
        });
    };

    // Fetch the org's outstanding budget, checking campaign budgets vs. campaign spend.
    statsModule.getOutstandingBudget = function(orgIds, c6Db, req) {
        var log = logger.getLog(),
            budgetResp;
        
        return statsModule.getTotalBudget(orgIds, c6Db, req)
        .then(function(resp) {
            budgetResp = resp;
            
            var campIds = resp.campaigns.map(function(camp) { return camp.id; });
            
            return statsModule.getCampSpend(orgIds, campIds, req);
        })
        .then(function(spendResp) {
            var respObj = {};
            
            orgIds.forEach(function(id) {
                var budget = ld.get(budgetResp, id + '.totalBudget', null),
                    spend = ld.get(spendResp, id + '.spend', null);
                
                if (budget === null && spend === null) {
                    respObj[id] = null;
                } else {
                    budget = budget || 0;
                    spend = spend || 0;
                    respObj[id] = { outstandingBudget: Math.round((budget - spend) * 100) / 100 };
                }
            });
            
            log.info('[%1] Got outstandingBudget for %2 orgs', req.uuid, orgIds.length);
            
            return q(respObj);
        });
    };
    
    // Get account balance + outstanding budget, for /api/accounting/balance endpoint
    // TODO: update comment
    statsModule.getBalanceStats = function(svc, req, multiOrg) {
        var resp = { code: 200, body: {} },
            filteredIds = [],
            orgIds, errMsg;
        //TODO: add more comments

        if (!multiOrg) {
            req.query.org = req.query.org || (req.user && req.user.org);
            orgIds = [ req.query.org ];
            errMsg = 'Must provide an org id';
        } else {
            req.query.orgs = req.query.orgs || (req.user && req.user.org) || '';
            orgIds = String(req.query.orgs).split(',');
            errMsg = 'Must provide a list of orgs';
        }
        
        if (!orgIds[0]) {
            return q({ code: 400, body: errMsg });
        }
        
        return svc.runAction(req, 'balanceStats', function() {
            return statsModule.fetchOrgs(svc._db, orgIds, req)
            .then(function(orgs) {
                orgIds.forEach(function(orgId) {
                    if (orgs.some(function(org) { return org.id === orgId; })) {
                        resp.body[orgId] = {};
                        filteredIds.push(orgId);
                    } else {
                        resp.body[orgId] = null;
                    }
                });
                
                if (filteredIds.length === 0) {
                    if (!multiOrg) { //TODO: should this be in a done()? can it?
                        return q({ code: 404, body: 'Cannot fetch this org' });
                    } else {
                        return q(resp);
                    }
                }
                
                return q.all([
                    statsModule.getAccountBalance(filteredIds, req),
                    statsModule.getOutstandingBudget(filteredIds, svc._db, req)
                ])
                .spread(function(balanceResp, budgetResp) {
                    function formatOrgResp(orgId) {
                        return {
                            balance: ld.get(balanceResp, orgId + '.balance', 0),
                            totalSpend: ld.get(balanceResp, orgId + '.totalSpend', 0),
                            outstandingBudget: ld.get(budgetResp, orgId + '.outstandingBudget', 0)
                        };
                    }
                    
                    if (!multiOrg) {
                        resp.body = formatOrgResp(filteredIds[0]);
                    } else {
                        filteredIds.forEach(function(orgId) {
                            resp.body[orgId] = formatOrgResp(orgId);
                        });
                    }
                    
                    return q(resp);
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
                statsModule.getAccountBalance([orgId], req),
                statsModule.getTotalBudget([orgId], svc._db, req, { excludeCamps: [campId] })
            ])
            .spread(function(balanceResp, totalBudgetResp) {
                balance = ld.get(balanceResp, orgId + '.balance', 0);
                totalBudget = ld.get(totalBudgetResp, orgId + '.totalBudget', 0);
                
                // Re-include campId in campaign spend calculation
                var campIds = totalBudgetResp.campaigns.map(function(camp) { return camp.id; });
                campIds.push(campId);
                
                return statsModule.getCampSpend([orgId], campIds, req);
            })
            .then(function(spendResp) {
                var spend = ld.get(spendResp, orgId + '.spend', 0);
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
    
    statsModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var authGetBal = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read' }
        });
        
        var setJobTimeout = jobManager.setJobTimeout.bind(jobManager);

        app.get('/api/accounting/balances',
            sessions, authGetBal, audit, setJobTimeout,
            function(req, res) {
                return statsModule.getBalanceStats(svc, req, true).then(function(resp) {
                    expressUtils.sendResponse(res, resp);
                }).catch(function(error) {
                    expressUtils.sendResponse(res, {
                        code: 500,
                        body: {
                            error: 'Error retrieving balances',
                            detail: error
                        }
                    });
                });
            }
        );

        app.get('/api/accounting/balance',
            sessions, authGetBal, audit, setJobTimeout,
            function(req, res) {
                return statsModule.getBalanceStats(svc, req, false).then(function(resp) {
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
            }
        );

        var authCredChk = authUtils.middlewarify({
            allowApps: true,
            permissions: { orgs: 'read', campaigns: 'read' }
        });
        app.post('/api/accounting/credit-check',
            sessions, authCredChk, audit, setJobTimeout,
            function(req, res) {
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
            }
        );
    };
    
    module.exports = statsModule;
}());
/*jshint camelcase: true */
