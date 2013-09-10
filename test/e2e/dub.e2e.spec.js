var path    = require('path'),
    fs      = require('fs-extra'),
    dub     = require('../../bin/dub');

describe("dub", function() {
    it('should successfully create and upload a test video', function() {
        var program = {config: "dub_e2e_test.json", "enableAws": true},
            config = dub.createConfiguration(program),
            job = dub.createDubJob(dub.loadTemplateFromFile("template.json"),config);
        
        config.ensurePaths();        
        
        expect(config).toBeDefined();
        expect(job).toBeDefined();
        expect(job.outputType).toBe("s3");

        var handleReqFlag = false, s3HeadFlag = false;

        runs(function() {
            dub.handleRequest(job, function(err, finishedJob) {
                expect(err).toBeNull();
                handleReqFlag = true;
            });
        });
        waitsFor(function() { return handleReqFlag; }, "handleRequest took too long", 30000);
        runs(function() {
            expect(job.outputETag).toBeDefined();
            expect(job.s3).toBeDefined();
            if (job.s3 && job.outputETag) {
                params = job.getS3RefParams();
                job.s3.headObject(params, function(err, data) {
                    expect(err).toBeNull();
                    expect(data).toBeDefined();
                    expect(job.outputETag).toEqual(data['ETag']);
                    // TODO: also check the MD5 of the local video?
                    s3HeadFlag = true;
                });
            }
        });
        waitsFor(function() {return s3HeadFlag; }, "S3 Head of reference video took too long", 15000);
        runs(function() {
            Object.keys(config.caches).forEach(function(removable){
                if (fs.existsSync(config.caches[removable])){
                    fs.removeSync(config.caches[removable]);
                }
            });
        });
    });
});
