var __path = require('path'),
    __fs   = require('fs-extra'),
    LOG_CHANNEL_Fatal 	= 1,
    LOG_CHANNEL_Error 	= 2,
    LOG_CHANNEL_Warn 	= 3,
    LOG_CHANNEL_Info 	= 4,
    LOG_CHANNEL_Trace 	= 5,
    logInstances        = {},
    createLogger,
    getLogger;

////////////////////////////////////////////////////////////////////
//
// Helper function to obtain the location of the line being logged
//
// This method should always work, and will return the most info, 
// but it is very slow due to performance of the Error object stack 
// property.
//
function __full_stack__() {
	var stackstr = (new Error()).stack;
	var i = 0;
	var __re__ = /\s+at\s+(.*)\s+\((.+):(\d+):(\d+)\)\n*/gm;
	var rec = __re__.exec(stackstr);
	while(rec) {
		rec = __re__.exec(stackstr);
		if (++i === 4) {
			return {
					  "function": 	rec[1]
					, "file": 		__path.basename(rec[2])
					, "lineno": 	rec[3]
			};
		}
	}
	return null;
}

////////////////////////////////////////////////////////////////////
//
// This function will return the calling function name, but no file or line number.
// It is significantly faster than the __full_stack__ method.
//
// Technically the callee / caller methods have been deprecated so 
// this method may not always work.
//
function __part_stack__() {
	if (arguments.callee == null) { 
		return null;
	}
	var c = arguments.callee.caller; 
	for (var i = 0; i < 3; i++) {
		if (c == null) {
			break;
		}
		c = c.caller;
	}

	if (c == null) {
		return null;
	}

	if (!c.name) {
		return {
			"function" : "<anonymous>"
		};
	}

	return {
		"function" : c.name
	};
}

////////////////////////////////////////////////////////////////////
//
// Best performance and reliability
//
function __no_stack__ () {  return null; }


////////////////////////////////////////////////////////////////////
//
// Console Log Media
//
function ConsoleLogMedia() {

}

ConsoleLogMedia.prototype.writeLine = function(line){
    console.log(line);
}


////////////////////////////////////////////////////////////////////
//
// File Log Media
//

function FileLogMedia(globalOpts,localOpts) {
	this.logDir	 	 	= './';
	this.logName	 	= 'log';
	this.maxLogs	 	= 10;
	this.maxBytes	 	= 5000000;
	this.maxLineSize	= 1024;
	
    if (globalOpts) {
        if (globalOpts.logDir)      { this.logDir      = globalOpts.logDir; } 
        if (globalOpts.logName)     { this.logName     = globalOpts.logName; }
        if (globalOpts.maxLogs)     { this.maxLogs     = globalOpts.maxLogs; }
        if (globalOpts.maxBytes)    { this.maxBytes    = globalOpts.maxBytes; }
        if (globalOpts.maxLineSize) { this.maxLineSize = globalOpts.maxLineSize; }
    }
    
    if (localOpts) {
        if (localOpts.logDir)      { this.logDir      = localOpts.logDir; } 
        if (localOpts.logName)     { this.logName     = localOpts.logName; }
        if (localOpts.maxLogs)     { this.maxLogs     = localOpts.maxLogs; }
        if (localOpts.maxBytes)    { this.maxBytes    = localOpts.maxBytes; }
        if (localOpts.maxLineSize) { this.maxLineSize = localOpts.maxLineSize; }
    }
    
	this.logBasePath    = __path.join(this.logDir, this.logName);
    this.buff           = new Buffer(opts.maxLineSize  !== undefined ? 
                                                opts.maxLineSize : 1024);
    this.bytes		    = -1;
    this.fd             = null;

    if (__fs.existsSync(this.logBasePath)){
        var stats   = __fs.statSync(foundFile);
        this.bytes  = stats.size;
        this.fd     = __fs.openSync(this.logBasePath, 'a');
    }
}

FileLogMedia.prototype.readyStream = function(){
    var needRotate = false;
    if ((this.bytes >= 0) && (this.bytes < this.maxBytes)){
        return;
    }
	
    if (this.fd) {
		__fs.fsyncSync(this.fd);
		__fs.close(this.fd);
		this.fd = null;
        needRotate = true;
	} else {
        if (!__fs.existsSync(this.logDir)){
            __fs.mkdirsSync(this.logDir);
        }
    }

    if (needRotate) {
        this.rotateLogs();
    }
    
    this.fd     = __fs.openSync(this.logBasePath, 'a');
};

