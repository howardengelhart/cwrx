(function(){
    'use strict';

    var q       = require('q'),
        fs      = require('fs-extra'),
        request = require('request'),
        util    = require('util'),
        net     = require('net'),
        requestUtils = {};

    /**
     * Wrap the request module and return a promise. The promise is rejected if request gets an
     * error or if the body has an error property. Otherwise, the promise is resolved with 
     * { response: {...}, body: {...} }. The client should handle non-2xx status codes appropriately
     * files is an optional parameter - if specified, it should take the form { file1: path, ... },
     * and the request will read those files and append them as uploads.
     */
    requestUtils.qRequest = function(method, opts, files) {
        var deferred = q.defer();
        opts.method = method;
        
        var req = request(opts, function(error, response, body) {
            if (error) {
                return deferred.reject({error: error});
            }
            if (!response) {
                return deferred.reject({error: 'Missing response'});
            }
            body = body || '';
            try {
                body = JSON.parse(body);
            } catch(e) {}
            
            if (body.error) {
                return deferred.reject({
                    code: response.statusCode,
                    headers: response.headers,
                    body: body
                });
            }
            deferred.resolve({response: response, body: body});
        });
        
        if (files && typeof files === 'object' && Object.keys(files).length > 0) {
            var form = req.form();
            Object.keys(files).forEach(function(key) {
                form.append(key, fs.createReadStream(files[key]));
            });
        }
        
        return deferred.promise;
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
