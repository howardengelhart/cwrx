var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        promUrl  : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/promotions',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('orgSvc promotions endpoints (E2E):', function() {
    var cookieJar, mockApp, appCreds;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (cookieJar) {
            return done();
        }

        cookieJar = request.jar();
        var mockUser = {
            id: 'u-admin',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['managePromotions']
        };
        var testPolicy = {
            id: 'p-e2e-promotions',
            name: 'managePromotions',
            status: 'active',
            priority: 1,
            permissions: {
                promotions: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        mockApp = {
            id: 'app-e2e-promotions',
            key: 'e2e-promotions',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                promotions: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
        q.all([
            testUtils.resetCollection('users', mockUser),
            testUtils.resetCollection('policies', testPolicy),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return requestUtils.qRequest('post', {
                url: config.authUrl + '/login',
                json: { email: mockUser.email, password: 'password' },
                jar: cookieJar
            });
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/promotions/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockProms = [
                { id: 'e2e-pro-1', name: 'prom 1', status: 'active', type: 'signupReward', data: {} },
                { id: 'e2e-deleted', name: 'prom deleted', status: 'deleted' }
            ];
            options = {
                url: config.promUrl + '/e2e-pro-1',
                jar: cookieJar
            };
            testUtils.resetCollection('promotions', mockProms).done(done);
        });

        it('should get a promotion by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-pro-1', name: 'prom 1', status: 'active', type: 'signupReward', data: {} });
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/promotions/:id',
                                                 params: { 'id': 'e2e-pro-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'name' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-pro-1', name: 'prom 1' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show deleted promotions', function(done) {
            options.url = config.promUrl + '/e2e-deleted';
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
            options.url = config.promUrl + '/e2e-pro-5678';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an app to get a promotion', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'e2e-pro-1', name: 'prom 1', status: 'active', type: 'signupReward', data: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/promotions', function() {
        var options;
        beforeEach(function(done) {
            options = { url: config.promUrl + '', qs: {sort: 'id,1'}, jar: cookieJar };
            var mockProms = [
                { id: 'e2e-pro-1', name: 'prom 1', status: 'active', type: 'signupReward', data: {} },
                { id: 'e2e-pro-2', name: 'prom 2', status: 'inactive', type: 'signupReward', data: {} },
                { id: 'e2e-pro-3', name: 'prom 3', status: 'active', type: 'loyaltyReward', data: {} },
                { id: 'e2e-getgone', name: 'prom deleted', status: 'deleted', type: 'signupReward', data: {} }
            ];
            testUtils.resetCollection('promotions', mockProms).done(done);
        });

        it('should get all promotions', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-pro-1');
                expect(resp.body[1].id).toBe('e2e-pro-2');
                expect(resp.body[2].id).toBe('e2e-pro-3');
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/promotions/',
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
                    { id: 'e2e-pro-1', name: 'prom 1' },
                    { id: 'e2e-pro-2', name: 'prom 2' },
                    { id: 'e2e-pro-3', name: 'prom 3' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get promotions by name', function(done) {
            options.qs.name = 'prom 3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('e2e-pro-3');
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get promotions by id list', function(done) {
            options.qs.ids = 'e2e-pro-2,e2e-pro-3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pro-2');
                expect(resp.body[1].id).toBe('e2e-pro-3');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get promotions by type', function(done) {
            options.qs.type = 'signupReward';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pro-1');
                expect(resp.body[1].id).toBe('e2e-pro-2');
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
                expect(resp.body[0].id).toBe('e2e-pro-3');
                expect(resp.body[1].id).toBe('e2e-pro-2');
                expect(resp.response.headers['content-range']).toBe('items 1-2/3');
                options.qs.skip = 1;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('e2e-pro-2');
                expect(resp.body[1].id).toBe('e2e-pro-1');
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

        it('should allow an app to get promotions', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(3);
                expect(resp.body[0].id).toBe('e2e-pro-1');
                expect(resp.body[1].id).toBe('e2e-pro-2');
                expect(resp.body[2].id).toBe('e2e-pro-3');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/promotions', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.promUrl + '/',
                jar: cookieJar,
                json: {
                    name: 'thx for signing up dood',
                    type: 'signupReward',
                    data: {
                        rewardAmount: 50
                    }
                }
            };
            testUtils.resetCollection('promotions').done(done);
        });

        it('should be able to create a promotion', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id          : jasmine.any(String),
                    status      : 'active',
                    created     : jasmine.any(String),
                    lastUpdated : resp.body.created,
                    name        : 'thx for signing up dood',
                    type        : 'signupReward',
                    data        : {
                        rewardAmount: 50
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/promotions/', params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if no type is provided', function(done) {
            delete options.json.type;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Missing required field: type');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the type is unrecognized', function(done) {
            options.json.type = 'freeeeee money';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('type is UNACCEPTABLE! acceptable values are: [signupReward,freeTrial]');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('when creating a signupReward promotion', function() {
            it('should return a 400 if no rewardAmount is provided', function(done) {
                delete options.json.data.rewardAmount;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Missing required field: data.rewardAmount');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the rewardAmount is invalid', function(done) {
                q.all(['many dollars', -20].map(function(amount) {
                    options.json.data.rewardAmount = amount;
                    return requestUtils.qRequest('post', options);
                }))
                .then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('data.rewardAmount must be in format: number');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('data.rewardAmount must be greater than the min: 0');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        describe('when creating a freeTrial promotion', function() {
            beforeEach(function() {
                options.json.type = 'freeTrial';
                options.json.data = {
                    trialLength: 7
                };
            });

            it('should return a 400 if no trialLength is provided', function(done) {
                delete options.json.data.trialLength;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('Missing required field: data.trialLength');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the trialLength is invalid', function(done) {
                q.all(['many days', -20].map(function(amount) {
                    options.json.data.trialLength = amount;
                    return requestUtils.qRequest('post', options);
                }))
                .then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('data.trialLength must be in format: number');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('data.trialLength must be greater than the min: 0');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should trim off forbidden fields', function(done) {
            options.json.id = 'pro-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.id).not.toBe('a-fake');
                expect(new Date(resp.body.created)).toBeGreaterThan(options.json.created);
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

        it('should allow an app to create a promotion', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    id          : jasmine.any(String),
                    name        : 'thx for signing up dood',
                    type        : 'signupReward',
                    data        : {
                        rewardAmount: 50
                    }
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/promotions/:id', function() {
        var mockProms, options;
        beforeEach(function(done) {
            mockProms = [
                { id: 'e2e-pro-1', status: 'active', name: 'prom 1', type: 'signupReward', data: { rewardAmount: 50 } },
                { id: 'e2e-pro-2', status: 'active', name: 'prom 2', type: 'freeTrial', data: { trialLength: 7, paymentMethodRequired: true } },
                { id: 'e2e-pro-deleted', status: 'deleted', name: 'deleted refCode', type: 'signupReward', data: {} }
            ];
            options = {
                url: config.promUrl + '/e2e-pro-1',
                json: { name: 'new name' },
                jar: cookieJar
            };
            return testUtils.resetCollection('promotions', mockProms).done(done);
        });

        it('should successfully update a promotion', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pro-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.type).toBe('signupReward');
                expect(resp.body.data).toEqual({ rewardAmount: 50 });
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
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/promotions/:id',
                                                 params: { id: 'e2e-pro-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not allow unsetting the type', function(done) {
            options.json.type = null;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-pro-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.type).toBe('signupReward');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the type is unrecognized', function(done) {
            options.json.type = 'freeeeee money';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('type is UNACCEPTABLE! acceptable values are: [signupReward,freeTrial]');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('when editing a signupReward promotion', function(done) {
            it('should not allow unsetting the rewardAmount', function(done) {
                options.json.data = {};
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pro-1');
                    expect(resp.body.name).toBe('new name');
                    expect(resp.body.type).toBe('signupReward');
                    expect(resp.body.data).toEqual({ rewardAmount: 50 });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the rewardAmount is invalid', function(done) {
                q.all(['many dollars', -20].map(function(amount) {
                    options.json.data = { rewardAmount: amount };
                    return requestUtils.qRequest('put', options);
                }))
                .then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('data.rewardAmount must be in format: number');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('data.rewardAmount must be greater than the min: 0');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('when editing a signupReward promotion', function(done) {
            beforeEach(function() {
                options.url = config.promUrl + '/e2e-pro-2';
                options.json.data = {
                    trialLength: 18,
                    paymentMethodRequired: false
                };
            });
            
            it('should allow changing the trialLength and paymentMethodRequired', function(done) {
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pro-2');
                    expect(resp.body.name).toBe('new name');
                    expect(resp.body.type).toBe('freeTrial');
                    expect(resp.body.data).toEqual({
                        trialLength: 18,
                        paymentMethodRequired: false
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should not allow unsetting the trialLength', function(done) {
                delete options.json.data.trialLength;
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toBe('e2e-pro-2');
                    expect(resp.body.name).toBe('new name');
                    expect(resp.body.type).toBe('freeTrial');
                    expect(resp.body.data).toEqual({
                        trialLength: 7,
                        paymentMethodRequired: false
                    });
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return a 400 if the trialLength is invalid', function(done) {
                q.all(['many dollars', -20].map(function(amount) {
                    options.json.data = { trialLength: amount };
                    return requestUtils.qRequest('put', options);
                }))
                .then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].body).toBe('data.trialLength must be in format: number');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].body).toBe('data.trialLength must be greater than the min: 0');
                })
                .catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should trim off forbidden fields', function(done) {
            options.json.id = 'pro-fake';
            options.json._id = '_WEORIULSKJF';
            options.json.created = new Date(Date.now() - 99999999);
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-pro-1');
                expect(resp.body.created).not.toEqual(options.json.created);
                expect(resp.body.name).toBe('new name');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a promotion that has been deleted', function(done) {
            options.url = config.promUrl + '/e2e-pro-deleted';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That has been deleted');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a promotion if it does not exist', function(done) {
            options.url = config.promUrl + '/e2e-pro-fake';
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

        it('should allow an app to edit a promotion', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-pro-1');
                expect(resp.body.name).toBe('new name');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('DELETE /api/promotions/:id', function() {
        var options;
        beforeEach(function(done) {
            var mockProms = [
                { id: 'e2e-pro-1', name: 'prom 1', status: 'active', type: 'signupReward', data: {} },
                { id: 'e2e-deleted', name: 'prom 2', status: 'deleted', code: 'goneforeva' }
            ];
            options = {
                url: config.promUrl + '/e2e-pro-1',
                jar: cookieJar
            };
            testUtils.resetCollection('promotions', mockProms).done(done);
        });

        it('should delete a promotion', function(done) {
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
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
                expect(results[0].user).toBe('u-admin');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('orgSvc');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/promotions/:id',
                                                 params: { id: 'e2e-pro-1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the promotion has been deleted', function(done) {
            options.url = config.promUrl + '/e2e-deleted';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a 204 if the promotion does not exist', function(done) {
            options.url = config.promUrl + '/LDFJDKJFWOI';
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: config.promUrl + '/e2e-pro-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to delete a promotion', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'delete', options).then(function(resp) {
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
