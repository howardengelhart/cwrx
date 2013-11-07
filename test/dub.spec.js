var path      = require('path'),
    fs        = require('fs-extra'),
    dub       = require('../bin/dub'),
    util      = require('../lib/util');

describe('dub',function(){
    var rmList = [];
    afterEach(function(){
        rmList.forEach(function(removable){
            if (fs.existsSync(removable)){
                fs.removeSync(removable);
            }
        });
    });
    
    describe('job', function(){
        var config;
        beforeEach(function(){

            rmList.push(path.join(__dirname,'caches')); 
            rmList.push(path.join(__dirname,'tmpcfg.json'));
            
            fs.writeFileSync(path.join(__dirname,'tmpcfg.json'),JSON.stringify({
                s3     : {
                    src : {
                        bucket : 'c6.dev',
                        path   : 'media/src/screenjack/video'
                    },
                    out : {
                        bucket : 'c6.dev',
                        path   : 'media/usr/screenjack/video'
                    }
                },
                output : {
                    uri : "https://s3.amazonaws.com/c6.dev/media/usr/screenjack/video/",
                    type : "s3"
                },
                caches : {
                    run     : path.join(__dirname,'caches/run/'),
                    line    : path.join(__dirname,'caches/line/'),
                    blanks  : path.join(__dirname,'caches/blanks/'),
                    script  : path.join(__dirname,'caches/script/'),
                    video   : path.join(__dirname,'caches/video/'),
                    output  : path.join(__dirname,'caches/output/')
                },
                tts : {
                    auth        : path.join(process.env.HOME,'.tts.json'),
                    bitrate     : '48k',
                    frequency   : 22050,
                    workspace   : __dirname
                }
            }));
            config = util.createConfiguration(
                { config : path.join(__dirname,'tmpcfg.json')}
            );
            config.ensurePaths();
        });

        describe('loadTemplateFromFile method', function(){

            it('should load a valid template from a file', function(){
                var tmpl = dub.loadTemplateFromFile(path.join(__dirname,'dub_ut_job1.json'));
                expect(tmpl).toBeDefined();
                expect(tmpl.video).toEqual('scream.mp4');
            });
        });

        describe('createDubJob method', function(){
            var jobTemplate;
            
            it('should create a job with valid configuration and template', function(){
                var jobTemplate = dub.loadTemplateFromFile(path.join(__dirname,'dub_ut_job1.json')),
                    job = dub.createDubJob('123456',jobTemplate,config);
                expect(job).toBeDefined();
                expect(job.ttsAuth).toBeDefined();
                expect(job.tts).toEqual(config.tts);
                expect(job.tracks.length).toEqual(10);
                expect(job.enableAws()).toEqual(true);

                expect(job.scriptHash).toEqual(
                    '18ad78e66da8a3be711011f66ce4fd484fde3373'
                );
                expect(job.outputHash).toEqual(
                    'fdbc5df8ff9e246a5d4f70fac2f362afc80766c6'
                );
                expect(job.outputFname).toEqual(
                    'scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                
                expect(job.videoPath).toEqual(path.join(__dirname,'caches/video/scream.mp4'));
                expect(job.outputPath).toEqual(path.join(__dirname,
                    'caches/output/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4')
                );
                expect(job.outputUri).toEqual(
                    'https://s3.amazonaws.com/c6.dev/media/usr/screenjack/video/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                expect(job.outputType).toEqual('s3');

                var srcParams = job.getS3SrcVideoParams();
                expect(srcParams.Bucket).toEqual('c6.dev');
                expect(srcParams.Key).toEqual('media/src/screenjack/video/scream.mp4');

                var outParams = job.getS3OutVideoParams();
                expect(outParams.Bucket).toEqual('c6.dev');
                expect(outParams.Key).toEqual(
                    'media/usr/screenjack/video/scream_fdbc5df8ff9e246a5d4f70fac2f362afc80766c6.mp4'
                );
                expect(outParams.ACL).toEqual('public-read');
                expect(outParams.ContentType).toEqual('video/mp4');

                expect(job.hasVideoLength()).toBeFalsy();
                expect(job.hasOutput()).toBeFalsy();
                expect(job.hasScript()).toBeFalsy();
                expect(job.hasVideo()).toBeFalsy();
                
                var trackFnames = [
                    "678d97754d976dc300659e383da2d93418bdcce4.mp3",
                    "94b284a8b497078df74d05a60d129427526b9228.mp3",
                    "5acda92bba24e111a4b16ccbe0985302a755fedf.mp3",
                    "b4fbb1374001d7c51262a45c992586230dcf6c75.mp3",
                    "c2e4f267d36d372cf1a1d8a7f43479d43d1cd063.mp3",
                    "3101b6063061b820538f4675f80231abcb451946.mp3",
                    "b5884dc590c5159a633186bfb8e2de7e94733558.mp3",
                    "a32e8774e9d22404189c38a4bda97fbe2cd7b448.mp3",
                    "6e69b533aaa3084e6dae7e9932cf5da85ed427a6.mp3",
                    "752b567f55210732234ab7526022ba2fbc7b9ebc.mp3"
                ];
                job.tracks.forEach(function(track, index) {
                    expect(track.fname).toEqual(trackFnames[index]);
                });
            });

        }); // end -- describe createDubJob method

    }); // end -- describe job interface

}); // end -- describe dub

