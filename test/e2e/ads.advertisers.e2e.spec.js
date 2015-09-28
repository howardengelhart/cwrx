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

describe('ads advertisers endpoints (E2E):', function() {
    var cookieJar, mockUser, createdAdvert;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 90000;

        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'adverte2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                advertisers: {
                    read: 'all',
                    create: 'all',
                    edit: 'all',
                    delete: 'all'
                }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'adverte2euser',
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

    describe('GET /api/account/advertiser/:id', function() {
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-getid1', name: 'advert 1', adtechId: 123, status: 'active' },
                { id: 'e2e-getid2', name: 'advert 2', adtechId: 456, status: 'deleted' }
            ];
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should get an advertiser by id', function(done) {
            var options = {url: config.adsUrl + '/account/advertiser/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-getid1', name: 'advert 1', adtechId: 123, status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/account/advertiser/e2e-getid1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/account/advertiser/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted advertisers', function(done) {
            var options = {url: config.adsUrl + '/account/advertiser/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/account/advertiser/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/account/advertiser/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/advertisers', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/account/advertisers', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockAdverts = [
                { id: 'e2e-getquery1', name: 'advert 1', adtechId: 123, status: 'active' },
                { id: 'e2e-getquery2', name: 'advert 2', adtechId: 456, status: 'inactive' },
                { id: 'e2e-getquery3', name: 'advert 3', adtechId: 789, status: 'active' },
                { id: 'e2e-getgone', name: 'advert deleted', adtechId: 666, status: 'deleted' }
            ];
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should get all advertisers', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
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
                expect(results[0].data).toEqual({route: 'GET /api/account/advertisers/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get advertisers by name', function(done) {
            options.qs.name = 'advert 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should get advertisers by adtechId', function(done) {
            options.qs.adtechId = '456';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
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
                expect(resp.body[0].id).toBe('e2e-getquery3');
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

    describe('POST /api/account/advertiser', function() {
        var mockAdvert, options;
        beforeEach(function() {
            mockAdvert = { name: 'e2e_test-' + new Date().toISOString() };
            options = {
                url: config.adsUrl + '/account/advertiser',
                jar: cookieJar,
                json: mockAdvert
            };
        });

        it('should be able to create an advertiser', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(mockAdvert.name);
                expect(resp.body.adtechId).toEqual(jasmine.any(Number));
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                
                createdAdvert = resp.body;
                return adtech.customerAdmin.getAdvertiserById(createdAdvert.adtechId).catch(adtechErr);
            }).then(function(advert)  {
                expect(advert.name).toBe(createdAdvert.name);
                expect(advert.extId).toBe(createdAdvert.id);
                expect(advert.companyData.url).toBe('http://cinema6.com');
                
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
                expect(results[0].data).toEqual({route: 'POST /api/account/advertiser/', params: {}, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            q.all([{foo: 'bar'}, {name: 'test advert', adtechId: 1234}].map(function(body) {
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

    describe('PUT /api/account/advertiser/:id', function() {
        var mockAdverts, now, options, keptAdvert;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            var promise;
            if (keptAdvert) {
                promise = q();
            } else { // this is an alternative to hardcoding the adtechId for this in the test
                promise = adtech.customerAdmin.getAdvertiserByExtId('e2e-a-keepme').then(function(resp) {
                    keptAdvert = { id: 'e2e-a-keepme', status: 'active', name: resp.name, adtechId: resp.id };
                }).catch(adtechErr);
            }
            
            promise.then(function() {
                mockAdverts = [
                    { id: 'e2e-put1', status: 'active', name: 'fake advert', foo: 'bar' },
                    { id: 'e2e-deleted', status: 'deleted', adtechId: 1234, name: 'deleted advert' },
                    keptAdvert,
                    createdAdvert
                ];
                return testUtils.resetCollection('advertisers', mockAdverts);
            }).done(done);
        });

        it('should successfully update an advertiser in mongo and adtech', function(done) {
            options = {
                url: config.adsUrl + '/account/advertiser/' + createdAdvert.id,
                json: { name: 'e2e_test_updated' },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(createdAdvert);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe(createdAdvert.id);
                expect(resp.body.adtechId).toBe(createdAdvert.adtechId);
                expect(resp.body.name).toBe('e2e_test_updated');
                expect(resp.body.created).toBe(createdAdvert.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdAdvert.lastUpdated));
                
                return adtech.customerAdmin.getAdvertiserById(createdAdvert.adtechId).catch(adtechErr);
            }).then(function(advert) {
                expect(advert.name).toBe('e2e_test_updated');
                expect(advert.extId).toBe(createdAdvert.id);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            options = {
                url: config.adsUrl + '/account/advertiser/e2e-put1',
                json: { name: 'fake advert', foo: 'baz' },
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
                expect(results[0].data).toEqual({route: 'PUT /api/account/advertiser/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should preserve other existing adtech fields', function(done) {
            options = {
                url: config.adsUrl + '/account/advertiser/e2e-a-keepme',
                json: { name: 'e2e_a_KEEP_ME_' + new Date().toISOString() },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe(options.json.name);
                return adtech.customerAdmin.getAdvertiserById(keptAdvert.adtechId).catch(adtechErr);
            }).then(function(advert) {
                expect(advert.name).toBe(options.json.name);
                expect(advert.extId).toBe('e2e-a-keepme');
                expect(advert.companyData).toEqual({ address: { address1: '1 Bananas Road', address2: 'Apt 123',
                    city: 'Bananaville', country: 'USA', zip: '12345' }, firmName: '', fax: '9876543210',
                    id: jasmine.any(Number), mail: '', phone: '1234567890', url: 'http://bananas.com' });
                expect(advert.contacts).toEqual([{email: 'jtestmonkey@foo.com', fax: '',
                    firstName: 'Johnny', lastName: 'Testmonkey', id: jasmine.any(Number), mobile: '', phone: ''}]);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit an advertiser that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/account/advertiser/e2e-deleted',
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
        
        it('should not create an advertiser if they do not exist', function(done) {
            options = {
                url: config.adsUrl + '/account/advertiser/e2e-putfake',
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

    describe('DELETE /api/account/advertiser/:id', function() {
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-del1', status: 'deleted', adtechId: 1234 },
                { id: 'e2e-del2', status: 'active' },
                createdAdvert
            ];
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should delete an advertiser from adtech and set its status to deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/advertiser/' + createdAdvert.id};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/account/advertiser/' + createdAdvert.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                
                return adtech.customerAdmin.getAdvertiserById(createdAdvert.adtechId).catch(adtechErr)
                .then(function(advert) {
                    expect(advert).not.toBeDefined();
                }).catch(function(err) {
                    expect(err).toEqual(new Error('Unable to locate object: ' + createdAdvert.adtechId + '.'));
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should handle advertisers that have no adtechId', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/advertiser/e2e-del2'};
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
                expect(results[0].data).toEqual({route: 'DELETE /api/account/advertiser/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/account/advertiser/e2e-del2' + createdAdvert.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the advertiser has been deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/advertiser/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the advertiser does not exist', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/account/advertiser/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/account/advertiser/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
