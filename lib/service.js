var fs          = require('fs-extra'),
    path        = require('path'),
    cluster     = require('cluster'),
    q           = require('q'),
    daemon      = require('../lib/daemon'),
    logger      = require('../lib/logger'),
    config      = require('../lib/config'),
    mongoUtils  = require('../lib/mongoUtils'),
    service     = {};

service.getVersion = function(appName,appDir) {
    var fpath = path.join(appDir ? appDir : '.', appName ? appName : '.version'),
        log = logger.getLog();
        
    if (fs.existsSync(fpath)) {
        try {
            return fs.readFileSync(fpath).toString().trim();
        } catch(e) {
            log.error('Error reading version file: ' + e.message);
        }
    }
    return undefined;
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

    return state;
};

service.configure = function(state){
    var log, configPath, showConfig;
    if (state.cmdl){
        configPath = state.cmdl.config;
        showConfig = state.cmdl.showConfig;
    }
    state.config = config.createConfigObject(configPath, state.defaultConfig);
    
    if (!state.config.appName){
        state.config.appName = path.basename(process.argv[1]).replace(/\.js$/,'');
    }
    
    if (state.config.log) {
        log = logger.createLog(state.config.log);
    } else {
        log = logger.getLog();
    }
   
    if (state.config.caches){
        if (!showConfig){
            Object.keys(state.config.caches).forEach(function(key){
                log.trace('Ensure cache[' + key + ']: ' + state.config.caches[key]);
                if (!fs.existsSync(state.config.caches[key])){
                    log.trace('Create cache[' + key + ']: ' + state.config.caches[key]);
                    fs.mkdirsSync(state.config.caches[key]);
                }
            });
        } 
        state.config.cacheAddress = function(fname,cache){
            return path.join(state.config.caches[cache],fname);
        };
    }

    if (!state.config.pidPath){
        if (!state.config.pidFile){
            state.config.pidFile = state.config.appName + '.pid';
        }

        if (state.config.caches && state.config.caches.run){
            state.config.pidPath = state.config.cacheAddress(state.config.pidFile,'run');
        } else {
            if (!state.config.pidDir) {
                state.config.pidDir = '.';
            }
            state.config.pidPath = path.join(state.config.pidDir,state.config.pidFile);
        }
    }
    
    if (state.config.secretsPath) {
        state.secrets = fs.readJsonSync(state.config.secretsPath);
    }

    // override configuration with command line values
    if (state.cmdl){
        if (state.cmdl.daemon !== undefined){
            state.config.daemon = state.cmdl.daemon;
        }

        if (state.cmdl.server !== undefined){
            state.config.server = state.cmdl.server;
        }

        if (state.cmdl.kids !== undefined){
            state.config.kids = state.cmdl.kids;
        }

        if (state.cmdl.loglevel !== undefined){
            state.config.logLevel = state.cmdl.loglevel;
        }
        
        if (state.cmdl.gid !== undefined){
            state.config.gid = state.cmdl.gid;
        }
       
        if (state.cmdl.uid !== undefined){
            state.config.uid = state.cmdl.uid;
        }
    }

    state.config.appVersion = service.getVersion(state.config.appName,state.config.appDir);

    if (state.cmdl.showConfig){
        console.log(JSON.stringify(state.config,null,3));
        process.exit(0);
    }

    if (state.config.appVersion === undefined){
        log.warn('%1, version is unknown.',state.config.appName);
    } else {
        log.info('%1, version: %2.',state.config.appName, state.config.appVersion);
    }

    return state;
};

service.prepareServer = function(state){
    var log = logger.getLog();
    if (!state.config.server){
        log.trace('not running as server, no need to prepareServer');
        return state;
    }
    
    if (state.config.gid){
        process.setgid(state.config.gid);
    }
   
    if (state.config.uid){
        process.setuid(state.config.uid);
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
        if (state.config.daemon){
            daemon.removePidFile(state.config.pidPath);
        }

        if (cluster.isMaster && (state.config.kids > 0)){
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

    process.title = path.basename(process.argv[1]) + ' ' + process.argv.slice(2).join(' ');

    return state;
};

service.cluster = function(state){
    var log = logger.getLog();
    state.clusterMaster = false;
    if (state.config.kids < 1){
        log.trace('no kids, no clustering, skip');
        return state;
    }

    if (!cluster.isMaster){
        process.title = path.basename(process.argv[1]) + ' (worker)';
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
    
    log.info("Will spawn " + state.config.kids + " kids.");
    if (!state.kids){
        state.kids = [];
    }
    for (var i = 0; i < state.config.kids; i++) {
        state.kids.push(cluster.fork());
    }

    log.info("Spawning done, hanging around my empty nest.");
    return state;
};

service.daemonize = function(state){
    // Daemonize if so desired
    var log = logger.getLog(), deferred;
    if (!state.config.daemon){
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

service.initMongo = function(state) {
    var log = logger.getLog(), username, password, deferred ;
    if (!state.config.mongo || !state.secrets || !state.secrets.mongoCredentials) {
        return q.reject({
            message: "Need mongo config information and a secrets file with credentials"
        });
    }
    
    username = state.secrets.mongoCredentials.user;
    password = state.secrets.mongoCredentials.password;
    deferred = q.defer();
   
    function doConnect(){
        mongoUtils.connect(state.config.mongo.host, state.config.mongo.port)
        .done(function(mongoClient) {
            log.info('Successfully connected to mongo at %1:%2',
                     state.config.mongo.host, state.config.mongo.port);
            state.db = mongoClient.db(state.config.mongo.db);
            q.npost(state.db, 'authenticate', [username, password])
                .then(function(){
                    log.info('Sucessfully authenticated with db: %1',state.config.mongo.db);
                    if (state.config.sessions && state.config.sessions.db) {
                        state.sessionsDb = mongoClient.db(state.config.sessions.db);
                        state.sessionsDb.openCalled = true;
                        return q.npost(state.sessionsDb, 'authenticate', [username, password]);
                    } else {
                        return true;
                    }
                })
                .done(function(){
                    if (state.sessionDb){
                        log.info('Sucessfully authenticated with sessionDb: %1',
                            state.config.sessions.db);
                    }
                    deferred.resolve(state);
                }, function(err) {
                    deferred.reject(err);
                });

            
        }, function(err) {
            if (state.config.mongo.retryConnect){
                setTimeout(doConnect,1000); 
                log.error(err);
                deferred.notify('retry');
            } else {
                deferred.reject(err);
            }
        });
    }

    process.nextTick(doConnect);

    return deferred.promise;

};

module.exports = service;
