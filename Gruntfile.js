var fs      = require('fs-extra'),
    path    = require('path'),
    q       = require('q'),
    aws     = require('aws-sdk');

module.exports = function (grunt) {

    var initProps = {
            prefix      : process.env.HOME,
            dist        : path.join(__dirname,'dist'),
            packageInfo : grunt.file.readJSON('package.json'),
            awsAuth     : path.join(process.env.HOME,'.aws.json')
        };

    initProps.version     = function(){
        return this.gitLastCommit.commit;
    };

    initProps.name        = function() {
        return this.packageInfo.name;
    };

    initProps.installDir = function() {
        return (this.name() + '.' +
                this.gitLastCommit.date.toISOString().replace(/\W/g,'') + '.' +
                this.gitLastCommit.commit);
    };
    initProps.installPath = function(){
        return (path.join(this.prefix, 'releases', this.installDir()));
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
        rmbuild : {
            history : 2 
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
    
    grunt.registerTask('installCleanup', [
        'gitLastCommit',
        'rmbuild'
    ]);

    grunt.registerTask('gitLastCommit','Get a version number using git commit', function(){
        var settings = grunt.config.get('settings'),
            done = this.async(),
            handleVersionData = function(data){
                if ((data.commit === undefined) || (data.date === undefined)){
                    grunt.log.errorlns('Failed to parse version.');
                    return done(false);
                }
                data.date = new Date(data.date * 1000);
                settings.gitLastCommit = data;
                grunt.log.writelns('Last git Commit: ' +
                    JSON.stringify(settings.gitLastCommit,null,3));
                grunt.config.set('settings',settings);
                return done(true);
            };

        if (settings.gitLastCommit){
            return done(true);
        }

        if (grunt.file.isFile('version.json')){
            return handleVersionData(grunt.file.readJSON('version.json'));
        }

        grunt.util.spawn({
            cmd     : 'git',
            args    : ['log','-n1','--format={ "commit" : "%h", "date" : "%ct" , "subject" : "%s" }']
        },function(err,result){
            if (err) {
                grunt.log.errorlns('Failed to get gitLastCommit: ' + err);
                return done(false);
            }
            handleVersionData(JSON.parse(result.stdout));
        });
    });

    grunt.registerTask('gitstatus','Make sure there are no pending commits', function(){
        var done = this.async();
        grunt.util.spawn({
            cmd     : 'git',
            args    : ['status','--porcelain']
        },function(err,result){
            if (err) {
                grunt.log.errorlns('Failed to get git status: ' + err);
                done(false);
            }
            if (result.stdout === '""'){
                grunt.log.writelns('No pending commits.');
                done(true);
            }
            grunt.log.errorlns('Please commit pending changes');
            grunt.log.errorlns(result.stdout.replace(/\"/g,''));
            done(false);
        });
    });
    
    grunt.registerTask('rmbuild','Remove old copies of the install',function(){
        this.requires(['gitLastCommit']);
        var settings       = grunt.config.get('settings'),
            installBase = settings.name(),
            installPath = settings.installPath(),
            installRoot = path.dirname(installPath),
            pattPart = new RegExp(installBase),
            pattFull = new RegExp(installBase +  '.(\\d{8})T(\\d{9})Z'),
            history     = grunt.config.get('rmbuild.history'),
            contents = [];

        if (history === undefined){
            history = 4;
        }
        grunt.log.writelns('Max history: ' + history);

        fs.readdirSync(installRoot).forEach(function(dir){
            if (pattPart.test(dir)){
                contents.push(dir);
            }
        });

        if (contents){
            var sorted = contents.sort(function(A,B){
                var mA = pattPart.exec(A),
                    mB = pattPart.exec(B),
                    i;
                // The version is the same
                mA = pattFull.exec(A);
                mB = pattFull.exec(B);
                if (mA === null) { return 1; }
                if (mB === null) { return -1; }
                for (i = 1; i <= 2; i++){
                    if (mA[i] !== mB[i]){
                        return mA[i] - mB[i];
                    }
                }
                return 1;
            });
            while (sorted.length > history){
                var dir = sorted.shift();
                grunt.log.writelns('remove: ' + dir);
                fs.removeSync(path.join(installRoot,dir));
            }
        }
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
    
    grunt.registerTask('stop_instance', 'stop the test instance', function(id) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth;

        if (!id) {
            grunt.log.errorlns('No instance id!');
            return;
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
                done(true);
            }
        });
    });

    grunt.registerTask('start_instance', 'start an instance for running tests', function(id) {
        var settings = grunt.config.get('settings'),
            auth     = settings.awsAuth,
            interval = (grunt.config.get('start_instance.pollingInterval') || 5) * 1000,
            maxIters = grunt.config.get('start_instance.maxIters') || 12;
            
        if (!id) {
            grunt.log.errorlns('No instance id!');
            return;
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
                    checkRunning(id, ec2, interval, 0, maxIters).then(function() {
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

    function checkRunning(id, ec2, interval, iters, maxIters, promise) {
        var deferred = promise || q.defer();
        grunt.log.writelns('Polling instance ' + id + ' for its state');
        ec2.describeInstances({InstanceIds: [id]}, function(err, data) {
            if (err) {
                deferred.reject(err);
                return;
            }
            if (!data || !data.Reservations || !data.Reservations[0].Instances) {
                deferred.reject('Incomplete information from describeInstances');
                return;
            }
            if (data.Reservations[0].Instances[0].State.Name === 'running') {
                deferred.resolve();
                return;
            }
            iters++;
            if (iters >= maxIters) {
                deferred.reject('Timed out after ' + iters + ' iterations');
                return;
            }
            setTimeout(checkRunning, interval, id, ec2, interval, iters, maxIters, deferred);
            return;
        });
        return deferred.promise;
    }
};

