(function(){
    'use strict';
    var cp  = require('child_process'),
        os  = require('os'),
        q   = require('q'),
        
    hostUtils = {};

    hostUtils.getHostname = function(full) {
        var cmd = full ? 'hostname --fqdn' : 'hostname',
            deferred = q.defer();
            
        cp.exec(cmd, function(error, stdout, stderr) {
            if (error || stderr) {
                deferred.reject(error || stderr);
            } else {
                deferred.resolve(stdout.trim());
            }
        });
        
        return deferred.promise;
    };
    
    hostUtils.getIp = function() {
        var ifaces = os.networkInterfaces(),
            ifaceNames = Object.keys(ifaces);
            
        for (var i in ifaceNames) {
            var iface = ifaces[ifaceNames[i]];
            
            for (var j in iface) {
                if (iface[j].internal === false && iface[j].family === 'IPv4') {
                    return iface[j].address;
                }
            }
        }
        
        return '127.0.0.1';
    };

    module.exports = hostUtils;
}());
