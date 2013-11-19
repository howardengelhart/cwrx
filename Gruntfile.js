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
                tasks: ['jshint', 'test:unit']
            }
        },
        test: {
            unit: {
                reportDir: 'reports/unit/'
            },
            acceptance: {
                reportDir: 'reports/acceptance/'
            },
            e2e: {
                reportDir: 'reports/e2e/'
            },
        },
        stop_instance: {
            pollingInterval: 5,
            maxIters: 12
        },
        start_instance: {
            pollingInterval: 5,
            maxIters: 12
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('default', function(){
        grunt.task.run('jshint');
        grunt.task.run('test:unit');
    });

    grunt.registerMultiTask('test', 'Run jasmine tests', function() {
        var target = this.target,
            data = this.data,
            done = this.async(),
            args = ['--test-dir', 'test/' + target + '/', '--captureExceptions', '--junitreport',
                    '--output', path.join(__dirname, data.reportDir)];
        
        if (target === 'e2e' && grunt.option('testHost')) {
            args.push('--config', 'host', grunt.option('testHost'));
        }
            
        grunt.log.writeln('Running ' + target + ' tests:');
        grunt.util.spawn({
            cmd : 'jasmine-node',
            args : args
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns(target + ' tests failed: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });

    grunt.registerTask('start_instance', 'start an instance for running tests', function(id) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = (grunt.config.get('start_instance.pollingInterval') || 5) * 1000,
            maxIters = grunt.config.get('start_instance.maxIters') || 12;
            
        if (!id) {
            grunt.log.errorlns('No instance id!');
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
                grunt.log.writelns('Previous state: ' + data.StartingInstances[0].PreviousState.Name);
                grunt.log.writelns('Current state: ' + data.StartingInstances[0].CurrentState.Name);
                if (data.StartingInstances[0].CurrentState.Name === 'running') {
                    grunt.log.writelns('Instance ' + id + ' is ready to go!');
                    done(true);
                    return;
                }
                setTimeout(function() {
                    var opts = {
                        id: id,
                        state: 'running',
                        interval: interval,
                        maxIters: maxIters
                    }
                    checkState(opts, ec2, 0).then(function() {
                        grunt.log.writelns('Instance ' + id + ' is ready to go!');
                        done(true);
                    }, function(error) {
                        grunt.log.errorlns(error);
                        done(false);
                    });
                }, interval);
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
                    }
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
};

