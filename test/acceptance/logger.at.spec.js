var     fs   = require('fs-extra'),
        path = require('path'),
        logger = require('../../lib/logger');

describe("basic logger creation and initialization",function(){

    it('initializes correctly using createLog without any configuration',function(){
        var log = logger.createLog();
        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0x3);
        expect(log.media.length).toEqual(1);
        expect(logger.getLog()).toBe(log);
        expect(logger.getLog('default')).toBe(log);
    });

    it('initializes correctly using getLog without any configuration',function(){
        var log = logger.getLog();
        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0x3);
        expect(logger.getLog('someName')).not.toBeDefined();
    });

    it('initializes correctly using createLog with a configuration',function(){
        var log = logger.createLog({
            logLevel : 'INFO',
            media    : []
        });

        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0xF);
        expect(log.media.length).toEqual(0);
        expect(logger.getLog()).toBe(log);
    });

    it('checks values passed for logLevel and stackType',function(){
        ['faTal','error ',' Warn',' info ','TRACE'].forEach(function(level){
            expect(function(){
                logger.createLog( { logLevel : level } );
            }).not.toThrow();
        });

        expect(function(){
            logger.createLog( { logLevel : 'FUDGE' } );
        }).toThrow('Unrecognized logLevel: FUDGE');

        ['none ',' Partial', ' full '].forEach(function(sttype){
            expect(function(){
                logger.createLog( { stackType : sttype });
            }).not.toThrow();
        });
        
        expect(function(){
            logger.createLog( { stackType : 'sttype' });
        }).toThrow('Unrecognized stackType: sttype');
    });
});

describe("adding media to logger",function(){
    it('logs requires added media to have a writeLine method',function(){
        var log = logger.createLog({ media : [] });
        expect(function(){
            log.addMedia( (function(){
                return { };
            }() ) );
        }).toThrow('Media object must have writeLine method.');
    });

    it('uses added media',function(){
        var log = logger.createLog({ media : [] }),
            lines = [];
        log.addMedia( (function(){
            var media = {};
            media.writeLine = function(line){
                lines.push(line); 
            };

            media.id = function() { return 'testMedia'; };
            return media;
        }() ) );
        log.fatal('test');
        expect(lines.length).toEqual(1);
        expect(lines[0].match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ \d+ \[fatal\] test/)).not.toBeNull();
    });
});

describe("log formatting", function(){
    var log, testMedia;
    
    beforeEach(function(){
        testMedia = {
            lines     : [],
            writeLine : function(line) { this.lines.push(line); },
            id        : function() { return 'testMedia'; }
        };
        log = logger.createLog({ logMask : 0xf, media : [] });
        log.addMedia(testMedia);
    });

    it('should print with no formats',function(){
        log.info('test abc');
        expect(
            testMedia.lines[0]
                .match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ \d+ \[info\] test abc/)
        )
            .not.toBeNull();
    });

    it('should print with formats',function(){
        log.info('test abc %1 %2 %3',1,2,3);
        expect(
            testMedia.lines[0]
                .match(/\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ \d+ \[info\] test abc 1 2 3/)
        )
            .not.toBeNull();
    });

});

describe("log masking",function(){

    var log, testMedia;

    beforeEach(function(){
        testMedia = {
            lines     : [],
            writeLine : function(line) { this.lines.push(line); },
            id        : function() { return 'testMedia'; }
        };
        log = logger.createLog({ logMask : 0, media : [] });
        log.addMedia(testMedia);
    });

    it('should set the logMask correctly with setLevel',function(){
        expect(log.mask).toEqual(0x0); 
        log.setLevel('TRACE');
        expect(log.mask).toEqual(0x1F);
        log.setLevel('INFO');
        expect(log.mask).toEqual(0xF);
        log.setLevel('WARN');
        expect(log.mask).toEqual(0x7);
        log.setLevel('ERROR');
        expect(log.mask).toEqual(0x3);
        log.setLevel('FATAL');
        expect(log.mask).toEqual(0x1);
    });

    it('should only log what the logLevel allows',function(){
        expect(log.mask).toEqual(0x0); 
        testMedia.lines = [];
        log.setLevel('FATAL');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(1);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        
        testMedia.lines = [];
        log.setLevel('ERROR');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(2);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[error\] test/)).not.toBeNull();

        testMedia.lines = [];
        log.setLevel('WARN');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(3);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[error\] test/)).not.toBeNull();
        expect(testMedia.lines[2].match(/\[warn\] test/)).not.toBeNull();

        testMedia.lines = [];
        log.setLevel('INFO');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(4);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[error\] test/)).not.toBeNull();
        expect(testMedia.lines[2].match(/\[warn\] test/)).not.toBeNull();
        expect(testMedia.lines[3].match(/\[info\] test/)).not.toBeNull();

        testMedia.lines = [];
        log.setLevel('TRACE');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(5);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[error\] test/)).not.toBeNull();
        expect(testMedia.lines[2].match(/\[warn\] test/)).not.toBeNull();
        expect(testMedia.lines[3].match(/\[info\] test/)).not.toBeNull();
        expect(testMedia.lines[4].match(/\[trace\] test/)).not.toBeNull();
    });
    
    it('should only log what the log mask allows',function(){
        expect(log.mask).toEqual(0x0); 
        log.mask = 0x0A;
        testMedia.lines = [];
        
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(2);
        expect(testMedia.lines[0].match(/\[error\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[info\] test/)).not.toBeNull();
        
        log.mask = 0x10;
        testMedia.lines = [];
        
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(1);
        expect(testMedia.lines[0].match(/\[trace\] test/)).not.toBeNull();
    });
});

