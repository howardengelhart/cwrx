var aws     = require('aws-sdk'),
    url     = require('url'),
    q       = require('q'),
    helpers = require('./resources/helpers');


module.exports = function(grunt) {

    function autoScalingGroupsToInstances(config){
        var params = {
            AutoScalingGroupNames : config.asgNames
        }, instanceIdMap;
        return q.ninvoke(config.asg,'describeAutoScalingGroups',params)
            .then(function(data){
                data.AutoScalingGroups.forEach(function(group){
                    group.Instances.forEach(function(inst){
                        if ((inst.LifecycleState !== 'Terminating') &&
                            (inst.LifecycleState !== 'Terminated') ){
                            if (!instanceIdMap){
                                instanceIdMap = {};
                            }
                            instanceIdMap[inst.InstanceId] = group.AutoScalingGroupName;
                        }
                    });
                });
                if (!instanceIdMap){
                    return q.reject(new Error('Failed to locate any Active ASG instances!'));
                }
                return Object.keys(instanceIdMap);
            })
            .then(function(instances){
                return q.ninvoke(config.ec2,'describeInstances', { InstanceIds : instances });
            })
            .then(function(results){
                config.instanceList = [];
                results.Reservations.forEach(function(result){
                    var inst = result.Instances[0];
                    inst.__asgName = instanceIdMap[inst.InstanceId];
                    config.instanceList.push(inst);
                });

                if (config.instanceList.length === 0){
                    return q.reject(new Error('Failed to get data for ASG instances!'));
                }
                return config;
            });
    }

    function checkInstances(config){
        return q.all(config.instanceList.map(function(instance){
            var params = {
                path  : config.checkParams.path,
                https : (config.checkParams.protoco === 'https'),
                port  : config.checkParams.port,
                host  : instance.PublicIpAddress
            };
       
            return helpers.checkHttp(params)
            .then(function(result){
                var data = (grunt.util.kindOf(result.data) !== 'string') ?
                    JSON.stringify(result.data) : result.data;
                if ((config.httpExpects) && (result.data !== config.httpExpects)){
                    return q.reject(new Error('invalid http response: ' + data));
                }

                return config;
            })
            .catch(function(err){
                return q.reject(new Error('Instance ' + instance.InstanceId +
                    ' http check failed: ' + err.message));
            });

        }));
    }

    function repeatCheck(config){
        return helpers.promiseUntil(checkInstances, [ config ],
            config.checkInterval * 1000).timeout(config.checkTimeout * 1000)
            .then(function(){
                return config;
            })
            .progress(function(err){
                grunt.log.writelns('checking...');
                grunt.log.debug('check failure:' + err.message );
            });
    }

    grunt.registerTask('as_check', 'http checks auto-scaling instances', function(asg) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            done     = this.async(),
            config   = {};
            
            aws.config.loadFromPath(auth);
            
            config.checkParams   = url.parse(grunt.option('check-url'));
            config.checkInterval = parseInt((grunt.option('check-interval') || '30') ,10);
            config.checkTimeout  = parseInt((grunt.option('check-timeout')  || '600'),10);
            config.httpExpects   = grunt.option('check-response');
            config.asgNames      = asg.split(',');
           
            if (!config.asgNames || config.asgNames.length === 0){
                grunt.log.errorlns('Specify at least one group');
                return done(false);
            }

            if (!config.checkParams.path){
                grunt.log.errorlns('Command line argument check-url is not valid.');
                return done(false);
            }
            
            config.asg = new aws.AutoScaling();
            config.ec2 = new aws.EC2();
            
            autoScalingGroupsToInstances(config)
            .then(repeatCheck)
            .then(function(config){
                grunt.log.ok('Checks passed on ' + config.instanceList.length +
                   ((config.instanceList.length > 1) ? ' instances.' : ' instance.' ));
                return done(true);
            })
            .catch(function(err){
                grunt.log.errorlns(err.message);
                return done(false);
            });
    });
};
