var cp  = require('child_process'),
    q   = require('q');

function getHostname() {
    var cmd = 'hostname --fqdn',
        deferred = q.defer();
        
    cp.exec(cmd, function(error, stdout, stderr) {
        if (error || stderr) {
            deferred.reject(error || stderr);
        } else {
            deferred.resolve(stdout.trim());
        }
    });
    
    return deferred.promise;
}

module.exports = getHostname;
