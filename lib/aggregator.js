var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

/**
 * Collects values and calculates aggregate data for the values.
 *
 * @class Aggregator
 * @extends EventEmitter
 * @constructor
 *
 * @property {Array} values The values that have been added to the aggregator.
 * @property {Number} length The number of values the aggregator has collected.
 */
function Aggregator() {
    this.values = [];
}
inherits(Aggregator, EventEmitter);
Object.defineProperties(Aggregator.prototype, {
    length: {
        get: function() {
            return this.values.length;
        }
    }
});

/**
 * Adds a value to the aggregator.
 *
 * @method push
 * @param {any} value The value to add.
 * @return {Number} The total number of values.
 */
Aggregator.prototype.push = function push(value) {
    var length = this.values.push(value);

    this.emit('newValue', value, length);

    return length;
};
/**
 * Emitted when a new value is added to the aggregator.
 *
 * @event newValue
 * @param {any} value The value that was added.
 * @param {Number} length The total number of values.
 */

/**
 * Calculates and returns aggregate data for the values.
 *
 * @method getAggregateData
 * @return {Object} With the following params:
 *     * max: The highest number of the values
 *     * min: The smallest number of the values
 *     * sampleSize: The number of values
 *     * sum: The sum of all the values
 */
Aggregator.prototype.getAggregateData = function getAggregateData() {
    return {
        max: Math.max.apply(null, this.values),
        min: Math.min.apply(null, this.values),
        sampleSize: this.length,
        sum: this.values.reduce(function(total, value) { return total + value; }, 0)
    };
};

/**
 * Gets the aggregate data, then clears all values.
 *
 * @method flush
 * @return {Object} The aggregate data.
 */
Aggregator.prototype.flush = function flush() {
    var data = this.getAggregateData();

    this.values.length = 0;
    this.emit('flush', data);

    return data;
};
/**
 * Emitted when the aggregator is flushed.
 *
 * @event flush
 * @param {Object} data The aggregate data.
 */

/**
 * Schedules a task that will call flush() at the specified interval.
 *
 * @method autoflush
 * @param {Number} interval The interval at which to flush. If `0` is specified, any existing
 *     interval will be cleared.
 */
Aggregator.prototype.autoflush = function autoflush(interval) {
    var intervalId = null;

    if (!interval) {
        delete this.autoflush;
        return;
    }

    intervalId = setInterval(this.flush.bind(this), interval);
    this.autoflush = function autoflush() {
        clearInterval(intervalId);

        return Aggregator.prototype.autoflush.apply(this, arguments);
    };
};

module.exports = Aggregator;
