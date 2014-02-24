/*jslint bitwise: true */
(function(){
    'use strict';
    var __ut__ = (global.jasmine !== undefined) ? true : false,
        __path = require('path'),
        __fs   = require('fs-extra'),
        __fmt  = require('./format'),
        __logChannelFatal   = 1,
        __logChannelError   = 2,
        __logChannelWarn    = 3,
        __logChannelInfo    = 4,
        __logChannelTrace   = 5,
        _logInstances;

    /*jshint -W059 */
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

    function __fullStack__() {
        var stackstr = (new Error()).stack;
        var i = 0;
        var __re__ = /\s+at\s+(.*)\s+\((.+):(\d+):(\d+)\)\n*/gm;
        var rec = __re__.exec(stackstr);
        while(rec) {
            rec = __re__.exec(stackstr);
            if (++i === 3) {
                return {
                    'func':   rec[1],
                    'file':   __path.basename(rec[2]),
                    'lineno': rec[3]
                };
            }
        }
        return null;
    }

    /*
     * This function will return the calling function name, but no file or line number.
     * It is significantly faster than the __fullStack__ method.
     *
     * Technically the callee / caller methods have been deprecated so
     * this method may not always work.
    */
    function __partStack__() {
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
                'func' : '<anonymous>'
            };
        }

        return {
            'func' : c.name
        };
    }

    /* Best performance and reliability */
    function __noStack__ () {  return null; }

    /*jshint +W059 */

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
        this.maxLineSize    = 1024;

        if (globalOpts) {
            if (globalOpts.logDir)      { this.logDir      = globalOpts.logDir; }
            if (globalOpts.logName)     { this.logName     = globalOpts.logName; }
            if (globalOpts.maxLineSize) { this.maxLineSize     = globalOpts.maxLineSize; }
        }

        if (localOpts) {
            if (localOpts.logDir)      { this.logDir      = localOpts.logDir; }
            if (localOpts.logName)     { this.logName     = localOpts.logName; }
            if (localOpts.maxLineSize) { this.maxLineSize     = localOpts.maxLineSize; }
        }

        this.logBasePath    = __path.join(this.logDir, this.logName);
        this.buff           = new Buffer(this.maxLineSize);
        this.buffEOL        = new Buffer('\n');
        this.fd             = null;

        if (__fs.existsSync(this.logBasePath)){
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
        if (this.fd) {
            return;
        }
        
        if (!__fs.existsSync(this.logDir)){
            __fs.mkdirsSync(this.logDir);
        }

        this.fd    = __fs.openSync(this.logBasePath, 'a');
    };

    FileLogMedia.prototype.close = function() {
        if (this.fd) {
            __fs.fsyncSync(this.fd);
            __fs.close(this.fd);
            this.fd = null;
        }
    };
    
    FileLogMedia.prototype.refresh = function() {
        this.close();
        this.readyStream();
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
        return (((dt.getUTCHours() < 10) ? '0' : '') + dt.getUTCHours()) + ':' +
            (((dt.getUTCMinutes() < 10) ? '0' : '') + dt.getUTCMinutes()) + ':' +
            (((dt.getUTCSeconds() < 10) ? '0' : '') + dt.getUTCSeconds()) + '.' +
            (((dt.getUTCMilliseconds() < 10) ? '00' : (dt.getUTCMilliseconds() < 100) ? '0' : '') +
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
        self.fnStack     = __noStack__;
        self.formatter   = self._defaultFormatNoStack;

        if (self.fnStack !== __noStack__) {
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
    
    Logger.prototype.refresh = function(){
        this.media.forEach(function(media){
            try {
                if (media.refresh){
                    media.refresh();
                }
            }catch(e){
            }
        });
    };


    Logger.prototype.close = function(){
        this.media.forEach(function(media){
            try {
                if (media.close){
                    media.close();
                }
            }catch(e){
            }
        });
    };


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
            if (media.id() === v.id()){
                throw new TypeError('Can only have one log media with id: ' + v.id());
            }
        });

        this.media.push(v);
    };

    Logger.prototype.setLogStack = function(v){
        var stackType = v.trim().toUpperCase();
        if (stackType === 'NONE'){
            this.fnStack = __noStack__;
        } else
        if (stackType === 'PARTIAL') {
            this.fnStack = __partStack__;
        } else
        if (stackType === 'FULL') {
            this.fnStack = __fullStack__;
        } else {
            throw new RangeError('Unrecognized stackType: ' + v);
        }

        if (this.fnStack !== __noStack__) {
            this.formatter  = this._defaultFormatWithStack;
        }
    };

    Logger.prototype.setLevel = function(v){
        var levelString = v.trim().toUpperCase();
        if (levelString === 'FATAL'){
            this.mask = 0;
            this.mask = setBit(this.mask,__logChannelFatal);
        } else
        if (levelString === 'ERROR'){
            this.mask = 0;
            this.mask = setBit(this.mask,__logChannelFatal);
            this.mask = setBit(this.mask,__logChannelError);
        } else
        if (levelString === 'WARN'){
            this.mask = 0;
            this.mask = setBit(this.mask,__logChannelFatal);
            this.mask = setBit(this.mask,__logChannelError);
            this.mask = setBit(this.mask,__logChannelWarn);
        } else
        if (levelString === 'INFO'){
            this.mask = 0;
            this.mask = setBit(this.mask,__logChannelFatal);
            this.mask = setBit(this.mask,__logChannelError);
            this.mask = setBit(this.mask,__logChannelWarn);
            this.mask = setBit(this.mask,__logChannelInfo);
        } else
        if (levelString === 'TRACE'){
            this.mask = 0;
            this.mask = setBit(this.mask,__logChannelFatal);
            this.mask = setBit(this.mask,__logChannelError);
            this.mask = setBit(this.mask,__logChannelWarn);
            this.mask = setBit(this.mask,__logChannelInfo);
            this.mask = setBit(this.mask,__logChannelTrace);
        }
        else {
            throw new RangeError('Unrecognized logLevel: ' + v);
        }
    };

    Logger.prototype.log    = function() {
        if (!this._validChannel(__logChannelInfo)) { return; }
        this._writeLog.call(this,__logChannelInfo, Array.prototype.slice.call(arguments,0));
    };
    Logger.prototype.warn   = function() {
        if (!this._validChannel(__logChannelWarn)) { return; }
        this._writeLog.call(this,__logChannelWarn, Array.prototype.slice.call(arguments,0));
    };

    Logger.prototype.error  = function() {
        if (!this._validChannel(__logChannelError)) { return; }
        this._writeLog.call(this,__logChannelError, Array.prototype.slice.call(arguments,0));
    };

    Logger.prototype.info   = function() {
        if (!this._validChannel(__logChannelInfo)) { return; }
        this._writeLog.call(this,__logChannelInfo, Array.prototype.slice.call(arguments,0));
    };

    Logger.prototype.trace  = function() {
        if (!this._validChannel(__logChannelTrace)) { return; }
        this._writeLog.call(this,__logChannelTrace, Array.prototype.slice.call(arguments,0));
    };

    Logger.prototype.fatal  = function() {
        if (!this._validChannel(__logChannelFatal)) { return; }
        this._writeLog.call(this,__logChannelFatal, Array.prototype.slice.call(arguments,0));
    };

    Logger.prototype.createLogRecord  = function(channel, line, stack) {
        var channelString;
        switch(channel) {
        case __logChannelWarn:
            channelString = 'warn';
            break;
        case __logChannelError:
            channelString = 'error';
            break;
        case __logChannelInfo:
            channelString = 'info';
            break;
        case __logChannelTrace:
            channelString = 'trace';
            break;
        case __logChannelFatal:
            channelString = 'fatal';
            break;
        }

        var result = {
            'channel'       : channel,
            'channelString': channelString,
            'line'          : line,
            'timestamp'     : new Date(),
            'pid'           : process.pid,
            'stack'         : stack
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
        return  fmtLoggerTime(record.timestamp) + ' '   +
                record.pid                      + ' ['  +
                record.channelString           + '] {' +
                record.stack.func               +
                ((record.stack.file) ?
                        (':' + record.stack.file + ':' + record.stack.lineno ) : '') +
                '} ' +
                record.line;
    };

    Logger.prototype._defaultFormatNoStack = function(record) {
        return  this.fmt('%1 %2 [%3] %4',fmtLoggerTime(record.timestamp),
                record.pid, record.channelString, record.line);
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

    module.exports.createLog = function(cfg,name) {
        var logInstances = getLogInstances();
        if (!name) {
            name = 'default';
        }
        var l = new Logger(name,cfg);
        logInstances[name] = l;
        return l;
    };

    module.exports.getLog = function(name){
        var logInstances = getLogInstances();
        if (!name) {
            if (logInstances['default']){
                return logInstances['default'];
            }
            return module.exports.createLog(undefined,'default');
        }
        return logInstances[name];
    };

    if (__ut__){
        module.exports.FileLogMedia         = FileLogMedia;
        module.exports.__fullStack__       = __fullStack__;
        module.exports.__partStack__       = __partStack__;
        module.exports.__noStack__         = __noStack__;
    }
}());
