#!/usr/bin/env node

var __ut__   = ((module.parent) && (module.parent.filename) &&
               (module.parent.filename.match(/\.spec.js$/))) ? true : false;

////////////////////////////////////////////
// NodeFly
if (!__ut__) {
    (function(){
        var hostname      = require('os').hostname(),
            processNumber = process.env.INDEX_OF_PROCESS || 0;

        require('nodefly').profile(
            '2f5d8cc85e0038541f430ee81a88a44e',
            ['dub', hostname, processNumber],
            {
                blockThreshold : 100
            }
        );
    }());
}
////////////////////////////////////////////

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    cluster  = require('cluster'),
    cp       = require('child_process'),
    express  = require('express'),
    aws      = require('aws-sdk'),
    q        = require('q'),
    cwrx     = require(path.join(__dirname,'../lib/index')),

    // This is the template for our configuration
    defaultConfiguration = {
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
            line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
            script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
            video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
            output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
        },
        output : {
            "type" : "local",
            "uri"  : "/media"
        },
        s3 : {
            src : {
                bucket  : 'c6media',
                path    : 'src'
            },
            out : {
                bucket  : 'c6media',
                path    : 'usr'
            },
            auth    : path.join(process.env.HOME,'.aws.json')
        },
        tts : {
            auth        : path.join(process.env.HOME,'.tts.json'),
            bitrate     : '48k',
            frequency   : 22050,
            workspace   : __dirname
        },
    },

    // Attempt a graceful exit
    exitApp  = function(resultCode,msg){
        var log = cwrx.logger.getLog();
        if (msg){
            if (resultCode){
                log.error(msg);
            } else {
                log.info(msg);
            }
        }
        process.exit(resultCode);
    };

if (!__ut__){

    try {
        main(function(rc,msg){
            exitApp(rc,msg);
        });
    } catch(e) {
        exitApp(1,e.stack);
    }
}

function main(done){
    var program  = require('commander'),
        config, job, log;

    program
        .version('0.1.0')
        .option('-c, --config [CFGFILE]','Specify config file')
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-g, --gid [GID]','Run as group (id or name).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-k, --kids [KIDS]','Number of kids to spawn.', 0)
        .option('-p, --port [PORT]','Listent on port (requires -s) [3000].', 3000)
        .option('-s, --server','Run as a server.')
        .option('-u, --uid [UID]','Run as user (id or name).')
        .option('--enable-aws','Enable aws access.')
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
   
    config = createConfiguration(program);

    if (program.showConfig){
        console.log(JSON.stringify(config,null,3));
        process.exit(0);
    }

    config.ensurePaths();

    log = cwrx.logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }

    if (!program.server){
        // Running as a simple command line task, do the work and exit
        if (!program.args[0]){
            throw new SyntaxError('Expected a template file.');
        }

        job = createDubJob(loadTemplateFromFile(program.args[0]),config);
        
        handleRequest(job,function(err, finishedJob){
            if (err) {
                return done(1,err.message);
            } else {
                return done(0,'Done');
            }
        });

        return;
    }

    // Ok, so we're a server, lets do some servery things..
    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error(e);
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
            config.removePidFile();
        }

        if (cluster.isMaster){
//            Object.keys(cluster.workers).forEach(function(id){
//                cluster.workers[id].kill('SIGTERM');
//            });
            cluster.disconnect(function(){
                return done(0,'Exit');
            });
            return;
        }
        return done(0,'Exit');
    });

    log.info('Running version ' + program.version());
    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)){

        // First check to see if we're already running as a daemon
        var pid = config.readPidFile();
        if (pid){
            var exists = false;
            try {
                exists = process.kill(pid,0);
            }catch(e){
            }

            if (exists) {
                console.error('It appears daemon is already running (' + pid + '), please sig term the old process if you wish to run a new one.');
                return done(1,'need to term ' + pid);
            } else {
                log.error('Process [' + pid + '] appears to be gone, will restart.');
                config.removePidFile();
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
        config.writePidFile(child.pid);
        console.log("child has been forked, exit.");
        process.exit(0);
    }

    // Now that we either are or are not a daemon, its time to 
    // setup clustering if running as a cluster.
    if ((cluster.isMaster) && (program.kids > 0)) {
        clusterMain(config,program,done);
    } else {
        workerMain(config,program,done);
    }
}

function clusterMain(config,program,done) {
    var log = cwrx.logger.getLog();
    log.info('Running as cluster master');

    cluster.on('exit', function(worker, code, signal) {
        if (worker.suicide === true){
            log.error('Worker ' + worker.process.pid + ' died peacefully');
        } else {
            log.error('Worker ' + worker.process.pid + ' died, restarting...');
            cluster.fork();
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
    
    log.info("Will spawn " + program.kids + " kids.");
    for (var i = 0; i < program.kids; i++) {
        cluster.fork();
    }

    log.info("Spawning done, hanging around my empty nest.");
}

function workerMain(config,program,done){
    var app = express(),
        log = cwrx.logger.getLog();

    log.info('Running as cluster worker, proceed with setting up web server.');
    app.use(express.bodyParser());

    app.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

        if (req.method.toLowerCase() === "options") {
            res.send(200);
        } else {
            next();
        }
    });

    app.use('/',function(req, res, next){
        log.info('REQ: ' + '['  + 
                    req.connection.remoteAddress + ' ' + 
                    req.connection.remotePort + '] ' +
                    JSON.stringify(req.headers) + ' ' +
                    req.method + ' ' + 
                    req.url + ' ' +
                    req.httpVersion);
        next();
    });

    app.post('/dub/create', function(req, res, next){
        var job;
        try {
            job = createDubJob(req.body,config);
        }catch (e){
            log.error('Create Job Error: ' + e.stack);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : e.message
            });
            return;
        }
        handleRequest(job,function(err){
            if (err){
                log.error('Handle Request Error: ' + err.message);
                res.send(400,{
                    error  : 'Unable to complete request.',
                    detail : err.message
                });
                return;
            }
            if (job.md5)
                res.send(200, {
                    output : job.outputUri,
                    md5    : job.md5
                });
            else
                res.send(200, {
                    output : job.outputUri    
                });
        });
    });

    app.listen(program.port);
    log.info('Dub server is listening on port: ' + program.port);
}

