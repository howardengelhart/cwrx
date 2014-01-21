#!/usr/bin/env node
var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    path        = include('path'),
    os          = include('os'),
    request     = include('request'),
    cluster     = include('cluster'),
    express     = include('express'),
    aws         = include('aws-sdk'),
    q           = include('q'),
    daemon      = include('../lib/daemon'),
    hostname    = include('../lib/hostname'),
    logger      = include('../lib/logger'),
    uuid        = include('../lib/uuid'),
    config      = include('../lib/config'),
    __ut__      = (global.jasmine !== undefined) ? true : false,
    state       = {},
    service     = {};   // for exporting functions to unit tests


state.defaultConfig = {
    pidFile : '/opt/sixxy/run/vote.pid'
};


service.getVersion = function(appName) {
    var fpath = path.join(__dirname, appName ? appName + '.version' : '.version'),
        log = logger.getLog();
        
    if (fs.existsSync(fpath)) {
        try {
            return fs.readFileSync(fpath).toString().trim();
        } catch(e) {
            log.error('Error reading version file: ' + e.message);
        }
    }
    log.warn('No version file found');
    return 'unknown';
};

service.parseCmdLine = function(state){
    state.cmdl = include('commander');
    
    state.cmdl
        .option('-c, --config [CFGFILE]','Specify config file')
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-g, --gid [GID]','Run as group (id or name).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-k, --kids [KIDS]','Number of kids to spawn.', 0)
        .option('-p, --port [PORT]','Listent on port (requires -s) [3100].', 3100)
        .option('-s, --server','Run as a server.')
        .option('-u, --uid [UID]','Run as user (id or name).')
        .option('--show-config','Display configuration and exit.')
        .parse(process.argv);
    
    if (state.cmdl.gid){
        console.log('\nChange process to group: ' + state.cmdl.gid);
        process.setgid(state.cmdl.gid);
    }
   
    if (state.cmdl.uid){
        console.log('\nChange process to user: ' + state.cmdl.uid);
        process.setuid(state.cmdl.uid);
    }

    return q(state);
};

service.configure = function(state){
    var log;
    state.config = config.createConfigObject(state.cmdl.config, state.defaultConfig);
    
    if (state.config.log) {
        log = logger.createLog(state.config.log);
    } else {
        log = logger.getLog();
    }

    return q(state);
};

service.handleSignals = function(state){
    var log = logger.getLog();
    if (!state.cmdl.server){
        log.trace('not running as server, no need to handleSignals');
        return q(state);
    }

    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error(err);
        }
        return process.exit(2);
    });

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        return process.exit(1);
    });

    process.on('SIGTERM',function(){
        log.info('Received TERM, exitting app.');
        if (state.cmdl.daemon){
            daemon.removePidFile(state.config.pidFile);
        }

        if (cluster.isMaster){
            cluster.disconnect(function(){
                return process.exit(0);
            });
            return;
        }
        return process.exit(0);
    });

    return q(state);
};

service.cluster = function(state){


    return q(state);
};

service.daemonize = function(state){
    // Daemonize if so desired
    var log = logger.getLog(), deferred;
    if (!state.cmdl.daemon){
        log.trace('no need to daemonize');
        return q(state);
    }

    if (process.env.RUNNING_AS_DAEMON !== undefined) {
        log.trace('i am the daemon');
        return q(state); 
    }
  
    deferred = q.defer();
    daemon.daemonize(state.config.pidFile, function(rc,msg){
        deferred.reject({ message : msg, code: rc });
    });

    // if daemonize succeeds the process will exit, so no
    // need to resolve.
    return deferred.promise;
};

service.listen = function(state){
    var deferred = q.defer();
    console.log('listening');
    setTimeout(function(){
        deferred.resolve(state);
    },4000);
    return deferred.promise;
};

if (!__ut__){

    q(service.parseCmdLine(state))
    .then(service.configure)
    .then(service.daemonize)
    .then(service.cluster)
    .then(service.handleSignals)
    .then(service.listen)
    .then(function(state){
        log.info('all done:',state);
        process.exit(0);
    })
    .catch( function(err){
        var log = lgger.getLog();
        console.log('GOT AN ERROR:',err);
        log.error(err.message);
        if (err.code)   {
            process.exit(err.code); 
        }
        process.exit(1);
    });

}

module.exports = {
    "service" : service
};
