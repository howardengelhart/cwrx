var flush = true;
describe('collateral (UT)', function() {
    var mockLog, uuid, logger, collateral, q, glob, phantom, handlebars, path, enums, Scope;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
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
            config = { s3: { bucket: 'bkt' } };
            fileOpts = { name: 'foo.txt', path: '/ut/foo.txt', type: 'text/plain' };
            spyOn(uuid, 'hashFile').andReturn(q('fakeHash'));
            spyOn(s3util, 'putObject').andReturn(q('success'));
        });
        
        it('should upload a file', function(done) {
            collateral.upload(req, 'ut/o-1', fileOpts, false, s3, config).then(function(key) {
                expect(key).toBe('ut/o-1/foo.txt');
                expect(uuid.hashFile).not.toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt', Key:'ut/o-1/foo.txt', ACL:'public-read', ContentType:'text/plain'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should overwrite an existing file if versionate is false', function(done) {
            s3.headObject.andCallFake(function(params, cb) {
                cb(null, 'that file exists yo');
            });
            collateral.upload(req, 'ut/o-1', fileOpts, false, s3, config).then(function(key) {
                expect(key).toBe('ut/o-1/foo.txt');
                expect(s3util.putObject).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should versionate a file if versionate is true', function(done) {
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(key) {
                expect(key).toBe('ut/o-1/fakeHash.foo.txt');
                expect(uuid.hashFile).toHaveBeenCalledWith('/ut/foo.txt');
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls[0].args[0]).toEqual({Bucket:'bkt', Key:'ut/o-1/fakeHash.foo.txt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt', Key:'ut/o-1/fakeHash.foo.txt', ACL:'public-read', ContentType:'text/plain'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should skip uploading if versionate is true and the file exists', function(done) {
            s3.headObject.andCallFake(function(params, cb) {
                cb(null, 'that file exists yo');
            });
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(key) {
                expect(key).toBe('ut/o-1/fakeHash.foo.txt');
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
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(key) {
                expect(key).not.toBeDefined();
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
            collateral.upload(req, 'ut/o-1', fileOpts, true, s3, config).then(function(key) {
                expect(key).not.toBeDefined();
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
            s3 = 'fakeS3';
            config = { maxFileSize: 1000, s3: { path: 'ut/' } };
            spyOn(fs, 'remove').andCallFake(function(path, cb) { cb(); });
            spyOn(collateral, 'upload').andReturn(q('/path/on/s3'));
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
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/o-1',req.files.testFile,false,'fakeS3',config);
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
                file3: { size: 1000, name: '3.txt', type: 'text/plain', path: '/tmp/3' }
            };
            collateral.upload.andCallFake(function(req, org, fileOpts, versionate, s3, config) {
                if (fileOpts.name === '3.txt') return q.reject('I GOT A PROBLEM');
                else return q('/path/to/' + fileOpts.name);
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
            expect(thumbNums.map(collateral.chooseTemplateNum)).toEqual([1, 2, 3, 4, 4, 6, 6, 6, 6]);
        });
    });
    
    describe('generateSplash', function() {
        var page, phantObj, compilerSpy, req, s3, config, templDir, anyFunc;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                params: { expId: 'e-1' },
                body: {
                    ratio:'foo', size:{height:600, width:600}, thumbs:['http://image.jpg'], published:true
                }
            };
            s3 = 'fakeS3';
            config = { s3: { path: 'ut/' }, splashQuality: 75 };
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
            spyOn(glob, 'sync').andReturn(['template1', 'template2', 'etc']);
            spyOn(phantom, 'create').andCallFake(function(opts, cb) { cb(phantObj); });
            spyOn(fs, 'readFile').andCallFake(function(fpath, opts, cb) { cb(null, 'fakeTemplate'); });
            spyOn(fs, 'writeFile').andCallFake(function(fpath, data, cb) { cb(); });
            spyOn(fs, 'remove').andCallFake(function(fpath, cb) { cb(); });
            spyOn(collateral, 'chooseTemplateNum').andCallThrough();
            spyOn(collateral, 'upload').andReturn('/path/on/s3');
            compilerSpy = jasmine.createSpy('handlebars compiler').andReturn('compiledHtml');
            spyOn(handlebars, 'compile').andReturn(compilerSpy);
        });
    
        it('should reject if the request body is incomplete', function(done) {
            q.all([
                collateral.generateSplash({}, s3, config),
                collateral.generateSplash({body:{ratio:'foo',size:{height:600,width:600}}},s3,config),
                collateral.generateSplash({body:{ratio:'foo',size:{height:600,width:600},thumbs:[]}},s3,config),
            ]).then(function(resps) {
                resps.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Must provide thumbs to create splash from');
                });
                return q.all([
                    collateral.generateSplash({body:{ratio:'foo',thumbs:['foo']}},s3,config),
                    collateral.generateSplash({body:{ratio:'foo',size:{},thumbs:['foo']}},s3,config),
                    collateral.generateSplash({body:{ratio:'foo',size:{height:600},thumbs:['foo']}},s3,config),
                    collateral.generateSplash({body:{ratio:'foo',size:{width:600},thumbs:['foo']}},s3,config),
                ]);
            }).then(function(resps) {
                resps.forEach(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Must provide size object with width + height');
                });
                return collateral.generateSplash({body:{size:{height:600,width:600},thumbs:['foo']}},s3,config);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide ratio name to choose template');
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
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Invalid ratio name');
                expect(glob.sync).toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully generate and upload a splash image', function(done) {
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toBe('/path/on/s3');
                expect(glob.sync).toHaveBeenCalledWith(path.join(templDir, 'foo*'));
                expect(collateral.chooseTemplateNum).toHaveBeenCalledWith(1);
                expect(fs.readFile).toHaveBeenCalledWith(path.join(templDir,'foo_x1.html'),{encoding: 'utf8'},anyFunc);
                expect(handlebars.compile).toHaveBeenCalledWith('fakeTemplate');
                expect(compilerSpy).toHaveBeenCalledWith({thumbs: ['http://image.jpg']});
                expect(fs.writeFile).toHaveBeenCalledWith('/tmp/e-1-compiled.html','compiledHtml',anyFunc);
                expect(phantom.create).toHaveBeenCalledWith({onExit:anyFunc,onStderr:anyFunc},anyFunc);
                expect(phantObj.createPage).toHaveBeenCalledWith(anyFunc);
                expect(page.set).toHaveBeenCalledWith('viewportSize',{height:600,width:600},anyFunc);
                expect(page.open).toHaveBeenCalledWith('/tmp/e-1-compiled.html', anyFunc);
                expect(page.render).toHaveBeenCalledWith('/tmp/e-1-splash.jpg',{quality:75},anyFunc);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/e-1',{name:'e-1-splash.jpg',
                    path:'/tmp/e-1-splash.jpg',type:'image/jpeg'},true,'fakeS3',config);
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.length).toBe(2);
                    expect(fs.remove.calls[0].args).toEqual(['/tmp/e-1-compiled.html',anyFunc]);
                    expect(fs.remove.calls[1].args).toEqual(['/tmp/e-1-splash.jpg',anyFunc]);
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if reading the template file fails', function(done) {
            fs.readFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if writing the compiled html fails', function(done) {
            fs.writeFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
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
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.render).toHaveBeenCalled();
                expect(collateral.upload).toHaveBeenCalled();
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.length).toBe(2);
                    expect(fs.remove.calls[0].args).toEqual(['/tmp/e-1-compiled.html',anyFunc]);
                    expect(fs.remove.calls[1].args).toEqual(['/tmp/e-1-splash.jpg',anyFunc]);
                    done();
                });
            });
        });
        
        it('should fail if opening the page with phantom fails', function(done) {
            page.open.andCallFake(function(url, cb) { cb('fail'); });
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Failed to open /tmp/e-1-compiled.html: status was fail');
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
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('PhantomJS exited prematurely');
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
            collateral.generateSplash(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toBe('/path/on/s3');
                expect(collateral.upload).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });  // end -- describe generateSplash
});  // end -- describe collateral

