#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

process.env.maint = true;

var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    express     = include('express'),
    path        = include('path'),
    q           = include('q'),
    cp          = include('child_process'),
    aws         = include('aws-sdk'),
    logger      = include('../lib/logger'),
    daemon      = include('../lib/daemon'),
    uuid        = include('../lib/uuid'),
    cwrxConfig  = include('../lib/config'),
    dub         = include(path.join(__dirname,'dub')),
    logtailKids = {},
    app         = express(),

    // This is the template for maint's configuration
    defaultConfiguration = {
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
            line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
            blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
            script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
            video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
            output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/'),
            jobs    : path.normalize('/usr/local/share/cwrx/dub/caches/jobs/'),
        },
        s3 : {
            share   : {
                bucket  : 'c6.dev',
                path    : 'media/usr/screenjack/video/'
            },
            tracks  : {
                bucket  : 'c6.dev',
                path    : 'media/usr/screenjack/track/'
            },
            auth    : path.join(process.env.HOME,'.aws.json')
        },
        tts : {
            auth        : path.join(process.env.HOME,'.tts.json'),
            bitrate     : '48k',
            frequency   : 22050,
            workspace   : __dirname
        }
    },

    // Attempt a graceful exit
    exitApp  = function(resultCode,msg){
        var log = logger.getLog();
        if (msg){
            if (resultCode){
                log.error(msg);
            } else {
                log.info(msg);
            }
        }
        process.exit(resultCode);
    };
    
function getVersion() {
    var fpath = path.join(__dirname, 'maint.version'),
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
}

function createConfiguration(cmdLine) {
    var cfgObject = cwrxConfig.createConfigObject(cmdLine.config, defaultConfiguration),
        log;

    if (cfgObject.log) {
        log = logger.createLog(cfgObject.log);
    }

    try {
        aws.config.loadFromPath(cfgObject.s3.auth);
    }  catch (e) {
        throw new SyntaxError('Failed to load s3 config: ' + e.message);
    }

    cfgObject.ensurePaths = function(){
        var self = this;
        Object.keys(self.caches).forEach(function(key){
            log.trace('Ensure cache[' + key + ']: ' + self.caches[key]);
            if (!fs.existsSync(self.caches[key])){
                log.trace('Create cache[' + key + ']: ' + self.caches[key]);
                fs.mkdirsSync(self.caches[key]);
            }
        });
    };

    cfgObject.cacheAddress = function(fname,cache){
        return path.join(this.caches[cache],fname);
    };
    
    return cfgObject;
}

function removeFiles(remList) {
    var delCount = 0, 
        deferred = q.defer(),
        log = logger.getLog();
        
    q.all(remList.map(function(fpath) {
        if (fs.existsSync(fpath)) {
            log.info("Removing " + fpath);
            delCount++;
            return q.npost(fs, "remove", [fpath]);
        }
        else return q();
    })).then(
        function() { return deferred.resolve(delCount); },
        function(error) { return deferred.reject(error); }
    );
    return deferred.promise;
}

function restartService(serviceName) {
    var log = logger.getLog(), exec = cp.exec, child, deferred;
    log.info('Will attempt to restart service: %1', serviceName);
    deferred = q.defer(); 

    child = exec('service ' + serviceName + ' restart', function (error, stdout, stderr) {
        log.info('stdout: %1' , stdout);
        log.info('stderr: %2' , stderr);
        if (error !== null) {
            log.error('exec error: %3' , error.message);
            return deferred.reject(error);
        }

        deferred.resolve(serviceName);
    });

    return deferred.promise;
}

function startLogTail(logfile, config) {
    var log = logger.getLog();
    if (logtailKids[logfile]) {
        log.info("Already tailing %1", logfile);
        return { code: 200, data: "tail already started" };
    }
    var logpath = path.join(config.log.logDir, logfile);
    log.trace("Starting tail on %1", logpath);
    logtailKids[logfile] = cp.spawn('tail', ['-n', 0, '-f', logpath]);

    logtailKids[logfile].stderr.on('data', function(data) {
        log.error("Killing tail on %1 since it wrote to stderr: %2", logfile, data.toString());
        logtailKids[logfile].attemptedKill = true;
        logtailKids[logfile].kill();
        delete logtailKids[logfile];
    });

    logtailKids[logfile].on('error', function(error) {
        if (!logtailKids[logfile].attemptedKill) {
            log.error("Killing tail on %1 since it received an error event: %2", logfile, error);
            logtailKids[logfile].attemptedKill = true;
            logtailKids[logfile].kill();
        } else {
            log.error("Cannot kill tail on %1 with pid %2: %3",
                      logfile, logtailKids[logfile].pid, error);
        }
        delete logtailKids[logfile];
    });
    
    log.info("Started tail on %1", logpath);
    return { code: 200, data: "tail started" };
}

