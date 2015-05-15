(function(){
    'use strict';

    var q           = require('q'),
        fs          = require('fs-extra'),
        request     = require('request'),
        util        = require('util'),
        net         = require('net'),
        urlLib      = require('url'),
        objUtils    = require('./objUtils'),
        requestUtils = {};

    /**
     * Wrap the request module and return a promise. The promise is rejected if request gets an
     * error or if the body has an error property. Otherwise, the promise is resolved with 
     * { response: {...}, body: {...} }. The client should handle non-2xx status codes appropriately
     * files is an optional parameter - if specified, it should take the form { file1: path, ... },
     * and the request will read those files and append them as uploads.
     * jobPolling is enabled by default, and will poll the API for a job result if a 202 is returned
     */
    requestUtils.qRequest = function(method, opts, files, jobPolling) {
        jobPolling = jobPolling || {};
        objUtils.extend(jobPolling, {
            enabled: true,
            attempts: 0,
            maxAttempts: 15,
            delay: 2000,
            deferred: q.defer(),
        });
        opts.method = method;
        
        var req = request(opts, function(error, response, body) {
            if (error) {
                return jobPolling.deferred.reject({error: error});
            }
            if (!response) {
                return jobPolling.deferred.reject({error: 'Missing response'});
            }
            body = body || '';
            try {
                body = JSON.parse(body);
            } catch(e) {}
            
            if (body.error) {
                return jobPolling.deferred.reject({
                    code: response.statusCode,
                    headers: response.headers,
                    body: body
                });
            }
            
            // If jobPolling disabled, or not a 202 response, return normally
            if (!jobPolling.enabled || response.statusCode !== 202 || !body.url) {
                return jobPolling.deferred.resolve({response: response, body: body});
            }
            
            jobPolling.attempts++;
            
            if (jobPolling.attempts > jobPolling.maxAttempts) {
                return jobPolling.deferred.reject('Timed out getting job result after ' +
                                                  jobPolling.maxAttempts + ' attempts');
            }
        
            setTimeout(function() {
                var origUrl = urlLib.parse(opts.url),
                    newUrl = urlLib.format({
                        protocol    : origUrl.protocol,
                        host        : origUrl.host,
                        pathname    : body.url
                    });
                
                requestUtils.qRequest('get', { url: newUrl }, null, jobPolling);
            }, jobPolling.delay);
        });
        
        if (files && typeof files === 'object' && Object.keys(files).length > 0) {
            var form = req.form();
            Object.keys(files).forEach(function(key) {
                form.append(key, fs.createReadStream(files[key]));
            });
        }
        
        return jobPolling.deferred.promise;
    };
    
    requestUtils.portScan = function(host, port, timeout) {
        var deferred = q.defer(),
            sock = net.connect({host: host, port: port});
        
        sock.setTimeout(timeout, function() {
            deferred.reject('Connection timed out after ' + timeout + ' ms');
            sock.destroy();
        });
        
        sock.on('connect', function() {
            deferred.resolve(true);
            sock.destroy();
        })
        .on('error', function(error) {
            deferred.reject('Connection received error: ' + util.inspect(error));
            sock.destroy();
        });
        
        return deferred.promise;
    };
    
    module.exports = requestUtils;

}());
