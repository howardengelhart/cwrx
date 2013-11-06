(function(){'use strict';}());
var __ut__ = (global.jasmine !== undefined) ? true : false,
    __path = require('path'),
    __fs   = require('fs-extra'),
    __fmt  = require('./format'),
    LOG_CHANNEL_Fatal   = 1,
    LOG_CHANNEL_Error   = 2,
    LOG_CHANNEL_Warn    = 3,
    LOG_CHANNEL_Info    = 4,
    LOG_CHANNEL_Trace   = 5,
    _logInstances;

/**************************************************************
 *
 * Call Stack helpers to obtain the location of the line being logged
 *
 */

/*
 * This method should always work, and will return the most info,
 * but it is very slow due to performance of the Error object stack
 * property.
 */

function __full_stack__() {
	var stackstr = (new Error()).stack;
	var i = 0;
	var __re__ = /\s+at\s+(.*)\s+\((.+):(\d+):(\d+)\)\n*/gm;
	var rec = __re__.exec(stackstr);
	while(rec) {
		rec = __re__.exec(stackstr);
		if (++i === 3) {
			return {
                "func":   rec[1],
                "file":   __path.basename(rec[2]),
                "lineno": rec[3]
			};
		}
	}
	return null;
}

/*
 * This function will return the calling function name, but no file or line number.
 * It is significantly faster than the __full_stack__ method.
 *
 * Technically the callee / caller methods have been deprecated so
 * this method may not always work.
*/
function __part_stack__() {
	if (arguments.callee === null) {
		return null;
	}
	var c = arguments.callee.caller;
	for (var i = 0; i < 2; i++) {
		if (c === null) {
			break;
		}
		c = c.caller;
	}

	if (c === null) {
		return null;
	}

	if (!c.name) {
		return {
			"func" : "<anonymous>"
		};
	}

	return {
		"func" : c.name
	};
}

/* Best performance and reliability */
function __no_stack__ () {  return null; }


/**************************************************************
 *
 * Log Media
 *
 */

/*
 * Console Log Media
 */

function ConsoleLogMedia() {
}

ConsoleLogMedia.prototype.id = function(){
    return 'console';
};

ConsoleLogMedia.prototype.writeLine = function(line){
    console.log(line);
};


/*
 * File Log Media - standard linux logging style
 */

function FileLogMedia(globalOpts,localOpts) {
    this.logDir         = './';
    this.logName        = 'log';
    this.backupLogs     = 3;
    this.maxBytes       = 5000000;
    this.maxLineSize    = 1024;

    if (globalOpts) {
        if (globalOpts.logDir)      { this.logDir      = globalOpts.logDir; }
        if (globalOpts.logName)     { this.logName     = globalOpts.logName; }
        if (globalOpts.maxBytes)    { this.maxBytes    = globalOpts.maxBytes; }
        if (globalOpts.maxLineSize) { this.maxLineSize = globalOpts.maxLineSize; }
        if (globalOpts.backupLogs !== undefined )  {
            this.backupLogs = globalOpts.backupLogs;
        }
    }

    if (localOpts) {
        if (localOpts.logDir)      { this.logDir      = localOpts.logDir; }
        if (localOpts.logName)     { this.logName     = localOpts.logName; }
        if (localOpts.maxBytes)    { this.maxBytes    = localOpts.maxBytes; }
        if (localOpts.maxLineSize) { this.maxLineSize = localOpts.maxLineSize; }
        if (localOpts.backupLogs !== undefined)  {
            this.backupLogs  = localOpts.backupLogs;
        }
    }

	this.logBasePath    = __path.join(this.logDir, this.logName);
    this.buff           = new Buffer(this.maxLineSize);
    this.buffEOL        = new Buffer('\n');
    this.bytes          = -1;
    this.fd             = null;

    if (__fs.existsSync(this.logBasePath)){
        this.bytes = __fs.statSync(this.logBasePath).size;
        this.fd    = __fs.openSync(this.logBasePath, 'a');
    }

}

FileLogMedia.prototype.commit = function(){
    if (this.fd) {
        __fs.fsyncSync(this.fd);
    }
};

FileLogMedia.prototype.id = function(){
    return this.logBasePath;
};

