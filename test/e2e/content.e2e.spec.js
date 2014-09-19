var q               = require('q'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('content (E2E):', function() {
    var cookieJar, mockUsers;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();
        mockUsers = [
            {
                id: 'e2e-user',
                status: 'active',
                email : 'contente2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'e2e-org',
                applications: ['e2e-app1'],
                permissions: {
                    experiences: {
                        read: 'org',
                        create: 'own',
                        edit: 'own',
                        delete: 'own'
                    }
                }
            },
            {
                id: 'ad-e2e-user',
                status: 'active',
                email : 'admanager',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'e2e-org',
                applications: ['e2e-app1'],
                permissions: {
                    experiences: {
                        create: 'own',
                        edit: 'all',
                        editAdConfig: 'org'
                    }
                }
            },
            {
                id: 'admin-e2e-user',
                status: 'active',
                email : 'admine2euser',
                password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
                org: 'admin-e2e-org',
                applications: ['e2e-app1'],
                permissions: {
                    experiences: {
                        read: 'all',
                        create: 'all'
                    }
                }
            },
        ];
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'contente2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUsers).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/public/content/experience/:id', function() {
        var mockExps, mockOrg, options;
        beforeEach(function(done) {
            options = {
                url: config.contentUrl + '/public/content/experience/e2e-pubget1',
                headers: { origin: 'http://test.c6.com' },
                qs: { context: 'mr2', branding: 'reqBrand', placementId: '789' }
            };
            mockExps = [
                {
                    id: 'e2e-pubget1',
                    title: 'test experience',
                    data: [{data: { foo: 'bar', branding: 'expBrand', placementId: '123' }, versionId: 'a5e744d0'}],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    status: 'active'
                },
                {
                    id: 'e2e-org-adConfig',
                    data: [ { data: {foo: 'bar' }, versionId: 'a5e744d0' } ],
                    access: 'public',
                    status: 'active',
                    user: 'e2e-user',
                    org: 'e2e-active-org'
                },
                {
                    id: 'e2e-adConfig',
                    data: [ { data: { foo: 'bar', adConfig: { foo: 'baz' } }, versionId: 'a5e744d0' } ],
                    access: 'public',
                    status: 'active',
                    user: 'e2e-user',
                    org: 'e2e-active-org'
                },
                { id: 'e2e-pubget2', status: 'pending', access: 'public' },
                { id: 'e2e-pubget3', status: 'active', access: 'private' }
            ];
            mockSite = {id: 'e2e-site', status: 'active', host: 'c6.com', branding: 'siteBrand', placementId: '456'};
            mockOrg = { id: 'e2e-active-org', status: 'active', adConfig: { foo: 'bar' } };
            q.all([testUtils.resetCollection('experiences', mockExps),
                   testUtils.resetCollection('orgs', mockOrg),
                   testUtils.resetCollection('sites', mockSite)
            ]).done(function() { done() });
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pubget1');
                expect(resp.body.title).toBe('test experience');
                expect(resp.body.data).toEqual({foo: 'bar', branding: 'expBrand', placementId: '123'});
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.versionId).toBe('a5e744d0');
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should properly get the experience\'s org\'s adConfig if it exists', function(done) {
            options.url = options.url.replace('e2e-pubget1', 'e2e-org-adConfig');
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-org-adConfig');
                expect(resp.body.data.adConfig).toEqual({foo: 'bar'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should override the org\'s adConfig if it\'s defined on the experience', function(done) {
            options.url = options.url.replace('e2e-pubget1', 'e2e-adConfig');
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-adConfig');
                expect(resp.body.data.adConfig).toEqual({foo: 'baz'});
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use the request branding and placementId if not on the exp', function(done) {
            options.url = options.url.replace('e2e-pubget1', 'e2e-org-adConfig');
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-org-adConfig');
                expect(resp.body.data.branding).toBe('reqBrand');
                expect(resp.body.data.placementId).toBe('789');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fall back to the current site\'s branding and placementId', function(done) {
            options.qs.context = 'embed';
            options.url = options.url.replace('e2e-pubget1', 'e2e-org-adConfig');
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-org-adConfig');
                expect(resp.body.data.branding).toBe('siteBrand');
                expect(resp.body.data.placementId).toBe('456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should have some system level defaults for the branding and placementId', function(done) {
            options.qs.context = 'embed';
            options.url = options.url.replace('e2e-pubget1', 'e2e-org-adConfig');
            options.headers.origin = 'http://cinema6.com';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-org-adConfig');
                expect(resp.body.data.branding).toBeDefined();
                expect(resp.body.data.branding).not.toBe('siteBrand');
                expect(resp.body.data.placementId).toBeDefined();
                expect(resp.body.data.placementId).not.toBe('456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should only get pending, public experiences if the origin is cinema6.com', function(done) {
            var options = {url: config.contentUrl + '/public/content/experience/e2e-pubget2'};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
                options.headers = { origin: 'https://staging.cinema6.com' };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-pubget2', status: 'pending', access: 'public'});
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should only get active, private experiences if the origin is not cinema6.com', function(done) {
            var options = {url: config.contentUrl + '/public/content/experience/e2e-pubget3'};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-pubget3', status: 'active', access: 'private'});
                options.headers = { origin: 'https://staging.cinema6.com' };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use the referer header for access control if origin is not defined', function(done) {
            options.url = config.contentUrl + '/public/content/experience/e2e-pubget2';
            options.headers = { referer: 'https://staging.cinema6.com' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-pubget2', status: 'pending', access: 'public'});
                options.url = config.contentUrl + '/public/content/experience/e2e-pubget3';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/public/content/experience/e2e-getid5678'
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Experience not found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    /* Currently, this endpoint is identical to GET /api/public/experience/:id, so only one test is
     * included here as a sanity check. If the endpoints diverge, additional tests should be written. */
    describe('GET /api/public/experience/:id.json', function() {
        var mockExps, mockOrg, options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/public/content/experience/e2e-pubgetjson1.json' };
            mockExp = { id: 'e2e-pubgetjson1', access: 'public', status: 'active' };
            testUtils.resetCollection('experiences', mockExp).done(done);
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pubgetjson1');
                expect(resp.body.status).toBe('active');
                expect(resp.body.access).toBe('public');
                expect(resp.body.user).not.toBeDefined();
                expect(resp.body.org).not.toBeDefined();
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    /* Currently this endpoint is mostly identical to GET /api/public/experience/:id, so two tests
     * are included to verify that the output is formatted correctly. If the endpoints diverge,
     * additional tests should be written. */
    describe('GET /api/public/experience/:id.js', function() {
        var mockExps, mockOrg, options;
        beforeEach(function(done) {
            options = { url: config.contentUrl + '/public/content/experience/e2e-pubgetjs1.js' };
            mockExp = { id: 'e2e-pubgetjs1', access: 'public', status: 'active' };
            testUtils.resetCollection('experiences', mockExp).done(done);
        });

        it('should get an experience by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.match(/module\.exports = {.*"id":"e2e-pubgetjs1".*};/)).toBeTruthy();
                expect(resp.response.headers['content-type']).toBe('application/javascript');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return errors in normal format', function(done) {
            options = { url: config.contentUrl + '/public/content/experience/e2e-fake.js' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('GET /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: 'e2e-getid1',
                    access: 'public',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'e2e-user',
                    org: 'e2e-org'
                },
                {
                    id: 'e2e-getid2',
                    access: 'public',
                    status: [{status: 'active', date: new Date()}],
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-getid3',
                    access: 'public',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'not-e2e-user',
                    org: 'not-e2e-org'
                },
                {
                    id: 'e2e-app1',
                    access: 'private',
                    status: [{status: 'inactive', date: new Date()}],
                    user: 'admin',
                    org: 'admin'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should get an experience by id', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-getid1');
                expect(resp.body.data).not.toBeDefined();
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should treat the user as a guest for experiences they do not own', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid2', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                options.url = config.contentUrl + '/content/experience/e2e-getid3';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Experience not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should let a user get a private experience in their applications list', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-app1', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-app1');
                expect(resp.body.user).toBe('admin');
                expect(resp.body.org).toBe('admin');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.contentUrl + '/content/experience/e2e-getid1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = {url: config.contentUrl + '/content/experience/e2e-getid5678', jar: cookieJar};
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Experience not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('GET /api/content/experiences', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: 'e2e-getquery1',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'private',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery2',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'e2e-org',
                    type: 'bar'
                },
                {
                    id: 'e2e-getquery3',
                    status: [{status: 'active', date: new Date()}],
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery4',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'private',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery5',
                    status: [{status: 'inactive', date: new Date()}],
                    access: 'public',
                    user: 'not-e2e-user',
                    org: 'not-e2e-org',
                    type: 'foo'
                },
                {
                    id: 'e2e-getquery6',
                    status: [{status: 'deleted', date: new Date()}],
                    access: 'public',
                    user: 'e2e-user',
                    org: 'e2e-org',
                    type: 'foo'
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should get multiple experiences by id', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery3&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[0].data).not.toBeDefined();
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.body[1].data).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should get experiences by user', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should get experiences by type', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should get experiences by org', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?org=e2e-org&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
                
        it('should get experiences by status', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?status=inactive&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should not allow a user to query for deleted experiences', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?status=deleted&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot get deleted experiences');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to combine query params', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&org=e2e-org&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should not get experiences by any other query param', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?tag=foo&sort=id,1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must specify at least one supported query param');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should only get private or inactive experiences the user owns', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery2,e2e-getquery4',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should use the origin header for access control', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                headers: { origin: 'https://staging.cinema6.com' },
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should allow an admin to see any non-deleted experience', function(done) {
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: cookieJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = {
                    url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                    jar: cookieJar
                };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.body[1].id).toBe('e2e-getquery3');
                expect(resp.body[2].id).toBe('e2e-getquery4');
                expect(resp.body[3].id).toBe('e2e-getquery5');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
                delete cookieJar.cookies; // force reset and re-login of mockRequester in beforeEach
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should return a 200 and empty array if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=hamboneHarry',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                jar: cookieJar,
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery2,e2e-getquery3' +
                                         '&limit=2&sort=id,-1'
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-getquery3');
                expect(resp.body[1].id).toBe('e2e-getquery2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.url += '&skip=2';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-getquery1');
                expect(resp.response.headers['content-range']).toBe('items 3-3/3');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user'
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('POST /api/content/experience', function() {
        var mockExp, options;
        beforeEach(function(done) {
            mockExp = {
                tag: 'testExp',
                data: { foo: 'bar' },
                org: 'e2e-org'
            };
            options = {
                url: config.contentUrl + '/content/experience',
                jar: cookieJar,
                json: mockExp
            };
            testUtils.resetCollection('experiences').done(done);
        });
        
        it('should be able to create an experience', function(done) {
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
        
        it('should be able to create an active, private experience', function(done) {
            mockExp.status = 'active';
            mockExp.access = 'private';
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
            }).finally(done); 
        });
        
        it('should trim off certain fields not allowed on the top level', function(done) {
            mockExp.title = 'bad title location';
            mockExp.versionId = 'tha best version';
            mockExp.data.title = 'data title';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe('data title');
                expect(resp.body.versionId).toBe('14eb66c8');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done); 
        });
        
        it('should allow an admin to set a different user and org for the experience', function(done) {
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: {email: 'admine2euser', password: 'password'},
                jar: cookieJar
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                mockExp.user = 'another-user';
                mockExp.org = 'another-org';
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.tag).toBe('testExp');
                expect(resp.body.user).toBe('another-user');
                expect(resp.body.org).toBe('another-org');
                delete cookieJar.cookies; // force reset and re-login of mockRequester in beforeEach
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not allow a regular user to set a different user and org for the experience', function(done) {
            mockExp.user = 'another-user';
            mockExp.org = 'another-org';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBeDefined('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should only allow the adConfig to be set by users with permission', function(done) {
            mockExp.data.adConfig = {ads: 'good'};
            var altJar = request.jar();
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                json: { email: 'admanager', password: 'password' },
                jar: altJar
            };
            return requestUtils.qRequest('post', loginOpts).then(function(resp) {
                return q.all([cookieJar, altJar].map(function(jar) {
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
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
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
    
    describe('PUT /api/content/experience/:id', function() {
        var mockExps, now;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            mockExps = [
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
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should successfully update an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { tag: 'newTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockExps[0]);
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

        it('should properly update the data and versionId together', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { data: { foo: 'baz' } }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockExps[0]);
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
        
        it('should not create an experience if it does not exist', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-putfake',
                jar: cookieJar,
                json: { tag: 'fakeTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not edit an experience that has been deleted', function(done) {
            var url = config.contentUrl + '/content/experience/e2e-put1',
                putOpts = { url: url, jar: cookieJar, json: { tag: 'fakeTag' } },
                deleteOpts = { url: url, jar: cookieJar };
            requestUtils.qRequest('delete', deleteOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('put', putOpts)
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not update an experience the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put2',
                jar: cookieJar,
                json: { tag: 'newTag' }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this experience');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        
        it('should not let users edit experiences\' adConfig if they lack permission', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { data: { adConfig: { ads: 'bad' } } }
            }, updatedExp;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit adConfig of this experience');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should allow the edit if the adConfig is unchanged', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
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
        
        it('should let users edit owned experiences\' adConfig if they have permission', function(done) {
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
                        url: config.contentUrl + '/content/experience/' + id,
                        jar: altJar,
                        json: { data: { foo: 'baz', adConfig: { ads: 'bad' } } }
                    };
                    return requestUtils.qRequest('put', options);
                }));
            }).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.data).toEqual({ foo: 'baz', adConfig: { ads: 'bad' } });
                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toBe('Not authorized to edit adConfig of this experience');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
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
    
    describe('DELETE /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
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
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should set the status of an experience to deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/experience/e2e-del1', jar: cookieJar};
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
        
        it('should not delete an experience the user does not own', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del2'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this experience');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 204 if the experience was already deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
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
        
        it('should still return a 204 if the experience does not exist', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/fake'};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.contentUrl + '/content/experience/e2e-del1'})
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
