var path            = require('path'),
    fs              = require('fs-extra'),
    q               = require('q'),
    requestUtils    = require('../lib/requestUtils');

module.exports = function(grunt) {
    function lookupIp(ec2Data, host,iface){
        var inst;
        if (!ec2Data){
            return host;
        }

        inst = ec2Data.byName(host);

        if (!inst){
            return host;
        }

        return (iface === 'public') ? inst.PublicIpAddress : inst.PrivateIpAddress;
    }

    grunt.registerTask('get_logs', 'Get and clear remote service logs', function(logfiles) {
        var ec2Data     = grunt.config.get('ec2Data'),
            host        = lookupIp(ec2Data,grunt.option('testHost')) || 'localhost',
            testNum     = grunt.option('testNum') || 1, // usually the Jenkins build number
            maintUrl    = 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
            done = this.async();
        if (!logfiles) {
            grunt.log.writeln('No logfiles argument so nothing to do');
            return done(true);
        }
        
        q.all(logfiles.split(',').map(function(logfile) {
            var getOpts = {
                    url: maintUrl + '/get_log?logFile=' + logfile
                },
                clearOpts = {
                    url: maintUrl + '/clear_log',
                    json: {
                        logFile: logfile
                    }                
                };
            
            var dirPath = 'logs/test' + testNum;
            return q.npost(fs, 'mkdirs', [dirPath])
            .then(function() {
                return requestUtils.qRequest('get', getOpts)
            }).then(function(resp) {
                var fpath = path.join(dirPath, logfile);
                grunt.log.writeln("Remote log " + logfile + " stored in " + fpath);
                return q.npost(fs, 'outputFile', [fpath, resp.body]);
            }).then(function() {
                return requestUtils.qRequest('post', clearOpts);
            }).then(function(resp) {
                console.log("Cleared remote log " + logfile);
                return q();
            });
            return deferred.promise;
        })).catch(function(error) {
            grunt.log.errorlns("Error getting and clearing logs:");
            grunt.log.errorlns(require('util').inspect(error));
            done(false);
        });
    });
};
