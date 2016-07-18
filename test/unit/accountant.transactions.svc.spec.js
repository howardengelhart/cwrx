var flush = true;
fdescribe('accountant-transactions (UT)', function() {
    var mockLog, Model, MiddleManager, logger, q, transModule, express, authUtils, uuid,
        JobManager, streamUtils, pgUtils, req, nextSpy, doneSpy, Scope;

    beforeEach(function(){
        jasmine.clock().install();
        //Wed Jan 27 2016 16:22:47 GMT-0500 (EST)
        jasmine.clock().mockDate(new Date(1453929767464)); 
    });
    
    afterEach(function() {
        jasmine.clock().uninstall();
    });

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        express         = require('express');
        uuid            = require('rc-uuid');
        transModule     = require('../../bin/accountant-transactions');
        logger          = require('../../lib/logger');
        Model           = require('../../lib/model');
        MiddleManager   = require('../../lib/middleManager');
        JobManager      = require('../../lib/jobManager');
        authUtils       = require('../../lib/authUtils');
        streamUtils     = require('../../lib/streamUtils');
        pgUtils         = require('../../lib/pgUtils');
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
        
        ['braintreeId', 'promotion', 'campaign', 'paymentPlanId'].forEach(function(field) {
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

        describe('when handling description', function() {
            it('should fail if the field is not a string', function() {
                newObj.description = { foo: 'bar' };
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'description must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                newObj.description = 'foo';
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.description).toEqual('foo');
            });
            
            it('should fail if the field is too long', function() {
                newObj.description = new Array(300).join(',').split(',').map(function() { return 'a'; }).join('');
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'description must have at most 255 characters' });
            });
        });

        describe('when handling targetUsers', function() {
            it('should fail if the field is not a number', function() {
                newObj.targetUsers = { foo: 'bar' };
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'targetUsers must be in format: number' });
            });
            
            it('should allow the field to be set on create', function() {
                newObj.targetUsers = 1234;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.targetUsers).toEqual(1234);
            });
        });

        ['cycleEnd', 'cycleStart'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not a Date', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: Date' });
                });
                
                it('should allow the field to be set on create', function() {
                    newObj[field] = new Date('2016-06-28T18:39:27.191Z');
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(new Date('2016-06-28T18:39:27.191Z'));
                });
                
                it('should parse a string date as a Date object', function() {
                    newObj[field] = '2016-06-28T18:39:27.191Z';
                    expect(model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual(new Date('2016-06-28T18:39:27.191Z'));
                });
            });
        });

        describe('when handling application', function() {
            it('should fail if the field is not a string', function() {
                newObj.application = { foo: 'bar' };
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'application must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                newObj.application = 'foo';
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.application).toEqual('foo');
            });
            
            it('should default the field if unset', function() {
                delete newObj.application;
                expect(model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.application).toEqual('selfie');
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
                description     : 'i paid a lot of money',
                view_target     : 1337,
                cycle_end       : '2012-02-02T20:29:06.754Z',
                cycle_start     : '2011-01-01T20:29:06.754Z',
                paymentplan_id  : 'pp-fake',
                application     : 'screenjackinator'
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
                description     : 'i paid a lot of money',
                targetUsers     : 1337,
                cycleEnd        : new Date('2012-02-02T20:29:06.754Z'),
                cycleStart      : new Date('2011-01-01T20:29:06.754Z'),
                paymentPlanId   : 'pp-fake',
                application     : 'screenjackinator'
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

        it('should allow passing custom values for some fields', function() {
            req.body.description = 'we fucked up this guys campaign';
            req.body.cycleStart = new Date('2013-03-03T19:26:20.967Z');
            req.body.transactionTS = new Date('2016-04-11T19:26:20.967Z');
            
            transModule.setupTransaction(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body).toEqual(jasmine.objectContaining({
                created         : jasmine.any(Date),
                cycleStart      : new Date('2013-03-03T19:26:20.967Z'),
                transactionTS   : new Date('2016-04-11T19:26:20.967Z'),
                description     : 'we fucked up this guys campaign'
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

    fdescribe('latestPayment',function(){
        var pgResp, svc;
        
        beforeEach(function() {
            req.requester.permissions = { transactions: { read: Scope.All } };
            req.query = {
                org : 'o-2'
            };
            pgResp = { rows: [
                {
                    application : 'showcase',
                    transactionId: 't-1', 
                    transactionTs: new Date('2016-07-16T14:35:20Z'),
                    orgId: 'o-2',
                    amount: '49.99',
                    braintreeId: null,
                    promotionId:  'promo1',
                    paymentPlanId : 'plan1',
                    viewTarget : 1000,
                    cycleStart : new Date('2016-07-16T00:00:00Z'),
                    cycleEnd   : new Date('2016-07-31T23:59:59Z')
                }
            ] };
            spyOn(pgUtils, 'query').and.callFake(function() { return q(pgResp); });
            svc = transModule.setupSvc();
            spyOn(svc, 'runAction').and.callFake(function(req, action, cb) { return cb(); });
        });

        it('gets the latest payment',function(done){
            transModule.getCurrentPayment(svc, req)
            .then(function(resp){
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(
                    jasmine.objectContaining({ 
                        transactionId: 't-1', amount: '49.99', braintreeId:  null,
                        paymentPlanId : 'plan1'
                    })
                );
            })
            .then(done,done.fail);
        });
        
        it('should default the query org to the requester\'s org', function(done) {
            transModule.getCurrentPayment(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: jasmine.any(Object) });
                expect(pgUtils.query.calls.argsFor(0)[1]).toEqual(['o-2']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the requester is an app and does not specify an org', function(done) {
            delete req.user;
            delete req.query.org;
            transModule.getCurrentPayment(svc, req).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'Must provide an org id' });
                expect(pgUtils.query).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if unable to locate a record',function(done){
            pgResp = { rows: [ ] };
            transModule.getCurrentPayment(svc, req)
            .then(function(resp){
                expect(resp.code).toBe(404);
                expect(resp.body).toEqual('Unable to locate currentPayment.');
            })
            .then(done,done.fail);
        });
    });

    describe('createTransaction', function() {
        var svc;
        beforeEach(function() {
            req.body = {
                amount: 123.12,
                org: 'o-1',
                braintreeId: 'payment1',
                application: 'minireelinator',
                cycleStart: new Date('2016-06-28T19:53:34.108Z'),
                targetUsers: 1337
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
                    description     : values[10],
                    view_target     : values[11],
                    cycle_end       : values[12],
                    cycle_start     : values[13],
                    paymentplan_id  : values[14],
                    application     : values[15]
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
                        description     : JSON.stringify({ eventType: 'credit', source: 'braintree' }),
                        targetUsers     : 1337,
                        cycleEnd        : undefined,
                        cycleStart      : new Date('2016-06-28T19:53:34.108Z'),
                        paymentPlanId   : undefined,
                        application     : 'minireelinator',
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

    describe('produceCreation(req, result)', function() {
        var req, result;
        var success, failure;
        var produceDeferred;

        beforeEach(function(done) {
            req = {};
            result = {
                code: 201,
                body: {
                    id: 'transaction_id',
                    created: 'rec_ts',
                    transactionTS: 'transaction_ts',
                    amount: 'amount',
                    sign: 'sign',
                    units: 'units',
                    org: 'org_id',
                    campaign: 'campaign_id',
                    braintreeId: 'braintree_id',
                    promotion: 'promotion_id',
                }
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            spyOn(streamUtils, 'produceEvent').and.returnValue((produceDeferred = q.defer()).promise);

            transModule.produceCreation(req, result).then(success, failure);
            process.nextTick(done);
        });

        it('should produce a record', function() {
            expect(streamUtils.produceEvent).toHaveBeenCalledWith('transactionCreated', {
                transaction: result.body
            });
        });

        describe('if producing the event suceeds', function() {
            beforeEach(function(done) {
                produceDeferred.fulfill({ type: 'transactionCreated', data: {} });
                process.nextTick(done);
            });

            it('should fulfill with the result', function() {
                expect(success).toHaveBeenCalledWith(result);
            });
        });

        describe('if producing the event fails', function() {
            var reason;

            beforeEach(function(done) {
                reason = new Error('Something went wrong!');

                produceDeferred.reject(reason);
                process.nextTick(done);
            });

            it('should log an error', function() {
                expect(mockLog.error).toHaveBeenCalled();
            });

            it('should fulfill the promise', function() {
                expect(success).toHaveBeenCalledWith(result);
            });
        });

        describe('if the request failed', function() {
            beforeEach(function(done) {
                success.calls.reset();
                failure.calls.reset();
                streamUtils.produceEvent.calls.reset();
                result.code = 400;

                transModule.produceCreation(req, result).then(success, failure);
                process.nextTick(done);
            });

            it('should not produce a record', function() {
                expect(streamUtils.produceEvent).not.toHaveBeenCalled();
            });

            it('should fulfill with the result', function() {
                expect(success).toHaveBeenCalledWith(result);
            });
        });
    });
    
    describe('setupEndpoints', function() {
        var app, svc, sessions, audit, mockRouter, expressRoutes, authMidware, res, jobManager;
        beforeEach(function() {
            mockRouter = {};
            expressRoutes = {};
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

            jobManager = new JobManager('fakeCache', {});
            spyOn(jobManager.setJobTimeout, 'bind').and.returnValue(jobManager.setJobTimeout);
            spyOn(jobManager, 'endJob').and.returnValue(q());

            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
            
            transModule.setupEndpoints(app, svc, sessions, audit, jobManager);
        });
        
        it('should create a router and attach it to the app', function() {
            expect(express.Router).toHaveBeenCalled();
            expect(mockRouter.use).toHaveBeenCalledWith(jobManager.setJobTimeout);
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
                        expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                            state: 'fulfilled',
                            value: { code: 200, body: [{ id: 'pro-1' }], headers: { 'content-range': 'items 2-3/5' } }
                        });
                        expect(res.send).not.toHaveBeenCalled();
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(transModule.getTransactions).toHaveBeenCalledWith(svc, req);
                    }).done(done);
                });
                
                it('should handle errors from getTransactions', function(done) {
                    transModule.getTransactions.and.returnValue(q.reject('I GOT A PROBLEM'));
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

        describe('creates a handler for POST /api/transactions/ that', function() {
            it('should exist and include necessary middleware', function() {
                expect(mockRouter.post).toHaveBeenCalledWith('/', 'fakeCreateMidware', audit, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    handler = expressRoutes.post['/'][expressRoutes.post['/'].length - 1];
                    spyOn(transModule, 'createTransaction').and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                    spyOn(transModule, 'produceCreation').and.callFake(function(req, result) {
                        return q(result);
                    });
                });
                
                it('should call createTransactions and return the response', function(done) {
                    q(handler(req, res, nextSpy)).finally(function() {
                        process.nextTick(function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                                state: 'fulfilled',
                                value: { code: 400, body: 'i got a problem with YOU' }
                            });
                            expect(res.send).not.toHaveBeenCalled();
                            expect(nextSpy).not.toHaveBeenCalled();
                            expect(transModule.createTransaction).toHaveBeenCalledWith(svc, req);
                            expect(transModule.produceCreation).toHaveBeenCalledWith(req, transModule.createTransaction.calls.mostRecent().returnValue.inspect().value);
                            done();
                        });
                    }).catch(done.fail);
                });
                
                it('should handle errors from createTransactions', function(done) {
                    transModule.createTransaction.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, nextSpy)).finally(function() {
                        process.nextTick(function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, {
                                state: 'rejected',
                                reason: 'I GOT A PROBLEM'
                            });
                            expect(res.send).not.toHaveBeenCalled();
                            expect(nextSpy).not.toHaveBeenCalled();
                            done();
                        });
                    }).catch(done.fail);
                });
            });
        });
    });
});
