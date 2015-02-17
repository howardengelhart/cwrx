var q               = require('q'),
    adtech          = require('adtech'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    adtechErr       = testUtils.handleAdtechError,
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };
    
jasmine.getEnv().defaultTimeoutInterval = 30000;


function getPlacementsBySite(siteId) {
    var aove = new adtech.AOVE();
    aove.addExpression(new adtech.AOVE.LongExpression('websiteId', Number(siteId)));
    return adtech.websiteAdmin.getPlacementList(null, null, aove).catch(adtechErr);
}

// check that placements exist for each id in each container, and they are correctly named
function comparePlacements(placements, containers, pageId) {
    expect(placements.length).toBe(containers.length * 2);
    containers.forEach(function(cont) {
        var contentPl = placements.filter(function(pment) { return pment.id === cont.contentPlacementId; })[0],
            displayPl = placements.filter(function(pment) { return pment.id === cont.displayPlacementId; })[0];
            
        expect(contentPl).toBeDefined('content placement for ' + cont.id);
        expect(contentPl.name).toBe(cont.id + '_content');
        expect(contentPl.pageId).toBe(pageId);
        expect(displayPl).toBeDefined('display placement for ' + cont.id);
        expect(displayPl.name).toBe(cont.id + '_display');
        expect(displayPl.pageId).toBe(pageId);
    });
}