function getLogLines(logfile) {
    var log = logger.getLog();
    if (!logtailKids[logfile]) {
        log.info("Tail has not been started for %1", logfile);
        return { code: 400, data: { error: "tail not started" } };
    }
    var data = logtailKids[logfile].stdout.read();
    if (data) {
        log.info("Got log lines from %1", logfile);
        return { code: 200, data: data.toString() };
    } else {
        log.info("Got no data from %1", logfile);
        return { code: 200, data: '' };
    }
}

function stopLogTail(logfile) {
    var log = logger.getLog();
    if (!logtailKids[logfile]) {
        log.info("Tail has not been started for %1", logfile);
        return { code: 200, data: "tail not started" };
    } else {
        logtailKids[logfile].kill();
        delete logtailKids[logfile];
        log.info("Stopped tailing %1", logfile);
        return { code: 200, data: 'stopped tail' };
    }
}

if (!__ut__){
    try {
        main(function(rc,msg){
            exitApp(rc,msg);
        });
    } catch(e) {
        exitApp(1,e.stack);
    }
}

function main(done) {
    var program  = include('commander'),
        config = {},
        log, userCfg;
    
    program
        .option('-c, --config [CFGFILE]','Specify a config file')
        .option('-g, --gid [GID]','Run as group (id or name).')
        .option('-u, --uid [UID]','Run as user (id or name).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-p, --port [PORT]','Listent on port [4000].',4000)
        .option('-d, --daemon','Run as a daemon.')
        .option('--show-config','Display configuration and exit.')
        .parse(process.argv);

    if (program.gid){
        console.log('\nChange process to group: ' + program.gid);
        process.setgid(program.gid);
    }

    if (program.uid){
        console.log('\nChange process to user: ' + program.uid);
        process.setuid(program.uid);
    }

    if (!program.config) {
        throw new Error("Please use the -c option to provide a config file");
    }

    config = createConfiguration(program);

    if (program.showConfig){
        console.log(JSON.stringify(config,null,3));
        process.exit(0);
    }

    config.ensurePaths();

    log = logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }

    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error('uncaught: ' + err.message + "\n" + err.stack);
        }
        return done(2);
    });

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        return done(1,'Exit');
    });

    process.on('SIGTERM',function(){
        log.info('Received TERM, exitting app.');
        if (program.daemon){
            daemon.removePidFile(config.cacheAddress('maint.pid', 'run'));
        }
        return done(0,'Exit');
    });

    log.info('Running version ' + getVersion());
    
    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
        daemon.daemonize(config.cacheAddress('maint.pid', 'run'), done);
    }

    app.use(express.bodyParser());
    
    app.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", 
                   "Origin, X-Requested-With, Content-Type, Accept");
        res.header("cache-control", "max-age=0");

        if (req.method.toLowerCase() === "options") {
            res.send(200);
        } else {
            next();
        }
    });

    app.all('*', function(req, res, next) {
        req.uuid = uuid.createUuid().substr(0,10);
        if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
            log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                req.method, req.url, req.httpVersion);
        } else {
            log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                req.method, req.url, req.httpVersion);
        }
        next();
    });

    app.post("/maint/remove_S3_script", function(req, res, next) {
        log.info("Starting remove S3 script");
        log.trace(JSON.stringify(req.body));
        var fname = req.body.fname;
        if (!fname) {
            log.error("Incomplete params in request");
            res.send(400, {
                error   : "Bad request",
                detail  : "Need filename in request"
            });
            return;
        }
        var s3 = new aws.S3(),
            params = {
            Bucket: config.s3.share.bucket,
            Key: path.join(config.s3.share.path, fname)
        };
        log.info("Removing script: Bucket = " + params.Bucket + ", Key = " + params.Key);
        s3.deleteObject(params, function(err, data) {
            if (err) {
                log.error("Delete object error: " + err);
                res.send(500, {
                    error   : "Unable to process request",
                    detail  : err
                });
            } else {
                log.info("Successfully removed script");
                res.send(200, { msg: "Successfully removed script" });
            }
        });
    });
    
    app.post("/maint/cache_file", function(req, res, next) {
        log.info("Starting cache file");
        if (!req.body || !req.body.fname || !req.body.data || !req.body.cache) {
            log.error("Incomplete params in request");
            res.send(400, {
                error   : "Bad request",
                detail  : "Need filename, cache name, and data in request"
            });
            return;
        }
        fs.writeFile(config.cacheAddress(req.body.fname, req.body.cache),
                     JSON.stringify(req.body.data), function(error) {
            if (error) {
                log.error("Error writing to file: " + error);
                res.send(500, {
                    error   : "Unable to process request",
                    detail  : error
                });
            } else {
                log.info("Successfully wrote file " + req.body.fname);
                res.send(200, {msg: "Successfully wrote file " + req.body.fname});
            }
        });
    });

    app.post("/maint/clean_cache", function(req, res, next) {
        var job;
        log.info("Starting clean cache");
        try {
            job = dub.createDubJob(uuid.createUuid().substr(0,10), req.body, config);
        } catch (e){
            log.error("Create job error: " + e.message);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : e.message
            });
            return;
        }
        log.info("Removing cached files for " + job.videoPath.match(/[^\/]*\..*$/)[0]);
        var remList = [job.videoPath, job.scriptPath, job.outputPath, job.videoMetadataPath];
        job.tracks.forEach(function(track) { 
            remList.push(track.fpath);
            remList.push(track.metapath);
        });
        
        removeFiles(remList).then(
            function(val) { 
                log.info("Successfully removed " + val + " objects");
                res.send(200, {msg: "Successfully removed " + val + " objects"}) ;
            }, function(error) {
                log.error("Remove files error: " + e);
                res.send(500,{
                    error  : 'Unable to process request.',
                    detail : error
                });
            }
        );
    });
    
    app.post("/maint/clean_track", function(req, res, next) {
        var job;
        log.info("Starting clean track");
        try {
            job = dub.createTrackJob(uuid.createUuid().substr(0,10), req.body, config);
        } catch (e){
            log.error("Create job error: " + e.message);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : e.message
            });
            return;
        }
        var remList = [job.outputPath],
            s3 = new aws.S3(),            
            outParams = job.getS3OutParams(),
            params = {
                Bucket: outParams.Bucket,
                Key: outParams.Key
            };
        
        log.info("Removing cached file " + job.outputFname);
        removeFiles(remList)
        .then(function(val) {
            log.info("Successfully removed local file " + job.outputPath);
            log.info("Removing track on S3: Bucket = " + params.Bucket + ", Key = " + params.Key);
            return q.npost(s3, 'deleteObject', [params]);
        }).then(function() {
            log.info("Successfully removed track on S3");
            res.send(200, "Successfully removed track");
        }).catch(function(error) {
            log.error("Error removing track: " + error);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : error
            });
        });
    });

    app.post("/maint/clean_all_caches", function(req, res, next) {
        var remList = [];
        log.info("Starting clean all caches");
        for (var key in config.caches) {
            remList.push(config.caches[key]);
        }
        removeFiles(remList).finally(function() { config.ensurePaths(); }).then(
            function(val) { 
                log.info("Successfully removed " + val + " objects");
                res.send(200, {msg: "Successfully removed " + val + " objects"});
            }, function(error) {
                log.error("Remove files error: " + e);
                res.send(500,{
                    error  : 'Unable to process request.',
                    detail : error
                });
            }
        );
    });
    
    app.post('/maint/logtail/start/:logfile', function(req, res, next) {
        try {
            var resp = startLogTail(req.params.logfile, config);
            res.send(resp.code, resp.data);
        } catch(e) {
            log.error("Error starting tail on %1: %2", req.params.logfile, e.message);
            res.send(500, "error starting tail: " + e.message);
        }
    });
    
    app.get('/maint/logtail/:logfile', function(req, res, next) {
        try {
            var resp = getLogLines(req.params.logfile);
            res.send(resp.code, resp.data);
        } catch(e) {
            log.error("Error getting log lines for %1: %2", req.params.logfile, e.message);
            res.send(500, "error getting log: " + e.message);
        }
    });
    
    app.post('/maint/logtail/stop/:logfile', function(req, res, next) {
        try {
            var resp = stopLogTail(req.params.logfile);
            res.send(resp.code, resp.data);
        } catch(e) {
            log.error("Error stopping tail on %1: %2", req.params.logfile, e.message);
            res.send(500, "error stopping tail: " + e.message);
        }
    });
    
    app.post('/maint/service/restart', function(req, res, next){
        if (!req.body || !req.body.service) {
            res.send(400, {
                error: "Bad request",
                detail: "You must include service parameter"
            });
            return;
        }
        restartService(req.body.service)
            .then(function(svcName){
                log.info('Successfully restarted %1',svcName);
                res.send(200);
            })
            .catch(function(error){
                log.error('Failed to restart %1: %2',req.body.service,error.message);
                res.send(500);
            });
    });
    
    app.get('/maint/meta', function(req, res, next){
        var data = {
            version: getVersion(),
            config: {
                caches: config.caches,
                s3: {
                    share: config.s3.share,
                    tracks: config.s3.tracks
                }
            }
        };
        res.send(200, data);
    });

    app.listen(program.port);
    log.info("Maintenance server is listening on port: " + program.port);
}

if (__ut__) {
    module.exports = {
        getVersion: getVersion,
        createConfiguration : createConfiguration,
        defaultConfiguration: defaultConfiguration,
        restartService      : restartService,
        removeFiles         : removeFiles,
        startLogTail        : startLogTail,
        getLogLines         : getLogLines,
        stopLogTail         : stopLogTail,
        logtailKids         : logtailKids
    };
}
