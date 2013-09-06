(function(){'use strict';}());

var fs       = require('fs-extra'),
    path     = require('path'),
    q        = require('q');


function getObject(s3,params,localFile){
    var deferred    = q.defer(),
        actualParams = {};

    Object.keys(params).forEach(function(key){
        actualParams[key] = params[key];
    });
    
    s3.getObject(actualParams,function(err,data){
        
        if (err){
            deferred.reject(err);
            return;
        }

        fs.writeFile(localFile,data.Body,function(err){
            if (err){
                deferred.reject(err);
                return;
            }

            delete data.Body;

            data.s3util = {
                localFile : localFile
            };

            deferred.resolve(data);
        });
    });

    return deferred.promise;
}

function headObject(s3,params){
    return q.npost(s3,"headObject",[params]);
}

function putObject(s3, localFile, params){
    var deferred = q.defer(), actualParams = {}, rs, once;
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
}

function deleteObject(s3, params){
    return q.npost(s3,'deleteObject',[params]);
}



module.exports.getObject  = getObject;
module.exports.headObject = headObject;
module.exports.putObject  = putObject;
module.exports.deleteObject = deleteObject;
