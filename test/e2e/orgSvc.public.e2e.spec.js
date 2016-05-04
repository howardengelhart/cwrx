var q               = require('q'),
    util            = require('util'),
    urlUtils        = require('url'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        promUrl : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api'
    };

describe('orgSvc public endpoints (E2E):', function() {
    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;
    });

    describe('GET /api/public/promotions/:id', function() {
        var mockPromotions, options;
        beforeEach(function(done) {
            mockPromotions = [
                {
	                id: 'e2e-pro-1',
	                status: 'active',
	                name: 'Generic $50 signup credit',
	                type: 'signupReward',
	                data: {
	                    signupReward: 50
	                }
                },
                {
	                id: 'e2e-pro-2',
	                status: 'active',
	                name: 'Dummy for backfilling',
	                type: 'dummy',
	                data: {
	                    rewardAmount: 12345
	                }
                },
                {
	                id: 'e2e-pro-inactive',
	                status: 'inactive',
	                name: 'Bad signup credit',
	                type: 'signupReward',
	                data: {
	                    signupReward: 666
	                }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                name: 'Old signup credit',
	                type: 'signupReward',
	                data: {
	                    signupReward: 99999
	                }
                }
            ];
            options = {
                url: config.promUrl + '/public/promotions/e2e-pro-1',
                qs: {}
            };
            testUtils.resetCollection('promotions', mockPromotions).done(done);
        });
        
        it('should get a promotion by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
	                id: 'e2e-pro-1',
	                status: 'active',
	                name: 'Generic $50 signup credit',
	                type: 'signupReward',
	                data: {
	                    signupReward: 50
	                }
                });
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not set cache-control if the request is in preview mode', function(done) {
            options.qs.preview = 'true';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
	                id: 'e2e-pro-1',
	                status: 'active',
	                name: 'Generic $50 signup credit',
	                type: 'signupReward',
	                data: {
	                    signupReward: 50
	                }
                });
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                expect(resp.response.headers['cache-control']).toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the promotion is not active', function(done) {
            q.all(['e2e-pro-inactive', 'e2e-pro-deleted'].map(function(id) {
                options.url = config.promUrl + '/public/promotions/' + id;
                return requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Promotion not found');
                    expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the promotion does not exist', function(done) {
            options.url = config.promUrl + '/public/promotions/LSDKJFOWIE';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Promotion not found');
                expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the url extension is .js', function() {
            it('should return the promotion as a CommonJS module if the extension is .js', function(done) {
                options.url = config.promUrl + '/public/promotions/e2e-pro-2.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBe('module.exports = {"id":"e2e-pro-2","status":"active","name":"Dummy for backfilling","type":"dummy","data":{"rewardAmount":12345}};');
                    expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return errors in normal format', function(done) {
                options.url = config.promUrl + '/public/promotions/LSDKJFOWIE.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Promotion not found');
                    expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if the url extension is .json', function() {
            it('should return the promotion as JSON normally', function(done) {
                options.url = config.promUrl + '/public/promotions/e2e-pro-2.json';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
	                    id: 'e2e-pro-2',
	                    status: 'active',
	                    name: 'Dummy for backfilling',
	                    type: 'dummy',
	                    data: {
	                        rewardAmount: 12345
	                    }
                    });
                    expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
