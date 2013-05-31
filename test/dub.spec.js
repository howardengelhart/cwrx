if (process.env['ut-dub-bin']) {

var path      = require('path'),
    fs        = require('fs-extra'),
    dub       = require('../bin/dub');

describe('dub helpers',function(){
    var rmList = [];
    afterEach(function(){
        rmList.forEach(function(removable){
            if (fs.existsSync(removable)){
                fs.removeSync(removable);
            }
        });
    });

    it('should create a configuration object without a config file',function(){
        var cfg = dub.createConfiguration();
        
        expect(cfg.caches).toBeDefined();
        
        expect(cfg.caches.line).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/line/'));
        expect(cfg.caches.script).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/script/'));
        expect(cfg.caches.video).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/video/'));
        expect(cfg.caches.output).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/output/'));
        
    });

    it('should throw an error if given a non existant configuration file', function(){
        expect(function(){
            dub.createConfiguration('abc.cfg');
        }).toThrow('ENOENT, no such file or directory \'abc.cfg\'');
    });

    it('should throw an error if given a badly formed configuration file', function(){
        rmList.push(path.join(__dirname,'tmpcfg.json'));
        fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),'abc');
        expect(function(){
            dub.createConfiguration(path.join(__dirname,'tmpcfg.json'));
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
        var cfg = dub.createConfiguration(path.join(__dirname,'tmpcfg.json'));
       
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

} // -- END if (process.env['ut-dub-bin']) {

