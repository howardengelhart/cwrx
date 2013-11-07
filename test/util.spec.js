var path      = require('path'),
    fs        = require('fs-extra'),
    cp        = require('child_process'),
    util      = require('../lib/util');

describe('util', function() {
    var rmList = [];
    afterEach(function(){
        rmList.forEach(function(removable){
            if (fs.existsSync(removable)){
                fs.removeSync(removable);
            }
        });
    });

    describe('createConfiguration', function() {
        var defaultCfg = {
            caches : {
                run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
                line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
                blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
                script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
                video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
                output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
            }
        };
        
        it('should create a configuration object without a config file',function(){
            var cfg = util.createConfiguration({}, defaultCfg);
            
            expect(cfg.caches).toBeDefined();
            for (var key in cfg.caches) {
                expect(cfg.caches[key]).toBe(defaultCfg.caches[key]);
            }
        });
            
        it('should throw an error if given a non existant configuration file', function(){
            expect(function(){
                util.createConfiguration({ config : 'abc.cfg' }, defaultCfg);
            }).toThrow('ENOENT, no such file or directory \'abc.cfg\'');
        });

        it('should throw an error if given a badly formed configuration file', function(){
            rmList.push(path.join(__dirname,'tmpcfg.json'));
            fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),'abc');
            expect(function(){
                util.createConfiguration({config : path.join(__dirname,'tmpcfg.json')}, defaultCfg);
            }).toThrow('Unexpected token a');
        });

        it('creates any required dirs with ensurePaths',function(){
            rmList.push(path.join(__dirname,'caches')); 
            rmList.push(path.join(__dirname,'tmpcfg.json'));

            fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),JSON.stringify({
                caches : {
                            line    : path.join(__dirname,'caches/line/'),
                            script  : path.join(__dirname,'caches/script/'),
                            video   : path.join(__dirname,'caches/video/'),
                            output  : path.join(__dirname,'caches/output/')
                         }
            }));
            var cfg = util.createConfiguration({config : path.join(__dirname,'tmpcfg.json')}, defaultCfg);
           
            cfg.ensurePaths();
            expect(cfg.caches).toBeDefined();
            
            expect(cfg.caches.line).toEqual(path.join(__dirname,   'caches/line/'));
            expect(cfg.caches.script).toEqual(path.join(__dirname, 'caches/script/'));
            expect(cfg.caches.video).toEqual(path.join(__dirname,  'caches/video/'));
            expect(cfg.caches.output).toEqual(path.join(__dirname, 'caches/output/'));
            
            expect(fs.existsSync(cfg.caches.line)).toBeTruthy();
            expect(fs.existsSync(cfg.caches.script)).toBeTruthy();
            expect(fs.existsSync(cfg.caches.video)).toBeTruthy();
            expect(fs.existsSync(cfg.caches.output)).toBeTruthy();
        });
    });
    
    describe('daemonize', function() {
        var done, config, spawn;
    
        beforeEach(function() {
            done = jasmine.createSpy('done'),
            config = {
                readPidFile: jasmine.createSpy('readPidFile'),
                writePidFile: jasmine.createSpy('writePidFile'),
                removePidFile: jasmine.createSpy('removePidFile')
            };
            spawn = spyOn(cp, 'spawn');
        });
        
        it('should daemonize correctly', function() {
            spyOn(console, 'log');
            spyOn(process, 'exit');
            config.readPidFile.andReturn();
            var fakeChild = {
                pid: 999999,
                unref: jasmine.createSpy('unref')
            };
            spawn.andReturn(fakeChild);
            
            util.daemonize(config, 'util', done);
            expect(config.readPidFile).toHaveBeenCalledWith('util.pid');
            expect(process.env.RUNNING_AS_DAEMON).toBeTruthy();
            expect(spawn).toHaveBeenCalled();
            var spawnArgs = spawn.calls[0].args;
            expect(spawn.calls[0].args[1]).toEqual(process.argv.slice(1));
            expect(spawn.calls[0].args[2].env).toBe(process.env);
            expect(config.writePidFile).toHaveBeenCalledWith(fakeChild.pid, 'util.pid');
            expect(process.exit).toHaveBeenCalledWith(0);
        });

        it('should fail to daemonize if already running', function() {
            spyOn(console, 'error');
            spyOn(process, 'kill').andReturn('this exists');
            config.readPidFile.andReturn(999999);
            
            util.daemonize(config, 'util', done);
            expect(config.readPidFile).toHaveBeenCalledWith('util.pid');
            expect(process.kill).toHaveBeenCalledWith(999999, 0);
            expect(done).toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
        });
    });

    describe('hashText', function() {
        it('should create the same random hash for the same text', function() {
            var txt = "abc123",
                hash1 = util.hashText(txt),
                hash2 = util.hashText(txt);
            
            expect(hash1).toEqual(hash2);
            expect(hash1).not.toEqual(txt);
        });
        
        it('should create different hashes for different text', function() {
            var txt1 = "abc123",
                txt2 = "def456",
                hash1 = util.hashText(txt1),
                hash2 = util.hashText(txt2);

            expect(hash1).not.toEqual(hash2);
        });
    });
    
    describe('getObjId', function() {
        it('should create a random 16 char id', function() {
            var testObj1 = { uri: 'abc' },
                testObj2 = { uri: 'def' },

                id1 = util.getObjId('e', testObj1),
                id2 = util.getObjId('e', testObj2);

            expect(id1.match(/^e-/)).toBeTruthy();
            expect(id2.match(/^e-/)).toBeTruthy();
            expect(id1.length).toBe(16);
            expect(id2.length).toBe(16);
            expect(id1).not.toEqual(id2);
        });
        
        it('should still create an id without an input item', function() {
            var id1 = util.getObjId('e');
            expect(id1).toBeDefined();
            expect(id1.match(/^e-/)).toBeTruthy();
            expect(id1.length).toBe(16);
        });
    });
});

