(function(){
    'use strict';

    var q           = require('q'),
        crypto      = require('crypto'),
        fs          = require('fs-extra'),
        hashUtils = {};

    // Return a hex digest of a hash of the string txt. Hashes with sha1 or second param.
    hashUtils.hashText = function(txt, alg){
        alg = alg || 'sha1';
        var hash = crypto.createHash(alg);
        hash.update(txt);
        return hash.digest('hex');
    };
    
    // Return a hex digest of a hash of the file at the given path. Hashes with sha1 or second param
    hashUtils.hashFile = function(fpath, alg) {
        alg = alg || 'md5';
        var stream = fs.createReadStream(fpath),
            hash = crypto.createHash(alg),
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
    
    module.exports = hashUtils;
}());
