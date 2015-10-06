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

module.exports.parseQuery = parseQuery;
