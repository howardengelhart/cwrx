(function(){'use strict';}());
var path    = require('path'),
    fs      = require('fs'),
    crypto  = require('crypto'),
    q       = require('q'),
    logger  = require('./logger');

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
    var log = logger.getLog(), tmpFiles   = [];
    log.trace('[%1] assemble template',template.id);
 
    // 1. get the duration of each play list item
    return q.all(template.playList.map(function(item,index) {
        if (template.id3Info) {
            return assemble.getSrcInfoID3(log,template,item,index);
        } else {
            return assemble.getSrcInfo(log,template,item,index);
        }
    }))
    // 2. calculate the required gaps between items
    .then(function(workingItems){
        workingItems.sort(function(a,b){
            return (a.index - b.index);
        });
        return assemble.calculateGaps(log,template,workingItems);
    })
    // 3. create the gap files
    .then(function(workingItems){
        return q.all(workingItems.map(function(item,index){
            return assemble.createGapFile(log,template,tmpFiles,item,index);
        }));
    })
    // 4. concatenate the playlist items with gaps inserted
    .then(function(workingItems){
        var playList = [];
        workingItems.sort(function(a,b){
            return (a.index - b.index);
        });
        workingItems.forEach(function(item){
            item.files.forEach(function(file){
                playList.push(file);
            });
        });
        return assemble.concatPlayList(log,template,playList);
    })
    // 5. Cleanup the temporary gap files
    .then(function(){
        assemble.cleanupTmps(template,tmpFiles);
        return template;
    })
    .fail(function(err){
        $log.error('[%1] - %2',template.id,err.message);
        assemble.cleanupTmps(template,tmpFiles);
    });
}

assemble.cleanupTmps = function(tmpl,files){
    if (!tmpl.preserve){
        files.forEach(function(file){
            if (fs.existsSync(file)){
                fs.unlink(file);
            }
        });
    }
};

assemble.getSrcInfoID3 = q.fbind(function(log,tmpl,curItem,index){
    var deferred = q.defer(), workingItem;
    log.trace('[%1] - getSrcInfoID3 %2',tmpl.id,curItem.src);
    tmpl.id3Info(curItem.src,function(err,data){
        if ((err) || (!data.audio_duration)) {
            deferred.reject(err);
            return;
        }

        data.duration = data.audio_duration;
        delete data.audio_duration;
        curItem.metaData = data;

        workingItem = {
            index : index,
            item : curItem
        };
        deferred.resolve(workingItem);
    });
    return deferred.promise;
});

assemble.getSrcInfo = q.fbind(function(log,tmpl,curItem,index){
    var deferred = q.defer(), workingItem;
    log.trace('[%1] - getSrcInfo %2',tmpl.id,curItem.src);
    tmpl.ffmpeg.probe(curItem.src,function(err,info,cmdline){
        if (err) {
            deferred.reject(err);
            return;
        }
       
        curItem.metaData = info;
            
        workingItem = {
            index : index,
            item : curItem
        };
        deferred.resolve(workingItem);
    });
    return deferred.promise;
});
assemble.calculateGaps = q.fbind(function(log,tmpl,working){
    log.trace('[%1] - calculating gaps',tmpl.id);
    for (var i = 0; i < working.length; i++){
        working[i].tsEnd = working[i].item.ts + working[i].item.metaData.duration;
        if (i === 0) {
            working[i].gapBefore = working[i].item.ts;
        } else {
            working[i].gapBefore = Math.max(roundToPlace((working[i].item.ts - 
                                                 working[(i - 1)].tsEnd),2),0);
        }
    }
    if (tmpl.duration > working[(i -1)].tsEnd){
        working.push({
            gapBefore : roundToPlace((tmpl.duration - 
                                                working[(i - 1)].tsEnd) , 2),
        });
    }
    return working;
});
assemble.createGapFile = q.fbind(function(log,tmpl, tempFiles, curItem, index){
    log.trace('[%1] - create gap file',tmpl.id);
    var deferred = q.defer(), blankFile, result = { index: index, files : [] };

    if (curItem.gapBefore) {
        blankFile = makeTmpPath(tmpl.workspace ? tmpl.workspace : '.');
        log.trace('[%1] - make blankfile: %2',tmpl.id,blankFile);
        tmpl.ffmpeg.makeSilentMP3(blankFile,curItem.gapBefore,tmpl,function(err,fpath){
            log.trace('[%1] - make blankfile returns: %2',tmpl.id,blankFile);
            if (err) {
                deferred.reject(err);
                return;
            }

            result.files.push(blankFile);
            tempFiles.push(blankFile);
            if (curItem.item){
                result.files.push(curItem.item.src);
            }
            deferred.resolve(result);
        });
    } else {
        result.files.push(curItem.item.src);
        process.nextTick(function(){
            deferred.resolve(result);
        });
    }

    return deferred.promise;
});
assemble.concatPlayList = q.fbind(function(log,tmpl,playList){
    var deferred = q.defer();
    log.trace('[%1] - concat playlist',tmpl.id);
    tmpl.ffmpeg.concat(playList,tmpl.output,tmpl,function(err,fpath){
        if (err) {
            deferred.reject(err);
            return;
        }

        log.trace('[%1] - assemble complete',tmpl.id);
        deferred.resolve(tmpl);
    });
    return deferred.promise;
});

module.exports = assemble;