FileLogMedia.prototype.rotateLogs = function(){
    var files     = __fs.readdirSync(this.logDir),
	    matches   = new Array(this.maxLogs + 1),
	    len_base  = this.logName.length,
        num_files = files.length;

    for (var i = 0; i < num_files; i++){
		if (files[i].substr(0,len_base ) === this.logName) {
            if (files[i] === this.logName){
                matches[0] = files[i]; 
            } else {
		    var ext = Number(files[i].substr(len_base +1));
                if (ext >= (this.maxLogs - 1)){
                    __fs.removeSync(path.join(this.logDir,files[i]));
                } else {
                    matches[(ext + 1)] = files[i];
                }
            }
        }
    }

    matches.forEach(function(file,index){
        __fs.renameSync(__path.join(this.logDir,file),
                        __path.join(this.logDir,this.logName + '.' + index.toString()));

    });
};

FileLogMedia.prototype.writeLine = function(line) {
    this.readyStream();
    this.buff.write(line + "\n");
	this.bytes += __fs.writeSync(this._fd,this.buff,0,Buffer._charsWritten);
}

function setBit(mask, bit) {
    return (mask | (1 << (bit - 1)));
}

function fmtLoggerTime(dt) {
    return (((dt.getUTCHours() < 10) ? "0" : "") + dt.getUTCHours()) + ":" +
        (((dt.getUTCMinutes() < 10) ? "0" : "") + dt.getUTCMinutes()) + ":" +
        (((dt.getUTCSeconds() < 10) ? "0" : "") + dt.getUTCSeconds()) + "." +
        (((dt.getUTCMilliseconds() < 10) ? "00" : (dt.getUTCMilliseconds() < 100) ? "0" : "") +
        dt.getUTCMilliseconds());
}

////////////////////////////////////////////////////////////////////
//
// The base Logger Class
//
function Logger(name,opts) {
    this.name        = name;
	this.mask        = 0x1;
	this.fnStack     = __no_stack__;
    this.formatter   = this._defaultFormatNoStack;

    if (this.fnStack !== __no_stack__) {
        this.formatter  = this._defaultFormatWithStack;
    }

    if ( (opts === undefined) || (opts === null) ) {
        opts = {};
    }
    
    if ((opts.logLevel !== undefined) && (opts.logLevel !== null)) {
        this.setLogLevel(opts.logLevel);     
    }

    if ((opts.logMask !== undefined) && (opts.logMask !== null)) {
        this.mask = opts.logMask;	
    }
    
    if ((opts.stackType !== undefined) && (opts.stackType !== null)) {
        this.fnStack = this.setLogStack(opts.stackType);
    }
	
    this.media = [];
    if (!opts.media){
        this.media.push(new ConsoleLogMedia());
    } else {
        opts.media.forEach(function(media){
            if (media.type === 'file') {
                this.media.push(new FileLogMedia(opts,media));
            } else
            if (media.type === 'console') {
                this.media.push(new ConsoleLogMedia(opts,media));
            } 
        });
    }
}

Logger.prototype.addMedia = function(v){
    if (!v.hasOwnProperty('writeLine')){
        throw new TypeError('Media object must have writeLine method.');
    }
    this.media.push(v);
};

Logger.prototype.setLogStack = function(v){
    var stackType = v.trim().toUpperCase();
    if (stackType === 'NONE'){
        this.fnStack = __no_stack__;
    } else 
    if (stackType === 'PARTIAL') {
        this.fnStack = __part_stack__;
    } else
    if (stackType === 'FULL') {
        this.fnStack = __full_stack__;
    } else {
        throw new RangeError('Unrecognized stackType: ' + v);
    }
};

