var path      = require('path'),
    fs        = require('fs-extra'),
    s3util    = require('../../lib/s3util'),
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
    var keyBase, bucket, s3;

    beforeEach(function(){
        fs.mkdirsSync('tmp');
        fs.outputFileSync('tmp/test1.txt','abcdefghijklmnopqrstuvwxyz0123456789');
        bucket      = 'c6.dev';
        if (!s3){
            // aws.config.loadFromPath(path.join(process.env.HOME,'.aws.ut.json'));
            aws.config.loadFromPath(path.join(process.env.HOME,'.aws.json'));
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

    describe('getObject method',function(){

        afterEach(function(){
            fs.removeSync('tmp/test1_dl.txt');
        });

        it('should exist',function(){
            expect(s3util.getObject).toBeDefined();
        });

        it('should download a file',function(fin){
            s3util.getObject(s3,'tmp/test1_dl.txt',{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt')
            })
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
            s3util.getObject(s3,'tmp/test1_dl.txt',{
                Bucket  : 'c6.dev.badBucket',
                Key     : makeKeyPath('test1.txt')
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('The specified bucket does not exist');
                        fin();
                    }
                );
        });

        it('should fail with a bad key',function(fin){
            s3util.getObject(s3,'tmp/test1_dl.txt',{
                Bucket  : bucket,
                Key     : makeKeyPath('test1xxx.txt')
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('The specified key does not exist.');
                        fin();
                    }
                );
        });

        it('should fail with a bad Etag',function(fin){
            s3util.getObject(s3,'tmp/test1_dl.txt',{
                Bucket  : bucket,
                Key     : makeKeyPath('test1.txt'),
                IfMatch : 'xxx'
            })
                .done(
                    function(data){},
                    function(err){
                        expect(err.message).toEqual('At least one of the pre-conditions you specified did not hold');
                        fin();
                    }
                );
        });
    });
});
