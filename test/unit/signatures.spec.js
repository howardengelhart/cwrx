var flush = true;
describe('signatures', function() {
    var q, signatures, crypto, mongoUtils, uuid, hashUtils, req, nextSpy;

    beforeEach(function() {
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(1453929767464));

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        crypto          = require('crypto');
        signatures      = require('../../lib/signatures');
        uuid            = require('rc-uuid');
        hashUtils       = require('../../lib/hashUtils');

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
            expect(signatures.formatEndpoint('get', '/api/campaign/cam-1234')).toEqual('GET /api/campaign/cam-1234');
            expect(signatures.formatEndpoint('GET', 'http://staging.cinema6.com/api/campaign/cam-1234')).toEqual('GET /api/campaign/cam-1234');
            expect(signatures.formatEndpoint('POST', 'https://platform.reelcontent.com/api/content/experience/')).toEqual('POST /api/content/experience/');
        });

        it('should handle query strings correctly', function() {
            expect(signatures.formatEndpoint('GET', '/api/campaigns/cam-1234?decorated=true')).toEqual('GET /api/campaigns/cam-1234');
            expect(signatures.formatEndpoint('GET', 'http://staging.cinema6.com/api/campaigns/?foo=bar&blah=bloop')).toEqual('GET /api/campaigns/');
            expect(signatures.formatEndpoint('PUT', '/api/campaigns/cam-1234?decorated=true')).toEqual('PUT /api/campaigns/cam-1234');
        });
    });

    describe('signData', function() {
        var mockHmac, data, hmacAlg, secret;
        beforeEach(function() {
            mockHmac = {
                _value: '',
                update: jasmine.createSpy('hmac.update()').and.callFake(function(text) {
                    mockHmac._value += text.length + ':';
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
                expect(signatures.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:17:');
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

                expect(signatures.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:64:');
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

                expect(signatures.signData(data, hmacAlg, secret)).toBe('RSA-SHAwesome:supersecret:98:');
                expect(crypto.createHmac).toHaveBeenCalledWith('RSA-SHAwesome', 'supersecret');
                expect(mockHmac.update).toHaveBeenCalledWith('{"foo":"bar","nest":{"bar":"no","deeper":{"inception":"very","movie":"indeed"},"foo":"yes"},"z":1}');
                expect(mockHmac.digest).toHaveBeenCalledWith('hex');
            });
        });
    });

    describe('setAuthHeaders', function() {
        var creds, reqOpts;
        beforeEach(function() {
            creds = { key: 'ads-service', secret: 'ipoopmypants' };
            spyOn(hashUtils, 'hashText').and.returnValue('hashbrowns');
            spyOn(uuid, 'randomUuid').and.returnValue('uuuuuuuuuuuuuuuuuuid');
            spyOn(signatures, 'signData').and.returnValue('johnhancock');
            reqOpts = {
                url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
            };
        });

        it('should throw an error if the creds object is incomplete', function() {
            [null, {}, { key: 'foo' }, { secret: 'bar' }].forEach(function(obj) {
                expect(function() { signatures.setAuthHeaders(obj, 'get', reqOpts); }).toThrow(new Error('Must provide creds object with key + secret'));
            });
        });

        it('should set auth headers on the request opts', function() {
            signatures.setAuthHeaders(creds, 'get', reqOpts);
            expect(reqOpts).toEqual({
                url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                headers: {
                    'x-rc-auth-app-key'     : 'ads-service',
                    'x-rc-auth-timestamp'   : 1453929767464,
                    'x-rc-auth-nonce'       : 'uuuuuuuuuuuuuuuuuuid',
                    'x-rc-auth-signature'   : 'johnhancock'
                }
            });
            expect(hashUtils.hashText).toHaveBeenCalledWith('{}', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey      : 'ads-service',
                bodyHash    : 'hashbrowns',
                endpoint    : 'GET /api/campaigns/cam-1234',
                nonce       : 'uuuuuuuuuuuuuuuuuuid',
                qs          : { },
                timestamp   : 1453929767464
            }, 'SHA256', 'ipoopmypants');
        });

        it('should not overwrite any existing headers', function() {
            reqOpts.headers = {
                'x-gone-give-it-to-ya'      : 'yeaaaaah',
                cookie                      : 'chocolate'
            };
            signatures.setAuthHeaders(creds, 'get', reqOpts);

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
                reqOpts.qs = { decorated: true, a: 1, foo: 'bar', object: { key: 'value' } };
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts).toEqual({
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                    qs: { decorated: true, a: 1, foo: 'bar', object: { key: 'value' } },
                    headers: jasmine.objectContaining({
                        'x-rc-auth-signature'   : 'johnhancock'
                    })
                });
                expect(signatures.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                    endpoint    : 'GET /api/campaigns/cam-1234',
                    qs          : {
                        a: '1',
                        decorated: 'true',
                        foo: 'bar',
                        object: {
                            key: 'value'
                        }
                    },
                }), 'SHA256', 'ipoopmypants');
            });

            it('should handle an empty qs property', function() {
                reqOpts.qs = {};
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts).toEqual({
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                    qs: { },
                    headers: jasmine.objectContaining({
                        'x-rc-auth-signature'   : 'johnhancock'
                    })
                });
                expect(signatures.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                    endpoint    : 'GET /api/campaigns/cam-1234',
                    qs          : { },
                }), 'SHA256', 'ipoopmypants');
            });

            it('should be able to use the query string in the url', function() {
                reqOpts.url = 'http://localhost:9000/api/account/user?decorated=false&orgs=o-1,o-2,o-3&status=active';
                signatures.setAuthHeaders(creds, 'PoSt', reqOpts);

                expect(reqOpts).toEqual({
                    url: 'http://localhost:9000/api/account/user?decorated=false&orgs=o-1,o-2,o-3&status=active',
                    headers: jasmine.objectContaining({
                        'x-rc-auth-signature'   : 'johnhancock'
                    })
                });
                expect(signatures.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                    endpoint    : 'POST /api/account/user',
                    qs          : {
                        decorated: 'false',
                        orgs: 'o-1,o-2,o-3',
                        status: 'active'
                    },
                }), 'SHA256', 'ipoopmypants');
            });

            it('should be able to properly format all kinds of query parameters', function() {
                reqOpts.qs = {
                    foo: 'bar',
                    number: 1,
                    floating: 0.5,
                    bool: true,
                    emptyStr: '',
                    suchNull: null,
                    muchUndefined: undefined,
                    veryEmpty: [ ],
                    wow: { },
                    nan: NaN,
                    array: [ ],
                    complexArray: [ { foo: 'bar' }, 1 ],
                    object: {
                        foo: 'bar',
                        number: 1,
                        floating: 0.5,
                        bool: true,
                        emptyStr: '',
                        suchNull: null,
                        muchUndefined: undefined,
                        veryEmpty: [ ],
                        wow: { },
                        nan: NaN
                    }
                };
                signatures.setAuthHeaders(creds, 'get', reqOpts);
                expect(reqOpts).toEqual({
                    url: 'http://staging.cinema6.com/api/campaigns/cam-1234',
                    qs: reqOpts.qs,
                    headers: jasmine.objectContaining({
                        'x-rc-auth-signature'   : 'johnhancock'
                    })
                });
                expect(signatures.signData).toHaveBeenCalledWith(jasmine.objectContaining({
                    endpoint    : 'GET /api/campaigns/cam-1234',
                    qs          : {
                        foo: 'bar',
                        number: '1',
                        floating: '0.5',
                        bool: 'true',
                        emptyStr: '',
                        suchNull: '',
                        nan: 'NaN',
                        complexArray: [ { foo: 'bar' }, '1' ],
                        object: {
                            foo: 'bar',
                            number: '1',
                            floating: '0.5',
                            bool: 'true',
                            emptyStr: '',
                            suchNull: '',
                            nan: 'NaN'
                        }
                    },
                }), 'SHA256', 'ipoopmypants');
            });
        });

        describe('when handling the body', function() {
            it('should just hash the body if it is a string', function() {
                reqOpts.body = 'dis body is hot';
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts.body).toEqual('dis body is hot');
                expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                expect(hashUtils.hashText).toHaveBeenCalledWith('dis body is hot', 'SHA256');
            });

            it('should stringify and hash the body if it is an object', function() {
                reqOpts.body = { foo: 'bar', num: 123, nest: { birds: 'yes' }, arr: [1,3] };
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts.body).toEqual({ foo: 'bar', num: 123, nest: { birds: 'yes' }, arr: [1,3] });
                expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                expect(hashUtils.hashText).toHaveBeenCalledWith('{"foo":"bar","num":123,"nest":{"birds":"yes"},"arr":[1,3]}', 'SHA256');
            });

            it('should be able to take the body from the json prop', function() {
                reqOpts.json = { foo: 'bar' };
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts.json).toEqual({ foo: 'bar' });
                expect(reqOpts.body).not.toBeDefined();
                expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                expect(hashUtils.hashText).toHaveBeenCalledWith('{"foo":"bar"}', 'SHA256');
            });

            it('should ignore the json prop if it is not an object', function() {
                reqOpts.json = true;
                signatures.setAuthHeaders(creds, 'get', reqOpts);

                expect(reqOpts.json).toEqual(true);
                expect(reqOpts.body).not.toBeDefined();
                expect(reqOpts.headers['x-rc-auth-signature']).toBe('johnhancock');
                expect(hashUtils.hashText).toHaveBeenCalledWith('{}', 'SHA256');
            });
        });
    });

    describe('parseAuthHeaders', function() {
        beforeEach(function() {
            req.headers = {
                'x-foo'                 : 'bar',
                'x-rc-auth-app-key'     : 'ads-service',
                'x-rc-auth-timestamp'   : '1453929767464',
                'x-rc-auth-nonce'       : 'morelikenoncenseamirite',
                'x-rc-auth-signature'   : 'johnhancock'
            };
        });

        it('should parse headers and return an object with their values', function() {
            expect(signatures.parseAuthHeaders(req)).toEqual({
                appKey      : 'ads-service',
                ts          : 1453929767464,
                nonce       : 'morelikenoncenseamirite',
                signature   : 'johnhancock'
            });
        });

        it('should deal with weird or missing headers', function() {
            req.headers = {
                'x-rc-auth-app-key'     : { ads: 'yes' },
                'x-rc-auth-timestamp'   : 'foo1453929767464',
                'x-rc-auth-nonce'       : null
            };
            expect(signatures.parseAuthHeaders(req)).toEqual({
                appKey      : '[object Object]',
                ts          : NaN,
                nonce       : '',
                signature   : ''
            });
        });
    });

    describe('verifyRequest', function() {
        var app;
        beforeEach(function() {
            spyOn(hashUtils, 'hashText').and.returnValue('hashbrownies');
            spyOn(signatures, 'signData').and.returnValue('johnhancock');
            req.method = 'get';
            req.originalUrl = '/api/campaigns/cam-1';
            req.body = {};
            req.headers = {
                'x-rc-auth-app-key'     : 'ads-service',
                'x-rc-auth-timestamp'   : 1453929767464,
                'x-rc-auth-nonce'       : 'morelikenoncenseamirite',
                'x-rc-auth-signature'   : 'johnhancock'
            };
            app = {
                id: 'app-1',
                key: 'ads-service',
                secret: 'supersecret'
            };
        });

        it('should return true if the signature is valid', function() {
            expect(signatures.verifyRequest(req, app)).toBe(true);
            expect(hashUtils.hashText).toHaveBeenCalledWith('{}', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey: 'ads-service',
                bodyHash: 'hashbrownies',
                endpoint: 'GET /api/campaigns/cam-1',
                nonce: 'morelikenoncenseamirite',
                qs: { },
                timestamp: 1453929767464
            }, 'SHA256', 'supersecret');
        });

        it('should return false if headers are missing', function() {
            ['x-rc-auth-app-key', 'x-rc-auth-timestamp', 'x-rc-auth-nonce', 'x-rc-auth-signature'].forEach(function(field) {
                var reqCopy = JSON.parse(JSON.stringify(req));
                delete reqCopy.headers[field];
                expect(signatures.verifyRequest(reqCopy, app)).toBe(false);
            });
            expect(hashUtils.hashText).not.toHaveBeenCalled();
            expect(signatures.signData).not.toHaveBeenCalled();
        });

        it('should correctly parse use query params from the request', function() {
            req.originalUrl = '/api/campaigns?foo=bar&orgs=o-1,o-2';
            req.query = {
                foo: 'bar',
                orgs: 'o-1,o-2'
            };
            expect(signatures.verifyRequest(req, app)).toBe(true);
            expect(hashUtils.hashText).toHaveBeenCalledWith('{}', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey: 'ads-service',
                bodyHash: 'hashbrownies',
                endpoint: 'GET /api/campaigns',
                nonce: 'morelikenoncenseamirite',
                qs: {
                    foo: 'bar',
                    orgs: 'o-1,o-2'
                },
                timestamp: 1453929767464
            }, 'SHA256', 'supersecret');
        });

        it('should stringify and hash the body', function() {
            req.body = { foo: 'bar', arr: [3, 1], d: new Date('Wed Jan 27 2016 18:51:08 GMT-0500 (EST)') };
            expect(signatures.verifyRequest(req, app)).toBe(true);
            expect(hashUtils.hashText).toHaveBeenCalledWith('{"foo":"bar","arr":[3,1],"d":"2016-01-27T23:51:08.000Z"}', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey: 'ads-service',
                bodyHash: 'hashbrownies',
                endpoint: 'GET /api/campaigns/cam-1',
                nonce: 'morelikenoncenseamirite',
                qs: { },
                timestamp: 1453929767464
            }, 'SHA256', 'supersecret');
        });

        it('should also handle a string body', function() {
            req.body = 'yo body is ridiculous';
            expect(signatures.verifyRequest(req, app)).toBe(true);
            expect(hashUtils.hashText).toHaveBeenCalledWith('yo body is ridiculous', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey: 'ads-service',
                bodyHash: 'hashbrownies',
                endpoint: 'GET /api/campaigns/cam-1',
                nonce: 'morelikenoncenseamirite',
                qs: { },
                timestamp: 1453929767464
            }, 'SHA256', 'supersecret');
        });

        it('should return false if the signature does not match', function() {
            req.headers['x-rc-auth-signature'] = 'thomasjefferson';
            expect(signatures.verifyRequest(req, app)).toBe(false);
            expect(signatures.signData).toHaveBeenCalled();
        });

        it('should support the previous method of computing authentication signatures', function() {
            req.originalUrl = '/api/campaigns?foo=bar&orgs=o-1,o-2';
            req.query = {
                foo: 'bar',
                orgs: 'o-1,o-2'
            };
            expect(signatures.verifyRequest(req, app)).toBe(true);
            expect(hashUtils.hashText).toHaveBeenCalledWith('{}', 'SHA256');
            expect(signatures.signData).toHaveBeenCalledWith({
                appKey: 'ads-service',
                bodyHash: 'hashbrownies',
                endpoint: 'GET /api/campaigns',
                nonce: 'morelikenoncenseamirite',
                qs: 'foo=bar&orgs=o-1,o-2',
                timestamp: 1453929767464
            }, 'SHA256', 'supersecret');
        });
    });
});
