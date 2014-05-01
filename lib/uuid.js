(function(){
    'use strict';
    var crypto  = require('crypto'),
        fs      = require('fs-extra'),
        q       = require('q'),
        uuid = {};

    uuid.hashText = function(txt){
        var hash = crypto.createHash('sha1');
        hash.update(txt);
        return hash.digest('hex');
    };
    
    uuid.hashFile = function(fpath) {
        var stream = fs.createReadStream(fpath),
            hash = crypto.createHash('md5'),
            deferred = q.defer();

        stream.on('data', function(data) {
            hash.update(data);
        });
        stream.on('end', function() {
            deferred.resolve(hash.digest('hex'));
        });
        stream.on('error', function(error) {
            deferred.reject(error);
        });
        
        return deferred.promise;
    };

    uuid.createUuid = function(){
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
}());
