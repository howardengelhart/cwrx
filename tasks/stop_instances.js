var aws     = require('aws-sdk'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {
    grunt.registerTask('stop_instances', 'stops the test instances', function(idString) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = grunt.config.get('stop_instances.pollingInterval') * 1000,
            maxIters = grunt.config.get('stop_instances.maxIters'),
            ids = idString.split(',');
        
        if (!ids) {
            grunt.log.errorlns('Need to provide an instance id or comma-separated string of ids');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Stopping instances ' + ids.toString());
        ec2.stopInstances({InstanceIds: ids}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            var stateOpts = {
                ids: ids,
                state: 'stopped',
                interval: interval,
                maxIters: maxIters
            };
            
            helpers.checkInstance(stateOpts, ec2, 0)
            .then(function(ips) {
                grunt.log.writelns('All instances have stopped');
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });
};
