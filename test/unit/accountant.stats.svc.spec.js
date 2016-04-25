var flush = true;
describe('statsModule-stats (UT)', function() {
    var mockLog, Model, MiddleManager, logger, q, statsModule, authUtils,
        requestUtils, pgUtils, req, nextSpy, doneSpy, errorSpy, mockDb, Status;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        statsModule     = require('../../bin/accountant-stats');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        MiddleManager   = require('../../lib/middleManager');
        requestUtils    = require('../../lib/requestUtils');
        authUtils       = require('../../lib/authUtils');
        pgUtils         = require('../../lib/pgUtils');
        Status          = require('../../lib/enums').Status;
        
        statsModule.config = { api: {
            root: 'http://test.com',
            campaigns: {
                endpoint: '/api/campaigns',
                baseUrl: 'http://test.com/api/campaigns/'
            },
            orgs: {
                endpoint: '/api/account/orgs',
                baseUrl: 'http://test.com/api/account/orgs/'
            }
        } };

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
        
        req = { uuid: '1234', requester: { id: 'u-1' } };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('error');
    });
    
    describe('setupSvc', function() {
        var svc, config;
        beforeEach(function() {
            config = { api: {
                root: 'http://foo.com',
                campaigns: {
                    endpoint: '/api/campaigns',
                },
                orgs: {
                    endpoint: '/api/account/orgs',
                }
            } };
            spyOn(Model.prototype.midWare, 'bind').and.returnValue(Model.prototype.midWare);
            svc = statsModule.setupSvc(mockDb, config);
        });
        
        it('should return a MiddleManager', function() {
            expect(svc).toEqual(jasmine.any(MiddleManager));
            expect(svc._db).toBe(mockDb);
        });
        
        it('should save some config locally', function() {
            expect(statsModule.config).toEqual({ api: {
                root: 'http://foo.com',
                campaigns: {
                    endpoint: '/api/campaigns',
                    baseUrl: 'http://foo.com/api/campaigns'
                },
                orgs: {
                    endpoint: '/api/account/orgs',
                    baseUrl: 'http://foo.com/api/account/orgs'
                }
            } });
        });
        
        it('should check fetch the org on balanceStats', function() {
            expect(svc._middleware.balanceStats).toContain(statsModule.fetchOrg);
        });
        
        it('should validate the body on creditCheck', function() {
            expect(svc._middleware.creditCheck).toContain(Model.prototype.midWare);

            var checkModel = Model.prototype.midWare.bind.calls.mostRecent().args[0];
            expect(checkModel).toEqual(jasmine.any(Model));
            expect(checkModel.objName).toEqual('creditCheck');
            expect(checkModel.schema).toEqual(statsModule.creditCheckSchema);
        });
        
        it('should fetch the org + campaign on creditCheck', function() {
            expect(svc._middleware.creditCheck).toContain(statsModule.fetchOrg);
            expect(svc._middleware.creditCheck).toContain(statsModule.fetchCampaign);
        });
    });
    
    describe('credit check validation', function() {
        var model, newObj, origObj, requester;
        beforeEach(function() {
            model = new Model('creditCheck', statsModule.creditCheckSchema);
            newObj = { campaign: 'cam-1', org: 'o-1' };
            origObj = {};
            requester = { fieldValidation: {} };
        });
        
        ['org', 'campaign'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a string', function() {
                    newObj[field] = 123;
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
                
                it('should allow the field to be set on create', function() {
                    newObj[field] = 'asdfasdf';
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('asdfasdf');
                });

                it('should fail if the field is not defined', function() {
                    delete newObj[field];
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'Missing required field: ' + field });
                });
            });
        });

        describe('when handling newBudget', function() {
            it('should fail if the field is not a number', function() {
                newObj.newBudget = { foo: 'bar' };
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'newBudget must be in format: number' });
            });
            
            it('should allow the field to be set on create', function() {
                newObj.newBudget = 123;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.newBudget).toEqual(123);
            });
        });
    });
    
    describe('fetchOrg', function() {
        var orgResp;
        beforeEach(function() {
            req.query = { org: 'o-1' };
            req.body = {};
            orgResp = {
                response: { statusCode: 200 },
                body: { id: 'o-1', name: 'org 1' }
            };
            spyOn(requestUtils, 'proxyRequest').and.callFake(function() { return q(orgResp); });
        });
        
        it('should attempt to fetch the org and attach it to the request', function(done) {
            statsModule.fetchOrg(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).toEqual({ id: 'o-1', name: 'org 1' });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://test.com/api/account/orgs/o-1'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should be able to take the org id from the body', function(done) {
            delete req.query.org;
            req.body.org = 'o-2';
            statsModule.fetchOrg(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.org).toEqual({ id: 'o-1', name: 'org 1' });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://test.com/api/account/orgs/o-2'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if the org is not found', function(done) {
            orgResp = { response: { statusCode: 400 }, body: 'no way jose' };
            statsModule.fetchOrg(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot fetch this org' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if the request fails', function(done) {
            orgResp = q.reject('I GOT A PROBLEM');
            statsModule.fetchOrg(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error fetching org');
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('fetchCampaign', function() {
        var campResp;
        beforeEach(function() {
            req.body = { org: 'o-1', campaign: 'cam-1' };
            campResp = {
                response: { statusCode: 200 },
                body: { id: 'cam-1', name: 'camp 1', org: 'o-1' }
            };
            spyOn(requestUtils, 'proxyRequest').and.callFake(function() { return q(campResp); });
        });
        
        it('should attempt to fetch the campaign and attach it to the request', function(done) {
            statsModule.fetchCampaign(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual({ id: 'cam-1', name: 'camp 1', org: 'o-1' });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://test.com/api/campaigns/cam-1'
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should call done with a 400 if the campaign is not found', function(done) {
            campResp = { response: { statusCode: 400 }, body: 'no way jose' };
            statsModule.fetchCampaign(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot fetch this campaign' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should call done with a 400 if the campaign does not belong to the request org', function(done) {
            campResp.body.org = 'o-2';
            statsModule.fetchCampaign(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign cam-1 does not belong to o-1' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if the request fails', function(done) {
            campResp = q.reject('I GOT A PROBLEM');
            statsModule.fetchCampaign(req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error fetching campaign');
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    
    describe('getAccountBalance', function() {
        var pgResp;
        beforeEach(function() {
            pgResp = { rows: [
                { sign: 1, total: '1112.34' },
                { sign: -1, total: '666.7891' }
            ] };
            spyOn(pgUtils, 'query').and.callFake(function() { return q(pgResp); });
        });

        it('should fetch and return the org\'s balance and total spend', function(done) {
            statsModule.getAccountBalance('o-1', req).then(function(resp) {
                expect(resp).toEqual({ balance: 445.55, totalSpend: 666.79 });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1']);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT sign,sum\(amount\) as total FROM fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/WHERE org_id = \$1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/GROUP BY sign/);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle postgres returning partial data', function(done) {
            var data = [
                { rows: [{ sign: 1, total: '123.45' }] },
                { rows: [{ sign: -1, total: '456.78' }] },
                { rows: [{ sign: 1, total: '123.45' }, { sign: -1, total: null }] },
                { rows: [{}] },
            ];
            pgUtils.query.and.callFake(function() {
                return q(data[pgUtils.query.calls.count() - 1]);
            });
            
            q.all(data.map(function() {
                return statsModule.getAccountBalance('o-1', req);
            })).then(function(results) {
                expect(results[0]).toEqual({ balance: 123.45, totalSpend: 0 });
                expect(results[1]).toEqual({ balance: -456.78, totalSpend: 456.78 });
                expect(results[2]).toEqual({ balance: 123.45, totalSpend: 0 });
                expect(results[3]).toEqual({ balance: 0, totalSpend: 0 });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getAccountBalance('o-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getTotalBudget', function() {
        var mockCamps, mockUpdates, colls, cursors, mockDb;
        beforeEach(function() {
            mockCamps = [
                { id: 'cam-1', pricing: { budget: 1000 } },
                { id: 'cam-2', pricing: { budget: 200.654 } },
                { id: 'cam-3', pricing: {} },
                { id: 'cam-4' }
            ];
            mockUpdates = [
                { id: 'ur-1', campaign: 'cam-1', data: { pricing: { budget: 1400 } } },
                { id: 'ur-2', campaign: 'cam-2', data: { pricing: { budget: 100 } } },
                { id: 'ur-3', campaign: 'cam-3', data: { pricing: { budget: 100.1 } } }
            ];
            cursors = {
                campaigns: { toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function() { return q(mockCamps); }) },
                campaignUpdates: { toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function() { return q(mockUpdates); }) }
            };
            colls = {
                campaigns: { find: jasmine.createSpy('campaigns.find()').and.callFake(function() { return cursors.campaigns; }) },
                campaignUpdates: { find: jasmine.createSpy('campaignUpdates.find()').and.callFake(function() { return cursors.campaignUpdates; }) }
            };
            mockDb = {
                collection: jasmine.createSpy('db.collection()').and.callFake(function(collName) { return colls[collName]; })
            };
        });

        it('should sum the org\'s campaign budgets and return the total', function(done) {
            statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp.totalBudget).toEqual(1200.65);
                expect(resp.campaigns).toBe(mockCamps);
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: 'o-1', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] }, id: { $nin: [] } },
                    { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                );
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to exclude certain campaigns', function(done) {
            var opts = { excludeCamps: ['cam-1'] };
            mockCamps.shift();
            statsModule.getTotalBudget('o-1', mockDb, req, opts).then(function(resp) {
                expect(resp.totalBudget).toEqual(200.65);
                expect(resp.campaigns).toBe(mockCamps);
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: 'o-1', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] }, id: { $nin: ['cam-1'] } },
                    { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                );
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        describe('if campaigns have update requests', function() {
            beforeEach(function() {
                mockCamps[0].updateRequest = 'ur-1';
                mockCamps[1].updateRequest = 'ur-2';
                mockCamps[2].updateRequest = 'ur-3';
            });

            it('should use the max of the campaigns\' and update requests\' budgets', function(done) {
                statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp.totalBudget).toEqual(1700.75);
                expect(resp.campaigns).toBe(mockCamps);
                    expect(colls.campaigns.find).toHaveBeenCalledWith(
                        { org: 'o-1', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] }, id: { $nin: [] } },
                        { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                    );
                    expect(colls.campaignUpdates.find).toHaveBeenCalledWith(
                        { id: { $in: ['ur-1', 'ur-2', 'ur-3'] } },
                        { fields: { id: 1, 'data.pricing': 1, campaign: 1 } }
                    );
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should effectively ignore updates that do not change the budget', function(done) {
                mockUpdates[0].data = { name: 'foo', pricing: { dailyLimit: 100 } };
                statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                    expect(resp.totalBudget).toEqual(1300.75);
                    expect(resp.campaigns).toBe(mockCamps);
                    expect(colls.campaigns.find).toHaveBeenCalled();
                    expect(colls.campaignUpdates.find).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if querying for campaignUpdates fails', function(done) {
                cursors.campaignUpdates.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
                statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Failed fetching campaigns');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
                }).done(done);
            });
        });
        
        it('should handle the case where no campaigns are returned', function(done) {
            mockCamps = [];
            statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp.totalBudget).toEqual(0);
                expect(resp.campaigns).toEqual([]);
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if querying for campaigns fails', function(done) {
            cursors.campaigns.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getTotalBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Failed fetching campaigns');
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
            }).done(done);
        });
    });

    describe('getCampSpend', function() {
        beforeEach(function() {
            spyOn(pgUtils, 'query').and.returnValue(q({ rows: [{ spend: 567.789 }] }));
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            statsModule.getCampSpend('o-1', ['cam-1', 'cam-2'], req).then(function(resp) {
                expect(resp).toEqual({ spend: 567.789 });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1', ['cam-1', 'cam-2'] ]);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT sum\(amount\) as spend from fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/where org_id = \$1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/and campaign_id = ANY\(\$2::text\[\]\)/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/and sign = -1/);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should handle postgres returning partial data', function(done) {
            pgUtils.query.and.returnValue(q({ rows: [] }));
            statsModule.getCampSpend('o-1', ['cam-1', 'cam-2'], req).then(function(resp) {
                expect(resp).toEqual({ spend: 0 });
                expect(pgUtils.query).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getCampSpend('o-1', ['cam-1', 'cam-2'], req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getOutstandingBudget', function() {
        var budgetResp, mockDb;
        beforeEach(function() {
            mockDb = 'c6Db';
            budgetResp = {
                totalBudget: 1200,
                campaigns: [{ id: 'cam-1' }, { id: 'cam-2' }, { id: 'cam-3' }]
            };
            spyOn(statsModule, 'getTotalBudget').and.callFake(function() { return q(budgetResp); });
            spyOn(statsModule, 'getCampSpend').and.returnValue(q({ spend: 567.789 }));
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            statsModule.getOutstandingBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp).toEqual({ outstandingBudget: 632.21 });
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith('o-1', mockDb, req);
                expect(statsModule.getCampSpend).toHaveBeenCalledWith('o-1', ['cam-1', 'cam-2', 'cam-3'], req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not query postgres if no campaigns have a budget', function(done) {
            budgetResp = { totalBudget: 0, campaigns: [] };
            statsModule.getOutstandingBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp).toEqual({ outstandingBudget: 0 });
                expect(statsModule.getTotalBudget).toHaveBeenCalled();
                expect(statsModule.getCampSpend).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getTotalBudget fails', function(done) {
            budgetResp = q.reject('I GOT A PROBLEM');
            statsModule.getOutstandingBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(statsModule.getTotalBudget).toHaveBeenCalled();
                expect(statsModule.getCampSpend).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if getCampSpend fails', function(done) {
            statsModule.getCampSpend.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getOutstandingBudget('o-1', mockDb, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getBalanceStats', function() {
        var svc;
        beforeEach(function() {
            req.query = { org: 'o-1' };
            req.user = { id: 'u-1', org: 'o-2' };
            spyOn(statsModule, 'getAccountBalance').and.returnValue(q({ balance: 789.01, totalSpend: 456.1 }));
            spyOn(statsModule, 'getOutstandingBudget').and.returnValue(q({ outstandingBudget: 123.2 }));
            svc = {
                runAction: jasmine.createSpy('runAction').and.callFake(function(req, action, cb) { return cb(); }),
                _db: 'c6Db'
            };
        });
        
        it('should get the account balance + outstanding budget, and respond with both', function(done) {
            statsModule.getBalanceStats(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 }
                });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-1', req);
                expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith('o-1', 'c6Db', req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default to the requester\'s org', function(done) {
            delete req.query.org;
            statsModule.getBalanceStats(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 }
                });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-2', req);
                expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith('o-2', 'c6Db', req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org param is invalid or cannot be defaulted', function(done) {
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
            req1.query.org = { $gt: '' };
            delete req2.query.org;
            delete req2.user;
            
            q.all([
                statsModule.getBalanceStats(svc, req1),
                statsModule.getBalanceStats(svc, req2)
            ]).then(function(results) {
                expect(results[0]).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(results[1]).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should return early if runAction returns a 4xx response', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'not today, buddy' }));
            statsModule.getBalanceStats(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'not today, buddy' });
                expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getAccountBalance rejects', function(done) {
            statsModule.getAccountBalance.and.returnValue(q.reject('I got a problem!'));
            statsModule.getBalanceStats(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I got a problem!');
            }).done(done);
        });
        
        it('should reject if getOutstandingBudget rejects', function(done) {
            statsModule.getOutstandingBudget.and.returnValue(q.reject('I got a problem!'));
            statsModule.getBalanceStats(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I got a problem!');
            }).done(done);
        });
    });
    
    describe('creditCheck', function() {
        var svc, resps;
        beforeEach(function() {
            req.body = { org: 'o-1', campaign: 'cam-req', newBudget: 800.765 };
            req.org = { id: 'o-1', name: 'org 1' };
            req.campaign = { id: 'cam-req', org: 'o-1', pricing: { budget: 400.432 } };
            
            resps = {
                getAccountBalance: { balance: 789.01, totalSpend: 456.1 },
                getTotalBudget: { totalBudget: 123.2, campaigns: [{ id: 'cam-1' }, { id: 'cam-2' }] },
                getCampSpend: { spend: 400.12 },
            };
            
            Object.keys(resps).forEach(function(method) {
                spyOn(statsModule, method).and.callFake(function() { return q(resps[method]); });
            });
            svc = {
                runAction: jasmine.createSpy('runAction').and.callFake(function(req, action, cb) { return cb(); }),
                _db: 'c6Db'
            };
        });
        
        it('should return a 204 if the check passes', function(done) {
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-1', req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith('o-1', 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith('o-1', ['cam-1', 'cam-2', 'cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(265.16);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should use the campaign\'s current budget if no newBudget is defined', function(done) {
            delete req.body.newBudget;
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-1', req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith('o-1', 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith('o-1', ['cam-1', 'cam-2', 'cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(665.5);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 402 with the deficit if the check fails', function(done) {
            req.body.newBudget = 1200.432;
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 402,
                    body: { message: 'Insufficient funds for changes to campaign', depositAmount: 134.5 }
                });
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(134.5);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a minimum of $1 for the depositAmount', function(done) {
            req.body.newBudget = 1066.00;
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 402,
                    body: { message: 'Insufficient funds for changes to campaign', depositAmount: 1 }
                });
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(0.07);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle getTotalBudget returning no budget or campaigns', function(done) {
            resps.getTotalBudget = { totalBudget: 0, campaigns: [] };
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-1', req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith('o-1', 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith('o-1', ['cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(388.36);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a campaign that has no budget at all', function(done) {
            delete req.body.newBudget;
            delete req.campaign.pricing;
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith('o-1', req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith('o-1', 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith('o-1', ['cam-1', 'cam-2', 'cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(1065.93);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return early if runAction returns a 4xx response', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'not today, buddy' }));
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'not today, buddy' });
                expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                expect(statsModule.getTotalBudget).not.toHaveBeenCalled();
                expect(statsModule.getCampSpend).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        ['getAccountBalance', 'getTotalBudget', 'getCampSpend'].forEach(function(method) {
            it('should reject if ' + method + ' rejects', function(done) {
                resps[method] = q.reject('HALP I CANT DO IT');
                statsModule.creditCheck(svc, req).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('HALP I CANT DO IT');
                    expect(statsModule.getAccountBalance).toHaveBeenCalled();
                    expect(statsModule.getTotalBudget).toHaveBeenCalled();
                    if (method !== 'getCampSpend') {
                        expect(statsModule.getCampSpend).not.toHaveBeenCalled();
                    }
                }).done(done);
            });
        });
    });
    
    describe('setupEndpoints', function() {
        var app, svc, sessions, audit, expressRoutes, res;
        beforeEach(function() {
            expressRoutes = {};
            app = {};
            ['get', 'post'].forEach(function(verb) {
                expressRoutes[verb] = {};
                app[verb] = jasmine.createSpy('app.' + verb).and.callFake(function(route/*, middleware...*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes[verb][route] = (expressRoutes[verb][route] || []).concat(middleware);
                });
            });
            
            spyOn(authUtils, 'middlewarify').and.callFake(function(opts) {
                return { opts: opts };
            });

            svc = statsModule.setupSvc(mockDb, statsModule.config);
            sessions = 'sessionsMidware';
            audit = 'auditMidware';

            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
            
            statsModule.setupEndpoints(app, svc, sessions, audit);
        });
        
        describe('creates a handler for GET /api/accounting/balance that', function() {
            it('should exist and include necessary middleware', function() {
                expect(app.get).toHaveBeenCalledWith('/api/accounting/balance', 'sessionsMidware', { opts: {
                    allowApps: true,
                    permissions: { orgs: 'read' }
                } }, 'auditMidware', jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.get['/api/accounting/balance'][expressRoutes.get['/api/accounting/balance'].length - 1];
                    spyOn(statsModule, 'getBalanceStats').and.returnValue(q({
                        code: 200,
                        body: { balance: 100, outstandingBudget: 20 }
                    }));
                });
                
                it('should call getBalanceStats and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, { balance: 100, outstandingBudget: 20 });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(statsModule.getBalanceStats).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from getBalanceStats', function(done) {
                    statsModule.getBalanceStats.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error retrieving balance', detail: 'I GOT A PROBLEM' });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for POST /api/accounting/credit-check that', function() {
            it('should exist and include necessary middleware', function() {
                expect(app.post).toHaveBeenCalledWith('/api/accounting/credit-check', 'sessionsMidware', { opts: {
                    allowApps: true,
                    permissions: { orgs: 'read', campaigns: 'read' }
                } }, 'auditMidware', jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/api/accounting/credit-check'][expressRoutes.post['/api/accounting/credit-check'].length - 1];
                    spyOn(statsModule, 'creditCheck').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call creditCheck and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(statsModule.creditCheck).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from creditCheck', function(done) {
                    statsModule.creditCheck.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                    expect(res.send).toHaveBeenCalledWith(500, { error: 'Error checking credit', detail: 'I GOT A PROBLEM' });
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});
