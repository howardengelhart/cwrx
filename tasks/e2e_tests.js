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

        return (iface === 'private') ? inst.PrivateIpAddress : inst.PublicIpAddress;
    }

    grunt.registerTask('e2e_tests', 'Run jasmine end-to-end tests', function(svc) {
        var done = this.async(),
            ec2Data = grunt.config.get('ec2Data'),
            args = ['--test-dir', 'test/e2e/', '--captureExceptions', '--junitreport', '--output',
                    'reports/e2e/'];
        if (svc) {
            var regexp = '^' + svc + '\\.e2e\\.';
            args.push('--match', regexp);
        }
        if (grunt.option('testHost')) {
            args.push('--config', 'host', lookupIp(ec2Data,grunt.option('testHost'),'public'));
        }
        if (grunt.option('statusHost')) {
            args.push('--config', 'statusHost',
                lookupIp(ec2Data,grunt.option('statusHost'),'public'));
        }
        if (grunt.option('bucket')) {
            args.push('--config', 'bucket', grunt.option('bucket'));
        }
        if (grunt.option('getLogs')) {
            args.push('--config', 'getLogs', grunt.option('getLogs'));
        }
        if (grunt.option('dbHost')) {
            args.push('--config', 'mongo', '{"host": "' +
                lookupIp(ec2Data,grunt.option('dbHost'),'private') + '"}');
        }
        if (grunt.option('e2e-config')){
            var cfgObj = JSON.parse(grunt.option('e2e-config'));
            for (var key in cfgObj){
                args.push('--config',key,cfgObj[key]);
            }
        }

        grunt.log.writeln('Running e2e tests' + (svc ? ' for ' + svc : '') + ':');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('e2e tests failed: ' + error);
                done(false);
                return;
            }

            if (result.stdout.match(/0 tests, 0 assertions, 0 failures/)){
                grunt.log.errorlns('No e2e tests were run!');
                done(false);
                return;
            }
            done(true);
        });
    });
};
