'use strict';

var Readable = require('stream').Readable;
var inherits = require('util').inherits;

function MockReadable(source) {
    Readable.apply(this, arguments);

    this.__private__ = {
        data: source.split('\n').map(function(item, index) {
            return new Buffer((index === 0 ? '' : '\n') + item);
        })
    };
}
inherits(MockReadable, Readable);

MockReadable.prototype._read = function _read() {
    var self = this;

    function push() {
        var data = self.__private__.data.shift() || null;

        if (self.push(data)) { push(); }
    }

    process.nextTick(push);
};

module.exports = MockReadable;
