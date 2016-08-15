var flush = true;
describe('proxySvc (UT)', function() {
    var search, mockLog, mockLogger, req, q, logger, requestUtils, anyFunc;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        requestUtils    = require('../../lib/requestUtils');
        proxySvc        = require('../../bin/proxySvc').proxySvc;
        state           = require('../../bin/proxySvc').state;

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        req = {
            uuid: '1234',
            user: { id: 'u1' }
        };
        anyFunc = jasmine.any(Function);
    });

    describe('getHost', function() {
        it('should get the api hostnames for each service', function() {
            expect(proxySvc.getHost(null, 'facebook')).toBe('https://graph.facebook.com');
            expect(proxySvc.getHost(null, 'twitter')).toBe('https://api.twitter.com');
        });

        it('should throw an error if passed an unrecognized service', function() {
            var error;
            try {
                proxySvc.getHost(null, 'foo');
            } catch(err) {
                error = err;
            }
            expect(error.message).toBe('Tried to get host for unrecognized service "foo"');
        });
    });

    describe('getAuthOptions', function() {
        var creds;
        beforeEach(function() {
            creds = {
                facebookCredentials: {
                    appId: 'app_id',
                    appSecret: 'app_secret'
                },
                twitterCredentials: {
                    appId: 'app_id',
                    appSecret: 'app_secret'
                }
            };
        });

        describe('for Facebook', function() {
            it('should set the access_token query param', function(done) {
                proxySvc.getAuthOptions(null, 'facebook', creds).then(function(result) {
                    expect(result).toEqual({
                        qs: {
                            access_token: 'app_id|app_secret'
                        }
                    });
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('for Twitter', function() {
            beforeEach(function() {
                spyOn(requestUtils, 'qRequest').andReturn(q({
                    body: {
                        token_type: 'bearer',
                        access_token: 'Token1'
                    }
                }));
            });

            it('should fetch the bearer token', function(done) {
                proxySvc.getAuthOptions(null, 'twitter', creds).then(function(result) {
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'https://api.twitter.com/oauth2/token',
                        headers: {
                            'Authorization': 'Basic YXBwX2lkOmFwcF9zZWNyZXQ=', // base 64 encoding of app_id:app_secret
                            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                        },
                        body: 'grant_type=client_credentials'
                    });
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });

            it('should reject the promise if Twitter does not return a bearer token', function(done) {
                requestUtils.qRequest.andReturn(q({
                    body: {
                        token_type: 'foo',
                        access_token: 'bar'
                    }
                }));
                proxySvc.getAuthOptions(null, 'twitter', creds).then(function(result) {
                    expect(result).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.error).toBe('Twitter authentication failed');
                    expect(error.detail).toBe('Twitter token "foo" is not the required bearer token.');
                }).finally(done);
            });

            it('should reject the promise and log a warning if the request to authorize with Twitter fails', function(done) {
                requestUtils.qRequest.andReturn(q.reject());
                proxySvc.getAuthOptions(null, 'twitter', creds).then(function(result) {
                    expect(result).not.toBeDefined();
                }).catch(function(error) {
                    expect(error.error).toBe('Twitter authentication failed');
                }).finally(done);
            });

            it('should set the authorization header', function(done) {
                proxySvc.getAuthOptions(null, 'twitter', creds).then(function(result) {
                    expect(result).toEqual({
                        headers: {
                            'Authorization': 'Bearer Token1'
                        }
                    });
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('for an unknown service', function() {
            it('should reject the promise', function(done) {
                proxySvc.getAuthOptions(null, 'foo', creds).then(function(result) {
                    expect(result).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Tried to get auth options for unrecognized service "foo"');
                }).finally(done);
            });
        });
    });

    describe('proxy(service, req)', function() {
        var whitelists;
        beforeEach(function() {
            whitelists = {
                facebook: {
                    endpoints: [
                        '/v2\\.4/valid/endpoint',
                        '/v2\\.4/another/valid/endpoint',
                        '/v2\\.4/anything/.+'
                    ],
                    params: [
                        'trustedParam1',
                        'trustedParam2'
                    ]
                }
            };
            spyOn(requestUtils, 'qRequest').andReturn(q({
                response: {
                    statusCode: 200
                },
                body: 'some body'
            }));
            spyOn(proxySvc, 'getAuthOptions').andReturn(q({
            }));
        });

        it('should handle not being passed query parameters and log some info', function(done) {
            proxySvc.proxy('facebook', { }).then(function(result) {
                expect(result).toEqual({
                    code: 400,
                    body: 'You must specify an endpoint as a query parameter.'
                });
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should handle not being passed an endpoint as a query parameter and log some info', function(done) {
            proxySvc.proxy('facebook', { query: { } }).then(function(result) {
                expect(result).toEqual({
                    code: 400,
                    body: 'You must specify an endpoint as a query parameter.'
                });
                expect(requestUtils.qRequest).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should deny endpoints not on the whitelist', function(done) {
            q.all(['clearly_invalid', '/v2.4/still/invalid', '123'].map(function(endpoint) {
                return proxySvc.proxy({ query: { endpoint: endpoint }}, 'facebook', null, whitelists);
            })).then(function(results) {
                results.forEach(function(result) {
                    expect(result).toEqual({
                        code: 403,
                        body: 'The specified endpoint is invalid.'
                    });
                });
            }).catch(function(errors) {
                expect(errors).not.toBeDefined();
            }).finally(done);
        });

        it('should get auth options', function(done) {
            proxySvc.proxy({ query: { endpoint: '/v2.4/valid/endpoint' }, uuid: 'foo' }, 'facebook', 'credsObj', whitelists).then(function(result) {
                expect(proxySvc.getAuthOptions).toHaveBeenCalledWith('foo', 'facebook', 'credsObj');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('reject the promise on a failure to get auth options', function(done) {
            proxySvc.getAuthOptions.andReturn(q.reject('error message'));
            proxySvc.proxy({ query: { endpoint: '/v2.4/valid/endpoint' } }, 'facebook', null, whitelists).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error message');
            }).finally(done);
        });

        it('should only copy whitelisted query params to the proxied request', function(done) {
            var request = {
                query: {
                    endpoint: '/v2.4/valid/endpoint',
                    trustedParam1: 'hello',
                    trustedParam2: 'world',
                    untrustedParam1: 'goodbye',
                    untrustedParam2: 'galaxy'
                }
            };
            proxySvc.proxy(request, 'facebook', null, whitelists).then(function(result) {
                expect(requestUtils.qRequest).toHaveBeenCalledWith('get', {
                    url: 'https://graph.facebook.com/v2.4/valid/endpoint',
                    qs: {
                        trustedParam1: 'hello',
                        trustedParam2: 'world'
                    }
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should proxy valid requests', function(done) {
            q.all(['/v2.4/valid/endpoint', '/v2.4/another/valid/endpoint', '/v2.4/anything/abc'].map(function(endpoint) {
                return proxySvc.proxy({ query: { endpoint: endpoint }}, 'facebook', null, whitelists);
            })).then(function(results) {
                expect(requestUtils.qRequest.calls.length).toBe(3);
                results.forEach(function(result) {
                    expect(result).toEqual({
                        code: 200,
                        body: 'some body'
                    });
                });
            }).catch(function(errors) {
                expect(errors).not.toBeDefined();
            }).finally(done);
        });

        it('reject the promise on a failure to proxy the request', function(done) {
            requestUtils.qRequest.andReturn(q.reject('error message'));
            proxySvc.proxy({ query: { endpoint: '/v2.4/valid/endpoint' } }, 'facebook', null, whitelists).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('error message');
            }).finally(done);
        });
    });
});