Logger.prototype.setLogLevel = function(v){
    var levelString = v.trim().toUpperCase();
    if (levelString === 'FATAL'){
        this.mask = 0;
        this.mask = setBit(this.mask,LOG_CHANNEL_Fatal);
    } else
    if (levelString === 'ERROR'){
        this.mask = 0;
        this.mask = setBit(this.mask,LOG_CHANNEL_Fatal);
        this.mask = setBit(this.mask,LOG_CHANNEL_Error);
    } else
    if (levelString === 'WARN'){
        this.mask = 0;
        this.mask = setBit(this.mask,LOG_CHANNEL_Fatal);
        this.mask = setBit(this.mask,LOG_CHANNEL_Error);
        this.mask = setBit(this.mask,LOG_CHANNEL_Warn);
    } else
    if (levelString === 'INFO'){
        this.mask = 0;
        this.mask = setBit(this.mask,LOG_CHANNEL_Fatal);
        this.mask = setBit(this.mask,LOG_CHANNEL_Error);
        this.mask = setBit(this.mask,LOG_CHANNEL_Warn);
        this.mask = setBit(this.mask,LOG_CHANNEL_Info);
    } else
    if (levelString === 'TRACE'){
        this.mask = 0;
        this.mask = setBit(this.mask,LOG_CHANNEL_Fatal);
        this.mask = setBit(this.mask,LOG_CHANNEL_Error);
        this.mask = setBit(this.mask,LOG_CHANNEL_Warn);
        this.mask = setBit(this.mask,LOG_CHANNEL_Info);
        this.mask = setBit(this.mask,LOG_CHANNEL_Trace);
    }
    else {
        throw new RangeError('Unrecognized logLevel: ' + v);
    }
};

Logger.prototype.log 	= function(line) { this._writeLog(line, LOG_CHANNEL_Info)   };
Logger.prototype.warn 	= function(line) { this._writeLog(line, LOG_CHANNEL_Warn)   };
Logger.prototype.error  = function(line) { this._writeLog(line, LOG_CHANNEL_Error)  };
Logger.prototype.info   = function(line) { this._writeLog(line, LOG_CHANNEL_Info)   };
Logger.prototype.trace  = function(line) { this._writeLog(line, LOG_CHANNEL_Trace)  };
Logger.prototype.fatal  = function(line) { this._writeLog(line, LOG_CHANNEL_Fatal)  };

Logger.prototype.createLogRecord  = function(channel, line, stack) {
	var channel_string;
    switch(channel) {
        case LOG_CHANNEL_Warn:       channel_string = "warn";    break;
        case LOG_CHANNEL_Error:      channel_string = "error";   break;
        case LOG_CHANNEL_Info:       channel_string = "info";    break;
        case LOG_CHANNEL_Trace:      channel_string = "trace";   break;
        case LOG_CHANNEL_Fatal:      channel_string = "fatal";   break;
    };

	var result = {
		 "channel"			: channel
		,"channel_string"	: channel_string
		,"line"	 			: line
		,"timestamp"		: new Date()
		,"pid"				: process.pid
		,"stack"			: stack
	};
	return result;
};


Logger.prototype._writeLog = function(line, channel) {
    if (!((channel < 1) ? 0 : (this.mask & (1 << (channel - 1))))) { return; }
    var record = this.createLogRecord(channel,line,this.fnStack());
    this._writeRecord(record);
};

Logger.prototype._writeRecord = function(record) {
    var line = this.formatter(record);
    this.media.forEach(function(media){
        media.writeLine(line);
    });
};

Logger.prototype._defaultFormatWithStack = function(record, eol) {
    return 	fmtLoggerTime(record.timestamp) + " "
            + record.pid 	+ " ["
            + record.channel_string			+ "] {"
            + record.stack.function 	
            + ((record.stack.file != null) ? 
                    (":" + record.stack.file + ":" + record.stack.lineno ) : "")
            + "} " 
            + record.line
            + ((eol !== undefined) ? eol : "");
};

Logger.prototype._defaultFormatNoStack = function(record, eol) {

    return 	fmtLoggerTime(record.timestamp) + " "
            + record.pid 	+ " ["
            + record.channel_string		+ "] "
            + record.line 
            + ((eol !== undefined) ? eol : "");
};


/*
 * Exports
 */
exports.createLogger = function(cfg,name) {
    if (!name) {
        name = 'default';
    }
    var l = new Logger(name,cfg);
    logInstances[name] = l;
    return l;
};

exports.getLogger = function(name){
    if (!name) {
        if (logInstances['default']){
            return logInstances['default'];
        }
        return createLogger(undefined,'default');
    }
    return logInstances[name];
};

exports.ConsoleLogMedia      = ConsoleLogMedia;
exports.FileLogMedia         = FileLogMedia;