describe("log stack",function(){

    var log, testMedia;

    beforeEach(function(){
        testMedia = {
            lines     : [],
            writeLine : function(line) { this.lines.push(line); },
            id        : function() { return 'testMedia'; }
        };
        log = logger.createLog({ logLevel : 'INFO', media : [] });
        log.addMedia(testMedia);
    });

    it('should default to not use a log stack',function(){
        log.info('test'); 
        expect(testMedia.lines.length).toEqual(1);
        expect(testMedia.lines[0].match(/\[info\] test/)).not.toBeNull();
    });

    it('should work with part stack',function(){
        log.setLogStack('PARTIAL');
        function someFunc(){
            log.info('test2');
        }
        log.info('test1');
        someFunc();
        
        expect(testMedia.lines.length).toEqual(2);
        expect(testMedia.lines[0].match(/\[info\] {<anonymous>} test1/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[info\] {someFunc} test2/)).not.toBeNull();
    });
    
    it('should work with full stack',function(){
        log.setLogStack('FULL');
        function someFunc(){
            log.info('test2');
        }
        log.info('test1');
        someFunc();
        expect(testMedia.lines.length).toEqual(2);
        expect(testMedia.lines[0].match(
                /\[info\] {null.<anonymous>:logger.at.spec.js:282} test1/)).not.toBeNull();
        expect(testMedia.lines[1].match(
                /\[info\] {someFunc:logger.at.spec.js:280} test2/)).not.toBeNull();
    });
});

describe("file logger initialization",function(){
    var logDir = path.join(__dirname,'logs');

    it('should initialize properly with defaults',function(){
        var fm = new logger.FileLogMedia();
        expect(fm).toBeDefined();
        expect(fm.logDir).toEqual('./');
        expect(fm.logName).toEqual('log');
        expect(fm.backupLogs).toEqual(3);
        expect(fm.maxBytes).toEqual(5000000);
        expect(fm.maxLineSize).toEqual(1024);
        expect(fm.logBasePath).toEqual(path.join('./', 'log'));
        expect(fm.buff).toBeDefined();
        expect(fm.bytes).toEqual(-1);
        expect(fm.fd).toBeNull();
    });


    it('should initialize properly when given a gloabl configuration',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 1,
            maxBytes    : 100,
            maxLineSize : 12
        });

        expect(fm.logDir).toEqual(logDir);
        expect(fm.logName).toEqual('ut.log');
        expect(fm.backupLogs).toEqual(1);
        expect(fm.maxBytes).toEqual(100);
        expect(fm.maxLineSize).toEqual(12);
    });

    it('should initialize properly when given gloabl and local configuration',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 1,
            maxBytes    : 100,
            maxLineSize : 12
        },{
            logName : 'ut2.log',
            backupLogs : 2,
            maxBytes : 200
        });

        expect(fm.logDir).toEqual(logDir);
        expect(fm.logName).toEqual('ut2.log');
        expect(fm.backupLogs).toEqual(2);
        expect(fm.maxBytes).toEqual(200);
        expect(fm.maxLineSize).toEqual(12);
    });
});

