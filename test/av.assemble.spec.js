var path        = require('path'),
    fs          = require('fs'),
    crypto      = require('crypto');

describe('assemble (UT)',function(){
    var assemble, template, log;
    beforeEach(function(){
        assemble = require('../lib/assemble');
        template = {
            id          : 'test',
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

        log = {};
        log.trace   = jasmine.createSpy('log_trace');
        log.error   = jasmine.createSpy('log_error');
        log.warn    = jasmine.createSpy('log_warn');
        log.info    = jasmine.createSpy('log_info');
        log.fatal   = jasmine.createSpy('log_fatal');
        log.log     = jasmine.createSpy('log_log');
    });


    describe('getSrcInfo',function(){

        beforeEach(function(){
            template.ffmpeg = {
                probe : function(src,cb){
                    if (src === path.join(__dirname,'b0.mp3')){
                        cb(null,{
                            duration : 3.335333
                        });
                        return;
                    } 
                    cb(new Error('File does not exist: ' + src ));
                }
            };
        });
        
        it('should get the expected duration for a valid file.',function(done){
            assemble.getSrcInfo(log,template,template.playList[0],0)
            .done(function(result){
                expect(result.index).toEqual(0);
                expect(result.item).toBe(template.playList[0]); 
                expect(result.item.metaData.duration).toEqual(3.335333);
                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });
        });

        it('should raise an error if passed a bad parameter.',function(done){
            template.playList[0].src = 'xxxx';
            assemble.getSrcInfo(log,template,template.playList[0],0)
            .done(function(result){
                expect(result).not.toBeDefined();
                done();
            },function(err){
                expect(err.message).toEqual('File does not exist: xxxx');
                done();
            });
        });

        it('should use the existing duration, if it exists.',function(done){
            template.playList[0].metaData = { duration : 69 };
            spyOn(template.ffmpeg,'probe');
            assemble.getSrcInfo(log,template,template.playList[0],0)
            .done(function(result){
                expect(result.item.metaData.duration).toEqual(69);
                expect(template.ffmpeg.probe).not.toHaveBeenCalled();
                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });
        });
    });
        
    describe('getSrcInfoID3',function(){
        
        beforeEach(function(){
            template.id3Info = function(src,cb){
                if (src === path.join(__dirname,'b0.mp3')){
                    cb(null,{
                        audio_duration : 2.936
                    });
                    return;
                } 
                cb(new Error('No id3 data for ' + src ));
            };
        });
        
        
        it('should get the expected duration for a valid file.',function(done){
            assemble.getSrcInfoID3(log,template,template.playList[0],0)
            .done(function(result){
                expect(result.index).toEqual(0);
                expect(result.item).toBe(template.playList[0]); 
                expect(result.item.metaData.duration).toEqual(2.936);
                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });

        });

        it('should raise an error if passed a bad parameter.',function(done){
            template.playList[0].src = 'xxxx';
            assemble.getSrcInfoID3(log,template,template.playList[0],0)
            .done(function(result){
                expect(result).not.toBeDefined();
                done();
            },function(err){
                expect(err.message).toEqual('No id3 data for xxxx');
                done();
            });
        });
        
        it('should use the existing duration, if it exists.',function(done){
            template.playList[0].metaData = { duration : 69 };
            spyOn(template,'id3Info');
            assemble.getSrcInfoID3(log,template,template.playList[0],0)
            .done(function(result){
                expect(result.item.metaData.duration).toEqual(69);
                expect(template.id3Info).not.toHaveBeenCalled();
                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });
        });
    });

    describe('calculateGaps',function(){

        var working, template;
        beforeEach(function(){
            template = {
                duration : 16.5
            };
            working = [ {
                    index : 0,
                    item  : { ts : 2, metaData : { duration : 0 } }
                }, {
                    index : 1,
                    item  : { ts : 8, metaData : { duration : 0 } }
                }, {
                    index : 2,
                    item  : { ts : 13, metaData : { duration : 0 } }
                }
            ];
        });


        it('will calculate valid gaps for sounds that fit the gaps',function(done){
            working[0].item.metaData.duration = 3;
            working[1].item.metaData.duration = 3.75;
            working[2].item.metaData.duration = 2.25;

            assemble.calculateGaps(log,template,working)
            .done(function(result){
                expect(result).toBe(working);

                expect(working[0].tsEnd).toEqual(5);
                expect(working[0].gapBefore).toEqual(2);

                expect(working[1].tsEnd).toEqual(11.75);
                expect(working[1].gapBefore).toEqual(3);

                expect(working[2].tsEnd).toEqual(15.25);
                expect(working[2].gapBefore).toEqual(1.25);
                
                expect(working[3].gapBefore).toEqual(1.25);

                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });
        });

        it('will calculate valid gaps if the sounds start at 0',function(done){
            working[0].item.ts = 0;
            working[0].item.metaData.duration = 3;
            working[1].item.metaData.duration = 3.75;
            working[2].item.metaData.duration = 2.25;

            assemble.calculateGaps(log,template,working)
            .done(function(result){
                expect(result).toBe(working);

                expect(working[0].tsEnd).toEqual(3);
                expect(working[0].gapBefore).toEqual(0);

                expect(working[1].tsEnd).toEqual(11.75);
                expect(working[1].gapBefore).toEqual(5);

                expect(working[2].tsEnd).toEqual(15.25);
                expect(working[2].gapBefore).toEqual(1.25);
                
                expect(working[3].gapBefore).toEqual(1.25);

                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });

        });

        it('will leave off the gapBefore if it is not needed',function(done){
            working[0].item.metaData.duration = 7;
            working[1].item.metaData.duration = 3.75;
            working[2].item.metaData.duration = 10;

            assemble.calculateGaps(log,template,working)
            .done(function(result){
                expect(result).toBe(working);
                expect(result.length).toEqual(3);
                expect(working[0].gapBefore).toEqual(2);
                expect(working[1].gapBefore).toEqual(0);
                expect(working[2].gapBefore).toEqual(1.25);
                done();
            },function(err){
                expect(err).not.toBeDefined();
                done();
            });
        });
    });
});
