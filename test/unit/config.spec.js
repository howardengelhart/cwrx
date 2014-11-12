var flush = true;
describe('config', function() {
    var path, fs, config;
    beforeEach(function(){
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        path   = require('path');
        fs     = require('fs-extra');
        config = require('../../lib/config');

        spyOn(fs,'readJsonSync');
    });
    
    describe('mergeObjects', function() {
        it('should merge two objects, favoring the second one', function() {
            var a = { foo: 'bar', food: 'good', a: 1 },
                b = { foo: 'baz', food: 'good', b: 2 };
            expect(config.mergeObjects(a, b)).toEqual({ foo: 'baz', food: 'good', a: 1, b: 2 });

            a = { nested: { c: 1, d: { user: 'otter' } } };
            b = { nested: { c: 'qwerty', d: 'uiop' } };
            expect(config.mergeObjects(a, b)).toEqual({ nested: { c: 'qwerty', d: 'uiop' } });
            
            a = { arr: [ 'foo', 'bar', { key: 'val', a: true } ] };
            b = { arr: [ 'bar', 'foo', { key: 'notval' } ] };
            expect(config.mergeObjects(a, b)).toEqual({arr:['bar','foo',{key:'notval'}]});
            
            a = { arr: [ 'foo', 'bar', 'baz' ] };
            b = { arr: [ 'bluh' ] };
            expect(config.mergeObjects(a, b)).toEqual({ arr: ['bluh'] });

            a = { arr: [ 'foo', 'bar', 'baz' ] };
            b = { arr: { foo: 'bar' } };
            expect(config.mergeObjects(a, b)).toEqual({ arr: { foo: 'bar' } });

            a = { arr: { foo: 'bar' } };
            b = { arr: [ 'foo', 'bar', 'baz' ] };
            expect(config.mergeObjects(a, b)).toEqual({ arr: [ 'foo', 'bar', 'baz' ] });

            var now = new Date(), before = new Date(new Date() - 1000);
            a = { created: now };
            b = { created: before };
            expect(config.mergeObjects(a, b)).toEqual({ created: before });
        });
    });

    describe('createConfiguration', function() {
        beforeEach(function() {
            spyOn(config, 'mergeObjects').andCallThrough();
        });

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
            var userCfg = {
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
            };
            fs.readJsonSync.andReturn(userCfg);
            
            var res = config.createConfigObject('tmpcfg.json', defaultCfg);
            expect(res.settingA).toEqual('banana');
            expect(res.settingB).toEqual('apple');
            expect(res.settingC).toEqual('strawberry');
            expect(res.objectA.oa1).toEqual(1);
            expect(res.objectA.oa2).toEqual('dork');
            expect(res.objectA.oa3).toEqual('oomph');
            expect(res.objectB.v1).toEqual(1);
            expect(res.objectB.v2).toEqual(2);
            expect(config.mergeObjects).toHaveBeenCalledWith(defaultCfg, userCfg);
        });

    });
});