describe('file logger log rotation',function(){
    var gc = [],
        logDir = path.join(__dirname,'logs');

    if (fs.existsSync(logDir)) fs.removeSync(logDir);
    beforeEach(function(){
        gc.push(logDir);
    });

    afterEach(function(){
        gc.forEach(function(item){
            if(fs.existsSync(item)){
                fs.removeSync(item);
            }
        });
        gc = [];
    });


    it('should rotate logs properly in empty dir when backupLogs == 0',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 0,
            maxBytes    : 100,
            maxLineSize : 12
        });
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test data');
        expect(fs.readdirSync(logDir).length).toEqual(1);
        fm.rotateLogs();
        expect(fs.readdirSync(logDir).length).toEqual(0);
    });

    it('should rotate logs properly in non empty dir when backupLogs == 0',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 0,
            maxBytes    : 100,
            maxLineSize : 12
        });
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test data');
        fs.writeFileSync(path.join(logDir,'junk1'),'test data');
        fs.writeFileSync(path.join(logDir,'junk2'),'test data');
        fs.writeFileSync(path.join(logDir,'junk3'),'test data');
        expect(fs.readdirSync(logDir).length).toEqual(4);
        fm.rotateLogs();
        var logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(3);
        logFiles.forEach(function(elt){
            expect(elt.match(/junk[1-3]/)).toBeTruthy();
        });
    });

    it('should rotate logs properly in empty dir when backupLogs === 1',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 1,
            maxBytes    : 100,
            maxLineSize : 12
        });
        expect(fm.backupLogs).toEqual(1);
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test data');
        expect(fs.readdirSync(logDir).length).toEqual(1);
        fm.rotateLogs();
        var logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);
        expect(logFiles[0]).toEqual('ut.log.0');
    });

    it('should rotate logs properly in shared dir when backupLogs === 1',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 1,
            maxBytes    : 100,
            maxLineSize : 12
        });
        expect(fm.backupLogs).toEqual(1);
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test data');
        fs.writeFileSync(path.join(logDir,'junk1'),'test data');
        fs.writeFileSync(path.join(logDir,'junk2'),'test data');
        fs.writeFileSync(path.join(logDir,'junk3'),'test data');
        expect(fs.readdirSync(logDir).length).toEqual(4);
        fm.rotateLogs();
        var logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(4);

        logFiles.forEach(function(elt){
            expect((elt.match(/junk[1-3]/)) || (elt === 'ut.log.0')).toBeTruthy();
        });
    });
    
    it('should not rotate log if precedes an empty slot',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 3,
            maxBytes    : 100,
            maxLineSize : 12
        }), logFiles;
        expect(fm.backupLogs).toEqual(3);
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test log one');
        expect(fs.readdirSync(logDir).length).toEqual(1);
        
        fm.rotateLogs();
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);
        expect(logFiles[0]).toEqual('ut.log.0');
        fm.rotateLogs();
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);
        expect(logFiles[0]).toEqual('ut.log.0');
        
        fm.rotateLogs();
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);
        expect(logFiles[0]).toEqual('ut.log.0');
        
        fs.writeFileSync(fm.logBasePath + '.2','test log two');
        expect(fs.readdirSync(logDir).length).toEqual(2);
        fm.rotateLogs();
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(2);

        logFiles.forEach(function(elt){
            expect((elt.match(/ut.log.[02]/))).toBeTruthy();
        });
        
        fs.writeFileSync(fm.logBasePath + '.3','test log two');
        expect(fs.readdirSync(logDir).length).toEqual(3);
        fm.rotateLogs();
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(2);
        logFiles.forEach(function(elt){
            expect((elt.match(/ut.log.[02]/))).toBeTruthy();
        });
    });

    it('should rotate logs',function(){
        var fm = new logger.FileLogMedia({
            logDir      : logDir,
            logName     : 'ut.log',
            backupLogs  : 3,
            maxBytes    : 100,
            maxLineSize : 12
        }), logFiles;
        expect(fm.backupLogs).toEqual(3);
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(fm.logBasePath,'test log 3');
        fs.writeFileSync(fm.logBasePath + '.0','test log 2');
        fs.writeFileSync(fm.logBasePath + '.1','test log 1');
        fs.writeFileSync(fm.logBasePath + '.2','test log 0');
        expect(fs.readdirSync(logDir).length).toEqual(4);
        fm.rotateLogs();
        expect(fs.readdirSync(logDir).length).toEqual(3);
        expect(fs.readFileSync(fm.logBasePath + '.0').toString()).toEqual('test log 3');
        expect(fs.readFileSync(fm.logBasePath + '.1').toString()).toEqual('test log 2');
        expect(fs.readFileSync(fm.logBasePath + '.2').toString()).toEqual('test log 1');
    });
});

