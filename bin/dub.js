#!/usr/bin/env node

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    cluster  = require('cluster'),
    cp       = require('child_process'),
    express  = require('express'),
    aws      = require('aws-sdk'),
    cwrx     = require(path.join(__dirname,'../../cwrx')),
    dtStart  = new Date(),
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
            bucket  : 'c6Video',
            srcPath : 'src',
            outPath : 'res',
            auth    : path.join(process.env.HOME,'.aws.json')
        },
        tts : {
            auth        : path.join(process.env.HOME,'.tts.json'),
            bitrate     : '48k',
            frequency   : 22050,
            workspace   : __dirname
        }
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
        .version('0.0.1')
        .option('-c, --config [CFGFILE]','Specify config file', undefined)
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-l, --loglevel [LEVEL]',
                'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-k, --kids [KIDS]','Number of kids to spawn. [0]', 0)
        .option('-s, --server','Run as a server.')
        .option('--enable-aws','Enable aws access.')
        .option('--show-config','Display configuration and exit.')
        .parse(process.argv);

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
        // This is a command line one-off
        if (!program.args[0]){
            throw new SyntaxError('Expected a template file.');
        }

        job = createDubJob(loadTemplateFromFile(program.args[0]),config);
        handleRequest(job,function(err, finishedJob){
            if (err) {
                done(1,err.message);
            } else {
                done(0,'Done');
            }
        });

        return;
    }
   
    // Ok, so we're a server, lets do some servery things..
    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
        }
        done(2);
    });

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        done(0,'Exit');
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
                done(0,'Exit');
            });
            return;
        }
        done(0,'Exit');
    });

    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)){
        var pdata = config.readPidFile();
        if ((pdata) && (pdata.pid)){
            var exists = false;
            try {
                exists = process.kill(pdata.pid,0);
            }catch(e){
            }

            if (exists) {
                console.error('It appears daemon is already running (' + pdata.pid + '), please sig term the old process if you wish to run a new one.');
                done(1,'need to term ' + pdata.pid);
                return;
            } else {
                log.error('Process [' + pdata.pid + '] appears to be gone, will restart.');
                config.removePidFile();
            }

        } else 
        if (pdata){
            console.error('Detected pid file ' + config.getPidFile() + ', ensure previous process is no longer running and remove file before attempting to run again as a daemon.');
            done(1,'cannot run multiple daemon instances.');
            return;
        }

        console.log('Daemonizing.');
        log.info('Daemonizing and forking child..');
        var child_args = [];
        process.argv.forEach(function(val, index) {
            if (index > 0) {
                child_args.push(val);            
            }
        });
   
        process.env.RUNNING_AS_DAEMON = true;
        var child = cp.spawn('/usr/local/bin/node',child_args, { 
            stdio   : 'ignore',
            detached: true,
            env     : process.env
        });
  
        child.unref();
        log.info('child spawned, pid is ' + child.pid + ', exiting parent process..');
        config.writePidFile({ 'pid' : child.pid });
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
            res.send(400,{
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

    app.listen(3000);
    log.info('Dub server is listening on port 3000');
}

function handleRequest(job, done){
    var log = cwrx.logger.getLog(),
        pipeline = [];
    
    if (job.hasOutput()){
        log.info('video already exists.');
        done();
        return;
    } 
    
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

function exitApp (resultCode,msg){
    var log = cwrx.logger.getLog();
    if (msg){
        if (resultCode){
            log.error(msg);
        } else {
            log.info(msg);
        }
    }
    
    log.info('Total time: ' + (((new Date()).valueOf() - dtStart.valueOf())  / 1000) + ' sec');
    setTimeout(function(){
        process.exit(resultCode);
    },100);
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

    if (cmdLine.enableAws && cfgObject.s3){
        if ((!cfgObject.s3.bucket) || (!cfgObject.s3.srcPath) || (!cfgObject.s3.outPath)) {
            throw new SyntaxError('s3 configuration is incomplete.');
        }

        try {
            aws.config.loadFromPath(cfgObject.s3.auth);
        }  catch (e) {
            throw new SyntaxError('Failed to load s3 config: ' + e.message);
        }
        if (cmdLine.enableAws){
            cfgObject.enableAws = true;
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
            return path.join (cfgObject.output.uri , fname);
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
        fs.writeFileSync(pidPath,JSON.stringify(data,null,3));
    };

    cfgObject.readPidFile = function(){
        var pidPath = this.cacheAddress('dub.pid','run'),
            result;
        try {
            if (fs.existsSync(pidPath)){
                result = JSON.parse(fs.readFileSync(pidPath));
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
    obj.s3GetSrcVideoParams = function(){
        return {
            Bucket : config.s3.bucket,
            Key    : path.join(config.s3.srcPath,template.video)
        };
    };

    obj.scriptHash = hashText(buff);
    obj.scriptPath = config.cacheAddress(videoBase + '_' + obj.scriptHash + '.mp3','script');
    obj.videoPath  = config.cacheAddress(template.video,'video');
  
    obj.outputHash = hashText(template.video + ':' + obj.scriptHash);
    obj.outputPath = config.cacheAddress((videoBase + '_' + obj.outputHash + videoExt),'output');
   
    obj.outputUri  = config.uriAddress((videoBase + '_' + obj.outputHash + videoExt));
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
            frequency : config.frequency
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

        
function applyScriptToVideo(job,done){
    var log = cwrx.logger.getLog();
    cwrx.ffmpeg.mergeAudioToVideo(job.videoPath,job.scriptPath,
            job.outputPath,job.mergeTemplate(), function(err,fpath,cmdline){
                if (err) {
                    done(err);
                    return;
                }
                log.trace('Merged: ' + fpath);
                done();
            });
}

function convertScriptToMP3(job,done){
    var log = cwrx.logger.getLog();
    cwrx.assemble(job.assembleTemplate(),function(err,tmpl){
        if (err) {
            done(err);
            return;
        }
        log.trace('Assembled: ' + tmpl.output);
        done();
    });
}

function getVideoLength(job,done){
    var log = cwrx.logger.getLog();
    cwrx.ffmpeg.probe(job.videoPath,function(err,info){
        if (err){
            done(err);
            return;
        }

        if (!info.duration){
            done({message : 'Unable to determine video length.'});
            return;
        }

        job.videoLength = info.duration;
        log.trace('Video length: ' + job.videoLength);
        done();
    });
}

function getSourceVideo(job,done){
    var log= cwrx.logger.getLog();
    if (job.enableAws()){
        var s3 = new aws.S3(),
            params = job.s3GetSrcVideoParams();
        log.trace('S3 Request: ' + params);
        s3.getObject(params,function(err,data){
            if (err){
                done({ message : 'S3 Get failed.' + err.message});
                return;
            }

            fs.writeFile(job.videoPath,data.Body,function(err){
                if (err){
                    done({message : 'Write video failed: ' + err.message});
                    return;
                }
                done();
            });
        });
    } else {
        done({message : 'Need to get the video: ' + job.videoPath});
    }
}

function convertLinesToMP3(job,done){
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
                        done(errs[0]); 
                    } else {
                        done();
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

