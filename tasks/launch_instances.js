var aws     = require('aws-sdk'),
    path    = require('path'),
    q       = require('q'),
    helpers = require('./resources/helpers');

module.exports = function(grunt) {

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
    
    function runInstances(config){
        if (!config.data.runInstances || config.data.runInstances.length === 0){
            return q([]);
        }
        return q.all(config.data.runInstances.map(function(rInst,index){
            var instId, buff;

            if (rInst.userDataFile){
                rInst.userDataPath = path.join(config.userDataDir,rInst.userDataFile);
            }
            
            if (rInst.userDataPath){
                buff = new Buffer(grunt.file.read(rInst.userDataPath),'utf8');
                rInst.params.UserData = buff.toString('base64');
            } 

            return q.ninvoke(config.ec2,'runInstances',rInst.params).delay(3000)
            .then(function(data){
                instId = data.Instances[0].InstanceId;
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
            err.message = 'runInstances: ' + err.message;
            return q.reject(err);
        });
    }

    function checkInstanceHttp(config){
        grunt.log.writelns('checkInstanceHttp');
        return q.all(config.data.checkHttp.map(function(check){
            var inst = config.instanceData.byName(check.host),
                opts = {
                    path  : check.path,
                    https : check.https 
                };

            if (check.port) {
                opts.port = check.port;
            }

            if (!check.expect){
                check.expect = {
                    statusCode : 200
                }
            }

            opts.host = (check.iface === 'private') ?  inst.PrivateIpAddress : inst.PublicIpAddress;

            return helpers.promiseUntil(helpers.checkHttp, [ opts ])
                .then(function(result){
                    if (parseInt(result.statusCode,10) !== check.expect.statusCode){
                        return q.reject(new Error(check.host + ' returned unexpected status code: ' +
                                result.statusCode));
                    }
                    return result;
                })
                .progress(function(err){
                    grunt.log.writelns(check.host);
                });
        }))
        .then(function(results){
            return config;
        });
    }

    function checkInstanceStatus(config) {
        grunt.log.writelns('checkInstanceStatus');
        var stateOpts = {
            ids     : config.launchedIds,
            state   : 'running',
            interval: config.opts.stateInterval * 1000,
            maxIters: config.opts.stateIters
        };
           
        return helpers.checkInstance(stateOpts, config.ec2, 0)
            .then(function(){
                return config;
            })
            .catch(function(err){
                err.message = 'checkInstanceStatus: ' + err.message;
                return q.reject(err);
            })
    }

    function launchInstances(config){
        grunt.log.writelns('launchInstances');
        return q.all([startInstances(config),runInstances(config)])
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
                config.launchedIds = ids; 
                return config;
            });
    }

    function verifyInstancesAreFree(config){
        grunt.log.writelns('verifyInstancesAreFree');
        return q.all([checkStartInstances(config),checkRunInstances(config)])
            .then(function(){
                return config;
            });
    }

    function refreshInstanceData(config){
        grunt.log.writelns('refreshInstanceData');
        return helpers.getEc2InstanceData({ ec2 : config.ec2, params : {
            Filters : [ {
                Name   : 'tag:Lock' ,
                Values : [config.tag]
            } ]
        }})
        .then(function(data){
            config.instanceData = data;
            return config;
        })
        .catch(function(err){
            err.message = 'refreshInstanceData: ' + err.message;
            return q.reject(err);
        });
    }

    function getInstanceDataByOwner(config){
        grunt.log.writelns('getInstanceDataByOwner');
        return helpers.getEc2InstanceData({ ec2 : config.ec2, params : {
            Filters : [ {
                Name   : 'tag:Owner' ,
                Values : [config.opts.owner]
            } ]
        }})
        .then(function(data){
            config.instanceData = data;
            return config;
        })
        .catch(function(err){
            err.message = 'getInstanceDataByOwner: ' + err.message;
            return q.reject(err);
        });
    }

    grunt.registerMultiTask('launch_instances', 'launches ec2 instances', function() {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            done     = this.async(),
            config   = {
                data        : this.data,
                opts        : this.options(),
                ec2         : null,
                tag         : grunt.option('tag'),
                userDataDir : grunt.option('user-data-dir') || '.',
                workSpace   : path.join(grunt.option('workspace') || '.', grunt.option('tag')),
                target      : this.target
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
    
            getInstanceDataByOwner(config)
            .then(verifyInstancesAreFree)
            .then(launchInstances)
            .then(checkInstanceStatus)
            .then(refreshInstanceData)
            .then(checkInstanceHttp)
            /*
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
            */
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

