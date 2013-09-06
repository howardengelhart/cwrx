var path        = require('path'),
    fs          = require('fs-extra'),
    videoServer = require('../lib/videoserver');

describe('videoServer', function(){
    var config, rmList = [];
    beforeEach(function(){
        config = {
            remotes : [{
                type    : 's3',
                auth    : path.join(process.env.HOME,'.aws.ut.json'),
                Bucket  : 'c6.dev',
                KeyPath : 'media/src/screenjack/video'
            }],
            cache   : 'caches/video',
            metaTag : '.meta'
        };
        rmList.push('caches/video');
        rmList.push('videos');
    });

    afterEach(function(){
        var rm = rmList.shift();
        while(rm){
            fs.removeSync(rm);
            rm = rmList.shift();
        }
    });
    
    describe('createConfig', function(){
        it('should create a default configuration',function(){
            var cfg = videoServer.ut.createConfig();
            expect(cfg.metaTag).toEqual('.meta');
            expect(cfg.cache).toEqual('videos');
            expect(cfg.metaTag).toEqual('.meta');
        });

        it('should merge a user configuration with defaults', function(){
            delete config.metaTag;
            delete config.cache;
            var cfg = videoServer.ut.createConfig(config);
            expect(cfg.cache).toEqual('videos');
            expect(cfg.metaTag).toEqual('.meta');
        });
    });

    describe('createVideoServer', function(){

        it('should create a videoServer object',function(){
            var server = videoServer.createVideoServer();
            expect(server).toBeDefined();
        });

        it('should create the caches directory if it does not already exist',function(){


        });

    });
  
/*
    describe('hasVideoAsync method',function(){
        var db, videoPath, videoMeta;
        beforeEach(function(){
            server      = dub.createVideoServer(config);
            videoPath   = config.cacheAddress('scream.mp4','video');
            videoMeta   = videoPath + '.meta';
        });

        it('should fail if there is no local video', function(fin){
            fs.removeSync(videoPath);
            expect(fs.existsSync(videoPath)).toBeFalsy();
            server.hasVideo('scream.mp4')
                .done(
                    function(){ },
                    function(err){
                        expect(err.message).toEqual(
                            'Unable to locate video at: ' + videoPath);
                    }
                );
        });

        it('should fail if there is no meta data for the video', function(){
            fs.removeSync(videoPath);
            expect(fs.existsSync(videoPath)).toBeFalsy();
            server.hasVideo('scream.mp4')
                .done(
                    function(){ },
                    function(err){
                        expect(err.message).toEqual(
                            'Unable to locate video meta data at: ' + videoMeta);
                    }
                );
        });

        it('should fail if the local ETag does not match the server', function(){


        });

        it('should pass if the local video is same as server version',function(){
            

        });


    });
*/

}); // end -- describe videoServer
