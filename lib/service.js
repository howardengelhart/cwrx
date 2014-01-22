var fs          = require('fs-extra'),
    path        = require('path'),
    cluster     = require('cluster'),
    q           = require('q'),
    daemon      = require('../lib/daemon'),
    logger      = require('../lib/logger'),
    config      = require('../lib/config'),
    service     = {};

service.getVersion = function(appName,appDir) {
    var fpath = path.join(appDir ? appDir : '.', appName ? appName + '.version' : '.version'),
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

service.start = function(state){
    return q(state);
};

service.parseCmdLine = function(state){
    state.cmdl = require('commander');
    
    state.cmdl
        .option('-c, --config [CFGFILE]','Specify config file')
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-g, --gid [GID]','Run as group (id or name).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-k, --kids [KIDS]','Number of kids to spawn.', parseInt, 0)
        .option('-p, --port [PORT]','Listent on port (requires -s) [3100].',parseInt,3100)
        .option('-s, --server','Run as a server.')
        .option('-u, --uid [UID]','Run as user (id or name).')
        .option('--show-config','Display configuration and exit.')
        .parse(process.argv);
   
    if (state.cmdl.daemon) {
        state.cmdl.server = true;
    }

    if (state.cmdl.kids > 0) {
        state.cmdl.daemon = true;
        state.cmdl.server = true;
    }

    if (state.cmdl.gid){
        process.setgid(state.cmdl.gid);
    }
   
    if (state.cmdl.uid){
        process.setuid(state.cmdl.uid);
    }

    return state;
};

service.configure = function(state){
    var log;
    state.config = config.createConfigObject(state.cmdl.config, state.defaultConfig);
    
    if (state.config.log) {
        log = logger.createLog(state.config.log);
    } else {
        log = logger.getLog();
    }

    if (!state.config.pidPath){
        state.config.pidPath = path.join(state.config.pidDir,state.config.pidFile);
    }
    return state;
};

service.handleSignals = function(state){
    var log = logger.getLog();
    if (!state.cmdl.server){
        log.trace('not running as server, no need to handleSignals');
        return state;
    }

    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error(err);
        }
    });

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        return process.exit(1);
    });

    process.on('SIGTERM',function(){
        log.info('Received TERM');
        if (state.cmdl.daemon){
            daemon.removePidFile(state.config.pidPath);
        }

        if (cluster.isMaster && (state.cmdl.kids > 0)){
            cluster.disconnect(function(){
                if (state.kids){
                    state.kids.forEach(function(kid){
                        process.nextTick(function(){
                            kid.kill();
                        });
                    });
                }
                setTimeout(function(){
                    log.info('Cluster disconnected, exit.');
                    return process.exit(0);
                },1000);
            });
            return;
        }
        log.info('Exit.');
        return process.exit(0);
    });

    return state;
};

service.cluster = function(state){
    var log = logger.getLog();
    state.clusterMaster = false;
    if (state.cmdl.kids < 1){
        log.trace('no kids, no clustering, skip');
        return state;
    }

    if (!cluster.isMaster){
        log.trace('i am a cluster kid, skip');
        return state;
    }

    state.clusterMaster = true;
    
    log.info('Running as cluster master');

    cluster.on('exit', function(worker, code, signal) {
        var idx = state.kids.indexOf(worker);
        if (worker.suicide === true){
            log.error('Worker ' + worker.process.pid + ' died peacefully');
        } else {
            log.error('Worker ' + worker.process.pid + ' died, restarting...');
            if (idx > -1){
                log.info('Replacing worker %1.',worker.process.pid);
                state.kids[idx] = cluster.fork();
            } else {
                log.warn('Could not find worker %1, adding to q.',worker.process.pid);
                state.kids.push(cluster.fork());
            }
        }
    });

    cluster.on('fork', function(worker){
        log.info('Worker [' + worker.process.pid + '] has forked.');
    });
    
    cluster.on('online', function(worker){
        log.info('Worker [' + worker.process.pid + '] is now online.');
    });
    
    cluster.on('listening', function(worker,address){
        log.info('Worker [' + worker.process.pid + '] is now listening on ' + 
            address.address + ':' + address.port);
    });
    
    cluster.setupMaster( { silent : true });
    
    log.info("Will spawn " + state.cmdl.kids + " kids.");
    if (!state.kids){
        state.kids = [];
    }
    for (var i = 0; i < state.cmdl.kids; i++) {
        state.kids.push(cluster.fork());
    }

    log.info("Spawning done, hanging around my empty nest.");
    return state;
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
    daemon.daemonize(state.config.pidPath, function(rc,msg){
        deferred.reject({ message : msg, code: rc });
    });

    // if daemonize succeeds the process will exit, so no
    // need to resolve.
    return deferred.promise;
};

module.exports = service;
