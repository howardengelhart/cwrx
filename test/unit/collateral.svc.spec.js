var flush = true;
describe('collateral (UT)', function() {
    var mockLog, uuid, logger, collateral, q, enums, Scope;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        s3util      = require('../../lib/s3util');
        fs          = require('fs-extra');
        collateral  = require('../../bin/collateral');
        q           = require('q');
        enums       = require('../../lib/enums');
        Scope       = enums.Scope;
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
    });
    
    describe('uploadFiles', function() {
        var s3, req, config;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                files: {
                    testFile: { size: 900, name: 'test.txt', type: 'text/plain', path: '/tmp/123' }
                }
            };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').andCallFake(function(params, cb) {
                    cb('that does not exist', null);
                })
            };
            config = {
                maxFileSize: 1000,
                s3: {
                    bucket: 'bkt',
                    path: 'ut/'
                }
            };
            spyOn(uuid, 'hashFile').andReturn(q('fakeHash'));
            spyOn(s3util, 'putObject').andReturn(q('success'));
            spyOn(fs, 'remove').andCallFake(function(path, cb) { cb(); });
        });
        
        it('should fail with a 400 if no files are provided', function(done) {
            delete req.files;
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide files to upload');
                req.files = {};
                return collateral.uploadFiles(req, s3, config);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide files to upload');
                expect(uuid.hashFile).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if a file is too large', function(done) {
            req.files.testFile.size = 1100;
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(413);
                expect(resp.body).toEqual([{name: 'testFile', code: 413, error: 'File is too big' }]);
                expect(uuid.hashFile).not.toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should upload a file successfully', function(done) {
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'ut/o-1/fakeHash.test.txt'}]);
                expect(uuid.hashFile).toHaveBeenCalledWith('/tmp/123');
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls[0].args[0]).toEqual({Key:'ut/o-1/fakeHash.test.txt',Bucket:'bkt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/tmp/123',
                    {Bucket:'bkt',Key:'ut/o-1/fakeHash.test.txt',ACL:'public-read',ContentType:'text/plain'});
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls[0].args[0]).toBe('/tmp/123');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not upload a file if it already exists', function(done) {
            s3.headObject.andCallFake(function(params, cb) { cb(null, 'that does exist'); });
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'ut/o-1/fakeHash.test.txt'}]);
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if hashing the file fails', function(done) {
            uuid.hashFile.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([{name: 'testFile', code: 500, error: 'I GOT A PROBLEM'}]);
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if uploading the file fails', function(done) {
            s3util.putObject.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([{name: 'testFile', code: 500, error: 'I GOT A PROBLEM'}]);
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should just log a warning if deleting the temp file fails', function(done) {
            fs.remove.andCallFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'ut/o-1/fakeHash.test.txt'}]);
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should handle multiple files', function(done) {
            req.files = {
                file1: { size: 1000, name: '1.txt', type: 'text/plain', path: '/tmp/1' },
                file2: { size: 1100, name: '2.txt', type: 'text/plain', path: '/tmp/2' },
                file3: { size: 1000, name: '3.txt', type: 'text/plain', path: '/tmp/3' },
                file4: { size: 1000, name: '4.txt', type: 'text/plain', path: '/tmp/4' }
            };
            s3.headObject.andCallFake(function(params, cb) {
                if (params.Key.match('3.txt')) cb(null, 'this exists');
                else cb('this does not exist', null);
            });
            s3util.putObject.andCallFake(function(s3, fpath, params) {
                if (params.Key.match('4.txt')) return q.reject('I GOT A PROBLEM');
                else return q('everything is ok');
            });

            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([
                    {name: 'file1', code: 201, path: 'ut/o-1/fakeHash.1.txt'},
                    {name: 'file2', code: 413, error: 'File is too big'},
                    {name: 'file3', code: 201, path: 'ut/o-1/fakeHash.3.txt'},
                    {name: 'file4', code: 500, error: 'I GOT A PROBLEM'}
                ]);
                expect(uuid.hashFile.calls.length).toBe(3);
                expect(s3.headObject.calls.length).toBe(3);
                expect(s3util.putObject.calls.length).toBe(2);
                expect(fs.remove.calls.length).toBe(4);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should allow uploads to other orgs if the user is an admin', function(done) {
            req.query = { org: 'o-2' };
            req.user.permissions = { experiences: { edit: Scope.All } };
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'ut/o-2/fakeHash.test.txt'}]);
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls[0].args[0]).toEqual({Key:'ut/o-2/fakeHash.test.txt',Bucket:'bkt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/tmp/123',
                    {Bucket:'bkt',Key:'ut/o-2/fakeHash.test.txt',ACL:'public-read',ContentType:'text/plain'});
                expect(fs.remove).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent uploads to other orgs if the user is not an admin', function(done) {
            req.query = { org: 'o-2' };
            req.user.permissions = { experiences: { edit: Scope.Org } };
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Cannot upload files to that org');
                expect(uuid.hashFile).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls[0].args[0]).toBe('/tmp/123');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe uploadFiles
});  // end -- describe collateral

