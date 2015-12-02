var q               = require('q'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('ads sites endpoints (E2E):', function() {
    var cookieJar, mockUser, createdSite;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

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
    
    describe('GET /api/sites/:id', function() {
        beforeEach(function(done) {
            var mockSites = [
                { id: 'e2e-getid1', name: 'site 1', host: 'foo.com', status: 'active' },
                { id: 'e2e-getid2', name: 'site 2', host: 'bar.com', status: 'deleted' }
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should get a site by id', function(done) {
            var options = {url: config.adsUrl + '/sites/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    name: 'site 1',
                    host: 'foo.com',
                    status: 'active'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.adsUrl + '/sites/e2e-getid1', jar: cookieJar};
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
                expect(results[0].data).toEqual({route: 'GET /api/sites/:id',
                                                 params: { 'id': 'e2e-getid1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            var options = {
                url: config.adsUrl + '/sites/e2e-getid1',
                qs: { fields: 'name,status' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-getid1',
                    name: 'site 1',
                    status: 'active'
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted sites', function(done) {
            var options = {url: config.adsUrl + '/sites/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.adsUrl + '/sites/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.adsUrl + '/sites/e2e-getid5678', jar: cookieJar};
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
                { id: 'e2e-getquery1', name: 'site 1', host: 'c6.com', org: 'o-1', status: 'active' },
                { id: 'e2e-getquery2', name: 'site 2', host: 'c7.com', org: 'o-1', status: 'inactive' },
                { id: 'e2e-getquery3', name: 'site 3', host: 'c8.com', status: 'active' },
                { id: 'e2e-getgone', name: 'site deleted', host: 'c9.com', org: 'o-1', status: 'deleted' }
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
                expect(results[0].data).toEqual({route: 'GET /api/sites/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'name,status';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-getquery1', name: 'site 1', status: 'active' },
                    { id: 'e2e-getquery2', name: 'site 2', status: 'inactive' },
                    { id: 'e2e-getquery3', name: 'site 3', status: 'active' }
                ]);
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
        beforeEach(function(done) {
            mockSite = {
                name: 'my test site',
                host: 'test.com',
                containers: [{ id: 'embed' }, { id: 'mr2' }]
            };
            options = {
                url: config.adsUrl + '/sites/',
                jar: cookieJar,
                json: mockSite
            };
            testUtils.resetCollection('sites').done(done);
        });

        it('should be able to create a site', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('my test site');
                expect(resp.body.host).toBe('test.com');
                expect(resp.body.containers).toEqual([
                    { id: 'embed' },
                    { id: 'mr2' }
                ]);
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done)
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);

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
                expect(results[0].data).toEqual({route: 'POST /api/sites/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that host exists', function(done) {
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                options.json.name = 'new name';
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that host already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that name exists', function(done) {
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                options.json.host = 'oneweirdkerneltrick.com';
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the body is invalid', function(done) {
            q.all([{name: 'test'}, {host: 'abc.com'}].map(function(body) {
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

    describe('PUT /api/sites/:id', function() {
        var mockSites, options;
        beforeEach(function(done) {
            mockSites = [
                {
                    id: 'e2e-put1',
                    status: 'active',
                    name: 'fake site',
                    host: 'fake.com',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-putContainers',
                    status: 'active',
                    name: 'withContainers',
                    host: 'containers.com',
                    org: 'e2e-org',
                    containers: [
                        { id: 'embed' },
                        { id: 'jun' }
                    ]
                },
                { id: 'e2e-deleted', status: 'deleted', name: 'deleted site' },
                
            ];
            options = {
                url: config.adsUrl + '/sites/e2e-put1',
                json: { name: 'less fake site', host: 'less.fake.com' },
                jar: cookieJar
            };
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should successfully update a site', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockSites[0]);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.name).toBe('less fake site');
                expect(resp.body.host).toBe('less.fake.com');
                expect(resp.body.status).toBe('active');
                expect(resp.body.org).toBe('e2e-org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
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
                expect(results[0].data).toEqual({route: 'PUT /api/sites/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to edit the containers', function(done) {
            options.url = config.adsUrl + '/sites/e2e-putContainers';
            options.json = { containers: [ { id: 'embed' }, { id: 'taboola' } ] };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe('withContainers');
                expect(resp.body.containers).toEqual([
                    { id: 'embed' },
                    { id: 'taboola' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a site that has been deleted', function(done) {
            options.url = config.adsUrl + '/sites/e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a site if it does not exist', function(done) {
            options.url = config.adsUrl + '/sites/e2e-putfake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 400 if the containers are invalid', function(done) {
            q.all([
                [{ id: 'embed' }, { type: 'mr2' }],
                [{ id: 'embed'}, { id: 'embed', type: 2 }]
            ].map(function(containers) {
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
            options.url = config.adsUrl + '/sites/' + mockSites[0].id;
            options.json = { host: mockSites[1].host };
            requestUtils.qRequest('put', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that host already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 409 if a site with that name exists', function(done) {
            options.url = config.adsUrl + '/sites/' + mockSites[1].id;
            options.json = { name: mockSites[0].name };
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

    describe('DELETE /api/sites/:id', function() {
        var mockSites, options;
        beforeEach(function(done) {
            mockSites = [
                { id: 'e2e-del1', name: 'site 1', host: 'a.com', status: 'active' },
                { id: 'e2e-del2', name: 'site 2', host: 'b.com', status: 'deleted' }
            ];
            options = {
                url: config.adsUrl + '/sites/e2e-del1',
                jar: cookieJar
            };
            testUtils.resetCollection('sites', mockSites).done(done);
        });

        it('should delete a site', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.adsUrl + '/sites/e2e-del1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                
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
                expect(results[0].data).toEqual({route: 'DELETE /api/sites/:id',
                                                 params: { id: 'e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the site has been deleted', function(done) {
            options.url = config.adsUrl + '/sites/e2e-del2';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the site does not exist', function(done) {
            options.url = config.adsUrl + '/sites/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/sites/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
