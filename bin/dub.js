#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false,

    __maint__   = process.env.maint;

var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    path        = include('path'),
    cluster     = include('cluster'),
    cp          = include('child_process'),
    express     = include('express'),
    aws         = include('aws-sdk'),
    crypto      = include('crypto'),
    q           = include('q'),
    daemon      = include('../lib/daemon'),
    logger      = include('../lib/logger'),
    uuid        = include('../lib/uuid'),
    cwrxConfig  = include('../lib/config'),
    ffmpeg      = include('../lib/ffmpeg'),
    id3Info     = include('../lib/id3'),
    vocalware   = include('../lib/vocalware'),
    assemble    = include('../lib/assemble'),
    s3util      = include('../lib/s3util'),
    
    dub = {}, // for exporting functions to unit tests

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

// This is the template for dub's configuration
dub.defaultConfiguration = {
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
        line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
        blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
        script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
        video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
        output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
    },
    output : {
        "type" : "local",
        "uri"  : "/media"
    },
    s3 : {
        src     : {
            bucket  : 'c6media',
            path    : 'src/screenjack/video/'
        },
        out     : {
            bucket  : 'c6media',
            path    : 'usr/screenjack/video/'
        },
        auth    : path.join(process.env.HOME,'.aws.json')
    },
    tts : {
        auth        : path.join(process.env.HOME,'.tts.json'),
        bitrate     : '48k',
        frequency   : 22050,
        workspace   : __dirname
    }
};

