var q               = require('q'),
    adtech          = require('adtech'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    adtechErr       = testUtils.handleAdtechError,
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };
    
jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('ads customers endpoints (E2E):', function() {
    var cookieJar, mockUser, createdCust, createdAdverts, keptCust, keptAdvert;

    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'custe2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                advertisers: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                customers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'custe2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUser).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) { done(); });
    });
    
    beforeEach(function(done) {
        if (adtech.customerAdmin) {
            return done();
        }
        adtech.createCustomerAdmin().catch(adtechErr).done(function(resp) { done(); });
    });

    beforeEach(function(done) {
        if (keptCust && keptAdvert) {
            return done();
        } else {
            q.all([
                adtech.customerAdmin.getCustomerByExtId('e2e-cu-keepme'),
                adtech.customerAdmin.getAdvertiserByExtId('e2e-a-keepme')
            ]).spread(function(customer, advertiser) {
                keptCust = { id: 'e2e-cu-keepme', status: 'active', name: customer.name, adtechId: customer.id };
                keptAdvert = { id: 'e2e-a-keepme', status: 'active', name: advertiser.name, adtechId: advertiser.id };
            }).catch(adtechErr).done(done);
        }
    });
    
    describe('setting up advertisers', function() {
        it('should use the API to create some advertisers', function(done) {
            q.all([{name: 'e2e advert 1'}, {name: 'e2e advert 2'}, {name: 'e2e advert 3'}].map(function(body) {
                var options = { url: config.adsUrl + '/account/advertiser', json: body, jar: cookieJar };
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                createdAdverts = results.map(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    return resp.body;
                });
                return testUtils.resetCollection('advertisers', createdAdverts.concat(keptAdvert));
            }).done(done);
        });
    });

    describe('GET /api/account/customer/:id', function() {
        beforeEach(function(done) {
            var mockCusts = [
                keptCust,
                { id: 'e2e-getid1', name: 'cust 1', status: 'active' },
                { id: 'e2e-getid2', name: 'cust 2', status: 'deleted' },
            ];
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should get a customer by id', function(done) {
            var options = {url: config.adsUrl + '/account/customer/e2e-cu-keepme', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-cu-keepme', name: keptCust.name, adtechId: keptCust.adtechId,
                                           status: 'active', advertisers: ['e2e-a-keepme']});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/account/customer/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/customer/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted customers', function(done) {
            var options = {url: config.adsUrl + '/account/customer/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/account/customer/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/account/customer/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/customers', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/account/customers', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockCusts = [
                keptCust,
                { id: 'e2e-getquery1', name: 'cust 1', adtechId: 123, status: 'active' },
                { id: 'e2e-getquery2', name: 'cust 2', adtechId: 456, status: 'inactive' },
                { id: 'e2e-getgone', name: 'cust deleted', adtechId: 666, status: 'deleted' }
            ];
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should get all customers', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-cu-keepme');
                expect(resp.body[1].id).toBe('e2e-getquery1');
                expect(resp.body[2].id).toBe('e2e-getquery2');
                resp.body.forEach(function(cust) {
                    expect(cust.advertisers).not.toBeDefined();
                });
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/customers',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get customers by name', function(done) {
            options.qs.name = 'cust 2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get customers by adtechId', function(done) {
            options.qs.adtechId = '123';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.name = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'name,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-cu-keepme');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.body[1].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 2-3/3');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/customer', function() {
        var mockCust, options;
        beforeEach(function() {
            mockCust = { name: 'e2e_test-' + new Date().toISOString(),
                         advertisers: [createdAdverts[0].id, createdAdverts[1].id] };
            options = {
                url: config.adsUrl + '/account/customer',
                jar: cookieJar,
                json: mockCust
            };
        });

        it('should be able to create a customer', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(mockCust.name);
                expect(resp.body.adtechId).toEqual(jasmine.any(Number));
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                expect(resp.body.advertisers.sort()).toEqual([createdAdverts[0].id, createdAdverts[1].id].sort());
                
                createdCust = resp.body;
                return adtech.customerAdmin.getCustomerById(createdCust.adtechId).catch(adtechErr);
            }).then(function(cust)  {
                expect(cust.name).toBe(createdCust.name);
                expect(cust.extId).toBe(createdCust.id);
                expect(cust.companyData.url).toBe('http://cinema6.com');
                expect(cust.advertiser.sort()).toEqual(
                    [String(createdAdverts[0].adtechId), String(createdAdverts[1].adtechId)].sort());
                
                // check that it wrote an entry to the audit collection
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/customer', params: {}, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            q.all([{foo: 'bar'}, {name: 'test cust', adtechId: 1234}].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

    });

    describe('PUT /api/account/customer/:id', function() {
        var mockCusts, now, options;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            mockCusts = [
                { id: 'e2e-put1', status: 'active', name: 'fake cust', foo: 'bar' },
                { id: 'e2e-deleted', status: 'deleted', adtechId: 1234, name: 'deleted cust' },
                keptCust,
                createdCust
            ];
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should successfully update a customer in mongo and adtech', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/' + createdCust.id,
                json: { name: 'e2e_test_updated' },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(createdCust);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe(createdCust.id);
                expect(resp.body.adtechId).toBe(createdCust.adtechId);
                expect(resp.body.name).toBe('e2e_test_updated');
                expect(resp.body.created).toBe(createdCust.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdCust.lastUpdated));
                expect(resp.body.advertisers.sort()).toEqual([createdAdverts[0].id, createdAdverts[1].id].sort());
                
                return adtech.customerAdmin.getCustomerById(createdCust.adtechId).catch(adtechErr);
            }).then(function(cust) {
                expect(cust.name).toBe('e2e_test_updated');
                expect(cust.extId).toBe(createdCust.id);
                expect(cust.advertiser.sort()).toEqual(
                    [String(createdAdverts[0].adtechId), String(createdAdverts[1].adtechId)].sort());
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/e2e-put1',
                json: { name: 'fake cust', foo: 'baz' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.foo).toBe('baz');
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/account/customer/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to update the advertiser list', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/' + createdCust.id,
                json: { advertisers: [createdAdverts[1].id, createdAdverts[2].id] },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(createdCust);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.advertisers.sort()).toEqual([createdAdverts[1].id, createdAdverts[2].id].sort());
                
                return adtech.customerAdmin.getCustomerById(createdCust.adtechId).catch(adtechErr);
            }).then(function(cust) {
                expect(cust.extId).toBe(createdCust.id);
                expect(cust.advertiser.sort()).toEqual(
                    [String(createdAdverts[1].adtechId), String(createdAdverts[2].adtechId)].sort());
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should preserve other existing adtech fields', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/e2e-cu-keepme',
                json: { name: 'e2e_cu_KEEP_ME_' + new Date().toISOString() },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe(options.json.name);
                return adtech.customerAdmin.getCustomerById(keptCust.adtechId).catch(adtechErr);
            }).then(function(cust) {
                expect(cust.name).toBe(options.json.name);
                expect(cust.extId).toBe('e2e-cu-keepme');
                expect(cust.companyData).toEqual({ address: { address1: '1 Bananas Road', address2: 'Apt 123',
                    city: 'Bananaville', country: 'USA', zip: '12345' }, firmName: '', fax: '1234567890',
                    id: 1260826, mail: '', phone: '9876543210', url: 'http://bananas.com' });
                expect(cust.contacts).toEqual([{email: 'jimtest@bananas.com', fax: '',
                    firstName: 'Jimmy', lastName: 'Testmonkey', id: 902910, mobile: '', phone: '1234567890'}]);
                expect(cust.advertiser).toEqual([String(keptAdvert.adtechId)]);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a customer that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/e2e-deleted',
                json: { name: 'resurrected' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a customer if they do not exist', function(done) {
            options = {
                url: config.adsUrl + '/account/customer/e2e-putfake',
                json: { name: 'the best thing' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/customer/:id', function() {
        beforeEach(function(done) {
            var mockCusts = [
                { id: 'e2e-del1', status: 'deleted', adtechId: 1234 },
                { id: 'e2e-del2', status: 'active' },
                createdCust
            ];
            testUtils.resetCollection('customers', mockCusts).done(done);
        });

        it('should delete a customer from adtech and set its status to deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/customer/' + createdCust.id};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/account/customer/' + createdCust.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                
                return adtech.customerAdmin.getCustomerById(createdCust.adtechId).catch(adtechErr);
                .then(function(cust) {
                    expect(cust).not.toBeDefined();
                }).catch(function(err) {
                    expect(err).toEqual(new Error('Unable to locate object: ' + createdCust.adtechId));
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should handle customers that have no adtechId', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/customer/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
                // Check that it's writing to the audit collection
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/customer/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/account/customer/e2e-del2' + createdCust.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the customer has been deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/customer/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the customer does not exist', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/customer/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/account/customer/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
    
    
    describe('cleaning up advertisers', function() {
        it('should use the API to delete some advertisers', function(done) {
            q.all(createdAdverts.map(function(body) {
                var options = { url: config.adsUrl + '/account/advertiser/' + body.id, jar: cookieJar };
                return requestUtils.qRequest('delete', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(204);
                });
            }).done(done);
        });
    });
});

describe('closeDbs', function() {
    it('should close db connections', function() {
        testUtils.closeDbs();
    });
});
