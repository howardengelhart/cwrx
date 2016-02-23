var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        geoUrl  : 'http://' + (host === 'localhost' ? host + ':4200' : host) + '/api/geo',
        authUrl : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('geo (E2E):', function() {
    var cookieJar, mockApp, appCreds;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (!!cookieJar) {
            return done();
        }

        cookieJar = request.jar();
        var mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'e2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            policies: ['testBlank']
        };
        var testPolicy = {
            id: 'p-e2e-blank',
            name: 'testBlank',
            status: 'active',
            priority: 1,
            permissions: {}
        };
        mockApp = {
            id: 'app-e2e-geo',
            key: 'e2e-geo',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {}
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
        }).done(function() {
            done();
        });
    });
    
    describe('GET /api/geo/zipcodes/:code', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.geoUrl + '/zipcodes/08540',
                jar: cookieJar
            };
        });

        it('should get a zipcode by code', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    zipcode: '08540',
                    city: 'Princeton',
                    stateName: 'New Jersey',
                    stateCode: 'NJ',
                    status: 'active',
                    loc: jasmine.any(Array)
                }));
                expect(resp.response.headers['content-range']).not.toBeDefined();
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
                expect(results[0].service).toBe('geo');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/geo/zipcodes?/:code',
                                                 params: { 'code': '08540' }, query: {} });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs = { fields: 'zipcode,stateName' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    zipcode: '08540',
                    stateName: 'New Jersey'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing is found', function(done) {
            options.url = config.geoUrl + '/zipcodes/blurffffff';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get a zipcode', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(jasmine.objectContaining({
                    zipcode: '08540',
                    city: 'Princeton',
                    stateName: 'New Jersey',
                    stateCode: 'NJ',
                    status: 'active',
                    loc: jasmine.any(Array)
                }));
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

    describe('GET /api/geo/zipcodes', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.geoUrl + '/zipcodes',
                qs: { sort: 'zipcode,1', limit: 5 },
                jar: cookieJar
            };
        });

        it('should get zipcodes', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].zipcode).toBe('00401');
                expect(resp.body[1].zipcode).toBe('00501');
                expect(resp.body[2].zipcode).toBe('00544');
                expect(resp.body[3].zipcode).toBe('02540');
                expect(resp.body[4].zipcode).toBe('02556');
                expect(resp.response.headers['content-range']).toMatch(/items 1-5\/\d+/);
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
                expect(results[0].service).toBe('geo');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/geo/zipcodes?/',
                                                 params: {}, query: { sort: 'zipcode,1', limit: '5' } });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'zipcode,stateCode';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { zipcode: '00401', stateCode: 'NY' },
                    { zipcode: '00501', stateCode: 'NY' },
                    { zipcode: '00544', stateCode: 'NY' },
                    { zipcode: '02540', stateCode: 'MA' },
                    { zipcode: '02556', stateCode: 'MA' }
                ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get zipcodes by zipcode list', function(done) {
            options.qs.zipcodes = '08540,07078';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].zipcode).toBe('07078');
                expect(resp.body[1].zipcode).toBe('08540');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        it('should impose a max limit', function(done) {
            options.qs.limit = 1000;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).not.toBe(1000);
                expect(resp.response.headers['content-range']).not.toMatch(/items 1-1000/);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.zipcodes = 'hamboneHarry';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.zipcodes = '00401,00501,00544,02540';
            options.qs.limit = 2;
            options.qs.sort = 'city,-1';
            options.qs.fields = 'zipcode,city';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]).toEqual({ zipcode: '00401', city: 'Pleasantville' });
                expect(resp.body[1]).toEqual({ zipcode: '00501', city: 'Holtsville' });
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]).toEqual({ zipcode: '00544', city: 'Holtsville' });
                expect(resp.body[1]).toEqual({ zipcode: '02540', city: 'Falmouth' });
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
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
        
        it('should allow an app to get zipcodes', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].zipcode).toBe('00401');
                expect(resp.body[1].zipcode).toBe('00501');
                expect(resp.body[2].zipcode).toBe('00544');
                expect(resp.body[3].zipcode).toBe('02540');
                expect(resp.body[4].zipcode).toBe('02556');
                expect(resp.response.headers['content-range']).toMatch(/items 1-5\/\d+/);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
