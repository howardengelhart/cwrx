var inherits = require('util').inherits;
var Readable = require('stream').Readable;
var zlib = require('zlib');
var promiseFromStream = require('./promise').fromStream;

/**
 * A readable stream that will emit the provided String as a Buffer.
 *
 * @class StringStream
 * @extends Readable
 * @constructor
 *
 * @param {String} string The string to emit as a Buffer.
 * @param {String} [encoding=utf8] Encoding for the String.
 */
function StringStream(string, encoding) {
    Readable.call(this);

    this.__private__ = {
        string: string,
        encoding: encoding
    };
}
inherits(StringStream, Readable);
StringStream.prototype._read = function _read() {
    var $private = this.__private__;

    this.push($private.string, $private.encoding);
    this.push(null);
};

/**
 * Used to gzip a Strings (and cache the results.)
 *
 * @class Zipper
 * @constructor
 */
function Zipper() {
    this.__private__ = {
        cache: {}
    };
}

/**
 * Encode the specified String using GZIP and cache the return value by String + options.
 *
 * @method gzip
 * @param {String} string The String to encode.
 * @param {Object} [options] Any valid zlib options.
 * @return {Promise} A Promise that will be fulfilled with a Buffer representing the GZIPped data.
 */
Zipper.prototype.gzip = function gzip(string, options) {
    var key = (options ? JSON.stringify(options) : '') + string;
    var cache = this.__private__.cache;

    return cache[key] || (cache[key] = Zipper.gzip(string, options));
};

module.exports = Zipper;

Zipper.StringStream = StringStream;

/**
 * Encode the specified String using GZIP.
 *
 * @method gzip
 * @param {String} string The String to encode.
 * @param {Object} [options] Any valid zlib options.
 * @return {Promise} A Promise that will be fulfilled with a Buffer representing the GZIPped data.
 */
Zipper.gzip = function gzip(string, options) {
    return promiseFromStream(new this.StringStream(string).pipe(zlib.createGzip(options)));
};
