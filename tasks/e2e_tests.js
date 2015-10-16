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

    grunt.registerTask('e2e_tests', 'Run jasmine end-to-end tests', function(svc) {
        var ec2Data = grunt.config.get('ec2Data'),
            cacheCfgHost, cacheHost;

        if (svc) {
            grunt.config.set('jasmine.e2e.src', grunt.file.expand(grunt.config.get('jasmine.e2e.src')).filter(function(file) {
                return new RegExp('/' + svc + '(\\.[^\\.]+)*\\.e2e\\.').test(file);
            }));
        }
        if (grunt.option('testHost')) {
            process.env.host = lookupIp(ec2Data,grunt.option('testHost'),'public');
        }
        if (grunt.option('cacheCfgHost')) {
            cacheCfgHost = lookupIp(ec2Data,grunt.option('cacheCfgHost'),'private');
            process.env.cacheCfgHost = cacheCfgHost;
        }
        if (grunt.option('cacheCfgPort')) {
            process.env.cacheCfgPort = grunt.option('cacheCfgPort');
        }
        if (grunt.option('cacheHost')) {
            cacheHost = lookupIp(ec2Data,grunt.option('cacheHost'),'private');
            var port = grunt.option('cachePort') || 11211;
            process.env.cacheServer = cacheHost + ':' + port;
            if (!cacheCfgHost) {
                process.env.cacheCfgHost = cacheHost;
            }
        }
        if (grunt.option('bucket')) {
            process.env.bucket = grunt.option('bucket');
        }
        if (grunt.option('awsAuth')) {
            process.env.awsAuth = grunt.option('awsAuth');
        }
        if (grunt.option('getLogs')) {
            process.env.getLogs = grunt.option('getLogs');
        }
        if (grunt.option('dbHost')) {
            process.env.mongo = '{"host": "' +
                lookupIp(ec2Data,grunt.option('dbHost'),'private') + '"}';
        }
        if (grunt.option('e2e-config')){
            var cfgObj = JSON.parse(grunt.option('e2e-config'));
            for (var key in cfgObj){
                process.env[key] = cfgObj[key];
            }
        }

        grunt.log.writeln('Running e2e tests' + (svc ? ' for ' + svc : '') + ':');
        var sixxyDependentSvcs = ['userSvc'];
        var done = this.async();
        if(sixxyDependentSvcs.indexOf(svc) !== -1) {
            grunt.log.writeln('Ensuring the existance of the sixxy system user');
            var args = ['./scripts/sixxyUser.js'];
            var dbHost = grunt.option('dbHost');
            console.log('dbHost = ' + dbHost); //TODO
            if(dbHost) {
                args = args.concat(['--dbHost', dbHost]);
            }
            console.log(args);
            grunt.util.spawn({
                cmd: 'node',
                args: args,
                opts: {
                    stdio: 'inherit'
                }
            }, function(error, result, code) {
                grunt.task.run('jasmine:e2e');
                done(true);
            });
        } else {
            grunt.task.run('jasmine:e2e');
            done(true);
        }
    });
};
