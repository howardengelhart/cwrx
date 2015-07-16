var flush = true;
describe('collateral (UT):', function() {
    var mockLog, uuid, logger, collateral, q, glob, phantom, handlebars, path, enums, Scope, anyFunc, os;
    var request;
    var EventEmitter;
    var Promise;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();

        EventEmitter= require('events').EventEmitter;
        request     = require('request-promise');
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
        Promise     = q.Promise;
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
            config = { s3: { bucket: 'bkt' }, cacheControl: { default: 'max-age=31556926' } };
            fileOpts = { name: 'foo.txt', path: '/ut/foo.txt', type: 'text/plain' };
            spyOn(uuid, 'hashFile').andReturn(q('fakeHash'));
            spyOn(s3util, 'putObject').andReturn(q({ETag: '"qwer1234"'}));
        });
        
        it('should upload a file', function(done) {
            collateral.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.txt', md5: 'qwer1234'});
                expect(uuid.hashFile).toHaveBeenCalledWith('/ut/foo.txt');
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls[0].args[0]).toEqual({Bucket:'bkt', Key:'ut/o-1/fakeHash.txt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt',Key:'ut/o-1/fakeHash.txt',ACL:'public-read',CacheControl:'max-age=31556926',ContentType:'text/plain'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip uploading if the file exists', function(done) {
            s3.headObject.andCallFake(function(params, cb) {
                cb(null, { ETag: '"qwer1234"' });
            });
            collateral.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.txt', md5: 'qwer1234'});
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if hashing the file fails', function(done) {
            uuid.hashFile.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if uploading the file fails', function(done) {
            s3util.putObject.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(uuid.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalled();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should correctly identify png images', function(done) {
            buff = new Buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x36, 0xf8]);
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/png');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should correctly identify gif images', function(done) {
            buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0xff, 0x34, 0x12]);
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/gif');
                buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0x34, 0x12]);
                return collateral.checkImageType('fakePath');
            }).then(function(type) {
                expect(type).toBe('image/gif');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if reading the file fails', function(done) {
            fs.readFile.andCallFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateral.checkImageType('fakePath').then(function(type) {
                expect(type).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });

    describe('importFile(req, s3, config)', function() {
        var responseDefer;

        var req, s3, config;
        var jobId;
        var promise;
        var success, failure;
        var responseDeferred;

        function noArgs(fn) {
            return function() {
                return fn();
            };
        }

        beforeEach(function(done) {
            jobId = uuid.createUuid();
            spyOn(uuid, 'createUuid').andReturn(jobId);

            spyOn(fs, 'createWriteStream');
            spyOn(fs, 'remove');

            responseDefer = function responseDefer() {
                var deferred = q.defer();
                var promise = deferred.promise;

                promise.pipe = jasmine.createSpy('EventedPromise.pipe()');
                promise.abort = jasmine.createSpy('EventedPromise.abort()');

                EventEmitter.call(promise);
                for (var method in EventEmitter.prototype) {
                    promise[method] = EventEmitter.prototype[method];
                }

                return deferred;
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            req = {
                user: { id: 'u-0507ebe9b5dc5d' },
                body: {
                    uri: 'https://pbs.twimg.com/profile_images/554776783967363072/2lxo5V22_400x400.png'
                }
            };
            s3 = { type: 's3' };
            config = {
                maxFileSize: 1000,
                maxDownloadTime: 15000,
                s3: {
                    path: '/collateral'
                }
            };

            responseDeferred = responseDefer();
            spyOn(request, 'head').andReturn(responseDeferred.promise);

            promise = collateral.importFile(req, s3, config);
            promise.then(success, failure);
            q().then(done);
        });

        describe('if no uri is specified', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                request.head.reset();
                success.reset();
                failure.reset();
                req.body = {};

                collateral.importFile(req, s3, config).then(success, failure).then(done, done);
            });

            it('should fail with a 400', function() {
                expect(success).toHaveBeenCalledWith({
                    code: 400,
                    body: 'No image URI specified.'
                });
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should not HEAD anything', function() {
                expect(request.head).not.toHaveBeenCalled();
            });
        });

        describe('if the provided URI is invalid', function() {
            beforeEach(function(done) {
                success.reset();
                failure.reset();

                request.head.andCallFake(function() {
                    responseDeferred.promise.emit('error', new Error('Invalid URI "' + req.body.uri + '"'));
                    return responseDeferred.promise;
                });
                spyOn(request, 'get').andReturn(responseDefer().promise);

                req.body.uri = 'fn8942yrh8943';
                promise = collateral.importFile(req, s3, config);
                promise.then(success, failure);
                q().then(done);
            });

            it('should fulfill the promise with a 400', function() {
                expect(success).toHaveBeenCalledWith({
                    code: 400,
                    body: '"' + req.body.uri + '" is not a valid URI.'
                });
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should not GET the image', function() {
                expect(request.get).not.toHaveBeenCalled();
            });
        });

        it('should make a HEAD for the image', function() {
            expect(request.head).toHaveBeenCalledWith({
                uri: req.body.uri,
                resolveWithFullResponse: true
            });
        });

        describe('if the HEAD exceeds the maxDownloadTime', function() {
            beforeEach(function(done) {
                spyOn(request, 'get');
                responseDeferred.resolve({
                    headers: {}
                });
                jasmine.Clock.tick(config.maxDownloadTime + 1);
                q().then(done);
            });

            it('should not GET the image', function() {
                expect(request.get).not.toHaveBeenCalled();
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should abort() the request', function() {
                expect(responseDeferred.promise.abort).toHaveBeenCalled();
            });

            it('should fulfill the promise with a 408', function() {
                expect(success).toHaveBeenCalledWith({
                    code: 408,
                    body: 'Timed out downloading file [' + req.body.uri + '].'
                });
            });
        });

        describe('if the HEAD fails', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                spyOn(request, 'get').andReturn(responseDefer().promise);

                responseDeferred.reject('I BROKE!');
                responseDeferred.promise.then(done, done);
            });

            it('should still make a GET', function() {
                expect(request.get).toHaveBeenCalledWith(req.body.uri);
            });
        });

        describe('when the HEAD succeeds', function() {
            var headResponse;
            var HEAD_TIME = 150;

            beforeEach(function() {
                jasmine.Clock.tick(HEAD_TIME);

                headResponse = {
                    headers: {}
                };
            });

            describe('with no headers at all', function() {
                beforeEach(function(done) {
                    done = noArgs(done);

                    delete headResponse.headers;

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(done, done);
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });

                it('should reject the promise', function() {
                    expect(failure).toHaveBeenCalledWith(jasmine.any(TypeError));
                });
            });

            describe('with a content-length header that is smaller than the maxFileSize', function() {
                beforeEach(function(done) {
                    done = noArgs(done);

                    headResponse.headers['content-length'] = (config.maxFileSize - 1).toString();

                    spyOn(request, 'get').andReturn(responseDefer().promise);

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(done, done);
                });

                it('should make a GET request for the resource', function() {
                    expect(request.get).toHaveBeenCalledWith(req.body.uri);
                });
            });

            describe('with no content-length header', function() {
                var getDeferred;
                var writeStream;
                var tmpPath;

                beforeEach(function(done) {
                    done = noArgs(done);

                    delete headResponse.headers['content-length'];

                    getDeferred = responseDefer();
                    spyOn(request, 'get').andReturn(getDeferred.promise);

                    writeStream = { writeStream: true };
                    fs.createWriteStream.andReturn(writeStream);

                    tmpPath = path.join(os.tmpdir(), jobId + path.extname(req.body.uri));

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(done, done);
                });

                it('should make a GET request for the resource', function() {
                    expect(request.get).toHaveBeenCalledWith(req.body.uri);
                });

                it('should pipe() the image into a tmp file', function() {
                    expect(fs.createWriteStream).toHaveBeenCalledWith(tmpPath);
                    expect(getDeferred.promise.pipe).toHaveBeenCalledWith(writeStream);
                });

                describe('but GETting the image takes too long', function() {
                    beforeEach(function(done) {
                        spyOn(collateral, 'checkImageType').andReturn(q.defer().promise);

                        jasmine.Clock.tick((config.maxDownloadTime - HEAD_TIME) + 1);
                        q().then(done);
                    });

                    it('should abort() the request', function() {
                        expect(getDeferred.promise.abort).toHaveBeenCalled();
                    });

                    it('should log a warning', function() {
                        expect(mockLog.warn).toHaveBeenCalled();
                    });

                    it('should not check the type of image', function() {
                        expect(collateral.checkImageType).not.toHaveBeenCalled();
                    });

                    it('should remove the tmp file', function() {
                        expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                    });

                    it('should fulfill the promise with a 408', function() {
                        expect(success).toHaveBeenCalledWith({
                            code: 408,
                            body: 'Timed out downloading file [' + req.body.uri + '].'
                        });
                    });
                });

                describe('but GETting the image fails', function() {
                    beforeEach(function(done) {
                        done = noArgs(done);

                        spyOn(collateral, 'checkImageType').andReturn(q.defer().promise);
                        getDeferred.promise.response = {
                            statusCode: 404
                        };
                        getDeferred.promise.emit('end', new Buffer(250));
                        getDeferred.reject({
                            error: 'NOT FOUND',
                            response: {
                                statusCode: 404
                            }
                        });
                        getDeferred.promise.then(done, done);
                    });

                    it('should respond with a 400', function() {
                        expect(success).toHaveBeenCalledWith({
                            code: 400,
                            body: 'Could not fetch image from "' + req.body.uri + '."'
                        });
                    });

                    it('should not check the type of the image', function() {
                        expect(collateral.checkImageType).not.toHaveBeenCalled();
                    });

                    it('should log a warning', function() {
                        expect(mockLog.warn).toHaveBeenCalled();
                    });

                    it('should remove the tmp file', function() {
                        expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                    });
                });

                describe('if the size of the image ends up being too large', function() {
                    var response;

                    beforeEach(function(done) {
                        done = noArgs(done);
                        response = getDeferred.promise;

                        // Not too big
                        response.emit('data', new Buffer(250));
                        // Not too big
                        response.emit('data', new Buffer(250));
                        // Not too big, but getting there
                        response.emit('data', new Buffer(250));
                        // Now it *is* the maxFileSize
                        response.emit('data', new Buffer(250));
                        // This one byte will set it over the edge...
                        response.emit('data', new Buffer(1));

                        spyOn(collateral, 'checkImageType').andReturn(q.defer().promise);
                        getDeferred.promise.response = {
                            statusCode: 201
                        };
                        getDeferred.resolve(new Buffer(500));
                        response.emit('end', new Buffer(500));

                        promise.then(done, done);
                    });

                    it('should respond with a 413', function() {
                        expect(success).toHaveBeenCalledWith({
                            code: 413,
                            body: 'File [' + req.body.uri + '] is too large.'
                        });
                    });

                    it('should abort() the file download', function() {
                        expect(response.abort).toHaveBeenCalled();
                    });

                    it('should log a warning', function() {
                        expect(mockLog.warn).toHaveBeenCalled();
                    });

                    it('should remove the tmp file', function() {
                        expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                    });
                });

                describe('if the size of the image is not too large', function() {
                    var response;
                    var checkImageTypeDeferred;

                    beforeEach(function(done) {
                        done = noArgs(done);
                        response = getDeferred.promise;

                        response.emit('data', new Buffer(250));
                        response.emit('data', new Buffer(250));

                        checkImageTypeDeferred = q.defer();
                        spyOn(collateral, 'checkImageType').andReturn(checkImageTypeDeferred.promise);

                        jasmine.Clock.tick(config.maxDownloadTime - HEAD_TIME - 1);
                        getDeferred.promise.response = {
                            statusCode: 201
                        };
                        getDeferred.resolve(new Buffer(500));
                        response.emit('end', new Buffer(500));
                        getDeferred.promise.then(done, done);
                    });

                    it('should not abort() the download', function() {
                        expect(response.abort).not.toHaveBeenCalled();
                    });

                    it('should see if the file is a valid image', function() {
                        expect(collateral.checkImageType).toHaveBeenCalledWith(tmpPath);
                    });

                    describe('but it is not actually an image', function() {
                        beforeEach(function(done) {
                            done = noArgs(done);

                            spyOn(collateral, 'upload').andReturn(q.defer().promise);
                            checkImageTypeDeferred.resolve(false);
                            checkImageTypeDeferred.promise.then(done, done);
                        });

                        it('should respond with a 415', function() {
                            expect(success).toHaveBeenCalledWith({
                                code: 415,
                                body: 'File [' + req.body.uri + '] is not an image.'
                            });
                        });

                        it('should log a warning', function() {
                            expect(mockLog.warn).toHaveBeenCalled();
                        });

                        it('should not upload the file to s3', function() {
                            expect(collateral.upload).not.toHaveBeenCalled();
                        });

                        it('should remove the tmp file', function() {
                            expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                        });
                    });

                    describe('and it is actually an image', function() {
                        var uploadDeferred;

                        beforeEach(function(done) {
                            done = noArgs(done);

                            uploadDeferred = q.defer();
                            spyOn(collateral, 'upload').andReturn(uploadDeferred.promise);

                            checkImageTypeDeferred.resolve('image/png');
                            checkImageTypeDeferred.promise.then(done, done);
                        });

                        it('should upload the image to S3', function() {
                            expect(collateral.upload).toHaveBeenCalledWith(req, path.join(config.s3.path, 'userFiles/' + req.user.id), { path: tmpPath, type: 'image/png' }, s3, config);
                        });

                        describe('and the S3 upload succeeds', function() {
                            beforeEach(function(done) {
                                done = noArgs(done);

                                uploadDeferred.resolve({ key: path.join(config.s3.path, 'userFiles/' + req.user.id), md5: 'fu934yrhf7438rr' });
                                uploadDeferred.promise.then(done, done);
                            });

                            it('should resolve the promise with the upload location', function() {
                                expect(success).toHaveBeenCalledWith({
                                    code: 201,
                                    body: { path: path.join(config.s3.path, 'userFiles/' + req.user.id) }
                                });
                            });

                            it('should remove the tmp file', function() {
                                expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                            });

                            describe('if there is an error removing the tmp file', function() {
                                var error;

                                beforeEach(function() {
                                    error = new Error();

                                    fs.remove.mostRecentCall.args[1](error);
                                });

                                it('should log a warning', function() {
                                    expect(mockLog.warn).toHaveBeenCalled();
                                });
                            });

                            describe('if there is no error removing the tmp file', function() {
                                beforeEach(function() {
                                    fs.remove.mostRecentCall.args[1](null);
                                });

                                it('should not log a warning', function() {
                                    expect(mockLog.warn).not.toHaveBeenCalled();
                                });
                            });
                        });

                        describe('but the s3 upload fails', function() {
                            beforeEach(function(done) {
                                done = noArgs(done);

                                uploadDeferred.reject('WOAH I SUCK.');
                                uploadDeferred.promise.then(done, done);
                            });

                            it('should respond with a 500', function() {
                                expect(success).toHaveBeenCalledWith({
                                    code: 500,
                                    body: 'Could not upload file [' + req.body.uri + '].'
                                });
                            });

                            it('should log an error', function() {
                                expect(mockLog.error).toHaveBeenCalled();
                            });

                            it('should remove the tmp file', function() {
                                expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                            });
                        });
                    });
                });
            });

            describe('with a content-length header that is larger than the maxFileSize', function() {
                beforeEach(function(done) {
                    done = noArgs(done);

                    headResponse.headers['content-length'] = (config.maxFileSize + 1).toString();

                    spyOn(request, 'get').andReturn(responseDefer().promise);

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(done, done);
                });

                it('should not make a GET request for the resource', function() {
                    expect(request.get).not.toHaveBeenCalled();
                });

                it('should respond with a 413', function() {
                    expect(success).toHaveBeenCalledWith({
                        code: 413,
                        body: 'File [' + req.body.uri + '] is too large (' +
                            headResponse.headers['content-length'] + ' bytes.)'
                    });
                });

                it('should log a warning', function() {
                    expect(mockLog.warn).toHaveBeenCalled();
                });
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
                    testFile: { name: 'test', type: 'text/plain', path: '/tmp/123' }
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if a file is too large', function(done) {
            req.files.testFile.truncated = true;
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(413);
                expect(resp.body).toEqual([{code: 413, name: 'testFile', error: 'File is too big' }]);
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if the file is not a supported image type', function(done) {
            collateral.checkImageType.andReturn(q(false));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(415);
                expect(resp.body).toEqual([{code: 415, name: 'testFile', error: 'Unsupported file type' }]);
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should upload a file successfully', function(done) {
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{code: 201, name: 'testFile', path: '/path/on/s3'}]);
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/userFiles/u-1',
                    {name: 'test', type:'image/jpeg',path:'/tmp/123'},'fakeS3',config);
                expect(collateral.checkImageType).toHaveBeenCalledWith('/tmp/123');
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls[0].args[0]).toBe('/tmp/123');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if uploading the file fails', function(done) {
            collateral.upload.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([{code: 500, name: 'testFile', error: 'I GOT A PROBLEM'}]);
                expect(collateral.upload).toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should just log a warning if deleting the temp file fails', function(done) {
            fs.remove.andCallFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{code: 201, name: 'testFile', path: '/path/on/s3'}]);
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
                file1: { name: '1.txt', type: 'text/plain', path: '/tmp/1', truncated: false },
                file2: { name: '2.txt', type: 'text/plain', path: '/tmp/2', truncated: true },
                file3: { name: '3.txt', type: 'text/plain', path: '/tmp/3' }
            };
            collateral.upload.andCallFake(function(req, org, fileOpts, versionate, s3, config) {
                if (fileOpts.name === '3.txt') return q.reject('I GOT A PROBLEM');
                else return q({key: '/path/to/' + fileOpts.name, md5: 'qwer1234'});
            });

            collateral.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([
                    {code: 201, name: 'file1', path: '/path/to/1.txt'},
                    {code: 413, name: 'file2', error: 'File is too big'},
                    {code: 500, name: 'file3', error: 'I GOT A PROBLEM'}
                ]);
                expect(collateral.upload.calls.length).toBe(2);
                expect(fs.remove.calls.length).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
                user: { id: 'u-1', org: 'o-1' },
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
                expect(collateral.upload).toHaveBeenCalledWith(req,'ut/userFiles/u-1',{
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},s3,config);
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
        
        it('should fail if writing the compiled html fails', function(done) {
            fs.writeFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(handlebars.compile).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
                expect(collateral.splashCache.fakeHash).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error).toEqual('Failed to open /tmp/fakeUuid-compiled.html: status was fail');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
            }).done(done);
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
            }).catch(function(error) {
                expect(error).toBe('PhantomJS exited prematurely');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should timeout if any part of the process takes too long', function(done) {
            page.open.andCallFake(function(url, cb) {
                setTimeout(function() { cb('success'); }, 12*1000);
            });
            
            var promise = collateral.generate(req, imgSpec, 'fakeTemplate', 'fakeHash', s3, config);
            jasmine.Clock.tick(11*1000);
            promise.then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('Timed out after 10000 ms');
                expect(page.render).not.toHaveBeenCalled();
                expect(collateral.upload).not.toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe generate
    
    describe('generateSplash', function() {
        var req, imgSpec, s3, config, templDir;
        beforeEach(function() {
            req = {uuid:'1234',user:{id:'u-1'},params:{expId:'e-1'},body:{ratio:'foo',thumbs:['http://image.jpg']}};
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
                    expect(resp.reason.code).toBe(400);
                    expect(resp.reason.error).toBe('Must provide complete imgSpec');
                    if (index === 2) expect(resp.reason.ratio).toBe('');
                    else expect(resp.reason.ratio).toBe('foo');
                });
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.generate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the ratio name is invalid', function(done) {
            glob.sync.andReturn([]);
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Invalid ratio name'});
                expect(glob.sync).toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.generate).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if either dimension is too large', function(done) {
            imgSpec.height = 2000;
            collateral.generateSplash(req, imgSpec, s3, config).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Requested image size is too large'});
                imgSpec.height = 400, imgSpec.width = 2000;
                return collateral.generateSplash(req, imgSpec, s3, config);
            }).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Requested image size is too large'});
                expect(glob.sync).not.toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateral.generate).not.toHaveBeenCalled();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully call collateral.generate', function(done) {
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(glob.sync).toHaveBeenCalledWith(path.join(templDir, 'foo*'));
                expect(collateral.chooseTemplateNum).toHaveBeenCalledWith(1);
                expect(fs.readFile).toHaveBeenCalledWith(path.join(templDir,'foo_x1.html'),{encoding: 'utf8'},anyFunc);
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should regenerate the splash if there is a cached md5 but no file on s3', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},anyFunc);
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
                req.query = {};
                return collateral.generateSplash(req, imgSpec, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject.calls[1].args).toEqual([{Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},anyFunc]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should regenerate the splash if there is a file on s3 with the wrong md5', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            s3.headObject.andCallFake(function(params, cb) { cb(null, {ETag: '"qwer5678"'}); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},anyFunc);
                expect(collateral.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not regenerate the splash if the correct file is on s3', function(done) {
            collateral.splashCache['fakeHash'] = { md5: 'qwer1234', date: new Date() };
            s3.headObject.andCallFake(function(params, cb) { cb(null, {ETag: '"qwer1234"'}); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'ut/userFiles/u-1/qwer1234.jpg'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},anyFunc);
                expect(collateral.generate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if reading the template file fails', function(done) {
            fs.readFile.andCallFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:500,ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateral.generate).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if collateral.generate fails', function(done) {
            collateral.generate.andReturn(q.reject('I GOT A PROBLEM'));
            collateral.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:500,ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.readFile).toHaveBeenCalled();
                expect(collateral.generate).toHaveBeenCalled();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully call generateSplash', function(done) {
            collateral.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateral.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully copy the file to set the headers on it', function(done) {
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, anyFunc);
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=100',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'}
                , anyFunc);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if copyObject has an error', function(done) {
            s3.copyObject.andCallFake(function(params, cb) { cb('I GOT A PROBLEM'); });
            collateral.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.copyObject).toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe setHeaders
});  // end -- describe collateral
