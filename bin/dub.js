#!/usr/bin/env node

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    express  = require('express'),
    cwrx     = require(path.join(__dirname,'../../cwrx')),
    dtStart  = new Date();

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
        log      = cwrx.logger.createLog(),
        config, job;
   
    log.setLevel('INFO');
    
    program
        .version('0.0.1')
        .option('-c, --config [CFGFILE]','Specify config file', undefined)
        .option('-l, --loglevel [INFO]',
                'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)', 'INFO')
        .option('-s, --server','Run in server mode.')
        .parse(process.argv);

    log.setLevel(program.loglevel);

    config = createConfiguration(program.config);
    config.ensurePaths();

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

    return serverMain(config,done);
}

function serverMain(config,done){
    var app = express(),
        log = cwrx.logger.getLog();

    process.on('SIGINT',function(){
        log.info('Received SIGINT, exitting app.');
        done(0,'Exit');
    });

    process.on('SIGTERM',function(){
        log.info('Received TERM, exitting app.');
        done(0,'Exit');
    });

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
};


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

function createConfiguration(cfgFile){
    var log = cwrx.logger.getLog(),
        userCfg,cfgObject = {
        caches : {
                    line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
                    script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
                    video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
                    output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
                 },
        output      : {
                        "type" : "local",
                        "uri"  : "/media"
                      },
        ttsAuth     : path.join(process.env['HOME'],'.tts.json'),
        tts         : {},
        bitrate     : '48k',
        frequency   : 22050,
        workspace   : __dirname
    };

    if (cfgFile) { 
        userCfg = JSON.parse(fs.readFileSync(cfgFile, { encoding : 'utf8' }));
    }
 
    if (userCfg) {
        Object.keys(userCfg).forEach(function(key){
            cfgObject[key] = userCfg[key];
        });
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
    }

    cfgObject.cacheAddress = function(fname,cache){
        return path.join(this.caches[cache],fname); 
    }

    return cfgObject;
}

function createDubJob(template,config){
    var log = cwrx.logger.getLog(),
        buff,
        obj       = {},
        soh       = String.fromCharCode(1),
        videoExt  = path.extname(template.video),
        videoBase = path.basename(template.video,videoExt);
    
    obj.ttsAuth = cwrx.vocalWare.createAuthToken(config.ttsAuth);

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
        track.fname   = (track.hash + '.mp3'),
        track.fpath   = config.cacheAddress(track.fname,'line')
        obj.tracks.push(track);
        buff += (soh + track.ts.toString() + ':' + track.hash);
    });

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
    }

    obj.hasLines = function(){
        for (var i =0; i < this.tracks.length; i++){
            if (!fs.existsSync(this.tracks[i].fpath)){
                return false;
            }
        }
        return true;
    }

    obj.assembleTemplate = function(){
        var self = this;
        result = {
            duration  : self.videoLength,
            bitrate   : config.bitrate,
            frequency : config.frequency,
            workspace : config.workspace,
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
    done({message : 'Need to get the video: ' + job.videoPath});
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

