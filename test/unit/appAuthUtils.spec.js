var flush = true;
describe('appAuthUtils', function() {
    var q, mockLog, logger, appAuthUtils, crypto, mongoUtils, requestUtils, Status, uuid, req, nextSpy;
    
    beforeEach(function() {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(1453929767464));

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        crypto          = require('crypto');
        appAuthUtils    = require('../../lib/appAuthUtils');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        Status          = require('../../lib/enums').Status;
        mongoUtils      = require('../../lib/mongoUtils');
        requestUtils    = require('../../lib/requestUtils');
        
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
        
        req = {
            uuid: '1234',
            query: {},
            headers: {}
        };
        nextSpy = jasmine.createSpy('next');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('formatEndpoint', function() {
        it('should return an endpoint string', function() {
            expect(appAuthUtils.formatEndpoint('get', '/api/campaign/cam-1234')).toEqual('GET /api/campaign/cam-1234');
            expect(appAuthUtils.formatEndpoint('GET', 'http://staging.cinema6.com/api/campaign/cam-1234')).toEqual('GET /api/campaign/cam-1234');
            expect(appAuthUtils.formatEndpoint('POST', 'https://platform.reelcontent.com/api/content/experience/')).toEqual('POST /api/content/experience/');
        });
        
        it('should handle query strings correctly', function() {
            expect(appAuthUtils.formatEndpoint('GET', '/api/campaigns/cam-1234?decorated=true')).toEqual('GET /api/campaigns/cam-1234');
            expect(appAuthUtils.formatEndpoint('GET', 'http://staging.cinema6.com/api/campaigns/?foo=bar&blah=bloop')).toEqual('GET /api/campaigns/');
            expect(appAuthUtils.formatEndpoint('PUT', '/api/campaigns/cam-1234?decorated=true')).toEqual('PUT /api/campaigns/cam-1234');
        });
    });
    
    describe('signData', function() {
        var mockHmac, data, hmacAlg, secret;
        beforeEach(function() {
            mockHmac = {
                _value: '',
                update: jasmine.createSpy('hmac.update()').and.callFake(function(text) {
                    mockHmac._value += text.length + ':'
                }),
                digest: jasmine.createSpy('hmac.digest()').and.callFake(function() { return mockHmac._value; })
            };
            spyOn(crypto, 'createHmac').and.callFake(function(alg, secret) {
                mockHmac._value += alg + ':' + secret + ':';
                return mockHmac;
            });
            hmacAlg = 'RSA-SHAwesome';
            secret = 'supersecret';
        });
        
        describe('if the data is a string', function() {
            it('should return an HMAC digest of the string + secret', function() {
                data = 'This is some data';
                expect(appAuthUtils.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:17:');
                expect(crypto.createHmac).toHaveBeenCalledWith('RSA-SHAwesome', 'supersecret');
                expect(mockHmac.update).toHaveBeenCalledWith('This is some data');
                expect(mockHmac.digest).toHaveBeenCalledWith('hex');
            });
        });
        
        describe('if the data is an object', function() {
            it('should sort and stringify the object before calculating the HMAC', function() {
                data = {
                    foo: 'bar',
                    a: 1,
                    guh: [1, 3, 2],
                    d: new Date('Wed Jan 27 2016 15:50:21 GMT-0500 (EST)')
                };
                
                expect(appAuthUtils.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:64:');
                expect(crypto.createHmac).toHaveBeenCalledWith('RSA-SHAwesome', 'supersecret');
                expect(mockHmac.update).toHaveBeenCalledWith('{"a":1,"d":"2016-01-27T20:50:21.000Z","foo":"bar","guh":[1,3,2]}');
                expect(mockHmac.digest).toHaveBeenCalledWith('hex');
            });
            
            it('should handle nested objects', function() {
                data = {
                    foo: 'bar',
                    z: 1,
                    nest: {
                        foo: 'yes',
                        bar: 'no',
                        deeper: {
                            movie: 'indeed',
                            inception: 'very'
                        }
                    }
                };
                
                expect(appAuthUtils.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:98:');
                expect(crypto.createHmac).toHaveBeenCalledWith('RSA-SHAwesome', 'supersecret');
                expect(mockHmac.update).toHaveBeenCalledWith('{"foo":"bar","nest":{"bar":"no","deeper":{"inception":"very","movie":"indeed"},"foo":"yes"},"z":1}');
                expect(mockHmac.digest).toHaveBeenCalledWith('hex');
            });
        });
    });
    
    describe('Authenticator', function() {
        var creds;
        beforeEach(function() {
            creds = { key: 'ads-service', secret: 'ipoopmypants' };
        });

        describe('initialization', function() {
            it('should save the creds and other values internally', function() {
                var authenticator = new appAuthUtils.Authenticator(creds);
                expect(authenticator._creds).toEqual({ key: 'ads-service', secret: 'ipoopmypants' });
                expect(authenticator.appKey).toBe('ads-service');
                expect(authenticator.hmacAlgorithm).toBe('RSA-SHA256');
            });
            
            it('should throw an error if the creds object is incomplete', function() {
                [null, {}, { key: 'foo' }, { secret: 'bar' }].forEach(function(obj) {
                    expect(function() { var a = new appAuthUtils.Authenticator(obj); }).toThrow(new Error('Must provide creds object with key + secret'));
                });
            });
        });
    
        describe('setHeaders', function() {
            var authenticator, reqOpts;
            beforeEach(function() {
                authenticator = new appAuthUtils.Authenticator(creds);
                spyOn(uuid, 'hashText').and.returnValue('hashbrowns');
                spyOn(uuid, 'createUuid').and.returnValue('uuuuuuuuuuuuuuuuuuid');
                spyOn(appAuthUtils, 'signData').and.returnValue('johnhancock');
                reqOpts = {
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                };
            });
            
            it('should set auth headers on the request opts', function() {
                authenticator.setHeaders('get', reqOpts);
                expect(reqOpts).toEqual({
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                    headers: {
                        'x-rc-auth-app-key'     : 'ads-service',
                        'x-rc-auth-timestamp'   : 1453929767464,
                        'x-rc-auth-nonce'       : 'uuuuuuuuuuuuuuuuuuid',
                        'x-rc-auth-signature'   : 'johnhancock'
                    }
                });
                expect(uuid.hashText).toHaveBeenCalledWith('{}');
                expect(appAuthUtils.signData).toHaveBeenCalledWith({
                    appKey      : 'ads-service',
                    bodyHash    : 'hashbrowns',
                    endpoint    : 'GET /api/campaigns/cam-1234',
                    nonce       : 'uuuuuuuuuuuuuuuuuuid',
                    qs          : null,
                    timestamp   : 1453929767464
                }, 'RSA-SHA256', 'ipoopmypants');
            });
            
            it('should not overwrite any existing headers', function() {
                reqOpts.headers = {
                    'x-gone-give-it-to-ya'      : 'yeaaaaah',
                    cookie                      : 'chocolate'
                };
                authenticator.setHeaders('get', reqOpts);

                expect(reqOpts).toEqual({
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                    headers: {
                        'x-rc-auth-app-key'     : 'ads-service',
                        'x-rc-auth-timestamp'   : 1453929767464,
                        'x-rc-auth-nonce'       : 'uuuuuuuuuuuuuuuuuuid',
                        'x-rc-auth-signature'   : 'johnhancock',
                        'x-gone-give-it-to-ya'  : 'yeaaaaah',
                        cookie                  : 'chocolate'
                    }
                });
            });
            
            describe('when handling the query string', function() {
                it('should be able to use the qs property in the reqOpts', function() {
                    reqOpts.qs = { decorated: true, a: 1, foo: 'bar' };
                    authenticator.setHeaders('get', reqOpts);

                    expect(reqOpts).toEqual({
                        url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                        qs: { decorated: true, a: 1, foo: 'bar' },
                        headers: jasmine.objectContaining({
                            'x-rc-auth-signature'   : 'johnhancock'
                        })
                    });
                    expect(appAuthUtils.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                        endpoint    : 'GET /api/campaigns/cam-1234',
                        qs          : 'decorated=true&a=1&foo=bar',
                    }), 'RSA-SHA256', 'ipoopmypants');
                });
                
                it('should be able to use the query string in the url', function() {
                    reqOpts.url = 'http://localhost:9000/api/account/user?decorated=false&orgs=o-1,o-2,o-3&status=active';
                    authenticator.setHeaders('PoSt', reqOpts);

                    expect(reqOpts).toEqual({
                        url: 'http://localhost:9000/api/account/user?decorated=false&orgs=o-1,o-2,o-3&status=active',
                        headers: jasmine.objectContaining({
                            'x-rc-auth-signature'   : 'johnhancock'
                        })
                    });
                    expect(appAuthUtils.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                        endpoint    : 'POST /api/account/user',
                        qs          : 'decorated=false&orgs=o-1,o-2,o-3&status=active',
                    }), 'RSA-SHA256', 'ipoopmypants');
                });
            });

            describe('when handling the body', function() {
                it('should just hash the body if it is a string', function() {
                    reqOpts.body = 'dis body is hot';
                    authenticator.setHeaders('get', reqOpts);

                    expect(reqOpts.body).toEqual('dis body is hot');
                    expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                    expect(uuid.hashText).toHaveBeenCalledWith('dis body is hot');
                });
                
                it('should stringify and hash the body if it is an object', function() {
                    reqOpts.body = { foo: 'bar', num: 123, nest: { birds: 'yes' }, arr: [1,3] };
                    authenticator.setHeaders('get', reqOpts);

                    expect(reqOpts.body).toEqual({ foo: 'bar', num: 123, nest: { birds: 'yes' }, arr: [1,3] });
                    expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                    expect(uuid.hashText).toHaveBeenCalledWith('{"foo":"bar","num":123,"nest":{"birds":"yes"},"arr":[1,3]}');
                });
                
                it('should be able to take the body from the json prop', function() {
                    reqOpts.json = { foo: 'bar' };
                    authenticator.setHeaders('get', reqOpts);

                    expect(reqOpts.json).toEqual({ foo: 'bar' });
                    expect(reqOpts.body).not.toBeDefined();
                    expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                    expect(uuid.hashText).toHaveBeenCalledWith('{"foo":"bar"}');
                });
                
                it('should ignore the json prop if it is not an object', function() {
                    reqOpts.json = true;
                    authenticator.setHeaders('get', reqOpts);

                    expect(reqOpts.json).toEqual(true);
                    expect(reqOpts.body).not.toBeDefined();
                    expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                    expect(uuid.hashText).toHaveBeenCalledWith('{}');
                });
            });
        });
        
        describe('request', function() {
            var authenticator, opts, files, jobPolling;
            beforeEach(function() {
                authenticator = new appAuthUtils.Authenticator(creds);
                spyOn(authenticator, 'setHeaders').and.callThrough();
                spyOn(uuid, 'hashText').and.returnValue('hashbrowns');
                spyOn(uuid, 'createUuid').and.returnValue('uuuuuuuuuuuuuuuuuuid');
                spyOn(appAuthUtils, 'signData').and.returnValue('johnhancock');
                spyOn(requestUtils, 'qRequest').and.returnValue(q({
                    response: { statusCode: 200 },
                    body: 'marvelous authentication, good sir. 10/10'
                }));
                opts = {
                    url: 'http://staging.cinema6.com/api/campaigns'
                };
                files = 'manyFiles';
                jobPolling = 'pollDemJobs';
            });
            
            it('should call setHeaders and then send the request', function(done) {
                authenticator.request('post', opts, files, jobPolling).then(function(resp) {
                    expect(resp).toEqual({
                        response: { statusCode: 200 },
                        body: 'marvelous authentication, good sir. 10/10'
                    });
                    expect(authenticator.setHeaders).toHaveBeenCalledWith('post', opts);
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'http://staging.cinema6.com/api/campaigns',
                        headers: {
                            'x-rc-auth-app-key'     : 'ads-service',
                            'x-rc-auth-timestamp'   : 1453929767464,
                            'x-rc-auth-nonce'       : 'uuuuuuuuuuuuuuuuuuid',
                            'x-rc-auth-signature'   : 'johnhancock'
                        }
                    }, files, jobPolling);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not overwrite existing headers', function(done) {
                opts.headers = {
                    'x-gone-give-it-to-ya'      : 'yeaaaaah',
                    cookie                      : 'chocolate'
                };
                authenticator.request('post', opts, files, jobPolling).then(function(resp) {
                    expect(resp).toEqual({
                        response: { statusCode: 200 },
                        body: 'marvelous authentication, good sir. 10/10'
                    });
                    expect(authenticator.setHeaders).toHaveBeenCalledWith('post', opts);
                    expect(requestUtils.qRequest).toHaveBeenCalledWith('post', {
                        url: 'http://staging.cinema6.com/api/campaigns',
                        headers: {
                            'x-rc-auth-app-key'     : 'ads-service',
                            'x-rc-auth-timestamp'   : 1453929767464,
                            'x-rc-auth-nonce'       : 'uuuuuuuuuuuuuuuuuuid',
                            'x-rc-auth-signature'   : 'johnhancock',
                            'x-gone-give-it-to-ya'  : 'yeaaaaah',
                            cookie                  : 'chocolate'
                        }
                    }, files, jobPolling);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should pass along request errors', function(done) {
                requestUtils.qRequest.and.returnValue(q.reject('honey, you got a big storm coming'));
                authenticator.request('post', opts, files, jobPolling).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual('honey, you got a big storm coming');
                    expect(authenticator.setHeaders).toHaveBeenCalled();
                    expect(requestUtils.qRequest).toHaveBeenCalled();
                }).done(done);
            });
        });
    });
    
    describe('Verifier', function() {
        var mockDb;
        beforeEach(function() {
            mockDb = {
                collection: jasmine.createSpy('db.collection()').and.callFake(function(collName) {
                    return { collectionName: collName };
                })
            };
        });
    
        describe('initialization', function() {
            it('should save the db and other variables internally', function() {
                var verifier = new appAuthUtils.Verifier(mockDb, 8000);
                expect(verifier.db).toBe(mockDb);
                expect(verifier.hmacAlgorithm).toBe('RSA-SHA256');
                expect(verifier.tsGracePeriod).toBe(8000);
            });
            
            it('should have a default for the tsGracePeriod', function() {
                var verifier = new appAuthUtils.Verifier(mockDb);
                expect(verifier.tsGracePeriod).toBe(5000);
            });
        });
        
        describe('_fetchApplication', function() {
            var verifier;
            beforeEach(function() {
                verifier = new appAuthUtils.Verifier(mockDb);
                spyOn(mongoUtils, 'findObject').and.returnValue(q({
                    id: 'app-1',
                    key: 'ads-service',
                    secret: 'supersecret'
                }));
            });
            
            it('should fetch and return the application', function(done) {
                verifier._fetchApplication('ads-service', req).then(function(resp) {
                    expect(resp).toEqual({
                        id: 'app-1',
                        key: 'ads-service',
                        secret: 'supersecret'
                    });
                    expect(mockDb.collection).toHaveBeenCalledWith('applications');
                    expect(mongoUtils.findObject).toHaveBeenCalledWith(
                        { collectionName: 'applications' },
                        { key: 'ads-service', status: 'active' }
                    );
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should return nothing if the application is not found', function(done) {
                mongoUtils.findObject.and.returnValue(q());
                verifier._fetchApplication('ads-service', req).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    expect(mockDb.collection).toHaveBeenCalledWith('applications');
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should log and return errors', function(done) {
                mongoUtils.findObject.and.returnValue(q.reject('honey, you got a big storm coming'));
                verifier._fetchApplication('ads-service', req).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Db error');
                    expect(mockDb.collection).toHaveBeenCalledWith('applications');
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                }).done(done);
            });
        });
        
        describe('middlewarify', function() {
            var verifier;
            beforeEach(function() {
                verifier = new appAuthUtils.Verifier(mockDb, 5000);
            });
            
            it('should return a function', function() {
                expect(verifier.middlewarify()).toEqual(jasmine.any(Function));
            });
            
            describe('returns a function which', function() {
                var midWare, res;
                beforeEach(function() {
                    spyOn(uuid, 'hashText').and.returnValue('hashbrownies');
                    spyOn(appAuthUtils, 'signData').and.returnValue('johnhancock');
                    spyOn(verifier, '_fetchApplication').and.returnValue(q({
                        _id: 'mongoid',
                        id: 'app-1',
                        key: 'ads-service',
                        secret: 'supersecret',
                        status: 'active',
                        entitlements: { foo: true }
                    }));
                    midWare = verifier.middlewarify();
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };
                    req.method = 'get';
                    req.originalUrl = '/api/campaigns/cam-1';
                    req.body = {};
                    req.headers = {
                        'x-rc-auth-app-key'     : 'ads-service',
                        'x-rc-auth-timestamp'   : 1453929767464,
                        'x-rc-auth-nonce'       : 'morelikenoncenseamirite',
                        'x-rc-auth-signature'   : 'johnhancock'
                    };
                });
                
                it('should fetch the app, verify the signature, and call next', function(done) {
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.application).toEqual({
                            id: 'app-1',
                            key: 'ads-service',
                            status: 'active',
                            entitlements: { foo: true }
                        });
                        expect(verifier._fetchApplication).toHaveBeenCalledWith('ads-service', req);
                        expect(uuid.hashText).toHaveBeenCalledWith('{}');
                        expect(appAuthUtils.signData).toHaveBeenCalledWith({
                            appKey: 'ads-service',
                            bodyHash: 'hashbrownies',
                            endpoint: 'GET /api/campaigns/cam-1',
                            nonce: 'morelikenoncenseamirite',
                            qs: null,
                            timestamp: 1453929767464
                        }, 'RSA-SHA256', 'supersecret');
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                ['x-rc-auth-app-key', 'x-rc-auth-timestamp', 'x-rc-auth-nonce', 'x-rc-auth-signature'].forEach(function(field) {
                    describe('if missing the ' + field + ' header', function() {
                        beforeEach(function() {
                            delete req.headers[field];
                        });

                        it('should call next if required is false', function(done) {
                            q(midWare(req, res, nextSpy)).finally(function() {
                                expect(nextSpy).toHaveBeenCalled();
                                expect(res.send).not.toHaveBeenCalled();
                                expect(req.application).not.toBeDefined();
                                expect(verifier._fetchApplication).not.toHaveBeenCalled();
                                expect(uuid.hashText).not.toHaveBeenCalled();
                                expect(appAuthUtils.signData).not.toHaveBeenCalled();
                                expect(mockLog.error).not.toHaveBeenCalled();
                            }).done(done);
                        });
                        
                        it('should return a 400 if required is true', function(done) {
                            midWare = verifier.middlewarify(true);
                            q(midWare(req, res, nextSpy)).finally(function() {
                                expect(nextSpy).not.toHaveBeenCalled();
                                expect(res.send).toHaveBeenCalledWith(400, 'Must include \'' + field + '\' header');
                                expect(req.application).not.toBeDefined();
                                expect(verifier._fetchApplication).not.toHaveBeenCalled();
                                expect(uuid.hashText).not.toHaveBeenCalled();
                                expect(appAuthUtils.signData).not.toHaveBeenCalled();
                                expect(mockLog.error).not.toHaveBeenCalled();
                            }).done(done);
                        });
                    });
                });
                
                it('should return a 400 if the timestamp header is too old', function(done) {
                    jasmine.clock().tick(5001);
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(400, 'Request timestamp header is too old');
                        expect(req.application).not.toBeDefined();
                        expect(verifier._fetchApplication).not.toHaveBeenCalled();
                        expect(uuid.hashText).not.toHaveBeenCalled();
                        expect(appAuthUtils.signData).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should return a 403 if the application is not found', function(done) {
                    verifier._fetchApplication.and.returnValue(q());
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(403, 'Forbidden');
                        expect(req.application).not.toBeDefined();
                        expect(verifier._fetchApplication).toHaveBeenCalled();
                        expect(uuid.hashText).not.toHaveBeenCalled();
                        expect(appAuthUtils.signData).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should correctly parse a query string out of the url', function(done) {
                    req.originalUrl = '/api/campaigns?foo=bar&orgs=o-1,o-2';
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.application).toEqual(jasmine.objectContaining({ id: 'app-1' }));
                        expect(uuid.hashText).toHaveBeenCalledWith('{}');
                        expect(appAuthUtils.signData).toHaveBeenCalledWith({
                            appKey: 'ads-service',
                            bodyHash: 'hashbrownies',
                            endpoint: 'GET /api/campaigns',
                            nonce: 'morelikenoncenseamirite',
                            qs: 'foo=bar&orgs=o-1,o-2',
                            timestamp: 1453929767464
                        }, 'RSA-SHA256', 'supersecret');
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should stringify and hash the body', function(done) {
                    req.body = { foo: 'bar', arr: [3, 1], d: new Date('Wed Jan 27 2016 18:51:08 GMT-0500 (EST)') };
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.application).toEqual(jasmine.objectContaining({ id: 'app-1' }));
                        expect(uuid.hashText).toHaveBeenCalledWith('{"foo":"bar","arr":[3,1],"d":"2016-01-27T23:51:08.000Z"}');
                        expect(appAuthUtils.signData).toHaveBeenCalledWith({
                            appKey: 'ads-service',
                            bodyHash: 'hashbrownies',
                            endpoint: 'GET /api/campaigns/cam-1',
                            nonce: 'morelikenoncenseamirite',
                            qs: null,
                            timestamp: 1453929767464
                        }, 'RSA-SHA256', 'supersecret');
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should also handle a string body', function(done) {
                    req.body = 'yo body is ridiculous';
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).toHaveBeenCalled();
                        expect(res.send).not.toHaveBeenCalled();
                        expect(req.application).toEqual(jasmine.objectContaining({ id: 'app-1' }));
                        expect(uuid.hashText).toHaveBeenCalledWith('yo body is ridiculous');
                        expect(appAuthUtils.signData).toHaveBeenCalledWith({
                            appKey: 'ads-service',
                            bodyHash: 'hashbrownies',
                            endpoint: 'GET /api/campaigns/cam-1',
                            nonce: 'morelikenoncenseamirite',
                            qs: null,
                            timestamp: 1453929767464
                        }, 'RSA-SHA256', 'supersecret');
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should return a 401 if the signature does not match', function(done) {
                    req.headers['x-rc-auth-signature'] = 'thomasjefferson';
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(401, 'Invalid signature');
                        expect(req.application).not.toBeDefined();
                        expect(verifier._fetchApplication).toHaveBeenCalled();
                        expect(appAuthUtils.signData).toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                    }).done(done);
                });
                
                it('should return a 500 if _fetchApplication fails', function(done) {
                    verifier._fetchApplication.and.returnValue(q.reject('honey, you got a big storm coming'));
                    q(midWare(req, res, nextSpy)).finally(function() {
                        expect(nextSpy).not.toHaveBeenCalled();
                        expect(res.send).toHaveBeenCalledWith(500, 'Error checking authorization of app');
                        expect(req.application).not.toBeDefined();
                        expect(verifier._fetchApplication).toHaveBeenCalled();
                        expect(uuid.hashText).not.toHaveBeenCalled();
                        expect(appAuthUtils.signData).not.toHaveBeenCalled();
                        expect(mockLog.error).toHaveBeenCalled();
                    }).done(done);
                });
            });
        });
    });
});

