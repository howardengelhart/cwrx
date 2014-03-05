module.exports = function(grunt) {
    grunt.registerTask('unit_tests', 'Run jasmine unit tests', function(svc) {
        var done = this.async(),
            args = ['--test-dir', 'test/unit/', '--captureExceptions', '--junitreport', '--output',
                    'reports/unit/'];
        
        if (svc) {
            var regexp = '^(' + svc + '(\\.[^\\.]+)?\\.svc|[^\\.]+\\.(?!svc))\\.?';
            args.push('--match', regexp);
        }
        grunt.log.writeln('Running unit tests' + (svc ? ' for ' + svc : '') + ':');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('unit tests failed: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });
};
