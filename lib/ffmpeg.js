(function(){'use strict';}());
var exec        = require('child_process').exec,
    fs          = require('fs'),
    path        = require('path'),
    parse       = require('./parser').parseNVPStr,
    _cmd_line_ffmpeg   = 'ffmpeg -loglevel error ',
    _cmd_line_ffprobe  = 'ffprobe -loglevel error ',
    _ffmpeg     = {},
    cberr,
    exec_ffmpeg,
    exec_ffprobe,
    create_concat_script;

cberr = function(msg,cb,cmdline,stderr){
    process.nextTick(function(){
        cb({
                message : msg,
                toString : function() { return this.message; }
            },null,cmdline,stderr);
    });
};

create_concat_script = function(fileList,workSpace,cb) {
    var scriptName  = 'ffmpegconcat' + ((new Date()).valueOf()) + '_' +
                        (Math.round(Math.random() * 1000000)).toString(),
        tmp;
    
    if (workSpace){
        scriptName = path.join(workSpace,scriptName);
    }

    tmp = fs.createWriteStream(scriptName);
    tmp.on('finish',function(){
        cb(scriptName);
    });

    fileList.forEach(function(fname){
        tmp.write('file \'' + fname + "'\n");
    });
    tmp.end();
};

exec_ffmpeg = function(args,cb){
    var k, cmd = _cmd_line_ffmpeg + ' ' + args;
//    console.log('COMMAND: ' + cmd);
    k = exec(cmd,function(error,stdout,stderr){
        if ((stderr) && (k.exitCode !== 0)) {
            cb(stderr.replace('\n',''),cmd);
        }
        else
        if (error) {
            cb(error.message,cmd,stdout,stderr);
        } 
        else {
            cb(null,cmd,stdout,stderr);
        }
    });
};

exec_ffprobe = function(args,cb){
    var k,cmd = _cmd_line_ffprobe + ' ' + args;
//    console.log('cmd:' + cmd);
    k = exec(cmd,function(error,stdout,stderr){
//        console.log('K: ' + JSON.stringify(Object.keys(k),null,3));
//        console.log('Exitted with: ' + k.exitCode);
//        console.log('stdout:' + stdout);
//        console.log('stderr:' + stderr);
        if ((stderr) && (k.exitCode !== 0)) {
            cb(stderr.replace('\n',''),cmd);
        }
        else
        if (error) {
            cb(error.message,cmd,stdout,stderr);
        } 
        else {
            cb(null,cmd,stdout,stderr);
        }
    });
};

_ffmpeg.concat = function(){
    var fileList = arguments[0],
        output   = arguments[1],
        cb       = arguments[2],
        options  = {};

    if (arguments.length > 3) {
        options = arguments[2];
        cb      = arguments[3];
    }

    if ((fileList instanceof Array) === false) {
        throw new TypeError('concat expects array of files.');
    }

    if ((cb instanceof Function) === false) {
        throw new TypeError('concat expects callback function.');
    }

    if (fs.existsSync(output)){
        return cberr('File already exists: ' + output,cb);
    }

    var fileCount = fileList.length;
    if (fileCount < 2) {
        return cberr('At least two input files are required.',cb);
    }

    for (var i = 0; i < fileCount; i++) {
        if (!fs.existsSync(fileList[i])){
            return cberr('File does not exist: ' + fileList[i],cb);
        }
    }

    create_concat_script(fileList,options.workspace,function(script){
        exec_ffmpeg(('-f concat -i ' + script + ' -c:a copy ' + output),
        function(err,cmdline,stdout,stderr){
            if (fs.existsSync(script)){
                fs.unlinkSync(script);
            }
            if (err) {
                if (fs.existsSync(output)){
                    fs.unlinkSync(output);
                }
                return cberr('ffmpeg err: ' + err,cb,cmdline,stderr);
            }
            cb(null,output,cmdline,stderr);
        });
    });
};

