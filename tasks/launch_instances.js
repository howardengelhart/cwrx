var aws     = require('aws-sdk'),
    fs      = require('fs'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {

    function loadInstanceData(config){
        var deferred;
    
        deferred = q.defer();
        helpers.getEc2InstanceData({ ec2 : config.ec2, params : {
            Filters : [ {
                Name   : 'tag:Owner' ,
                Values : [config.opts.owner]
            } ]
        }})
        .then(function(results){
            config.instanceData = results;
            deferred.resolve(config);
        })
        .catch(function(err){
            deferred.reject(err);
        });
    
        return deferred.promise;
    }

    function checkStartInstances(config){
        var err;
        if ((!config.data.startInstances) || (!config.data.startInstances.length)){
            return q(config);
        }

        if (!config.data.startInstances.every(function(n){
            var inst;
            if (n.substr(0,2) === 'i-'){
                inst = config.instanceData.byId(n);
            } else {
                inst = config.instanceData.byName(n);
            }

            if (!inst){
                err = new Error('Unable to locate instance: ' + n); 
                return false;
            }

            if (inst._tagMap.Lock){
                err = new Error('Instance ' + n + ' is locked: ' + inst._tagMap.Lock); 
                return false;
            }

            return true;
        })){
            if (err){
                return q.reject(err);
            }
        }

        return q(config);
    }
    
    function checkRunInstances(config){
        var err;
        if ((!config.data.runInstances) || (!config.data.runInstances.length)){
            return q(config);
        }

        if (!config.data.runInstances.every(function(rInst,index){
            if (!rInst.name){
                err = new Error('Instance ' + index + ' needs a name!'); 
            }
          
            var inst = config.instanceData.byName(rInst.name);

            if (inst && inst._tagMap.Lock){
                err = new Error('Instance ' + rInst.name + ' is locked: ' + inst._tagMap.Lock); 
                return false;
            }

            return true;
        })){
            if (err){
                return q.reject(err);
            }
        }

        return q(config);
    }
    
    function startInstances(config){
        if ((!config.data.startInstances) || (!config.data.startInstances.length)){
            return q(config);
        }

        var tags = [
            {
                Key: 'Lock',
                Value: config.tag
            },
        ], instanceIds = [];

        config.data.startInstances.forEach(function(n){
            var inst;
            if (n.substr(0,2) === 'i-'){
                inst = config.instanceData.byId(n);
            } else {
                inst = config.instanceData.byName(n);
            }

            if (!inst){
                throw new Error('Invalid instance: ' + n);
            }

            instanceIds.push(inst.InstanceId);
        });

        return q.ninvoke(config.ec2,'createTags',{ Resources : instanceIds, Tags : tags })
        .then(q.ninvoke(config.ec2,'startInstances',{InstanceIds: instanceIds}))
        .then(function(data){
            return instanceIds; 
        })
        .catch(function(err){
            err.message = 'startInstances: ' + err.message;
            return q.reject(err);
        });
    }
    
    function launchInstances(config){
        if (!config.data.runInstances || config.data.runInstances.length === 0){
            return q([]);
        }
        return q.all(config.data.runInstances.map(function(rInst,index){
            var instId, buff;
            if (rInst.userDataFile){
                buff = new Buffer(fs.readFileSync(rInst.userDataFile),'utf8');
                rInst.params.UserData = buff.toString('base64');
            }

            return q.ninvoke(config.ec2,'runInstances',rInst.params).delay(3000)
            .then(function(data){
                instId = data.Instances[0].InstanceId;
//                console.log(JSON.stringify(data.Instances[0],null,3));
                var tags = [
                    {
                        Key: 'Lock',
                        Value: config.tag
                    },
                    {
                        Key: 'Name',
                        Value: rInst.name
                    },
                    {
                        Key: 'Owner',
                        Value: config.opts.owner
                    }
                ];

                if (rInst.tags){
                    tags = tags.concat(rInst.tags);
                }

                data.Instances[0]._tagMap = {};
                tags.forEach(function(tag){
                    data.Instances[0]._tagMap[tag.Key] = tag.Value;
                });
                config.instanceData._instances.push(data.Instances[0]);

                return q.ninvoke(config.ec2,'createTags',{
                    Resources : [ instId ],
                    Tags : tags
                });
                
                return {};
            })
            .then(function(data){
                return instId;
            });
        }))
        .then(function(results){
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
                data    : this.data,
                opts    : this.options(),
                ec2     : null,
                tag     : grunt.option('tag'),
                target  : this.target
            };

            if (!config.opts.owner){
                grunt.log.errorlns('Onwer is required.');
                return done(false);
            }

            if (!config.tag){
                grunt.log.errorlns('Tag is required, use --tag.');
                return done(false);
            }

            aws.config.loadFromPath(auth);
            
            config.ec2 = new aws.EC2();
            loadInstanceData(config)
            .then(function(){
                return q.all([checkStartInstances(config),checkRunInstances(config)]);
            })
            .then(function(){
                return q.all([startInstances(config),launchInstances(config)]);
            })
            .then(function(results){
                var ids = [];
                grunt.log.writelns('Started or Launched:');
                results.forEach(function(r){
                    ids = ids.concat(r);
                });
                ids.forEach(function(id){
                    var inst = config.instanceData.byId(id);
                    grunt.log.writelns(inst._tagMap.Name + '('  + id + ')');
                });
                return ids;
            })
            .then(function(ids){
                var stateOpts = {
                    ids     : ids,
                    state   : 'running',
                    interval: config.opts.stateInterval * 1000,
                    maxIters: config.opts.stateIters
                };
               
                return helpers.checkInstance(stateOpts, config.ec2, 0);
            })
            .then(function(ips) {
                grunt.log.writelns('All instances are in the running state');
                return q.all(ips.map(function(ip) {
                    var sshOpts = {
                        ip: ip,
                        interval: config.opts.sshInterval * 1000,
                        maxIters: config.opts.sshIters
                    };
                    return helpers.checkSSH(sshOpts, 0);
                }));
            })
            .then(function() {
                grunt.log.writelns('All instances are ready to go!');
                done(true);
            })
            .catch(function(err){
                grunt.log.errorlns(err.message);
                done(false);
            });
    });
};

