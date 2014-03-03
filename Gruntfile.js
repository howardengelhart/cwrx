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
            test: {
                options: {
                    debounceDelay : 10000,
                    atBegin : true
                },
                files: [
                    __dirname + '/bin/**/*.js',
                    __dirname + '/lib/**/*.js',
                    __dirname + '/test/**/*.js' 
                ],
                tasks: ['jshint', 'unit_tests' ]
            }
        },
        create_snapshot: {
            pollingInterval: 5,
            maxIters: 24
        },
        stop_instances: {
            pollingInterval: 5,
            maxIters: 24
        },
        start_instances: {
            stateInterval: 5,
            stateIters: 24,
            sshInterval: 5,
            sshIters: 24
        }
    });
    
    grunt.loadNpmTasks('grunt-contrib-jshint');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.registerTask('default', function(){
        grunt.task.run('jshint');
        grunt.task.run('unit_tests');
    });

    grunt.registerTask('install_hook','Installs pre-commit hook', function(){
        var hookPath = path.join(__dirname,'.git/hooks/pre-commit'), hookFile, done;
        
        if (fs.existsSync(hookPath)){
            grunt.log.errorlns('WARNING: will not overwrite existing pre-commit hook');
            return true;
        }
        done = this.async();
        hookFile =  '# Installed by grunt install_hook\n\n'
        hookFile += 'grunt jshint\n';
        hookFile += 'grunt unit_tests\n';
        
        fs.outputFileSync(hookPath,hookFile);
        grunt.util.spawn({
            cmd : 'chmod',
            args : ['755',hookPath]
        }, function(error,result,code) {
            grunt.log.writeln(result.stdout);
            if (error) {
                grunt.log.errorlns('failed to change mode: ' + error);
                done(false);
                return;
            }
            done(true);
        });
    });
    
    grunt.registerTask('unit_tests', 'Run jasmine unit tests', function(svc) {
        var done = this.async(),
            args = ['--test-dir', 'test/unit/', '--captureExceptions', '--junitreport', '--output',
                    path.join(__dirname, 'reports/unit/')];
        
        if (svc) {
            var regexp = '^(' + svc + '(\\.[^\\.]+)?\\.svc|[^\\.]+\\.(?!svc))\\.?';
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
        if (grunt.option('statusHost')) {
            args.push('--config', 'statusHost', grunt.option('statusHost'));
        }
        if (grunt.option('bucket')) {
            args.push('--config', 'bucket', grunt.option('bucket'));
        }
        if (grunt.option('getLogs')) {
            args.push('--config', 'getLogs', grunt.option('getLogs'));
        }
        if (grunt.option('dbHost')) {
            args.push('--config', 'mongo', '{"host": "' + grunt.option('dbHost') + '"}');
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
    
    grunt.registerTask('getLogs', 'Get and clear remote service logs', function(logfiles) {
        var host        = grunt.option('testHost') || 'localhost',
            testNum     = grunt.option('testNum') || 1, // usually the Jenkins build number
            maintUrl    = 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
            testUtils   = require('./test/e2e/testUtils'),
            done = this.async();
        if (!logfiles) {
            grunt.log.writeln('No logfiles argument so nothing to do');
            return done(true);
        }
        
        q.all(logfiles.split(',').map(function(logfile) {
            var getOpts = {
                    url: maintUrl + '/get_log?logFile=' + logfile
                },
                clearOpts = {
                    url: maintUrl + '/clear_log',
                    json: {
                        logFile: logfile
                    }                
                };
            
            var dirPath = path.join(__dirname, 'logs/test' + testNum);
            return q.npost(fs, 'mkdirs', [dirPath])
            .then(function() {
                return testUtils.qRequest('get', [getOpts])
            }).then(function(resp) {
                var fpath = path.join(dirPath, logfile);
                grunt.log.writeln("Remote log " + logfile + " stored in " + fpath);
                return q.npost(fs, 'outputFile', [fpath, resp.body]);
            }).then(function() {
                return testUtils.qRequest('post', [clearOpts]);
            }).then(function(resp) {
                console.log("Cleared remote log " + logfile);
                return q();
            });
            return deferred.promise;
        })).catch(function(error) {
            grunt.log.errorlns("Error getting and clearing logs:");
            grunt.log.errorlns(JSON.stringify(error));
            done(false);
        });
    });

    grunt.registerTask('start_instances', 'starts instances for running tests', function(idString) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            stateInterval = grunt.config.get('start_instances.stateInterval') * 1000,
            stateIters = grunt.config.get('start_instances.stateIters'),
            sshInterval = grunt.config.get('start_instances.sshInterval') * 1000,
            sshIters = grunt.config.get('start_instances.sshIters');
            ids = idString.split(',');
        
        if (!ids) {
            grunt.log.errorlns('Need to provide an instance id or comma-separated string of ids');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Starting instances ' + ids.toString());
        ec2.startInstances({InstanceIds: ids}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            var stateOpts = {
                ids: ids,
                state: 'running',
                interval: stateInterval,
                maxIters: stateIters
            };
            
            checkState(stateOpts, ec2, 0)
            .then(function(ips) {
                grunt.log.writelns('All instances are in the running state');
                return q.all(ips.map(function(ip) {
                    var sshOpts = {
                        ip: ip,
                        interval: sshInterval,
                        maxIters: sshIters
                    };
                    return checkSSH(sshOpts, 0);
                }));
            }).then(function() {
                grunt.log.writelns('All instances are ready to go!');
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });

    grunt.registerTask('stop_instances', 'stops the test instances', function(idString) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = grunt.config.get('stop_instances.pollingInterval') * 1000,
            maxIters = grunt.config.get('stop_instances.maxIters'),
            ids = idString.split(',');
        
        if (!ids) {
            grunt.log.errorlns('Need to provide an instance id or comma-separated string of ids');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Stopping instances ' + ids.toString());
        ec2.stopInstances({InstanceIds: ids}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            var stateOpts = {
                ids: ids,
                state: 'stopped',
                interval: interval,
                maxIters: maxIters
            };
            
            checkState(stateOpts, ec2, 0)
            .then(function(ips) {
                grunt.log.writelns('All instances have stopped');
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });
    
    grunt.registerTask('create_snapshot', 'create a snapshot of an EBS volume', function(volumeId) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = grunt.config.get('create_snapshot.pollingInterval') * 1000,
            maxIters = grunt.config.get('create_snapshot.maxIters'),
            desc     = grunt.option('description') ||
                           'Created from ' + volumeId + ' on ' + new Date().toString();
        
        if (!volumeId) {
            grunt.log.errorlns('Need to provide a volumeId');
            return false;
        }
        
        var done = this.async();
        aws.config.loadFromPath(auth);
        var ec2 = new aws.EC2();
        
        grunt.log.writelns('Creating snapshot of volume ' + volumeId);
        ec2.createSnapshot({VolumeId: volumeId, Description: desc}, function(err, data) {
            if (err) {
                grunt.log.errorlns(err);
                return done(false);
            }
            if (!data || !data.SnapshotId) {
                grunt.log.errorlns('Incomplete information from creating the snapshot:');
                grunt.log.errorlns(JSON.stringify(data));
                return done(false);
            }
            var checkOpts = {
                id: data.SnapshotId,
                state: 'completed',
                interval: interval,
                maxIters: maxIters
            };
            grunt.log.writelns('Created snapshot ' + data.SnapshotId);
            checkSnapshot(checkOpts, ec2, 0)
            .then(function(snapshot) {
                grunt.log.writelns('Snapshot ' + snapshot.SnapshotId + ' is completed');
                done(true);
            }).catch(function(error) {
                grunt.log.errorlns(error);
                done(false);
            });
        });
    });
    
    function checkSnapshot(opts, ec2, iters, promise) {
        var deferred = promise || q.defer();
        grunt.log.writelns('Polling snapshot ' + opts.id + ' for its state');
        ec2.describeSnapshots({SnapshotIds: [opts.id]}, function(err, data) {
            if (err) {
                deferred.reject(err);
                return;
            }
            if (!data || !data.Snapshots) {
                return deferred.reject('Incomplete information from describeSnapshots');
            }
            
            if (data.Snapshots[0].State !== opts.state) {
                iters++;
                if (iters >= opts.maxIters) {
                    deferred.reject('Timed out after ' + iters + ' iterations');
                    return;
                }
                setTimeout(checkSnapshot, opts.interval, opts, ec2, iters, deferred);
            } else {
                deferred.resolve(data.Snapshots[0]);
            }
        });
        return deferred.promise;
    }

    function checkState(opts, ec2, iters, promise) {
        var deferred = promise || q.defer(),
            ips = [],
            notReady = false;
        grunt.log.writelns('Polling instances ' + opts.ids.toString() + ' for their state');
        ec2.describeInstances({InstanceIds: opts.ids}, function(err, data) {
            if (err) {
                deferred.reject(err);
                return;
            }
            if (!data || !data.Reservations) {
                deferred.reject('Incomplete information from describeInstances');
                return;
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
                    deferred.reject('Timed out after ' + iters + ' iterations');
                    return;
                }
                setTimeout(checkState, opts.interval, opts, ec2, iters, deferred);
            } else {
                deferred.resolve(ips);
            }
        });
        return deferred.promise;
    }
    
    function checkSSH(opts, iters, promise) {
        var deferred = promise || q.defer();
            
        grunt.log.writelns('Checking if instance ' + opts.ip + ' is accessible by SSH');
        grunt.util.spawn({cmd: 'nc', args: ['-zv', opts.ip, 22]}, function(error,result,code) {
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

