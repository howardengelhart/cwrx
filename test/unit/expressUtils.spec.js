describe('expressUtils', function() {
    var parseQuery;
    var cloudwatchMetrics;

    var EventEmitter;
    var extend;
    var logger;

    var CloudWatchReporter;
    var MockCloudWatchReporter;
    var reporter;

    var log;

    beforeEach(function() {
        EventEmitter = require('events').EventEmitter;
        extend = require('../../lib/objUtils').extend;
        logger = require('../../lib/logger');

        spyOn(logger, 'getLog').and.returnValue(log = {
            trace: jasmine.createSpy('log.trace()'),
            info: jasmine.createSpy('log.info()'),
            warn: jasmine.createSpy('log.warn()'),
            error: jasmine.createSpy('log.error()')
        });

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
});
