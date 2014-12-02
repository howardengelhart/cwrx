var q               = require('q'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('content category endpoints (E2E):', function() {
    var e2eUserJar, somePermsJar, adminJar, mockUsers, mockCats;

    beforeEach(function(done) {
        mockCats = [
            { id: 'e2e-id1', name: 'snuffles', status: 'active' },
            { id: 'e2e-id2', name: 'fluffles', status: 'inactive' },
            { id: 'e2e-id3', name: 'puffles', status: 'pending' },
            { id: 'e2e-id4', name: 'soterios_johnson', status: 'active' },
            { id: 'e2e-id5', name: 'dog', status: 'deleted' }
        ];
    
        if (e2eUserJar && e2eUserJar.cookies && adminJar && adminJar.cookies && somePermsJar && somePermsJar.cookies) {
            return done();
        }
        e2eUserJar = request.jar();
        somePermsJar = request.jar();
        adminJar = request.jar();
        mockUsers = [
            {
                id: 'e2e-user',
                status: 'active',
                email : 'contente2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'e2e-org',
                permissions: {}
            },
            {
                id: 'some-perms-user',
                status: 'active',
                email: 'somepermsuser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'e2e-org',
                permissions: {
                    categories: {
                        read: 'own',
                        create: 'own',
                        edit: 'own',
                        delete: 'own'
                    }
                }
            },
            {
                id: 'admin-e2e-user',
                status: 'active',
                email : 'admine2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'admin-e2e-org',
                permissions: {
                    categories: {
                        read: 'all',
                        create: 'all',
                        edit: 'all',
                        delete: 'all'
                    }
                }
            }
        ];
        var logins = [
            {url:config.authUrl + '/auth/login',jar:e2eUserJar,json: {email:'contente2euser',password:'password'}},
            {url:config.authUrl + '/auth/login',jar:somePermsJar,json: {email:'somepermsuser',password:'password'}},
            {url:config.authUrl + '/auth/login',jar:adminJar,json: {email:'admine2euser',password:'password'}}
        ];
            
        testUtils.resetCollection('users', mockUsers).then(function(resp) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });

    describe('GET /api/content/category/:id', function() {
        beforeEach(function(done) {
            testUtils.resetCollection('categories', mockCats).done(done);
        });

        it('should get an category by id', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-id1', jar: e2eUserJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-id1');
                expect(resp.body.name).toBe('snuffles');
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-id1', jar: e2eUserJar};
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/content/category/:id',
                                                 params: { 'id': 'e2e-id1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not let non-admins retrieve inactive categories', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-id2', jar: e2eUserJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No categories found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should let admins retrieve active or inactive categories', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-id1', jar: adminJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe('snuffles');
                expect(resp.response.headers['content-range']).not.toBeDefined();
                options.url.replace('e2e-id1', 'e2e-id2');
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe('snuffles');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-fake', jar: adminJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No categories found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should not show deleted categories', function(done) {
            var options = {url: config.contentUrl + '/content/category/e2e-id5', jar: adminJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No categories found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.contentUrl + '/content/category/e2e-id1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/content/categories', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.contentUrl + '/content/categories',
                qs: { sort: 'id,1' },
                jar: e2eUserJar
            };
            testUtils.resetCollection('categories', mockCats).done(done);
        });
        
        it('should retrieve a list of all active categories', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].name).toBe('snuffles');
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].name).toBe('soterios_johnson');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/content/categories',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to get categories by name', function(done) {
            options.qs.name = 'snuffles';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('e2e-id1');
                expect(resp.body[0].name).toBe('snuffles');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should let an admin retrieve all categories', function(done) {
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].name).toBe('snuffles');
                expect(resp.body[1].name).toBe('fluffles');
                expect(resp.body[2].name).toBe('puffles');
                expect(resp.body[3].name).toBe('soterios_johnson');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should not get categories by any other query param', function(done) {
            options.qs.status = 'active';
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].status).toBe('active');
                expect(resp.body[1].status).toBe('inactive');
                expect(resp.body[2].status).toBe('pending');
                expect(resp.body[3].status).toBe('active');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and empty array if nothing is found', function(done) {
            options.qs.name = 'bunny';
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
            options.qs.sort = 'name,1';
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].name).toBe('fluffles');
                expect(resp.body[1].name).toBe('puffles');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].name).toBe('snuffles');
                expect(resp.body[1].name).toBe('soterios_johnson');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent mongo query selector injection attacks', function(done) {
            options = {
                url: config.contentUrl + '/content/categories?name[$gt]=',
                jar: adminJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
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

    describe('POST /api/content/category', function() {
        var mockCat, options;
        beforeEach(function(done) {
            mockCat = {
                tag: 'testExp',
                data: { foo: 'bar' },
                org: 'e2e-org'
            };
            options = {
                url: config.contentUrl + '/content/category',
                jar: e2eUserJar,
                json: mockCat
            };
            testUtils.resetCollection('categories').done(done);
        });

        xit('should be able to create an category', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.versionId).toBe('a5e744d0');
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('pending');
                expect(resp.body.access).toBe('public');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should write an entry to the audit collection', function(done) {
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/content/category', params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        xit('should be able to create an active, private category', function(done) {
            mockCat.status = 'active';
            mockCat.access = 'private';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.status).toBe('active');
                expect(new Date(resp.body.lastPublished).toString()).not.toEqual('Invalid Date');
                expect(resp.body.access).toBe('private');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should trim off certain fields not allowed on the top level', function(done) {
            mockCat.title = 'bad title location';
            mockCat.versionId = 'tha best version';
            mockCat.data.title = 'data title';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe('data title');
                expect(resp.body.versionId).toBe('14eb66c8');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should allow an admin to set a different user and org for the category', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                mockCat.user = 'another-user';
                mockCat.org = 'another-org';
                options.jar = altJar;
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        xit('should not allow a regular user to set a different user and org for the category', function(done) {
            mockCat.user = 'another-user';
            mockCat.org = 'another-org';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should only allow the adConfig to be set by users with permission', function(done) {
            mockCat.data.adConfig = {ads: 'good'};
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: { email: 'admanager', password: 'password' },
                jar: altJar
            };
            return requestUtils.qRequest('post', loginOpts).then(function(resp) {
                return q.all([e2eUserJar, altJar].map(function(jar) {
                    options.jar = jar;
                    return requestUtils.qRequest('post', options);
                }));
            }).then(function(results) {
                expect(results[0].response.statusCode).toBe(403);
                expect(results[0].body).toBe('Not authorized to set adConfig');
                expect(results[1].response.statusCode).toBe(201);
                expect(results[1].body.data).toEqual({foo: 'bar', adConfig: {ads: 'good'}});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

    });

    describe('PUT /api/content/category/:id', function() {
        var mockCats, now;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            mockCats = [
                {
                    id: 'e2e-put1',
                    data: [ { data: { foo: 'bar', adConfig: { ads: 'good' } }, versionId: 'a5e744d0' } ],
                    tag: 'origTag',
                    status: 'active',
                    access: 'public',
                    created: now,
                    lastUpdated: now,
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-put2',
                    status: 'active',
                    access: 'public',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                }
            ];
            testUtils.resetCollection('categories', mockCats).done(done);
        });

        xit('should successfully update an category', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                jar: e2eUserJar,
                json: { tag: 'newTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockCats[0]);
                expect(updatedExp).toBeDefined();
                expect(updatedExp._id).not.toBeDefined();
                expect(updatedExp.id).toBe('e2e-put1');
                expect(updatedExp.tag).toBe('newTag');
                expect(updatedExp.user).toBe('e2e-user');
                expect(updatedExp.versionId).toBe('a5e744d0');
                expect(updatedExp.data).toEqual({foo: 'bar', adConfig: {ads: 'good'}});
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should write an entry to the audit collection', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                jar: e2eUserJar,
                json: { tag: 'newTag' }
            };
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
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/content/category/:id',
                                                 params: { id: 'e2e-put1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        xit('should properly update the data and versionId together', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                jar: e2eUserJar,
                json: { data: { foo: 'baz' } }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockCats[0]);
                expect(updatedExp).toBeDefined();
                expect(updatedExp._id).not.toBeDefined();
                expect(updatedExp.data).toEqual({foo: 'baz'});
                expect(updatedExp.versionId).toBe('4c5c9754');
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should not create an category if it does not exist', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-putfake',
                jar: e2eUserJar,
                json: { tag: 'fakeTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That category does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should not edit an category that has been deleted', function(done) {
            var url = config.contentUrl + '/content/category/e2e-put1',
                putOpts = { url: url, jar: e2eUserJar, json: { tag: 'fakeTag' } },
                deleteOpts = { url: url, jar: e2eUserJar };
            requestUtils.qRequest('delete', deleteOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('put', putOpts)
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That category does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should not update an category the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put2',
                jar: e2eUserJar,
                json: { tag: 'newTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this category');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should allow an admin to set a different user and org for the category', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: altJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = {
                    url: config.contentUrl + '/content/category/e2e-put1',
                    json: { user: 'another-user', org: 'another-org' },
                    jar: altJar
                };
                return requestUtils.qRequest('put', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should not allow a regular user to set a different user and org for the category', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                json: { user: 'another-user', org: 'another-org' },
                jar: e2eUserJar
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Invalid request body');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should not let users edit categories\' adConfig if they lack permission', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                jar: e2eUserJar,
                json: { data: { adConfig: { ads: 'bad' } } }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit adConfig of this category');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should allow the edit if the adConfig is unchanged', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                jar: e2eUserJar,
                json: { data: { foo: 'baz', adConfig: { ads: 'good' } } }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.data).toEqual({ foo: 'baz', adConfig: { ads: 'good' } });
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should let users edit owned categories\' adConfig if they have permission', function(done) {
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: { email: 'admanager', password: 'password' },
                jar: altJar
            };
            return requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return q.all(['e2e-put1', 'e2e-put2'].map(function(id) {
                    var options = {
                        url: config.contentUrl + '/content/category/' + id,
                        jar: altJar,
                        json: { data: { foo: 'baz', adConfig: { ads: 'bad' } } }
                    };
                    return requestUtils.qRequest('put', options);
                }));
            }).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.data).toEqual({ foo: 'baz', adConfig: { ads: 'bad' } });
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toBe('Not authorized to edit adConfig of this category');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/category/e2e-put1',
                json: { tag: 'newTag' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('DELETE /api/content/category/:id', function() {
        beforeEach(function(done) {
            var mockCats = [
                {
                    id: 'e2e-del1',
                    status: 'active',
                    access: 'public',
                    user: 'e2e-user'
                },
                {
                    id: 'e2e-del2',
                    status: 'active',
                    access: 'public',
                    user: 'not-e2e-user'
                }
            ];
            testUtils.resetCollection('categories', mockCats).done(done);
        });

        xit('should set the status of an category to deleted', function(done) {
            var options = {jar: e2eUserJar, url: config.contentUrl + '/content/category/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/category/e2e-del1', jar: e2eUserJar};
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should write an entry to the audit collection', function(done) {
            var options = {jar: e2eUserJar, url: config.contentUrl + '/content/category/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('content');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/content/category/:id',
                                                 params: { id: 'e2e-del1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        xit('should not delete an category the user does not own', function(done) {
            var options = {jar: e2eUserJar, url: config.contentUrl + '/content/category/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this category');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should still return a 204 if the category was already deleted', function(done) {
            var options = {jar: e2eUserJar, url: config.contentUrl + '/content/category/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should still return a 204 if the category does not exist', function(done) {
            var options = {jar: e2eUserJar, url: config.contentUrl + '/content/category/fake'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        xit('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.contentUrl + '/content/category/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
});
