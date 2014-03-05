var aws     = require('aws-sdk'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {
    grunt.registerTask('clear_snapshots', 'clear out old snapshots', function() {
        var settings    = grunt.config.get('settings'),
            auth        = settings.awsAuth,
            maxAge      = grunt.config.get('clear_snapshots.maxAge')*24*60*60*1000,
            done        = this.async(),
            opts        = { Filters: [{ Name: 'tag-value', Values: ['db-backup'] }] },
            now         = new Date();

        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        q.npost(ec2, 'describeSnapshots', [opts]).then(function(result) {
            if (!result || !result.Snapshots || result.Snapshots.length === 0) {
                grunt.log.writelns('No db-backup snapshots found');
                return q([]);
            }
            grunt.log.writelns('Found ' + result.Snapshots.length + ' db-backup snapshots');
            var oldSnaps = result.Snapshots.filter(function(snapshot) {
                return now - snapshot.StartTime > maxAge;
            });
            grunt.log.writelns(oldSnaps.length + ' snapshots are too old');
            return q.allSettled(oldSnaps.map(function(snapshot) {
                return q.npost(ec2, 'deleteSnapshot', [{SnapshotId: snapshot.SnapshotId}])
                .then(function() {
                    return q(snapshot.SnapshotId);
                }).catch(function(error) {
                    return q.reject('Id: ' + snapshot.SnapshotId + ', Reason: ' + JSON.stringify(error));
                });
            }));
        }).then(function(results) {
            var successes = 0, errors = 0, errormsg = '';
            results.forEach(function(result){
                if (result.state === 'fulfilled') {
                    grunt.log.writelns('Deleted ' + result.value);
                    successes++;
                } else {
                    grunt.log.errorlns(result.reason);
                    errors++;
                }
            });
            if (errors) {
                return q.reject();
            }
            if (successes) {
                grunt.log.writelns('Successfully deleted ' + successes + ' snapshots');
            } else {
                grunt.log.writelns('Did not delete any snapshots');
            }
            done(true);
        }).catch(function(error) {
            if (error) {
                grunt.log.errorlns(error);
            }
            done(false);
        });
    });
};
