var flush = true;
describe('statsModule-stats (UT)', function() {
    var mockLog, Model, MiddleManager, logger, q, statsModule, express, expressUtils, journal, authUtils, uuid,
        requestUtils, pgUtils, req, res, nextSpy, doneSpy, errorSpy, mockDb, Status, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        express         = require('express');
        statsModule     = require('../../bin/accountant-stats');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        MiddleManager   = require('../../lib/middleManager');
        uuid            = require('rc-uuid');
        expressUtils    = require('../../lib/expressUtils');
        requestUtils    = require('../../lib/requestUtils');
        authUtils       = require('../../lib/authUtils');
        pgUtils         = require('../../lib/pgUtils');
        journal         = require('../../lib/journal');
        Status          = require('../../lib/enums').Status;
        Scope           = require('../../lib/enums').Scope;
        
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
        res = {
            header: jasmine.createSpy('res.header()'),
            send: jasmine.createSpy('res.send()')
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('error');
    });
    
    fdescribe('setupSvc', function() {
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
    
    fdescribe('credit check validation', function() {
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
    
    fdescribe('fetchOrg', function() {
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
    
    fdescribe('fetchCampaign', function() {
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
        var config, pgResp;
        beforeEach(function() {
            config = { api: {
                root: 'http://c6.com',
                orgs: { endpoint: '/api/account/orgs/' }
            } };

            req.requester.permissions = { orgs: { read: Scope.Own } };
            req.user = { id: 'u-1', org: 'o-2' };
            req.query = { org: 'o-1' };

            spyOn(requestUtils, 'proxyRequest').and.returnValue(q({
                response: { statusCode: 200 },
                body: { id: 'o-1' }
            }));
            pgResp = { rows: [
                { sign: 1, total: '1112.34' },
                { sign: -1, total: '666.7891' }
            ] };
            spyOn(pgUtils, 'query').and.callFake(function() { return q(pgResp); });
        });

        it('should fetch and return the org\'s balance and total spend', function(done) {
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 445.55, totalSpend: 666.79 }
                });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://c6.com/api/account/orgs/o-1',
                    qs: { fields: 'id' }
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1']);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT sign,sum\(amount\) as total FROM fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/WHERE org_id = \$1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/GROUP BY sign/);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default to the requester\'s org', function(done) {
            delete req.query.org;
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 445.55, totalSpend: 666.79 }
                });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://c6.com/api/account/orgs/o-2',
                    qs: { fields: 'id' }
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-2']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still fetch the org if the requester has read all priviledges', function(done) {
            req.requester.permissions.orgs.read = Scope.All;
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 445.55, totalSpend: 666.79 }
                });
                expect(requestUtils.proxyRequest).toHaveBeenCalled();
                expect(pgUtils.query).toHaveBeenCalled();
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
                return statsModule.getAccountBalance(req, config);
            })).then(function(results) {
                expect(results[0]).toEqual({ code: 200, body: { balance: 123.45, totalSpend: 0 } });
                expect(results[1]).toEqual({ code: 200, body: { balance: -456.78, totalSpend: 456.78 } });
                expect(results[2]).toEqual({ code: 200, body: { balance: 123.45, totalSpend: 0 } });
                expect(results[3]).toEqual({ code: 200, body: { balance: 0, totalSpend: 0 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org is invalid', function(done) {
            req.query.org = { hax: true };
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the requester\'s org cannot be fetched', function(done) {
            requestUtils.proxyRequest.and.returnValue(q({ response: { statusCode: 400 }, body: 'NOPE' }));
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Cannot fetch balance for this org' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the org request fails', function(done) {
            requestUtils.proxyRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error fetching org');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getAccountBalance(req, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getTotalBudget', function() {
    
    });

    describe('getCampSpend', function() {
    
    });
    
    describe('getOutstandingBudget', function() {
        var config, mockCamps, mockUpdates, colls, mockDb;
        beforeEach(function() {
            config = { api: {
                root: 'http://c6.com',
                campaigns: { endpoint: '/api/campaigns/' }
            } };

            req.user = { id: 'u-1', org: 'o-2' };
            req.query = { org: 'o-1' };
            
            mockCamps = [
                { id: 'cam-1', pricing: { budget: 1000 } },
                { id: 'cam-2', pricing: { budget: 200 } },
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

            spyOn(pgUtils, 'query').and.returnValue(q({ rows: [{ spend: -567.789 }] }));
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { outstandingBudget: 632.21 } });
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: 'o-1', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] } },
                    { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                );
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1', ['cam-1', 'cam-2', 'cam-3', 'cam-4'] ]);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT sum\(amount \* sign\) as spend from fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/where org_id = \$1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/and campaign_id = ANY\(\$2::text\[\]\)/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/and sign = -1/);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default to the requester\'s org', function(done) {
            delete req.query.org;
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { outstandingBudget: 632.21 } });
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: 'o-2', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] } },
                    { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                );
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-2', ['cam-1', 'cam-2', 'cam-3', 'cam-4'] ]);
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
                statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: { outstandingBudget: 1132.31 } });
                    expect(colls.campaigns.find).toHaveBeenCalledWith(
                        { org: 'o-1', status: { $in: [ Status.Active, Status.Paused, Status.Pending ] } },
                        { fields: { id: 1, pricing: 1, updateRequest: 1 } }
                    );
                    expect(colls.campaignUpdates.find).toHaveBeenCalledWith(
                        { id: { $in: ['ur-1', 'ur-2', 'ur-3'] } },
                        { fields: { id: 1, 'data.pricing': 1, campaign: 1 } }
                    );
                    expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1', ['cam-1', 'cam-2', 'cam-3', 'cam-4'] ]);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should effectively ignore updates that do not change the budget', function(done) {
                mockUpdates[0].data = { name: 'foo', pricing: { dailyLimit: 100 } };
                statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: { outstandingBudget: 732.31 } });
                    expect(colls.campaigns.find).toHaveBeenCalled();
                    expect(colls.campaignUpdates.find).toHaveBeenCalled();
                    expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1', ['cam-1', 'cam-2', 'cam-3', 'cam-4'] ]);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if querying for campaignUpdates fails', function(done) {
                cursors.campaignUpdates.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
                statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Error computing outstanding budget');
                    expect(pgUtils.query).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
                }).done(done);
            });
        });
        
        it('should handle postgres returning partial data', function(done) {
            pgUtils.query.and.returnValue(q({ rows: [] }));
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { outstandingBudget: 1200 } });
                expect(pgUtils.query).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not query postgres if no campaigns have a budget', function(done) {
            mockCamps = [{ id: 'cam-1', pricing: {} }];
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { outstandingBudget: 0 } });
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org is invalid', function(done) {
            req.query.org = { hax: true };
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(colls.campaigns.find).not.toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the case where no campaigns are returned', function(done) {
            mockCamps = [];
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { outstandingBudget: 0 } });
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if querying for campaigns fails', function(done) {
            cursors.campaigns.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error computing outstanding budget');
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error computing outstanding budget');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
            }).done(done);
        });
    });
    
    describe('getBalanceStats', function() {
        var config;
        beforeEach(function() {
            spyOn(statsModule, 'getAccountBalance').and.returnValue(q({ code: 200, body: { balance: 789.01, totalSpend: 456.1 } }));
            spyOn(statsModule, 'getOutstandingBudget').and.returnValue(q({ code: 200, body: { outstandingBudget: 123.2 } }));
            config = { config: 'yes' };
        });
        
        it('should get the account balance + outstanding budget, and respond with both', function(done) {
            statsModule.getBalanceStats(req, config, 'c6Db').then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 }
                });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(req, config);
                expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(req, config, 'c6Db');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        ['getAccountBalance', 'getOutstandingBudget'].forEach(function(method) {
            describe('if ' + method + ' returns a non-2xx response', function() {
                it('should return the non-2xx response', function(done) {
                    statsModule[method].and.returnValue(q({ code: 400, body: 'I got a problem with YOU' }));

                    statsModule.getBalanceStats(req, config).then(function(resp) {
                        expect(resp).toEqual({ code: 400, body: 'I got a problem with YOU' });
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                    }).done(done);
                });
            });

            describe('if ' + method + ' rejects', function() {
                it('should reject', function(done) {
                    statsModule[method].and.returnValue(q.reject('I got a problem!'));

                    statsModule.getBalanceStats(req, config).then(function(resp) {
                        expect(resp).not.toBeDefined();
                    }).catch(function(error) {
                        expect(error).toBe('I got a problem!');
                    }).done(done);
                });
            });
        });
    });
    
    describe('creditCheck', function() {
    
    });
    
    describe('setupEndpoints', function() {
    
    });
    


    describe('main', function() {
        var state, mockExpress, expressApp, expressRoutes, mockSvc, basicMidware, errorHandler, fakeJournal;
        beforeEach(function() {
            function getCollSpy() {
                return jasmine.createSpy('db.collection()').and.callFake(function(collName) {
                    return { db: this, collectionName: collName };
                });
            }
            state = {
                clusterMaster: false,
                dbs: {
                    c6Db: { collection: getCollSpy() },
                    c6Journal: { collection: getCollSpy() }
                },
                sessions: jasmine.createSpy('sessions()'),
                config: {
                    appName: 'statsModule',
                    appVersion: 'statsModule-1.2.3'
                },
                cmdl: {
                    port: 6666
                }
            };
            expressRoutes = {
                get: {},
                post: {}
            };
            mockExpress = require.cache[require.resolve('express')].exports = jasmine.createSpy('express()').and.callFake(function() {
                expressApp = express.apply(null, arguments);

                spyOn(expressApp, 'listen');
                spyOn(expressApp, 'use');
                spyOn(expressApp, 'get').and.callFake(function(route/*, middleware*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes.get[route] = (expressRoutes.get[route] || []).concat(middleware);
                });
                spyOn(expressApp, 'post').and.callFake(function(route/*, middleware*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes.post[route] = (expressRoutes.post[route] || []).concat(middleware);
                });
                spyOn(expressApp, 'set');

                return expressApp;
            });
            basicMidware = jasmine.createSpy('basicMidware()');
            errorHandler = jasmine.createSpy('errorHandler()');
            spyOn(expressUtils, 'basicMiddleware').and.returnValue(basicMidware);
            spyOn(expressUtils, 'errorHandler').and.returnValue(errorHandler);

            fakeJournal = {
                _midware: jasmine.createSpy('journal.middleware'),
                middleware: {
                    bind: jasmine.createSpy('bind()').and.callFake(function() { return fakeJournal._midware; })
                }
            };
            spyOn(journal, 'AuditJournal').and.returnValue(fakeJournal);
            
            spyOn(authUtils, 'middlewarify').and.callFake(function(opts) {
                return { opts: opts };
            });
            
            delete require.cache[require.resolve('../../bin/statsModule')];
            statsModule = require('../../bin/statsModule');
        });

        afterEach(function() {
            delete require.cache[require.resolve('express')];
            delete authUtils._db;
        });
        
        describe('if the process is the clusterMaster', function() {
            beforeEach(function() {
                state.clusterMaster = true;
            });

            it('should return without setting up express', function() {
                var resp = statsModule.main(state);
                expect(resp).toBe(state);
                expect(mockExpress).not.toHaveBeenCalled();
                expect(expressApp).not.toBeDefined();
            });
        });
        
        it('should setup the express app', function() {
            var resp = statsModule.main(state);
            expect(mockExpress).toHaveBeenCalled();
            expect(expressApp.set).toHaveBeenCalledWith('json spaces', 2);
            expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
            expect(expressApp.use).toHaveBeenCalledWith(basicMidware);
            expect(expressApp.use).toHaveBeenCalledWith(errorHandler);
            expect(expressApp.listen).toHaveBeenCalledWith(6666);
        });
        
        it('should initialize the journal', function() {
            var resp = statsModule.main(state);
            expect(journal.AuditJournal).toHaveBeenCalledWith({ db: state.dbs.c6Journal, collectionName: 'audit' }, 'statsModule-1.2.3', 'statsModule');
        });
        
        it('should set the authUtils._db', function() {
            var resp = statsModule.main(state);
            expect(authUtils._db).toBe(state.dbs.c6Db);
        });
        
        describe('creates a handler for GET /api/accounting/meta that', function() {
            beforeEach(function() {
                jasmine.clock().install();
                jasmine.clock().mockDate(new Date('2016-02-10T17:25:38.555Z'));
                statsModule.main(state);
            });
            
            afterEach(function() {
                jasmine.clock().uninstall();
            });

            it('should exist and include no middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/accounting/meta', jasmine.any(Function));
            });
            
            it('should return some service metadata when called', function() {
                var handler = expressRoutes.get['/api/accounting/meta'][0];
                handler(req, res, next);
                expect(res.send).toHaveBeenCalledWith(200, {
                    version: 'statsModule-1.2.3',
                    status: 'OK',
                    started: '2016-02-10T17:25:38.555Z'
                });
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe('creates a handler for GET /api/accounting/version that', function() {
            beforeEach(function() {
                statsModule.main(state);
            });
            
            it('should exist and include no middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/accounting/version', jasmine.any(Function));
            });
            
            it('should return the service version when called', function() {
                var handler = expressRoutes.get['/api/accounting/version'][0];
                handler(req, res, next);
                expect(res.send).toHaveBeenCalledWith(200, 'statsModule-1.2.3');
            });
        });

        describe('creates a handler for GET /api/transactions that', function() {
            beforeEach(function() {
                statsModule.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/transactions?', state.sessions, { opts: {
                    allowApps: true,
                    permissions: { transactions: 'read' }
                } }, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.get['/api/transactions?'][expressRoutes.get['/api/transactions?'].length - 1];
                    spyOn(statsModule, 'getTransactions').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call statsModule.getTransactions and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.getTransactions).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should return a 500 if statsModule.getTransactions rejects', function(done) {
                    statsModule.getTransactions.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error fetching transactions', detail: 'I GOT A PROBLEM' });
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.getTransactions).toHaveBeenCalledWith(req);
                    }).done(done);
                });
            });
        });

        describe('creates a handler for POST /api/transactions that', function() {
            beforeEach(function() {
                statsModule.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.post).toHaveBeenCalledWith('/api/transactions?', { opts: {
                    allowApps: true,
                    permissions: { transactions: 'create' }
                } }, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/api/transactions?'][expressRoutes.post['/api/transactions?'].length - 1];
                    spyOn(statsModule, 'createTransaction').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call statsModule.createTransaction and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.createTransaction).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should return a 500 if statsModule.createTransaction rejects', function(done) {
                    statsModule.createTransaction.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error creating transaction', detail: 'I GOT A PROBLEM' });
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.createTransaction).toHaveBeenCalledWith(req);
                    }).done(done);
                });
            });
        });

        describe('creates a handler for GET /api/accounting/balance that', function() {
            beforeEach(function() {
                statsModule.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/accounting/balance', state.sessions, { opts: {
                    allowApps: true,
                    permissions: { orgs: 'read' }
                } }, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    req.query = {};
                    handler = expressRoutes.get['/api/accounting/balance'][expressRoutes.get['/api/accounting/balance'].length - 1];
                    spyOn(statsModule, 'getBalanceStats').and.returnValue(q({
                        code: 200,
                        body: { balance: 100, outstandingBudget: 20 }
                    }));
                });
                
                it('should call statsModule.getBalanceStats and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, { balance: 100, outstandingBudget: 20 });
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.getBalanceStats).toHaveBeenCalledWith(req, state.config, state.dbs.c6Db);
                    }).done(done);
                });
                
                it('should return a 500 if statsModule.getBalanceStats rejects', function(done) {
                    statsModule.getBalanceStats.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error retrieving balance', detail: 'I GOT A PROBLEM' });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(statsModule.getBalanceStats).toHaveBeenCalledWith(req, state.config, state.dbs.c6Db);
                    }).done(done);
                });
            });
        });
    });
});
