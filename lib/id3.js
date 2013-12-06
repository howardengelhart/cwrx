(function(){'use strict';}());
var exec = require('child_process').exec;

function id3Info(id3File,cb){
    var cmdLine = 'id3info';

    if (arguments.length < 2) {
        throw new SyntaxError('id3Info expects at least 2 parameters [file] [callback]!');
    }

    if (typeof cb !== 'function') {
        throw new TypeError('id3info expects callback in second parameter.');
    }

    exec(cmdLine + ' ' + id3File,function(error,stdout,stderr){
        if (error){
            cb(error);
            return;
        }
        var mDuration = stdout.match(/audio_duration = \"(.*?)\";/),
            mDate     = stdout.match(/date = \"(\d\d\d\d)(\d\d)(\d\d)_(.*?)\";/),
            mHost     = stdout.match(/host = \"(.*?)\";/),
            mKbps     = stdout.match(/kbps = \"(.*?)\";/),
            mKhz      = stdout.match(/khz = \"(.*?)\";/),
            mLips     = stdout.match(/lip_string = \"(.*?)\";/),
            mPhonemes  = stdout.match(/timed_phonemes = \"(.*?)\";/),
            result;

        if (mDuration instanceof Array) {
            if (!result) { result = {}; }
            result.audio_duration = parseFloat(mDuration[1]);
        }
    
        if (mDate instanceof Array) {
            if (!result) { result = {}; }
            result.date = new Date( (mDate[1]  + '-' +
                                    mDate[2] + '-' +
                                    mDate[3] + ' ' +
                                    mDate[4]));
        }
    
        if (mHost instanceof Array) {
            if (!result) { result = {}; }
            result.host = mHost[1];
        }
    
        if (mKbps instanceof Array) {
            if (!result) { result = {}; }
            result.kbps = parseFloat(mKbps[1]);
        }
    
        if (mKhz instanceof Array) {
            if (!result) { result = {}; }
            result.khz = parseFloat(mKhz[1]);
        }
        
        if (mLips instanceof Array) {
            if (!result) { result = {}; }
            result.lips = mLips[1];
        }
    
        if (mPhonemes instanceof Array) {
            if (!result) { result = {}; }
            result.phonemes = mPhonemes[1];
        }

        process.nextTick(function(){
            if (!result){
                cb({ message: ('No id3 data for ' + id3File)});
            } else {
                cb(null,result);
            }
        });
    });
}


module.exports = id3Info;
