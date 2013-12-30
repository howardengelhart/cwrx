var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra');

function qRequest(method, opts) {
    var deferred = q.defer();
    
    q.npost(request, method, opts)
    .then(function(values) {
        if (!values) return q.reject({error: 'Received no data'});
        if (!values[0]) return q.reject({error: 'Missing response'});
        if (!values[1]) return q.reject({error: 'Missing body'});
        var body = values[1];
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

function getLog(logFile, maintUrl, spec, testName, testNum) {
    var options = {
        url: maintUrl + '/get_log?logFile=dub.log'
    };
    return qRequest('get', [options])
    .then(function(resp) {
        if (spec && spec.results && spec.results().failedCount != 0) {
            console.log('\nRemote log for failed spec "' + spec.description + '":\n');
            console.log(resp.body);
            console.log('-------------------------------------------------------------------');
        }
        var fname = path.join(__dirname, 'logs/' + testName + '.test' + testNum + '.log');
        return q.npost(fs, 'outputFile', [fname, resp.body]);
    });
}

function checkStatus(jobId, host, statusUrl, statusTimeout) {
    var interval, timeout,
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
    }, 5000);
    
    timeout = setTimeout(function() {
        clearInterval(interval);
        deferred.reject('Timed out polling status of job');
    }, statusTimeout);
    
    return deferred.promise;
}

module.exports = {
    qRequest: qRequest,
    getLog: getLog,
    checkStatus: checkStatus
};
