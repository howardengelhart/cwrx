var path = require('path'),
    fs   = require('fs');
    cwrx     = require('../../cwrx'),
    testFile0  = path.join(__dirname,'b0.mp3'),
    testFile1  = path.join(__dirname,'b1.mp3'),
    testFile2  = path.join(__dirname,'b2.mp3'),
    concatMp3File    = path.join(__dirname,'output.mp3'),
    videoFile        = path.join(__dirname,'test.mp4');
    mergedVideoFile  = path.join(__dirname,'merged.mp4');

describe('ffmpeg init',function(){
    it('should have an ffmpeg object defined',function(){
        expect(cwrx.ffmpeg).toBeDefined();
    });
});

describe('ffmpeg concat test suite',function(){

    afterEach(function(){
        if(fs.existsSync(concatMp3File)){
            fs.unlinkSync(concatMp3File);
        }
    });

    it('should concatenate mp3 files',function(done){

        cwrx.ffmpeg.concat([testFile0,testFile1,testFile2],concatMp3File,function(err,fpath){
            expect(err).toBeNull();
            expect(fpath).toEqual(concatMp3File);
            done();
        });

    });

    it('should not concatenate non mp3 files',function(done){
        cwrx.ffmpeg.concat([__filename,testFile0],concatMp3File,function(err,fpath,cmdline){
            //console.log(cmdline);
            expect(fpath).toBeNull();
            expect(err).not.toBeNull();
            expect(err.message.match('Impossible to open')).not.toBeNull();
            done();
        });
    });

});

describe('ffmpeg probe test suite',function(){
    
    it('should get info on a single mp3 file',function(done){
        cwrx.ffmpeg.probe(testFile0,function(err,info,cmdline){
            expect(err).toBeNull();
            expect(info).not.toBeNull();
            expect(info.filename).toEqual(testFile0);
            expect(info.nb_streams).toEqual(1);
            expect(info.format_name).toEqual('mp3');
            expect(info.format_long_name).toEqual('MP2/3 (MPEG audio layer 2/3)');
            expect(info.start_time).toEqual(0.0);
            expect(info.duration).toEqual(3.335333);
            expect(info.size).toEqual(20012);
            expect(info.bit_rate).toEqual(48000);
            done();
        });
    });

    it('should return an error when probing a non media file',function(done){
        cwrx.ffmpeg.probe(__filename,function(err,info,cmdline){
            expect(info).toBeNull();
            expect(err).not.toBeNull();
            expect(err.message).toEqual( __filename + 
                            ': Invalid data found when processing input' );
            done();

        });
    });
});

describe('ffmpeg merge test suite', function(){
    
    afterEach(function(){
        if(fs.existsSync(concatMp3File)){
            fs.unlinkSync(concatMp3File);
        }
        if(fs.existsSync(mergedVideoFile)){
            fs.unlinkSync(mergedVideoFile);
        }
    });

    it('should merge a video with mp3 file',function(done){

        cwrx.ffmpeg.concat([testFile0,testFile1,testFile2],concatMp3File,function(err,fpath){
            expect(err).toBeNull();
            expect(fpath).toEqual(concatMp3File);

            cwrx.ffmpeg.mergeAudioToVideo(videoFile,concatMp3File,mergedVideoFile,
                function(err,fpath,cmdline){
                    expect(err).toBeNull();
                    expect(fpath).toEqual(mergedVideoFile);
                    done();
                });
        });

    });
});

describe('ffmpeg blank audio generator tests', function(){

    var blankFile = path.join(__dirname,'blank.mp3');
    
    afterEach(function(){
        if(fs.existsSync(blankFile)){
            fs.unlinkSync(blankFile);
        }
    });

    it('should create a blank',function(done){
        cwrx.ffmpeg.makeSilentMP3(blankFile,1.5,function(err,fpath,cmdline){
            expect(err).toBeNull();
            expect(fpath).toEqual(blankFile);
            expect(fs.existsSync(blankFile)).toEqual(true);
            done();    
        });
    });
    
    it('should create a blank at a different bit rate',function(done){
        var opts = { bitrate : '48k' };
        cwrx.ffmpeg.makeSilentMP3(blankFile,1.5,opts,function(err,fpath,cmdline){
            expect(err).toBeNull();
            expect(fpath).toEqual(blankFile);
            expect(fs.existsSync(blankFile)).toEqual(true);
            done();    
        });
    });

    it('should create a blank at a different frequency',function(done){
        var opts = { bitrate : '48k' , frequency : 22050 };
        cwrx.ffmpeg.makeSilentMP3(blankFile,1.5,opts,function(err,fpath,cmdline){
            expect(err).toBeNull();
            expect(fpath).toEqual(blankFile);
            expect(fs.existsSync(blankFile)).toEqual(true);
            done();    
        });
    });
});

describe('ffmpeg combination tests', function(){
    var fileCleanup;
    
    afterEach(function(){
        fileCleanup.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });


    it('should combine creating blanks, concatenation, and merging',function(done){
        var makeBlanks = function(){
            cwrx.ffmpeg.makeSilentMP3(path.join(__dirname,'blank' + (++i) + '.mp3'), i ,
                function(err,fname){
                    expect(err).toBeNull();
                    fileCleanup.push(fname);
                    if (i <= 3) {
                        makeBlanks();
                    } else {
                        concatFiles();
                    }
                });
        },
        concatFiles = function(){
            var fileList = [];
            fileList.push(fileCleanup[0]);
            fileList.push(testFile0);
            fileList.push(fileCleanup[1]);
            fileList.push(testFile1);
            fileList.push(fileCleanup[2]);
            fileList.push(testFile2);
            
            cwrx.ffmpeg.concat(fileList,concatMp3File,function(err,fpath){
                expect(err).toBeNull();
                expect(fpath).toEqual(concatMp3File);
                fileCleanup.push(concatMp3File);
                mergeAudioToVideo();
            });
        },
        mergeAudioToVideo = function(){
            cwrx.ffmpeg.mergeAudioToVideo(videoFile,concatMp3File,mergedVideoFile,
                function(err,fpath,cmdline){
                    expect(err).toBeNull();
                    expect(fpath).toEqual(mergedVideoFile);
                    fileCleanup.push(mergedVideoFile);
                    done();
                });
        },
        i  = 0 ;
        fileCleanup = [];
        makeBlanks();
    });

});
