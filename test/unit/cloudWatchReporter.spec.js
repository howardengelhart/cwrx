describe('CloudWatchReporter(namespace, data)', function() {
    var CloudWatchReporter;
    var Aggregator;
    var CloudWatch;
    var logger;

    var log;

    beforeEach(function() {
        Aggregator = require('../../lib/aggregator');
        CloudWatchReporter = require('../../lib/cloudWatchReporter');
        CloudWatch = require('aws-sdk').CloudWatch;
        logger = require('../../lib/logger');

        log = {
            info: jasmine.createSpy('log.info()'),
            trace: jasmine.createSpy('log.trace()'),
            warn: jasmine.createSpy('log.warn()'),
            error: jasmine.createSpy('log.error()')
        };
        spyOn(logger, 'getLog').and.returnValue(log);
    });

    it('should exist', function() {
        expect(CloudWatchReporter).toEqual(jasmine.any(Function));
        expect(CloudWatchReporter.name).toEqual('CloudWatchReporter');
    });

    describe('instance:', function() {
        var namespace, data;
        var reporter;

        beforeEach(function() {
            namespace = 'C6/Service';
            data = {
                MetricName: 'SomeMetric',
                Unit: 'Milliseconds'
            };

            reporter = new CloudWatchReporter(namespace, data);
        });

        it('should be an Aggregator', function() {
            expect(reporter).toEqual(jasmine.any(Aggregator));
        });

        describe('properties:', function() {
            describe('cloudwatch', function() {
                it('should be a CloudWatch instance', function() {
                    expect(reporter.cloudwatch).toEqual(jasmine.any(CloudWatch));
                });
            });

            describe('namespace', function() {
                it('should be the provided namespace', function() {
                    expect(reporter.namespace).toBe(namespace);
                });
            });

            describe('metricData', function() {
                it('should be the provided data', function() {
                    expect(reporter.metricData).toBe(data);
                });
            });
        });

        describe('methods:', function() {
            describe('flush()', function() {
                var data;
                var result;

                beforeEach(function() {
                    [20, 30, 40].forEach(reporter.push.bind(reporter));
                    spyOn(Aggregator.prototype, 'flush').and.callThrough();
                    data = reporter.getAggregateData();
                    spyOn(reporter.cloudwatch, 'putMetricData');

                    result = reporter.flush();
                });

                it('should call super()', function() {
                    expect(Aggregator.prototype.flush).toHaveBeenCalled();
                });

                it('should return the result of calling super()', function() {
                    expect(result).toEqual(data);
                });

                it('should send data to cloudwatch', function() {
                    expect(reporter.cloudwatch.putMetricData).toHaveBeenCalledWith({
                        Namespace: namespace,
                        MetricData: [
                            {
                                MetricName: 'SomeMetric',
                                Unit: 'Milliseconds',
                                StatisticValues: {
                                    Maximum: data.max,
                                    Minimum: data.min,
                                    SampleCount: data.sampleSize,
                                    Sum: data.sum
                                }
                            }
                        ]
                    }, jasmine.any(Function));
                });

                describe('if sending the metric', function() {
                    var callback;
                    var error, data;

                    beforeEach(function() {
                        callback = reporter.cloudwatch.putMetricData.calls.mostRecent().args[1];

                        error = null; data = null;
                    });

                    describe('fails', function() {
                        beforeEach(function() {
                            error = new Error('AWS is having some issue.');
                            callback(error, data);
                        });

                        it('should log a message', function() {
                            expect(log.info).toHaveBeenCalled();
                        });
                    });

                    describe('succeeds', function() {
                        beforeEach(function() {
                            data = {};
                            callback(error, data);
                        });

                        it('should not log a message', function() {
                            expect(log.info).not.toHaveBeenCalled();
                        });
                    });
                });

                describe('if there are no metrics to send', function() {
                    beforeEach(function() {
                        reporter.cloudwatch.putMetricData.calls.reset();
                        reporter.values.length = 0;

                        expect(reporter.getAggregateData()).toEqual(reporter.flush());
                    });

                    it('should not put a value of 0', function() {
                        expect(reporter.cloudwatch.putMetricData).toHaveBeenCalledWith({
                            Namespace: namespace,
                            MetricData: [
                                {
                                    MetricName: 'SomeMetric',
                                    Unit: 'Milliseconds',
                                    Value: 0
                                }
                            ]
                        }, jasmine.any(Function));
                    });
                });
            });
        });
    });
});
