var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    mongoUtils  = require('../../lib/mongoUtils');


function resetCollection(collection,data,dbConfig){
    var dbEnv, db, coll;
    if (!dbConfig){
        dbEnv = process.env['mongo'] ? JSON.parse(process.env['mongo']) : {};
        dbConfig = {
            host : dbEnv.host ? dbEnv.host : 'localhost',
            port : dbEnv.port ? dbEnv.port : 27017,
            db   : dbEnv.db   ? dbEnv.db   : 'c6Db',
            user : dbEnv.user ? dbEnv.user : 'e2eTests',
            pass : dbEnv.pass ? dbEnv.pass : 'password'
        };
    }

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
}

function qRequest(method, opts) {
    var deferred = q.defer();
    if (!(opts instanceof Array)) {
        opts = [opts];
    }
    q.npost(request, method, opts)
    .then(function(values) {
        if (!values) return q.reject({error: 'Received no data'});
        if (!values[0]) return q.reject({error: 'Missing response'});
        var body = values[1] || '';
        try {
            body = JSON.parse(body);
        } catch(e) {
        }
        if (body.error) return q.reject(body);
        deferred.resolve({response: values[0], body: body});
    }).catch(function(error) {
        deferred.reject(error);
    });
    
    return deferred.promise;
}

function checkStatus(jobId, host, statusUrl, statusTimeout, pollInterval) {
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
}

module.exports = {
    qRequest: qRequest,
    checkStatus: checkStatus,
    resetCollection : resetCollection
};
