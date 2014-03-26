var aws     = require('aws-sdk'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {
    grunt.registerTask('start_instances', 'starts instances for running tests', function(idString) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            stateInterval = grunt.config.get('start_instances.stateInterval') * 1000,
            stateIters = grunt.config.get('start_instances.stateIters'),
            sshInterval = grunt.config.get('start_instances.sshInterval') * 1000,
            sshIters = grunt.config.get('start_instances.sshIters');
            ids = idString.split(',');
        
        if (!ids) {
            grunt.log.errorlns('Need to provide an instance id or comma-separated string of ids');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Starting instances ' + ids.toString());
        ec2.startInstances({InstanceIds: ids}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            var stateOpts = {
                ids: ids,
                state: 'running',
                interval: stateInterval,
                maxIters: stateIters
            };
            
            helpers.checkInstance(stateOpts, ec2, 0)
            .then(function(ips) {
                grunt.log.writelns('All instances are in the running state');
                return q.all(ips.map(function(ip) {
                    grunt.log.writelns('Check SSH for: ' + ip);
                    return helpers.promiseUntil(helpers.checkSSH, [ ip ], sshInterval)
                        .timeout(sshInterval * sshIters)
                        .then(function(result){
                            grunt.log.writelns('Can ssh to ip: ' + ip);
                            return result;
                        });
                }));
            }).then(function() {
                grunt.log.writelns('All instances are ready to go!');
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });
};
