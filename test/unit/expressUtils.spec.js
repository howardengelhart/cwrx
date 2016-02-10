describe('expressUtils', function() {
    var parseQuery;
    var cloudwatchMetrics;
    var expressUtils;

    var util;
    var EventEmitter;
    var extend;
    var logger;
    var uuid;

    var CloudWatchReporter;
    var MockCloudWatchReporter;
    var reporter;

    var mockLog;
    var next;

    beforeEach(function() {
        util = require('util');
        EventEmitter = require('events').EventEmitter;
        extend = require('../../lib/objUtils').extend;
        logger = require('../../lib/logger');
        uuid = require('../../lib/uuid');

        mockLog = {
            trace : jasmine.createSpy('log.trace()'),
            error : jasmine.createSpy('log.error()'),
            warn  : jasmine.createSpy('log.warn()'),
            info  : jasmine.createSpy('log.info()'),
            fatal : jasmine.createSpy('log.fatal()'),
            log   : jasmine.createSpy('log.log()')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        next = jasmine.createSpy('next()');

        delete require.cache[require.resolve('../../lib/cloudWatchReporter')];
        CloudWatchReporter = require('../../lib/cloudWatchReporter');
        MockCloudWatchReporter = require.cache[require.resolve('../../lib/cloudWatchReporter')].exports = jasmine.createSpy('CloudWatchReporter()').and.callFake(function(namespace, data) {
            reporter = new CloudWatchReporter(namespace, data);
            spyOn(reporter, 'autoflush');

            return reporter;
        });

        delete require.cache[require.resolve('../../lib/expressUtils')];
        parseQuery = require('../../lib/expressUtils').parseQuery;
        cloudwatchMetrics = require('../../lib/expressUtils').cloudwatchMetrics;
        expressUtils = require('../../lib/expressUtils');
    });

    describe('parseQuery(config)', function() {
        it('should exist', function() {
            expect(parseQuery).toEqual(jasmine.any(Function));
        });

        describe('when called', function() {
            var config;
            var middleware;

            beforeEach(function() {
                config = {
                    arrays: ['names', 'ages', 'ahem']
                };

                middleware = parseQuery(config);
            });

            it('should return a Function', function() {
                expect(middleware).toEqual(jasmine.any(Function));
            });

            describe('(the middleware)', function() {
                var request, response;

                beforeEach(function() {
                    request = {
                        query: {
                            names: 'howard,josh, evan,   scott, true, false,22.4,44,1986,0',
                            ages: '24, 25, 88, 44, foo',
                            ahem: 'cool',
                            id: 'cam-2955fce737e487',
                            hey: 'true',
                            cool: 'FALSE',
                            hello: 'hello world!',
                            nest: {
                                needed: '0'
                            },
                            okay: 'null',
                            bleh: 'undefined',
                            age: '44',
                            temp: '98.667'
                        }
                    };
                    response = {};

                    middleware(request, response, next);
                });

                it('should convert Strings into Numbers', function() {
                    expect(request.query.age).toBe(44);
                    expect(request.query.temp).toBe(98.667);
                    expect(request.query.nest.needed).toBe(0);
                });

                it('should leave Strings alone', function() {
                    expect(request.query.id).toBe('cam-2955fce737e487');
                    expect(request.query.hello).toBe('hello world!');
                });

                it('should convert Strings into Booleans', function() {
                    expect(request.query.hey).toBe(true);
                    expect(request.query.cool).toBe(false);
                });

                it('should convert Strings into null and undefined', function() {
                    expect(request.query.okay).toBe(null);
                    expect(request.query.bleh).toBe(undefined);
                });

                it('should convert Strings into Arrays', function() {
                    expect(request.query.names).toEqual(['howard', 'josh', 'evan', 'scott', true, false, 22.4, 44, 1986, 0]);
                    expect(request.query.ages).toEqual([24, 25, 88, 44, 'foo']);
                    expect(request.query.ahem).toEqual(['cool']);
                });

                it('should call next()', function() {
                    expect(next).toHaveBeenCalled();
                });

                describe('when an array value is an empty String', function() {
                    beforeEach(function() {
                        next.calls.reset();
                        request.query = { names: '' };

                        middleware(request, response, next);
                    });

                    it('should make the property null', function() {
                        expect(request.query.names).toBe(null);
                    });

                    it('should call next()', function() {
                        expect(next).toHaveBeenCalled();
                    });
                });
            });

            describe('without configuration', function() {
                var request, response;

                beforeEach(function() {
                    request = {
                        query: {
                            names: 'howard,josh, evan,   scott, true, false,22.4,44,1986,0',
                            ages: '24, 25, 88, 44, foo',
                            ahem: 'cool',
                            id: 'cam-2955fce737e487',
                            hey: 'true',
                            cool: 'FALSE',
                            hello: 'hello world!',
                            nest: {
                                needed: '0'
                            },
                            okay: 'null',
                            bleh: 'undefined',
                            age: '44',
                            temp: '98.667'
                        }
                    };
                    response = {};

                    parseQuery()(request, response, next);
                });

                it('should still work', function() {
                    expect(request.query.names).toBe('howard,josh, evan,   scott, true, false,22.4,44,1986,0');
                    expect(request.query.hey).toBe(true);
                    expect(next).toHaveBeenCalled();
                });
            });
        });
    });

    describe('cloudwatchMetrics(namespace, autoflush, data)', function() {
        it('should exist', function() {
            expect(cloudwatchMetrics).toEqual(jasmine.any(Function));
        });

        describe('when called', function() {
            var namespace, autoflush, data, options;
            var middleware;

            beforeEach(function() {
                namespace = 'C6/Player';
                autoflush = 1800000;
                options = {
                    MetricName: 'ReqTime'
                };

                middleware = cloudwatchMetrics(namespace, autoflush, options);
            });

            it('should return a middleware function', function() {
                expect(middleware).toEqual(jasmine.any(Function));
            });

            it('should create a CloudWatchReporter', function() {
                expect(MockCloudWatchReporter).toHaveBeenCalledWith(namespace, {
                    MetricName: options.MetricName,
                    Unit: 'Milliseconds'
                });
            });

            it('should autoflush the CloudWatchReporter', function() {
                expect(reporter.autoflush).toHaveBeenCalledWith(autoflush);
            });

            describe('(the middleware)', function() {
                var req, res;
                var headers;

                beforeEach(function() {
                    req = extend(new EventEmitter(), {});
                    res = extend(new EventEmitter(), {});

                    jasmine.clock().install();
                    jasmine.clock().mockDate();

                    middleware(req, res, next);
                });

                afterEach(function() {
                    jasmine.clock().uninstall();
                });

                it('should call next()', function() {
                    expect(next).toHaveBeenCalled();
                });

                describe('when the response is sent', function() {
                    beforeEach(function() {
                        spyOn(reporter, 'push').and.callThrough();
                        jasmine.clock().tick(250);

                        res.emit('finish');
                    });

                    it('should push the value into the CloudWatchReporter', function() {
                        expect(reporter.push).toHaveBeenCalledWith(250);
                    });
                });
            });

            describe('with missing options', function() {
                beforeEach(function() {
                    MockCloudWatchReporter.calls.reset();
                    middleware = cloudwatchMetrics(namespace);
                });

                it('should use sensible defaults', function() {
                    expect(MockCloudWatchReporter).toHaveBeenCalledWith(namespace, {
                        MetricName: 'RequestTime',
                        Unit: 'Milliseconds'
                    });
                    expect(reporter.autoflush).toHaveBeenCalledWith(300000);
                });
            });
        });
    });
    
    describe('setUuid', function() {
        it('should return a function', function() {
            expect(expressUtils.setUuid()).toEqual(jasmine.any(Function));
        });
        
        describe('returns a function that', function() {
            var midware, req, res;
            beforeEach(function() {
                midware = expressUtils.setUuid();
                req = {};
                res = { send: jasmine.createSpy('res.send()') };
                spyOn(uuid, 'createUuid').and.returnValue('abcdefghijklmnopqrstuvwxyz');
            });

            it('should set req.uuid', function() {
                midware(req, res, next);
                expect(req.uuid).toEqual('abcdefghij');
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
            });
        });
    });

    describe('setBasicHeaders', function() {
        it('should return a function', function() {
            expect(expressUtils.setBasicHeaders()).toEqual(jasmine.any(Function));
        });

        describe('returns a function that', function() {
            var midware, req, res;
            beforeEach(function() {
                midware = expressUtils.setBasicHeaders();
                req = {};
                res = {
                    send: jasmine.createSpy('res.send()'),
                    header: jasmine.createSpy('res.header()')
                };
            });

            it('should set some headers on the response', function() {
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(res.header.calls.count()).toBe(2);
                expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=0');
            });
        });
    });

    describe('handleOptions', function() {
        it('should return a function', function() {
            expect(expressUtils.handleOptions()).toEqual(jasmine.any(Function));
        });

        describe('returns a function that', function() {
            var midware, req, res;
            beforeEach(function() {
                midware = expressUtils.handleOptions();
                req = { method: 'OPTIONS' };
                res = { send: jasmine.createSpy('res.send()') };
            });

            it('should calls res.send() early if the request method is OPTIONS', function() {
                midware(req, res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.send).toHaveBeenCalledWith(200);
            });
            
            it('should call next normally if the request method is not OPTIONS', function() {
                req.method = 'GET';
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
            });
        });
    });

    describe('logRequest', function() {
        it('should return a function', function() {
            expect(expressUtils.logRequest()).toEqual(jasmine.any(Function));
        });

        describe('returns a function that', function() {
            var midware, req, res;
            beforeEach(function() {
                midware = expressUtils.logRequest();
                req = {
                    method: 'GET',
                    uuid: '1234',
                    url: '/api/content/meta',
                    httpVersion: '1.1',
                    headers: {
                        foo: 'bar',
                        blah: 'bloop',
                        accept: 'me, please'
                    }
                };
                res = { send: jasmine.createSpy('res.send()') };
            });

            it('should log basic info about a request', function() {
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(mockLog.info).toHaveBeenCalledWith(
                    'REQ: [%1] %2 %3 %4 %5',
                    '1234',
                    '{"foo":"bar","blah":"bloop","accept":"me, please"}',
                    'GET',
                    '/api/content/meta',
                    '1.1'
                );
            });
            
            it('should not log sensitive headers that are defined', function() {
                req.headers.cookie = 'thisissosecret';
                req.headers['x-rc-auth-nonce'] = 'morelikenoncenseamirite';
                req.headers['x-rc-auth-signature'] = 'johnhancock';
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(mockLog.info).toHaveBeenCalledWith(
                    'REQ: [%1] %2 %3 %4 %5',
                    '1234',
                    '{"foo":"bar","blah":"bloop","accept":"me, please"}',
                    'GET',
                    '/api/content/meta',
                    '1.1'
                );
            });
            
            it('should log at a different log level if configured to', function() {
                midware = expressUtils.logRequest('trace');
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(mockLog.trace).toHaveBeenCalledWith(
                    'REQ: [%1] %2 %3 %4 %5',
                    '1234',
                    '{"foo":"bar","blah":"bloop","accept":"me, please"}',
                    'GET',
                    '/api/content/meta',
                    '1.1'
                );
                expect(mockLog.info).not.toHaveBeenCalled();
            });
        });
    });

    describe('basicMiddleware', function() {
        it('should return a function', function() {
            expect(expressUtils.basicMiddleware()).toEqual(jasmine.any(Function));
        });

        describe('returns a function that', function() {
            var midware, req, res;
            beforeEach(function() {
                req = {
                    method: 'GET',
                    url: '/api/content/meta',
                    httpVersion: '1.1',
                    headers: {
                        foo: 'bar',
                        blah: 'bloop',
                        accept: 'me, please'
                    }
                };
                res = {
                    send: jasmine.createSpy('res.send()'),
                    header: jasmine.createSpy('res.header()')
                };
                spyOn(uuid, 'createUuid').and.returnValue('abcdefghijklmnopqrstuvwxyz');
                spyOn(expressUtils, 'setUuid').and.callThrough();
                spyOn(expressUtils, 'setBasicHeaders').and.callThrough();
                spyOn(expressUtils, 'handleOptions').and.callThrough();
                spyOn(expressUtils, 'logRequest').and.callThrough();

                midware = expressUtils.basicMiddleware();
            });
            
            it('should call the middleware returned by setUuid, setBasicHeaders, handleOptions, and logRequests', function() {
                midware(req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(req.uuid).toBe('abcdefghij');
                expect(res.header.calls.count()).toBe(2);
                expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=0');
                expect(mockLog.info).toHaveBeenCalledWith(
                    'REQ: [%1] %2 %3 %4 %5',
                    'abcdefghij',
                    '{"foo":"bar","blah":"bloop","accept":"me, please"}',
                    'GET',
                    '/api/content/meta',
                    '1.1'
                );
                expect(expressUtils.setUuid).toHaveBeenCalled();
                expect(expressUtils.setBasicHeaders).toHaveBeenCalled();
                expect(expressUtils.handleOptions).toHaveBeenCalled();
                expect(expressUtils.logRequest).toHaveBeenCalled();
            });
        });
    });
    
    describe('errorHandler', function() {
        it('should return a function', function() {
            expect(expressUtils.errorHandler()).toEqual(jasmine.any(Function));
        });
        
        describe('returns a function that', function() {
            var req, res, err, midware;
            beforeEach(function() {
                req = { uuid: '1234' };
                res = {
                    send: jasmine.createSpy('res.send()')
                };
                midware = expressUtils.errorHandler();
            });
            
            it('should just call next if no error is passed', function() {
                err = null;
                midware(err, req, res, next);
                expect(next).toHaveBeenCalled();
                expect(res.send).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
            
            it('should log.warn if there is a 4xx status code attached to the error', function() {
                err = new Error('i dont know what to do with all that body');
                err.status = 413;
                midware(err, req, res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.send).toHaveBeenCalledWith(413, 'i dont know what to do with all that body');
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.argsFor(0)).toContain(util.inspect(err));
                expect(mockLog.error).not.toHaveBeenCalled();
            });
            
            it('should log.error if there is a 5xx status code attached to the error', function() {
                err = new Error('i got a problem crosby');
                err.status = 500;
                midware(err, req, res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.send).toHaveBeenCalledWith(500, 'i got a problem crosby');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.argsFor(0)).toContain(err.stack);
            });
            
            it('should log.error if there is no status code attached to the error', function() {
                err = 'i got a problem crosby';
                midware(err, req, res, next);
                expect(next).not.toHaveBeenCalled();
                expect(res.send).toHaveBeenCalledWith(500, 'Internal error');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.argsFor(0)).toContain(util.inspect(err));
            });
        });
    });

    describe('sendResponse', function() {
        var res;
        beforeEach(function() {
            res = {
                send: jasmine.createSpy('res.send()'),
                header: jasmine.createSpy('res.header()')
            };
        });

        it('should call res.send with the result', function() {
            expressUtils.sendResponse(res, { code: 200, body: 'ok!' });
            expect(res.send).toHaveBeenCalledWith(200, 'ok!');
            expressUtils.sendResponse(res, { code: 500, body: { error: 'Error!', detail: 'Problems!' } });
            expect(res.send).toHaveBeenCalledWith(500, { error: 'Error!', detail: 'Problems!' });
            expect(res.header).not.toHaveBeenCalled();
        });
        
        it('should call res.send with a 204 if no result is provided', function() {
            expressUtils.sendResponse(res);
            expect(res.send).toHaveBeenCalledWith(204);
            expect(res.header).not.toHaveBeenCalled();
        });
        
        it('should appropriately set headers if defined', function() {
            var headers = { 'cache-control': 0, 'content-range': 'items 1-2/2' };
            expressUtils.sendResponse(res, { code: 200, body: 'ok!', headers: headers });
            expect(res.send).toHaveBeenCalledWith(200, 'ok!');
            expect(res.header).toHaveBeenCalledWith('cache-control', 0);
            expect(res.header).toHaveBeenCalledWith('content-range', 'items 1-2/2');
        });
    });
});
