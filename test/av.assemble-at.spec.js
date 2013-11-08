var path        = require('path'),
    fs          = require('fs'),
    crypto      = require('crypto'),
    assemble    = require('../lib/assemble'),
    template, 
    files = [ path.join(__dirname,'result.mp3') ];

describe('assemble (AT)',function(){
    beforeEach(function(){
        template = {
            id          : 'test',
            duration    : 16.5,
            bitrate     : '48k',
            frequency   : 22050,
            output      : path.join(__dirname,'result.mp3'),
            workspace   : '/tmp',
            playList    : [
                { ts: 2, src: path.join(__dirname,'b0.mp3')},
                { ts: 8, src: path.join(__dirname,'b1.mp3')},
                { ts: 13, src: path.join(__dirname,'b2.mp3')}
            ]
        };

        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });
    
    afterEach(function(){
        files.forEach(function(file){
            if(fs.existsSync(file)){
                fs.unlinkSync(file);
            }
        });
    });

    it('should assemble',function(done){
        assemble(template)
        .then(function(tmpl){
            expect(tmpl).not.toBeNull();
            if (!tmpl){
                done();
                return;
            }
            expect(tmpl).toBe(template);
            expect(tmpl.playList[0].metaData.duration).toEqual(3.335333);
            expect(tmpl.playList[1].metaData.duration).toEqual(3.764);
            expect(tmpl.playList[2].metaData.duration).toEqual(2.286);
            expect(fs.existsSync(tmpl.output)).toEqual(true);
            var cksum = crypto.createHash('sha1'),
                buff = fs.readFileSync(tmpl.output);
            
            cksum.update(buff);
            expect(buff.length).toEqual(96110);
            expect(cksum.digest('hex')).toEqual('e3bfd03fb7aa21745478b8b98a505fe3713e8e20');
            done();
        })
        .fail(function(error){
            expect(error).not.toBeDefined();
            done();
        });
    });
});