_ffmpeg.probe = function(){
    var file     = arguments[0],
        cb       = arguments[1],
        options;

    if (arguments.length > 2) {
        options = arguments[1];
        cb      = arguments[2];
    }

    if ((cb instanceof Function) === false) {
        throw new TypeError('concat expects callback function.');
    }
    
    if (!fs.existsSync(file)){
        return cberr('File does not exist: ' + file,cb);
    }

    exec_ffprobe(('-show_format -i ' + file),function(err,cmdline,output,stderr){
        if (err){
            return cberr(err,cb,cmdline,stderr);
        }

        try {
            var data = parse(output, { startAt: 9, endAt: -10, dOuter: '\n'.charCodeAt(0) });
            Object.keys(data).forEach(function(key){
                if (isNaN(data[key]) === false){
                    data[key] = Number(data[key]);
                }
            });
            cb(null,data,cmdline,stderr);
            return;
        }catch(e){
            console.log('EXCEPTION: ' + e); 
        }
        cberr('Unexpected: ' + output,cb,cmdline,stderr);
    });
};

_ffmpeg.mergeAudioToVideo = function(){
    var video   = arguments[0],
        audio   = arguments[1],
        output  = arguments[2],
        cb      = arguments[3],
        options;
    
    if (arguments.length > 4) {
        options = arguments[3];
        cb      = arguments[4];
    }

    if ((cb instanceof Function) === false) {
        throw new TypeError('expects callback function.');
    }
    
    if (!fs.existsSync(video)){
        return cberr('File does not exist: ' + video,cb);
    }

    if (!fs.existsSync(audio)){
        return cberr('File does not exist: ' + audio,cb);
    }
   
    var cmdline = '-i ' + video + ' -i ' + audio + 
                  ' -strict -2 -filter_complex "[0:1] [1:0] amerge" -filter:a apad -shortest -ac 2 -c:v copy ';

    if (options) {
        if (options.frequency) {
            cmdline += '-ar ' + options.frequency + ' ';
        }
    }

    cmdline += output;
    exec_ffmpeg(cmdline, function(err,cmd,stdout,stderr){
            if (err) {
                if (fs.existsSync(output)){
                    fs.unlinkSync(output);
                }
                return cberr('ffmpeg err: ' + err,cb,cmd,stderr);
            }
            cb(null,output,cmd,stderr);
        });
};

_ffmpeg.makeSilentMP3 = function(){
    var outputFile  = arguments[0],
        duration    = arguments[1],
        cb          = arguments[2],
        cmdl        = '',
        options,
        blankSrcPath = path.join(__dirname,'media','5min_128k.mp3');
    
    if (arguments.length > 3) {
        options = arguments[2];
        cb      = arguments[3];
    }
    
    if ((cb instanceof Function) === false) {
        throw new TypeError('expects callback function.');
    }
    
    if (fs.existsSync(outputFile)){
        return cberr('File already exists: ' + outputFile,cb);
    }
    
    if (!fs.existsSync(blankSrcPath)){
        return cberr('Required file does not exist: ' + blankSrcPath,cb);
    }

    if (duration > 300) {
        return cberr('Max duration is 300 seconds.',cb);
    } 

    cmdl = '-i ' + blankSrcPath + ' -t ' + duration;
    if (options) {
        if (options.bitrate) {
            cmdl += ' -b:a ' + options.bitrate;
        }
        if (options.frequency) {
            cmdl += ' -ar ' + options.frequency;
        }
    } else {
        cmdl += ' -c:a copy';
    }
    cmdl += ' ' + outputFile;
    exec_ffmpeg(cmdl, function(err,cmdline,stdout,stderr){
        if (err) {
            if (fs.existsSync(outputFile)){
                fs.unlinkSync(outputFile);
            }
            return cberr('ffmpeg err: ' + err,cb,cmdline,stderr);
        }
        cb(null,outputFile,cmdline,stderr);
    });
};

module.exports = _ffmpeg;
