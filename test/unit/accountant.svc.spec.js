var flush = true;
describe('geo (UT)', function() {
    var mockLog, Model, logger, q, accountant, express, expressUtils, journal, authUtils, uuid,
        requestUtils, pgUtils, req, res, next, Status, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        express         = require('express');
        accountant      = require('../../bin/accountant');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        uuid            = require('rc-uuid');
        expressUtils    = require('../../lib/expressUtils');
        requestUtils    = require('../../lib/requestUtils');
        authUtils       = require('../../lib/authUtils');
        pgUtils         = require('../../lib/pgUtils');
        journal         = require('../../lib/journal');
        Status          = require('../../lib/enums').Status;
        Scope           = require('../../lib/enums').Scope;

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
        
        req = { uuid: '1234', requester: { id: 'u-1' } };
        res = {
            header: jasmine.createSpy('res.header()'),
            send: jasmine.createSpy('res.send()')
        };
        next = jasmine.createSpy('next');
    });

    describe('transaction validation', function() {
        var model, newObj, origObj, requester;
        beforeEach(function() {
            model = new Model('transactions', accountant.transactionSchema);
            newObj = { amount: 10, org: 'o-1' };
            origObj = {};
            requester = { fieldValidation: { transactions: {} } };
        });
        
        describe('when handling transactionTS', function() {
            it('should allow the field to be set', function() {
                newObj.transactionTS = new Date('2016-03-17T20:29:06.754Z');
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.transactionTS).toEqual(new Date('2016-03-17T20:29:06.754Z'));
            });

            it('should cast a string date to a Date object', function() {
                newObj.transactionTS = new Date('2016-03-17T20:29:06.754Z');
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.transactionTS).toEqual(new Date('2016-03-17T20:29:06.754Z'));
            });

            it('fail if the field is not a valid date', function() {
                newObj.transactionTS = 'fasdfasdfasdfasdf2016-03-17dfasdf:06.754Z';
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'transactionTS must be in format: Date' });
            });
        });
        
        describe('when handling org', function() {
            it('should fail if the field is not a string', function() {
                newObj.org = 123;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'org must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.org).toEqual('o-1');
            });

            it('should fail if the field is not defined', function() {
                delete newObj.org;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: org' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.org;
                origObj.org = 'o-2';
                expect(model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.org).toEqual('o-2');
            });
        });
        
        describe('when handling amount', function() {
            it('should fail if the field is not a number', function() {
                newObj.amount = 'SO MANY DOLLARS';
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'amount must be in format: number' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.amount).toEqual(10);
            });

            it('should fail if the field is not defined', function() {
                delete newObj.amount;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: amount' });
            });

            it('should fail if the field does not match the limits', function() {
                newObj.amount = -1234;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'amount must be greater than the min: 0' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.amount;
                origObj.amount = 12345;
                expect(model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.amount).toEqual(12345);
            });
        });
        
        describe('when handling sign', function() {
            it('should replace the field with a default', function() {
                newObj.sign = 12345;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.sign).toEqual(1);
            });
            
            it('should allow some requesters to set a different sign', function() {
                requester.fieldValidation.transactions.sign = { __allowed: true };
                newObj.sign = -1;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.sign).toEqual(-1);
            });
            
            it('should only allow 1 or -1', function() {
                requester.fieldValidation.transactions.sign = { __allowed: true };
                newObj.sign = 12345;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'sign is UNACCEPTABLE! acceptable values are: [1,-1]' });
            });
            
            it('should not allow the field to be null', function() {
                requester.fieldValidation.transactions.sign = { __allowed: true };
                newObj.sign = null;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.sign).toEqual(1);
            });
        });
        
        describe('when handling units', function() {
            it('should replace the field with a default', function() {
                newObj.units = 12345;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.units).toEqual(1);
            });
            
            it('should allow some requesters to set units', function() {
                requester.fieldValidation.transactions.units = { __allowed: true };
                newObj.units = 14;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.units).toEqual(14);
            });
            
            it('should not allow the field to be null', function() {
                requester.fieldValidation.transactions.units = { __allowed: true };
                newObj.units = null;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.units).toEqual(1);
            });
        });
        
        ['braintreeId', 'promotion', 'campaign', 'description'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a string', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: string' });
                });
                
                it('should allow the field to be set on create', function() {
                    newObj[field] = 'foo';
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual('foo');
                });
            });
        });
    });
    
    describe('formatTransOutput', function() {
        it('should return a JSON representation of a row', function() {
            var row = {
                rec_key         : 1234,
                rec_ts          : '2016-03-17T20:29:06.754Z',
                transaction_id  : 't-1',
                transaction_ts  : '2016-03-17T20:30:32.100Z',
                org_id          : 'o-1',
                amount          : '1000.12',
                sign            : 1,
                units           : 1,
                campaign_id     : 'cam-1',
                braintree_id    : 'payment1',
                promotion_id    : 'pro-1',
                description     : 'i paid a lot of money'
            };
            expect(accountant.formatTransOutput(row)).toEqual({
                id              : 't-1',
                created         : new Date('2016-03-17T20:29:06.754Z'),
                transactionTS   : new Date('2016-03-17T20:30:32.100Z'),
                org             : 'o-1',
                amount          : 1000.12,
                sign            : 1,
                units           : 1,
                campaign        : 'cam-1',
                braintreeId     : 'payment1',
                promotion       : 'pro-1',
                description     : 'i paid a lot of money'
            });
        });
    });

    describe('createTransaction', function() {
        beforeEach(function() {
            req.body = {
                amount: 123.12,
                org: 'o-1',
                braintreeId: 'payment1'
            };
            
            spyOn(uuid, 'createUuid').and.returnValue('asdfqwerzxcv1234');
            spyOn(pgUtils, 'query').and.callFake(function(statement, values) {
                return q({ rows: [{
                    rec_ts          : values[0],
                    transaction_id  : values[1],
                    transaction_ts  : values[2],
                    org_id          : values[3],
                    amount          : values[4],
                    sign            : values[5],
                    units           : values[6],
                    campaign_id     : values[7],
                    braintree_id    : values[8],
                    promotion_id    : values[9],
                    description     : values[10]
                }]});
            });
        });
    
        it('should insert the transaction an return a JSON representation', function(done) {
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: {
                        id              : 't-asdfqwerzxcv1234',
                        created         : jasmine.any(Date),
                        transactionTS   : resp.body.created,
                        amount          : 123.12,
                        sign            : 1,
                        units           : 1,
                        org             : 'o-1',
                        campaign        : undefined,
                        braintreeId     : 'payment1',
                        promotion       : undefined,
                        description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
                    }
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/INSERT INTO fct.billing_transactions/);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow passing a custom transactionTS', function(done) {
            req.body.transactionTS = new Date('2016-04-11T19:26:20.967Z');
            
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: jasmine.objectContaining({
                        id              : 't-asdfqwerzxcv1234',
                        created         : jasmine.any(Date),
                        transactionTS   : new Date('2016-04-11T19:26:20.967Z'),
                        amount          : 123.12
                    })
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the body is invalid', function(done) {
            delete req.body.amount;
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Missing required field: amount' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow creating credits for promotions', function(done) {
            delete req.body.braintreeId;
            req.body.promotion = 'pro-1';
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: jasmine.objectContaining({
                        amount          : 123.12,
                        sign            : 1,
                        braintreeId     : undefined,
                        promotion       : 'pro-1',
                        description     : JSON.stringify({ eventType: 'credit', source: 'promotion' })
                    })
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the transaction is a credit but not linked to a payment or promotion', function(done) {
            delete req.body.braintreeId;
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Cannot create unlinked credit' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow passing in a custom description', function(done) {
            req.body.description = 'we fucked up this guys campaign';
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).toEqual({
                    code: 201,
                    body: jasmine.objectContaining({
                        amount          : 123.12,
                        sign            : 1,
                        description     : 'we fucked up this guys campaign'
                    })
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            accountant.createTransaction(req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('getAccountBalance', function() {
        var config;
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
            spyOn(pgUtils, 'query').and.returnValue(q({ rows: [{ balance: 1234.12 }] }));
        });

        it('should fetch and return the org\'s balance', function(done) {
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 1234.12 });
                expect(requestUtils.proxyRequest).toHaveBeenCalledWith(req, 'get', {
                    url: 'http://c6.com/api/account/orgs/o-1',
                    qs: { fields: 'id' }
                });
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), ['o-1']);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT sum\(amount \* sign\) as balance from fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/where org_id = \$1/);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default to the requester\'s org', function(done) {
            delete req.query.org;
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 1234.12 });
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
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 1234.12 });
                expect(requestUtils.proxyRequest).toHaveBeenCalled();
                expect(pgUtils.query).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle postgres not returning a balance', function(done) {
            pgUtils.query.and.returnValue(q({ rows: [{}] }));

            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 0 });
                expect(requestUtils.proxyRequest).toHaveBeenCalled();
                expect(pgUtils.query).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org is invalid', function(done) {
            req.query.org = { hax: true };
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(requestUtils.proxyRequest).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the requester\'s org cannot be fetched', function(done) {
            requestUtils.proxyRequest.and.returnValue(q({ response: { statusCode: 400 }, body: 'NOPE' }));
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Cannot fetch balance for this org' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the org request fails', function(done) {
            requestUtils.proxyRequest.and.returnValue(q.reject('I GOT A PROBLEM'));
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error fetching org');
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            accountant.getAccountBalance(req, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
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

            spyOn(pgUtils, 'query').and.returnValue(q({ rows: [{ spend: -567.89 }] }));
        });

        it('should sum the org\'s campaign budgets and campaign spend and return the difference', function(done) {
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 632.11 });
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
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 632.11 });
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
                accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: 1132.21 });
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
                accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp.code).toBe(200);
                    expect(resp.body.toFixed(2)).toBe('732.21');
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
                accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Error computing outstanding budget');
                    expect(pgUtils.query).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(mockLog.error.calls.mostRecent().args).toContain('\'I GOT A PROBLEM\'');
                }).done(done);
            });
        });

        it('should not query postgres if no campaigns have a budget', function(done) {
            mockCamps = [{ id: 'cam-1', pricing: {} }];
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 0 });
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org is invalid', function(done) {
            req.query.org = { hax: true };
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
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
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: 0 });
                expect(colls.campaigns.find).toHaveBeenCalled();
                expect(colls.campaignUpdates.find).not.toHaveBeenCalled();
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if querying for campaigns fails', function(done) {
            cursors.campaigns.toArray.and.returnValue(q.reject('I GOT A PROBLEM'));
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
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
            accountant.getOutstandingBudget(req, config, mockDb).then(function(resp) {
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
            spyOn(accountant, 'getAccountBalance').and.returnValue(q({ code: 200, body: 456.1 }));
            spyOn(accountant, 'getOutstandingBudget').and.returnValue(q({ code: 200, body: 123.2 }));
            config = { config: 'yes' };
        });
        
        it('should get the account balance + outstanding budget, and respond with both', function(done) {
            accountant.getBalanceStats(req, config, 'c6Db').then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: { balance: 456.1, outstandingBudget: 123.2 }
                });
                expect(accountant.getAccountBalance).toHaveBeenCalledWith(req, config);
                expect(accountant.getOutstandingBudget).toHaveBeenCalledWith(req, config, 'c6Db');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        ['getAccountBalance', 'getOutstandingBudget'].forEach(function(method) {
            describe('if ' + method + ' returns a non-2xx response', function() {
                it('should return the non-2xx response', function(done) {
                    accountant[method].and.returnValue(q({ code: 400, body: 'I got a problem with YOU' }));

                    accountant.getBalanceStats(req, config).then(function(resp) {
                        expect(resp).toEqual({ code: 400, body: 'I got a problem with YOU' });
                    }).catch(function(error) {
                        expect(error.toString()).not.toBeDefined();
                    }).done(done);
                });
            });

            describe('if ' + method + ' rejects', function() {
                it('should reject', function(done) {
                    accountant[method].and.returnValue(q.reject('I got a problem!'));

                    accountant.getBalanceStats(req, config).then(function(resp) {
                        expect(resp).not.toBeDefined();
                    }).catch(function(error) {
                        expect(error).toBe('I got a problem!');
                    }).done(done);
                });
            });
        });
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
                    appName: 'accountant',
                    appVersion: 'accountant-1.2.3'
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
            
            delete require.cache[require.resolve('../../bin/accountant')];
            accountant = require('../../bin/accountant');
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
                var resp = accountant.main(state);
                expect(resp).toBe(state);
                expect(mockExpress).not.toHaveBeenCalled();
                expect(expressApp).not.toBeDefined();
            });
        });
        
        it('should setup the express app', function() {
            var resp = accountant.main(state);
            expect(mockExpress).toHaveBeenCalled();
            expect(expressApp.set).toHaveBeenCalledWith('json spaces', 2);
            expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
            expect(expressApp.use).toHaveBeenCalledWith(basicMidware);
            expect(expressApp.use).toHaveBeenCalledWith(errorHandler);
            expect(expressApp.listen).toHaveBeenCalledWith(6666);
        });
        
        it('should initialize the journal', function() {
            var resp = accountant.main(state);
            expect(journal.AuditJournal).toHaveBeenCalledWith({ db: state.dbs.c6Journal, collectionName: 'audit' }, 'accountant-1.2.3', 'accountant');
        });
        
        it('should set the authUtils._db', function() {
            var resp = accountant.main(state);
            expect(authUtils._db).toBe(state.dbs.c6Db);
        });
        
        describe('creates a handler for GET /api/accounting/meta that', function() {
            beforeEach(function() {
                jasmine.clock().install();
                jasmine.clock().mockDate(new Date('2016-02-10T17:25:38.555Z'));
                accountant.main(state);
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
                    version: 'accountant-1.2.3',
                    status: 'OK',
                    started: '2016-02-10T17:25:38.555Z'
                });
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe('creates a handler for GET /api/accounting/version that', function() {
            beforeEach(function() {
                accountant.main(state);
            });
            
            it('should exist and include no middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/accounting/version', jasmine.any(Function));
            });
            
            it('should return the service version when called', function() {
                var handler = expressRoutes.get['/api/accounting/version'][0];
                handler(req, res, next);
                expect(res.send).toHaveBeenCalledWith(200, 'accountant-1.2.3');
            });
        });

        describe('creates a handler for POST /api/transactions that', function() {
            var authMidware;
            beforeEach(function() {
                authMidware = jasmine.createSpy('authMidware()');
                spyOn(authUtils, 'middlewarify').and.returnValue(authMidware);
                accountant.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.post).toHaveBeenCalledWith('/api/transactions?',
                    state.sessions, authMidware, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/api/transactions?'][expressRoutes.post['/api/transactions?'].length - 1];
                    spyOn(accountant, 'createTransaction').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call accountant.createTransaction and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(accountant.createTransaction).toHaveBeenCalledWith(req);
                    }).done(done);
                });
                
                it('should return a 500 if accountant.createTransaction rejects', function(done) {
                    accountant.createTransaction.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error creating transaction', detail: 'I GOT A PROBLEM' });
                        expect(next).not.toHaveBeenCalled();
                        expect(accountant.createTransaction).toHaveBeenCalledWith(req);
                    }).done(done);
                });
            });
        });

        describe('creates a handler for GET /api/accounting/balance that', function() {
            var authMidware;
            beforeEach(function() {
                authMidware = jasmine.createSpy('authMidware()');
                spyOn(authUtils, 'middlewarify').and.returnValue(authMidware);
                accountant.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/accounting/balance',
                    state.sessions, authMidware, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    req.query = {};
                    handler = expressRoutes.get['/api/accounting/balance'][expressRoutes.get['/api/accounting/balance'].length - 1];
                    spyOn(accountant, 'getBalanceStats').and.returnValue(q({
                        code: 200,
                        body: { balance: 100, outstandingBudget: 20 }
                    }));
                });
                
                it('should call accountant.getBalanceStats and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, { balance: 100, outstandingBudget: 20 });
                        expect(next).not.toHaveBeenCalled();
                        expect(accountant.getBalanceStats).toHaveBeenCalledWith(req, state.config, state.dbs.c6Db);
                    }).done(done);
                });
                
                it('should return a 500 if accountant.getBalanceStats rejects', function(done) {
                    accountant.getBalanceStats.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error retrieving balance', detail: 'I GOT A PROBLEM' });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(accountant.getBalanceStats).toHaveBeenCalledWith(req, state.config, state.dbs.c6Db);
                    }).done(done);
                });
            });
        });
    });
});
