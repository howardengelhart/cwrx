var path = require('path'),
    fs   = require('fs');
    mux  = require('../../mux');

describe('assemble test suite',function(){
    var files = [];
    afterEach(function(){
        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });

    it('should have an assembler object defined',function(){
        expect(mux.assemble).toBeDefined();
    });


    it('should assemble',function(done){
        var template = {
            duration    : 16.5,
            bitrate     : '48k',
            frequency   : 22050,
            output      : path.join(__dirname,'result.mp3'),
            workspace   : __dirname,
            playList    : [
                { ts: 2, src: path.join(__dirname,'b0.mp3')},
                { ts: 8, src: path.join(__dirname,'b1.mp3')},
                { ts: 13, src: path.join(__dirname,'b2.mp3')}
            ]
        };

        files.push(template.output);
        mux.assemble(template,function(err,tmpl){
            expect(err).toBeNull();
            expect(tmpl).not.toBeNull();
            if (tmpl){
                expect(tmpl).toBe(template);
            }
            expect(fs.existsSync(tmpl.output)).toEqual(true);
            done();
        });
    });
});


