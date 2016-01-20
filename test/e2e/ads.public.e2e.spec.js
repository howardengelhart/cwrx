var q               = require('q'),
    util            = require('util'),
    urlUtils        = require('url'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api'
    };

describe('ads public endpoints (E2E):', function() {
    beforeEach(function() {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 5000;
    });

    describe('GET /api/public/placements/:id', function() {
        var mockPlacements, options;
        beforeEach(function(done) {
            mockPlacements = [
                {
	                id: 'e2e-pl-1',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                tagType: 'mraid',
	                label: 'foo bar',
	                data: { container: 'box-1', campaign: 'cam-1', branding: 'brandA' }
                },
                {
	                id: 'e2e-pl-2',
	                status: 'active',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                budget: { daily: 100, total: 1000 },
	                externalCost: { event: 'click', cost: 0.123 },
	                costHistory: [{
	                    userId: 'u-other',
	                    user: 'otheruser',
	                    date: new Date('2016-01-20T15:43:02.370Z'),
	                    externalCost: { event: 'click', cost: 0.123 }
	                }],
	                data: { container: 'box-2', campaign: 'cam-2', branding: 'brandB' }
                },
                {
	                id: 'e2e-pl-inactive',
	                status: 'inactive',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                data: { container: 'box-2', campaign: 'cam-2', branding: 'brandC' }
                },
                {
	                id: 'e2e-deleted',
	                status: 'deleted',
	                user: 'u-selfie',
	                org: 'o-selfie',
	                data: { container: 'box-gone', campaign: 'cam-gone' }
                }
            ];
            options = {
                url: config.adsUrl + '/public/placements/e2e-pl-1',
                qs: {}
            };
            testUtils.resetCollection('placements', mockPlacements).done(done);
        });
        
        it('should get a placement by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-pl-1',
                    status: 'active',
                    tagType: 'mraid',
                    label: 'foo bar',
                    data: { container: 'box-1', campaign: 'cam-1', branding: 'brandA' }
                });
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should hide cost and budget information', function(done) {
            options.url = config.adsUrl + '/public/placements/e2e-pl-2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e2e-pl-2',
                    status: 'active',
                    data: { container: 'box-2', campaign: 'cam-2', branding: 'brandB' }
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
                    id: 'e2e-pl-1',
                    status: 'active',
                    tagType: 'mraid',
                    label: 'foo bar',
                    data: { container: 'box-1', campaign: 'cam-1', branding: 'brandA' }
                });
                expect(resp.response.headers['content-type']).toBe('application/json; charset=utf-8');
                expect(resp.response.headers['cache-control']).toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the placement is not active', function(done) {
            q.all(['e2e-pl-inactive', 'e2e-pl-deleted'].map(function(id) {
                options.url = config.adsUrl + '/public/placements/' + id;
                return requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Placement not found');
                    expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                });
            })).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the placement does not exist', function(done) {
            options.url = config.adsUrl + '/public/placements/LSDKJFOWIE';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Placement not found');
                expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the url extension is .js', function() {
            it('should return the placement as a CommonJS module if the extension is .js', function(done) {
                options.url = config.adsUrl + '/public/placements/e2e-pl-2.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBe('module.exports = {"id":"e2e-pl-2","status":"active","data":{"container":"box-2","campaign":"cam-2","branding":"brandB"}};');
                    expect(resp.response.headers['content-type']).toBe('application/javascript; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should return errors in normal format', function(done) {
                options.url = config.adsUrl + '/public/placements/LSDKJFOWIE.js';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(404);
                    expect(resp.body).toBe('Placement not found');
                    expect(resp.response.headers['content-type']).toBe('text/html; charset=utf-8');
                    expect(resp.response.headers['cache-control']).toEqual(jasmine.any(String));
                    expect(resp.response.headers['cache-control']).not.toBe('max-age=0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if the url extension is .json', function() {
            it('should return the placement as JSON normally', function(done) {
                options.url = config.adsUrl + '/public/placements/e2e-pl-2.json';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e2e-pl-2',
                        status: 'active',
                        data: { container: 'box-2', campaign: 'cam-2', branding: 'brandB' }
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
