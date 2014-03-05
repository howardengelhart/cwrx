var path        = require('path'),
    fs          = require('fs-extra'),
    q           = require('q'),
    testUtils   = require('../test/e2e/testUtils');

module.exports = function(grunt) {
    grunt.registerTask('get_logs', 'Get and clear remote service logs', function(logfiles) {
        var host        = grunt.option('testHost') || 'localhost',
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
                return testUtils.qRequest('get', [getOpts])
            }).then(function(resp) {
                var fpath = path.join(dirPath, logfile);
                grunt.log.writeln("Remote log " + logfile + " stored in " + fpath);
                return q.npost(fs, 'outputFile', [fpath, resp.body]);
            }).then(function() {
                return testUtils.qRequest('post', [clearOpts]);
            }).then(function(resp) {
                console.log("Cleared remote log " + logfile);
                return q();
            });
            return deferred.promise;
        })).catch(function(error) {
            grunt.log.errorlns("Error getting and clearing logs:");
            grunt.log.errorlns(JSON.stringify(error));
            done(false);
        });
    });
};
