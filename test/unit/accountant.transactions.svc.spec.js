var flush = true;
describe('accountant-transactions (UT)', function() {
    var mockLog, Model, MiddleManager, logger, q, transModule, express, expressUtils, journal, authUtils, uuid,
        requestUtils, pgUtils, req, res, nextSpy, doneSpy, Status, Scope;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        express         = require('express');
        transModule     = require('../../bin/accountant-transactions');
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
        
        req = { uuid: '1234', requester: { id: 'u-1' }, user: { id: 'u-1', org: 'o-1' }, query: {} };
        res = {
            header: jasmine.createSpy('res.header()'),
            send: jasmine.createSpy('res.send()')
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
    });
    
    describe('setupSvc', function() {
        var svc;
        beforeEach(function() {
            spyOn(Model.prototype.midWare, 'bind').and.returnValue(Model.prototype.midWare);
            svc = transModule.setupSvc();
        });
        
        it('should return a MiddleManager', function() {
            expect(svc).toEqual(jasmine.any(MiddleManager));
        });
        
        it('should check permissions on read', function() {
            expect(svc._middleware.read).toContain(transModule.checkReadPermissions);
        });
        
        it('should validate and setup the body on create', function() {
            expect(svc._middleware.create).toContain(Model.prototype.midWare);
            expect(svc._middleware.create).toContain(transModule.setupTransaction);

            var transModel = Model.prototype.midWare.bind.calls.mostRecent().args[0];
            expect(transModel).toEqual(jasmine.any(Model));
            expect(transModel.objName).toEqual('transactions');
            expect(transModel.schema).toEqual(transModule.transactionSchema);
        });
    });

    describe('transaction validation', function() {
        var model, newObj, origObj, requester;
        beforeEach(function() {
            model = new Model('transactions', transModule.transactionSchema);
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
        var row;
        beforeEach(function() {
            row = {
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
        });

        it('should return a JSON representation of a row', function() {
            expect(transModule.formatTransOutput(row)).toEqual({
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
        
        it('should handle amounts of 0 or undefined/null', function() {
            row.amount = 0;
            expect(transModule.formatTransOutput(row).amount).toBe(0);
            delete row.amount;
            expect(transModule.formatTransOutput(row).amount).not.toBeDefined();
            row.amount = null;
            expect(transModule.formatTransOutput(row).amount).toBe(null);
        });
    });
    
    describe('parseQueryParams', function() {
        beforeEach(function() {
            req.query = {
                limit: '10',
                skip: '20',
                fields: 'id,created,amount',
                sort: 'amount,-1'
            };
        });
        
        it('should return an object of parsed pagination params', function() {
            expect(transModule.parseQueryParams(req)).toEqual({
                limit: 10,
                skip: 20,
                fields: 'transaction_id,rec_ts,amount',
                sort: 'amount DESC'
            });
        });
        
        ['limit', 'skip'].forEach(function(param) {
            describe('when handling ' + param, function() {
                it('should default the param to 0 if not set or not a number', function() {
                    delete req.query[param];
                    expect(transModule.parseQueryParams(req)[param]).toBe(0);
                    req.query[param] = 'DROP TABLE fct.billing_transactions';
                    expect(transModule.parseQueryParams(req)[param]).toBe(0);
                });

                it('should not allow the param to be negative', function() {
                    req.query[param] = -12;
                    expect(transModule.parseQueryParams(req)[param]).toBe(0);
                });
            });
        });

        describe('when handling sort', function() {
            it('should default to sorting by the transaction_id', function() {
                delete req.query.sort;
                expect(transModule.parseQueryParams(req).sort).toBe('transaction_id ASC');
            });
            
            it('should handle invalid sorts', function() {
                var resps = ['amount', 'amount,foo', ',,,,,', 'DROP TABLE fct.billing_transactions', 'email,1'].map(function(val) {
                    req.query.sort = val;
                    return transModule.parseQueryParams(req);
                });
                expect(resps[0].sort).toBe('amount ASC');
                expect(resps[1].sort).toBe('amount ASC');
                expect(resps[2].sort).toBe('transaction_id ASC');
                expect(resps[3].sort).toBe('transaction_id ASC');
                expect(resps[4].sort).toBe('transaction_id ASC');
            });
        });
        
        describe('when handling fields', function() {
            it('should default to * if not set', function() {
                delete req.query.fields;
                expect(transModule.parseQueryParams(req).fields).toBe('*');
            });

            it('should always include the transaction_id', function() {
                req.query.fields = 'amount,created';
                expect(transModule.parseQueryParams(req).fields).toBe('amount,rec_ts,transaction_id');
            });
            
            it('should only include valid columns', function() {
                req.query.fields = 'units,foo,amount,bar,DROP TABLE fct.billing_transactions';
                expect(transModule.parseQueryParams(req).fields).toBe('units,amount,transaction_id');
            });

            it('should support all valid columns', function() {
                req.query.fields = 'id,created,transactionTS,amount,sign,units,org,campaign,braintreeId,promotion,description';
                expect(transModule.parseQueryParams(req).fields)
                    .toBe('transaction_id,rec_ts,transaction_ts,amount,sign,units,org_id,campaign_id,braintree_id,promotion_id,description');
            });
        });
    });
    
    describe('checkReadPermissions', function() {
        beforeEach(function() {
            req.requester.permissions = { transactions: { read: Scope.All } };
            req.query.org = 'o-2';
        });
        
        it('should call next if the requester can read all transactions', function() {
            transModule.checkReadPermissions(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        describe('if the request cannot read all transactions', function() {
            beforeEach(function() {
                req.requester.permissions.transactions.read = Scope.Org;
            });
            
            it('should call next if query org is the same as the requester\'s org', function() {
                req.query.org = 'o-1';
                transModule.checkReadPermissions(req, nextSpy, doneSpy);
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
            });

            it('should call done if query org is the same as the requester\'s org', function() {
                transModule.checkReadPermissions(req, nextSpy, doneSpy);
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to get transactions for this org' });
            });

            it('should call done if there is no req.user', function() {
                delete req.user;
                transModule.checkReadPermissions(req, nextSpy, doneSpy);
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 403, body: 'Not authorized to get transactions for this org' });
            });
        });
    });

    describe('setupTransaction', function() {
        beforeEach(function() {
            req.body = {
                amount: 123.12,
                sign: 1,
                org: 'o-1',
                braintreeId: 'payment1'
            };
            spyOn(uuid, 'createUuid').and.returnValue('asdfqwerzxcv1234');
        });
        
        it('should set some extra fields on the body', function() {
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual({
                id              : 't-asdfqwerzxcv1234',
                created         : jasmine.any(Date),
                transactionTS   : req.body.created,
                amount          : 123.12,
                sign            : 1,
                org             : 'o-1',
                braintreeId     : 'payment1',
                description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
            });
        });

        it('should return a 400 if the transaction is a credit but not linked to a payment or promotion', function() {
            delete req.body.braintreeId;
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Cannot create unlinked credit' });
        });
        
        it('should allow a transaction to be linked to a promotion', function() {
            delete req.body.braintreeId;
            req.body.promotion = 'pro-1';
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual({
                id              : 't-asdfqwerzxcv1234',
                created         : jasmine.any(Date),
                transactionTS   : req.body.created,
                amount          : 123.12,
                sign            : 1,
                org             : 'o-1',
                promotion       : 'pro-1',
                description     : JSON.stringify({ eventType: 'credit', source: 'promotion' })
            });
        });

        it('should allow passing a custom transactionTS', function() {
            req.body.transactionTS = new Date('2016-04-11T19:26:20.967Z');
            
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual(jasmine.objectContaining({
                created         : jasmine.any(Date),
                transactionTS   : new Date('2016-04-11T19:26:20.967Z'),
            }));
        });
        
        it('should allow passing in a custom description', function() {
            req.body.description = 'we fucked up this guys campaign';
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual(jasmine.objectContaining({
                braintreeId: 'payment1',
                description: 'we fucked up this guys campaign'
            }));
        });
    });

    describe('getTransactions', function() {
        var pgResp, svc;
        beforeEach(function() {
            req.requester.permissions = { transactions: { read: Scope.All } };
            req.query = {
                org: 'o-2',
                fields: 'amount,braintreeId,promotion',
                limit: 2,
                skip: 1,
                sort: 'amount,-1'
            };
            pgResp = { rows: [
                { transaction_id: 't-1', amount: '202.2', braintree_id: 'pay1', fullcount: 5 },
                { transaction_id: 't-2', amount: '101.1', promotion_id: 'pro-1', fullcount: 5 }
            ] };
            spyOn(transModule, 'parseQueryParams').and.callThrough();
            spyOn(pgUtils, 'query').and.callFake(function() { return q(pgResp); });
            svc = transModule.setupSvc();
            spyOn(svc, 'runAction').and.callFake(function(req, action, cb) { return cb(); });
        });
        
        it('should query for transactions', function(done) {
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([
                    jasmine.objectContaining({ id: 't-1', amount: 202.2, braintreeId: 'pay1' }),
                    jasmine.objectContaining({ id: 't-2', amount: 101.1, promotion: 'pro-1' })
                ]);
                expect(resp.headers).toEqual({
                    'content-range': 'items 2-3/5'
                });
                expect(svc.runAction).toHaveBeenCalledWith(req, 'read', jasmine.any(Function));
                expect(transModule.parseQueryParams).toHaveBeenCalledWith(req);
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/SELECT amount,braintree_id,promotion_id,transaction_id,count\(\*\) OVER\(\) as fullcount/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/from fct.billing_transactions/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/WHERE org_id = \$1 AND sign = 1/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/ORDER BY amount DESC/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/LIMIT 2/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/OFFSET 1/);
                expect(pgUtils.query.calls.argsFor(0)[1]).toEqual(['o-2']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should default the query org to the requester\'s org', function(done) {
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: jasmine.any(Array), headers: jasmine.any(Object) });
                expect(pgUtils.query.calls.argsFor(0)[1]).toEqual(['o-2']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the requester is an app and does not specify an org', function(done) {
            delete req.user;
            delete req.query.org;
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should have defaults for pagination query params', function(done) {
            req.query = {};
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: jasmine.any(Array), headers: jasmine.any(Object) });
                expect(resp.headers['content-range']).toBe('items 1-5/5');
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/ORDER BY transaction_id ASC/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/LIMIT ALL/);
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/OFFSET 0/);
                expect(pgUtils.query.calls.argsFor(0)[1]).toEqual(['o-1']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip querying postgres if svc.runAction returns early', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'NO WAY BUDDY' }));
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'NO WAY BUDDY' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle postgres returning no rows', function(done) {
            pgResp = { rows: [] };
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).toEqual({
                    code: 200,
                    body: [],
                    headers: { 'content-range': 'items 0-0/0' }
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if postgres returns an error', function(done) {
            pgResp = q.reject('I GOT A PROBLEM');
            transModule.getTransactions(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });

    describe('createTransaction', function() {
        var svc;
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
            svc = transModule.setupSvc();
            spyOn(svc, 'runAction').and.callThrough();
        });
    
        it('should insert the transaction an return a JSON representation', function(done) {
            transModule.createTransaction(svc, req).then(function(resp) {
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
                expect(svc.runAction).toHaveBeenCalledWith(req, 'create', jasmine.any(Function));
                expect(pgUtils.query).toHaveBeenCalledWith(jasmine.any(String), jasmine.any(Array));
                expect(pgUtils.query.calls.argsFor(0)[0]).toMatch(/INSERT INTO fct.billing_transactions/);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip querying postgres if svc.runAction returns early', function(done) {
            svc.runAction.and.returnValue(q({ code: 400, body: 'NO WAY BUDDY' }));
            transModule.createTransaction(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'NO WAY BUDDY' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the query fails', function(done) {
            pgUtils.query.and.returnValue(q.reject('I GOT A PROBLEM'));
            transModule.createTransaction(svc, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('setupEndpoints', function() {
        var app, svc, sessions, audit, mockRouter, expressRoutes, authMidware, res;
        beforeEach(function() {
            mockRouter = {}, expressRoutes = {};
            ['get', 'post'].forEach(function(verb) {
                expressRoutes[verb] = {};
                mockRouter[verb] = jasmine.createSpy('router.' + verb).and.callFake(function(route/*, middleware...*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes[verb][route] = (expressRoutes[verb][route] || []).concat(middleware);
                });
            });
            mockRouter.use = jasmine.createSpy('router.use()');
            spyOn(express, 'Router').and.returnValue(mockRouter);
            
            var authMidware = {
                read: 'fakeReadMidware',
                create: 'fakeCreateMidware'
            };
            spyOn(authUtils, 'crudMidware').and.returnValue(authMidware);

            app = { use: jasmine.createSpy('app.use()') };
            svc = transModule.setupSvc();
            sessions = 'sessionsMidware';
            audit = 'auditMidware';

            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
            
            transModule.setupEndpoints(app, svc, sessions, audit);
        });
        
        it('should create a router and attach it to the app', function() {
            expect(express.Router).toHaveBeenCalled();
            expect(app.use).toHaveBeenCalledWith('/api/transactions?', mockRouter);
        });

        it('should call authUtils.crudMidware to get a set of auth middleware', function() {
            expect(authUtils.crudMidware).toHaveBeenCalledWith('transactions', { allowApps: true });
        });

        describe('creates a handler for GET /api/transactions/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.get).toHaveBeenCalledWith('/', 'sessionsMidware', 'fakeReadMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.get['/'][expressRoutes.get['/'].length - 1];
                    spyOn(transModule, 'getTransactions').and.returnValue(q({
                        code: 200,
                        body: [{ id: 'pro-1' }],
                        headers: { 'content-range': 'items 2-3/5' }
                    }));
                });
                
                it('should call getTransactions and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, [{ id: 'pro-1' }]);
                        expect(res.header).toHaveBeenCalledWith('content-range', 'items 2-3/5');
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(transModule.getTransactions).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from getTransactions', function(done) {
                    transModule.getTransactions.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error fetching transactions', detail: 'I GOT A PROBLEM' });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });

        describe('creates a handler for POST /api/transactions/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.post).toHaveBeenCalledWith('/', 'fakeCreateMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/'][expressRoutes.post['/'].length - 1];
                    spyOn(transModule, 'createTransaction').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call createTransactions and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(transModule.createTransaction).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from createTransactions', function(done) {
                    transModule.createTransaction.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                    expect(res.send).toHaveBeenCalledWith(500, { error: 'Error creating transaction', detail: 'I GOT A PROBLEM' });
                        expect(nextSpy).not.toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});
