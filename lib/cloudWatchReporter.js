var logger = require('./logger');
var Aggregator = require('./aggregator');
var CloudWatch = require('aws-sdk').CloudWatch;
var inherits = require('util').inherits;
var inspect = require('util').inspect;
var extend = require('./objUtils').extend;

function CloudWatchReporter(namespace, data, options) {
    Aggregator.call(this);

    this.namespace = namespace;
    this.metricData = data;

    this.cloudwatch = new CloudWatch(options || { });
}
inherits(CloudWatchReporter, Aggregator);

CloudWatchReporter.prototype.flush = function flush() {
    var log = logger.getLog();
    var data = Aggregator.prototype.flush.call(this);
    var MetricData = extend(data.sampleSize ? {
        StatisticValues: {
            Maximum: data.max,
            Minimum: data.min,
            SampleCount: data.sampleSize,
            Sum: data.sum
        }
    } : {
        Value: 0
    }, this.metricData);

    this.cloudwatch.putMetricData({
        Namespace: this.namespace,
        MetricData: [MetricData]
    }, function logError(error) {
        if (error) {
            log.info('Error sending metrics to CloudWatch: %1', inspect(error));
        }
    });

    return data;
};

module.exports = CloudWatchReporter;
