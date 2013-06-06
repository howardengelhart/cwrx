var path    = require('path'),
    fs      = require('fs'),
    crypto  = require('crypto'),
    cwrx     = require('../lib/index');

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
        expect(cwrx.assemble).toBeDefined();
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
        cwrx.assemble(template,function(err,tmpl){
            expect(err).toBeNull();
            expect(tmpl).not.toBeNull();
            if (tmpl){
                expect(tmpl).toBe(template);
            }
            expect(fs.existsSync(tmpl.output)).toEqual(true);
            var cksum = crypto.createHash('sha1'),
                buff = fs.readFileSync(tmpl.output);
            
            cksum.update(buff);
            expect(buff.length).toEqual(96110);
            expect(cksum.digest('hex')).toEqual('e3bfd03fb7aa21745478b8b98a505fe3713e8e20');
            done();
        });
    });
});
