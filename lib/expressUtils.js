var logger = require('./logger');
var CloudWatchReporter = require('./cloudWatchReporter');
var extend = require('./objUtils').extend;
var inspect = require('util').inspect;

var REGEX = {
    NUMBER: (/^\d+(\.\d+)?$/)
};

function parseQuery(/*config*/) {
    var config = arguments[0] || {};
    var arrays = config.arrays || [];

    function convert(value) {
        if (REGEX.NUMBER.test(value)) {
            return parseFloat(value);
        } else if (value.toLowerCase() === 'true') {
            return true;
        } else if (value.toLowerCase() === 'false') {
            return false;
        } else if (value === 'undefined') {
            return undefined;
        } else if (value === 'null') {
            return null;
        } else {
            return value;
        }
    }

    function parse(object) {
        Object.keys(object).forEach(function(key) {
            var value = object[key];

            if (typeof value === 'object') {
                parse(value);
            } else if (arrays.indexOf(key) > -1) {
                if (!value) {
                    object[key] = null;
                } else {
                    object[key] = object[key].split(/,\s*/).map(convert);
                }
            } else {
                object[key] = convert(value);
            }
        });
    }

    return function parseQueryMiddleware(request, response, next) {
        parse(request.query);

        next();
    };
}

function cloudwatchMetrics(namespace/*, autoflush, options*/) {
    var autoflush = typeof arguments[1] === 'number' ? arguments[1] : (5 * 60 * 1000); // 5 mins
    var options = extend(arguments[2] || {}, { MetricName: 'RequestTime', Unit: 'Milliseconds' });

    var log = logger.getLog();
    var reporter = new CloudWatchReporter(namespace, options);

    reporter.autoflush(autoflush);
    reporter.on('flush', function(data) {
        log.info('Sending Request Timing metrics to CloudWatch: %1', inspect(data));
    });

    return function cloudwatchMetricsMiddleware(req, res, next) {
        var start = Date.now();

        res.on('finish', function sendMetrics() {
            var end = Date.now();

            reporter.push(end - start);
        });

        return next();
    };
}

module.exports.parseQuery = parseQuery;
module.exports.cloudwatchMetrics = cloudwatchMetrics;
