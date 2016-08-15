var q               = require('q'),
    fs              = require('fs-extra'),
    path            = require('path'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    request         = require('request'),
    host            = process.env['host'] || 'localhost',
    bucket          = process.env.bucket || 'c6.dev',
    config = {
        proxyUrl    : 'http://' + (host === 'localhost' ? host + ':3100' : host) + '/api/proxy',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('proxySvc (E2E):', function() {
    var cookieJar, mockUser;
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'proxye2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {}
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: { email: 'proxye2euser', password: 'password' }
        };
        testUtils.resetCollection('users', mockUser).then(function() {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/proxy/facebook', function() {
        var postId, options;
        beforeEach(function() {
            postId = '952156911530863_952157468197474';
            options = {
                url: config.proxyUrl + '/facebook',
                jar: cookieJar,
                qs: { }
            };
        });

        describe('proxying the /v2.4/{post-id} endpoint', function() {
            it('should return information about the post', function(done) {
                options.qs.endpoint = '/v2.4/' + postId;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(new Date(resp.body.created_time) < new Date()).toBe(true);
                    expect(resp.body.message).toBe('Johnny Testmonkey reporting for duty!');
                    expect(resp.body.id).toBe(postId);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('proxying the /v2.4/{object-id}/likes endpoint', function() {
            it('should return information about likes', function(done) {
                options.qs.endpoint = '/v2.4/' + postId + '/likes';
                options.qs.summary = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.summary.total_count).toBe(1);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('proxying the /v2.4/{object-id}/comments endpoint', function() {
            it('should return information about comments', function(done) {
                options.qs.endpoint = '/v2.4/' + postId + '/comments';
                options.qs.summary = true;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.summary.total_count).toBe(0);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('proxying the /v2.4/{object-id}/sharedposts endpoint', function() {
            it('should return information about shares', function(done) {
                options.qs.endpoint = '/v2.4/' + postId + '/comments';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.data.length).toBe(0);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('specifying an endpoint that is not whitelisted', function() {
            it('should 403', function(done) {
                options.qs.endpoint = '/THIS/ENDPOINT/IS/MOST/CERTAITLY/NOT/WHITELISTED';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('The specified endpoint is invalid.');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('when not specifying an endpoint', function() {
            it('should 400', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('You must specify an endpoint as a query parameter.');
                }).catch(function(error) {
                    expect(error.code).not.toBeDefined();
                }).finally(done);
            });
        });
    });

    describe('GET /api/proxy/twitter', function() {
        var postId, options;
        beforeEach(function() {
            postId = '638365747681599488';
            options = {
                url: config.proxyUrl + '/twitter',
                jar: cookieJar,
                qs: { }
            };
        });

        describe('proxying the statuses/show/:id endpoint', function() {
            it('should return information about the post', function(done) {
                options.qs.endpoint = '/1.1/statuses/show.json';
                options.qs.id = postId;
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toBeDefined();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('specifying an endpoint that is not whitelisted', function() {
            it('should 403', function(done) {
                options.qs.endpoint = '/THIS/ENDPOINT/IS/MOST/CERTAITLY/NOT/WHITELISTED';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(403);
                    expect(resp.body).toBe('The specified endpoint is invalid.');
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('when not specifying an endpoint', function() {
            it('should 400', function(done) {
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('You must specify an endpoint as a query parameter.');
                }).catch(function(error) {
                    expect(error.code).not.toBeDefined();
                }).finally(done);
            });
        });
    });
});

describe('test cleanup', function() {
    it('should close db connections', function(done) {
        testUtils.closeDbs().done(done);
    });
});
