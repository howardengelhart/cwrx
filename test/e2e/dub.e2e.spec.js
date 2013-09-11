var path    = require('path'),
    fs      = require('fs-extra'),
    dub     = require('../../bin/dub'),
    crypto  = require('crypto');

describe("dub", function() {
    var program = {config: "dub_e2e_test.json", "enableAws": true},
        config = dub.createConfiguration(program),
        job = dub.createDubJob(dub.loadTemplateFromFile("template.json"),config);

    it('should successfully create and upload a test video', function() {
        
        config.ensurePaths();        
        
        expect(config).toBeDefined();
        expect(job).toBeDefined();
        expect(job.outputType).toBe("s3");

        var handleReqFlag = false;

        runs(function() {
            dub.handleRequest(job, function(err, finishedJob) {
                expect(err).toBeNull();
                handleReqFlag = true;
            });
        });
        waitsFor(function() { return handleReqFlag; }, "handleRequest took too long", 30000);
    });

    it('should have created a video that exactly matches the reference video', function() {
        
        var s3HeadFlag = false;

        runs(function() {
            expect(job.outputETag).toBeDefined();
            expect(job.s3).toBeDefined();
            if (job.s3 && job.outputETag) {
                var params = job.getS3RefParams();
                job.s3.headObject(params, function(err, data) {
                    expect(err).toBeNull();
                    expect(data).toBeDefined();
                    expect(job.outputETag).toEqual(data['ETag']);
                    
                    var localVid = fs.readFileSync(job.outputPath);
                    var hash = crypto.createHash('md5');
                    hash.update(localVid);
                    expect(hash.digest('hex')).toEqual(data['ETag'].replace(/"/g, ''));

                    s3HeadFlag = true;
                });
            }
        });
        waitsFor(function() {return s3HeadFlag; }, "S3 getHead of reference video took too long", 15000);
    });

    it('test should clean up after itself', function() {

        var s3DeleteFlag = false;

        runs(function() {
            Object.keys(config.caches).forEach(function(removable){
                if (fs.existsSync(config.caches[removable])){
                    fs.removeSync(config.caches[removable]);
                }
            });
            var outParams = job.getS3OutVideoParams();
            var delParams = {Key: outParams.Key, Bucket: outParams.Bucket};
            if (!job.s3) {
                s3DeleteFlag = true;
                return;
            }
            job.s3.deleteObject(delParams, function(err, data) {
                expect(err).toBeNull();
                expect(data).toBeDefined();
                s3DeleteFlag = true;
            });
        });
        waitsFor(function() {return s3DeleteFlag;}, "S3 Delete took too long", 15000);
    });
});