FileLogMedia.prototype.readyStream = function(){
    if ((this.bytes >= 0) && (this.bytes < this.maxBytes)){
        return;
    }

    if (this.fd) {
		__fs.fsyncSync(this.fd);
		__fs.close(this.fd);
		this.fd = null;
        this.rotateLogs();
    }
    else
    if (!__fs.existsSync(this.logDir)){
        __fs.mkdirsSync(this.logDir);
    }

    this.fd    = __fs.openSync(this.logBasePath, 'a');
    this.bytes = __fs.statSync(this.logBasePath).size;
};

FileLogMedia.prototype.rotateLogs = function(){
    if (this.backupLogs === 0) {
        __fs.removeSync(this.logBasePath);
        return;
    }

    var self      = this,
        files     = __fs.readdirSync(self.logDir),
        matches   = new Array(self.backupLogs + 1),
        len_base  = self.logName.length,
        num_files = files.length,
        i;

    for (i = 0; i < num_files; i++){
		if (files[i].substr(0,len_base ) === self.logName) {
            if (files[i] === self.logName){
                matches[0] = files[i];
            } else {
                var ext = Number(files[i].substr(len_base +1));
                if (ext < self.backupLogs ){
                    matches[(ext + 1)] = files[i];
                } else {
                    matches.push(files[i]);
                }
            }
        }
    }

    num_files = (matches.length - 1);
    for (i = num_files; i >= 0; i--) {
        if (i > self.backupLogs) {
            __fs.removeSync(__path.join(self.logDir,matches[i]));
            continue;
        }

        if ((i > 0) && (!matches[(i - 1)])){
            continue;
        }

        if (!matches[i]){
            continue;
        }

        if (i === num_files){
            __fs.removeSync(__path.join(self.logDir,matches[i]));
            continue;
        }

        __fs.renameSync(__path.join(self.logDir,matches[i]),
                        __path.join(self.logDir,(self.logName + '.' + i.toString())));
    }
};

FileLogMedia.prototype.writeLine = function(line) {
    this.readyStream();
    this.buff.write(line);
	this.bytes += __fs.writeSync(this.fd,this.buff,0,Buffer._charsWritten);
	this.bytes += __fs.writeSync(this.fd,this.buffEOL,0,this.buffEOL.length);
};


/**************************************************************
 *
 * random helpers
 *
 */
function setBit(mask, bit) {
    return (mask | (1 << (bit - 1)));
}

function fmtLoggerTime(dt) {
    return dt.toISOString();
    /*
    return (((dt.getUTCHours() < 10) ? "0" : "") + dt.getUTCHours()) + ":" +
        (((dt.getUTCMinutes() < 10) ? "0" : "") + dt.getUTCMinutes()) + ":" +
        (((dt.getUTCSeconds() < 10) ? "0" : "") + dt.getUTCSeconds()) + "." +
        (((dt.getUTCMilliseconds() < 10) ? "00" : (dt.getUTCMilliseconds() < 100) ? "0" : "") +
        dt.getUTCMilliseconds());
    */
}

/**************************************************************
 *
 * The base Logger Class
 *
 */
function Logger(name,opts) {
    var self = this;

    self.fmt         = __fmt();
    self.name        = name;
	self.mask        = 0x3;
	self.fnStack     = __no_stack__;
    self.formatter   = self._defaultFormatNoStack;

    if (self.fnStack !== __no_stack__) {
        self.formatter  = self._defaultFormatWithStack;
    }

    if ( (opts === undefined) || (opts === null) ) {
        opts = {};
    }

    if ((opts.logLevel !== undefined) && (opts.logLevel !== null)) {
        self.setLevel(opts.logLevel);
    }

    if ((opts.logMask !== undefined) && (opts.logMask !== null)) {
        self.mask = opts.logMask;
    }

    if ((opts.stackType !== undefined) && (opts.stackType !== null)) {
        self.fnStack = self.setLogStack(opts.stackType);
    }

    self.media = [];
    if ((opts.media === null) || (opts.media === undefined)){
        var m = new ConsoleLogMedia(opts);
        self.addMedia(m);
    } else {
        opts.media.forEach(function(media){
            if (media.type === 'file') {
                self.addMedia(new FileLogMedia(opts,media));
            } else
            if (media.type === 'console') {
                self.addMedia(new ConsoleLogMedia(opts,media));
            }
        });
    }
}

Logger.prototype.commit = function(){
    this.media.forEach(function(media){
        try {
            if (media.commit){
                media.commit();
            }
        }catch(e){
        }
    });
};