function handleRequest(job, done){
    var log = cwrx.logger.getLog();
    
    // Each function returns a promise for job and checks job to see if it needs to be run.
    getSourceVideo(job)
    .then(convertLinesToMP3)
    .then(getVideoLength)
    .then(convertScriptToMP3)
    .then(applyScriptToVideo)
    .then(uploadToStorage)
    .then(
        function() {
            log.trace("All tasks succeeded!");
            done(null, job);
        }, function(error) {
            if (error['fnName'] && error['msg']) 
                done({message : 'Died on [' + error['fnName'] + ']: ' + error['msg']}, job);
            else
                done({message : 'Died: ' + error}, job);
        }
    );
}

function loadTemplateFromFile(tmplFile){
    var buff,tmplobj;
 
    buff = fs.readFileSync(tmplFile);
    try {
        tmplObj = JSON.parse(buff);
    } catch(e) {
        throw new Error('Error parsing template: ' + e.message);
    }

    if ((!(tmplObj.script instanceof Array)) || (!tmplObj.script.length)){
        throw new SyntaxError('Template is missing script section');
    }

    return tmplObj;
}

function createConfiguration(cmdLine){
    var log = cwrx.logger.getLog(),
        cfgObject = {},
        userCfg;

    if (cmdLine.config) { 
        userCfg = JSON.parse(fs.readFileSync(cmdLine.config, { encoding : 'utf8' }));
    } else {
        userCfg = {};
    }

    Object.keys(defaultConfiguration).forEach(function(section){
        cfgObject[section] = {};
        Object.keys(defaultConfiguration[section]).forEach(function(key){
            if ((userCfg[section] !== undefined) && (userCfg[section][key] !== undefined)){
                cfgObject[section][key] = userCfg[section][key];
            } else {
                cfgObject[section][key] = defaultConfiguration[section][key];
            }
        });
    });

    if (userCfg.log){
        if (!cfgObject.log){
            cfgObject.log = {};
        }
        Object.keys(userCfg.log).forEach(function(key){
            cfgObject.log[key] = userCfg.log[key];
        });
    }

    if (cmdLine.enableAws){
        try {
            aws.config.loadFromPath(cfgObject.s3.auth);
        }  catch (e) {
            throw new SyntaxError('Failed to load s3 config: ' + e.message);
        }
        if (cmdLine.enableAws){
            cfgObject.enableAws = true;
        }
    }

    if (cfgObject.output.uri){
        if (cfgObject.output.uri.charAt(cfgObject.output.uri.length - 1) !== '/'){
            cfgObject.output.uri += '/';
        }
    }

    if (cfgObject.log) {
        log = cwrx.logger.createLog(cfgObject.log);
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

    cfgObject.uriAddress = function(fname){
        if ((cfgObject.output) && (cfgObject.output.uri)){
            return (cfgObject.output.uri + fname);
        }
        return fname;
    };

    cfgObject.cacheAddress = function(fname,cache){
        return path.join(this.caches[cache],fname); 
    };

    cfgObject.getPidFile  = function(){
        return this.cacheAddress('dub.pid','run');
    };

    cfgObject.writePidFile = function(data){
        var pidPath = this.cacheAddress('dub.pid','run');
        log.info('Write pid file: ' + pidPath);
        fs.writeFileSync(pidPath,data);
    };

    cfgObject.readPidFile = function(){
        var pidPath = this.cacheAddress('dub.pid','run'),
            result;
        try {
            if (fs.existsSync(pidPath)){
                result = fs.readFileSync(pidPath);
            }
        } catch(e){
            log.error('Error reading [' + pidPath + ']: ' + e.message); 
        }
        return result;
    };

    cfgObject.removePidFile = function(){
        var pidPath = this.cacheAddress('dub.pid','run');
        if (fs.existsSync(pidPath)){
            log.info('Remove pid file: ' + pidPath);
            fs.unlinkSync(pidPath);
        }
    };

    return cfgObject;
}

function createDubJob(template,config){
    var log = cwrx.logger.getLog(),
        buff,
        obj       = {},
        soh       = String.fromCharCode(1),
        videoExt  = path.extname(template.video),
        videoBase = path.basename(template.video,videoExt);
    
    obj.ttsAuth = cwrx.vocalWare.createAuthToken(config.tts.auth);

    obj.tts = {};

    if (config.tts) {
        Object.keys(config.tts).forEach(function(key){
            obj.tts[key] = config.tts[key];
        });
    }

    if (template.tts) {
        Object.keys(template.tts).forEach(function(key){
            obj.tts[key] = template.tts[key];
        });
    }

    log.trace('job tts : ' + JSON.stringify(obj.tts));
    obj.tracks = [];
    if (!template.script) throw new Error("Expected script section in template");
    template.script.forEach(function(item){
        // remove leading and trailing spaces
        item.line = item.line.replace(/^\s*(.*?)\s*$/,"$1");
        var track = {
            ts      : Number(item.ts),
            line    : item.line,
            hash    : hashText(item.line.toLowerCase() + JSON.stringify(obj.tts))
        };
        log.trace('track : ' + JSON.stringify(track));
        track.fname   = (track.hash + '.mp3');
        track.fpath   = config.cacheAddress(track.fname,'line');
        obj.tracks.push(track);
        buff += (soh + track.ts.toString() + ':' + track.hash);
    });

    obj.enableAws  = function() { return config.enableAws; };
    obj.getS3SrcVideoParams = function(){
        return {
            Bucket : config.s3.src.bucket,
            Key    : path.join(config.s3.src.path,template.video)
        };
    };

    obj.getS3OutVideoParams = function(){
        var contentType = (this.outputFname.substr(-4) === 'webm') ? 
            'video/webm' : 'video/mp4';
        return {
            Bucket : config.s3.out.bucket,
            Key    : path.join(config.s3.out.path,this.outputFname),
            ACL    : 'public-read',
            ContentType : contentType
        };
    };

    obj.scriptHash = hashText(buff);
    obj.outputHash  = hashText(template.video + ':' + obj.scriptHash);
    
    obj.scriptFname = videoBase + '_' + obj.scriptHash + '.mp3';
    obj.scriptPath  = config.cacheAddress(obj.scriptFname,'script');
    
    obj.videoPath   = config.cacheAddress(template.video,'video');
  
    obj.outputFname = videoBase + '_' + obj.outputHash + videoExt;
    obj.outputPath = config.cacheAddress(obj.outputFname,'output');
    obj.outputUri  = config.uriAddress(obj.outputFname);
    obj.outputType = config.output.type;
    
    obj.hasVideoLength = function(){
        return (this.videoLength && (this.videoLength > 0));
    };

    obj.hasVideo = function(){
        return fs.existsSync(this.videoPath);
    };

    obj.hasOutput = function(){
        return fs.existsSync(this.outputPath);
    };

    obj.hasScript = function(){
        return fs.existsSync(this.scriptPath);
    };

    obj.hasLines = function(){
        for (var i =0; i < this.tracks.length; i++){
            if (!fs.existsSync(this.tracks[i].fpath)){
                return false;
            }
        }
        return true;
    };

    obj.assembleTemplate = function(){
        var self = this;
        result = {
            duration  : self.videoLength,
            bitrate   : obj.tts.bitrate,
            frequency : obj.tts.frequency,
            workspace : obj.tts.workspace,
            output    : self.scriptPath,
            useID3    : true
        };
        result.playList = [];
        self.tracks.forEach(function(track){
            result.playList.push({
                ts  : track.ts,
                src : track.fpath
            });
        });

        return result;
    };

    obj.mergeTemplate = function(){
        return  {
            frequency : obj.tts.frequency
        };
    };

    obj.elapsedTimes = {}
    obj.setStartTime = function(fnName) {
        obj.elapsedTimes[fnName] = {};
        obj.elapsedTimes[fnName]['start'] = new Date();
    }
    obj.setEndTime = function(fnName) {
        if (!obj.elapsedTimes[fnName] || !obj.elapsedTimes[fnName]['start']) {
            log.info("Error: never set start time for [" + fnName + "]");
            return;
        }
        obj.elapsedTimes[fnName]['end'] = new Date();
        var elapsed = obj.getElapsedTime(fnName);
        log.info("Finished [" + fnName + "] in " + elapsed);
            
    }
    obj.getElapsedTime = function(fnName) {
        if (obj.elapsedTimes[fnName] && obj.elapsedTimes[fnName]['start'] && obj.elapsedTimes[fnName]['end'])
            return (obj.elapsedTimes[fnName]['end'].valueOf() - obj.elapsedTimes[fnName]['start'].valueOf()) / 1000;
        else return -1;
    }

    if (template.e2e) {
        obj.e2e = true;
        if (template.e2e.clean_cache) {
            var remList = [obj.scriptPath, obj.outputPath];
            obj.tracks.forEach(function(track) { remList.push(track.fpath) });

            remList.forEach(function(fpath) {
                if (fs.existsSync(fpath)) fs.removeSync(fpath);
            });
        }
    }

    return obj;
}

function hashText(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
}

function getSourceVideo(job) {
    var deferred = q.defer(), 
        log = cwrx.logger.getLog(),
        fnName = arguments.callee.name;
    
    if (job.hasOutput() || job.hasVideo()) {
        log.info("Skipping getSourceVideo");
        return q(job);
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);

    if (job.enableAws()) {
        var s3 = new aws.S3(),
            params = job.getS3SrcVideoParams();
        log.trace('S3 Request: ' + JSON.stringify(params));
        cwrx.s3util.getObject(s3, params, job.videoPath).then( 
            function (data) { 
                deferred.resolve(job); 
                job.setEndTime(fnName);
            }, function (error) { 
                deferred.reject({"fnName": fnName, "msg": error});
                job.setEndTime(fnName); 
            }
        );
    } else {
        deferred.reject({"fnName": fnName, "msg": "You must enable aws to retrieve video."});
        job.setEndTime(fnName);
    }
    
    return deferred.promise;
}

function convertLinesToMP3(job){
    var log = cwrx.logger.getLog(),
        deferred = q.defer(),
        fnName = arguments.callee.name;

    if (job.hasOutput() || job.hasScript() || job.hasLines()) {
        log.info("Skipping convertLinesToMP3");
        return q(job);
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);        

    var processTrack = q.fbind(function(track){
        var deferred = q.defer();
        if (!fs.existsSync(track.fpath)){
            var rqs = cwrx.vocalWare.createRequest({authToken : job.ttsAuth}), voice;
            if (job.tts.voice){
                voice = cwrx.vocalWare.voices[job.tts.voice];
            }
            rqs.say(track.line, voice);

            if (job.tts.effect) {
                rqs.fxType = job.tts.effect;
            }
            
            if (job.tts.level) {
                rqs.fxLevel = job.tts.level;
            }
            // throw new Error("blah blah blah");
            cwrx.vocalWare.textToSpeech(rqs,track.fpath,function(err,rqs,o){
                if (err) {
                    log.error(err.message);
                    deferred.reject("Failed: path = " + track.fpath + " ts = " + track.ts);
                } else {
                    log.trace("Succeeded: path = " + track.fpath + " ts = " + track.ts);
                    deferred.resolve();
                }
            });
        } else {
            log.trace('Track already exists at ' + track.fpath);
            deferred.resolve();
        }
        return deferred.promise;
    });
    
    q.all(job.tracks.map(processTrack)).then(
        function(results) { 
            log.trace('All tracks succeeded'); 
            deferred.resolve(job);
            job.setEndTime(fnName);
        }, function(error) { 
            deferred.reject({"fnName": fnName, "msg": error});
            job.setEndTime(fnName);
        }
    );

    return deferred.promise;
}

function getVideoLength(job){
    var log = cwrx.logger.getLog(),
        deferred = q.defer(),
        fnName = arguments.callee.name;

    if (job.hasOutput() || job.hasScript() || job.hasVideoLength()) {
        log.info("Skipping getVideoLength");
        return q(job);
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);        

    cwrx.ffmpeg.probe(job.videoPath,function(err,info){
        if (err) {
            deferred.reject({"fnName": fnName, "msg": error});
            job.setEndTime(fnName);
            return deferred.promise;
        }

        if (!info.duration){
            deferred.reject({"fnName": fnName, "msg": 'Unable to determine video length.'});
            job.setEndTime(fnName);
            return deferred.promise;
        }

        job.videoLength = info.duration;
        log.trace('Video length: ' + job.videoLength);
        job.setEndTime(fnName);
        deferred.resolve(job);
    });
    return deferred.promise;
}

function convertScriptToMP3(job){
    var log = cwrx.logger.getLog(),
        deferred = q.defer(),
        fnName = arguments.callee.name;

    if (job.hasOutput() || job.hasScript()) {
        log.info("Skipping convertScriptToMP3");
        return q(job);
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);        

    cwrx.assemble(job.assembleTemplate(),function(err,tmpl){
        if (err) {
            deferred.reject({"fnName": fnName, "msg": error});
            job.setEndTime(fnName);
            return deferred.promise;
        }
        log.trace('Assembled: ' + tmpl.output);
        job.setEndTime(fnName);
        deferred.resolve(job);
    });
    return deferred.promise;
}

function applyScriptToVideo(job){
    var log = cwrx.logger.getLog(),
        deferred = q.defer(),
        fnName = arguments.callee.name;
 
    if (job.hasOutput()) {
        log.info("Skipping applyScriptToVideo");
        return q(job);
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);        

    cwrx.ffmpeg.mergeAudioToVideo(job.videoPath,job.scriptPath,
            job.outputPath,job.mergeTemplate(), function(err,fpath,cmdline){
                if (err) {
                    deferred.reject({"fnName": fnName, "msg": err});
                    job.setEndTime(fnName);
                    return deferred.promise;
                }
                log.trace('Merged: ' + fpath);
                job.setEndTime(fnName);
                deferred.resolve(job);
            });
    return deferred.promise;
}

function uploadToStorage(job){
    var deferred = q.defer(),
        log = cwrx.logger.getLog(),
        fnName = arguments.callee.name,
        md5;
    
    var getMD5 = function() {
        var localVid = fs.readFileSync(job.outputPath),
            hash = crypto.createHash('md5');

        hash.update(localVid);
        var md5sum = hash.digest('hex');
        log.trace("Local File MD5: " + md5sum);
        return md5sum;
    }
        
    if (job.e2e) {
        md5 = getMD5();
        job.md5 = md5;
    }

    if (job.outputType === 'local') {
        log.trace('Output type is set to "local", skipping S3 upload.');
        deferred.resolve(job);
        return deferred.promise;
    }
    
    if (!job.enableAws()){
        log.trace('Cannot upload, aws is not enabled.');
        deferred.resolve(job);
        return deferred.promise;
    }

    log.info("Starting " + fnName);
    job.setStartTime(fnName);

    if (!md5) md5 = getMD5();

    var s3 = new aws.S3(),
        outParams = job.getS3OutVideoParams(),
        headParams = {Key: outParams.Key, Bucket: outParams.Bucket};

    s3.headObject(headParams, function(err, data) {
        if (data && data['ETag'] && data['ETag'].replace(/"/g, '') == md5) {
            log.info("Local video already exists on S3, skipping upload");
            job.setEndTime(fnName);
            deferred.resolve(job);
        } else {
            log.trace('Uploading to Bucket: ' + outParams.Bucket + ', Key : ' + outParams.Key);
            cwrx.s3util.putObject(s3, job.outputPath, outParams).then(
                function (res) {
                    log.trace('SUCCESS: ' + JSON.stringify(res));
                    job.setEndTime(fnName);
                    deferred.resolve(job);
                }, function (error) {
                    log.error('ERROR: ' + JSON.stringify(err));
                    job.setEndTime(fnName);
                    deferred.reject({"fnName": fnName, "msg": 'S3 upload error'});
                });
        }
    });
    
    return deferred.promise;
}

module.exports = {
    'createConfiguration'   : createConfiguration,
    'createDubJob'          : createDubJob,
    'loadTemplateFromFile'  : loadTemplateFromFile,
    'handleRequest'         : handleRequest
};

