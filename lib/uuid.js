(function(){'use strict';}());
var __ut__ = ((module.parent) && (module.parent.filename) &&
             (module.parent.filename.match(/uuid.spec.js$/))),
    crypto = require('crypto');

function uuid(){
    var  result = '', digit,
        hash = crypto.createHash('sha1');
       
    for (var i =0; i < 40; i++){
        digit = Math.floor(Math.random() * 999999999) % 36;
        if (digit < 26){
            result += String.fromCharCode(digit + 97);
        } else {
            result += (digit - 26).toString();
        }
    }

    hash.update(result);
    return hash.digest('hex');
}

module.exports = uuid;
