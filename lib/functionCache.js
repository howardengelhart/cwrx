/* jshint latedef:nofunc */

var uuid = require('./uuid');

function minutesToMilliseconds(minutes) {
    return minutes * 60 * 1000;
}

function identity(value) {
    return value;
}

/**
 * A function [memoizer](https://en.wikipedia.org/wiki/Memoization) with support for asynchronous
 * operations via Promises.
 *
 * @class FunctionCache
 * @constructor
 * @param {Object} config Configuration options for the instance
 * @param {Number} config.freshTTL Amount of time (in minutes) that must elapse before a background
 *     refresh occurs. After the `freshTTL` expires, the cache will be updated, but the new promise
 *     will not be returned until it is fulfilled.
 * @param {Number} config.maxTTL Amount of time (in minutes) that must elapse before a forced
 *     refresh occurs. After the `maxTTL` expires, the cache will be updated and the new value
 *     immediately returned.
 * @param {Number} [config.errorTTL=10/60] Amount of time (in minutes) that a rejected promise
 *     should be cached. Defaults to 10 seconds.
 * @param {Number} [config.gcInterval=15] Amount of time (in minutes) that a garbage-collection job
 *     should run. Every time the job runs, it will scan the cache for entires with expired
 *     `maxTTL`s and remove them.
 * @param {Function} [config.extractor=identity] A function that will be called with the return
 *     value (cached or not) of a memoized function each time it is called. The return value of this
 *     function will be returned. If not specified, an
 *     [identity function](https://en.wikipedia.org/wiki/Identity_function) will be used.
 */

function FunctionCache(config) {
    if (!['freshTTL', 'maxTTL'].every(function(prop) {
        return typeof (config || {})[prop] === 'number';
    })) {
        throw new Error('Must provide a freshTTL and maxTTL.');
    }

    this.freshTTL = minutesToMilliseconds(config.freshTTL);
    this.maxTTL = minutesToMilliseconds(config.maxTTL);
    this.errorTTL = minutesToMilliseconds(config.errorTTL || (10/60));
    this.gcInterval = minutesToMilliseconds(config.gcInterval || 15);
    this.extractor = config.extractor || identity;
}

/**
 * Create a memoized version of a function.
 *
 * @method add
 * @param {Function} fn The source of the value. This function will only be called when the cache
 *     needs to be updated.
 * @param {Number} [arity] The number of arguments to pay attention to when checking for cache hits.
 *     If the number is negative, all arguments except the last *x* will be used. If not provided,
 *     all arguments will be used.
 * @return {Function} A memoized function.
 */
FunctionCache.prototype.add = function add(fn/*, arity*/) {
    var arity = typeof arguments[1] === 'number' ? arguments[1] : Infinity;

    var self = this;
    /*
     * Helper function to retrieve the cache (a simple object.)
     *
     * A cache entry has the following props:
     *
     * * value: The result of the last function call
     * * updateTime: Epoch time indicating the last time the value was updated
     * * error: A boolean indicating if the value is a rejected Promise
     */
    var getCache = (function() {
        var cache = null;

        function getCache() {
            var interval;

            if (!cache) {
                // Cache doesn't exist yet. Create one and start a GC interval.
                cache = {};
                interval = setInterval(function garbageCollect() {
                    var now = Date.now();

                    Object.keys(cache).forEach(function(key) {
                        var timeSinceLastUpdate = now - cache[key].updateTime;

                        if (timeSinceLastUpdate > self.maxTTL) {
                            delete cache[key];
                        }
                    });

                    // Cache has no more entries. Remove it and stop the GC job.
                    if (Object.keys(cache).length === 0) {
                        clearInterval(interval);
                        cache = null;
                    }
                }, self.gcInterval);
            }

            return cache;
        }
        getCache.reset = function reset() {
            cache = null;
        };

        return getCache;
    }());

    function cached() {
        var args = arguments;
        var cachedArgs = Array.prototype.slice.call(args, 0, arity);
        var cache = getCache(); // Lazy-create cache/GC interval
        var key = uuid.hashText(JSON.stringify(cachedArgs)).substr(0, 18);
        var entry = cache[key] || update(cache[key] = {}, true); // Init cache entry if non-exist
        var timeSinceLastUpdate = Date.now() - entry.updateTime;

        /*
         * Helper function to update a cache entry by calling the provided fn.
         *
         * If `force` is `true`, or the returned value is not a Promise, the entry will be
         * immediately updated. Otherwise, the entry will not be updated until after the Promise
         * fulfills.
         */
        function update(entry, force) {
            var value = fn.apply(null, args);
            var isThenable = value && (typeof value.then === 'function');

            if (force || !isThenable) {
                entry.value = value;
            } else {
                value.then(function update() { entry.value = value; });
            }

            if (isThenable) {
                value.catch(function error() { entry.error = true; });
            }

            entry.updateTime = Date.now();
            entry.error = false;

            return entry;
        }

        if (timeSinceLastUpdate > self.maxTTL) {
            update(entry, true); // maxTTL expired, force a refresh.
        } else if (timeSinceLastUpdate > self.freshTTL) {
            update(entry, false); // freshTTL expired, refresh in the background
        } else if (entry.error && timeSinceLastUpdate > self.errorTTL) {
            update(entry, true); // cached value is a rejected promise. errorTTL expired.
        }

        return self.extractor(entry.value);
    }
    cached.clear = function clear() {
        getCache.reset();
    };

    return cached;
};

module.exports = FunctionCache;
