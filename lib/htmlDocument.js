var Zipper = require('./zipper');
var q = require('q');
var concat = Array.prototype.concat;

var zipper = new Zipper();

function copyState(original, copy) {
    var $private = original.__private__;

    copy.__private__ = {
        start: $private.start,
        end: $private.end,
        resources: $private.resources.slice(),
        gzip: $private.gzip
    };

    return copy;
}

/**
 * Represents an HTML document. Has methods to add static resources to the document as <script>s.
 *
 * @class HTMLDocument
 * @constructor
 *
 * @param {String} html A String of HTML
 * @param {Object} [options] Configuration options
 * @param {Object} [options.gzip] GZIP configuration options
 * @param {Number} [options.gzip.static=9] GZIP compression level for static document HTML
 * @param {Number} [options.gzip.resource=1] GZIP compression level for inlined document resources
 */
function HTMLDocument(html/*, options*/) {
    var options = arguments[1] || {};
    var gzip = options.gzip || {};

    var headPosition = html.indexOf('</head>');

    this.__private__ = {
        start: html.substring(0, headPosition),
        end: html.substring(headPosition),
        resources: [],
        gzip: {
            static: { level: gzip.static || 9 },
            resource: { level: gzip.resource || 1 }
        }
    };
}

/**
 * Adds a static resource to the document.
 *
 * @method addResource
 * @param {String} src The original source location of the resource. Will be added to the <script>
 *     as a data-src attribute.
 * @param {String} type MIME type of the resource (e.g. application/json, text/plain, etc.)
 * @param {String|Object} contents The contents of the resource. If it is an Object, it will be
 *     `JSON.stringify`ed.
 * @chainable
 */
HTMLDocument.prototype.addResource = function addResource(src, type, contents) {
    var safeContents = (typeof contents === 'object' ? JSON.stringify(contents) : contents)
        .replace(/<\//g, '<\\/');
    var script = '<script type="' + type + '" data-src="' + src + '">' + safeContents + '</script>';

    this.__private__.resources.push(script);

    return this;
};

/**
 * Efficiently makes a copy of the HTMLDocument.
 *
 * @method clone
 * @return {HTMLDocument} A copy of the document.
 */
HTMLDocument.prototype.clone = function clone() {
    return copyState(this, Object.create(HTMLDocument.prototype));
};

/**
 * Return the document as a String of HTML.
 *
 * @method toString
 * @return {String} The document in HTML.
 */
HTMLDocument.prototype.toString = function toString() {
    var $private = this.__private__;

    return $private.start + $private.resources.join('') + $private.end;
};

/**
 * GZIPs the HTML asynchronously using configured compression levels (or defaults if none are
 * provided.)
 *
 * @method gzip
 * @return {Promise} A promise that will fulfill with a Buffer representing the gzipped document.
 */
HTMLDocument.prototype.gzip = function gzip() {
    var $private = this.__private__;

    return q.all(concat.call(
        zipper.gzip($private.start, $private.gzip.static),
        $private.resources.map(function(resource) {
            return zipper.gzip(resource, $private.gzip.resource);
        }),
        zipper.gzip($private.end, $private.gzip.static)
    )).then(Buffer.concat);
};

module.exports = HTMLDocument;
