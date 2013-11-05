(function(){'use strict';}());
var path    = require('path'),
    fs      = require('fs'),
    crypto  = require('crypto'),
    logger  = require('./logger'),
    ffmpeg  = require('./ffmpeg'),
    id3Info = require('./id3');

function roundToPlace(num,place){
    var m = Math.pow(10,place);
    return (Math.round(num * m) / m);
}

function makeTmpPath(dir) {
    var sha1 = crypto.createHash('sha1');
    sha1.update((new Date()).valueOf().toString() + 
                Math.random().toString() + 
                Math.random().toString());
    return path.join(dir,sha1.digest('hex').substr(0,10) + '.mp3');
}

function assemble(template,cb){
    var log = logger.getLog(),
        working    = [],
        playList   = [],
        tmpFiles   = [],
        cleanupTmps = function(){
            if (!template.preserve){
                tmpFiles.forEach(function(file){
                    if (fs.existsSync(file)){
                        fs.unlink(file);
                    }
                });
            }
        },
        getSrcInfoID3 = function(){
            var curItem = template.playList[working.length];
            log.trace('[%1] - getSrcInfoID3 %2',template.id,curItem.src);
            id3Info(curItem.src,function(err,data){
                if ((err) || (!data.audio_duration)) {
                    process.nextTick(getSrcInfo); 
                    return;
                }
                working.push({
                    item : curItem,
                    info : {
                        duration : data.audio_duration
                    }
                });
                
                if (working.length >= template.playList.length){
                    process.nextTick(calculateGaps); 
                    return;
                }

                process.nextTick(getSrcInfoID3);
            });
        },
        getSrcInfo = function(){
            var curItem = template.playList[working.length];
            log.trace('[%1] - getSrcInfo %2',template.id,curItem.src);
            ffmpeg.probe(curItem.src,function(err,info,cmdline){
                if (err) {
                    process.nextTick(function(){errOut(err);});
                    return;
                }

                working.push({
                    item : curItem,
                    info : info
                });

                if (working.length >= template.playList.length){
                    process.nextTick(calculateGaps); 
                    return;
                }

                process.nextTick(getSrcInfo);
            });
        },
        calculateGaps = function(){
            log.trace('[%1] - calculating gaps',template.id);
            for (var i = 0; i < working.length; i++){
                working[i].tsEnd = working[i].item.ts + working[i].info.duration;
                if (i === 0) {
                    working[i].gapBefore = working[i].item.ts;
                } else {
                    working[i].gapBefore = roundToPlace((working[i].item.ts - 
                                                         working[(i - 1)].tsEnd),2);
                }
                //console.log('WORKING: [' + i + ']: ' + JSON.stringify(working[i],null,3));
            }
            working.push({
                gapBefore : roundToPlace((template.duration - 
                                                    working[(i - 1)].tsEnd) , 2),
            });
            process.nextTick(createGapFiles);
        },
        createGapFiles = function(){
            log.trace('[%1] - create gap file',template.id);
            var curItem   = working.shift(),
                blankFile;

            if (curItem === undefined){
                process.nextTick(concatPlayList);
                return;
            }

            if (curItem.gapBefore) {
                blankFile = makeTmpPath(template.workspace ? template.workspace : '.');
                log.trace('[%1] - make blankfile: %2',template.id,blankFile);
                ffmpeg.makeSilentMP3(blankFile,curItem.gapBefore,template,function(err,fpath){
                    log.trace('[%1] - make blankfile returns: %2',template.id,blankFile);
                    if (err) {
                        process.nextTick(function(){errOut(err);});
                        return;
                    }

                    playList.push(blankFile);
                    tmpFiles.push(blankFile);
                    if (curItem.item){
                        playList.push(curItem.item.src);
                    }
                    process.nextTick(createGapFiles);
                });
            } else {
                playList.push(curItem.item.src);
                process.nextTick(createGapFiles);
            }
        },
        concatPlayList = function(){
            log.trace('[%1] - concat playlist',template.id);
            ffmpeg.concat(playList,template.output,template,function(err,fpath){
                if (err) {
                    process.nextTick(function(){errOut(err);});
                    return;
                }

                cleanupTmps();
                process.nextTick(function(){
                    log.trace('[%1] - assemble complete',template.id);
                    cb(null,template);
                });
            });
        },
        errOut = function(err){
            log.trace('[%1] - assemble error %2',template.id,err.message);
            cleanupTmps();
            cb(err);
        };

    log.trace('[%1] assemble template',template.id);
    if (template.useID3) {
        getSrcInfoID3();
    } else {
        getSrcInfo();
    }
}

module.exports = assemble;
