var logger = require('./logger');
var CloudWatchReporter = require('./cloudWatchReporter');
var extend = require('./objUtils').extend;
var inspect = require('util').inspect;
var uuid = require('../lib/uuid');

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

    var middleware =  function cloudwatchMetricsMiddleware(req, res, next) {
        var start = Date.now();

        res.on('finish', function sendMetrics() {
            var end = Date.now();

            reporter.push(end - start);
        });

        return next();
    };
    middleware.reporter = reporter;
    return middleware;
}

// Generates uuid and sets it as req.uuid
function setUuid() {
    return function uuidMidware(req, res, next) {
        req.uuid = uuid.createUuid().substr(0,10);
        next();
    };
}

// Sets a few basic headers, including cache-control=0
function setBasicHeaders() {
    return function headerMidware(req, res, next) {
        res.header('Access-Control-Allow-Headers',
                   'Origin, X-Requested-With, Content-Type, Accept');
        res.header('cache-control', 'max-age=0');
        next();
    };
}

// Handle requests with the OPTIONS http method
function handleOptions() {
    return function optionsMidware(req, res, next) {
        if (req.method.toLowerCase() === 'options') {
            res.send(200);
        } else {
            next();
        }
    };
}

// Log information at logLevel (default === info) about each request, including approved headers.
function logRequest(logLevel) {
    logLevel = logLevel || 'info';
    var log = logger.getLog(),
        headerBlacklist = ['cookie', 'x-rc-auth-nonce', 'x-rc-auth-signature']; // don't log these
    
    return function logMidware(req, res, next) {
        var headers = Object.keys(req.headers || {}).reduce(function(approved, header) {
            if (headerBlacklist.indexOf(header) === -1) {
                approved[header] = req.headers[header];
            }
            return approved;
        }, {});
        
        log[logLevel](
            'REQ: [%1] %2 %3 %4 %5',
            req.uuid,
            JSON.stringify(headers),
            req.method,
            req.url,
            req.httpVersion
        );

        next();
    };
}

// Combine setUuid, setBasicHeaders, handleOptions, and logRequest
function basicMiddleware() {
    var uuidMidware = module.exports.setUuid(),
        headerMidware = module.exports.setBasicHeaders(),
        optionsMidware = module.exports.handleOptions(),
        logMidware = module.exports.logRequest();

    return function combinedMidware(req, res, next) {
        uuidMidware(req, res, function() {
            headerMidware(req, res, function() {
                optionsMidware(req, res, function() {
                    logMidware(req, res, next);
                });
            });
        });
    };
}

/* Returns middleware to handle unhandled errors. Will log.warn() if the error has a status less
 * than 500, and log.error otherwise. Should ALWAYS be included LAST, right before app.listen() */
function errorHandler() { //TODO: test
    var log = logger.getLog();
    
    return function logErrors(err, req, res, next) {
        if (err) {
            if (err.status && err.status < 500) {
                log.warn('[%1] Bad Request: %2', req.uuid, inspect(err));
                res.send(err.status, err.message || 'Bad Request');
            } else {
                log.error('[%1] Internal Error: %2', req.uuid, err && err.stack || inspect(err));
                res.send(err.status || 500, err.message || 'Internal error');
            }
        } else {
            next();
        }
    };
}


module.exports.parseQuery = parseQuery;
module.exports.cloudwatchMetrics = cloudwatchMetrics;
module.exports.setUuid = setUuid;
module.exports.setBasicHeaders = setBasicHeaders;
module.exports.handleOptions = handleOptions;
module.exports.logRequest = logRequest;
module.exports.basicMiddleware = basicMiddleware;
module.exports.errorHandler = errorHandler;
