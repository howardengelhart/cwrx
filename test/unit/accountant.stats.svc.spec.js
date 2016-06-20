var flush = true;
describe('statsModule-stats (UT)', function() {
    var mockLog, Model, MiddleManager, CrudSvc, logger, q, statsModule, authUtils, JobManager, util,
        requestUtils, objUtils, pgUtils, req, nextSpy, doneSpy, errorSpy, mockDb, Status, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        util            = require('util');
        statsModule     = require('../../bin/accountant-stats');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        MiddleManager   = require('../../lib/middleManager');
        JobManager      = require('../../lib/jobManager');
        CrudSvc         = require('../../lib/crudSvc');
        requestUtils    = require('../../lib/requestUtils');
        authUtils       = require('../../lib/authUtils');
        objUtils        = require('../../lib/objUtils');
        pgUtils         = require('../../lib/pgUtils');
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
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('error');
    });
    
    describe('setupSvc', function() {
        var svc, config, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

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

            boundFns = [];
            [Model.prototype.midWare, CrudSvc.fetchRelatedEntity].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = Function.prototype.bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });

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
        
        it('should validate the body on creditCheck', function() {
            var checkModel = Model.prototype.midWare.bind.calls.mostRecent().args[0];
            expect(svc._middleware.creditCheck).toContain(getBoundFn(Model.prototype.midWare, [checkModel, 'create']));

            expect(checkModel).toEqual(jasmine.any(Model));
            expect(checkModel.objName).toEqual('creditCheck');
            expect(checkModel.schema).toEqual(statsModule.creditCheckSchema);
        });
        
        it('should fetch the org + campaign on creditCheck', function() {
            expect(svc._middleware.creditCheck).toContain(getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'orgs',
                idPath: ['body.org']
            }, statsModule.config.api]));
            expect(svc._middleware.creditCheck).toContain(getBoundFn(CrudSvc.fetchRelatedEntity, [CrudSvc, {
                objName: 'campaigns',
                idPath: ['body.campaign']
            }, statsModule.config.api]));
            expect(svc._middleware.creditCheck).toContain(statsModule.checkCampaignOwnership);
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
    
    describe('checkCampaignOwnership', function() {
        beforeEach(function() {
            req.body = { org: 'o-1', campaign: 'cam-1' };
            req.org = { id: 'o-1', name: 'org 1' };
            req.campaign = { id: 'cam-1', org: 'o-1', name: 'camp 1' };
        });
        
        it('should call next if the campaign belongs to the org', function() {
            statsModule.checkCampaignOwnership(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if the campaign does not belong to the org', function() {
            req.campaign.org = 'o-2';
            statsModule.checkCampaignOwnership(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign cam-1 does not belong to o-1' });
        });
    });
    
    describe('fetchOrgs', function() {
        var mockColl, mockCursor, orgIds, mongoResp;
        beforeEach(function() {
            orgIds = ['o-1', 'o-2', 'o-3'];
            req.requester.permissions = { orgs: { read: Scope.All } };
            mongoResp = [{ id: 'o-1' }, { id: 'o-2' }, { id: 'o-3' }];
            mockCursor = {
                toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function() { return q(mongoResp); })
            };
            mockColl = { find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor) };
            mockDb.collection.and.returnValue(mockColl);
        });
        
        it('should fetch and return all provided orgs if the requester is an admin', function(done) {
            statsModule.fetchOrgs(mockDb, orgIds, req).then(function(resp) {
                expect(resp).toEqual([{ id: 'o-1' }, { id: 'o-2' }, { id: 'o-3' }]);
                expect(mockDb.collection).toHaveBeenCalledWith('orgs');
                expect(mockColl.find).toHaveBeenCalledWith({
                    id: { $in: ['o-1', 'o-2', 'o-3'] },
                    status: { $ne: Status.Deleted }
                });
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if no orgIds are provided', function(done) {
            q.all([
                statsModule.fetchOrgs(mockDb, [], req),
                statsModule.fetchOrgs(mockDb, undefined, req)
            ]).then(function(results) {
                expect(results[0]).toEqual([]);
                expect(results[1]).toEqual([]);
                expect(mockColl.find).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the requester is not an admin', function(done) {
            beforeEach(function() {
                mongoResp = [{ id: 'o-1' }];
                req.user = { id: 'u-1', org: 'o-1' };
                req.requester.permissions.orgs.read = Scope.Org;
            });

            it('should allow them to fetch their own org', function(done) {
                statsModule.fetchOrgs(mockDb, orgIds, req).then(function(resp) {
                    expect(resp).toEqual([{ id: 'o-1' }]);
                    expect(mockColl.find).toHaveBeenCalledWith({
                        id: { $in: ['o-1'] },
                        status: { $ne: Status.Deleted }
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should skip if they are not attempting to fetch their own org', function(done) {
                orgIds = ['o-2', 'o-3'];
                statsModule.fetchOrgs(mockDb, orgIds, req).then(function(resp) {
                    expect(resp).toEqual([]);
                    expect(mockColl.find).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should skip if they do not have an org', function(done) {
                delete req.user;
                statsModule.fetchOrgs(mockDb, orgIds, req).then(function(resp) {
                    expect(resp).toEqual([]);
                    expect(mockColl.find).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should fail if mongo fails', function(done) {
            mongoResp = q.reject('I GOT A PROBLEM');
            statsModule.fetchOrgs(mockDb, orgIds, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('I GOT A PROBLEM'));
            }).done(done);
        });
    });
    
    describe('getAccountBalance', function() {
        var pgResp, orgIds;
        beforeEach(function() {
            orgIds = ['o-1', 'o-2', 'o-3'];
            pgResp = { rows: [
                { org_id: 'o-1', sign: 1, total: '1111.11' },
                { org_id: 'o-1', sign: -1, total: '11.11' },
                { org_id: 'o-2', sign: 1, total: '2222.22' },
                { org_id: 'o-2', sign: -1, total: '22.22' }
            ] };
            spyOn(pgUtils, 'query').and.callFake(function() { return q(pgResp); });
        });

        it('should fetch and return the orgs\' balance and total spend', function(done) {
            statsModule.getAccountBalance(orgIds, req).then(function(resp) {
                expect(resp).toEqual({
                    'o-1': { balance: 1100, totalSpend: 11.11 },
                    'o-2': { balance: 2200, totalSpend: 22.22 },
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), [['o-1', 'o-2', 'o-3']]);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT org_id,sign,sum\(amount\) as total FROM fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/WHERE org_id = ANY\(\$1::text\[\]\)/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/GROUP BY org_id,sign/);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle postgres returning partial data', function(done) {
            var data = [
                { rows: [{ org_id: 'o-1', sign: 1, total: '123.45' }] },
                { rows: [{ org_id: 'o-2', sign: -1, total: '456.78' }] },
                { rows: [{ org_id: 'o-1', sign: 1, total: '123.45' }, { org_id: 'o-1', sign: -1, total: null }] },
            ];
            pgUtils.query.and.callFake(function() {
                return q(data[pgUtils.query.calls.count() - 1]);
            });
            
            q.all(data.map(function() {
                return statsModule.getAccountBalance(orgIds, req);
            })).then(function(results) {
                expect(results[0]).toEqual({ 'o-1': { balance: 123.45 } });
                expect(results[1]).toEqual({ 'o-2': { balance: -456.78, totalSpend: 456.78 } });
                expect(results[2]).toEqual({ 'o-1': { balance: 123.45, totalSpend: 0 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getAccountBalance(orgIds, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getTotalBudget', function() {
        var orgIds, mockCamps, mockUpdates, colls, cursors, mockDb;
        beforeEach(function() {
            orgIds = ['o-1', 'o-2', 'o-3'];
            mockCamps = [
                { id: 'cam-1', org: 'o-1', pricing: { budget: 1000 } },
                { id: 'cam-2', org: 'o-1', pricing: { budget: 200.654 } },
                { id: 'cam-3', org: 'o-1', pricing: {} },
                { id: 'cam-4', org: 'o-2', },
                { id: 'cam-5', org: 'o-2', pricing: { budget: 555 } }
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
            statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).toEqual({ 'o-1': jasmine.any(Object), 'o-2': jasmine.any(Object), campaigns: mockCamps });
                expect(resp['o-1']).toEqual({ totalBudget: 1200.65 });
                expect(resp['o-2']).toEqual({ totalBudget: 555 });
                expect(resp.campaigns).toBe(mockCamps);
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: { $in: ['o-1', 'o-2', 'o-3'] }, status: { $in: [ Status.Active, Status.Paused, Status.Pending ] }, id: { $nin: [] } },
                    { fields: { id: 1, org: 1, pricing: 1, updateRequest: 1 } }
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
            statsModule.getTotalBudget(orgIds, mockDb, req, opts).then(function(resp) {
                expect(resp).toEqual({ 'o-1': jasmine.any(Object), 'o-2': jasmine.any(Object), campaigns: mockCamps });
                expect(resp['o-1']).toEqual({ totalBudget: 200.65 });
                expect(resp.campaigns).toBe(mockCamps);
                expect(colls.campaigns.find).toHaveBeenCalledWith(
                    { org: { $in: ['o-1', 'o-2', 'o-3'] }, status: { $in: [ Status.Active, Status.Paused, Status.Pending ] }, id: { $nin: ['cam-1'] } },
                    { fields: { id: 1, org: 1, pricing: 1, updateRequest: 1 } }
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
                statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
                    expect(resp).toEqual({ 'o-1': jasmine.any(Object), 'o-2': jasmine.any(Object), campaigns: mockCamps });
                    expect(resp['o-1']).toEqual({ totalBudget: 1700.75 });
                    expect(resp['o-2']).toEqual({ totalBudget: 555 });
                    expect(resp.campaigns).toBe(mockCamps);
                    expect(colls.campaigns.find).toHaveBeenCalled();
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
                statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
                    expect(resp['o-1']).toEqual({ totalBudget: 1300.75 });
                    expect(resp['o-2']).toEqual({ totalBudget: 555 });
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
                statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
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
            statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).toEqual({ campaigns: [] });
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if querying for campaigns fails', function(done) {
            cursors.campaigns.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getTotalBudget(orgIds, mockDb, req).then(function(resp) {
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
        var orgIds;
        beforeEach(function() {
            orgIds = ['o-1', 'o-2', 'o-3'];
            spyOn(pgUtils, 'query').and.returnValue(q({ rows: [
                { org_id: 'o-1', spend: 567.789 },
                { org_id: 'o-2', spend: 123.456 }
            ] }));
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            statsModule.getCampSpend('o-1', ['cam-1', 'cam-2'], req).then(function(resp) {
                expect(resp).toEqual({ 'o-1': { spend: 567.789 }, 'o-2': { spend: 123.456 } });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1', ['cam-1', 'cam-2'] ]);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT org_id,sum\(amount\) as spend from fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/WHERE org_id = ANY\(\$1::text\[\]\)/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/AND campaign_id = ANY\(\$2::text\[\]\)/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/AND sign = -1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/GROUP BY org_id/);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should handle postgres returning partial data', function(done) {
            pgUtils.query.and.returnValue(q({ rows: [] }));
            statsModule.getCampSpend('o-1', ['cam-1', 'cam-2'], req).then(function(resp) {
                expect(resp).toEqual({});
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
        var budgetResp, spendResp, mockDb, orgIds;
        beforeEach(function() {
            orgIds = ['o-1', 'o-2', 'o-3'];
            mockDb = 'c6Db';
            budgetResp = {
                'o-1': { totalBudget: 1000 },
                'o-2': { totalBudget: 2000 },
                'o-3': { totalBudget: 3000 },
                campaigns: [{ id: 'cam-1' }, { id: 'cam-2' }, { id: 'cam-3' }]
            };
            spendResp = {
                'o-1': { spend: 111.11 },
                'o-2': { spend: 222.22 },
                'o-3': { spend: 333.33 }
            };
            spyOn(statsModule, 'getTotalBudget').and.callFake(function() { return q(budgetResp); });
            spyOn(statsModule, 'getCampSpend').and.callFake(function() { return q(spendResp); });
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            statsModule.getOutstandingBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).toEqual({
                    'o-1': { outstandingBudget: 888.89 },
                    'o-2': { outstandingBudget: 1777.78 },
                    'o-3': { outstandingBudget: 2666.67 },
                });
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(orgIds, mockDb, req);
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(orgIds, ['cam-1', 'cam-2', 'cam-3'], req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle orgs whose total budget or spend cannot be fetched', function(done) {
            delete budgetResp['o-1'];
            delete spendResp['o-2'];
            delete budgetResp['o-3'];
            delete spendResp['o-3'];
            statsModule.getOutstandingBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).toEqual({
                    'o-1': { outstandingBudget: -111.11 },
                    'o-2': { outstandingBudget: 2000 },
                    'o-3': null,
                });
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(orgIds, mockDb, req);
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(orgIds, ['cam-1', 'cam-2', 'cam-3'], req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getTotalBudget fails', function(done) {
            budgetResp = q.reject('I GOT A PROBLEM');
            statsModule.getOutstandingBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(statsModule.getTotalBudget).toHaveBeenCalled();
                expect(statsModule.getCampSpend).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if getCampSpend fails', function(done) {
            statsModule.getCampSpend.and.returnValue(q.reject('I GOT A PROBLEM'));
            statsModule.getOutstandingBudget(orgIds, mockDb, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getBalanceStats', function() {
        var svc, balanceResp, budgetResp, orgResp;
        beforeEach(function() {
            req.query = { org: 'o-1' };
            req.user = { id: 'u-1', org: 'o-2' };
            balanceResp = {
                'o-1': { balance: 789.01, totalSpend: 456.1 }
            };
            budgetResp = {
                'o-1': { outstandingBudget: 123.2 }
            };
            orgResp = [{ id: 'o-1' }];
            spyOn(statsModule, 'fetchOrgs').and.callFake(function() { return q(orgResp); });
            spyOn(statsModule, 'getAccountBalance').and.callFake(function() { return q(balanceResp); });
            spyOn(statsModule, 'getOutstandingBudget').and.callFake(function() { return q(budgetResp); });
            svc = {
                runAction: jasmine.createSpy('runAction').and.callFake(function(req, action, cb) { return cb(); }),
                _db: 'c6Db'
            };
        });
        
        describe('if fetching stats for one org', function() {
            it('should get the account balance + outstanding budget, and respond with both', function(done) {
                statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-1'], req);
                    expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'], req);
                    expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should default to the requester\'s org', function(done) {
                delete req.query.org;
                orgResp = [{ id: 'o-2' }];
                balanceResp = { 'o-2': balanceResp['o-1'] };
                budgetResp = { 'o-2': budgetResp['o-1'] };
                statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-2'], req);
                    expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-2'], req);
                    expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(['o-2'], 'c6Db', req);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the org param is unset and cannot be defaulted', function(done) {
                delete req.query.org;
                delete req.user;
                
                statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                    expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                    expect(statsModule.fetchOrgs).not.toHaveBeenCalled();
                    expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                    expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });

            it('should return a 404 if the org cannot be found', function(done) {
                orgResp = [{ id: 'o-4' }];
                statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                    expect(resp).toEqual({ code: 404, body: 'Cannot fetch this org' });
                    expect(statsModule.fetchOrgs).toHaveBeenCalled();
                    expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                    expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });
            
            it('should handle the case where no budget or account balance can be fetched for the org', function(done) {
                balanceResp = {};
                budgetResp = {};
                statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: { balance: 0, totalSpend: 0, outstandingBudget: 0 }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-1'], req);
                    expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'], req);
                    expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if fetching stats for multiple orgs', function() {
            beforeEach(function() {
                req.query = { orgs: 'o-1,o-2,o-3' };
                orgResp = [{ id: 'o-1' }, { id: 'o-2' }];
                balanceResp['o-2'] = { balance: 222.2, totalSpend: 121.2 };
                budgetResp['o-2'] = { outstandingBudget: 321.2 };
            });

            it('should return an object with stats for each org that can be fetched', function(done) {
                statsModule.getBalanceStats(svc, req, true).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: {
                            'o-1': { balance: 789.01, totalSpend: 456.1, outstandingBudget: 123.2 },
                            'o-2': { balance: 222.2, totalSpend: 121.2, outstandingBudget: 321.2 },
                            'o-3': null
                        }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-1', 'o-2', 'o-3'], req);
                    expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1', 'o-2'], req);
                    expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(['o-1', 'o-2'], 'c6Db', req);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should return early if no orgs can be fetched', function(done) {
                orgResp = [];
                statsModule.getBalanceStats(svc, req, true).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: {
                            'o-1': null,
                            'o-2': null,
                            'o-3': null
                        }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-1', 'o-2', 'o-3'], req);
                    expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                    expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should default the orgs param to the user\'s org', function(done) {
                delete req.query.orgs;
                statsModule.getBalanceStats(svc, req, true).then(function(resp) {
                    expect(resp).toEqual({
                        code: 200,
                        body: {
                            'o-2': { balance: 222.2, totalSpend: 121.2, outstandingBudget: 321.2 }
                        }
                    });
                    expect(statsModule.fetchOrgs).toHaveBeenCalledWith('c6Db', ['o-2'], req);
                    expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-2'], req);
                    expect(statsModule.getOutstandingBudget).toHaveBeenCalledWith(['o-2'], 'c6Db', req);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the orgs param cannot be defaulted', function(done) {
                delete req.query.orgs;
                delete req.user;
                
                statsModule.getBalanceStats(svc, req, true).then(function(resp) {
                    expect(resp).toEqual({ code: 400, body: 'Must provide a list of orgs' });
                    expect(statsModule.fetchOrgs).not.toHaveBeenCalled();
                    expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                    expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return early if runAction returns a 4xx response', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'not today, buddy' }));
            statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'not today, buddy' });
                expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should reject if fetchOrgs rejects', function(done) {
            statsModule.fetchOrgs.and.returnValue(q.reject('cannot fetch em captain'));
            statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('cannot fetch em captain');
                expect(statsModule.getAccountBalance).not.toHaveBeenCalled();
                expect(statsModule.getOutstandingBudget).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if getAccountBalance rejects', function(done) {
            statsModule.getAccountBalance.and.returnValue(q.reject('I got a problem!'));
            statsModule.getBalanceStats(svc, req, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I got a problem!');
            }).done(done);
        });
        
        it('should reject if getOutstandingBudget rejects', function(done) {
            statsModule.getOutstandingBudget.and.returnValue(q.reject('I got a problem!'));
            statsModule.getBalanceStats(svc, req, false).then(function(resp) {
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
                getAccountBalance: { 'o-1': { balance: 789.01, totalSpend: 456.1 } },
                getTotalBudget: { 'o-1': { totalBudget: 123.2 }, campaigns: [{ id: 'cam-1' }, { id: 'cam-2' }] },
                getCampSpend: { 'o-1': { spend: 400.12 } },
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
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'],req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(['o-1'], ['cam-1', 'cam-2', 'cam-req'], req);
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
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'],req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(['o-1'], ['cam-1', 'cam-2', 'cam-req'], req);
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
            resps.getTotalBudget = { 'o-1': { totalBudget: 0 }, campaigns: [] };
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'], req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(['o-1'], ['cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(388.36);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the case where no stats are found for the org', function(done) {
            delete resps.getAccountBalance['o-1'];
            delete resps.getTotalBudget['o-1'];
            delete resps.getCampSpend['o-1'];
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 402, body: { message: 'Insufficient funds for changes to campaign', depositAmount: 800.77 } });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'], req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(['o-1'], ['cam-1', 'cam-2', 'cam-req'], req);
                expect(mockLog.info).toHaveBeenCalled();
                expect(mockLog.info.calls.mostRecent().args).toContain(800.77);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a campaign that has no budget at all', function(done) {
            delete req.body.newBudget;
            delete req.campaign.pricing;
            statsModule.creditCheck(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 204 });
                expect(statsModule.getAccountBalance).toHaveBeenCalledWith(['o-1'],req);
                expect(statsModule.getTotalBudget).toHaveBeenCalledWith(['o-1'], 'c6Db', req, { excludeCamps: ['cam-req'] });
                expect(statsModule.getCampSpend).toHaveBeenCalledWith(['o-1'], ['cam-1', 'cam-2', 'cam-req'], req);
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

            jobManager = new JobManager('fakeCache', {});
            spyOn(jobManager.setJobTimeout, 'bind').and.returnValue(jobManager.setJobTimeout);
            spyOn(jobManager, 'endJob').and.returnValue(q());

            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
            
            statsModule.setupEndpoints(app, svc, sessions, audit, jobManager);
        });

        describe('creates a handler for GET /api/accounting/balances that', function() {
            it('should exist and include necessary middleware', function() {
                expect(app.get).toHaveBeenCalledWith('/api/accounting/balances', 'sessionsMidware', { opts: {
                    allowApps: true,
                    permissions: { orgs: 'read' }
                } }, 'auditMidware', jobManager.setJobTimeout, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.get['/api/accounting/balances'][expressRoutes.get['/api/accounting/balances'].length - 1];
                    spyOn(statsModule, 'getBalanceStats').and.returnValue(q({
                        code: 200,
                        body: { balance: 100, outstandingBudget: 20 }
                    }));
                });
                
                it('should call getBalanceStats and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'fulfilled',
                            value: { code: 200, body: { balance: 100, outstandingBudget: 20 } }
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(statsModule.getBalanceStats).toHaveBeenCalledWith(svc, req, true);
                    }).done(done);
                });
                
                it('should handle errors from getBalanceStats', function(done) {
                    statsModule.getBalanceStats.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'rejected',
                            reason: 'I GOT A PROBLEM'
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
        
        describe('creates a handler for GET /api/accounting/balance that', function() {
            it('should exist and include necessary middleware', function() {
                expect(app.get).toHaveBeenCalledWith('/api/accounting/balance', 'sessionsMidware', { opts: {
                    allowApps: true,
                    permissions: { orgs: 'read' }
                } }, 'auditMidware', jobManager.setJobTimeout, jasmine.any(Function));
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
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'fulfilled',
                            value: { code: 200, body: { balance: 100, outstandingBudget: 20 } }
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(statsModule.getBalanceStats).toHaveBeenCalledWith(svc, req, false);
                    }).done(done);
                });
                
                it('should handle errors from getBalanceStats', function(done) {
                    statsModule.getBalanceStats.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'rejected',
                            reason: 'I GOT A PROBLEM'
                        });
                        expect(res.send).not.toHaveBeenCalled();
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
                } }, 'auditMidware', jobManager.setJobTimeout, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/api/accounting/credit-check'][expressRoutes.post['/api/accounting/credit-check'].length - 1];
                    spyOn(statsModule, 'creditCheck').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call creditCheck and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'fulfilled',
                            value: { code: 400, body: 'i got a problem with YOU' }
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(statsModule.creditCheck).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from creditCheck', function(done) {
                    statsModule.creditCheck.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'rejected',
                            reason: 'I GOT A PROBLEM'
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});
