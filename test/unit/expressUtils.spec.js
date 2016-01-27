describe('expressUtils', function() {
    var parseQuery;
    var cloudwatchMetrics;
    var expressUtils;

    var EventEmitter;
    var extend;
    var logger;
    var uuid;

    var CloudWatchReporter;
    var MockCloudWatchReporter;
    var reporter;

    var mockLog;

    beforeEach(function() {
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
        spyOn(logger, 'getLog').and.returnValue(mockLog)

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
                var request, response, next;

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
                    next = jasmine.createSpy('next()');

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
                var request, response, next;

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
                    next = jasmine.createSpy('next()');

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
            var namespace, autoflush, data;
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
                var req, res, next;
                var headers;

                beforeEach(function() {
                    req = extend(new EventEmitter(), {});
                    res = extend(new EventEmitter(), {});
                    next = jasmine.createSpy('next()');

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
            var midware, req, res, next;
            beforeEach(function() {
                midware = expressUtils.setUuid();
                req = {};
                res = { send: jasmine.createSpy('res.send()') };
                next = jasmine.createSpy('next()');
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
            var midware, req, res, next;
            beforeEach(function() {
                midware = expressUtils.setBasicHeaders();
                req = {};
                res = {
                    send: jasmine.createSpy('res.send()'),
                    header: jasmine.createSpy('res.header()')
                };
                next = jasmine.createSpy('next()');
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
            var midware, req, res, next;
            beforeEach(function() {
                midware = expressUtils.handleOptions();
                req = { method: 'OPTIONS' };
                res = { send: jasmine.createSpy('res.send()') };
                next = jasmine.createSpy('next()');
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
            var midware, req, res, next;
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
                next = jasmine.createSpy('next()');
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
            var midware, req, res, next;
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
                next = jasmine.createSpy('next()');
                spyOn(uuid, 'createUuid').and.returnValue('abcdefghijklmnopqrstuvwxyz')
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
});
