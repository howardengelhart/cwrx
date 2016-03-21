module.exports = function(grunt) {
    var path    = require('path'),
        spawn   = require('child_process').spawn;

    var serviceDepends = {
        accountant  : 'auth,monitor,ads,orgSvc',
        ads         : 'auth,content,monitor,orgSvc,geo',
        collateral  : 'auth,monitor',
        geo         : 'auth,monitor',
        content     : 'auth,monitor',
        orgSvc      : 'auth,monitor',
        player      : 'content,auth,monitor',
        search      : 'auth,monitor',
        userSvc     : 'auth,monitor',
        querybot    : 'ads,auth,content,monitor,c6postgres,c6postgres::admin',
        vote        : 'auth,monitor'
    };

    function killWatch(done){
        var killAll, privateKey = path.join(process.env.HOME,'.vagrant.d/insecure_private_key'),
            args = [
                '-i', privateKey,
                'vagrant@33.33.33.10',
                'sudo killall watchit'
            ];

        killAll  = spawn('ssh',args );
        killAll  = spawn('ssh',args );
        killAll.stdout.on('data', function(data){
            grunt.log.write(data.toString());
        });
        killAll.stderr.on('data', function(data){
            grunt.log.write(data.toString());
        });
        killAll.on('error', function(err){
            grunt.log.error(err.message);
            done(false);
        });
        
        killAll.on('close', function(code){
            done(true);
        });
    }

    function startWatch(service,done){
        var watchit, privateKey = path.join(process.env.HOME,'.vagrant.d/insecure_private_key'),
            args = [
                '-i', privateKey,
                'vagrant@33.33.33.10',
                'sudo /usr/local/bin/node /vagrant/scripts/watchit.js ' + service 
            ];

        if (!service) {
            grunt.log.errorlns('Need a service for watch!');
            done(false);
        }

        watchit  = spawn('ssh',args );
        watchit.stdout.on('data', function(data){
            grunt.log.write(data.toString());
        });
        watchit.stderr.on('data', function(data){
            grunt.log.write(data.toString());
        });
        watchit.on('error', function(err){
            grunt.log.error(err.message);
            done(false);
        });
        
        watchit.on('close', function(code){
            killWatch(done);
        });

        function sendKillWatch(){
            killWatch(done);
            process.removeListener('SIGINT',sendKillWatch);
            process.removeListener('SIGTERM',sendKillWatch);
        }

        process.on('SIGINT',sendKillWatch);
        process.on('SIGTERM',sendKillWatch);

    }

    function vagrantUp(cmd,service,done){
        var vagrant, services = [ service ], myEnv = {};

        if ((service) /*&& (cmd === 'up')*/) {
            if (serviceDepends[service]){
                services = Array.prototype.concat([service],serviceDepends[service].split(','));
            }
        }

        Object.keys(process.env).forEach(function(key){
            myEnv[key] = process.env[key];
        });

        if (grunt.option('branch')){
            myEnv.CWRX_DEV_BRANCH = grunt.option('branch');
        } else {
            myEnv.CWRX_DEV_BRANCH = 'master';
        }

        myEnv.CWRX_APP = services.join(',');

        grunt.log.writelns('CWRX_APP: ',myEnv.CWRX_APP);
        grunt.log.writelns('CWRX_DEV_BRANCH: ',myEnv.CWRX_DEV_BRANCH);

        vagrant  = spawn('vagrant', [cmd], { env : myEnv });
        vagrant.stdout.on('data', function(data){
            grunt.log.write(data.toString());
        });
        vagrant.stderr.on('data', function(data){
            grunt.log.write(data.toString());
        });
        vagrant.on('error', function(err){
            grnt.log.error(err.message);
            done(false);
        });
        vagrant.on('close', function(code){
            startWatch(service,done);
        });

    }

    function vagrantHalt(service,done){
        var vagrant;

        vagrant  = spawn('vagrant', ['halt']);
        vagrant.stdout.on('data', function(data){
            grunt.log.write(data.toString());
        });
        vagrant.stderr.on('data', function(data){
            grunt.log.write(data.toString());
        });
        vagrant.on('error', function(err){
            grnt.log.error(err.message);
            done(false);
        });
        vagrant.on('close', function(code){
            done(true); 
        });
    }

    grunt.registerTask('vagrant', 'does vagrant stuff', function(cmd) {
        var done = this.async(), service  = grunt.option('service');

        if (cmd === 'up') {
            return vagrantUp('up',service,done);
        }

        if (cmd === 'provision') {
            return vagrantUp('provision',service,done);
        }

        if (cmd === 'halt') {
            return vagrantHalt(service,done);
        }

        if (cmd === 'watch') {
            return startWatch(service,done);
        }

        grunt.log.errorlns('Unrecognized command: ',cmd);
        done(false);

    });
};

