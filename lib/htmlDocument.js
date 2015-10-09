function copyState(original, copy) {
    copy.__private__ = {
        start: original.__private__.start,
        end: original.__private__.end,
        resources: original.__private__.resources.slice()
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
 */
function HTMLDocument(html) {
    var headPosition = html.indexOf('</head>');

    this.__private__ = {
        start: html.substring(0, headPosition),
        end: html.substring(headPosition),
        resources: []
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

module.exports = HTMLDocument;
