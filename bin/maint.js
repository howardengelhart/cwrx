var fs      = require('fs-extra'),
    express = require('express'),
    path    = require('path'),
    q       = require('q'),
    cp      = require('child_process'),
    aws     = require('aws-sdk'),
    cwrx    = require(path.join(__dirname,'../lib/index')),
    dub     = require(path.join(__dirname,'dub')),
    app     = express();
    
var __ut__   = ((module.parent) && (module.parent.filename) &&
               (module.parent.filename.match(/\.spec.js$/))) ? true : false;

if (!__ut__) {
    main();
}

function main() {

    var program = require('commander');
    
    program
    .option("-c, --config [CFGFILE]','Specify a config file")
    .option('-g, --gid [GID]','Run as group (id or name).')
    .option('-u, --uid [UID]','Run as user (id or name).')
    .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
    .option('-p, --port [PORT]','Listent on port [4000].',4000)
    .option('-d, --daemon','Run as a daemon.')
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

    var config = dub.createConfiguration(program);
    aws.config.loadFromPath(config.s3.auth);

    var log = cwrx.logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }

    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error('uncaught: ' + err.message + "\n" + err.stack);
        }
        process.exit(1);
    });

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        process.exit(1);
    });

    process.on('SIGTERM',function(){
        log.info('Received TERM, exitting app.');
        if (program.daemon){
            config.removePidFile("maint.pid");
        }
        process.exit(0);
    });

    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {

        // First check to see if we're already running as a daemon
        var pid = config.readPidFile("maint.pid");
        if (pid){
            var exists = false;
            try {
                exists = process.kill(pid,0);
            }catch(e){
            }

            if (exists) {
                console.error('It appears daemon is already running (' + pid +
                    '), please sig term the old process if you wish to run a new one.');
                return done(1,'need to term ' + pid);
            } else {
                log.error('Process [' + pid + '] appears to be gone, will restart.');
                config.removePidFile("maint.pid");
            }

        }

        // Proceed with daemonization
        console.log('Daemonizing.');
        log.info('Daemonizing and forking child..');
        var child_args = [];
        process.argv.forEach(function(val, index) {
            if (index > 0) {
                child_args.push(val);            
            }
        });
      
        // Add the RUNNING_AS_DAEMON var to the environment
        // we are forwarding along to the child process
        process.env.RUNNING_AS_DAEMON = true;
        var child = cp.spawn('node',child_args, { 
            stdio   : 'ignore',
            detached: true,
            env     : process.env
        });
      
        child.unref();
        log.info('child spawned, pid is ' + child.pid + ', exiting parent process..');
        config.writePidFile(child.pid, "maint.pid");
        console.log("child has been forked, exit.");
        process.exit(0);
    }


    app.use(express.bodyParser());

    app.post("/maint/remove_S3_script", function(req, res, next) {
        log.info("Starting remove S3 script");
        log.info(JSON.stringify(req.body));
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

    app.post("/maint/clean_cache", function(req, res, next) {
        var job;
        log.info("Starting clean cache");
        try {
            job = dub.createDubJob(cwrx.uuid().substr(0,10), req.body, config);
        } catch (e){
            log.error("Create job error: " + e.message);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : e.message
            });
            return;
        }
        log.info("Removing cached files for " + job.videoPath.match(/[^\/]*\..*$/)[0]);
        var remList = [job.videoPath, job.scriptPath, job.outputPath];
        job.tracks.forEach(function(track) { remList.push(track.fpath); });
        
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

    app.listen(program.port);
    log.info("Maintenance server is listening on port: " + program.port);
}

function removeFiles(remList) {
    var delCount = 0, 
        deferred = q.defer(),
        log = cwrx.logger.getLog();
        
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

