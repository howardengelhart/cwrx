cwrx
===

Cinema6 node utility framework

The cwrx (pronounced see-works) library is the node platform library used primarily by Cinema6 back-end applications, aka "the works".

The cwrx api provides the following sub-modules:
* __cwrx.assemble__ - Helper for concatenating a list of mp3s into a single mp3, including blank spaces between tracks
* __cwrx.ffmpeg__ - Wrappers for various ffmpeg utilities
* __cwrx.id3__ - Wrappers for id3v2 tools.
* __cwrx.logger__ - Handy console or file logging api, supports log rotation.
* __cwrx.vocalWare__ - Wrapper for the vocalware REST api

##Prerequisites

cwrx.ffmpeg and cwrx.assemble requires the ffmpeg command line application to have been previously installed on the target host.  The library makes use of ffmpeg and ffprobe.   Version 1.2 or above required.  While not required, the installation of the id3v2 tools is recommended to improve accuracy of the assemble module. Use of the optional vocalware module requires a valid vocalware account.

##Core

The core libraries provide general purpose functionality useful to other scripts and libs.  For the most part these should be cross-platform.

###cwrx.logger

The logger library provides a snappy console/file logger with log rotation.  

__Example : Basic console logging__

This demonstrates the basic setup of a console log.

```javascript
// Create a console logger
var cwrx = require('cwrx'),
    log  = cwrx.logger.createLog();
    
// The default logLevel is ERROR, os only log.error and log.fatal will be logged
log.trace('This is a trace log.');
log.info('This is an info log.');
log.warn('This is a warn log.');
log.error('This is an error log.');
log.fatal('This is a fata log.');

// The library will cache created logs, you can grab them with getLogger
function someFunction(){
    var myLog = cwrx.logger.getLog();
    myLog.error('warning, danger danger');
}

// Logs can also have names
var anotherLog = cwrx.logger.createLog({ logLevel : 'TRACE' }, 'log2');

// so you can get them by name
function anotherFunc(){
    var log2 = cwrx.logger.getLog('log2');
}

// If you do not provide a name, the library auto-assigns 'default'
```

__Example : Basic file logging__

This demonstrates the basic setup of a file log.
```javascript
// Create a file logger with minimum configuration
// This will create a log in the current directory with
// the name "log".  It will have a max size of 50MB and
// will rotate up to 3 backups (log --> log.0 --> log.1 --> log.2)
// As with our earlier example, only log.fatal and log.error will
// be logged.
var cwrx = require('cwrx'),
    log  = cwrx.logger.createLog({ type : "file" });

log.error('this will be written to my logfile.');
log.info('this will NOT be written to my logfile.');
```

__Example : Configuration__

Lets make this interesting by showing off some configuration.
```javascript
// This will create a multi-media log.  Logs will appear in console and be
// written to a file.  A few things to note:
// *) All of the options under the file media (other than type) can be
//    located as options under the main config object (allows for sharing)
// *) Custom log media can be added to the log object after creation (see addLogMedia).
// *) logLevel and stackType can be changed subsequently via log object methods.
//
var cwrx = require('cwrx'),
    log  = cwrx.logger.createLog({
        logLevel  : 'TRACE',// Log everything
        stackType : 'FULL', // Add stack info to logs (see notes on stack and performance)
        media     : [
                        {   type : "console" },
                        {
                            type        : "file",
                            logName     : "app.log",
                            logDir      : "/var/log/",
                            backupLogs  : 0,
                            maxBytes    : 3000000,
                            maxLineSize : 512
                        }
                    ]
    });
```
##Audio/Visual

cwrx provides several useful modules for working with audio and visual files and text to speech.

###cwrx.ffmpeg

The cwrx.ffmpeg library provides convenient wrappers and result checking for several ffmpeg functions.

__ffmpeg.concat__

Used to concatenate a list of mp3's into a single mp3 file.

__ffmpeg.mergeAudioToVideo__

Merges an audio file (mp3) into a video file.

__ffmpeg.makeSilentMP3__

Generates blank (silent) mp3 files up to 5 minutes in length.

__ffmpeg.probe__

Returns some basic information about a media file.

###cwrx.assemble

The cwrx.assemble library is a single function used to assemble a composite mp3.

###cwrx.vocalWare

The cwrx.vocalWare library provides convenient wrappers around the VocalWare RESTful API.

####Testing

By default, 'npm test' will exclude the VocalWare test specs.  In order to run the VocalWare unit tests the following command line must be given:

%> jasmine-node --config with-vocalware 1 --config vwauth vwauth.json test/vocalware.spec.js 

The vwauth.json file (name is optional) should contain the following, (replace 9's with your own ids):

{
    "apiId"       : "9999999",
    "accountId"   : "9999999",
    "secret"      : "99999999999999999999999999999999"
}

test 123456789123456899123
