var flush = true;
describe('ads-customers (UT)', function() {
    var mockLog, CrudSvc, logger, q, adtech, custModule, mockClient, nextSpy, doneSpy, errorSpy, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        custModule      = require('../../bin/ads-customers');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/Model');

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

        req = { uuid: '1234' };
        
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(objName) {
                return { collectionName: objName };
            })
        };
    });

    describe('setupSvc', function() {
        it('should setup the customer service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').and.returnValue(CrudSvc.prototype.preventGetAll);
            spyOn(custModule.createAdtechCust, 'bind').and.returnValue(custModule.createAdtechCust);
            spyOn(custModule.editAdtechCust, 'bind').and.returnValue(custModule.editAdtechCust);
            var mockDb = {
                collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                    return { collectionName: name };
                })
            };
            var svc = custModule.setupSvc(mockDb);
            
            expect(custModule.createAdtechCust.bind).toHaveBeenCalledWith(custModule, svc);
            expect(custModule.editAdtechCust.bind).toHaveBeenCalledWith(custModule, svc);

            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('cu');
            expect(svc.objName).toBe('customers');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toEqual({ collectionName: 'customers' });
            expect(svc._advertColl).toEqual({ collectionName: 'advertisers' });
            
            expect(svc.createValidator._required).toContain('name');
            expect(svc.createValidator._forbidden).toContain('adtechId');
            expect(svc.createValidator._formats.advertisers).toEqual(['string']);
            expect(svc.editValidator._formats.advertisers).toEqual(['string']);
            
            expect(svc._middleware.read).toEqual([svc.preventGetAll]);
            expect(svc._middleware.create).toEqual([jasmine.any(Function), jasmine.any(Function),
                custModule.createAdtechCust]);
            expect(svc._middleware.edit).toEqual([jasmine.any(Function), jasmine.any(Function),
                custModule.editAdtechCust]);
            expect(svc._middleware.delete).toEqual([jasmine.any(Function), custModule.deleteAdtechCust]);
        });
    });

    describe('getAdvertAdtechIds', function() {
        var svc, mockCursor, advertisers;
        beforeEach(function() {
            advertisers = [ {id: 'a-1', adtechId: 12}, {id: 'a-2', adtechId: 23} ];
            mockCursor = { toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function(cb) {
                cb(null, advertisers);
            }) };
            svc = { _advertColl: { find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor) } };
        });
        
        it('should get a list of advertiser adtech ids', function(done) {
            custModule.getAdvertAdtechIds(svc, ['a-1', 'a-2']).then(function(ids) {
                expect(ids).toEqual([12, 23]);
                expect(svc._advertColl.find).toHaveBeenCalledWith(
                    {id: {$in: ['a-1', 'a-2']}, status: {$ne: 'deleted'}}, {id: 1, adtechId: 1});
                expect(mockCursor.toArray).toHaveBeenCalledWith(jasmine.any(Function));
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if mongo doesn\'t find all the advertisers', function(done) {
            advertisers.shift();
            custModule.getAdvertAdtechIds(svc, ['a-1', 'a-2']).then(function(ids) {
                expect(ids).toEqual([23]);
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log an error if mongo fails', function(done) {
            mockCursor.toArray.and.callFake(function(cb) { cb('I GOT A PROBLEM'); });
            custModule.getAdvertAdtechIds(svc, ['a-1', 'a-2']).then(function(ids) {
                expect(ids).not.toBeDefiend();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockCursor.toArray).toHaveBeenCalledWith(jasmine.any(Function));
            }).done(done);
        });
    });

    describe('decorateCustomers', function() {
        var svc, mockCursor, advertisers, custs, adtechCusts;
        beforeEach(function() {
            custs = [{id: 'cu-1'}, {id: 'cu-2'}, {id: 'cu-3'}];
            adtechCusts = [
                {id: 11, extId: 'cu-1', advertiser: [21]},
                {id: 12, extId: 'cu-2', advertiser: []},
                {id: 13, extId: 'cu-3', advertiser: [21, 22]}
            ];
            advertisers = [ {id: 'a-1', adtechId: 21}, {id: 'a-2', adtechId: 22} ];
            mockCursor = { toArray: jasmine.createSpy('cursor.toArray()').and.callFake(function(cb) {
                cb(null, advertisers);
            }) };
            svc = { _advertColl: { find: jasmine.createSpy('coll.find()').and.returnValue(mockCursor) } };
        });
        
        it('should get a list of advertiser C6 ids', function(done) {
            custModule.decorateCustomers('1234', svc, custs, adtechCusts).then(function() {
                expect(custs).toEqual([
                    { id: 'cu-1', advertisers: ['a-1'] },
                    { id: 'cu-2', advertisers: [] },
                    { id: 'cu-3', advertisers: ['a-1', 'a-2'] }
                ]);
                expect(svc._advertColl.find).toHaveBeenCalledWith(
                    {adtechId: {$in: [21, 22]}, status: {$ne: 'deleted'}}, {id: 1, adtechId: 1});
                expect(mockCursor.toArray).toHaveBeenCalledWith(jasmine.any(Function));
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if adtechCusts is empty or undefined', function(done) {
            var custs2 = JSON.parse(JSON.stringify(custs));
            q.all([
                custModule.decorateCustomers('1234', svc, custs, []),
                custModule.decorateCustomers('1234', svc, custs2, undefined)
            ]).then(function() {
                expect(custs).toEqual([
                    { id: 'cu-1', advertisers: [] },
                    { id: 'cu-2', advertisers: [] },
                    { id: 'cu-3', advertisers: [] }
                ]);
                expect(custs2).toEqual(custs);
                expect(svc._advertColl.find).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should ignore any extra adtech customers', function(done) {
            custs.pop();
            custModule.decorateCustomers('1234', svc, custs, adtechCusts).then(function() {
                expect(custs).toEqual([
                    { id: 'cu-1', advertisers: ['a-1'] },
                    { id: 'cu-2', advertisers: [] }
                ]);
                expect(svc._advertColl.find).toHaveBeenCalledWith(
                    {adtechId: {$in: [21]}, status: {$ne: 'deleted'}}, {id: 1, adtechId: 1});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if no adtech cust is found for a given customer', function(done) {
            adtechCusts.pop();
            custModule.decorateCustomers('1234', svc, custs, adtechCusts).then(function() {
                expect(custs).toEqual([
                    { id: 'cu-1', advertisers: ['a-1'] },
                    { id: 'cu-2', advertisers: [] },
                    { id: 'cu-3', advertisers: [] }
                ]);
                expect(svc._advertColl.find).toHaveBeenCalledWith(
                    {adtechId: {$in: [21]}, status: {$ne: 'deleted'}}, {id: 1, adtechId: 1});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if an advertiser is not found in mongo', function(done) {
            advertisers.shift();
            custModule.decorateCustomers('1234', svc, custs, adtechCusts).then(function() {
                expect(custs).toEqual([
                    { id: 'cu-1', advertisers: [] },
                    { id: 'cu-2', advertisers: [] },
                    { id: 'cu-3', advertisers: ['a-2'] }
                ]);
                expect(mockLog.warn.calls.count()).toBe(1);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log an error if mongo fails', function(done) {
            mockCursor.toArray.and.callFake(function(cb) { cb('I GOT A PROBLEM'); });
            custModule.decorateCustomers('1234', svc, custs, adtechCusts).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockCursor.toArray).toHaveBeenCalledWith(jasmine.any(Function));
            }).done(done);
        });
    });
    
    describe('getAdvertLists', function() {
        var resp, callCount;
        beforeEach(function() {
            callCount = 0;
            resp = { code: 200, body: { id: 'cu-1', adtechId: 123, name: 'testy' } };
            adtech.customerAdmin.getCustomerList.and.returnValue(q([{id: 123}, {id: 234}]));
            spyOn(custModule, 'decorateCustomers').and.callFake(function(reqId, svc, custs) {
                custs.forEach(function(cust) { cust.advertisers = ['a-' + callCount++]; });
                return q();
            });
        });
        
        it('should attach a customer\'s advertiser list to the resp', function(done) {
            custModule.getAdvertLists('mockService', req, resp).then(function(resp) {
                expect(resp).toEqual({code: 200, body: { id: 'cu-1', adtechId: 123, name: 'testy',
                                                         advertisers: ['a-0'] } });
                expect(adtech.customerAdmin.getCustomerList).toHaveBeenCalledWith(null, null, jasmine.any(adtech.AOVE));
                var aove = adtech.customerAdmin.getCustomerList.calls.all()[0].args[2];
                expect(aove.expressions).toEqual([
                    jasmine.objectContaining({attr: 'archiveStatus', val: 0, op: '==', type: 'xsd:int'}),
                    jasmine.objectContaining({attr: 'extId', val: ['cu-1'], op: 'IN', type: 'string'})
                ]);
                expect(aove.expressions[1] instanceof adtech.AOVE.StringListExpression).toBeTruthy();
                expect(custModule.decorateCustomers).toHaveBeenCalledWith('1234', 'mockService', [resp.body], [{id: 123}, {id: 234}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a list of customers in the body', function(done) {
            resp.body = [
                { id: 'cu-1', adtechId: 123, name: 'testy' },
                { id: 'cu-2', adtechId: 456, name: 'pesty' }
            ];
            custModule.getAdvertLists('mockService', req, resp).then(function(resp) {
                expect(resp).toEqual({code: 200, body: [
                    { id: 'cu-1', adtechId: 123, name: 'testy', advertisers: ['a-0'] },
                    { id: 'cu-2', adtechId: 456, name: 'pesty', advertisers: ['a-1'] }
                ]});
                expect(adtech.customerAdmin.getCustomerList).toHaveBeenCalledWith(null, null, jasmine.any(adtech.AOVE));
                var aove = adtech.customerAdmin.getCustomerList.calls.all()[0].args[2];
                expect(aove.expressions).toEqual([
                    jasmine.objectContaining({attr: 'archiveStatus', val: 0, op: '==', type: 'xsd:int'}),
                    jasmine.objectContaining({attr: 'extId', val: ['cu-1', 'cu-2'], op: 'IN', type: 'string'})
                ]);
                expect(custModule.decorateCustomers).toHaveBeenCalledWith('1234', 'mockService', resp.body, [{id: 123}, {id: 234}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not do anything if the response code is not 2xx', function(done) {
            var codes = [100, 300, 400, 500];
            q.all(codes.map(function(code) {
                var response = { code: code, body: resp.body };
                return custModule.getAdvertLists('mockService', req, response).then(function(result) {
                    expect(result.code).toBe(code);
                    expect(result.body.advertisers).not.toBeDefined();
                });
            })).then(function(results) {
                expect(adtech.customerAdmin.getCustomerList).not.toHaveBeenCalled();
                expect(custModule.decorateCustomers).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.customerAdmin.getCustomerList.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.getAdvertLists('mockService', req, resp).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(custModule.decorateCustomers).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if decorateCustomers fails', function(done) {
            custModule.decorateCustomers.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.getAdvertLists('mockService', req, resp).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
            }).done(done);
        });
    });
    
    describe('formatAdtechCust', function() {
        it('should create a new record when there is no original', function() {
            var record = custModule.formatAdtechCust({id: 'cu-1', name: 'testy'});
            expect(record).toEqual({ advertiser: undefined, companyData: { address: {}, url: 'http://cinema6.com' },
                                     extId: 'cu-1', name: 'testy' });
        });
        
        it('should format the advertisers correctly if defined', function() {
            var record = custModule.formatAdtechCust({id: 'cu-1', name: 'testy'}, null, ['12', '23']);
            expect(record).toEqual({
                advertiser: { Items: {
                    attributes: { 'xmlns:cm' : 'http://systinet.com/wsdl/de/adtech/helios/CustomerManagement/' },
                    Item: [
                        { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 12 },
                        { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 23 }
                    ]
                } },
                companyData: { address: {}, url: 'http://cinema6.com' },
                extId: 'cu-1',
                name: 'testy'
            });
        });
        
        it('should modify the original record, if there is one', function() {
            var now = new Date();
            var orig = {
                archiveDate: now,
                assignedUsers: ['1234', '4567'],
                apples: null,
                advertiser: ['12', '23'],
                companyData: { address: {}, url: 'http://cinema6.com' },
                contacts: [{email: 'test@foo.com', firstName: 'Johnny', lastName: 'Testmonkey'}],
                extId: 'cu-1',
                id: 123,
                name: 'old name'
            };
            var record = custModule.formatAdtechCust({id: 'cu-1', name: 'testy'}, orig);
            expect(record).toEqual({
                archiveDate: now.toISOString(),
                assignedUsers: { Items: {
                    attributes: { 'xmlns:cm' : 'http://www.w3.org/2001/XMLSchema' },
                    Item: [
                        { attributes: { 'xsi:type': 'cm:long' }, $value: '1234' },
                        { attributes: { 'xsi:type': 'cm:long' }, $value: '4567' },
                    ]
                } },
                advertiser: { Items: {
                    attributes: { 'xmlns:cm' : 'http://systinet.com/wsdl/de/adtech/helios/CustomerManagement/' },
                    Item: [
                        { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 12 },
                        { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 23 }
                    ]
                } },
                companyData: { address: {}, url: 'http://cinema6.com' },
                contacts: { Items: {
                    attributes: { 'xmlns:cm' : 'http://systinet.com/wsdl/de/adtech/helios/UserManagement/' },
                    Item: [{
                        attributes: { 'xsi:type': 'cm:ContactData' },
                        email: 'test@foo.com',
                        firstName: 'Johnny',
                        lastName: 'Testmonkey'
                    }]
                } },
                extId: 'cu-1',
                id: 123,
                name: 'testy'
            });
        });

        it('should not set list properties if not defined on the original', function() {
            var orig = { companyData: {address: {}, url: 'http://cinema6.com'},
                         extId: 'cu-1', id: 123, name: 'old name' };
            
            expect(custModule.formatAdtechCust({name: 'testy'}, orig)).toEqual({
                companyData: {address: {}, url: 'http://cinema6.com'},
                extId: 'cu-1', id: 123, name: 'testy',
                assignedUsers: undefined, contacts: undefined, advertiser: undefined
            });
        });
    });
    
    describe('createAdtechCust', function() {
        beforeEach(function() {
            req.body = { id: 'cu-1', name: 'testy' };
            adtech.customerAdmin.createCustomer.and.returnValue(q({id: 123}));
            spyOn(custModule, 'getAdvertAdtechIds').and.callFake(function(svc, ids) {
                if (!ids) return q(ids);
                else return q([12, 23]);
            });
        });
        
        it('should create a new customer in adtech', function(done) {
            custModule.createAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.adtechId).toBe(123);
                expect(custModule.getAdvertAdtechIds).toHaveBeenCalledWith('mockService', undefined);
                expect(adtech.customerAdmin.createCustomer).toHaveBeenCalledWith({
                    advertiser: undefined, companyData: {address: {}, url: 'http://cinema6.com'}, extId: 'cu-1', name: 'testy'});
                done();
            });
        });
        
        it('should set the advertisers and trim the field off the body', function(done) {
            req.body.advertisers = ['a-1', 'a-2'];
            custModule.createAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.adtechId).toBe(123);
                expect(req.body.advertisers).not.toBeDefined();
                expect(custModule.getAdvertAdtechIds).toHaveBeenCalledWith('mockService', ['a-1', 'a-2']);
                expect(adtech.customerAdmin.createCustomer).toHaveBeenCalledWith({
                    advertiser: { Items: {
                        attributes: { 'xmlns:cm' : 'http://systinet.com/wsdl/de/adtech/helios/CustomerManagement/' },
                        Item: [
                            { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 12 },
                            { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 23 }
                        ]
                    } },
                    companyData: {address: {}, url: 'http://cinema6.com'}, extId: 'cu-1', name: 'testy'});
                done();
            });
        });
        
        it('should reject if mongo fails', function(done) {
            custModule.getAdvertAdtechIds.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.createAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.customerAdmin.createCustomer).not.toHaveBeenCalled();
                expect(req.body.adtechId).not.toBeDefined();
                done();
            });
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.customerAdmin.createCustomer.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.createAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(req.body.adtechId).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('editAdtechCust', function() {
        beforeEach(function() {
            req.body = { id: 'cu-1', name: 'testy' };
            req.origObj = { id: 'cu-1', name: 'old name', adtechId: 123 };
            adtech.customerAdmin.getCustomerById.and.returnValue(q({name: 'old name', id: 123}));
            adtech.customerAdmin.updateCustomer.and.returnValue(q({id: 123, updated: true}));
            spyOn(custModule, 'getAdvertAdtechIds').and.callFake(function(svc, ids) {
                if (!ids) return q(ids);
                else return q([12, 23]);
            });
        });
        
        it('should edit a customer in adtech', function(done) {
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getCustomerById).toHaveBeenCalledWith(123);
                expect(custModule.getAdvertAdtechIds).toHaveBeenCalledWith('mockService', undefined);
                expect(adtech.customerAdmin.updateCustomer).toHaveBeenCalledWith({name: 'testy', id: 123, assignedUsers: undefined, contacts: undefined, advertiser: undefined});
                done();
            });
        });
        
        it('should be able to update the advertiser list', function(done) {
            req.body = { id: 'cu-1', advertisers: ['a-1', 'a-2'] };
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getCustomerById).toHaveBeenCalledWith(123);
                expect(custModule.getAdvertAdtechIds).toHaveBeenCalledWith('mockService', ['a-1', 'a-2']);
                expect(adtech.customerAdmin.updateCustomer).toHaveBeenCalledWith({
                    advertiser: { Items: {
                        attributes: { 'xmlns:cm': 'http://systinet.com/wsdl/de/adtech/helios/CustomerManagement/' },
                        Item: [
                            { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 12 },
                            { attributes: { 'xsi:type': 'cm:Advertiser' }, id: 23 },
                        ]
                    } },
                    name: 'old name', id: 123,
                    assignedUsers: undefined, contacts: undefined
                });
                expect(req.body.advertisers).not.toBeDefined();
                done();
            });
        });
        
        it('should do nothing if the name and advertisers are not defined in the request', function(done) {
            req.body = { id: 'cu-1', foo: 'bar' };
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getCustomerById).not.toHaveBeenCalled();
                expect(custModule.getAdvertAdtechIds).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.updateCustomer).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should do nothing if the name and advertisers are unchanged', function(done) {
            req.body = { id: 'cu-1', name: 'old name' };
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.getCustomerById).not.toHaveBeenCalled();
                expect(custModule.getAdvertAdtechIds).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.updateCustomer).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if finding the existing customer fails', function(done) {
            adtech.customerAdmin.getCustomerById.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(adtech.customerAdmin.getCustomerById).toHaveBeenCalled();
                expect(custModule.getAdvertAdtechIds).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.updateCustomer).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if mongo fails', function(done) {
            custModule.getAdvertAdtechIds.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                expect(adtech.customerAdmin.updateCustomer).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if updating the customer fails', function(done) {
            adtech.customerAdmin.updateCustomer.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.editAdtechCust('mockService', req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                done();
            });
        });
    });
    
    describe('deleteAdtechCust', function() {
        beforeEach(function() {
            req.origObj = { id: 'cu-1', name: 'testy', adtechId: 123 };
            adtech.customerAdmin.deleteCustomer.and.returnValue(q());
        });
        
        it('should delete an advertiser in adtech', function(done) {
            custModule.deleteAdtechCust(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(adtech.customerAdmin.deleteCustomer).toHaveBeenCalledWith(123);
                done();
            });
        });
        
        it('should log a warning if the original object has no adtechId', function(done) {
            delete req.origObj.adtechId;
            custModule.deleteAdtechCust(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(adtech.customerAdmin.deleteCustomer).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if adtech fails', function(done) {
            adtech.customerAdmin.deleteCustomer.and.returnValue(q.reject('I GOT A PROBLEM'));
            custModule.deleteAdtechCust(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Adtech failure'));
                done();
            });
        });
    });
});

