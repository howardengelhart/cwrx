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
                Values : [config.owner]
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


    function checkLocks(config){
        var err;
        function checkLock(x){
            var inst = config.instanceData.lookup(grunt.util.kindOf(x) === 'string' ?
                    x : x.name);
            if (    inst &&
                    inst._tagMap &&
                    inst._tagMap.Lock !== undefined  &&
                    inst._tagMap.Lock !== config.tag){
                err = new Error((x.name || x) + ' is locked with: ' + inst._tagMap.Lock);
                return false;
            }
            return true;
        }

        if (!config.data.startInstances.every(checkLock)){
            return q.reject(err);
        }

        if (!config.data.runInstances.every(checkLock)){
            return q.reject(err);
        }

        return q(config);
    }

    function deleteLocks(config){
        var instanceIds = [];
        function getInstanceId(x){
            var inst = config.instanceData.lookup(grunt.util.kindOf(x) === 'string' ?
                    x : x.name);
            if (!inst ) {
                throw new Error('Unable to locate instance from : ' + (x.name || x));
            }
            
            return inst.InstanceId;
        }

        instanceIds = config.data.startInstances.map(getInstanceId)
            .concat(config.data.runInstances.map(getInstanceId));

        return q.ninvoke(config.ec2,'deleteTags',{ Resources : instanceIds, Tags : [ 
            {
                Key : 'Lock',
                Value: config.tag
            }
        ]})
        .then(function(){
            return config;
        })
        .catch(function(err){
            err.message = 'deleteLocks: ' + err.message;
            return q.reject(err);
        });
    }

    function stopInstances(config){
        function getInstanceId(x){
            var inst = config.instanceData.lookup(x);
            if (!inst ) {
                throw new Error('Unable to locate instance from : ' + x);
            }
            return inst.InstanceId;
        }

        var ids  = config.data.startInstances.map(getInstanceId);
        return q.ninvoke(config.ec2,'stopInstances',{InstanceIds: ids})
            .then(function(){
                return config;
            })
            .catch(function(err){
                err.message = 'stopInstances: ' + err.message;
                return q.reject(err);
            });
    }

    function terminateInstances(config){
        function getInstanceId(x){
            var inst = config.instanceData.lookup(x.name);
            if (!inst ) {
                throw new Error('Unable to locate instance from : ' + x.name);
            }
            return inst.InstanceId;
        }

        var ids  = config.data.runInstances.map(getInstanceId);
        if (!ids || !ids.length){
            return q(config);
        }
        return q.all(config.data.runInstances.map(function(rInst){
            var instId = getInstanceId(rInst),
                tags = [
                    {
                        Key: 'Name',
                        Value: rInst.name + '-deleted'
                    }
                ];

            return q.ninvoke(config.ec2,'createTags',{
                Resources : [ instId ],
                Tags : tags
            });
        }))
        .then(function(){
            return q.ninvoke(config.ec2,'terminateInstances',{InstanceIds: ids})
        })
        .then(function(data){
            return config;
        })
        .catch(function(err){
            err.message = 'terminateInstances: ' + err.message;
            return q.reject(err);
        });
    }

    grunt.registerTask('shutdown_instances', 'shuts down ec2 instances', function(profile) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            done     = this.async(),
            config = grunt.config.get('launch_instances');
      
        if (!config[profile]){
            grunt.log.errorlns('Unrecognized profile: ' + profile);
            return done(false);
        }
        config.data = config[profile];
        config.data.startInstances = config.data.startInstances || [];
        config.data.runInstances = config.data.runInstances || [];

        config.owner = config[profile].owner || config.options.owner;
        if (!config.owner){
            grunt.log.errorlns('Onwer is required.');
            return done(false);
        }

        config.tag = grunt.option('tag');

        if (!config.tag){
            grunt.log.errorlns('Tag is required, use --tag.');
            return done(false);
        }
        
        aws.config.loadFromPath(auth);
        
        config.ec2 = new aws.EC2();
        loadInstanceData(config)
        .then(checkLocks)
        .then(deleteLocks)
        .then(stopInstances)
        .then(terminateInstances)
        .then(function(){
            grunt.log.writelns('shutdown complete');
            done(true);
        })
        .catch(function(err){
            grunt.log.errorlns(err.message);
            done(false);
        });
        
    });

};

