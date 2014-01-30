
describe('config', function() {
    var path, fs, config, flush;
    beforeEach(function(){
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        path   = require('path');
        fs     = require('fs-extra');
        config = require('../../lib/config');

        spyOn(fs,'readJsonSync');
    });

    describe('createConfiguration', function() {
        it('should create a configuration object without a config file',function(){
            var defaultCfg = {
                caches : {
                    run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
                    line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
                    blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
                    script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
                    video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
                    output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/')
                }
            },
            cfg = config.createConfigObject('', defaultCfg);
            
            expect(cfg.caches).toBeDefined();
            expect(cfg.caches.run).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/run/'));
            expect(cfg.caches.line).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/line/'));
            expect(cfg.caches.blanks).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'));
            expect(cfg.caches.script).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/script/'));
            expect(cfg.caches.video).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/video/'));
            expect(cfg.caches.output).toEqual(path.normalize('/usr/local/share/cwrx/dub/caches/output/'));
        });
           
        it('should merge config file data with default config',function(){
            var defaultCfg = {
                'settingA' : 'banana',
                'settingB' : 'grape',
                'objectA'  : {
                    'oa1'  : 1,
                    'oa2'  : 2
                }
            };
            fs.readJsonSync.andReturn({
                'settingB' : 'apple',
                'settingC' : 'strawberry',
                'objectA'  : {
                    'oa2'  : 'dork',
                    'oa3'  : 'oomph'
                },
                'objectB' : {
                    'v1' : 1,
                    'v2' : 2
                }
            });
            
            var res = config.createConfigObject('tmpcfg.json', defaultCfg);
            expect(res.settingA).toEqual('banana');
            expect(res.settingB).toEqual('apple');
            expect(res.settingC).toEqual('strawberry');
            expect(res.objectA.oa1).toEqual(1);
            expect(res.objectA.oa2).toEqual('dork');
            expect(res.objectA.oa3).toEqual('oomph');
            expect(res.objectB.v1).toEqual(1);
            expect(res.objectB.v2).toEqual(2);
        });

    });
});
