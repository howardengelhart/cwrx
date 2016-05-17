var flush = true;
describe('BeeswaxClient', function() {
    var q, util, mockLog, logger, BeeswaxClient, rp, rpErrors, BluebirdPromise, objUtils, mockOps;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        util            = require('util');
        BluebirdPromise = require('bluebird');
        rp              = require('request-promise');
        rpErrors        = require('request-promise/errors');
        BeeswaxClient   = require('../../lib/BeeswaxClient');
        logger          = require('../../lib/logger');
        objUtils        = require('../../lib/objUtils');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        spyOn(rp, 'jar').and.returnValue({ cookies: 'yes' });
        
        mockOps = {
            apiRoot: 'https://stinger.ut.api.beeswax.com',
            creds: { email: 'foo@bar.com', password: 'Password One' }
        };
    });

    describe('initialization', function() {
        var opts, boundFns;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }
        beforeEach(function() {
            opts = {
                apiRoot: 'https://stinger.ut.api.beeswax.com',
                creds: { email: 'foo@bar.com', password: 'Password One' },
                debug: true
            };

            boundFns = [];
            
            ['_find', '_query', '_create', '_edit', '_delete'].forEach(function(method) {
                spyOn(BeeswaxClient.prototype[method], 'bind').and.callFake(function() {
                    var boundFn = Function.prototype.bind.apply(BeeswaxClient.prototype[method], arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: BeeswaxClient.prototype[method],
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });
        });

        it('should correctly initialize', function() {
            var beeswax = new BeeswaxClient(opts);
            expect(beeswax).toEqual(jasmine.any(BeeswaxClient));
            expect(beeswax.apiRoot).toBe('https://stinger.ut.api.beeswax.com');
            expect(beeswax.debug).toBe(true);
            expect(beeswax._creds).toEqual({ email: 'foo@bar.com', password: 'Password One' });
            expect(beeswax._cookieJar).toEqual({ cookies: 'yes' });
            expect(beeswax._authPromise).not.toBeDefined();
        });
        
        it('should have default values for some options', function() {
            var beeswax = new BeeswaxClient({ creds: opts.creds });
            expect(beeswax).toEqual(jasmine.any(BeeswaxClient));
            expect(beeswax.apiRoot).toBe('https://stingersbx.api.beeswax.com');
            expect(beeswax.debug).toBe(false);
            expect(beeswax._creds).toEqual({ email: 'foo@bar.com', password: 'Password One' });
        });
        
        it('should setup objects with bound methods for each supported entity type', function() {
            var beeswax = new BeeswaxClient(opts);
            expect(beeswax.advertisers).toEqual({
                find: getBoundFn(BeeswaxClient.prototype._find, [beeswax, '/rest/advertiser', 'advertiser_id']),
                query: getBoundFn(BeeswaxClient.prototype._query, [beeswax, '/rest/advertiser']),
                create: getBoundFn(BeeswaxClient.prototype._create, [beeswax, '/rest/advertiser', 'advertiser_id']),
                edit: getBoundFn(BeeswaxClient.prototype._edit, [beeswax, '/rest/advertiser', 'advertiser_id']),
                delete: getBoundFn(BeeswaxClient.prototype._delete, [beeswax, '/rest/advertiser', 'advertiser_id']),
            });
            expect(beeswax.campaigns).toEqual({
                find: getBoundFn(BeeswaxClient.prototype._find, [beeswax, '/rest/campaign', 'campaign_id']),
                query: getBoundFn(BeeswaxClient.prototype._query, [beeswax, '/rest/campaign']),
                create: getBoundFn(BeeswaxClient.prototype._create, [beeswax, '/rest/campaign', 'campaign_id']),
                edit: getBoundFn(BeeswaxClient.prototype._edit, [beeswax, '/rest/campaign', 'campaign_id']),
                delete: getBoundFn(BeeswaxClient.prototype._delete, [beeswax, '/rest/campaign', 'campaign_id']),
            });
            expect(beeswax.creatives).toEqual({
                find: getBoundFn(BeeswaxClient.prototype._find, [beeswax, '/rest/creative', 'creative_id']),
                query: getBoundFn(BeeswaxClient.prototype._query, [beeswax, '/rest/creative']),
                create: getBoundFn(BeeswaxClient.prototype._create, [beeswax, '/rest/creative', 'creative_id']),
                edit: getBoundFn(BeeswaxClient.prototype._edit, [beeswax, '/rest/creative', 'creative_id']),
                delete: getBoundFn(BeeswaxClient.prototype._delete, [beeswax, '/rest/creative', 'creative_id']),
            });
        });
        
        it('should fail if an email + password are not passed', function() {
            var msg = 'Must provide creds object with email + password';
            expect(function() { var beeswax = new BeeswaxClient(); }).toThrow(new Error(msg));
            expect(function() { var beeswax = new BeeswaxClient({}); }).toThrow(new Error(msg));
            expect(function() { var beeswax = new BeeswaxClient({ creds: {} }); }).toThrow(new Error(msg));
            expect(function() { var beeswax = new BeeswaxClient({ creds: { email: 'foo@bar.com' } }); }).toThrow(new Error(msg));
            expect(function() { var beeswax = new BeeswaxClient({ creds: { password: 'Password One' } }); }).toThrow(new Error(msg));
        });
    });
    
    describe('authenticate', function() {
        var beeswax, authResp;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            authResp = {
                success: true,
                message: 'you don logged in'
            };
            spyOn(rp, 'post').and.callFake(function() { return q(authResp); });
        });
        
        it('should POST an authenticate request and resolve if it succeeds', function(done) {
            beeswax.authenticate().then(function() {
                expect(rp.post).toHaveBeenCalledWith({
                    url: 'https://stinger.ut.api.beeswax.com/rest/authenticate',
                    body: {
                        email: 'foo@bar.com',
                        password: 'Password One',
                        keep_logged_in: true
                    },
                    json: true,
                    jar: beeswax._cookieJar
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(beeswax._authPromise).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the response succeeds but the success flag is false', function(done) {
            authResp = { success: false, message: 'nah yo password is wrong' };
            beeswax.authenticate().then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error(util.inspect({ success: false, message: 'nah yo password is wrong' })));
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect({ success: false, message: 'nah yo password is wrong' }));
                expect(rp.post).toHaveBeenCalled();
                expect(beeswax._authPromise).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the response fails', function(done) {
            authResp = q.reject({ statusCode: 500, error: 'no can do buddy' });
            beeswax.authenticate().then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual({ statusCode: 500, error: 'no can do buddy' });
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect({ statusCode: 500, error: 'no can do buddy' }));
                expect(rp.post).toHaveBeenCalled();
                expect(beeswax._authPromise).not.toBeDefined();
            }).done(done);
        });
        
        it('should not send duplicate requests if multiple calls are made at once', function(done) {
            var reqDeferred = q.defer();
            authResp = reqDeferred.promise;
            
            var promises = [
                beeswax.authenticate(),
                beeswax.authenticate(),
                beeswax.authenticate()
            ];
            expect(beeswax._authPromise).toBeDefined();
            promises.forEach(function(promise) {
                expect(promise).toBe(beeswax._authPromise);
            });
            
            q.all(promises).then(function(results) {
                expect(rp.post).toHaveBeenCalledWith({
                    url: 'https://stinger.ut.api.beeswax.com/rest/authenticate',
                    body: {
                        email: 'foo@bar.com',
                        password: 'Password One',
                        keep_logged_in: true
                    },
                    json: true,
                    jar: beeswax._cookieJar
                });
                expect(rp.post.calls.count()).toBe(1);
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(beeswax._authPromise).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
            
            process.nextTick(function() {
                reqDeferred.resolve({ success: true, message: 'ok you can come in' });
            });
        });
    });
    
    describe('request', function() {
        var beeswax, opts, resps;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            spyOn(beeswax, 'authenticate').and.returnValue(q());
            opts = {
                url: 'https://stinger.ut.api.beeswax.com/rest/advertiser',
                body: { advertiser_id: 1234 }
            };
            resps = {
                get: q({ success: true, payload: { found: 'yes' } }),
                post: q({ success: true, payload: { created: 'yes' } }),
                put: q({ success: true, payload: { edited: 'yes' } }),
                del: q({ success: true, payload: { deleted: 'yes' } }),
            };
            ['get', 'post', 'put', 'del'].forEach(function(verb) {
                spyOn(rp, verb).and.callFake(function() { return resps[verb]; });
            });
        });
        
        it('should send a request and resolve with the body', function(done) {
            beeswax.request('get', opts).then(function(body) {
                expect(body).toEqual({ success: true, payload: { found: 'yes' } });
                expect(rp.get).toHaveBeenCalledWith({
                    url: 'https://stinger.ut.api.beeswax.com/rest/advertiser',
                    body: { advertiser_id: 1234 },
                    json: true,
                    jar: beeswax._cookieJar
                });
                expect(beeswax.authenticate).not.toHaveBeenCalled();
                expect(rp.get.calls.count()).toBe(1);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle different http verbs', function(done) {
            q.all([
                { method: 'get', url: 'https://sting.bw.com/rest/foo' },
                { method: 'post', url: 'https://sting.bw.com/rest/bar', body: { name: 'doofus' } },
                { method: 'put', url: 'https://sting.bw.com/rest/blah', body: { id: 1234 } },
                { method: 'del', url: 'https://sting.bw.com/rest/bloop', body: { id: 9876 } }
            ].map(function(opts) {
                var verb = opts.method;
                delete opts.method;
                return beeswax.request(verb, opts);
            })).then(function(results) {
                expect(results[0]).toEqual({ success: true, payload: { found: 'yes' } });
                expect(results[1]).toEqual({ success: true, payload: { created: 'yes' } });
                expect(results[2]).toEqual({ success: true, payload: { edited: 'yes' } });
                expect(results[3]).toEqual({ success: true, payload: { deleted: 'yes' } });
                expect(rp.get).toHaveBeenCalledWith({ url: 'https://sting.bw.com/rest/foo', json: true, jar: beeswax._cookieJar });
                expect(rp.post).toHaveBeenCalledWith({ url: 'https://sting.bw.com/rest/bar', body: { name: 'doofus' }, json: true, jar: beeswax._cookieJar });
                expect(rp.put).toHaveBeenCalledWith({ url: 'https://sting.bw.com/rest/blah', body: { id: 1234 }, json: true, jar: beeswax._cookieJar });
                expect(rp.del).toHaveBeenCalledWith({ url: 'https://sting.bw.com/rest/bloop', body: { id: 9876 }, json: true, jar: beeswax._cookieJar });
                expect(beeswax.authenticate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the request returns a 401 response', function(done) {
            beforeEach(function() {
                resps.get = BluebirdPromise.reject(new rpErrors.StatusCodeError(401, 'Unauthenticated', { opts: 'yes' }, 'omg the whole response'));
                beeswax.authenticate.and.callFake(function() {
                    resps.get = q({ success: true, payload: { succeeded: 'this time' } });
                    return q();
                });
            });
            
            it('should authenticate first and then retry the request', function(done) {
                beeswax.request('get', opts).then(function(body) {
                    expect(body).toEqual({ success: true, payload: { succeeded: 'this time' } });
                    expect(rp.get.calls.count()).toBe(2);
                    rp.get.calls.allArgs().forEach(function(args) {
                        expect(args).toEqual([{
                            url: 'https://stinger.ut.api.beeswax.com/rest/advertiser',
                            body: { advertiser_id: 1234 },
                            json: true,
                            jar: beeswax._cookieJar
                        }]);
                    });
                    expect(beeswax.authenticate).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject and not retry if authentication fails', function(done) {
                beeswax.authenticate.and.returnValue(q.reject('CANT AUTHENTICATE HALP'));
                beeswax.request('get', opts).then(function(body) {
                    expect(body).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual('CANT AUTHENTICATE HALP');
                    expect(rp.get.calls.count()).toBe(1);
                    expect(beeswax.authenticate).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        it('should reject if the response succeeds but the success flag is false', function(done) {
            resps.get = q({ success: false, message: 'cant find it brah' });
            beeswax.request('get', opts).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error(util.inspect({ success: false, message: 'cant find it brah' })));
                expect(rp.get).toHaveBeenCalled();
                expect(beeswax.authenticate).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if the response fails', function(done) {
            resps.get = BluebirdPromise.reject(new rpErrors.StatusCodeError(500, 'BIG PROBLEMS', { opts: 'yes' }, 'omg the whole response'));
            beeswax.request('get', opts).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(jasmine.any(rpErrors.StatusCodeError));
                expect(error.statusCode).toBe(500);
                expect(error.message).toMatch(/BIG PROBLEMS/);
                expect(error.error).toBe('BIG PROBLEMS');
                expect(error.response).not.toBeDefined();
                expect(rp.get).toHaveBeenCalled();
                expect(beeswax.authenticate).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('_find', function() {
        var beeswax, reqResp;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            reqResp = {
                success: true,
                payload: [
                    { id: 123, name: 'foo' },
                    { id: 123, name: 'bar' }
                ]
            };
            spyOn(beeswax, 'request').and.callFake(function() { return q(reqResp); });
        });
        
        it('should send a properly formatted get request', function(done) {
            beeswax._find('/rest/campaign', 'campaign_id', 123).then(function(body) {
                expect(body).toEqual({ success: true, payload: { id: 123, name: 'foo' } });
                expect(beeswax.request).toHaveBeenCalledWith('get', {
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign',
                    body: { campaign_id: 123 }
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle an empty payload', function(done) {
            reqResp.payload = [];
            beeswax._find('/rest/campaign', 'campaign_id', 123).then(function(body) {
                expect(body).toEqual({ success: true, payload: undefined });
                expect(beeswax.request).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the request fails', function(done) {
            reqResp = q.reject('I GOT A PROBLEM');
            beeswax._find('/rest/campaign', 'campaign_id', 123).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(beeswax.request).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('_query', function() {
        var beeswax, reqResp;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            reqResp = {
                success: true,
                payload: [
                    { id: 123, name: 'foo' },
                    { id: 123, name: 'bar' }
                ]
            };
            spyOn(beeswax, 'request').and.callFake(function() { return q(reqResp); });
        });
        
        it('should send a properly formatted get request', function(done) {
            beeswax._query('/rest/campaign', { campaign_name: 'foobar' }).then(function(body) {
                expect(body).toEqual({ success: true, payload: [{ id: 123, name: 'foo' }, { id: 123, name: 'bar' }] });
                expect(beeswax.request).toHaveBeenCalledWith('get', {
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign',
                    body: { campaign_name: 'foobar' }
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle an undefined request body', function(done) {
            beeswax._query('/rest/campaign').then(function(body) {
                expect(body).toEqual({ success: true, payload: [{ id: 123, name: 'foo' }, { id: 123, name: 'bar' }] });
                expect(beeswax.request).toHaveBeenCalledWith('get', {
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign',
                    body: {}
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the request fails', function(done) {
            reqResp = q.reject('I GOT A PROBLEM');
            beeswax._query('/rest/campaign', { campaign_name: 'foobar' }).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(beeswax.request).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('_create', function() {
        var beeswax, resps;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            resps = {
                get: q({ success: true, payload: [{ id: 9886, campaign: 'yes' }] }),
                post: q({ success: true, payload: { id: 9886 } })
            };
            ['get', 'post'].forEach(function(verb) {
                spyOn(rp, verb).and.callFake(function() { return resps[verb]; });
            });
            spyOn(beeswax, 'request').and.callThrough();
        });
        
        it('should send a properly formatted post request, and then find the created object', function(done) {
            beeswax._create('/rest/campaign', 'campaign_id', { campaign_name: 'foobar' }).then(function(body) {
                expect(body).toEqual({ success: true, payload: { id: 9886, campaign: 'yes' } });
                expect(beeswax.request).toHaveBeenCalledWith('post', jasmine.objectContaining({
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign/strict',
                    body: { campaign_name: 'foobar' }
                }));
                expect(beeswax.request).toHaveBeenCalledWith('get', jasmine.objectContaining({
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign',
                    body: { campaign_id: 9886 }
                }));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return an unsuccessful response if the body is empty', function(done) {
            q.all([undefined, null, {}, 'asdf'].map(function(reqBody) {
                return beeswax._create('/rest/campaign', 'campaign_id', reqBody);
            })).then(function(results) {
                results.forEach(function(body) {
                    expect(body).toEqual({
                        success: false,
                        code: 400,
                        message: 'Body must be non-empty object'
                    });
                });
                expect(beeswax.request).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the post request fails', function(done) {
            resps.post = BluebirdPromise.reject('I GOT A PROBLEM POSTING');
            beeswax._create('/rest/campaign', 'campaign_id', { campaign_name: 'foobar' }).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM POSTING');
                expect(beeswax.request).toHaveBeenCalledWith('post', jasmine.any(Object));
                expect(beeswax.request.calls.count()).toBe(1);
            }).done(done);
        });

        it('should reject if the get request fails', function(done) {
            resps.get = BluebirdPromise.reject('I GOT A PROBLEM GETTING');
            process.on('unhandledRejection', function() {}); // Bluebird thinks above rejection is unhandled + will log angry error, so handle it

            beeswax._create('/rest/campaign', 'campaign_id', { campaign_name: 'foobar' }).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM GETTING');
                expect(beeswax.request).toHaveBeenCalledWith('post', jasmine.any(Object));
                expect(beeswax.request).toHaveBeenCalledWith('get', jasmine.any(Object));
            }).done(done);
        });
    });
    
    describe('_edit', function() {
        var beeswax, resps;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            resps = {
                get: q({ success: true, payload: [{ id: 9886, campaign: 'yes' }] }),
                put: q({ success: true, payload: [{ id: 9886 }] })
            };
            ['get', 'put'].forEach(function(verb) {
                spyOn(rp, verb).and.callFake(function() { return resps[verb]; });
            });
            spyOn(beeswax, 'request').and.callThrough();
        });
        
        it('should send a properly formatted put request, and then find the edited object', function(done) {
            beeswax._edit('/rest/campaign', 'campaign_id', 9886, { campaign_name: 'foobar' }).then(function(body) {
                expect(body).toEqual({ success: true, payload: { id: 9886, campaign: 'yes' } });
                expect(beeswax.request).toHaveBeenCalledWith('put', jasmine.objectContaining({
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign/strict',
                    body: { campaign_id: 9886, campaign_name: 'foobar' }
                }));
                expect(beeswax.request).toHaveBeenCalledWith('get', jasmine.objectContaining({
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign',
                    body: { campaign_id: 9886 }
                }));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return an unsuccessful response if the body is empty', function(done) {
            q.all([undefined, null, {}, 'asdf'].map(function(reqBody) {
                return beeswax._edit('/rest/campaign', 'campaign_id', 9886, reqBody);
            })).then(function(results) {
                results.forEach(function(body) {
                    expect(body).toEqual({
                        success: false,
                        code: 400,
                        message: 'Body must be non-empty object'
                    });
                });
                expect(beeswax.request).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the item is not found when attempting to PUT', function() {
            var errBody;
            beforeEach(function() {
                errBody = {
                    success: false,
                    payload: [{
                        message: [
                            'you are bad',
                            'and you should feel bad',
                            'Could not load object 9886 to update'
                        ]
                    }]
                };
                resps.put = BluebirdPromise.reject(new rpErrors.StatusCodeError(406, errBody, { opts: 'yes' }, 'omg the whole response'));
            });

            it('should resolve with an unsuccessful response', function(done) {
                beeswax._edit('/rest/campaign', 'campaign_id', 9886, { campaign_name: 'foobar' }).then(function(body) {
                    expect(body).toEqual({ success: false, code: 400, message: 'Not found' });
                    expect(beeswax.request).toHaveBeenCalledWith('put', jasmine.any(Object));
                    expect(beeswax.request.calls.count()).toBe(1);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if the failOnNotFound param is true', function(done) {
                beeswax._edit('/rest/campaign', 'campaign_id', 9886, { campaign_name: 'foobar' }, true).then(function(body) {
                    expect(body).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual(jasmine.any(rpErrors.StatusCodeError));
                    expect(error.statusCode).toBe(406);
                    expect(error.message).toMatch(/Could not load object.*to update/);
                    expect(error.error).toEqual(errBody);
                    expect(error.response).not.toBeDefined();
                    expect(beeswax.request).toHaveBeenCalledWith('put', jasmine.any(Object));
                    expect(beeswax.request.calls.count()).toBe(1);
                }).done(done);
            });
        });
        
        it('should reject if the put request fails', function(done) {
            var errBody = {
                success: false,
                payload: [{
                    message: [
                        'you are bad',
                        'and you should feel bad'
                    ]
                }]
            };
            resps.put = BluebirdPromise.reject(new rpErrors.StatusCodeError(406, errBody, { opts: 'yes' }, 'omg the whole response'));

            beeswax._edit('/rest/campaign', 'campaign_id', 9886, { campaign_name: 'foobar' }).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(jasmine.any(rpErrors.StatusCodeError));
                expect(error.statusCode).toBe(406);
                expect(error.message).toMatch(/you are bad/);
                expect(error.error).toEqual(errBody);
                expect(error.response).not.toBeDefined();
                expect(beeswax.request).toHaveBeenCalledWith('put', jasmine.any(Object));
                expect(beeswax.request.calls.count()).toBe(1);
            }).done(done);
        });

        it('should reject if the get request fails', function(done) {
            resps.get = BluebirdPromise.reject('I GOT A PROBLEM GETTING');
            process.on('unhandledRejection', function() {}); // Bluebird thinks above rejection is unhandled + will log angry error, so handle it

            beeswax._edit('/rest/campaign', 'campaign_id', 9886, { campaign_name: 'foobar' }).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM GETTING');
                expect(beeswax.request).toHaveBeenCalledWith('put', jasmine.any(Object));
                expect(beeswax.request).toHaveBeenCalledWith('get', jasmine.any(Object));
            }).done(done);
        });
    });
    
    describe('_delete', function() {
        var beeswax, resps;
        beforeEach(function() {
            beeswax = new BeeswaxClient(mockOps);
            resps = {
                del: q({ success: true, payload: [{ id: 9886 }] })
            };
            ['del'].forEach(function(verb) {
                spyOn(rp, verb).and.callFake(function() { return resps[verb]; });
            });
            spyOn(beeswax, 'request').and.callThrough();
        });
        
        it('should send a properly formatted delete request, and then find the edited object', function(done) {
            beeswax._delete('/rest/campaign', 'campaign_id', 9886).then(function(body) {
                expect(body).toEqual({ success: true, payload: { id: 9886 } });
                expect(beeswax.request).toHaveBeenCalledWith('del', jasmine.objectContaining({
                    url: 'https://stinger.ut.api.beeswax.com/rest/campaign/strict',
                    body: { campaign_id: 9886 }
                }));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the item is not found when attempting to DELETE', function() {
            var errBody;
            beforeEach(function() {
                errBody = {
                    success: false,
                    payload: [{
                        message: [
                            'you are bad',
                            'and you should feel bad',
                            'Could not load object 9886 to delete'
                        ]
                    }]
                };
                resps.del = BluebirdPromise.reject(new rpErrors.StatusCodeError(406, errBody, { opts: 'yes' }, 'omg the whole response'));
            });

            it('should resolve with an unsuccessful response', function(done) {
                beeswax._delete('/rest/campaign', 'campaign_id', 9886).then(function(body) {
                    expect(body).toEqual({ success: false, code: 400, message: 'Not found' });
                    expect(beeswax.request).toHaveBeenCalledWith('del', jasmine.any(Object));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if the failOnNotFound param is true', function(done) {
                beeswax._delete('/rest/campaign', 'campaign_id', 9886, true).then(function(body) {
                    expect(body).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual(jasmine.any(rpErrors.StatusCodeError));
                    expect(error.statusCode).toBe(406);
                    expect(error.message).toMatch(/Could not load object.*to delete/);
                    expect(error.error).toEqual(errBody);
                    expect(error.response).not.toBeDefined();
                    expect(beeswax.request).toHaveBeenCalledWith('del', jasmine.any(Object));
                }).done(done);
            });
        });
        
        it('should reject if the delete request fails', function(done) {
            var errBody = {
                success: false,
                payload: [{
                    message: [
                        'you are bad',
                        'and you should feel bad'
                    ]
                }]
            };
            resps.del = BluebirdPromise.reject(new rpErrors.StatusCodeError(406, errBody, { opts: 'yes' }, 'omg the whole response'));

            beeswax._delete('/rest/campaign', 'campaign_id', 9886).then(function(body) {
                expect(body).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(jasmine.any(rpErrors.StatusCodeError));
                expect(error.statusCode).toBe(406);
                expect(error.message).toMatch(/you are bad/);
                expect(error.error).toEqual(errBody);
                expect(error.response).not.toBeDefined();
                expect(beeswax.request).toHaveBeenCalledWith('del', jasmine.any(Object));
            }).done(done);
        });
    });
});