describe('ads sites endpoints (E2E):', function() {
    var cookieJar, mockUser, createdSite;

    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'sitesvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                sites: {
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
                email: 'sitesvce2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUser).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) { done(); });
    });
    
    beforeEach(function(done) {
        if (adtech.websiteAdmin) {
            return done();
        }
        adtech.createWebsiteAdmin().catch(adtechErr).done(function(resp) { done(); });
    });

    describe('GET /api/site/:id', function() {
        beforeEach(function(done) {
            var mockSites = [
                { id: 'e2e-getid1', name: 'site 1', host: 'foo.com', adtechId: 123, status: 'active' },
                { id: 'e2e-getid2', name: 'site 2', host: 'bar.com', adtechId: 456, status: 'deleted' }
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should get a site by id', function(done) {
            var options = {url: config.adsUrl + '/site/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-getid1', name: 'site 1', host: 'foo.com',
                                           adtechId: 123, status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/site/e2e-getid1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/site/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted sites', function(done) {
            var options = {url: config.adsUrl + '/site/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/site/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/site/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/sites', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/sites', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockSites = [
                { id: 'e2e-getquery1', name: 'site 1', host: 'c6.com', org: 'o-1', adtechId: 123, status: 'active' },
                { id: 'e2e-getquery2', name: 'site 2', host: 'c7.com', org: 'o-1', adtechId: 456, status: 'inactive' },
                { id: 'e2e-getquery3', name: 'site 3', host: 'c8.com', adtechId: 789, status: 'active' },
                { id: 'e2e-getgone', name: 'site deleted', host: 'c9.com', org: 'o-1', adtechId: 666, status: 'deleted' }
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should get all sites', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.body[2].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'GET /api/sites',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get sites by name', function(done) {
            options.qs.name = 'site 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get sites by adtechId', function(done) {
            options.qs.adtechId = '456';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get sites by org', function(done) {
            options.qs.org = 'o-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.name = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'host,-1';
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
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/site', function() {
        var name = 'e2e_test-' + new Date().toISOString(),
            mockSite, options;
        beforeEach(function() {
            mockSite = {
                name: name,
                host: 'test.com',
                containers: [{ id: 'embed' }, { id: 'mr2' }]
            };
            options = {
                url: config.adsUrl + '/site',
                jar: cookieJar,
                json: mockSite
            };
        });

        it('should be able to create a site', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(mockSite.name);
                expect(resp.body.host).toBe('test.com');
                expect(resp.body.containers).toEqual([
                    { id: 'embed', displayPlacementId: jasmine.any(Number), contentPlacementId: jasmine.any(Number) },
                    { id: 'mr2', displayPlacementId: jasmine.any(Number), contentPlacementId: jasmine.any(Number) }
                ]);
                expect(resp.body.adtechId).toEqual(jasmine.any(Number));
                expect(resp.body.pageId).toEqual(jasmine.any(Number));
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                
                createdSite = resp.body;
                return adtech.websiteAdmin.getWebsiteById(createdSite.adtechId).catch(adtechErr);
            }).then(function(site)  {
                expect(site.name).toBe(createdSite.name);
                expect(site.extId).toBe(createdSite.id);
                expect(site.URL).toBe('http://test.com');
                return getPlacementsBySite(createdSite.adtechId);
            }).then(function(placements) {
                comparePlacements(placements, createdSite.containers, createdSite.pageId);
            
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
                expect(results[0].data).toEqual({route: 'POST /api/site', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that host exists', function(done) {
            options.json = { name: 'some other name', host: mockSite.host };
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that host already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that name exists', function(done) {
            options.json = { name: mockSite.name, host: 'some.other.host.com' };
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            q.all([{name: 'test'}, {host: 'abc.com'}, {name: 'test', host: 'abc.com', adtechId: 1234}].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                results.forEach(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the containers are invalid', function(done) {
            options.json.name = 'a bad test site';
            options.json.host = 'bad.test.com';
            q.all([[{id: 'embed'}, {type: 'mr2'}], [{id: 'embed'}, {id: 'embed', type: 2}]].map(function(containers) {
                options.json.containers = containers;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('All containers must have an id');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('Container ids must be unique');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

    });

    describe('PUT /api/site/:id', function() {
        var mockSites, options, keptSite;
        beforeEach(function(done) {
            var promise;
            if (keptSite) {
                promise = q();
            } else { // this is an alternative to hardcoding the adtechId for this in the test
                promise = adtech.websiteAdmin.getWebsiteByExtId('e2e-s-keepme').then(function(resp) {
                    keptSite = { id: 'e2e-s-keepme', name: resp.name, adtechId: resp.id, pageId: resp.pageList[0].id };
                }).catch(adtechErr);
            }
                
            promise.then(function() {
                mockSites = [
                    { id: 'e2e-put1', status: 'active', placementId: 12345, name: 'fake site', host: 'fake.com' },
                    { id: 'e2e-deleted', status: 'deleted', adtechId: 1234, name: 'deleted site' },
                    keptSite,
                    createdSite
                ];
                return testUtils.resetCollection('sites', mockSites);
            }).done(done);
        });

        it('should successfully update a site in mongo and adtech', function(done) {
            options = {
                url: config.adsUrl + '/site/' + createdSite.id,
                json: { name: 'e2e_test_updated', host: 'updated.test.com' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(createdSite);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe(createdSite.id);
                expect(resp.body.name).toBe('e2e_test_updated');
                expect(resp.body.host).toBe('updated.test.com');
                expect(resp.body.created).toBe(createdSite.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdSite.lastUpdated));
                expect(resp.body.containers).toEqual(createdSite.containers);
                createdSite = resp.body;
                
                return adtech.websiteAdmin.getWebsiteById(createdSite.adtechId).catch(adtechErr);
            }).then(function(site) {
                expect(site.name).toBe('e2e_test_updated');
                expect(site.URL).toBe('http://updated.test.com');
                expect(site.extId).toBe(createdSite.id);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-put1',
                json: { foo: 'baz' },
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
                expect(results[0].data).toEqual({route: 'PUT /api/site/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should preserve other existing adtech fields', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-s-keepme',
                json: { name: 'e2e_s_KEEP_ME_' + new Date().toISOString() },
                jar: cookieJar
            }
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe(options.json.name);
                return adtech.websiteAdmin.getWebsiteByExtId('e2e-s-keepme').catch(adtechErr);
            }).then(function(site) {
                expect(site.name).toBe(options.json.name);
                expect(site.extId).toBe('e2e-s-keepme');
                expect(site.company).toEqual({ address: { address1: '1 Bananas Road', address2: 'Apt 123',
                    city: 'Bananaville', country: 'USA', zip: '12345' }, firmName: 'Bananas 4 Bananas',
                    fax: '9876543210', id: jasmine.any(Number), mail: 'jtestmonkey@bananas.com',
                    phone: '1234567890', url: '' });
                expect(site.contact).toEqual({email: 'jtestmonkey@bananas.com', fax: '9876543210', firstName: 'Johnny',
                    lastName: 'Testmonkey', id: jasmine.any(Number), mobile: '', phone: '1234567890'});
                expect(site.pageList).not.toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit the placement list', function(done) {
            options = {
                url: config.adsUrl + '/site/' + createdSite.id,
                json: { containers: [{id: 'embed'}, {id: 'taboola'}] },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe(createdSite.name);
                expect(resp.body.containers).toEqual([
                    { id: 'embed', displayPlacementId: createdSite.containers[0].displayPlacementId,
                                   contentPlacementId: createdSite.containers[0].contentPlacementId },
                    { id: 'taboola', displayPlacementId: jasmine.any(Number), contentPlacementId: jasmine.any(Number) }
                ]);
                expect(resp.body.adtechId).toEqual(createdSite.adtechId);
                expect(resp.body.pageId).toEqual(createdSite.pageId);
                expect(resp.body.created).toBe(createdSite.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(createdSite.lastUpdated));
                createdSite = resp.body;

                return getPlacementsBySite(createdSite.adtechId);
            }).then(function(placements) {
                comparePlacements(placements, createdSite.containers, createdSite.pageId);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle a legacy-style site', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-put1',
                json: { host: 'really.fake.com', placementId: 54321, wildCardPlacement: 98765 },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe('fake site');
                expect(resp.body.host).toBe('really.fake.com');
                expect(resp.body.placementId).toBe(54321);
                expect(resp.body.wildCardPlacement).toBe(98765);
                expect(resp.body.adtechId).not.toBeDefined();
                expect(resp.body.containers).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a site that has been deleted', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-deleted',
                json: { name: 'resurrected' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a site if they do not exist', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-putfake',
                json: { name: 'the best thing' },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the containers are invalid', function(done) {
            options = { url: config.adsUrl + '/site/' + createdSite.id, jar: cookieJar };
            q.all([[{id: 'embed'}, {type: 'mr2'}], [{id: 'embed'}, {id: 'embed', type: 2}]].map(function(containers) {
                options.json = { containers: containers };
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('All containers must have an id');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('Container ids must be unique');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 409 if a site with that host exists', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-put1',
                json: { host: createdSite.host },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that host already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that host exists', function(done) {
            options = {
                url: config.adsUrl + '/site/e2e-put1',
                json: { name: createdSite.name },
                jar: cookieJar
            };
            requestUtils.qRequest('put', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/site/:id', function() {
        beforeEach(function(done) {
            var mockSites = [
                { id: 'e2e-del1', host: 'a.com', status: 'deleted', adtechId: 1234 },
                { id: 'e2e-del2', host: 'b.com', status: 'active' },
                createdSite
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should delete a site and all its entities from adtech and set its status to deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/site/' + createdSite.id};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.adsUrl + '/site/' + createdSite.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
                
                var promises = [
                    adtech.websiteAdmin.getWebsiteById(createdSite.adtechId).catch(adtechErr),
                    adtech.websiteAdmin.getPageById(createdSite.pageId).catch(adtechErr)
                ];
                createdSite.containers.forEach(function(cont) {
                    promises.push(adtech.websiteAdmin.getPlacementById(cont.contentPlacementId).catch(adtechErr));
                    promises.push(adtech.websiteAdmin.getPlacementById(cont.displayPlacementId).catch(adtechErr));
                });
                return q.allSettled(promises);
            }).then(function(results) {
                results.forEach(function(result) {
                    expect(result.state).toBe('rejected');
                    expect(result.value).not.toBeDefined();
                    expect(result.reason).toEqual(jasmine.any(Error));
                    expect(result.reason && result.reason.message).toMatch(/^Unable to locate object: /);
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should handle sites that have no adtechId', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/site/e2e-del2'};
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
                expect(results[0].data).toEqual({route: 'DELETE /api/site/:id',
                                                 params: { id: 'e2e-del2' }, query: {} });
                
                options = {url: config.adsUrl + '/site/e2e-del2' + createdSite.id, jar: cookieJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the site has been deleted', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/site/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the site does not exist', function(done) {
            var options = {jar: cookieJar, url: config.adsUrl + '/site/LDFJDKJFWOI'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/site/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function() {
        testUtils.closeDbs();
    });
});
