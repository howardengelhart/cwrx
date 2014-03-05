var grunt   = require('grunt'),
    q       = require('q');

var helpers = {
    checkSnapshot: function(opts, ec2, iters, promise) {
        var deferred = promise || q.defer();
        grunt.log.writelns('Polling snapshot ' + opts.id + ' for its state');
        ec2.describeSnapshots({SnapshotIds: [opts.id]}, function(err, data) {
            if (err) {
                return deferred.reject(err);
            }
            if (!data || !data.Snapshots) {
                return deferred.reject('Incomplete information from describeSnapshots');
            }
            
            if (data.Snapshots[0].State !== opts.state) {
                iters++;
                if (iters >= opts.maxIters) {
                    return deferred.reject('Timed out after ' + iters + ' iterations');
                }
                setTimeout(helpers.checkSnapshot, opts.interval, opts, ec2, iters, deferred);
            } else {
                deferred.resolve(data.Snapshots[0]);
            }
        });
        return deferred.promise;
    },
    
    // tags should be an array of the form [ { Key: '...', Value: '...' } ]
    tagSnapshot: function(id, tags, ec2) {
        var deferred = q.defer();
        grunt.log.writelns('Tagging ' + id + ' with tags: ' + JSON.stringify(tags));
        ec2.createTags({Resources: [ id ], Tags: tags}, function(err, data) {
            if (err) {
                return deferred.reject(err);
            }
            grunt.log.writelns('Successfully tagged ' + id);
        });
        return deferred.promise;
    },

    checkInstance: function(opts, ec2, iters, promise) {
        var deferred = promise || q.defer(),
            ips = [],
            notReady = false;
        grunt.log.writelns('Polling instances ' + opts.ids.toString() + ' for their state');
        ec2.describeInstances({InstanceIds: opts.ids}, function(err, data) {
            if (err) {
                return deferred.reject(err);
            }
            if (!data || !data.Reservations) {
                return deferred.reject('Incomplete information from describeInstances');
            }
            
            data.Reservations.forEach(function(reserv) {
                reserv.Instances.forEach(function(instance) {
                    if (instance.State.Name === opts.state) {
                        ips.push(instance.PrivateIpAddress);
                    } else {
                        notReady = true;
                    }
                });
            });
            
            if (notReady) {
                iters++;
                if (iters >= opts.maxIters) {
                    return deferred.reject('Timed out after ' + iters + ' iterations');
                }
                setTimeout(helpers.checkInstance, opts.interval, opts, ec2, iters, deferred);
            } else {
                deferred.resolve(ips);
            }
        });
        return deferred.promise;
    },
    
    checkSSH: function(opts, iters, promise) {
        var deferred = promise || q.defer();
            
        grunt.log.writelns('Checking if instance ' + opts.ip + ' is accessible by SSH');
        grunt.util.spawn({cmd: 'nc', args: ['-zv', opts.ip, 22]}, function(error,result,code) {
            if (error) {
                iters++;
                if (iters >= opts.maxiters) {
                    return deferred.reject('Timed out after ' + iters + ' iterations');
                    return;
                }
                setTimeout(helpers.checkSSH, opts.interval, opts, iters, deferred);
                return;
            } else {
                grunt.log.writelns('Can ssh into instance ' + opts.ip);
                return deferred.resolve();
            }
        });
        return deferred.promise;
    }
}

module.exports = helpers;
