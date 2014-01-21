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
    state       = {
        argv : process.argv
    },
    service     = {};   // for exporting functions to unit tests

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
        .parse(state.argv);

    return q(state);
};

service.configure = function(state){
    var log;
    state.config = config.createConfigObject(state.cmdl.config, {});
    
    if (state.config.log) {
        log = logger.createLog(state.config.log);
    } else {
        log = logger.getLog();
    }

    return q(state);
};

service.handleSignals = function(state){


};

service.cluster = function(state){


};

service.daemonize = function(state){
    return q(state);
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