describe('file logger logging',function(){

    var gc = [],
        logDir = path.join(__dirname,'logs');

    beforeEach(function(){
        gc.push(logDir);
    });

    afterEach(function(){
        gc.forEach(function(item){
            if(fs.existsSync(item)){
                fs.removeSync(item);
            }
        });
        gc = [];
    });
    
    it('it should write logs from clean start',function(){
        var logFiles, log = logger.createLog({
                logLevel : 'TRACE',
                media    : [
                    {
                        type        : 'file',
                        logDir      : logDir,
                        logName     : 'ut.log',
                        backupLogs  : 3,
                        maxBytes    : 100
                    }
                ]
            });

        expect(fs.existsSync(path.join(logDir,'ut.log'))).toEqual(false);
        for (var i = 0; i < 30; i++){
            var istr = (i < 10) ? '0' + i.toString() : i.toString();
            log.info('abcdef ' + istr);
        }
       
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(4);

    });
    
    it('it should append to logs when it can',function(){
        var logFiles, log = logger.createLog({
                logLevel : 'TRACE',
                media    : [
                    {
                        type        : 'file',
                        logDir      : logDir,
                        logName     : 'ut.log',
                        backupLogs  : 3
                    }
                ]
            });
        
        fs.mkdirsSync(logDir);
        expect(fs.readdirSync(logDir).length).toEqual(0);
        fs.writeFileSync(path.join(logDir,'ut.log'),"test log\n");
        expect(fs.existsSync(path.join(logDir,'ut.log'))).toBeTruthy();

        for (var i = 0; i < 30; i++){
            var istr = (i < 10) ? '0' + i.toString() : i.toString();
            log.info('abcdef ' + istr);
        }
       
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);

        var s = fs.readFileSync(path.join(logDir,'ut.log')).toString(),
            lines = s.split('\n');

        expect(lines[0].match(/test log$/)).toBeTruthy();
        expect(lines[1].match(/abcdef 00$/)).toBeTruthy();
    });

    it('should enforce line size limits',function(){
        var logFiles, log = logger.createLog({
                logLevel : 'TRACE',
                media    : [
                    {
                        type        : 'file',
                        logDir      : logDir,
                        logName     : 'ut.log',
                        maxLineSize : 50
                    }
                ]
            });
        for (var i = 0; i < 30; i++) {
            log.info('abcdefghijklmnopqrstuvwxyz');
        }
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(1);
        
        var s = fs.readFileSync(path.join(logDir,'ut.log')).toString(),
            lines = s.split('\n');

        expect(lines[0].match(/abc/)).toBeTruthy();
        expect(lines[0].match(/xyz/)).not.toBeTruthy();
    });
    
    it('should not allow multiple media with same logname',function(){
        expect(function(){
            logger.createLog({
                logLevel : 'TRACE',
                logDir   : logDir,
                logName  : 'ut.log',
                media    : [
                    { type        : 'file' },
                    { type        : 'file' }
                ]
            });
        }).toThrow('Can only have one log media with id: ' + path.join(logDir,'ut.log'));
    });

    it('should write to multiple media',function(){
        var logFiles, log = logger.createLog({
                logLevel : 'TRACE',
                logDir   : logDir,
                media    : [
                    {
                        type        : 'file',
                        logName     : 'ut_big.log'
                    },
                    {
                        type        : 'file',
                        logName     : 'ut_small.log',
                        backupLogs  : 1,
                        maxBytes    : 100
                    }
                ]
            });

        for (var i = 0; i < 50; i++) {
            log.info('abcdefghijklmnopqrstuvwxyz');
        }
        
        logFiles = fs.readdirSync(logDir);
        expect(logFiles.length).toEqual(3);
        logFiles.forEach(function(elt){
            expect((elt === 'ut_big.log') ||
                    (elt === 'ut_small.log') || 
                    (elt === 'ut_small.log.0')).toBeTruthy();
        });
    });
});

describe('file logger logging and exits',function(){

    var exec   = require('child_process').exec,
        gc     = [],
        logDir = path.join(__dirname,'logs'),
        exec_ext_test = function(args,cb){
                var cmd = 'node ' + path.join(__dirname,'tlog.js') + ' ' + args;
                exec(cmd,cb);
            };

    beforeEach(function(){
        gc.push(logDir);
    });

    afterEach(function(){
        gc.forEach(function(item){
            if(fs.existsSync(item)){
                fs.removeSync(item);
            }
        });
        gc = [];
    });

    it('should write last log line when process exits naturally',function(){
        exec_ext_test('exit1',function(){
            var s, lines;
            expect( function(){
                s = fs.readFileSync(path.join(logDir,'exit1.log')).toString();
                lines = s.split('\n');
            }).not.toThrow();
            expect(lines).toBeDefined(); 
            expect(lines[0].match(/abcdefghijklmnopqrstuvwxyz/)).toBeTruthy();
        });
    });

    it('should write last log line when process exits manually',function(){
        exec_ext_test('exit2',function(){
            var s, lines;
            expect(function(){
                s = fs.readFileSync(path.join(logDir,'exit2.log')).toString();
                lines = s.split('\n');
            }).not.toThrow();
            expect(lines).toBeDefined(); 
            expect(lines[0].match(/abcdefghijklmnopqrstuvwxyz/)).toBeTruthy();
        });
    });

    it('should write last log line when process exits unexpectedly',function(){
        exec_ext_test('exit3',function(){
            var s, lines;
            expect(function(){
                s = fs.readFileSync(path.join(logDir,'exit3.log')).toString();
                lines = s.split('\n');
            }).not.toThrow();
            expect(lines).toBeDefined(); 
            expect(lines[0].match(/abcdefghijklmnopqrstuvwxyz/)).toBeTruthy();
        });
    });
}); 
