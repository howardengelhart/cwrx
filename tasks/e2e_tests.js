var AWS = require('aws-sdk');
var path = require('path');
var q = require('q');

module.exports = function(grunt) {
    var cloudFormation;

    function lookupIp(ec2Data, host,iface){
        var inst;
        if (!ec2Data){
            return host;
        }

        inst = ec2Data.byName(host);

        if (!inst){
            return host;
        }

        return (iface === 'public') ? inst.PublicIpAddress : inst.PrivateIpAddress;
    }

    function initCloudFormation(auth, region) {
        AWS.config.loadFromPath(auth);
        AWS.config.update({ region: region });
        cloudFormation = new AWS.CloudFormation();
    }

    function getStackOutputs(stack) {
        return q.Promise(function(resolve, reject) {
            cloudFormation.describeStacks({
                StackName: stack
            }, function(error, data) {
                if(error) {
                    reject(error);
                } else {
                    resolve(data.Stacks[0].Outputs);
                }
            });
        });
    }

    grunt.registerTask('e2e_tests', 'Run jasmine end-to-end tests', function(svc) {
        var auth = grunt.option('awsAuth') || path.join(process.env.HOME, '.aws.json'),
            region = grunt.option('region') || 'us-east-1',
            ec2Data = grunt.config.get('ec2Data'),
            opts = this.options(),
            done = this.async(),
            cacheCfgHost, cacheHost;

        if (svc) {
            grunt.config.set('jasmine.e2e.src', grunt.file.expand(grunt.config.get('jasmine.e2e.src')).filter(function(file) {
                return new RegExp('/' + svc + '(\\.[^\\.]+)*\\.e2e\\.').test(file);
            }));
        }
        q().then(function() {
            if(grunt.option('formation')) {
                initCloudFormation(auth, region);
                return getStackOutputs(grunt.option('formation')).then(function(outputs) {
                    outputs.forEach(function(output) {
                        switch(output.OutputKey) {
                        case 'apiServer':
                            process.env.host = output.OutputValue;
                            process.env.cacheCfgHost = output.OutputValue;
                            process.env.cacheServer = output.OutputValue + ':11211';
                            break;
                        case 'mongo':
                            process.env.mongo = JSON.stringify({
                                host: output.OutputValue
                            });
                            break;
                        case 'cwrxStream2':
                            process.env.streamName = output.OutputValue;
                            break;
                        }
                    });
                });
            }
        }).then(function() {
            if (grunt.option('testHost')) {
                process.env.host = lookupIp(ec2Data,grunt.option('testHost'),'public');
            }
            if (grunt.option('cacheCfgHost')) {
                cacheCfgHost = lookupIp(ec2Data,grunt.option('cacheCfgHost'),'private');
                process.env.cacheCfgHost = cacheCfgHost;
            }
            if (grunt.option('cacheCfgPort')) {
                process.env.cacheCfgPort = grunt.option('cacheCfgPort');
            }
            if (grunt.option('cacheHost')) {
                cacheHost = lookupIp(ec2Data,grunt.option('cacheHost'),'private');
                var port = grunt.option('cachePort') || 11211;
                process.env.cacheServer = cacheHost + ':' + port;
                if (!cacheCfgHost) {
                    process.env.cacheCfgHost = cacheHost;
                }
            }
            if (grunt.option('bucket')) {
                process.env.bucket = grunt.option('bucket');
            }
            if (grunt.option('awsAuth')) {
                process.env.awsAuth = grunt.option('awsAuth');
            }
            if (grunt.option('getLogs')) {
                process.env.getLogs = grunt.option('getLogs');
            }
            if (grunt.option('dbHost')) {
                process.env.mongo = '{"host": "' +
                    lookupIp(ec2Data,grunt.option('dbHost'),'private') + '"}';
            }
            if (grunt.option('streamName')) {
                process.env.streamName = grunt.option('streamName');
            }
            if (grunt.option('e2e-config')){
                var cfgObj = JSON.parse(grunt.option('e2e-config'));
                for (var key in cfgObj){
                    process.env[key] = cfgObj[key];
                }
            }
            
            grunt.log.writeln('Starting e2e tests' + (svc ? ' for ' + svc : '') + ':');

            var svcOpts = opts[svc.match(/^[^\.]+/)[0]];

            if (svcOpts && svcOpts.preScripts) {
                return svcOpts.preScripts.reduce(function(prom, scriptCfg) {
                    return prom.then(function() {
                        grunt.log.writeln('Running preliminary script ' + scriptCfg.name);

                        var args = [];
                        scriptCfg.forwardedArgs.forEach(function(argName) {
                            var argValue = grunt.option(argName) || (function() {
                                switch(argName) {
                                case 'dbHost':
                                    return JSON.parse(process.env.mongo || '{}').host;
                                default:
                                    return process.env[argName];
                                }
                            }());
                            if (argValue) {
                                args = args.concat(['--' + argName, argValue]);
                            }
                        });
                        
                        return q.npost(grunt.util, 'spawn', [{
                            cmd: scriptCfg.path,
                            args: args,
                            opts: {
                                stdio: 'inherit'
                            }
                        }]);
                    });
                }, q());
            }
        }).then(function() {
            grunt.task.run('jasmine:e2e');
            done(true);
        }).catch(function(error) {
            grunt.log.error(error);
            done(false);
        });
    });
};
