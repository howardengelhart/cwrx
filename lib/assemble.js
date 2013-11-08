(function(){'use strict';}());
var path    = require('path'),
    fs      = require('fs-extra'),
    q       = require('q'),
    uuid    = require('./uuid'),
    logger  = require('./logger');

function assemble(template,cb){
    var log = logger.getLog(),
        gapFileMap = {},
        workSpace  = '';

    workSpace = path.join( (template.workspace ? template.workspace : '.'),
        uuid.createUuid().substr(0,10));
    log.trace('[%1] assemble template in workSpace',template.id,workSpace);
    fs.mkdirsSync(workSpace);
 
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
            return assemble.createGapFile(log,template,workSpace,gapFileMap,item,index);
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
        assemble.cleanupTmps(log,template,workSpace,gapFileMap);
        return template;
    })
    .fail(function(err){
        log.error('[%1] - %2',template.id,err.message);
        assemble.cleanupTmps(log,template,workSpace,gapFileMap);
    });
}

assemble.roundToPlace = function(num,place){
    var m = Math.pow(10,place);
    return (Math.round(num * m) / m);
};

assemble.formatBlankFilePath = function(template,gap){
    var base = parseInt(Math.round(gap * 1000),10),
        dir = (template.blanks) ? template.blanks : '';
    return path.join(dir, base + '.mp3');
};

assemble.cleanupTmps = function(log,tmpl,workSpace,gapFileMap){
    if (tmpl.preserve && tmpl.blanks){
        Object.keys(gapFileMap).forEach(function(key){
            log.trace('[%1] - copy %2==>%3',tmpl.id,gapFileMap[key],key);
            try {
                fs.copySync(gapFileMap[key],key);
            }catch(e){
                log.warn('[%1] Error copying blankFile: %2',tmpl.id,e.message);
            }
        });
    }
    fs.removeSync(workSpace);
};

assemble.getSrcInfoID3 = q.fbind(function(log,tmpl,curItem,index){
    if ((curItem.metaData) && (curItem.metaData.duration)){
        log.trace('[%1] getSrcInfoID3: track %2 has duration = %3',
            tmpl.id,index, curItem.metaData.duration);
        return q({
            index : index,
            item : curItem
        });
    }

    var deferred = q.defer(), workingItem;
    log.trace('[%1] getSrcInfoID3 %2',tmpl.id,curItem.src);
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
    if ((curItem.metaData) && (curItem.metaData.duration)){
        log.trace('[%1] - getSrcInfo %2 - already have it (%3)',
            tmpl.id,curItem.src, curItem.metaData.duration);
        return q({
            index : index,
            item : curItem
        });
    }
    
    log.trace('[%1] - getSrcInfo %2',tmpl.id,curItem.src);
    var deferred = q.defer(),workingItem;
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
            working[i].gapBefore = Math.max(assemble.roundToPlace((working[i].item.ts - 
                                                 working[(i - 1)].tsEnd),2),0);
        }
    }
    if (tmpl.duration > working[(i -1)].tsEnd){
        working.push({
            gapBefore : assemble.roundToPlace((tmpl.duration - 
                                                working[(i - 1)].tsEnd) , 2),
        });
    }
    return working;
});
assemble.createGapFile = q.fbind(function(log,tmpl, workSpace, gapFileMap,curItem, index){
    var deferred, blankFile, permFile, result = { index: index, files : [] };

    if (!curItem.gapBefore) {
        log.trace('[%1] - createGapFile: %2, no gap to create',tmpl.id,index);
        result.files.push(curItem.item.src);
        return q(result);
    }

    if (tmpl.blanks){
        permFile  = assemble.formatBlankFilePath(tmpl,curItem.gapBefore);

        if (fs.existsSync(permFile)){
            log.trace('[%1] - createGapFile: %2, found cached blank: %3',tmpl.id,index,permFile);
            result.files.push(permFile);
            if (curItem.item){
                result.files.push(curItem.item.src);
            }
            return q(result);
        }
    }

    deferred = q.defer();
    blankFile = path.join(workSpace,uuid.createUuid().substr(0,10) + '.mp3');
    log.trace('[%1] - make blankfile %2: %3, gap=%4',tmpl.id,index,blankFile,curItem.gapBefore);
    tmpl.ffmpeg.makeSilentMP3(blankFile,curItem.gapBefore,tmpl,function(err,fpath){
        if (err) {
            log.error('[%1] - %2, makeSilentMp3 failed: %3',tmpl.id,index,err.message);
            deferred.reject(err);
            return;
        }

        if (permFile){
            gapFileMap[permFile] = blankFile;
        }

        result.files.push(blankFile);
        if (curItem.item){
            result.files.push(curItem.item.src);
        }
        log.trace('[%1] - resolved create gap file for %2', tmpl.id,index);
        deferred.resolve(result);
    });

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
