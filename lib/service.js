(function(){
    'use strict';
    var fs          = require('fs-extra'),
        path        = require('path'),
        cluster     = require('cluster'),
        q           = require('q'),
        util        = require('util'),
        events      = require('events'),
        daemon      = require('./daemon'),
        logger      = require('./logger'),
        config      = require('./config'),
        mongoUtils  = require('./mongoUtils'),
        cacheLib    = require('./cacheLib'),
        pubsub      = require('./pubsub'),
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
            .option('-k, --kids [KIDS]','Number of kids to spawn.', parseInt)
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
                state.config.log.logLevel = state.cmdl.loglevel;
            }

            if (state.cmdl.gid !== undefined){
                state.config.gid = state.cmdl.gid;
            }

            if (state.cmdl.uid !== undefined){
                state.config.uid = state.cmdl.uid;
            }
            
            if (state.cmdl.port !== undefined){
                state.config.port = state.cmdl.port;
            }
        }

        //IMPORTANT:  This must be done BEFORE any files are created by the process
        //(ie logs or pids), to ensure that if started by a system account any 
        //created files will belong to the gid/uid specified by the config/command line
        if (state.config.gid){
            process.setgid(state.config.gid);
        }

        if (state.config.uid){
            process.setuid(state.config.uid);
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

        state.config.appVersion = service.getVersion(
                state.config.appName + '.version',state.config.appDir);

        if (state.cmdl.showConfig){
            console.log(JSON.stringify(state.config,null,3));
            process.exit(0);
        }

        if (state.config.appVersion === undefined){
            log.warn('%1 service, version is unknown.',state.config.appName);
        } else {
            log.info('%1 service, version: %2.',state.config.appName, state.config.appVersion);
        }

        return state;
    };

    service.prepareServer = function(state){
        var log = logger.getLog();
        if (!state.config.server){
            log.trace('not running as server, no need to prepareServer');
            return state;
        }

        process.on('uncaughtException', function(err) {
            try{
                log.error('uncaught: ' + err.message + '\n' + err.stack);
            }catch(e){
                console.error(err);
            }
        });

        process.on('SIGINT',function(){
            log.info('Received SIGINT, exitting app.');
            return process.exit(1);
        });

        process.on('SIGHUP',function(){

            function doSIGHUP(){
                log.info('Received HUP, will hup log');
                log.refresh();
        
                if (state.clusterMaster ){
                    state.kids.forEach(function(kid){
                        kid.send({ cmd : 'hup' });
                    });
                }
            }

            if (state.onSIGHUP){
                state.onSIGHUP().timeout(3000).finally(doSIGHUP);
            } else {
                doSIGHUP();
            }

        });

        process.on('SIGTERM',function(){
            log.info('Received TERM');

            function doSIGTERM(){
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
            }

            if (state.onSIGTERM){
                state.onSIGTERM().timeout(3000).finally(doSIGTERM);
            } else {
                doSIGTERM();
            }
        });

        process.title = path.basename(process.argv[1]) + ' ' + process.argv.slice(2).join(' ');

        return state;
    };

    service.cluster = function(state){
        var log = logger.getLog();
        state.clusterMaster = false;
        if (!state.config.kids || state.config.kids < 1){
            log.trace('no kids, no clustering, skip');
            return state;
        }

        if (!cluster.isMaster){
            process.title = path.basename(process.argv[1]) + ' (worker)';
            log.trace('i am a cluster kid, skip');
            process.on('message',function(msg){
                log.trace('Received a message: %1',JSON.stringify(msg));
                if (msg.cmd === 'hup'){
                    log.info('Received HUP, will hup log');
                    log.refresh();
                }
            });
            return state;
        }

        state.clusterMaster = true;

        log.info('Running as cluster master');

        cluster.on('exit', function(worker/*, code, signal*/) {
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

        log.info('Will spawn ' + state.config.kids + ' kids.');
        if (!state.kids){
            state.kids = [];
        }
        for (var i = 0; i < state.config.kids; i++) {
            state.kids.push(cluster.fork());
        }

        log.info('Spawning done, hanging around my empty nest.');
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
        var log = logger.getLog();
        if (state.clusterMaster) {
            log.info('Cluster master, not a worker, not creating mongo connections');
            return q(state);
        }
        if (!state.config.mongo || !state.secrets || !state.secrets.mongoCredentials) {
            return q.reject({
                message: 'Need mongo config information and a secrets file with credentials'
            });
        }
        state.dbStatus = state.dbStatus || {};
        state.dbs = {};
        
        return q.all(Object.keys(state.config.mongo).map(function(dbName) {
            var deferred = q.defer(),
                host = state.config.mongo[dbName].host,
                hosts = state.config.mongo[dbName].hosts,
                port = state.config.mongo[dbName].port,
                replSet = state.config.mongo[dbName].replSet,
                username = state.secrets.mongoCredentials.user,
                password = state.secrets.mongoCredentials.password;

            function doConnect(){
                mongoUtils.connect(host, port, dbName, username, password, hosts, replSet)
                .then(function(db) {
                    log.info('Successfully connected to %1 at %2',
                             dbName, replSet || (host + ':' + port));
                    
                    db.on('error', function(error) {
                        log.error('Connection to %1 received an error: %2', dbName, error);
                        log.info('Attempting to recreate connection');
                        delete state.dbs[dbName];
                        process.nextTick(doConnect);
                    });
                    db.on('close', function() {
                        log.error('Connection to %1 closed, attempting to recreate', dbName);
                        delete state.dbs[dbName];
                        process.nextTick(doConnect);
                    });
                    
                    state.dbs[dbName] = db;

                    if (state.dbStatus[dbName]) {
                        state.dbStatus[dbName].emit('reconnected');
                    } else {
                        state.dbStatus[dbName] = new events.EventEmitter();
                    }

                    return true;
                }).then(function() {
                    deferred.resolve(state);
                }).catch(function(error) {
                    if (state.config.mongo[dbName].retryConnect && error.errmsg !== 'auth fails') {
                        setTimeout(doConnect, 1000);
                        log.error(error);
                        deferred.notify('retry');
                    } else {
                        deferred.reject(error);
                    }
                });
            }
            
            process.nextTick(doConnect);
            return deferred.promise;
        }))
        .then(function() {
            return q(state);
        });
    };

    service.initSessionStore = function(state) {
        var log = logger.getLog();
        if (state.clusterMaster) {
            log.info('Cluster master, not a worker, not creating session storage');
            return q(state);
        }
        if (!state.config.sessions || !state.secrets || !state.secrets.mongoCredentials) {
            return q.reject({
                message: 'Need sessions config and secrets with credentials'
            });
        }
        state.dbStatus = state.dbStatus || {};

        var express     = require('express'),
            MongoStore  = require('connect-mongo')(express),
            host        = state.config.sessions.mongo.host,
            hosts       = state.config.sessions.mongo.hosts,
            port        = state.config.sessions.mongo.port,
            replSet     = state.config.sessions.mongo.replSet,
            username    = state.secrets.mongoCredentials.user,
            password    = state.secrets.mongoCredentials.password,
            deferred    = q.defer();

        function doConnect(){
            mongoUtils.connect(host, port, 'sessions', username, password, hosts, replSet)
            .then(function(db) {
                log.info('Successfully connected to sessions at %1',replSet || (host + ':' + port));

                db.on('error', function(error) {
                    log.error('Connection to sessions received an error: %1', error);
                    log.info('Attempting to recreate connection');
                    delete state.sessionStore;
                    process.nextTick(doConnect);
                });
                db.on('close', function() {
                    log.error('Connection to sessions closed, attempting to recreate');
                    delete state.sessionStore;
                    process.nextTick(doConnect);
                });

                db.openCalled = true;
                state.sessionStore = new MongoStore({
                    stringify: false,
                    db: db
                });

                if (state.dbStatus.sessions) {
                    state.dbStatus.sessions.emit('reconnected');
                } else {
                    state.dbStatus.sessions = new events.EventEmitter();
                }

                return true;
            }).then(function() {
                deferred.resolve(state);
            }).catch(function(error) {
                if (state.config.sessions.mongo.retryConnect && error.errmsg !== 'auth fails') {
                    setTimeout(doConnect, 1000);
                    log.error(error);
                    deferred.notify('retry');
                } else {
                    deferred.reject(error);
                }
            });
        }
        
        process.nextTick(doConnect);
        return deferred.promise;
    };

    service.initPubSubs = function(state) { //TODO: rename? comment
        var log = logger.getLog();
        
        state.publishers = {};
        state.subscribers = {};
        
        if (!state.config.pubsub) {
            log.info('No pubsub channels to initialize, skipping');
            return q(state);
        }
        
        return q.all(Object.keys(state.config.pubsub).map(function(channel) {
            var connCfg = {
                port: state.config.pubsub[channel].port || undefined,
                path: state.config.pubsub[channel].path || undefined,
                host: state.config.pubsub[channel].host || undefined
            };
            if (state.config.pubsub[channel].isPublisher) {
                state.publishers[channel] = new pubsub.Publisher(channel, connCfg);
            } else {
                state.subscribers[channel] = new pubsub.Subscriber(
                    channel,
                    connCfg,
                    state.config.pubsub[channel].pollDelay
                );
            }
        }))
        .thenResolve(state);
    };
    
    service.initCache = function(state) {
        var log = logger.getLog(),
            servers, cfgChannel;
        
        if (!state.config.cache || !state.config.cache.enabled) {
            log.info('Cache not enabled, not initializing the cache');
            return q(state);
        }
        
        if (state.config.cache.servers) {
            servers = state.config.cache.servers;
        }
        
        cfgChannel = state.subscribers && state.subscribers.cacheCfg || undefined;
        
        if (cfgChannel && cfgChannel.lastMsg && cfgChannel.lastMsg.servers) {
            servers = cfgChannel.lastMsg.servers;
        }

        state.cache = new cacheLib.Cache(
            servers,
            state.config.cache.readTimeout,
            state.config.cache.writeTimeout
        );
        
        if (cfgChannel) {
            cfgChannel.on('message', function(cfg) {
                state.cache.updateServers(cfg.servers);
            });
        }
        
        return q(state);
    };
    
    /* Some of our endpoints use mongo query hints that rely on certain indices existing on our
     * mongo collections. This will ensure that those indices exist, reading the requiredIndices
     * from each db in state.config.mongo. */
    service.ensureIndices = function(state) {
        var log = logger.getLog();
        if (state.clusterMaster) {
            log.info('Cluster master, not a worker, not ensuring mongo indices');
            return q(state);
        }
        if (!state.config.mongo) {
            log.info('No mongo config, not ensuring any indices');
            return q(state);
        }
        
        return q.all(Object.keys(state.config.mongo).map(function(dbName) {
            var indices = state.config.mongo[dbName].requiredIndices,
                db = state.dbs && state.dbs[dbName] || null;

            if (!indices || Object.keys(indices).length === 0) {
                return q();
            }
            if (!db) {
                return q.reject('No db object created for ' + dbName);
            }

            return q.all(Object.keys(indices).map(function(collName) {
                var collection = db.collection(collName);
                return q.all(indices[collName].map(function(field) {
                    return q.npost(collection, 'ensureIndex', [field])
                    .then(function() {
                        log.info('Ensured index for field %1 on %2.%3', field, dbName, collName);
                    })
                    .catch(function(error) {
                        return q.reject('Failed to create index for field ' + field + ' on ' +
                                        dbName + '.' + collName + ' : ' + util.inspect(error));
                    });
                }));
            }));
        }))
        .thenResolve(state);
    };

    module.exports = service;
}());
