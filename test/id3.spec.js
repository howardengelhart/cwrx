var path = require('path');

describe('id3 test suite',function(){

    var dubber,
        testFile = path.join(__dirname,'b0.mp3');

    beforeEach(function(){
        dubber = require('../../dubber');
    });

    it('should have an id3Info function defined',function(){
        expect(dubber.id3Info).toBeDefined();
    });

    it('should be able to get id3info on real mp3',function(done){
        dubber.id3Info(testFile,function(err,data){
            expect(err).toBeNull();
            expect(data).toBeDefined();
            expect(data).not.toBeNull();
            expect(data.audio_duration).toBe(2.936);
            expect(data.date).toEqual(new Date('2013-05-22 09:14:19.194'));
            expect(data.host).toBe('DC3APS322');
            expect(data.kbps).toBe(48);
            expect(data.khz).toBe(22050);
            done();
        });
    });

    it('should throw an error if attempt id3info on a bad file',function(done){
        dubber.id3Info(__filename,function(err,data){
            expect(data).not.toBeDefined();
            expect(err).toBeDefined();
            expect(err).not.toBeNull();
            expect(err.message).toEqual('No id3 data for ' + __filename);
            done();
        });

    });

    it('should throw an error if a bad id3Info cmd is set',function(done){
        dubber.id3Info(testFile,'dfdf',function(err,data){
            expect(err).toBeDefined();
            expect(err).not.toBeNull();
            expect(err.message).toEqual('Command failed: /bin/sh: dfdf: command not found\n');
            done();
        });
    });

});