dub.getVersion = function() {
    var fpath = path.join(__dirname, 'dub.version'),
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

dub.createConfiguration = function(cmdLine) {
    var cfgObject = cwrxConfig.createConfigObject(cmdLine.config, dub.defaultConfiguration),
        log;

    if (cfgObject.log) {
        log = logger.createLog(cfgObject.log);
    } else {
        log = logger.getLog();
    }

    if (cfgObject.output && cfgObject.output.uri){
        if (cfgObject.output.uri.charAt(cfgObject.output.uri.length - 1) !== '/'){
            cfgObject.output.uri += '/';
        }
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
};

function loadTemplateFromFile(tmplFile){
    var tmplobj;
 
    try {
        tmplObj = fs.readJSONSync(tmplFile);
    } catch(e) {
        throw new Error('Error parsing template: ' + e.message);
    }

    if ((!(tmplObj.script instanceof Array)) || (!tmplObj.script.length)){
        throw new SyntaxError('Template is missing script section');
    }

    return tmplObj;
}

dub.createDubJob = function(id, template, config){
    var log = logger.getLog(),
        buff,
        obj       = {},
        soh       = String.fromCharCode(1),
        videoExt  = path.extname(template.video),
        videoBase = path.basename(template.video,videoExt);
   
    obj.id = id;

    obj.ttsAuth = vocalware.createAuthToken(config.tts.auth);

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

    log.trace('[%1] job tts : %2',obj.id ,JSON.stringify(obj.tts));
    obj.tracks = [];
    if (!template.script) throw new Error("Expected script section in template");
    template.script.forEach(function(item){
        // remove leading and trailing spaces
        item.line = item.line.replace(/^\s*(.*?)\s*$/,"$1");
        var track = {
            ts      : Number(item.ts),
            line    : item.line,
            hash    : uuid.hashText(item.line.toLowerCase() + JSON.stringify(obj.tts))
        };
        log.trace('[%1] track : %2',obj.id, JSON.stringify(track));
        track.jobId          = obj.id;
        track.fname          = (track.hash + '.mp3');
        track.fpath          = config.cacheAddress(track.fname,'line');
        track.fpathExists    = (fs.existsSync(track.fpath)) ? true : false;
        track.metaname       = (track.hash + '.json');
        track.metapath       = config.cacheAddress(track.metaname,'line');
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

    obj.scriptHash = uuid.hashText(buff);
    obj.outputHash  = uuid.hashText(template.video + ':' + obj.scriptHash);
    
    obj.scriptFname = videoBase + '_' + obj.scriptHash + '.mp3';
    obj.scriptPath  = config.cacheAddress(obj.scriptFname,'script');
    obj.blanksPath  = config.cacheAddress('','blanks');
    
    obj.videoPath   = config.cacheAddress(template.video,'video');
  
    obj.outputFname = videoBase + '_' + obj.outputHash + videoExt;
    obj.outputPath = config.cacheAddress(obj.outputFname,'output');
    obj.outputUri  = config.output && config.output.uri ? config.output.uri + obj.outputFname
                                                         : obj.outputFname;
    obj.outputType = (config.output && config.output.type ? config.output.type : null);
  
    obj.videoMetadataPath   = config.cacheAddress(videoBase + '_' + videoExt.replace(/^\./, '') +
                                                  '_metadata.json','video');

    try {
        obj.videoMetadata = fs.readJSONSync(obj.videoMetadataPath, { encoding : 'utf8' });
    } catch(e) {
        if (e.errno !== 34){
            log.error('[%1] failed to open videoMetaData file: %2',obj.id, e.message);
        }
    }

    obj.hasVideoLength = function(){
        return (this.videoMetadata && (this.videoMetadata.duration > 0));
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
        var result = true;
        for (var i =0; i < this.tracks.length; i++){
            if (this.tracks[i].fpathExists === false){
                result = false; 
                break;
            }
        }
        return result;
    };

    obj.assembleTemplate = function(){
        var self = this;
        result = {
            id        : self.id,
            duration  : self.videoMetadata.duration,
            bitrate   : obj.tts.bitrate,
            frequency : obj.tts.frequency,
            workspace : obj.tts.workspace,
            output    : self.scriptPath,
            blanks    : self.blanksPath,
            preserve  : true,
            useId3Info: true
        };
        result.playList = [];
        self.tracks.forEach(function(track){
            result.playList.push({
                ts  : track.ts,
                src : track.fpath,
                metaData : track.metaData
            });
        });

        return result;
    };

    obj.mergeTemplate = function(){
        return  {
            frequency : obj.tts.frequency
        };
    };

    obj.elapsedTimes = {};
    obj.setStartTime = function(fnName) {
        obj.elapsedTimes[fnName] = {};
        obj.elapsedTimes[fnName].start = new Date();
    };
    obj.setEndTime = function(fnName) {
        if (!obj.elapsedTimes[fnName] || !obj.elapsedTimes[fnName].start) {
            log.error("[%1] Error: never set start time for [" + fnName + "]");
            return;
        }
        obj.elapsedTimes[fnName].end = new Date();
        var elapsed = obj.getElapsedTime(fnName);
        log.info("[%1] Finished {%2} in %3",obj.id, fnName , elapsed);
    };
    obj.getElapsedTime = function(fnName) {
        if (obj.elapsedTimes[fnName] && obj.elapsedTimes[fnName].start && 
            obj.elapsedTimes[fnName].end) {
            return (obj.elapsedTimes[fnName].end.valueOf() - 
                    obj.elapsedTimes[fnName].start.valueOf()) / 1000;
        } else{
            return -1;
        }
    };

    return obj;
};

dub.getSourceVideo = function(job) {
    var deferred = q.defer(), 
        log = logger.getLog(),
        fnName = 'getSourceVideo';
    
    if (job.hasOutput() || job.hasVideo()) {
        log.info("[%1] Skipping %2",job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id, fnName);
    job.setStartTime(fnName);

    if (job.enableAws()) {
        var s3 = new aws.S3(),
            params = job.getS3SrcVideoParams();
        log.trace('[%1] S3 Request: %2',job.id, JSON.stringify(params));
        s3util.getObject(s3, params, job.videoPath).then( 
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
};

dub.convertLinesToMP3 = function(job){
    var log = logger.getLog(),
        deferred = q.defer(),
        fnName = 'convertLinesToMP3';

    if (job.hasOutput() || job.hasScript() || job.hasLines()) {
        log.info("[%1] Skipping %2",job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id,fnName);
    job.setStartTime(fnName);

    var processTrack = function(track){
        var deferred = q.defer();
        if (!fs.existsSync(track.fpath)){
            var rqs = vocalware.createRequest({authToken : job.ttsAuth}), voice;
            if (job.tts.voice){
                voice = vocalware.voices[job.tts.voice];
            }
            rqs.say(track.line, voice);

            if (job.tts.effect) {
                rqs.fxType = job.tts.effect;
            }
            
            if (job.tts.level) {
                rqs.fxLevel = job.tts.level;
            }
            vocalware.textToSpeech(rqs,track.fpath,function(err,rqs,o){
                if (err) {
                    log.info('[%1] Failed, rqs = %2', job.id, JSON.stringify(rqs));
                    deferred.reject(err);
                } else {
                    log.trace("[%1] Succeeded: name = %2, ts = %3",job.id , track.fname ,track.ts);
                    deferred.resolve();
                }
            });
        } else {
            log.trace('[%1] Track already exists at %2',job.id, track.fpath);
            deferred.resolve();
        }
        return deferred.promise;
    };

    q.allSettled(job.tracks.map(function(track) {
        var deferred2 = q.defer();
        q.fcall(processTrack, track).then(
            function() { deferred2.resolve(); },
            function(error) {
                log.error("[%1] Failed once for %2 with error = %3",job.id,track.fname,error);
                log.trace("[%1] Retrying...", job.id);
                q.fcall(processTrack, track).then(
                    function() { deferred2.resolve(); },
                    function(error) { 
                        log.error("[%1] Failed again for %2",job.id, track.fname); 
                        deferred2.reject(error); 
                    }
                );
            }
        );
        return deferred2.promise;
    })).then(function(results) { 
        for (var i in results) {
            if (results[i].state == "rejected") {
                deferred.reject({"fnName": fnName, "msg": results[i].reason});
                job.setEndTime(fnName);
                return;
            }
        }
        log.trace('[%1] All tracks succeeded', job.id); 
        deferred.resolve(job);
        job.setEndTime(fnName);
    });

    return deferred.promise;
};

dub.getLineMetadata = function(track){
    var log = logger.getLog(), deferred;

    try {
        track.metaData = fs.readJSONSync(track.metapath, { encoding : 'utf8' });
    }
    catch(e){
        if (e.errno !== 34){
            log.error('[%1] Unable to read metapath file: %2',track.jobId,e.message);
        }
    }

    if ((track.metaData) && (track.metaData.duration)) {
        return q(track);
    }

    deferred = q.defer();
    log.trace('[%1] getLineMetadata %2',track.jobId,track.fpath);
    id3Info(track.fpath,function(err,data){
        if (err) {
            log.error('[%1] Error reading track %2 id3info: %3',
                track.jobId, track.fpath, err.message);
            deferred.reject(err);
            return;
        }

        if (!data.audio_duration) {
            log.error('[%1] Reading track %2 id3info returned no duration',
                track.jobId, track.fpath);
            deferred.reject(new Error('No valid duration found.'));
            return;
        }

        data.duration = data.audio_duration;
        delete data.audio_duration;
        track.metaData = data;

        try {
            fs.writeFileSync(track.metapath, JSON.stringify(track.metaData));
        } catch(e){
            log.warn('[%1] Error writing to %2: %3', track.jobId,track.metapath,e.message);
        }

        deferred.resolve(track);
    });

    return deferred.promise;
};

dub.collectLinesMetadata = function(job){
    var log     = logger.getLog(),
        fnName  = 'collectLinesMetadata',
        deferred;

    if (job.hasOutput() || job.hasScript() ) {
        log.info("[%1] Skipping %2",job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id,fnName);
    job.setStartTime(fnName);
    deferred = q.defer();
    
    q.all(job.tracks.map(function(track){
        return dub.getLineMetadata(track);
    }))
    .then(function(results){
        job.setEndTime(fnName);
        deferred.resolve(job);
    })
    .fail(function(err){
        job.setEndTime(fnName);
        deferred.reject({"fnName": fnName, "msg": err});
    });
    return deferred.promise;
};

dub.getVideoLength = function(job){
    var log = logger.getLog(),
        deferred = q.defer(),
        fnName = 'getVideoLength';

    if (job.hasOutput() || job.hasScript() || job.hasVideoLength()) {
        log.info("[%1] Skipping %2",job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id,fnName);
    job.setStartTime(fnName);        

    ffmpeg.probe(job.videoPath,function(err,info,cmdline,stderr){
        if (stderr) {
            log.warn('[%1] ffmpeg errors: %2', job.id, stderr.replace('\n','; '));
        }
        if (err) {
            deferred.reject({"fnName": fnName, "msg": err});
            job.setEndTime(fnName);
            return deferred.promise;
        }
        if (!info.duration){
            deferred.reject({"fnName": fnName, "msg": 'Unable to determine video length.'});
            job.setEndTime(fnName);
            return deferred.promise;
        }
        try {
            fs.writeFileSync(job.videoMetadataPath, JSON.stringify(info));
        } catch(e){
            log.warn('[%1] Error writing to %2: %3', job.id,job.videoMetadataPath,e.message);
        }

        job.videoMetadata = info;
        log.trace('[%1] Video length: %2', job.id, job.videoMetadata.duration);
        job.setEndTime(fnName);
        deferred.resolve(job);
    });
    return deferred.promise;
};

dub.convertScriptToMP3 = function(job){
    var log = logger.getLog(),
        deferred = q.defer(),
        fnName = 'convertScriptToMP3';

    if (job.hasOutput() || job.hasScript()) {
        log.info("[%1] Skipping %2", job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id, fnName);
    job.setStartTime(fnName);        

    assemble(job.assembleTemplate())
    .then(function(tmpl){
        job.setEndTime(fnName);
        log.trace('[%1] Assembled: %2',job.id , tmpl.output);
        deferred.resolve(job);
    })
    .fail(function(err){
        job.setEndTime(fnName);
        deferred.reject({"fnName": fnName, "msg": err});
    });
        
    return deferred.promise;
};

dub.applyScriptToVideo = function(job){
    var log = logger.getLog(),
        deferred = q.defer(),
        fnName = 'applyScriptToVideo';
 
    if (job.hasOutput()) {
        log.info("[%1] Skipping %2", job.id, fnName);
        return q(job);
    }

    log.info("[%1] Starting %2",job.id,fnName);
    job.setStartTime(fnName);        

    ffmpeg.mergeAudioToVideo(job.videoPath,job.scriptPath,
            job.outputPath,job.mergeTemplate(), function(err,fpath,cmdline,stderr){
                if (stderr) {
                    log.warn('[%1] ffmpeg errors: %2', job.id, stderr.replace('\n','; '));
                }
                if (err) {
                    deferred.reject({"fnName": fnName, "msg": err});
                    job.setEndTime(fnName);
                    return deferred.promise;
                }
                log.trace('[%1] Merged: %2',job.id , fpath);
                job.setEndTime(fnName);
                deferred.resolve(job);
            });
    return deferred.promise;
};

dub.uploadToStorage = function(job){
    var deferred = q.defer(),
        log = logger.getLog(),
        fnName = 'uploadToStorage';
    
    if (job.outputType === 'local') {
        log.trace('[%1] Output type is set to "local", skipping S3 upload.',job.id);
        deferred.resolve(job);
        return deferred.promise;
    }
    
    if (!job.enableAws()){
        log.trace('[%1] Cannot upload, aws is not enabled.',job.id);
        deferred.resolve(job);
        return deferred.promise;
    }

    log.info("[%1] Starting %2",job.id,fnName);
    job.setStartTime(fnName);

    var s3 = new aws.S3(),
        outParams = job.getS3OutVideoParams(),
        headParams = {Key: outParams.Key, Bucket: outParams.Bucket},
        localVid = fs.readFileSync(job.outputPath),
        hash = crypto.createHash('md5');

    hash.update(localVid);
    job.md5 = hash.digest('hex');
    log.trace("[%1] Local File MD5: %2",job.id, job.md5);

    s3.headObject(headParams, function(err, data) {
        if (data && data.ETag && data.ETag.replace(/"/g, '') == job.md5) {
            log.info("[%1] Local video already exists on S3, skipping upload",job.id);
            job.setEndTime(fnName);
            deferred.resolve(job);
        } else {
            log.info('[%1] Uploading to Bucket: %2, Key: %3',job.id,outParams.Bucket,
                outParams.Key);
            s3util.putObject(s3, job.outputPath, outParams).then(
                function (res) {
                    log.info('[%1] SUCCESS: %2',job.id,JSON.stringify(res));
                    job.setEndTime(fnName);
                    deferred.resolve(job);
                }, function (error) {
                    log.error('[%1] ERROR: %2',job.id, JSON.stringify(error));
                    job.setEndTime(fnName);
                    deferred.reject({"fnName": fnName, "msg": 'S3 upload error'});
                });
        }
    });
    return deferred.promise;
};

dub.handleRequest = function(job, done){
    var log = logger.getLog(),
        fnName = 'handleRequest';
    job.setStartTime(fnName);
    
    // Each function returns a promise for job and checks job to see if it needs to be run.
    dub.getSourceVideo(job)
    .then(dub.convertLinesToMP3)
    .then(dub.collectLinesMetadata)
    .then(dub.getVideoLength)
    .then(dub.convertScriptToMP3)
    .then(dub.applyScriptToVideo)
    .then(dub.uploadToStorage)
    .then(
        function() {
            log.trace("All tasks succeeded!");
            job.setEndTime(fnName);
            done(null, job);
        }, function(error) {
            job.setEndTime(fnName);
            if (error.fnName && error.msg) 
                done({message : 'Died on [' + error.fnName + ']: ' + error.msg}, job);
            else
                done({message : 'Died: ' + error}, job);
        }
    );
};

function clusterMain(config,program,done) {
    var log = logger.getLog();
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
        log = logger.getLog();

    log.info('Running as cluster worker, proceed with setting up web server.');
    app.use(express.bodyParser());

    app.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", 
                   "Origin, X-Requested-With, Content-Type, Accept");

        if (req.method.toLowerCase() === "options") {
            res.send(200);
        } else {
            next();
        }
    });

    app.all('*',function(req, res, next){
        req.uuid = uuid.createUuid().substr(0,10);
        log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
            req.method,req.url,req.httpVersion);
        next();
    });

    app.post('/dub/create', function(req, res, next){
        var job;
        try {
            job = dub.createDubJob(req.uuid, req.body, config);
        }catch (e){
            log.error('[%1] Create Job Error: %2', req.uuid, e.message);
            res.send(500,{
                error  : 'Unable to process request.',
                detail : e.message
            });
            return;
        }
        dub.handleRequest(job,function(err){
            if (err){
                log.error('[%1] Handle Request Error: %2',req.uuid,err.message);
                res.send(400,{
                    error  : 'Unable to complete request.',
                    detail : err.message
                });
                return;
            }
            res.send(200, {
                output : job.outputUri,
                md5    : job.md5
            });
        });
    });
    
    app.get('/dub/meta', function(req, res, next){
        var data = {
            version: dub.getVersion(),
            config: {
                output: config.output,
                s3: {
                    src: config.s3.src,
                    out: config.s3.out
                }
            }
        };
        res.send(200, data);
    });

    app.listen(program.port);
    log.info('Dub server is listening on port: ' + program.port);
}

if (!__ut__ && !__maint__){

    try {
        main(function(rc,msg){
            exitApp(rc,msg);
        });
    } catch(e) {
        exitApp(1,e.stack);
    }
}

function main(done){
    var program  = include('commander'),
        config = {},
        job, log, userCfg;

    program
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

    config = dub.createConfiguration(program);

    if (program.showConfig){
        console.log(JSON.stringify(config,null,3));
        process.exit(0);
    }

    config.ensurePaths();

    log = logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }

    if (!program.server){
        // Running as a simple command line task, do the work and exit
        if (!program.args[0]){
            throw new SyntaxError('Expected a template file.');
        }

        job = dub.createDubJob(uuid.createUuid().substr(0,10),loadTemplateFromFile(program.args[0]), config);
        
        dub.handleRequest(job,function(err, finishedJob){
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
            daemon.removePidFile(config.cacheAddress('dub.pid', 'run'));
        }

        if (cluster.isMaster){
            cluster.disconnect(function(){
                return done(0,'Exit');
            });
            return;
        }
        return done(0,'Exit');
    });

    
    log.info('Running version ' + dub.getVersion());
    
    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
        daemon.daemonize(config.cacheAddress('dub.pid', 'run'), done);
    }

    // Now that we either are or are not a daemon, its time to 
    // setup clustering if running as a cluster.
    if ((cluster.isMaster) && (program.kids > 0)) {
        clusterMain(config,program,done);
    } else {
        workerMain(config,program,done);
    }
}

if (__ut__) {
    module.exports = dub;
} else {
    module.exports.createDubJob = dub.createDubJob;
}
