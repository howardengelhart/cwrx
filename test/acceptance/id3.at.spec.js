var path = require('path'),
    id3Info = require('../../lib/id3');

describe('id3 test suite',function(){

    var testFile = path.join(__dirname,'b0.mp3');

    it('should have an id3Info function defined',function(){
        expect(id3Info).toBeDefined();
    });

    it('should be able to get id3info on real mp3',function(done){
        id3Info(testFile,function(err,data){
            expect(err).toBeNull();
            expect(data).toBeDefined();
            expect(data).not.toBeNull();
            expect(data.duration).toBe(2.936);
            expect(data.date).toEqual(new Date('2013-05-22 09:14:19.194'));
            expect(data.host).toBe('DC3APS322');
            expect(data.kbps).toBe(48);
            expect(data.khz).toBe(22050);
            done();
        });
    });

    it('should throw an error if attempt id3info on a bad file',function(done){
        id3Info(__filename,function(err,data){
            expect(data).not.toBeDefined();
            expect(err).toBeDefined();
            expect(err).not.toBeNull();
            expect(err.message).toEqual('No id3 data for ' + __filename);
            done();
        });

    });
});
