var aws     = require('aws-sdk'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {
    grunt.registerTask('create_snapshot', 'create a snapshot of an EBS volume', function(volumeId) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = grunt.config.get('create_snapshot.pollingInterval') * 1000,
            maxIters = grunt.config.get('create_snapshot.maxIters'),
            desc     = grunt.option('description') ||
                           'Created from ' + volumeId + ' on ' + new Date().toString();
        
        if (!volumeId) {
            grunt.log.errorlns('Need to provide a volumeId');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Creating snapshot of volume ' + volumeId);
        ec2.createSnapshot({VolumeId: volumeId, Description: desc}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            if (!data || !data.SnapshotId) {
                grunt.log.errorlns('Incomplete information from creating the snapshot:');
                grunt.log.errorlns(JSON.stringify(data));
                return done(false);
            }
            var checkOpts = {
                id: data.SnapshotId,
                state: 'completed',
                interval: interval,
                maxIters: maxIters
            };
            grunt.log.writelns('Created snapshot ' + data.SnapshotId);
            helpers.checkSnapshot(checkOpts, ec2, 0)
            .then(function(snapshot) {
                grunt.log.writelns('Snapshot ' + snapshot.SnapshotId + ' is completed');
                var tags = [{Key: 'Name', Value: 'db-backup'}];
                return helpers.tagSnapshot(snapshot.SnapshotId, tags, ec2);
            }).then(function() {
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });
};
