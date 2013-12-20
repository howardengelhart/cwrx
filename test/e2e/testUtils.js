var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra');

function getLog(logFile, maintUrl, spec, testNum) {
    var options = {
        url: maintUrl + '/get_log?logFile=dub.log'
    };
    return q.npost(request, 'get', [options]).then(function(values) {
        if (!values[1]) return q.reject('Missing body');
        if (values[1].error) return q.reject(values[1]);
        if (spec && spec.results && spec.results().failedCount != 0) {
            console.log('\nRemote log for failed spec "' + spec.description + '":\n');
            console.log(values[1]);
            console.log('-------------------------------------------------------------------');
        }
        var fname = path.join(__dirname, 'logs/dub-light.test' + testNum + '.log');
        return q.npost(fs, 'outputFile', [fname, values[1]]);
    });
}

function checkStatus(jobId, host, statusUrl, statusTimeout) {
    var interval, timeout,
        deferred = q.defer(),
        options = {
            url: statusUrl + jobId + '?host=' + host 
        };
    
    interval = setInterval(function() {
        q.npost(request, 'get', [options])
        .then(function(values) {
            var data;
            try {
                data = JSON.parse(values[1]);
            } catch(e) {
                return q.reject(e);
            }
            if (data.error) return q.reject(data.error);
            if (values[0].statusCode !== 202) {
                clearInterval(interval);
                clearTimeout(timeout);
                deferred.resolve({
                    code: values[0].statusCode,
                    data: data
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
    getLog: getLog,
    checkStatus: checkStatus
};
