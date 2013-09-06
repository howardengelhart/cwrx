var path      = require('path'),
    fs        = require('fs-extra'),
    cwrx      = require('../lib/index'),
    aws       = require('aws-sdk'),
    q         = require('q'),
    utKeyBase;

function genKeyBase(){
    if (!utKeyBase){
        var hash = require('crypto').createHash('sha1');
        hash.update(
            process.env.HOSTNAME + ':' +
            (Math.random() * 1000000).toString() + ':' +
            (Math.random() * 1000000).toString() + ':' +
            ((new Date()).valueOf().toString())
        );
        utKeyBase = hash.digest('hex');
    }

    return utKeyBase;
}

function makeKeyPath(fpath) {
    return path.join('ut',genKeyBase(),fpath);
}


describe('s3util',function(){
    var s3util, keyBase, bucket, s3;

    beforeEach(function(){
        fs.mkdirsSync('tmp');
        fs.outputFileSync('tmp/test1.txt','abcdefghijklmnopqrstuvwxyz0123456789');
        s3util      = cwrx.s3util;
        bucket      = 'c6.dev';
        if (!s3){
            aws.config.loadFromPath(path.join(process.env.HOME,'.aws.ut.json'));
            s3 = new aws.S3();
        }
    });

    afterEach(function(){
        fs.removeSync('tmp'); 
    });

    it('should exist',function(){
        expect(s3util).toBeDefined();
    });

    describe('putObject method',function(){
        it('should exist',function(){
            expect(s3util.putObject).toBeDefined();
        });

        it('should upload a file',function(fin){
            expect(fs.existsSync('tmp/test1.txt')).toEqual(true);
            s3util.putObject(s3,'tmp/test1.txt',{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt')
            })
                .done(
                    function(data){
                        expect(data).toBeDefined();
                        expect(data.ETag).toEqual('"6d2286301265512f019781cc0ce7a39f"');
                        fin();
                    },
                    function(err){
                        fin(err.message);
                    }
                );
        });

        it('should fail with a non-existent file',function(fin){
            expect(fs.existsSync('tmp/badfile.txt')).toEqual(false);
            s3util.putObject(s3,'tmp/badfile.txt',{
                Bucket  : bucket,
                Key     : makeKeyPath('badfile.txt')
            })
                .done(
                    function(data){ },
                    function(err){
                        expect(err.message).toEqual("ENOENT, open 'tmp/badfile.txt'");
                        fin();
                    }
                );
        });
        
        it('should fail with a bad bucket',function(fin){
            expect(fs.existsSync('tmp/test1.txt')).toEqual(true);
            s3util.putObject(s3,'tmp/test1.txt',{
                Bucket  : 'c6.dev.badBucket',
                Key     : makeKeyPath('test1.txt')
            })
                .done(
                    function(data){ },
                    function(err){
                        expect(err.message).toEqual('The specified bucket does not exist');
                        fin();
                    }
                );
        });
    });

    describe('headObject method', function(){
        it('should exist',function(){
            expect(s3util.headObject).toBeDefined();
        });
        
        it('should get head for key that exists',function(fin){
            s3util.headObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt')
            })
                .done(
                    function(data){
                        expect(data).toBeDefined();
                        expect(data.ETag).toEqual('"6d2286301265512f019781cc0ce7a39f"');
                        fin();
                    },
                    function(err){
                        fin(err.message);
                    }
                );
        });

        it('should fail with a bad bucket',function(fin){
            s3util.headObject(s3,{
                Bucket  : 'c6.dev.badBucket',
                Key     : makeKeyPath('test1.txt')
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toBeNull();
                        expect(err.code).toEqual('NotFound');
                        expect(err.statusCode).toEqual(404);
                        fin();
                    }
                );
        });

        it('should fail with a bad key',function(fin){
            s3util.headObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txtxx')
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toBeNull();
                        expect(err.code).toEqual('NotFound');
                        expect(err.statusCode).toEqual(404);
                        fin();
                    }
                );
        });

        it('should fail with a bad etag',function(fin){
            s3util.headObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt'),
                IfMatch : 'xyz'
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toBeNull();
                        expect(err.code).toEqual(412);
                        expect(err.statusCode).toEqual(412);
                        fin();
                    }
                );
        });

    });

    describe('getObject method',function(){

        afterEach(function(){
            fs.removeSync('tmp/test1_dl.txt');
        });

        it('should exist',function(){
            expect(s3util.getObject).toBeDefined();
        });

        it('should download a file',function(fin){
            s3util.getObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt')
            },'tmp/test1_dl.txt')
                .done(
                    function(data){
                        expect(data).toBeDefined();
                        expect(data.s3util.localFile).toEqual('tmp/test1_dl.txt');
                        expect(data.ETag).toEqual('"6d2286301265512f019781cc0ce7a39f"');
                        expect(fs.existsSync('tmp/test1_dl.txt')).toEqual(true);
                        fin();
                    },
                    function(err){
                        fin(err.message);
                    }
                );
        });

        it('should fail with a bad bucket',function(fin){
            s3util.getObject(s3,{
                Bucket  : 'c6.dev.badBucket',
                Key     : makeKeyPath('test1.txt')
            },'tmp/test1_dl.txt')
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('The specified bucket does not exist');
                        fin();
                    }
                );
        });

        it('should fail with a bad key',function(fin){
            s3util.getObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1xxx.txt')
            },'tmp/test1_dl.txt')
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('The specified key does not exist.');
                        fin();
                    }
                );
        });

        it('should fail with a bad Etag',function(fin){
            s3util.getObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt'),
                IfMatch : 'xxx'
            },'tmp/test1_dl.txt')
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('At least one of the pre-conditions you specified did not hold');
                        fin();
                    }
                );
        });
    });

    describe('deleteObject method',function(){

        beforeEach(function(){
            var done = false;
            q.all([ 
                s3util.putObject(s3,'tmp/test1.txt',{
                    Bucket  : bucket,
                    Key     : makeKeyPath('tmpKey/test1.txt')
                }),
                s3util.putObject(s3,'tmp/test1.txt',{
                    Bucket  : bucket,
                    Key     : makeKeyPath('tmpKey/test2.txt')
                })
            ])
                .done(
                    function(){
                        done = true;
                    },
                    function(err){
                        done = true;
                    }
                );
            waitsFor(function(){
                return done;
            });

        });

        it('should exist',function(){
            expect(s3util.deleteObject).toBeDefined();
        });
        
        it('should delete an object',function(fin){
            s3util.deleteObject(s3,{
                Bucket  : bucket,
                Key     : makeKeyPath('tmpKey')
            })
                .done(
                    function(data){
                        expect(data).toBeDefined();
                        s3util.getObject(s3,{
                            Bucket  : bucket,
                            Key     : makeKeyPath('tmpKey')
                        },'tmp/test1_dl.txt')
                            .done(
                                function(data){},
                                function(err){
                                    expect(err.message)
                                        .toEqual('The specified key does not exist.');
                                    fin();
                                }
                            );
                    },
                    function(err){
                        fin(err.message);
                    }
                );
        });

    });


});
