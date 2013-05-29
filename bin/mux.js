#!/usr/bin/env node
/*
 * What it should do....
 * 1. load a template file containing strings + timestamps + video?
 * 2. load configuration specifying tts service, working directory? caching?
 * 3. create job object from template
 * 4. iterate through each script item
 *  a. create sha1 based on (lc) text.
 *  b. assign sha1 to item in job object
 *  c. search cache for sound file
 *  d. if not found, create mp3 and cache, name using sha1
 * 5. If found all items in cache, check cache for composite sha1 (sha1 of all sha1's)
 *   a. if found use that mp3
 *   b. if not found create that mp3
 * 6. Create video name sha1 (concat mp3 sha1 + video src type sha1 + video name sha1)
 * 7. If found in cache, return that video, else
 * 8. Generate amerge of video, cache using video sha1
 * 9. Return link to merged video
 */
var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    mux      = require(path.join(__dirname,'../../mux'));

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
        config, job;
    
    program
        .version('0.0.1')
        .option('-c, --config [cfgfile]','Specify config file [undefined]',undefined)
        .option('-v, --video-type [type]', 'Specify video mime type [video/mp4]','video/mp4')
        .parse(process.argv);


    if (!program.args[0]){
        throw new SyntaxError('Expected a template file.');
    }

    config = createConfiguration(program.config);
    config.ensurePaths();

    job = createMuxJob(loadTemplateFromFile(program.args[0]),config);

    //console.log('JOB: ' + JSON.stringify(job,null,3));

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
    if (msg){
        if (resultCode){
            console.error(msg);
        } else {
            console.log(msg);
        }
    }
    process.exit(resultCode);
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
        ttsAuth : path.join(process.env['HOME'],'.tts.json'),
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

    obj.tracks = [];
    template.script.forEach(function(item){
        var track = {
            ts      : Number(item.ts),
            line    : item.line,
            hash    : hashText(item.line.toLowerCase())
        };
        track.fname   = (track.hash + '.mp3'),
        track.fpath   = config.cacheAddress(track.fname,'line')
        obj.tracks.push(track);
        buff = (soh + track.ts + ':' + track.hash);
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

    obj.ttsAuth = mux.vocalWare.createAuthToken(config.ttsAuth);

    obj.assembleTemplate = function(){
        var self = this;
        result = {
            duration  : self.videoLength,
            bitrate   : config.bitrate,
            frequency : config.frequency,
            workspace : config.workspace,
            output    : self.scriptPath
        };
        result.playList = [];
        self.tracks.forEach(function(track){
            result.playList.push({
                ts  : track.ts,
                src : track.fpath
            });
        });

        return result;
    }

    return obj;
}

function hashText(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
}

function pipelineJob(job,pipeline,handler){
    var fn = pipeline.shift();
    if (fn) {
        console.log('Run: ' + fn.name);
        fn(job,function(err){
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
    done();
}

function convertScriptToMP3(job,done){
    mux.assemble(job.assembleTemplate(),function(err,tmpl){
        if (err) {
            done(err);
            return;
        }
        console.log('Assembled: ' + tmpl.output);
        done();
    });
}

function getVideoLength(job,done){
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
        console.log('Video length: ' + job.videoLength);
        done();
    });
}

function getSourceVideo(job,done){
    done({message : 'Need to get the video: ' + job.videoPath});
}

function convertLinesToMP3(job,done){
    var rqsCount = 0, errs;

    job.tracks.forEach(function(track){
        if (!fs.existsSync(track.fpath)){
            rqsCount++;
            var rqs = mux.vocalWare.createRequest({authToken : job.ttsAuth});
            rqs.say(track.line);
            console.log('Create track: ' + track.fpath);
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