Logger.prototype.addMedia = function(v){
    if ((v.writeLine instanceof Function) === false){
        throw new TypeError('Media object must have writeLine method.');
    }

    if ((v.id instanceof Function) === false){
        throw new TypeError('Media object must have an id method.');
    }

    this.media.forEach(function(media){
        if (media.id() == v.id()){
            throw new TypeError('Can only have one log media with id: ' + v.id());
        }
    });

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

    if (this.fnStack !== __no_stack__) {
        this.formatter  = this._defaultFormatWithStack;
    }
};

Logger.prototype.setLevel = function(v){
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

Logger.prototype.log    = function() { 
    if (!this._validChannel(LOG_CHANNEL_Info)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Info, Array.prototype.slice.call(arguments,0));  
};
Logger.prototype.warn   = function() { 
    if (!this._validChannel(LOG_CHANNEL_Warn)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Warn, Array.prototype.slice.call(arguments,0));  
};

Logger.prototype.error  = function() { 
    if (!this._validChannel(LOG_CHANNEL_Error)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Error, Array.prototype.slice.call(arguments,0)); 
};

Logger.prototype.info   = function() { 
    if (!this._validChannel(LOG_CHANNEL_Info)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Info, Array.prototype.slice.call(arguments,0));  
};

Logger.prototype.trace  = function() { 
    if (!this._validChannel(LOG_CHANNEL_Trace)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Trace, Array.prototype.slice.call(arguments,0)); 
};

Logger.prototype.fatal  = function() { 
    if (!this._validChannel(LOG_CHANNEL_Fatal)) { return; }
    this._writeLog.call(this,LOG_CHANNEL_Fatal, Array.prototype.slice.call(arguments,0)); 
};

Logger.prototype.createLogRecord  = function(channel, line, stack) {
	var channel_string;
    switch(channel) {
    case LOG_CHANNEL_Warn:
        channel_string = "warn";
        break;
    case LOG_CHANNEL_Error:
        channel_string = "error";
        break;
    case LOG_CHANNEL_Info:
        channel_string = "info";
        break;
    case LOG_CHANNEL_Trace:
        channel_string = "trace";
        break;
    case LOG_CHANNEL_Fatal:
        channel_string = "fatal";
        break;
    }

	var result = {
        "channel"       : channel,
        "channel_string": channel_string,
        "line"          : line,
        "timestamp"     : new Date(),
        "pid"           : process.pid,
        "stack"         : stack
	};
	return result;
};

Logger.prototype._validChannel = function(channel){
    return ((channel < 1) ? 0 : (this.mask & (1 << (channel - 1)))) ? true : false;
};

Logger.prototype._writeLog = function() {
    var channel = arguments[0], line;
    line = this.fmt.apply(null,arguments[1]);
    var record = this.createLogRecord(channel,line,this.fnStack());
    line = this.formatter(record);
    
    this.media.forEach(function(media){
        media.writeLine(line);
    });
};

Logger.prototype._defaultFormatWithStack = function(record) {
    return  fmtLoggerTime(record.timestamp) + " "   +
            record.pid                      + " ["  +
            record.channel_string           + "] {" +
            record.stack.func               +
            ((record.stack.file) ?
                    (":" + record.stack.file + ":" + record.stack.lineno ) : "") +
            "} " +
            record.line;
};

Logger.prototype._defaultFormatNoStack = function(record) {
    return  this.fmt('%1 %2 [%3] %4',fmtLoggerTime(record.timestamp),
            record.pid, record.channel_string, record.line);
};

/**************************************************************
 *
 * Exports
 *
 */

function getLogInstances(){
    if (!_logInstances){
        process.on('exit',function(){
            Object.keys(_logInstances).forEach(function(instance){
                _logInstances[instance].commit();
            });
        });
        _logInstances = {};
    }
    return _logInstances;
}

exports.createLog = function(cfg,name) {
    var logInstances = getLogInstances();
    if (!name) {
        name = 'default';
    }
    var l = new Logger(name,cfg);
    logInstances[name] = l;
    return l;
};

exports.getLog = function(name){
    var logInstances = getLogInstances();
    if (!name) {
        if (logInstances['default']){
            return logInstances['default'];
        }
        return exports.createLog(undefined,'default');
    }
    return logInstances[name];
};

if (__ut__){
    exports.FileLogMedia         = FileLogMedia;
    exports.__full_stack__       = __full_stack__;
    exports.__part_stack__       = __part_stack__;
    exports.__no_stack__         = __no_stack__;
}
