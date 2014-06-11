var flush = true;
describe('collateral (UT)', function() {
    var mockLog, uuid, logger, collateral, q, glob, phantom, handlebars, path, enums, Scope;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();

        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        s3util      = require('../../lib/s3util');
        path        = require('path');
        phantom     = require('phantom');
        glob        = require('glob');
        handlebars  = require('handlebars');
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
    
    describe('upload', function() {
        var s3, req, config, fileOpts;
        beforeEach(function() {
            req = { uuid: '1234', user: { id: 'u-1', org: 'o-1' } };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').andCallFake(function(params, cb) {
                    cb('that does not exist', null);
                })
            };
            config = { s3: { bucket: 'bkt' }, cacheControl: { default: 'max-age=15' } };
            fileOpts = { name: 'foo.txt', path: '/ut/foo.txt', type: 'text/plain' };
            spyOn(uuid, 'hashFile').andReturn(q('fakeHash'));
            spyOn(s3util, 'putObject').andReturn(q({ETag: '"qwer1234"'}));
        });
        
        it('should upload a file', function(done) {
            collateral.upload(req, 'ut/o-1', fileOpts, false, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/foo.txt', md5: 'qwer1234'});
                expect(uuid.hashFile).not.toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt',Key:'ut/o-1/foo.txt',ACL:'public-read',CacheControl:'max-age=15',ContentType:'text/plain'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should overwrite an existing file if versionate is false', function(done) {
            s3.headObject.andCallFake(function(params, cb) {
                cb(null, { ETag: '"qwer1234"' });
            });
            collateral.upload(req, 'ut/o-1', fileOpts, false, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/foo.txt', md5: 'qwer1234'});
                expect(s3util.putObject).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should versionate a file if versionate is true', function(done) {
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.foo.txt', md5: 'qwer1234'});
                expect(uuid.hashFile).toHaveBeenCalledWith('/ut/foo.txt');
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls[0].args[0]).toEqual({Bucket:'bkt', Key:'ut/o-1/fakeHash.foo.txt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt',Key:'ut/o-1/fakeHash.foo.txt',ACL:'public-read',CacheControl:'max-age=15',ContentType:'text/plain'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should set CacheControl to be max-age=0 if noCache is true', function(done) {
            req.query = { noCache: true };
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.foo.txt', md5: 'qwer1234'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt',Key:'ut/o-1/fakeHash.foo.txt',ACL:'public-read',CacheControl:'max-age=0',ContentType:'text/plain'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should skip uploading if versionate is true and the file exists', function(done) {
            s3.headObject.andCallFake(function(params, cb) {
                cb(null, { ETag: '"qwer1234"' });
            });
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.foo.txt', md5: 'qwer1234'});
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if hashing the file fails', function(done) {
            uuid.hashFile.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if uploading the file fails', function(done) {
            s3util.putObject.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('checkImageType', function() {
        var buff;
        beforeEach(function() {
            buff = new Buffer([]);
            spyOn(fs, 'readFile').andCallFake(function(fpath, cb) { cb(null, buff); });
        });
        
        it('should correctly identify jpeg images', function(done) {
            buff = new Buffer([0xff, 0xd8, 0xff, 0xf3, 0x12, 0x56, 0x83]);
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/jpeg');
                expect(fs.readFile).toHaveBeenCalledWith('fakePath', jasmine.any(Function));
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should correctly identify png images', function(done) {
            buff = new Buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x36, 0xf8]);
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/png');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should correctly identify gif images', function(done) {
            buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0xff, 0x34, 0x12]);
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/gif');
                buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0x34, 0x12]);
                return collateral.checkImageType('fakePath');
            }).then(function(type) {
                expect(type).toBe('image/gif');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should return false for invalid images', function(done) {
            var badBuffers = {
                'badJpeg':  new Buffer([0xff, 0xd8, 0xfe]),
                'badPng':   new Buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x01, 0x1a, 0x0a]),
                'badGif1':  new Buffer([0x42, 0x49, 0x46, 0x38, 0x39, 0x61]),
                'badGif2':  new Buffer([0x47, 0x49, 0x46, 0x38, 0x38, 0x61])
            };
            fs.readFile.andCallFake(function(fpath, cb) { cb(null, badBuffers[fpath]); });
            
            q.all(Object.keys(badBuffers).map(collateral.checkImageType)).then(function(results) {
                results.forEach(function(result) { expect(result).toBe(false); });
                expect(fs.readFile.calls[0].args).toEqual(['badJpeg', jasmine.any(Function)]);
                expect(fs.readFile.calls[1].args).toEqual(['badPng', jasmine.any(Function)]);
                expect(fs.readFile.calls[2].args).toEqual(['badGif1', jasmine.any(Function)]);
                expect(fs.readFile.calls[3].args).toEqual(['badGif2', jasmine.any(Function)]);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if reading the file fails', function(done) {
            fs.readFile.andCallFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                done();
            });
        });
    });
    
    describe('uploadFiles', function() {
        var s3, req, config;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                files: {
                    testFile: { size: 900, name: 'test', type: 'text/plain', path: '/tmp/123' }
                }
            };
            s3 = 'fakeS3';
            config = { maxFileSize: 1000, s3: { path: 'ut/' } };
            spyOn(fs, 'remove').andCallFake(function(path, cb) { cb(); });
            spyOn(collateral, 'upload').andReturn(q({key: '/path/on/s3', md5: 'qwer1234'}));
            spyOn(collateral, 'checkImageType').andReturn(q('image/jpeg'));
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
                expect(collateral.upload).not.toHaveBeenCalled();
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
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the file is not a supported image type', function(done) {
            collateral.checkImageType.andReturn(q(false));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(415);
                expect(resp.body).toEqual([{name: 'testFile', code: 415, error: 'Unsupported file type' }]);
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should upload a file successfully', function(done) {
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/o-1',
                    {size:900,name:'test',type:'image/jpeg',path:'/tmp/123'},false,'fakeS3',config);
                expect(collateral.checkImageType).toHaveBeenCalledWith('/tmp/123');
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls[0].args[0]).toBe('/tmp/123');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should upload to an experience folder if expId is defined', function(done) {
            req.params = { expId: 'e-1' };
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',req.files.testFile,false,'fakeS3',config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should versionate the file if instructed to', function(done) {
            req.query = { versionate: true };
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/o-1',req.files.testFile,true,'fakeS3',config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if uploading the file fails', function(done) {
            collateral.upload.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([{name: 'testFile', code: 500, error: 'I GOT A PROBLEM'}]);
                expect(collateral.upload).toHaveBeenCalled();
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
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalled();
                process.nextTick(function() {
                    expect(fs.remove).toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should handle multiple files', function(done) {
            req.files = {
                file1: { size: 1000, name: '1.txt', type: 'text/plain', path: '/tmp/1' },
                file2: { size: 1100, name: '2.txt', type: 'text/plain', path: '/tmp/2' },
                file3: { size: 1000, name: '3.txt', type: 'text/plain', path: '/tmp/3' }
            };
            collateral.upload.andCallFake(function(req, org, fileOpts, versionate, s3, config) {
                if (fileOpts.name === '3.txt') return q.reject('I GOT A PROBLEM');
                else return q({key: '/path/to/' + fileOpts.name, md5: 'qwer1234'});
            });

            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([
                    {name: 'file1', code: 201, path: '/path/to/1.txt'},
                    {name: 'file2', code: 413, error: 'File is too big'},
                    {name: 'file3', code: 500, error: 'I GOT A PROBLEM'}
                ]);
                expect(collateral.upload.calls.length).toBe(2);
                expect(fs.remove.calls.length).toBe(3);
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
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/o-2',req.files.testFile,false,'fakeS3',config);
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
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls[0].args[0]).toBe('/tmp/123');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe uploadFiles
    
    describe('chooseTemplateNum', function() {
        it('should correctly choose the template number', function() {
            var thumbNums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            expect(thumbNums.map(collateral.chooseTemplateNum)).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
        });
    });
    
    describe('generateSplash', function() {
        var page, phantObj, compilerSpy, req, imgSpec, s3, config, templDir, anyFunc;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                params: { expId: 'e-1' },
                body: { ratio:'foo', thumbs: ['http://image.jpg'] }
            };
            imgSpec = { height: 600, width: 600, ratio: 'foo' };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').andCallFake(function(params, cb) {
                    cb('not found', null);
                })
            };
            collateral.splashCache = {};
            config = {s3:{path:'ut/'},splash:{quality:75,maxDimension:1000,timeout:10000,cacheTTL:24*60}};
            templDir = path.join(__dirname, '../../splashTemplates');
            anyFunc = jasmine.any(Function);
            phantObj = {
                createPage: jasmine.createSpy('ph.createPage').andCallFake(function(cb) { cb(page); }),
                exit: jasmine.createSpy('ph.exit')
            };
            page = {
                set: jasmine.createSpy('page.set').andCallFake(function(prop,data,cb){ cb('i did it'); }),
                open: jasmine.createSpy('page.open').andCallFake(function(url,cb){ cb('success'); }),
                render: jasmine.createSpy('page.render').andCallFake(function(fpath,opts,cb){ cb('i did it'); }),
                close: jasmine.createSpy('page.close')
            };
            spyOn(uuid, 'createUuid').andReturn('fakeUuid');
            spyOn(glob, 'sync').andReturn(['template1', 'template2', 'etc']);
            spyOn(phantom, 'create').andCallFake(function(opts, cb) { cb(phantObj); });
            spyOn(fs, 'readFile').andCallFake(function(fpath, opts, cb) { cb(null, 'fakeTemplate'); });
            spyOn(fs, 'writeFile').andCallFake(function(fpath, data, cb) { cb(); });
            spyOn(fs, 'remove').andCallFake(function(fpath, cb) { cb(); });
            spyOn(collateral, 'chooseTemplateNum').andCallThrough();
            spyOn(collateral, 'upload').andReturn(q({key: '/path/on/s3', md5: 'qwer1234'}));
            compilerSpy = jasmine.createSpy('handlebars compiler').andReturn('compiledHtml');
            spyOn(handlebars, 'compile').andReturn(compilerSpy);
        });
    
        it('should reject if the imgSpec is incomplete', function(done) {
            var imgSpecs = [
                { width: 600, ratio: 'foo' },
                { height: 600, ratio: 'foo' },
                { height: 600, width: 600 }
            ];
            q.allSettled(imgSpecs.map(function(imgSpec) {
                return collateral.generateSplash(req, imgSpec, s3, config);
            })).then(function(resps) {
                resps.forEach(function(resp, index) {
                    expect(resp.state).toBe('rejected');
                    expect(resp.reason.name).toBe('splash');
                    expect(resp.reason.code).toBe(400);
                    expect(resp.reason.error).toBe('Must provide complete imgSpec');
                    if (index === 2) expect(resp.reason.ratio).toBe('');
                    else expect(resp.reason.ratio).toBe('foo');
                });
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject if the ratio name is invalid', function(done) {
            glob.sync.andReturn([]);
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:400,name:'splash',ratio:'foo',error:'Invalid ratio name'});
                expect(glob.sync).toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if either dimension is too large', function(done) {
            imgSpec.height = 2000;
            collateral.generateSplash(req, imgSpec, s3, config).catch(function(error) {
                expect(error).toEqual({code:400,name:'splash',ratio:'foo',error:'Requested image size is too large'});
                imgSpec.height = 400, imgSpec.width = 2000;
                return collateral.generateSplash(req, imgSpec, s3, config);
            }).catch(function(error) {
                expect(error).toEqual({code:400,name:'splash',ratio:'foo',error:'Requested image size is too large'});
                expect(glob.sync).not.toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully generate and upload a splash image', function(done) {
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(glob.sync).toHaveBeenCalledWith(path.join(templDir, 'foo*'));
                expect(collateral.chooseTemplateNum).toHaveBeenCalledWith(1);
                expect(fs.readFile).toHaveBeenCalledWith(path.join(templDir,'foo_x1.html'),{encoding: 'utf8'},anyFunc);
                expect(handlebars.compile).toHaveBeenCalledWith('fakeTemplate');
                expect(compilerSpy).toHaveBeenCalledWith({thumbs: ['http://image.jpg']});
                expect(fs.writeFile).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html','compiledHtml',anyFunc);
                expect(phantom.create).toHaveBeenCalledWith({onExit:anyFunc,onStderr:anyFunc},anyFunc);
                expect(phantObj.createPage).toHaveBeenCalledWith(anyFunc);
                expect(page.set).toHaveBeenCalledWith('viewportSize',{height:600,width:600},anyFunc);
                expect(page.open).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html', anyFunc);
                expect(page.render).toHaveBeenCalledWith('/tmp/fakeUuid-splash.jpg',{quality:75},anyFunc);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'splash',
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},false,s3,config);
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.length).toBe(2);
                    expect(fs.remove.calls[0].args).toEqual(['/tmp/fakeUuid-compiled.html',anyFunc]);
                    expect(fs.remove.calls[1].args).toEqual(['/tmp/fakeUuid-splash.jpg',anyFunc]);
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let a user specify the resulting filename', function(done) {
            imgSpec.name = 'brentRambo';
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'brentRambo',ratio:'foo',path:'/path/on/s3'});
                expect(page.render).toHaveBeenCalledWith('/tmp/fakeUuid-brentRambo.jpg',{quality:75},anyFunc);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'brentRambo',
                    path:'/tmp/fakeUuid-brentRambo.jpg',type:'image/jpeg'},false,s3,config);
                process.nextTick(function() {
                    expect(fs.remove.calls.length).toBe(2);
                    expect(fs.remove.calls[0].args).toEqual(['/tmp/fakeUuid-compiled.html',anyFunc]);
                    expect(fs.remove.calls[1].args).toEqual(['/tmp/fakeUuid-brentRambo.jpg',anyFunc]);
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should versionate the file if configured to', function(done) {
            req.query = {versionate: true};
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'splash',
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},true,s3,config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if reading the template file fails', function(done) {
            fs.readFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if writing the compiled html fails', function(done) {
            fs.writeFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.readFile).toHaveBeenCalled();
                expect(handlebars.compile).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if uploading the splash image fails', function(done) {
            collateral.upload.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.render).toHaveBeenCalled();
                expect(collateral.upload).toHaveBeenCalled();
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.length).toBe(2);
                    expect(fs.remove.calls[0].args).toEqual(['/tmp/fakeUuid-compiled.html',anyFunc]);
                    expect(fs.remove.calls[1].args).toEqual(['/tmp/fakeUuid-splash.jpg',anyFunc]);
                    done();
                });
            });
        });
        
        it('should fail if opening the page with phantom fails', function(done) {
            page.open.andCallFake(function(url, cb) { cb('fail'); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',
                    error:'Failed to open /tmp/fakeUuid-compiled.html: status was fail'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if phantom quits prematurely', function(done) {
            var handlers;
            phantom.create.andCallFake(function(opts, cb) {
                handlers = opts;
                cb(phantObj);
            });
            page.open.andCallFake(function(url, cb) {
                handlers.onExit(1, 'PROBLEMS');
                cb('success');
            });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',error:new Error('PhantomJS exited prematurely')});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should just log a warning if phantom logs error messages', function(done) {
            var handlers;
            phantom.create.andCallFake(function(opts, cb) {
                handlers = opts;
                cb(phantObj);
            });
            page.open.andCallFake(function(url, cb) {
                handlers.onStderr('I THINK I GOT A PROBLEM');
                cb('success');
            });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(collateral.upload).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        xit('should timeout if any part of the process takes too long', function(done) { //TODO this will work for collateral.generate
            page.open.andCallFake(function(url, cb) {
                setTimeout(function() { cb('success'); }, 12*1000);
            });
            
            // var promise = collateral.generateSplash(req, imgSpec, s3, config);
            var promise = collateral.generate(req, imgSpec, 'fakeTemplate', 'fakeHash', s3, config);
            
            promise.then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                console.log(error);
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',
                    error:new Error('Timed out after 10000 ms')});
                expect(mockLog.error).toHaveBeenCalled();
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });

            jasmine.Clock.tick(11*1000);
        });
    });  // end -- describe generateSplash
    
    describe('createSplashes', function() {
        var req, s3, config;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                params: { expId: 'e-1' },
                body: {
                    imageSpecs: [{ height: 600, width: 600, ratio: 'foo' }],
                    thumbs: ['http://image.jpg']
                }
            };
            s3 = 'fakeS3';
            config = {s3:{path:'ut/'}, splash:{quality:75, maxDimension:1000, timeout:10000}};
            spyOn(collateral, 'generateSplash').andReturn(q(
                { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
            ));
        });
        
        it('should return a 400 if no thumbs are provided', function(done) {
            delete req.body.thumbs;
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide thumbs to create splashes from'});
                req.body.thumbs = [];
                return collateral.createSplashes(req, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide thumbs to create splashes from'});
                expect(collateral.generateSplash).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 400 if no imgSpecs are provided', function(done) {
            delete req.body.imageSpecs;
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide imageSpecs to create splashes for'});
                req.body.imageSpecs = [];
                return collateral.createSplashes(req, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide imageSpecs to create splashes for'});
                expect(collateral.generateSplash).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully call generateSplash', function(done) {
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should properly handle protocol-relative urls', function(done) {
            req.body.thumbs = ['//image.png'];
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
                expect(req.body.thumbs).toEqual(['http://image.png']);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should handle multiple imgSpecs', function(done) {
            req.body.imageSpecs = [
                { name: 'splash1', height: 600, width: 600, ratio: 'a' },
                { name: 'splash2', height: 600, width: 600, ratio: 'b' },
                { name: 'splash3', height: 600, width: 600, ratio: 'c' }
            ];
            collateral.generateSplash.andCallFake(function(req, imgSpec, s3, config) {
                switch(imgSpec.name) {
                    case 'splash1':
                        return q.reject({code: 400, ratio: imgSpec.ratio, name: 'splash1', error: 'YOU GOT A PROBLEM'})
                        break;
                    case 'splash2':
                        return q.reject({code: 500, ratio: imgSpec.ratio, name: 'splash2', error: 'I GOT A PROBLEM'})
                        break;
                    case 'splash3':
                        return q({code: 201, ratio: imgSpec.ratio, name: 'splash3', path: '/path/on/s3'})
                        break;
                }
            });

            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: [
                    { code: 400, ratio: 'a', name: 'splash1', error: 'YOU GOT A PROBLEM'},
                    { code: 500, ratio: 'b', name: 'splash2', error: 'I GOT A PROBLEM'},
                    { code: 201, ratio: 'c', name: 'splash3', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash.calls.length).toBe(3);
                expect(collateral.generateSplash.calls[0].args).toEqual([req,req.body.imageSpecs[0],s3,config]);
                expect(collateral.generateSplash.calls[1].args).toEqual([req,req.body.imageSpecs[1],s3,config]);
                expect(collateral.generateSplash.calls[2].args).toEqual([req,req.body.imageSpecs[2],s3,config]);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe createSplashes
});  // end -- describe collateral

