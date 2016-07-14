var grunt   = require('grunt'),
    q       = require('q');

var helpers = {
    promiseUntil : function (func, args, minInterval, repeatCount) {
        var deferred = q.defer(),
            callCount   = 0,
            repeatCount = repeatCount || 9999,
            minInterval = minInterval || 1000,
            lastCall;

        (function callAsync(){
            lastCall = new Date();
            if (callCount++ >= repeatCount){
                return deferred.reject(new Error('Call count exceeded repeat count'));
            }

            func.apply(null,args)
            .then(
                function(result){
                    return deferred.resolve(result);
                },
                function(err){
                    if (!deferred.promise.isPending()){
                        return;
                    }

                    deferred.notify(err);

                    var now  = new Date(),
                        wait = Math.max(Math.min(minInterval - (now.valueOf() - lastCall.valueOf()),
                                minInterval),0);
                    setTimeout(function(){
                        callAsync();
                    }, wait);
                }
            );
        }());

        deferred.promise.__timeout = deferred.promise.timeout;
        deferred.promise.timeout = function(n){
            return this.__timeout.apply(this,arguments)
                .catch(function(err){
                    deferred.reject(err);
                    return q.reject(err);
                });
        };

        return deferred.promise;
    },

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

    checkInstanceState: function(ec2, instanceIds, desiredState) {
        return q.ninvoke(ec2,'describeInstances',{InstanceIds: instanceIds})
            .then(function(data){
                var instances = [], ready = data.Reservations.every(function(reserv) {
                    return reserv.Instances.every(function(instance) {
                        instances.push(instance);
                        return (instance.State.Name === desiredState);
                    });
                });
                if (!ready){
                    return q.reject(new Error('Desired state not reached for all instances.'));
                }

                return instances;
            });
    },

    checkSSH: function(ip) {
        var deferred = q.defer();

        grunt.util.spawn({cmd: 'nc', args: ['-zv', ip, 22]}, function(error,result,code) {
            if (error) {
                return deferred.reject(error);
            } else {
                return deferred.resolve(ip);
            }
        });
        return deferred.promise;
    },

    checkHttp: function(params) {
        var deferred = q.defer(), server, opts, req;
        opts = {
            hostname : params.host || 'localhost',
            port     : params.port,
            path     : params.path,
            method   : 'GET'
        };

        if ((params.https) || (opts.port === 443)){
            server = require('https');
            if (!opts.port){
                opts.port = 443;
            }
        } else {
            server = require('http');
            if (!opts.port){
                opts.port = 80;
            }
        }

        req = server.request(opts,function(res){
            var data = '';
            res.setEncoding('utf8');
            res.on('data',function(chunk){
                data += chunk;
            });
            res.on('end',function(){
                if ((res.statusCode < 200) || (res.statusCode >= 300)){
                    var err = new Error(data);
                    err.httpCode = res.statusCode;
                    deferred.reject(err);
                    return;
                }

                if ((res.headers['content-type'] &&
                    res.headers['content-type'].match('application\/json'))){
                    data = JSON.parse(data);
                }

                deferred.resolve({
                    statusCode : res.statusCode,
                    data       : data
                });
            });
        });

        req.on('error',function(e){
            e.httpCode = 500;
            deferred.reject(e);
        });

        req.end();

        return deferred.promise;
    },

    getEc2InstanceData : function (opts){
        return q.ninvoke(opts.ec2,'describeInstances',opts.params)
        .then(function(data){
            var result = {
                _instances : []
            };
            data.Reservations.forEach(function(res){
                res.Instances.forEach(function(inst){
                    inst._tagMap = {};
                    inst.Tags.forEach(function(tag){
                        inst._tagMap[tag.Key] = tag.Value;
                    });
                    result._instances.push(inst);
                });
            });

            result.lookup = function(x){
                if (x.substr(0,2) === 'i-'){
                    return this.byId(x);
                }
                return this.byName(x);
            };

            result.byName = function(name){
                var r;
                this._instances.some(function(inst){
                    if (inst._tagMap.Name === name){
                        r = inst;
                        return true;
                    }
                });
                return r;
            };

            result.byId = function(id){
                var r;
                this._instances.some(function(inst){
                    if (inst.InstanceId === id){
                        r = inst;
                        return true;
                    }
                });
                return r;
            };

            return result;
        })
        .catch(function(err){
            err.message = 'getEc2InstanceData: ' + err.message;
            return q.reject(err);
        });
    }
}

module.exports = helpers;
