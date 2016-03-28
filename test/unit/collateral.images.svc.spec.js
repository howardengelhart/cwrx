describe('collateralImages-images (UT)', function() {
    var hashUtils, q, s3util, fs, uuid, EventEmitter, request, logger, path, os, phantom, handlebars, glob;
    var mockLog;
    var collateralImages;

    function responseDefer() {
        var deferred = q.defer();
        var promise = deferred.promise;

        promise.pipe = jasmine.createSpy('EventedPromise.pipe()');
        promise.abort = jasmine.createSpy('EventedPromise.abort()');

        EventEmitter.call(promise);
        for (var method in EventEmitter.prototype) {
            promise[method] = EventEmitter.prototype[method];
        }

        return deferred;
    }

    beforeAll(function() {
        for (var m in require.cache){ delete require.cache[m]; }
    });

    beforeEach(function() {
        jasmine.clock().install();

        hashUtils = require('../../lib/hashUtils');
        q = require('q');
        s3util = require('../../lib/s3util');
        fs = require('fs-extra');
        uuid = require('rc-uuid');
        EventEmitter = require('events').EventEmitter;
        request = require('request-promise');
        logger = require('../../lib/logger');
        path = require('path');
        os = require('os');
        phantom = require('phantom');
        handlebars = require('handlebars');
        glob = require('glob');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        spyOn(os,'tmpdir').and.returnValue('/tmp');

        delete require.cache[require.resolve('../../bin/collateral-images')];
        collateralImages = require('../../bin/collateral-images');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    describe('upload', function() {
        var s3, req, config, fileOpts;
        beforeEach(function() {
            req = { uuid: '1234', requester: { id: 'u-1', permissions: {} }, user: { id: 'u-1', org: 'o-1' } };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').and.callFake(function(params, cb) {
                    cb('that does not exist', null);
                })
            };
            config = { s3: { bucket: 'bkt' }, cacheControl: { default: 'max-age=31556926' } };
            fileOpts = { name: 'foo.txt', path: '/ut/foo.txt', type: 'text/plain' };
            spyOn(hashUtils, 'hashFile').and.returnValue(q('fakeHash'));
            spyOn(s3util, 'putObject').and.returnValue(q({ETag: '"qwer1234"'}));
        });

        it('should upload a file', function(done) {
            collateralImages.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.txt', md5: 'qwer1234'});
                expect(hashUtils.hashFile).toHaveBeenCalledWith('/ut/foo.txt');
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.headObject.calls.all()[0].args[0]).toEqual({Bucket:'bkt', Key:'ut/o-1/fakeHash.txt'});
                expect(s3util.putObject).toHaveBeenCalledWith(s3, '/ut/foo.txt',
                    {Bucket:'bkt',Key:'ut/o-1/fakeHash.txt',ACL:'public-read',CacheControl:'max-age=31556926',ContentType:'text/plain'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should skip uploading if the file exists', function(done) {
            s3.headObject.and.callFake(function(params, cb) {
                cb(null, { ETag: '"qwer1234"' });
            });
            collateralImages.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).toEqual({key: 'ut/o-1/fakeHash.txt', md5: 'qwer1234'});
                expect(hashUtils.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if hashing the file fails', function(done) {
            hashUtils.hashFile.and.returnValue(q.reject('I GOT A PROBLEM'));
            collateralImages.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(hashUtils.hashFile).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3util.putObject).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if uploading the file fails', function(done) {
            s3util.putObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            collateralImages.upload(req, 'ut/o-1', fileOpts, s3, config).then(function(response) {
                expect(response).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(hashUtils.hashFile).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3util.putObject).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('checkImageType', function() {
        var buff;
        beforeEach(function() {
            buff = new Buffer([]);
            spyOn(fs, 'readFile').and.callFake(function(fpath, cb) { cb(null, buff); });
        });

        it('should correctly identify jpeg images', function(done) {
            buff = new Buffer([0xff, 0xd8, 0xff, 0xf3, 0x12, 0x56, 0x83]);
            collateralImages.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/jpeg');
                expect(fs.readFile).toHaveBeenCalledWith('fakePath', jasmine.any(Function));
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should correctly identify png images', function(done) {
            buff = new Buffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x36, 0xf8]);
            collateralImages.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/png');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should correctly identify gif images', function(done) {
            buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0xff, 0x34, 0x12]);
            collateralImages.checkImageType('fakePath').then(function(type) {
                expect(type).toBe('image/gif');
                buff = new Buffer([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0x34, 0x12]);
                return collateralImages.checkImageType('fakePath');
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
            fs.readFile.and.callFake(function(fpath, cb) { cb(null, badBuffers[fpath]); });

            q.all(Object.keys(badBuffers).map(collateralImages.checkImageType)).then(function(results) {
                results.forEach(function(result) { expect(result).toBe(false); });
                expect(fs.readFile.calls.all()[0].args).toEqual(['badJpeg', jasmine.any(Function)]);
                expect(fs.readFile.calls.all()[1].args).toEqual(['badPng', jasmine.any(Function)]);
                expect(fs.readFile.calls.all()[2].args).toEqual(['badGif1', jasmine.any(Function)]);
                expect(fs.readFile.calls.all()[3].args).toEqual(['badGif2', jasmine.any(Function)]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if reading the file fails', function(done) {
            fs.readFile.and.callFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateralImages.checkImageType('fakePath').then(function(type) {
                expect(type).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
            }).done(done);
        });
    });

    describe('importFile(req, s3, config)', function() {
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
            spyOn(uuid, 'createUuid').and.returnValue(jobId);

            spyOn(fs, 'createWriteStream');
            spyOn(fs, 'remove');

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            req = {
                user: { id: 'u-0507ebe9b5dc5d' },
                requester: { id: 'u-0507ebe9b5dc5d', permissions: {} },
                body: {
                    uri: 'https://pbs.twimg.com/profile_images/554776783967363072/2lxo5V22_400x400.png'
                }
            };
            s3 = { type: 's3' };
            config = {
                maxFileSize: 1000,
                maxDownloadTime: 15000,
                s3: {
                    path: '/collateralImages'
                }
            };

            responseDeferred = responseDefer();
            spyOn(request, 'head').and.returnValue(responseDeferred.promise);

            promise = collateralImages.importFile(req, s3, config);
            promise.then(success, failure);
            q().then(done);
        });

        describe('if a data: URL is provided', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                request.head.calls.reset();
                success.calls.reset();
                failure.calls.reset();
                spyOn(request, 'get').and.returnValue(responseDefer().promise);

                req.body.uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';
                collateralImages.importFile(req, s3, config).then(success, failure).then(done, done);
            });

            it('should not HEAD the image', function() {
                expect(request.head).not.toHaveBeenCalled();
            });

            it('should fulfill the promise with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: '"' + req.body.uri + '" is not a valid URI.'
                }));
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
            });

            it('should not GET the image', function() {
                expect(request.get).not.toHaveBeenCalled();
            });
        });

        describe('if a http: URL is provided', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                request.head.calls.reset();
                success.calls.reset();
                failure.calls.reset();
                request.head.and.returnValue(q.reject(new Error('Could not HEAD')));
                spyOn(request, 'get').and.returnValue(q.reject(new Error('Could no GET')));

                req.body.uri = 'http://pbs.twimg.com/profile_images/554776783967363072/2lxo5V22_400x400.png';
                collateralImages.importFile(req, s3, config).then(success, failure).then(done, done);
            });

            it('should head the image', function() {
                expect(request.head).toHaveBeenCalled();
            });

            it('should GET the image', function() {
                expect(request.get).toHaveBeenCalled();
            });
        });

        describe('if a URL with a query param is provided', function() {
            var jobId;

            beforeEach(function(done) {
                var getDeferred = responseDefer();
                var response = getDeferred.promise;

                request.head.calls.reset();
                success.calls.reset();
                failure.calls.reset();
                spyOn(request, 'get').and.returnValue(getDeferred.promise);
                request.head.and.returnValue(q({
                    headers: {
                        'content-length': (config.maxFileSize - 1).toString()
                    }
                }));
                spyOn(collateralImages, 'checkImageType').and.returnValue(q('image/png'));
                spyOn(collateralImages, 'upload').and.returnValue(q({
                    key: path.join(config.s3.path, 'userFiles/' + req.requester.id),
                    md5: 'fu934yrhf7438rr'
                }));

                req.body.uri += '?94385843';
                collateralImages.importFile(req, s3, config).then(success, failure).finally(done);

                process.nextTick(function() {
                    response.emit('data', new Buffer(250));
                    response.emit('data', new Buffer(250));

                    getDeferred.promise.response = {
                        statusCode: 201
                    };
                    getDeferred.resolve(new Buffer(500));
                    response.emit('end', new Buffer(500));
                });
                jobId = uuid.createUuid.calls.mostRecent().returnValue;
            });

            it('should GET the uri with the query param', function() {
                expect(request.get).toHaveBeenCalledWith(req.body.uri);
            });

            it('should create the tmp file without the query param', function() {
                expect(fs.createWriteStream).toHaveBeenCalledWith('/tmp/' + jobId + '.png');
            });

            it('should upload the file without the query param', function() {
                expect(collateralImages.upload).toHaveBeenCalledWith(jasmine.anything(), jasmine.anything(), jasmine.objectContaining({ path: '/tmp/' + jobId + '.png' }), jasmine.anything(), jasmine.anything());
            });

            it('should fulfill the promise', function() {
                expect(success).toHaveBeenCalled();
            });
        });

        describe('if no uri is specified', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                request.head.calls.reset();
                success.calls.reset();
                failure.calls.reset();
                req.body = {};

                collateralImages.importFile(req, s3, config).then(success, failure).then(done, done);
            });

            it('should fail with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'No image URI specified.'
                }));
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
                success.calls.reset();
                failure.calls.reset();
                request.head.calls.reset();

                spyOn(request, 'get').and.returnValue(responseDefer().promise);

                req.body.uri = 'fn8942yrh8943';
                promise = collateralImages.importFile(req, s3, config);
                promise.then(success, failure).finally(done);
            });

            it('should not HEAD the image', function() {
                expect(request.head).not.toHaveBeenCalled();
            });

            it('should fulfill the promise with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: '"' + req.body.uri + '" is not a valid URI.'
                }));
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
                jasmine.clock().tick(config.maxDownloadTime + 1);
                promise.finally(done);
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
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 408,
                    body: 'Timed out downloading file [' + req.body.uri + '].'
                }));
            });
        });

        describe('if the HEAD fails', function() {
            beforeEach(function(done) {
                done = noArgs(done);

                spyOn(request, 'get').and.returnValue(responseDefer().promise);

                responseDeferred.reject('I BROKE!');
                responseDeferred.promise.catch(function() {}).then(function() {}).finally(done);
            });

            it('should still make a GET', function() {
                expect(request.get).toHaveBeenCalledWith(req.body.uri);
            });
        });

        describe('when the HEAD succeeds', function() {
            var headResponse;
            var HEAD_TIME = 150;

            beforeEach(function() {
                jasmine.clock().tick(HEAD_TIME);

                headResponse = {
                    headers: {}
                };
            });

            describe('with no headers at all', function() {
                beforeEach(function(done) {
                    done = noArgs(done);

                    delete headResponse.headers;

                    responseDeferred.resolve(headResponse);
                    promise.finally(done);
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

                    spyOn(request, 'get').and.returnValue(responseDefer().promise);

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(function() {}).then(function() {}).finally(done);
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
                    spyOn(request, 'get').and.returnValue(getDeferred.promise);

                    writeStream = { writeStream: true };
                    fs.createWriteStream.and.returnValue(writeStream);

                    tmpPath = path.join(os.tmpdir(), jobId + path.extname(req.body.uri));

                    responseDeferred.resolve(headResponse);
                    responseDeferred.promise.then(function() {}).then(function() {}).finally(done);
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
                        spyOn(collateralImages, 'checkImageType').and.returnValue(q.defer().promise);

                        jasmine.clock().tick((config.maxDownloadTime - HEAD_TIME) + 1);
                        promise.finally(done);
                    });

                    it('should abort() the request', function() {
                        expect(getDeferred.promise.abort).toHaveBeenCalled();
                    });

                    it('should log a warning', function() {
                        expect(mockLog.warn).toHaveBeenCalled();
                    });

                    it('should not check the type of image', function() {
                        expect(collateralImages.checkImageType).not.toHaveBeenCalled();
                    });

                    it('should remove the tmp file', function() {
                        expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                    });

                    it('should fulfill the promise with a 408', function() {
                        expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                            code: 408,
                            body: 'Timed out downloading file [' + req.body.uri + '].'
                        }));
                    });
                });

                describe('but GETting the image fails', function() {
                    beforeEach(function(done) {
                        done = noArgs(done);

                        spyOn(collateralImages, 'checkImageType').and.returnValue(q.defer().promise);
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
                        promise.finally(done);
                    });

                    it('should respond with a 400', function() {
                        expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                            code: 400,
                            body: 'Could not fetch image from "' + req.body.uri + '."'
                        }));
                    });

                    it('should not check the type of the image', function() {
                        expect(collateralImages.checkImageType).not.toHaveBeenCalled();
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

                        spyOn(collateralImages, 'checkImageType').and.returnValue(q.defer().promise);
                        getDeferred.promise.response = {
                            statusCode: 201
                        };
                        getDeferred.resolve(new Buffer(500));
                        response.emit('end', new Buffer(500));

                        promise.then(done, done);
                    });

                    it('should respond with a 413', function() {
                        expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                            code: 413,
                            body: 'File [' + req.body.uri + '] is too large.'
                        }));
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
                        spyOn(collateralImages, 'checkImageType').and.returnValue(checkImageTypeDeferred.promise);

                        jasmine.clock().tick(config.maxDownloadTime - HEAD_TIME - 1);
                        getDeferred.promise.response = {
                            statusCode: 201
                        };
                        getDeferred.resolve(new Buffer(500));
                        response.emit('end', new Buffer(500));
                        getDeferred.promise.then(function() {}).finally(done);
                    });

                    it('should not abort() the download', function() {
                        expect(response.abort).not.toHaveBeenCalled();
                    });

                    it('should see if the file is a valid image', function() {
                        expect(collateralImages.checkImageType).toHaveBeenCalledWith(tmpPath);
                    });

                    describe('but it is not actually an image', function() {
                        beforeEach(function(done) {
                            done = noArgs(done);

                            spyOn(collateralImages, 'upload').and.returnValue(q.defer().promise);
                            checkImageTypeDeferred.resolve(false);
                            promise.finally(done);
                        });

                        it('should respond with a 415', function() {
                            expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                                code: 415,
                                body: 'File [' + req.body.uri + '] is not an image.'
                            }));
                        });

                        it('should log a warning', function() {
                            expect(mockLog.warn).toHaveBeenCalled();
                        });

                        it('should not upload the file to s3', function() {
                            expect(collateralImages.upload).not.toHaveBeenCalled();
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
                            spyOn(collateralImages, 'upload').and.returnValue(uploadDeferred.promise);

                            checkImageTypeDeferred.resolve('image/png');
                            checkImageTypeDeferred.promise.then(function() {}).finally(done);
                        });

                        it('should upload the image to S3', function() {
                            expect(collateralImages.upload).toHaveBeenCalledWith(req, path.join(config.s3.path, 'userFiles/' + req.requester.id), { path: tmpPath, type: 'image/png' }, s3, config);
                        });

                        describe('and the S3 upload succeeds', function() {
                            beforeEach(function(done) {
                                done = noArgs(done);

                                uploadDeferred.resolve({ key: path.join(config.s3.path, 'userFiles/' + req.requester.id), md5: 'fu934yrhf7438rr' });
                                promise.finally(done);
                            });

                            it('should resolve the promise with the upload location', function() {
                                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                                    code: 201,
                                    body: { path: path.join(config.s3.path, 'userFiles/' + req.requester.id) }
                                }));
                            });

                            it('should remove the tmp file', function() {
                                expect(fs.remove).toHaveBeenCalledWith(tmpPath, jasmine.any(Function));
                            });

                            describe('if there is an error removing the tmp file', function() {
                                var error;

                                beforeEach(function() {
                                    error = new Error();

                                    fs.remove.calls.mostRecent().args[1](error);
                                });

                                it('should log a warning', function() {
                                    expect(mockLog.warn).toHaveBeenCalled();
                                });
                            });

                            describe('if there is no error removing the tmp file', function() {
                                beforeEach(function() {
                                    fs.remove.calls.mostRecent().args[1](null);
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
                                promise.finally(done);
                            });

                            it('should respond with a 500', function() {
                                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                                    code: 500,
                                    body: 'Could not upload file [' + req.body.uri + '].'
                                }));
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

                    spyOn(request, 'get').and.returnValue(responseDefer().promise);

                    responseDeferred.resolve(headResponse);
                    promise.finally(done);
                });

                it('should not make a GET request for the resource', function() {
                    expect(request.get).not.toHaveBeenCalled();
                });

                it('should respond with a 413', function() {
                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        code: 413,
                        body: 'File [' + req.body.uri + '] is too large (' +
                            headResponse.headers['content-length'] + ' bytes.)'
                    }));
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
                requester: { id: 'u-1', permissions: {} },
                files: {
                    testFile: { name: 'test', type: 'text/plain', path: '/tmp/123' }
                }
            };
            s3 = 'fakeS3';
            config = { maxFileSize: 1000, s3: { path: 'ut/' } };
            spyOn(fs, 'remove').and.callFake(function(path, cb) { cb(); });
            spyOn(collateralImages, 'upload').and.returnValue(q({key: '/path/on/s3', md5: 'qwer1234'}));
            spyOn(collateralImages, 'checkImageType').and.returnValue(q('image/jpeg'));
        });

        it('should fail with a 400 if no files are provided', function(done) {
            delete req.files;
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide files to upload');
                req.files = {};
                return collateralImages.uploadFiles(req, s3, config);
            }).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Must provide files to upload');
                expect(collateralImages.upload).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if a file is too large', function(done) {
            req.files.testFile.truncated = true;
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(413);
                expect(resp.body).toEqual([{code: 413, name: 'testFile', error: 'File is too big' }]);
                expect(collateralImages.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the file is not a supported image type', function(done) {
            collateralImages.checkImageType.and.returnValue(q(false));
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(415);
                expect(resp.body).toEqual([{code: 415, name: 'testFile', error: 'Unsupported file type' }]);
                expect(collateralImages.upload).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should upload a file successfully', function(done) {
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{code: 201, name: 'testFile', path: '/path/on/s3'}]);
                expect(collateralImages.upload).toHaveBeenCalledWith(req,'ut/userFiles/u-1',
                    {name: 'test', type:'image/jpeg',path:'/tmp/123'},'fakeS3',config);
                expect(collateralImages.checkImageType).toHaveBeenCalledWith('/tmp/123');
                expect(fs.remove).toHaveBeenCalled();
                expect(fs.remove.calls.all()[0].args[0]).toBe('/tmp/123');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if uploading the file fails', function(done) {
            collateralImages.upload.and.returnValue(q.reject('I GOT A PROBLEM'));
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([{code: 500, name: 'testFile', error: 'I GOT A PROBLEM'}]);
                expect(collateralImages.upload).toHaveBeenCalled();
                expect(fs.remove).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log a warning if deleting the temp file fails', function(done) {
            fs.remove.and.callFake(function(fpath, cb) { cb('I GOT A PROBLEM'); });
            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual([{code: 201, name: 'testFile', path: '/path/on/s3'}]);
                expect(collateralImages.upload).toHaveBeenCalled();
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
            collateralImages.upload.and.callFake(function(req, org, fileOpts, versionate, s3, config) {
                if (fileOpts.name === '3.txt') return q.reject('I GOT A PROBLEM');
                else return q({key: '/path/to/' + fileOpts.name, md5: 'qwer1234'});
            });

            collateralImages.uploadFiles(req, s3, config).then(function(resp) {
                expect(resp.code).toBe(500);
                expect(resp.body).toEqual([
                    {code: 201, name: 'file1', path: '/path/to/1.txt'},
                    {code: 413, name: 'file2', error: 'File is too big'},
                    {code: 500, name: 'file3', error: 'I GOT A PROBLEM'}
                ]);
                expect(collateralImages.upload.calls.count()).toBe(2);
                expect(fs.remove.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });  // end -- describe uploadFiles

    describe('clearOldCachedMD5s', function() {
        var config;
        beforeEach(function() {
            config = { splash: { cacheTTL: 5*1000, maxCacheKeys: 30000 } };
            collateralImages.splashCache = {
                a: { md5: '1', date: new Date(new Date() - 3*1000) },
                b: { md5: '2', date: new Date() },
                c: { md5: '3', date: new Date(new Date() - 6*1000) },
                d: { md5: '4', date: new Date(new Date() - 1*1000) },
            };
        });

        it('should clear old items from the splashCache', function() {
            collateralImages.clearOldCachedMD5s(config);
            expect(Object.keys(collateralImages.splashCache)).toEqual(['a', 'b', 'd']);
            config.splash.cacheTTL = 2*1000;
            collateralImages.clearOldCachedMD5s(config);
            expect(Object.keys(collateralImages.splashCache)).toEqual(['b', 'd']);
        });

        it('should delete the oldest items if there are too many items in the cache', function() {
            config.splash.maxCacheKeys = 1;
            collateralImages.clearOldCachedMD5s(config);
            expect(Object.keys(collateralImages.splashCache)).toEqual(['b']);
        });

        it('should handle an empty splashCache', function() {
            collateralImages.splashCache = {};
            collateralImages.clearOldCachedMD5s(config);
            expect(collateralImages.splashCache).toEqual({});
            config.splash.maxCacheKeys = -1;
            collateralImages.clearOldCachedMD5s(config);
            expect(collateralImages.splashCache).toEqual({});
        });
    });

    describe('chooseTemplateNum', function() {
        it('should correctly choose the template number', function() {
            var thumbNums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
            expect(thumbNums.map(collateralImages.chooseTemplateNum)).toEqual([1, 2, 3, 4, 5, 6, 6, 6, 6]);
        });
    });

    describe('generate', function() {
        var page, phantObj, compilerSpy, req, imgSpec, s3, config, templDir;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                requester: { id: 'u-1', permissions: {} },
                params: { expId: 'e-1' },
                body: { ratio:'foo', thumbs: ['http://image.jpg'] }
            };
            imgSpec = { height: 600, width: 600, ratio: 'foo' };
            s3 = 'fakeS3';
            collateralImages.splashCache = {};
            config = {s3:{path:'ut/'},splash:{quality:75,maxDimension:1000,timeout:10000,cacheTTL:24*60}};
            phantObj = {
                createPage: jasmine.createSpy('ph.createPage').and.callFake(function(cb) { cb(page); }),
                exit: jasmine.createSpy('ph.exit')
            };
            page = {
                set: jasmine.createSpy('page.set').and.callFake(function(prop,data,cb){ cb('i did it'); }),
                open: jasmine.createSpy('page.open').and.callFake(function(url,cb){ cb('success'); }),
                render: jasmine.createSpy('page.render').and.callFake(function(fpath,opts,cb){ cb('i did it'); }),
                close: jasmine.createSpy('page.close')
            };
            spyOn(uuid, 'createUuid').and.returnValue('fakeUuid');
            spyOn(phantom, 'create').and.callFake(function(flag, opts, cb) { cb(phantObj); });
            spyOn(fs, 'writeFile').and.callFake(function(fpath, data, cb) { cb(); });
            spyOn(fs, 'remove').and.callFake(function(fpath, cb) { cb(); });
            spyOn(collateralImages, 'chooseTemplateNum').and.callThrough();
            spyOn(collateralImages, 'upload').and.returnValue(q({key: '/path/on/s3', md5: 'qwer1234'}));
            compilerSpy = jasmine.createSpy('handlebars compiler').and.returnValue('compiledHtml');
            spyOn(handlebars, 'compile').and.returnValue(compilerSpy);
        });

        it('should successfully generate and upload a splash image', function(done) {
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toBe('/path/on/s3');
                expect(fs.writeFile).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html','compiledHtml',jasmine.any(Function));
                expect(phantom.create).toHaveBeenCalledWith('--ssl-protocol=tlsv1',
                    { onExit: jasmine.any(Function),onStderr: jasmine.any(Function) }, jasmine.any(Function));
                expect(phantObj.createPage).toHaveBeenCalledWith(jasmine.any(Function));
                expect(page.set).toHaveBeenCalledWith('viewportSize',{height:600,width:600},jasmine.any(Function));
                expect(page.open).toHaveBeenCalledWith('/tmp/fakeUuid-compiled.html', jasmine.any(Function));
                expect(page.render).toHaveBeenCalledWith('/tmp/fakeUuid-splash.jpg',{quality:75},jasmine.any(Function));
                expect(collateralImages.upload).toHaveBeenCalledWith(req,'ut/userFiles/u-1',{
                    path:'/tmp/fakeUuid-splash.jpg',type:'image/jpeg'},s3,config);
                expect(collateralImages.splashCache.fakeHash).toEqual({md5:'qwer1234',date:jasmine.any(Date)});
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.count()).toBe(2);
                    expect(fs.remove.calls.all()[0].args).toEqual(['/tmp/fakeUuid-compiled.html',jasmine.any(Function)]);
                    expect(fs.remove.calls.all()[1].args).toEqual(['/tmp/fakeUuid-splash.jpg',jasmine.any(Function)]);
                    done();
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should fail if writing the compiled html fails', function(done) {
            fs.writeFile.and.callFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(handlebars.compile).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                expect(phantom.create).not.toHaveBeenCalled();
                expect(collateralImages.upload).not.toHaveBeenCalled();
                expect(collateralImages.splashCache.fakeHash).not.toBeDefined();
            }).done(done);
        });

        it('should fail if uploading the splash image fails', function(done) {
            collateralImages.upload.and.returnValue(q.reject('I GOT A PROBLEM'));
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toEqual('I GOT A PROBLEM');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.render).toHaveBeenCalled();
                expect(collateralImages.upload).toHaveBeenCalled();
                expect(collateralImages.splashCache.fakeHash).not.toBeDefined();
                process.nextTick(function() {
                    expect(page.close).toHaveBeenCalled();
                    expect(phantObj.exit).toHaveBeenCalled();
                    expect(fs.remove.calls.count()).toBe(2);
                    expect(fs.remove.calls.all()[0].args).toEqual(['/tmp/fakeUuid-compiled.html',jasmine.any(Function)]);
                    expect(fs.remove.calls.all()[1].args).toEqual(['/tmp/fakeUuid-splash.jpg',jasmine.any(Function)]);
                    done();
                });
            });
        });

        it('should fail if opening the page with phantom fails', function(done) {
            page.open.and.callFake(function(url, cb) { cb('fail'); });
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual('Failed to open /tmp/fakeUuid-compiled.html: status was fail');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
                expect(page.render).not.toHaveBeenCalled();
                expect(collateralImages.upload).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if phantom quits prematurely', function(done) {
            var handlers;
            phantom.create.and.callFake(function(flag, opts, cb) {
                handlers = opts;
                cb(phantObj);
            });
            page.open.and.callFake(function(url, cb) {
                handlers.onExit(1, 'PROBLEMS');
                cb('success');
            });
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('PhantomJS exited prematurely');
                expect(fs.writeFile).toHaveBeenCalled();
                expect(page.set).toHaveBeenCalled();
            }).done(done);
        });

        it('should just log a warning if phantom logs error messages', function(done) {
            var handlers;
            phantom.create.and.callFake(function(flag, opts, cb) {
                handlers = opts;
                cb(phantObj);
            });
            page.open.and.callFake(function(url, cb) {
                handlers.onStderr('I THINK I GOT A PROBLEM');
                cb('success');
            });
            collateralImages.generate(req, imgSpec, 'fakeTempl', 'fakeHash', s3, config).then(function(key) {
                expect(key).toEqual('/path/on/s3');
                expect(collateralImages.upload).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should timeout if any part of the process takes too long', function(done) {
            page.open.and.callFake(function(url, cb) {
                setTimeout(function() { cb('success'); }, 12*1000);
            });

            var promise = collateralImages.generate(req, imgSpec, 'fakeTemplate', 'fakeHash', s3, config);
            jasmine.clock().tick(11*1000);
            promise.then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('Timed out after 10000 ms');
                expect(page.render).not.toHaveBeenCalled();
                expect(collateralImages.upload).not.toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe generate

    describe('generateSplash', function() {
        var req, imgSpec, s3, config, templDir;
        beforeEach(function() {
            req = {
                uuid:'1234',
                user: { id: 'u-1' },
                requester: { id: 'u-1', permissions: {} },
                params: { expId: 'e-1' },
                body: {
                    ratio: 'foo',
                    thumbs: ['http://image.jpg']
                }
            };
            imgSpec = { height: 600, width: 600, ratio: 'foo' };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').and.callFake(function(params, cb) {
                    cb('not found', null);
                })
            };
            collateralImages.splashCache = {};
            config = { s3: { path: 'ut/', bucket: 'bkt' },
                       splash: { quality: 75, maxDimension: 1000, timeout: 10000, cacheTTL: 24*60 } };
            templDir = path.join(__dirname, '../../templates/splashTemplates');
            spyOn(glob, 'sync').and.returnValue(['template1', 'template2', 'etc']);
            spyOn(fs, 'readFile').and.callFake(function(fpath, opts, cb) { cb(null, 'fakeTemplate'); });
            spyOn(hashUtils, 'hashText').and.returnValue('fakeHash');
            spyOn(collateralImages, 'chooseTemplateNum').and.callThrough();
            spyOn(collateralImages, 'generate').and.returnValue(q('/path/on/s3'));
        });

        it('should reject if the imgSpec is incomplete', function(done) {
            var imgSpecs = [
                { width: 600, ratio: 'foo' },
                { height: 600, ratio: 'foo' },
                { height: 600, width: 600 }
            ];
            q.allSettled(imgSpecs.map(function(imgSpec) {
                return collateralImages.generateSplash(req, imgSpec, s3, config);
            })).then(function(resps) {
                resps.forEach(function(resp, index) {
                    expect(resp.state).toBe('rejected');
                    expect(resp.reason.code).toBe(400);
                    expect(resp.reason.error).toBe('Must provide complete imgSpec');
                    if (index === 2) expect(resp.reason.ratio).toBe('');
                    else expect(resp.reason.ratio).toBe('foo');
                });
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateralImages.generate).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if the ratio name is invalid', function(done) {
            glob.sync.and.returnValue([]);
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Invalid ratio name'});
                expect(glob.sync).toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateralImages.generate).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if either dimension is too large', function(done) {
            imgSpec.height = 2000;
            collateralImages.generateSplash(req, imgSpec, s3, config).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Requested image size is too large'});
                imgSpec.height = 400;
                imgSpec.width = 2000;
                return collateralImages.generateSplash(req, imgSpec, s3, config);
            }).catch(function(error) {
                expect(error).toEqual({code:400,ratio:'foo',error:'Requested image size is too large'});
                expect(glob.sync).not.toHaveBeenCalled();
                expect(fs.readFile).not.toHaveBeenCalled();
                expect(collateralImages.generate).not.toHaveBeenCalled();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).done(done);
        });

        it('should successfully call collateralImages.generate', function(done) {
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(glob.sync).toHaveBeenCalledWith(path.join(templDir, 'foo*'));
                expect(collateralImages.chooseTemplateNum).toHaveBeenCalledWith(1);
                expect(fs.readFile).toHaveBeenCalledWith(path.join(templDir,'foo_x1.html'),{encoding: 'utf8'},jasmine.any(Function));
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateralImages.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should regenerate the splash if there is a cached md5 but no file on s3', function(done) {
            collateralImages.splashCache.fakeHash = { md5: 'qwer1234', date: new Date() };
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},jasmine.any(Function));
                expect(collateralImages.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
                req.query = {};
                return collateralImages.generateSplash(req, imgSpec, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject.calls.all()[1].args).toEqual([{Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},jasmine.any(Function)]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should regenerate the splash if there is a file on s3 with the wrong md5', function(done) {
            collateralImages.splashCache.fakeHash = { md5: 'qwer1234', date: new Date() };
            s3.headObject.and.callFake(function(params, cb) { cb(null, {ETag: '"qwer5678"'}); });
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'/path/on/s3'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},jasmine.any(Function));
                expect(collateralImages.generate).toHaveBeenCalledWith(req,imgSpec,'fakeTemplate','fakeHash',s3,config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not regenerate the splash if the correct file is on s3', function(done) {
            collateralImages.splashCache.fakeHash = { md5: 'qwer1234', date: new Date() };
            s3.headObject.and.callFake(function(params, cb) { cb(null, {ETag: '"qwer1234"'}); });
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).toEqual({code:201,ratio:'foo',path:'ut/userFiles/u-1/qwer1234.jpg'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket:'bkt',Key:'ut/userFiles/u-1/qwer1234.jpg'},jasmine.any(Function));
                expect(collateralImages.generate).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if reading the template file fails', function(done) {
            fs.readFile.and.callFake(function(fpath, opts, cb) { cb('I GOT A PROBLEM'); });
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:500,ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(collateralImages.generate).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if collateralImages.generate fails', function(done) {
            collateralImages.generate.and.returnValue(q.reject('I GOT A PROBLEM'));
            collateralImages.generateSplash(req, imgSpec, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code:500,ratio:'foo',error:'I GOT A PROBLEM'});
                expect(mockLog.error).toHaveBeenCalled();
                expect(fs.readFile).toHaveBeenCalled();
                expect(collateralImages.generate).toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe generateSplash

    describe('createSplashes', function() {
        var req, s3, config;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1', org: 'o-1' },
                requester: { id: 'u-1', permissions: {} },
                params: { expId: 'e-1' },
                body: {
                    imageSpecs: [{ height: 600, width: 600, ratio: 'foo' }],
                    thumbs: ['http://image.jpg']
                }
            };
            s3 = 'fakeS3';
            config = {s3:{path:'ut/'}, splash:{quality:75, maxDimension:1000, timeout:10000}};
            spyOn(collateralImages, 'generateSplash').and.returnValue(q(
                { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
            ));
        });

        it('should return a 400 if no thumbs are provided', function(done) {
            delete req.body.thumbs;
            collateralImages.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide thumbs to create splashes from'});
                req.body.thumbs = [];
                return collateralImages.createSplashes(req, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide thumbs to create splashes from'});
                expect(collateralImages.generateSplash).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if no imgSpecs are provided', function(done) {
            delete req.body.imageSpecs;
            collateralImages.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide imageSpecs to create splashes for'});
                req.body.imageSpecs = [];
                return collateralImages.createSplashes(req, s3, config);
            }).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide imageSpecs to create splashes for'});
                expect(collateralImages.generateSplash).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully call generateSplash', function(done) {
            collateralImages.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateralImages.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly handle protocol-relative urls', function(done) {
            req.body.thumbs = ['//image.png'];
            collateralImages.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 201, body: [
                    { code: 201, name: 'splash', ratio: 'foo', path: '/path/on/s3' }
                ]});
                expect(collateralImages.generateSplash)
                    .toHaveBeenCalledWith(req, {height: 600, width: 600, ratio: 'foo'}, s3, config);
                expect(req.body.thumbs).toEqual(['http://image.png']);
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
            collateralImages.generateSplash.and.callFake(function(req, imgSpec, s3, config) {
                switch(imgSpec.name) {
                    case 'splash1':
                        return q.reject({code: 400, ratio: imgSpec.ratio, name: 'splash1', error: 'YOU GOT A PROBLEM'});
                    case 'splash2':
                        return q.reject({code: 500, ratio: imgSpec.ratio, name: 'splash2', error: 'I GOT A PROBLEM'});
                    case 'splash3':
                        return q({code: 201, ratio: imgSpec.ratio, name: 'splash3', path: '/path/on/s3'});
                }
            });

            collateralImages.createSplashes(req, s3, config).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: [
                    { code: 400, ratio: 'a', name: 'splash1', error: 'YOU GOT A PROBLEM'},
                    { code: 500, ratio: 'b', name: 'splash2', error: 'I GOT A PROBLEM'},
                    { code: 201, ratio: 'c', name: 'splash3', path: '/path/on/s3' }
                ]});
                expect(collateralImages.generateSplash.calls.count()).toBe(3);
                expect(collateralImages.generateSplash.calls.all()[0].args).toEqual([req,req.body.imageSpecs[0],s3,config]);
                expect(collateralImages.generateSplash.calls.all()[1].args).toEqual([req,req.body.imageSpecs[1],s3,config]);
                expect(collateralImages.generateSplash.calls.all()[2].args).toEqual([req,req.body.imageSpecs[2],s3,config]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });  // end -- describe createSplashes

    describe('setHeaders', function() {
        var req, s3, config;
        beforeEach(function() {
            req = {
                uuid: '1234',
                user: { id: 'u-1' },
                requester: { id: 'u-1', permissions: {} },
                body: { path: 'ut/foo.txt', 'max-age': 100 }
            };
            config = { s3: { bucket: 'bkt' }, cacheControl: { default: 'max-age=15' } };
            s3 = {
                headObject: jasmine.createSpy('s3.headObject').and.callFake(function(params, cb) {
                    cb(null, { ContentType: 'text/plain' });
                }),
                copyObject: jasmine.createSpy('s3.copyObject').and.callFake(function(params, cb) {
                    cb(null, 'i did it yo');
                })
            };
        });

        it('should reject if there is no path in the request body', function(done) {
            delete req.body.path;
            collateralImages.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Must provide path of file on s3'});
                expect(s3.headObject).not.toHaveBeenCalled();
                expect(s3.copyObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully copy the file to set the headers on it', function(done) {
            collateralImages.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, jasmine.any(Function));
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=100',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'},
                    jasmine.any(Function)
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use a default CacheControl if not defined in the request', function(done) {
            delete req.body['max-age'];
            collateralImages.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, jasmine.any(Function));
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=15',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'},
                    jasmine.any(Function)
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should let a user set the CacheControl to 0', function(done) {
            req.body['max-age'] = 0;
            collateralImages.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'ut/foo.txt'});
                expect(s3.headObject).toHaveBeenCalledWith({Bucket: 'bkt', Key: 'ut/foo.txt'}, jasmine.any(Function));
                expect(s3.copyObject).toHaveBeenCalledWith(
                    {Bucket:'bkt',Key:'ut/foo.txt',CacheControl:'max-age=0',ContentType:'text/plain',
                     CopySource:'bkt/ut/foo.txt',ACL:'public-read',MetadataDirective:'REPLACE'},
                    jasmine.any(Function)
                );
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if headObject has an error or returns no data', function(done) {
            var files = ['ut/1.txt', 'ut/2.txt', 'ut/3.txt'];
            s3.headObject.and.callFake(function(params, cb) {
                if (params.Key === 'ut/1.txt') cb('GOT A PROBLEM', 'foo');
                if (params.Key === 'ut/2.txt') cb(null, null);
                else cb(null, { foo: 'bar' });
            });
            q.all(files.map(function(file) {
                req.body.path = file;
                return collateralImages.setHeaders(req, s3, config);
            })).then(function(results) {
                results.forEach(function(resp, index) {
                    expect(resp).toEqual({code: 404, body: 'File not found'});
                    expect(s3.headObject.calls.all()[index].args[0].Key).toBe('ut/' + (index + 1) + '.txt');
                });
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.copyObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if copyObject has an error', function(done) {
            s3.copyObject.and.callFake(function(params, cb) { cb('I GOT A PROBLEM'); });
            collateralImages.setHeaders(req, s3, config).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(s3.headObject).toHaveBeenCalled();
                expect(s3.copyObject).toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe setHeaders
});
