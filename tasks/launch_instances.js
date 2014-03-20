var aws     = require('aws-sdk'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {

    /* converts instance names into ids */
    function convertInstanceIds(config){
        var deferred;
    
        if ((!config.data.startInstances) || (!config.data.startInstances.length)){
            return q(config);
        }
    
        if (config.data.startInstances.every(function(inst){
            return (inst.substr(0,2) === 'i-');
        })){
            return q(config);
        }
       
        deferred = q.defer();
        helpers.getEc2InstanceIds({ ec2 : config.ec2, params : {}})
        .then(function(idMap){
            config.data.startInstances.forEach(function(name,idx){
                if (idMap[name]){
                    config.data.startInstances[idx] = idMap[name];
                }
            });
            grunt.log.writelns('Converted: ' + config.data.startInstances);
            deferred.resolve(config);
        })
        .catch(function(err){
            deferred.reject(err);
        });
    
        return deferred.promise;
    }
    
    function startInstances(config){
        if ((!config.data.startInstances) || (!config.data.startInstances.length)){
            return q(config);
        }
    
        return q.ninvoke(config.ec2,'startInstances',{InstanceIds: config.data.startInstances})
        .then(function(data){
            grunt.log.writelns('Started: ' + config.data.startInstances.join(','));
            return config.data.startInstances; 
        })
        .catch(function(err){
            err.message = 'startInstances: ' + err.message;
            return q.reject(err);
        });
    }
    
    function launchInstances(config){
        return q.all(config.data.runInstances.map(function(rInst){
            var instId;
            return q.ninvoke(config.ec2,'runInstances',rInst.params).delay(3000)
            .then(function(data){
                instId = data.Instances[0].InstanceId;
                if (rInst.tags){
                    return q.ninvoke(config.ec2,'createTags',{
                        Resources : [ instId ],
                        Tags : rInst.tags
                    });
                }
                return {};
            })
            .then(function(data){
                return instId;
            });
        }))
        .then(function(results){
            grunt.log.writelns('Launched: ' + results);
            return results;
        })
        .catch(function(err){
            err.message = 'launchInstances: ' + err.message;
            return q.reject(err);
        });
    }

    grunt.registerMultiTask('launch_instances', 'launches ec2 instances', function() {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            done     = this.async(),
            config   = {
                data : this.data,
                opts : this.options(),
                ec2  : null
            };
            
            aws.config.loadFromPath(auth);
            
            config.ec2 = new aws.EC2();
            convertInstanceIds(config)
            .then(function(){
                return q.all([startInstances(config),launchInstances(config)]);
            })
            .then(function(results){
                var ids = [];
                results.forEach(function(r){
                    ids = ids.concat(r);
                });
                grunt.log.writelns('ALL STARTED AND LAUNCHED:' +
                    JSON.stringify(ids,null,3));
                return ids;
            })
            .then(function(ids){
                var stateOpts = {
                    ids     : ids,
                    state   : 'running',
                    interval: config.opts.stateInterval * 1000,
                    maxIters: config.opts.stateIters
                };
               
                grunt.log.writelns('CHECK INSTANCES');
                return helpers.checkInstance(stateOpts, config.ec2, 0);
            })
            .then(function(){
                grunt.log.writelns('Everything is running');
                done(true);
            })
            .catch(function(err){
                grunt.log.errorlns(err.message);
                done(false);
            });
    });
};

