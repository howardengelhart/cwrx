var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('ads containers endpoints (E2E):', function() {
    var cookieJar, mockCards, mockCamps, mockExps;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (cookieJar && cookieJar.cookies) {
            return done();
        }

        cookieJar = request.jar();
        var mockUser = {
            id: 'u-admin',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['manageAllContainers']
        };
        var testPolicy = {
            id: 'p-e2e-allCons',
            name: 'manageAllContainers',
            status: 'active',
            priority: 1,
            permissions: {
                containers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        
        mockExps = [
            { id: 'e-active', status: [{ status: 'active' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'e-inactive', status: [{ status: 'inactive' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'e-deleted', status: [{ status: 'deleted' }], user: 'e2e-user', org: 'e2e-org' },
        ];
        mockCards = [
            { id: 'rc-active', campaignId: 'cam-active', status: 'active', user: 'e2e-user', org: 'e2e-org' },
            { id: 'rc-paused', campaignId: 'cam-paused', status: 'paused', user: 'e2e-user', org: 'e2e-org' },
            { id: 'rc-deleted', campaignId: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'e2e-org' },
        ];
        mockCamps = [
            { id: 'cam-active', status: 'active', cards: [{ id: 'rc-active' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-paused', status: 'paused', cards: [{ id: 'rc-paused' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-deleted', status: 'deleted', cards: [{ id: 'rc-deleted' }], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-canceled', status: 'canceled', cards: [], user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-expired', status: 'expired', cards: [], user: 'e2e-user', org: 'e2e-org' },
        ];
        
        q.all([
            testUtils.resetCollection('users', mockUser),
            testUtils.resetCollection('policies', testPolicy)
        ]).then(function(results) {
            return requestUtils.qRequest('post', {
                url: config.authUrl + '/login',
                json: { email: mockUser.email, password: 'password' },
                jar: cookieJar
            });
        }).done(function(results) {
            done();
        });
    });
    
    describe('GET /api/containers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockCons = [
                { id: 'e2e-con-1', name: 'box-1', status: 'active', defaultData: { container: 'box-1' } },
                { id: 'e2e-deleted', name: 'gone', status: 'deleted', defaultData: { container: 'gone' } }
            ];
            options = {
                url: config.adsUrl + '/containers/e2e-con-1',
                jar: cookieJar
            };
            testUtils.resetCollection('containers', mockCons).done(done);
        });

        it('should get a container by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-con-1',
                    name: 'box-1',
                    status: 'active',
                    defaultData: { container: 'box-1' }
                });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'GET /api/containers/:id',
                                                 params: { 'id': 'e2e-con-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'status' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-con-1',
                    status: 'active'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted containers', function(done) {
            options.url = config.adsUrl + '/containers/e2e-deleted';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.adsUrl + '/containers/e2e-con-5678';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/containers', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.adsUrl + '/containers', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockCons = [
                { id: 'e2e-con-1', name: 'box-1', status: 'active', defaultData: { container: 'box-1' } },
                { id: 'e2e-con-2', name: 'box-2', status: 'inactive', defaultData: { container: 'box-1' } },
                { id: 'e2e-con-3', name: 'box-3', status: 'active', defaultData: { container: 'box-1' } },
                { id: 'e2e-getgone', name: 'gone', status: 'deleted', defaultData: { container: 'gone' } }
            ];
            testUtils.resetCollection('containers', mockCons).done(done);
        });

        it('should get all containers', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-con-1');
                expect(resp.body[1].id).toBe('e2e-con-2');
                expect(resp.body[2].id).toBe('e2e-con-3');
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
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/containers/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'name';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-con-1', name: 'box-1' },
                    { id: 'e2e-con-2', name: 'box-2' },
                    { id: 'e2e-con-3', name: 'box-3' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get containers by name', function(done) {
            options.qs.name = 'box-3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-con-3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get containers by id list', function(done) {
            options.qs.ids = 'e2e-con-2,e2e-con-3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-con-2');
                expect(resp.body[1].id).toBe('e2e-con-3');
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
            options.qs.sort = 'name,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-con-3');
                expect(resp.body[1].id).toBe('e2e-con-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-con-2');
                expect(resp.body[1].id).toBe('e2e-con-1');
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

    describe('POST /api/containers', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/containers/',
                jar: cookieJar,
                json: {
                    name: 'fake-container',
                    label: 'totally legit container',
                    defaultData: {
                        type: 'full',
                        branding: 'elitedaily'
                    }
                }
            };
            q.all([
                testUtils.resetCollection('containers'),
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.resetCollection('cards', mockCards),
                testUtils.resetCollection('experiences', mockExps)
            ])
            .done(function() { done(); });
        });

        it('should be able to create a container', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id          : jasmine.any(String),
                    status      : 'active',
                    created     : jasmine.any(String),
                    lastUpdated : resp.body.created,
                    name        : 'fake-container',
                    label       : 'totally legit container',
                    defaultData : {
                        container   : 'fake-container',
                        type        : 'full',
                        branding    : 'elitedaily'
                    }
                });
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'POST /api/containers/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to initialize the defaultData if not provided', function(done) {
            options.json = { name: 'bare' };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id          : jasmine.any(String),
                    status      : 'active',
                    created     : jasmine.any(String),
                    lastUpdated : resp.body.created,
                    name        : 'bare',
                    defaultData : {
                        container   : 'bare'
                    }
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if providing links to other entities in defaultData', function() {
            it('should succeed if all linked entities are active', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-active',
                    card: 'rc-active',
                    experience: 'e-active'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.defaultData).toEqual({
                        container: 'fake-container',
                        campaign: 'cam-active',
                        card: 'rc-active',
                        experience: 'e-active'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should succeed if all linked entities are inactive/paused', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-paused',
                    card: 'rc-paused',
                    experience: 'e-inactive'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body.defaultData).toEqual({
                        container: 'fake-container',
                        campaign: 'cam-paused',
                        card: 'rc-paused',
                        experience: 'e-inactive'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are deleted', function(done) {
                q.all([
                    { campaign: 'cam-deleted' },
                    { card: 'rc-deleted' },
                    { experience: 'e-deleted' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('post', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are non-existent', function(done) {
                q.all([
                    { campaign: 'cam-boople' },
                    { card: 'rc-snoots' },
                    { experience: 'e-floofle' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('post', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign and card do not match', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-active',
                    card: 'rc-paused'
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('card rc-paused not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign is canceled or expired', function(done) {
                q.all([
                    { campaign: 'cam-expired' },
                    { campaign: 'cam-canceled' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('post', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return a 400 if no name is provided', function(done) {
            delete options.json.name;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: name');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the name is not unique', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.name).toBe('fake-container');
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An object with that name already exists');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the name contains illegal characters', function(done) {
            q.all(['fake container', 'box!', 'this.foo'].map(function(name) {
                options.json.name = name;
                return requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Invalid name');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(function() { done(); });
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'con-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            options.json.defaultData.container = 'something-else';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('con-fake');
                expect(new Date(resp.body.created)).toBeGreaterThan(options.json.created);
                expect(resp.body.defaultData.container).toBe('fake-container');
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

    describe('PUT /api/containers/:id', function() {
        var mockCons, options;
        beforeEach(function(done) {
            mockCons = [
                { id: 'e2e-con-1', status: 'active', name: 'box-1', defaultData: { container: 'box-1', branding: 'c6' } },
                { id: 'e2e-deleted', status: 'deleted', name: 'gone', defaultData: { container: 'gone' } }
            ];
            options = {
                url: config.adsUrl + '/containers/e2e-con-1',
                json: { label: 'foo bar' },
                jar: cookieJar
            };
            return testUtils.resetCollection('containers', mockCons).done(done);
        });

        it('should successfully update a container', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-con-1');
                expect(resp.body.name).toBe('box-1');
                expect(resp.body.label).toBe('foo bar');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'PUT /api/containers/:id',
                                                 params: { id: 'e2e-con-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should preserve the data.container property', function(done) {
            options.json.defaultData = { branding: 'c7', type: 'mobile' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-con-1');
                expect(resp.body.name).toBe('box-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.defaultData).toEqual({ container: 'box-1', branding: 'c7', type: 'mobile' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow changing the name or data.container properties', function(done) {
            options.json.name = 'box-new';
            options.json.defaultData = { branding: 'c7', container: 'box-new' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.name).toBe('box-1');
                expect(resp.body.label).toBe('foo bar');
                expect(resp.body.defaultData).toEqual({ container: 'box-1', branding: 'c7' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'a-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).toBe('e2e-con-1');
                expect(resp.body.created).not.toEqual(options.json.created);
                expect(resp.body.label).toBe('foo bar');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('if providing links to other entities in defaultData', function() {
            it('should succeed if all linked entities are active', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-active',
                    card: 'rc-active',
                    experience: 'e-active'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.defaultData).toEqual({
                        container: 'box-1',
                        campaign: 'cam-active',
                        card: 'rc-active',
                        experience: 'e-active'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should succeed if all linked entities are inactive/paused', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-paused',
                    card: 'rc-paused',
                    experience: 'e-inactive'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.defaultData).toEqual({
                        container   : 'box-1',
                        campaign: 'cam-paused',
                        card: 'rc-paused',
                        experience: 'e-inactive'
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are deleted', function(done) {
                q.all([
                    { campaign: 'cam-deleted' },
                    { card: 'rc-deleted' },
                    { experience: 'e-deleted' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('put', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if any entities are non-existent', function(done) {
                q.all([
                    { campaign: 'cam-boople' },
                    { card: 'rc-snoots' },
                    { experience: 'e-floofle' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('put', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign and card do not match', function(done) {
                options.json.defaultData = {
                    campaign: 'cam-active',
                    card: 'rc-paused'
                };
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('card rc-paused not found');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the campaign is canceled or expired', function(done) {
                q.all([
                    { campaign: 'cam-expired' },
                    { campaign: 'cam-canceled' }
                ].map(function(obj) {
                    options.json.defaultData = obj;
                    return requestUtils.qRequest('put', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(400);
                        var key = Object.keys(obj)[0];
                        expect(resp.body).toBe(key + ' ' + obj[key] + ' not found');
                    });
                })).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should not edit a container that has been deleted', function(done) {
            options.url = config.adsUrl + '/containers/e2e-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a container if it does not exist', function(done) {
            options.url = config.adsUrl + '/containers/e2e-con-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That does not exist');
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

    describe('DELETE /api/containers/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockCons = [
                { id: 'e2e-con-1', name: 'box-1', org: 'o-selfie', status: 'active', defaultData: { container: 'box-1' } },
                { id: 'e2e-deleted', name: 'gone', org: 'o-selfie', status: 'deleted', defaultData: { container: 'gone' } }
            ];
            options = {
                url: config.adsUrl + '/containers/e2e-con-1',
                jar: cookieJar
            };
            testUtils.resetCollection('containers', mockCons).done(done);
        });

        it('should delete a container', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.adsUrl + '/containers/e2e-con-1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
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
                expect(results[0].data).toEqual({route: 'DELETE /api/containers/:id',
                                                 params: { id: 'e2e-con-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the container has been deleted', function(done) {
            options.url = config.adsUrl + '/containers/e2e-deleted';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the container does not exist', function(done) {
            options.url = config.adsUrl + '/containers/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.adsUrl + '/containers/e2e-con-1'})
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
