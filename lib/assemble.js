(function(){'use strict';}());
var path    = require('path'),
    fs      = require('fs'),
    crypto  = require('crypto'),
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

    var working    = [],
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
            var curItem   = working.shift(),
                blankFile;

            if (curItem === undefined){
                process.nextTick(concatPlayList);
                return;
            }

            if (curItem.gapBefore) {
                blankFile = makeTmpPath(template.workspace ? template.workspace : '.');
                ffmpeg.makeSilentMP3(blankFile,curItem.gapBefore,template,function(err,fpath){
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
            ffmpeg.concat(playList,template.output,template,function(err,fpath){
                if (err) {
                    process.nextTick(function(){errOut(err);});
                    return;
                }

                cleanupTmps();
                process.nextTick(function(){
                    cb(null,template);
                });
            });
        },
        errOut = function(err){
            cleanupTmps();
            cb(err);
        };

    if (template.useID3) {
        getSrcInfoID3();
    } else {
        getSrcInfo();
    }
}

module.exports = assemble;
