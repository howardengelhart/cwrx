var fs      = require('fs-extra'),
    path    = require('path'),
    q       = require('q'),
    aws     = require('aws-sdk');

module.exports = function (grunt) {

    var initProps = {
            packageInfo : grunt.file.readJSON('package.json'),
            awsAuth     : grunt.option('awsAuth') || path.join(process.env.HOME,'.aws.json')
        };

    initProps.name = function() {
        return this.packageInfo.name;
    };
    
    grunt.initConfig({
        settings   : initProps,
        jshint: {
            options: {
                jshintrc: 'jshint.json'
            },
            all: [
                __dirname + '/bin/{,*/}*.js',
                __dirname + '/lib/{,*/}*.js'
            ]
        },
        watch: {
            scripts: {
                files: [
                    __filename,
                    __dirname + '/bin/**/*.js',
                    __dirname + '/lib/**/*.js',
                    __dirname + '/test/**/*.js' 
                ],
                tasks: ['jshint', 'unit_tests']
            }
        },
        stop_instance: {
            pollingInterval: 5,
            maxIters: 12
        },
        start_instance: {
            stateInterval: 5,
            stateIters: 12,
            sshInterval: 5,
            sshIters: 12
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('default', function(){
        grunt.task.run('jshint');
        grunt.task.run('unit_tests');
    });
    
    grunt.registerTask('unit_tests', 'Run jasmine unit tests', function(svc) {
        var done = this.async(),
            args = ['--test-dir', 'test/unit/', '--captureExceptions', '--junitreport', '--output',
                    path.join(__dirname, 'reports/unit/')];
        
        if (svc) {
            var regexp = '^(' + svc + '\\.svc|[^\\.]+\\.(?!svc))\\.?';
            args.push('--match', regexp);
        }
        grunt.log.writeln('Running unit tests' + (svc ? ' for ' + svc : '') + ':');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('unit tests failed: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });

    grunt.registerTask('acceptance_tests', 'Run jasmine acceptance tests', function() {
        var done = this.async(),
            args = ['--test-dir', 'test/acceptance/', '--captureExceptions', '--junitreport',
                    '--output', path.join(__dirname, 'reports/acceptance/')];
        
        grunt.log.writeln('Running acceptance tests:');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('acceptance tests failed: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });
   
    grunt.registerTask('e2e_tests', 'Run jasmine end-to-end tests', function(svc) {
        var done = this.async(),
            args = ['--test-dir', 'test/e2e/', '--captureExceptions', '--junitreport', '--output',
                    path.join(__dirname, 'reports/e2e/')];
        
        if (svc) {
            var regexp = '^' + svc + '(-light)?\\.e2e\\.';
            args.push('--match', regexp);
        }
        if (grunt.option('testHost')) {
            args.push('--config', 'host', grunt.option('testHost'));
        }
        
        if (grunt.option('e2e-config')){
            var cfgObj = JSON.parse(grunt.option('e2e-config'));
            for (var key in cfgObj){
                args.push('--config',key,cfgObj[key]);
            }
        }
        
        grunt.log.writeln('Running e2e tests' + (svc ? ' for ' + svc : '') + ':');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('e2e tests failed: ' + error);
                done(false);
                return;
            }

            if (result.stdout.match(/0 tests, 0 assertions, 0 failures/)){
                grunt.log.errorlns('No e2e tests were run!');
                done(false);
                return;
            }
            done(true);
        });
    });
    
    grunt.registerTask('light_tests', 'Run quick jasmine end-to-end tests', function(svc) {
        var done = this.async(),
            args = ['--test-dir', 'test/e2e/', '--captureExceptions', '--junitreport', '--output',
                    path.join(__dirname, 'reports/e2e/')];
        
        if (svc) {
            var regexp = '^' + svc + '-light\\.e2e\\.';
            args.push('--match', regexp);
        } else {
            var regexp = '-light\\.e2e\\.';
            args.push('--match', regexp);
        }
        
        if (grunt.option('testHost')) {
            args.push('--config', 'host', grunt.option('testHost'));
        }
        
        grunt.log.writeln('Running light e2e tests' + (svc ? ' for ' + svc : '') + ':');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('e2e tests failed: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });

    grunt.registerTask('start_instance', 'start an instance for running tests', function(id) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            stateInterval = (grunt.config.get('start_instance.stateInterval') || 5) * 1000,
            stateIters = grunt.config.get('start_instance.stateIters') || 12;
            sshInterval = (grunt.config.get('start_instance.sshInterval') || 5) * 1000,
            sshIters = grunt.config.get('start_instance.sshIters') || 12;
            
        if (!id || !grunt.option('testHost')) {
            grunt.log.errorlns('Need both an instance id and instance ip!');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Starting instance ' + id);
        ec2.startInstances({InstanceIds: [id]}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                done(false);
            } else {
                var stateOpts = {
                    id: id,
                    state: 'running',
                    interval: stateInterval,
                    maxIters: stateIters
                };
                var sshOpts = {
                    ip: grunt.option('testHost'),
                    interval: sshInterval,
                    maxIters: sshIters
                };
                grunt.log.writelns('Previous state: ' + data.StartingInstances[0].PreviousState.Name);
                grunt.log.writelns('Current state: ' + data.StartingInstances[0].CurrentState.Name);
                if (data.StartingInstances[0].CurrentState.Name === 'running') {
                    checkSSH(sshOpts, 0).then(function() {
                        grunt.log.writelns('Instance ' + id + ' is ready to go!');
                        done(true);
                    }, function(error) {
                        grunt.log.errorlns(error);
                        done(false);
                    });
                } else {
                    setTimeout(function() {
                        checkState(stateOpts, ec2, 0).then(function() { return checkSSH(sshOpts, 0);})
                        .then(function() {
                            grunt.log.writelns('Instance ' + id + ' is ready to go!');
                            done(true);
                        }, function(error) {
                            grunt.log.errorlns(error);
                            done(false);
                        });
                    }, stateInterval);
                }
            }
        });
    });

    grunt.registerTask('stop_instance', 'stop the test instance', function(id) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = (grunt.config.get('stop_instance.pollingInterval') || 5) * 1000,
            maxIters = grunt.config.get('stop_instance.maxIters') || 12;
            
        if (!id) {
            grunt.log.errorlns('No instance id!');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Stopping instance ' + id);
        ec2.stopInstances({InstanceIds: [id]}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                done(false);
            } else {
                grunt.log.writelns('Previous state: ' + data.StoppingInstances[0].PreviousState.Name);
                grunt.log.writelns('Current state: ' + data.StoppingInstances[0].CurrentState.Name);
                if (data.StoppingInstances[0].CurrentState.Name === 'stopped') {
                    grunt.log.writelns('Instance ' + id + ' has stopped!');
                    done(true);
                    return;
                }
                setTimeout(function() {
                    var opts = {
                        id: id,
                        state: 'stopped',
                        interval: interval,
                        maxIters: maxIters
                    };
                    checkState(opts, ec2, 0).then(function() {
                        grunt.log.writelns('Instance ' + id + ' has stopped!');
                        done(true);
                    }, function(error) {
                        grunt.log.errorlns(error);
                        done(false);
                    });
                }, interval);
            }
        });
    });

    function checkState(opts, ec2, iters, promise) {
        var deferred = promise || q.defer();
        grunt.log.writelns('Polling instance ' + opts.id + ' for its state');
        ec2.describeInstances({InstanceIds: [opts.id]}, function(err, data) {
            if (err) {
                deferred.reject(err);
                return;
            }
            if (!data || !data.Reservations || !data.Reservations[0].Instances) {
                deferred.reject('Incomplete information from describeInstances');
                return;
            }
            if (data.Reservations[0].Instances[0].State.Name === opts.state) {
                grunt.log.writelns('Instance ' + opts.id + ' is in the ' + opts.state + ' state');
                deferred.resolve();
                return;
            }
            iters++;
            if (iters >= opts.maxIters) {
                deferred.reject('Timed out after ' + iters + ' iterations');
                return;
            }
            setTimeout(checkState, opts.interval, opts, ec2, iters, deferred);
            return;
        });
        return deferred.promise;
    }
    
    function checkSSH(opts, iters, promise) {
        var deferred = promise || q.defer();
        grunt.log.writelns('Checking if instance ' + opts.ip + ' is accessible by SSH');
        grunt.util.spawn({cmd: 'ssh', args: [opts.ip, 'echo ready']}, function(error,result,code) {
            if (error) {
                iters++;
                if (iters >= opts.maxiters) {
                    deferred.reject('Timed out after ' + iters + ' iterations');
                    return;
                }
                setTimeout(checkSSH, opts.interval, opts, iters, deferred);
                return;
            } else {
                grunt.log.writelns('Can ssh into instance ' + opts.ip);
                deferred.resolve();
                return;
            }
        });
        return deferred.promise;
    }
};

