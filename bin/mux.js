#!/usr/bin/env node

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    log      = require('../lib/logger'),
    mux      = require(path.join(__dirname,'../../mux')),
    dtStart  = new Date(),
    _theLog;

function getLogger() {
    if (!_theLog) {
        _theLog = new log.Logger();
    }
    return _theLog;
}

if (!process.env['ut-mux-bin']){
    try {
        main(function(rc,msg){
            exitApp(rc,msg);
        });
    } catch(e) {
        exitApp(1,e.message);
    }
}

function main(done){
    var program  = require('commander'),
        logger   = getLogger('cheese'),
        config, job;
   
//    logger.setLevel('ERROR');
    
    program
        .version('0.0.1')
        .option('-c, --config CFGFILE','Specify config file')
        .option('-l, --loglevel [ERROR]',
                'Specify log level (TRACE|DEBUG|INFO|WARN|ERROR|FATAL)', 'ERROR')
        .option('-s, --server','Run in server mode.')
        .parse(process.argv);

 //   logger.setLevel(program.loglevel);

    for (var i = 0; i < 10000; i++){
        logger.error('abcdefghijklmnopqrstuvwxyz123456789',i);
    }

    if (!program.args[0]){
        throw new SyntaxError('Expected a template file.');
    }

    config = createConfiguration(program.config);
    config.ensurePaths();

    job = createMuxJob(loadTemplateFromFile(program.args[0]),config);

    var pipeline = [];
    if (!job.hasOutput()){
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
                done(1,'Died on [' + lastFn.name + ']:' + err.message);
            } else {
                done(0,'Done with work');
            }
        });
    }  else {
        done(0,'Done from cache');
    }
}

/*
 * The Help
 *
 */

function exitApp (resultCode,msg){
    var logger = getLogger('app');
    if (msg){
        if (resultCode){
            logger.error(msg);
        } else {
            logger.info(msg);
        }
    }
    
    logger.info('Total time: ' + (((new Date()).valueOf() - dtStart.valueOf())  / 1000) + ' sec');
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
    var userCfg,cfgObject = {
        caches : {
                    line    : path.normalize('/usr/local/share/mux/caches/line/'),
                    script  : path.normalize('/usr/local/share/mux/caches/script/'),
                    video   : path.normalize('/usr/local/share/mux/caches/video/'),
                    output  : path.normalize('/usr/local/share/mux/caches/output/')
                 },
        ttsAuth     : path.join(process.env['HOME'],'.tts.json'),
        tts         : {},
        bitrate     : '48k',
        frequency   : 22050,
        workspace   : __dirname
    };

    if (cfgFile) { 
        userCfg = JSON.parse(fs.readFileSync(cfgFile));
    }
 
    if (userCfg) {
        Object.keys(userCfg).forEach(function(key){
            cfgObject[key] = userCfg[key];
        });
    }

    cfgObject.ensurePaths = function(){
        var self = this;
        Object.keys(self.caches).forEach(function(key){
            if (!fs.existsSync(self.caches[key])){
                fs.mkdirsSync(self.caches[key]);
            }
        });
    };

    cfgObject.cacheAddress = function(fname,cache){
        return path.join(this.caches[cache],fname); 
    }

    return cfgObject;
}

function createMuxJob(template,config){
    var buff,
        obj       = {},
        soh       = String.fromCharCode(1),
        videoExt  = path.extname(template.video),
        videoBase = path.basename(template.video,videoExt);
    
    obj.ttsAuth = mux.vocalWare.createAuthToken(config.ttsAuth);

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
        logger = getLogger('app'),
        jobStart = new Date();
    if (fn) {
        logger.debug('Run: ' + fn.name);
        fn(job,function(err){
            logger.info( fn.name + ': ' + (((new Date()).valueOf() - jobStart.valueOf())  / 1000) + ' sec');
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
    var logger = getLogger('app');
    mux.ffmpeg.mergeAudioToVideo(job.videoPath,job.scriptPath,
            job.outputPath,job.mergeTemplate(), function(err,fpath,cmdline){
                if (err) {
                    done(err);
                    return;
                }
                logger.debug('Merged: ' + fpath);
                done();
            });
}

function convertScriptToMP3(job,done){
    var logger = getLogger('app');
    mux.assemble(job.assembleTemplate(),function(err,tmpl){
        if (err) {
            done(err);
            return;
        }
        logger.debug('Assembled: ' + tmpl.output);
        done();
    });
}

function getVideoLength(job,done){
    var logger = getLogger('app');
    mux.ffmpeg.probe(job.videoPath,function(err,info){
        if (err){
            done(err);
            return;
        }

        if (!info.duration){
            done({message : 'Unable to determine video length.'});
            return;
        }

        job.videoLength = info.duration;
        logger.debug('Video length: ' + job.videoLength);
        done();
    });
}

function getSourceVideo(job,done){
    done({message : 'Need to get the video: ' + job.videoPath});
}

function convertLinesToMP3(job,done){
    var logger = getLogger('app'),
        rqsCount = 0, errs;

    job.tracks.forEach(function(track){
        if (!fs.existsSync(track.fpath)){
            rqsCount++;
            var rqs = mux.vocalWare.createRequest({authToken : job.ttsAuth}), voice;
            if (job.tts.voice){
                voice = mux.vocalWare.voices[job.tts.voice];
            }
            rqs.say(track.line, voice);

            if (job.tts.effect) {
                rqs.fxType = job.tts.effect;
            }
            
            if (job.tts.level) {
                rqs.fxLevel = job.tts.level;
            }
            logger.debug('Create track: ' + track.fpath);
            mux.vocalWare.textToSpeech(rqs,track.fpath,function(e,rqs,o){
                if (e) {
                    console.error(e.message);
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
    'createMuxJob'        : createMuxJob
};

