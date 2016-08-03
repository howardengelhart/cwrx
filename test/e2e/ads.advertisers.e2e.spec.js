var q               = require('q'),
    path            = require('path'),
    util            = require('util'),
    ld              = require('lodash'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    uuid            = require('rc-uuid'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('ads advertisers endpoints (E2E):', function() {
    var cookieJar, nonAdminJar, mockApp, appCreds;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

        if (cookieJar && nonAdminJar) {
            return done();
        }

        cookieJar = request.jar();
        nonAdminJar = request.jar();
        var mockUser = {
            id: 'u-admin',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['manageAllAdverts']
        };
        var nonAdmin = {
            id: 'u-selfie',
            status: 'active',
            email : 'nonadminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['manageOrgAdverts']
        };
        var testPolicies = [
            {
                id: 'p-e2e-allAdverts',
                name: 'manageAllAdverts',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-orgAdverts',
                name: 'manageOrgAdverts',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'org', edit: 'org', delete: 'org' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-adverts',
            key: 'e2e-adverts',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                advertisers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            {url: config.authUrl + '/login', json: {email: mockUser.email, password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: nonAdmin.email, password: 'password'}, jar: nonAdminJar},
        ];

        q.all([
            testUtils.resetCollection('users', [mockUser, nonAdmin]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });

    describe('GET /api/account/advertisers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie' },
                { id: 'e2e-a-2', name: 'advert 2', status: 'active', org: 'o-other' },
                { id: 'e2e-deleted', name: 'advert deleted', status: 'deleted' }
            ];
            options = {
                url: config.adsUrl + '/account/advertisers/e2e-a-1',
                jar: cookieJar
            };
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should get an advertiser by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/account/advertisers/:id',
                                                 params: { 'id': 'e2e-a-1' }, query: {} });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'status' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-a-1',
                    status: 'active'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a non-admin to only retrieve their advertisers', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-a-1', 'e2e-a-2'].map(function(id) {
                options.url = config.adsUrl + '/account/advertisers/' + id;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body).toEqual({ id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie' });
                expect(results[1].response.statusCode).toBe(404);
                expect(results[1].body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted advertisers', function(done) {
            options.url = config.adsUrl + '/account/advertisers/e2e-deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.adsUrl + '/account/advertisers/e2e-a-5678';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get an advertiser', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie'});
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if an app uses the wrong secret to make a request', function(done) {
            delete options.jar;
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/account/advertisers', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/account/advertisers', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockAdverts = [
                { id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie' },
                { id: 'e2e-a-2', name: 'advert 2', status: 'inactive', org: 'o-selfie' },
                { id: 'e2e-a-3', name: 'advert 3', status: 'active', org: 'o-admin' },
                { id: 'e2e-getgone', name: 'advert deleted', status: 'deleted', org: 'o-selfie' }
            ];
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should get all advertisers', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-a-1');
                expect(resp.body[1].id).toBe('e2e-a-2');
                expect(resp.body[2].id).toBe('e2e-a-3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
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
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'name';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-a-1', name: 'advert 1' },
                    { id: 'e2e-a-2', name: 'advert 2' },
                    { id: 'e2e-a-3', name: 'advert 3' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get advertisers by name', function(done) {
            options.qs.name = 'advert 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-a-3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get advertisers by id list', function(done) {
            options.qs.ids = 'e2e-a-2,e2e-a-3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-a-2');
                expect(resp.body[1].id).toBe('e2e-a-3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get advertisers by org', function(done) {
            options.qs.org = 'o-selfie';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-a-1');
                expect(resp.body[1].id).toBe('e2e-a-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.name = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'name,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-a-3');
                expect(resp.body[1].id).toBe('e2e-a-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-a-2');
                expect(resp.body[1].id).toBe('e2e-a-1');
                expect(resp.response.headers['content-range']).toBe('items 2-3/3');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only show non-admins their own advertisers', function(done) {
            options.jar = nonAdminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-a-1');
                expect(resp.body[1].id).toBe('e2e-a-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get advertisers', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-a-1');
                expect(resp.body[1].id).toBe('e2e-a-2');
                expect(resp.body[2].id).toBe('e2e-a-3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/account/advertisers', function() {
        var options, nowStr;
        beforeEach(function(done) {
            nowStr = String(Date.now()) + ' - ';
            options = {
                url: config.adsUrl + '/account/advertisers/',
                jar: cookieJar,
                json: {
                    name: nowStr + 'post advert 1',
                    defaultLinks: {
                        facebook: 'http://facebook.com'
                    },
                    defaultLogos: {
                        square: 'square.png'
                    }
                }
            };
            testUtils.resetCollection('advertisers').done(done);
        });

        it('should be able to create an advertiser', function(done) {
            var createdAdvert ;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(nowStr + 'post advert 1');
                expect(resp.body.org).toBe('o-admin');
                expect(resp.body.defaultLinks).toEqual({
                    facebook: 'http://facebook.com'
                });
                expect(resp.body.defaultLogos).toEqual({
                    square: 'square.png'
                });
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                createdAdvert = resp.body;
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/account/advertisers/', params: {}, query: {} });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if no name is provided', function(done) {
            delete options.json.name;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off forbidden fields', function(done) {
            options.json.id = 'a-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.org = 'o-fake';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('a-fake');
                expect(resp.body.org).toBe('o-admin');
                expect(new Date(resp.body.created)).toBeGreaterThan(options.json.created);
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to create an advertiser', function(done) {
            delete options.jar;
            var createdAdvert;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe(nowStr + 'post advert 1');
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.defaultLinks).toEqual({
                    facebook: 'http://facebook.com'
                });
                expect(resp.body.defaultLogos).toEqual({
                    square: 'square.png'
                });
                createdAdvert = resp.body;
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/account/advertisers/:id', function() {
        var createdAdverts, mockAdverts, options, nowStr;
        beforeAll(function(done) { // create new adverts
            createdAdverts = [];
            nowStr = String(Date.now()) + ' - ';
            q.all(['put advert 1', 'put advert 2'].map(function(nameSuffix) {
                return requestUtils.qRequest('post', {
                    url: config.adsUrl + '/account/advertisers/',
                    jar: cookieJar,
                    json: {
                        name: nowStr + nameSuffix
                    }
                })
                .then(function(resp) {
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    return q(resp.body);
                });
            })).then(function(results) {
                createdAdverts = results;
                done();
            }).catch(done.fail);
        });

        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/account/advertisers/e2e-a-1',
                json: { name: 'new name', defaultLogos: { square: 'rhombus.png' } },
                jar: cookieJar
            };
            mockAdverts = [
                { id: 'e2e-a-1', status: 'active', org: 'o-selfie', name: 'advert 1', defaultLogos: { square: 'square.png' } },
                { id: 'e2e-a-2', status: 'active', org: 'o-admin', name: 'advert 2', defaultLinks: { google: 'google.com' } },
                { id: 'e2e-a-deleted', status: 'deleted', org: 'o-selfie', name: 'deleted advert' }
            ];
            return q.all(mockAdverts.map(function(advert) {
                return testUtils.mongoUpsert('advertisers', { id: advert.id }, advert);
            })).then(function() {
                done();
            }).catch(done.fail);
        });

        it('should successfully update an advertiser', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-a-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.defaultLogos).toEqual({
                    square: 'rhombus.png'
                });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/account/advertisers/:id',
                                                 params: { id: 'e2e-a-1' }, query: {} });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim off forbidden fields', function(done) {
            options.json.id = 'a-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.org = 'o-fake';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).toBe('e2e-a-1');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.created).not.toEqual(options.json.created);
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow non-admins to edit their own advertisers', function(done) {
            options.jar = nonAdminJar;
            delete options.json.name;
            q.all(['e2e-a-1', 'e2e-a-2'].map(function(id) {
                options.url = config.adsUrl + '/account/advertisers/' + id;
                return requestUtils.qRequest('put', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(200);
                expect(results[0].body.id).toBe('e2e-a-1');
                expect(results[0].body.name).toBe('advert 1');
                expect(results[0].body.defaultLogos).toEqual({ square: 'rhombus.png' });

                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to edit this');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not edit an advertiser that has been deleted', function(done) {
            options.url = config.adsUrl + '/account/advertisers/e2e-a-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not create an advertiser if they do not exist', function(done) {
            options.url = config.adsUrl + '/account/advertisers/e2e-a-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to edit an advertiser', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-a-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.defaultLogos).toEqual({
                    square: 'rhombus.png'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/account/advertisers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-a-1', name: 'advert 1', org: 'o-selfie', status: 'active' },
                { id: 'e2e-a-2', name: 'advert 2', org: 'o-admin', status: 'active' },
                { id: 'e2e-deleted', name: 'advert 3', org: 'o-selfie', status: 'deleted' }
            ];
            options = {
                url: config.adsUrl + '/account/advertisers/e2e-a-1',
                jar: cookieJar
            };
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        it('should delete an advertiser', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.adsUrl + '/account/advertisers/e2e-a-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write and entry to the audit collection', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');

                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/account/advertisers/:id',
                                                 params: { id: 'e2e-a-1' }, query: {} });
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the advertiser has been deleted', function(done) {
            options.url = config.adsUrl + '/account/advertisers/e2e-deleted';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should still return a 204 if the advertiser does not exist', function(done) {
            options.url = config.adsUrl + '/account/advertisers/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow non-admins to delete their own advertisers', function(done) {
            options.jar = nonAdminJar;
            q.all(['e2e-a-1', 'e2e-a-2'].map(function(id) {
                options.url = config.adsUrl + '/account/advertisers/' + id;
                return requestUtils.qRequest('delete', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(204);
                expect(results[0].body).toBe('');

                expect(results[1].response.statusCode).toBe(403);
                expect(results[1].body).toEqual('Not authorized to delete this');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/account/advertisers/e2e-a-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error.message || util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to delete an advertiser', function(done) {
            requestUtils.makeSignedRequest(appCreds, 'delete', {url: config.adsUrl + '/account/advertisers/e2e-a-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
