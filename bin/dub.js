#!/usr/bin/env node

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    cluster  = require('cluster'),
    cp       = require('child_process'),
    express  = require('express'),
    aws      = require('aws-sdk'),
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
        }
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

if (!process.env['ut-cwrx-bin']){

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
        .version('0.0.2')
        .option('-c, --config [CFGFILE]','Specify config file')
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-k, --kids [KIDS]','Number of kids to spawn.', 0)
        .option('-p, --port [PORT]','Listent on port (requires -s) [3000].', 3000)
        .option('-s, --server','Run as a server.')
        .option('-u, --uid [UID]','Run as user (id or name).')
        .option('--enable-aws','Enable aws access.')
        .option('--show-config','Display configuration and exit.')
        .parse(process.argv);

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
        var child = cp.spawn('/usr/local/bin/node',child_args, { 
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
            res.send(200, {
                output : job.outputUri    
            });
        });
    });

    app.listen(program.port);
    log.info('Dub server is listening on port: ' + program.port);
}

function handleRequest(job, done){
    var log = cwrx.logger.getLog(),
        pipeline = [];
   
    pipeline.unshift(uploadToStorage);

    if (job.hasOutput()){
        log.info('video already exists.');
    }  else {
        pipeline.unshift(applyScriptToVideo);
        if (!job.hasScript()){
            pipeline.unshift(convertScriptToMP3);
            if (!job.hasVideoLength()){
                pipeline.unshift(getVideoLength);
            }

            if (!job.hasLines()){
                pipeline.unshift(convertLinesToMP3);
            }
        }
        
        if (!job.hasVideo()){
            pipeline.unshift(getSourceVideo);
        }
    }

    if (pipeline.length !== 0){
        pipelineJob(job,pipeline,function(err,job,lastFn){
            if (err) {
                done( { message : 'Died on [' + lastFn.name + ']:' + err.message }, job);
            } else {
                done(null,job);
            }
        });
    }  else {
        done(null,job);
    }
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
                log.info('Create cache[' + key + ']: ' + self.caches[key]);
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

    obj.tts = config.tts;

    if (template.tts) {
        Object.keys(template.tts).forEach(function(key){
            obj.tts[key] = template.tts[key];
        });
    }

    obj.tracks = [];
    template.script.forEach(function(item){
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
        return {
            Bucket : config.s3.out.bucket,
            Key    : path.join(config.s3.out.path,this.outputFname),
            ACL    : 'public-read'
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
            bitrate   : config.tts.bitrate,
            frequency : config.tts.frequency,
            workspace : config.tts.workspace,
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
            frequency : config.tts.frequency
        };
    };

    return obj;
}

function hashText(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
}

function pipelineJob(job,pipeline,handler){
    var fn = pipeline.shift(),
        log= cwrx.logger.getLog(),
        jobStart = new Date();
    if (fn) {
        log.trace('Run: ' + fn.name);
        fn(job,function(err){
            log.info( fn.name + ': ' + (((new Date()).valueOf() - jobStart.valueOf())  / 1000) + ' sec');
            if (err) {
                handler(err,job,fn);
            } else {
                process.nextTick(function(){
                    pipelineJob(job,pipeline,handler);
                });
            }
        });
    } else {
        handler(null,job,null);
    }
}

function uploadToStorage(job,next){
    var log = cwrx.logger.getLog();

    if (!job.enableAws()){
        log.trace('Cannot upload, aws is not enabled.');
        return next();
    }
    
    var rs = fs.createReadStream(job.outputPath),
        once = false;

    rs.on('readable',function(){
        var s3      = new aws.S3(),
            params  = job.getS3OutVideoParams(),
            req;
            
        if (once){
            return;
        }
        once = true;
        
        log.trace('Starting S3 upload request with params: ' + JSON.stringify(params));
        params.Body = rs;
        
        req = s3.client.putObject(params);

        req.on('success',function(res){
            log.trace('SUCCESS: ' + JSON.stringify(res.data));
            next();
        });

        req.on('error',function(err,res){
            log.error('ERROR: ' + JSON.stringify(err));
            next({ message : 'S3 upload error' });
        });

        req.send();
    });
}
        
function applyScriptToVideo(job,next){
    var log = cwrx.logger.getLog();
    cwrx.ffmpeg.mergeAudioToVideo(job.videoPath,job.scriptPath,
            job.outputPath,job.mergeTemplate(), function(err,fpath,cmdline){
                if (err) {
                    next(err);
                    return;
                }
                log.trace('Merged: ' + fpath);
                next();
            });
}

function convertScriptToMP3(job,next){
    var log = cwrx.logger.getLog();
    cwrx.assemble(job.assembleTemplate(),function(err,tmpl){
        if (err) {
            next(err);
            return;
        }
        log.trace('Assembled: ' + tmpl.output);
        next();
    });
}

function getVideoLength(job,next){
    var log = cwrx.logger.getLog();
    cwrx.ffmpeg.probe(job.videoPath,function(err,info){
        if (err){
            next(err);
            return;
        }

        if (!info.duration){
            next({message : 'Unable to determine video length.'});
            return;
        }

        job.videoLength = info.duration;
        log.trace('Video length: ' + job.videoLength);
        next();
    });
}

function getSourceVideo(job,next){
    var log= cwrx.logger.getLog();
    if (job.enableAws()){
        var s3 = new aws.S3(),
            params = job.getS3SrcVideoParams();
        log.trace('S3 Request: ' + params);
        s3.getObject(params,function(err,data){
            if (err){
                next({ message : 'S3 Get failed.' + err.message});
                return;
            }

            fs.writeFile(job.videoPath,data.Body,function(err){
                if (err){
                    next({message : 'Write video failed: ' + err.message});
                    return;
                }
                next();
            });
        });
    } else {
        next({message : 'Need to get the video: ' + job.videoPath});
    }
}

function convertLinesToMP3(job,next){
    var log= cwrx.logger.getLog(),
        rqsCount = 0, errs;

    job.tracks.forEach(function(track){
        if (!fs.existsSync(track.fpath)){
            rqsCount++;
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
            log.trace('Create track: ' + track.fpath);
            cwrx.vocalWare.textToSpeech(rqs,track.fpath,function(e,rqs,o){
                if (e) {
                    log.error(e.message);
                    if (!errs) {
                        errs = [ e ];
                    } else {
                        errs.push(e);
                    }
                }
                if (--rqsCount < 1){
                    if (errs){
                        next(errs[0]); 
                    } else {
                        next();
                    }
                }
            });
        }
    });

}

module.exports = {
    'createConfiguration' : createConfiguration,
    'createDubJob'        : createDubJob
};

