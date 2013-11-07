var crypto   = require('crypto'),
    hasher = {};

hasher.hashText = function(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
}

hasher.getObjId = function(prefix, item) {
    return prefix + '-' + hasher.hashText(
        process.env.host                    +
        process.pid.toString()              +
        process.uptime().toString()         + 
        (new Date()).valueOf().toString()   +
        (JSON.stringify(item))            +
        (Math.random() * 999999999).toString()
    ).substr(0,14);
}

module.exports = hasher;
