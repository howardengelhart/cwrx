var flush = true;
describe('collateral (UT):', function() {
    var mockLog, uuid, logger, collateral, q, glob, phantom, handlebars, path, enums, Scope, anyFunc, os;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();

        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        s3util      = require('../../lib/s3util');
        os          = require('os');
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
        spyOn(os,'tmpdir').andReturn('/tmp');
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        anyFunc = jasmine.any(Function);
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

    describe('clearOldCachedMD5s', function() {
        var config;
        beforeEach(function() {
            config = { splash: { cacheTTL: 5*1000, maxCacheKeys: 30000 } };
            collateral.splashCache = {
                a: { md5: '1', date: new Date(new Date() - 3*1000) },
                b: { md5: '2', date: new Date() },
                c: { md5: '3', date: new Date(new Date() - 6*1000) },
                d: { md5: '4', date: new Date(new Date() - 1*1000) },
            };
        });
        
        it('should clear old items from the splashCache', function() {
            collateral.clearOldCachedMD5s(config);
            expect(Object.keys(collateral.splashCache)).toEqual(['a', 'b', 'd']);
            config.splash.cacheTTL = 2*1000;
            collateral.clearOldCachedMD5s(config);
            expect(Object.keys(collateral.splashCache)).toEqual(['b', 'd']);
        });
        
        it('should delete the oldest items if there are too many items in the cache', function() {
            config.splash.maxCacheKeys = 1;
            collateral.clearOldCachedMD5s(config);
            expect(Object.keys(collateral.splashCache)).toEqual(['b']);
        });
        
        it('should handle an empty splashCache', function() {
            collateral.splashCache = {};
            collateral.clearOldCachedMD5s(config);
            expect(collateral.splashCache).toEqual({});
            config.splash.maxCacheKeys = -1;
            collateral.clearOldCachedMD5s(config);
            expect(collateral.splashCache).toEqual({});
        });
    });
    
    describe('chooseTemplateNum', function() {
        it('should correctly choose the template number', function() {
            var thumbNums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            expect(thumbNums.map(collateral.chooseTemplateNum)).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
        });
    });
    
    describe('generate', function() {
        var page, phantObj, compilerSpy, req, imgSpec, s3, config, templDir;
        beforeEach(function() {
            req = {
                uuid: '1234',
                params: { expId: 'e-1' },
                body: { ratio:'foo', thumbs: ['http://image.jpg'] }
            };
            imgSpec = { height: 600, width: 600, ratio: 'foo' };
            s3 = 'fakeS3';
            collateral.splashCache = {};
            config = {s3:{path:'ut/'},splash:{quality:75,maxDimension:1000,timeout:10000,cacheTTL:24*60}};
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
            spyOn(phantom, 'create').andCallFake(function(opts, cb) { cb(phantObj); });
            spyOn(fs, 'writeFile').andCallFake(function(fpath, data, cb) { cb(); });
            spyOn(fs, 'remove').andCallFake(function(fpath, cb) { cb(); });
            spyOn(collateral, 'chooseTemplateNum').andCallThrough();
            spyOn(collateral, 'upload').andReturn(q({key: '/path/on/s3', md5: 'qwer1234'}));
            compilerSpy = jasmine.createSpy('handlebars compiler').andReturn('compiledHtml');
            spyOn(handlebars, 'compile').andReturn(compilerSpy);
        });
                
        it('should successfully generate and upload a splash image', function(done) {
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toBe('/path/on/s3');
                expect(fs.writeFile).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html','compiledHtml',anyFunc);
                expect(phantom.create).toHaveBeenCalledWith({onExit:anyFunc,onStderr:anyFunc},anyFunc);
                expect(phantObj.createPage).toHaveBeenCalledWith(anyFunc);
                expect(page.set).toHaveBeenCalledWith('viewportSize',{height:600,width:600},anyFunc);
                expect(page.open).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html', anyFunc);
                expect(page.render).toHaveBeenCalledWith('/tmp/fakeUuid-splash.jpg',{quality:75},anyFunc);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'splash',
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},false,s3,config);
                expect(collateral.splashCache.fakeHash).toEqual({md5:'qwer1234',date:jasmine.any(Date)});
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
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toEqual('/path/on/s3');
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
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toEqual('/path/on/s3');
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'splash',
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},true,s3,config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if writing the compiled html fails', function(done) {
            fs.writeFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(handlebars.compile).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(collateral.splashCache.fakeHash).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if uploading the splash image fails', function(done) {
            collateral.upload.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.render).toHaveBeenCalled();
                expect(collateral.upload).toHaveBeenCalled();
                expect(collateral.splashCache.fakeHash).not.toBeDefined();
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
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual('Failed to open /tmp/fakeUuid-compiled.html: status was fail');
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
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('PhantomJS exited prematurely');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
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
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toEqual('/path/on/s3');
                expect(collateral.upload).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should timeout if any part of the process takes too long', function(done) {
            page.open.andCallFake(function(url, cb) {
                setTimeout(function() { cb('success'); }, 12*1000);
            });
            
            var promise = collateral.generate(req, imgSpec, 'fakeTemplate', 'fakeHash', s3, config);
            jasmine.Clock.tick(11*1000);
            promise.then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Timed out after 10000 ms'));
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
    });  // end -- describe generate
    
    describe('generateSplash', function() {
        var req, imgSpec, s3, config, templDir;
        beforeEach(function() {
            req = {uuid:'1234',params:{expId:'e-1'},body:{ratio:'foo',thumbs:['http://image.jpg']}};
            imgSpec = { height: 600, width: 600, ratio: 'foo' };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').andCallFake(function(params, cb) {
                    cb('not found', null);
                })
            };
            collateral.splashCache = {};
            config = { s3: { path: 'ut/', bucket: 'bkt' },
                       splash: { quality: 75, maxDimension: 1000, timeout: 10000, cacheTTL: 24*60 } };
            templDir = path.join(__dirname, '../../templates/splashTemplates');
            spyOn(glob, 'sync').andReturn(['template1', 'template2', 'etc']);
            spyOn(fs, 'readFile').andCallFake(function(fpath, opts, cb) { cb(null, 'fakeTemplate'); });
            spyOn(uuid, 'hashText').andReturn('fakeHash');
            spyOn(collateral, 'chooseTemplateNum').andCallThrough();
            spyOn(collateral, 'generate').andReturn(q('/path/on/s3'));
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
                expect(collateral.generate).not.toHaveBeenCalled();
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
                expect(collateral.generate).not.toHaveBeenCalled();
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
                expect(collateral.generate).not.toHaveBeenCalled();
                done();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully call collateral.generate', function(done) {
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(glob.sync).toHaveBeenCalledWith(path.join(templDir, 'foo*'));
                expect(collateral.chooseTemplateNum).toHaveBeenCalledWith(1);
                expect(fs.readFile).toHaveBeenCalledWith(path.join(templDir,'foo_x1.html'),{encoding: 'utf8'},anyFunc);
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should regenerate the splash if there is a cached md5 but no file on s3', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/e-1/splash'},anyFunc);
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
                req.query = {versionate: true};
                return collateral.generateSplash(req, imgSpec, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject.calls[1].args).toEqual([{Bucket:'bkt',Key:'ut/e-1/qwer1234.splash'},anyFunc]);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should regenerate the splash if there is a file on s3 with the wrong md5', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            s3.headObject.andCallFake(function(params, cb) { cb(null, {ETag: '"qwer5678"'}); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/e-1/splash'},anyFunc);
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not regenerate the splash if the correct file is on s3', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            s3.headObject.andCallFake(function(params, cb) { cb(null, {ETag: '"qwer1234"'}); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,name:'splash',ratio:'foo',path:'ut/e-1/splash'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/e-1/splash'},anyFunc);
                expect(collateral.generate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
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
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateral.generate).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if collateral.generate fails', function(done) {
            collateral.generate.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual({code:500,name:'splash',ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.readFile).toHaveBeenCalled();
                expect(collateral.generate).toHaveBeenCalled();
                done();
            });
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
        
        it('should switch https urls to http', function(done) {
            req.body.thumbs = ['https://1.png', 'http://2.png', 'https://3.png'];
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
                expect(req.body.thumbs).toEqual(['http://1.png', 'http://2.png', 'http://3.png']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not switch protocols for yahoo urls', function(done) {
            req.body.thumbs = ['https://s.yimg.com/foo.png', 'https://img.com/foo.png'];
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
                expect(req.body.thumbs).toEqual(['https://s.yimg.com/foo.png', 'http://img.com/foo.png']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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

    describe('setHeaders', function() {
        var req, s3, config;
        beforeEach(function() {
            req = { uuid: '1234', user: {id: 'u-1'}, body: {path: 'ut/foo.txt', 'max-age': 100} };
            config = { s3: { bucket: 'bkt' }, cacheControl: { default: 'max-age=15' } };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').andCallFake(function(params, cb) {
                    cb(null, { ContentType: 'text/plain' });
                }),
                copyObject: jasmine.createSpy('s3.copyObject').andCallFake(function(params, cb) {
                    cb(null, 'i did it yo');
                })
            };
        });
        
        it('should reject if there is no path in the request body', function(done) {
            delete req.body.path;
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide path of file on s3'});
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3.copyObject).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully copy the file to set the headers on it', function(done) {
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, anyFunc);
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=100',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'}
                , anyFunc);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should use a default CacheControl if not defined in the request', function(done) {
            delete req.body['max-age'];
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, anyFunc);
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=15',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'}
                , anyFunc);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let a user set the CacheControl to 0', function(done) {
            req.body['max-age'] = 0;
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, anyFunc);
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=0',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'}
                , anyFunc);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if headObject has an error or returns no data', function(done) {
            var files = ['ut/1.txt', 'ut/2.txt', 'ut/3.txt'];
            s3.headObject.andCallFake(function(params, cb) {
                if (params.Key === 'ut/1.txt') cb('GOT A PROBLEM', 'foo');
                if (params.Key === 'ut/2.txt') cb(null, null);
                else cb(null, { foo: 'bar' });
            });
            q.all(files.map(function(file) {
                req.body.path = file;
                return collateral.setHeaders(req, s3, config);
            })).then(function(results) {
                results.forEach(function(resp, index) {
                    expect(resp).toEqual({code: 404, body: 'File not found'});
                    expect(s3.headObject.calls[index].args[0].Key).toBe('ut/' + (index + 1) + '.txt');
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.copyObject).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject if copyObject has an error', function(done) {
            s3.copyObject.andCallFake(function(params, cb) { cb('I GOT A PROBLEM'); });
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.copyObject).toHaveBeenCalled();
                done();
            });
        });
    });  // end -- describe setHeaders
});  // end -- describe collateral
