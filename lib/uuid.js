var __ut__ = ((module.parent) && (module.parent.filename) &&
             (module.parent.filename.match(/uuid.spec.js$/))),
    crypto = require('crypto'),
    
    uuid = {};

uuid.hashText = function(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
};

uuid.id = function(){
    var  result = '', digit;
       
    for (var i =0; i < 40; i++){
        digit = Math.floor(Math.random() * 999999999) % 36;
        if (digit < 26){
            result += String.fromCharCode(digit + 97);
        } else {
            result += (digit - 26).toString();
        }
    }

    return uuid.hashText(result);
};

module.exports = uuid;
