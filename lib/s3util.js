(function(){
    'use strict';

    var fs  = require('fs-extra'),
        q   = require('q'),
        s3util = {};

    s3util.getObject = function(s3, localFile, params){
        var actualParams = {};

        Object.keys(params).forEach(function(key){
            actualParams[key] = params[key];
        });

        return q.npost(s3, 'getObject', [actualParams]).then(function(data) {
            return q.npost(fs, 'writeFile', [localFile,data.Body])
            .then(function() {
                delete data.Body;

                data.s3util = {
                    localFile : localFile
                };

                return q(data);
            });
        });
    };

    s3util.putObject = function(s3, localFile, params){
        var actualParams = {},
            deferred = q.defer(),
            rs, once;
        Object.keys(params).forEach(function(key){
            actualParams[key] = params[key];
        });

        rs = fs.createReadStream(localFile);

        rs.on('readable', function(){
            if (once) { return; }
            once = true;

            actualParams.Body = rs;

            q.npost(s3,'putObject',[actualParams])
                .done(function(res){
                    deferred.resolve(res);
                },function(err){
                    deferred.reject(err);
                });
        });

        rs.on('error', function(err){
            deferred.reject(err);
        });

        return deferred.promise;
    };

    module.exports = s3util;
}());
