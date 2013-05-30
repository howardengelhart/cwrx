var logger = require('../lib/logger');

describe("basic logger creation and initialization",function(){

    it('initializes correctly using createLogger without any configuration',function(){
        var log = logger.createLogger();
        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0x1);
        expect(log.media.length).toEqual(1);
        expect(logger.getLogger()).toBe(log);
        expect(logger.getLogger('default')).toBe(log);
    });

    it('initializes correctly using getLogger without any configuration',function(){
        var log = logger.getLogger();
        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0x1);
        expect(logger.getLogger('someName')).not.toBeDefined();
    });

    it('initializes correctly using createLogger with a configuration',function(){
        var log = logger.createLogger({
            logLevel : 'INFO',
            media    : []
        });

        expect(log.name).toEqual('default');
        expect(log.mask).toEqual(0xF);
        expect(log.media.length).toEqual(0);
        expect(logger.getLogger()).toBe(log);
    });

    it('checks values passed for logLevel and stackType',function(){
        ['faTal','error ',' Warn',' info ','TRACE'].forEach(function(level){
            expect(function(){
                logger.createLogger( { logLevel : level } )
            }).not.toThrow();
        });

        expect(function(){
            logger.createLogger( { logLevel : 'FUDGE' } )
        }).toThrow('Unrecognized logLevel: FUDGE');

        ['none ',' Partial', ' full '].forEach(function(sttype){
            expect(function(){
                logger.createLogger( { stackType : sttype })
            }).not.toThrow();
        });
        
        expect(function(){
            logger.createLogger( { stackType : 'sttype' })
        }).toThrow('Unrecognized stackType: sttype');
    });
});

describe("adding media to logger",function(){
    it('logs requires added media to have a writeLine method',function(){
        var log = logger.createLogger({ media : [] });
        expect(function(){
            log.addMedia( (function(){
                return { };
            }() ) );
        }).toThrow('Media object must have writeLine method.');
    });

    it('uses added media',function(){
        var log = logger.createLogger({ media : [] }),
            lines = [];
        log.addMedia( (function(){
            var media = {};
            media.writeLine = function(line){
                lines.push(line); 
            }
            return media;
        }() ) );
        log.fatal('test');
        expect(lines.length).toEqual(1);
        expect(lines[0].match(/\d\d:\d\d:\d\d\.\d\d\d \d+ \[fatal\] test/)).not.toBeNull();
    });
});

describe("log masking",function(){

    var log, testMedia;

    beforeEach(function(){
        testMedia = {
            lines     : [],
            writeLine : function(line) { this.lines.push(line); }
        };
        log = logger.createLogger({ logMask : 0, media : [] });
        log.addMedia(testMedia);
    });

    it('should set the logMask correctly with setLogLevel',function(){
        expect(log.mask).toEqual(0x0); 
        log.setLogLevel('TRACE');
        expect(log.mask).toEqual(0x1F);
        log.setLogLevel('INFO');
        expect(log.mask).toEqual(0xF);
        log.setLogLevel('WARN');
        expect(log.mask).toEqual(0x7);
        log.setLogLevel('ERROR');
        expect(log.mask).toEqual(0x3);
        log.setLogLevel('FATAL');
        expect(log.mask).toEqual(0x1);
    });

    it('should only log what the logLevel allows',function(){
        expect(log.mask).toEqual(0x0); 
        testMedia.lines = [];
        log.setLogLevel('FATAL');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(1);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        
        testMedia.lines = [];
        log.setLogLevel('ERROR');
        log.fatal('test');
        log.error('test');
        log.warn('test');
        log.info('test');
        log.trace('test');

        expect(testMedia.lines.length).toEqual(2);
        expect(testMedia.lines[0].match(/\[fatal\] test/)).not.toBeNull();
        expect(testMedia.lines[1].match(/\[error\] test/)).not.toBeNull();

        testMedia.lines = [];
        log.setLogLevel('WARN');
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
        log.setLogLevel('INFO');
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
        log.setLogLevel('TRACE');
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
