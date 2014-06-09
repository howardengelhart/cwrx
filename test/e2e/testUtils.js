var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    aws         = require('aws-sdk'),
    mongoUtils  = require('../../lib/mongoUtils'),
    awsAuth     = process.env['awsAuth'] || path.join(process.env.HOME,'.aws.json'),
    
    testUtils = {};

testUtils.resetCollection = function(collection,data,userCfg){
    var dbEnv, db, coll, dbConfig;
    if (!userCfg){
        userCfg = process.env['mongo'] ? JSON.parse(process.env['mongo']) : {};
    }
    dbConfig = {
        host : userCfg.host ? userCfg.host : '33.33.33.100',
        // host : userCfg.host ? userCfg.host : 'localhost',
        port : userCfg.port ? userCfg.port : 27017,
        db   : userCfg.db   ? userCfg.db   : 'c6Db',
        user : userCfg.user ? userCfg.user : 'e2eTests',
        pass : userCfg.pass ? userCfg.pass : 'password'
    };
    
    return mongoUtils.connect(dbConfig.host,dbConfig.port,dbConfig.db,dbConfig.user,dbConfig.pass)
        .then(function(database){
            db      = database;
            coll    = db.collection(collection);
            if  (dbConfig.user){
                return q.npost(db, 'authenticate', [ dbConfig.user, dbConfig.pass]);
            }
            return q();
        })
        .then(function(){
            return q.npost(db, 'collectionNames', [collection]);
        })
        .then(function(names){
            if (names.length === 0 ) {
                return q();
            }
            return q.npost(coll, 'drop');
        })
        .then(function(){
            if (!data) {
                return q();
            }

            return q.npost(coll,'insert',[data, { w: 1, journal: true }]);
        })
        .then(function(){
            db.close();
        });
};

// files should be { file1: path, file2: path, ... }. They get appended as multipart/form-data uploads
testUtils.qRequest = function(method, opts, files) {
    var deferred = q.defer();
    opts.method = method;

    var req = request(opts, function(error, response, body) {
        if (error) return deferred.reject(error);
        if (!response) return deferred.reject({error: 'Missing response'});
        body = body || '';
        try {
            body = JSON.parse(body);
        } catch(e) {
        }
        if (body.error) return deferred.reject(body);
        deferred.resolve({response: response, body: body});
    });
    
    if (files && typeof files === 'object' && Object.keys(files).length > 0) {
        var form = req.form();
        Object.keys(files).forEach(function(key) {
            form.append(key, fs.createReadStream(files[key]));
        });
    }
    
    return deferred.promise;
}

testUtils.checkStatus = function(jobId, host, statusUrl, statusTimeout, pollInterval) {
    var interval, timeout,
        pollInterval = pollInterval || 5000,
        deferred = q.defer(),
        options = {
            url: statusUrl + jobId + '?host=' + host 
        };
    
    interval = setInterval(function() {
        qRequest('get', [options])
        .then(function(resp) {
            if (resp.response.statusCode !== 202) {
                clearInterval(interval);
                clearTimeout(timeout);
                deferred.resolve({
                    code: resp.response.statusCode,
                    data: resp.body
                });
            }
        }).catch(function(error) {
            clearInterval(interval);
            clearTimeout(timeout);
            deferred.reject(error);
        });
    }, pollInterval);
    
    timeout = setTimeout(function() {
        clearInterval(interval);
        deferred.reject('Timed out polling status of job');
    }, statusTimeout);
    
    return deferred.promise;
};

testUtils.removeS3File = function(bucket, key) {
    aws.config.loadFromPath(awsAuth);
    var s3 = new aws.S3(),
        deferred = q.defer(),
        params = { Bucket: bucket, Key: key };

    q.npost(s3, 'deleteObject', [params]).then(function() {
        deferred.resolve();
    }).catch(function(error) {
        deferred.reject('Error deleting ' + bucket + '/' + key + ' : ' + error);
    });
}

module.exports = testUtils;
