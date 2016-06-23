var q               = require('q'),
    util            = require('util'),
    fs              = require('fs-extra'),
    path            = require('path'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    signatures      = require('../../lib/signatures'),
    request         = require('request'),
    parseURL        = require('url').parse,
    host            = process.env.host || 'localhost',
    bucket          = process.env.bucket || 'c6.dev',
    config = {
        collateralUrl   : 'http://' + (host === 'localhost' ? host + ':3600' : host) + '/api',
        authUrl         : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('collateral (E2E):', function() {
    var cookieJar, mockUser, mockApp, appCreds;
    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        if (cookieJar) {
            return done();
        }
        cookieJar = require('request').jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'collaterale2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                experiences: {
                    read: 'org',
                    create: 'own',
                    edit: 'own',
                    delete: 'own'
                }
            }
        };
        mockApp = {
            id: 'app-e2e-collateral',
            key: 'e2e-collateral',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {}
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'collaterale2euser',

                password: 'password'
            }
        };
        q.all([
            testUtils.resetCollection('users', mockUser),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    [
        {
            desc: 'POST /api/collateral/files/:expId',
            endpoint: '/collateral/files/e-1234',
            params: { expId: 'e-1234' }
        },
        {
            desc: 'POST /api/collateral/files',
            endpoint: '/collateral/files',
            params: {}
        }
    ].forEach(function(blockConfig) {
        describe(blockConfig.desc, function() {
            var files, rmList, options, samples;

            beforeEach(function(done) {
                options = { url: config.collateralUrl + blockConfig.endpoint, jar: cookieJar };
                rmList = [];
                samples = [
                    {
                        path: path.join(__dirname, 'sample1.jpg'),
                        url: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg',
                        etag: '618475c6c98297a486607bc654052447'
                    },
                    {
                        path: path.join(__dirname, 'sample2.jpg'),
                        url: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample2.jpg',
                        etag: 'f538387c355263cb915d6a3cc4b42592'
                    }
                ];

                q.all(samples.map(function(img) {
                    var deferred = q.defer();
                    if (fs.existsSync(img.path)) {
                        return q();
                    } else {
                        request.get({url: img.url}, function(error, response, body) {
                            if (error) deferred.reject(error);
                        })
                        .pipe(fs.createWriteStream(img.path)
                              .on('error', deferred.reject)
                              .on('finish', deferred.resolve));
                    }
                    return deferred.promise;
                })).then(function(results) {
                    files = { testFile: samples[0].path };
                    return;
                }).done(done);
            });

            afterEach(function(done) {
                return q.all(rmList.map(function(key) {
                    return testUtils.removeS3File(bucket, key);
                })).done(function() { done(); });
            });

            it('should upload a file', function(done) {
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, name: 'testFile', path: 'collateral/userFiles/e2e-user/' + samples[0].etag + '.jpg'}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                    expect(resp.response.headers['cache-control']).toBe('max-age=31556926');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should write an entry to the audit collection', function(done) {
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
                }).then(function(results) {
                    expect(results[0].user).toBe('e2e-user');
                    expect(results[0].created).toEqual(jasmine.any(Date));
                    expect(results[0].host).toEqual(jasmine.any(String));
                    expect(results[0].pid).toEqual(jasmine.any(Number));
                    expect(results[0].uuid).toEqual(jasmine.any(String));
                    expect(results[0].sessionID).toEqual(jasmine.any(String));
                    expect(results[0].service).toBe('collateral');
                    expect(results[0].version).toEqual(jasmine.any(String));
                    expect(results[0].data).toEqual({route: blockConfig.desc,
                                                     params: blockConfig.params, query: {} });
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should upload a different file if it has different contents', function(done) {
                files.testFile = samples[1].path;
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, name: 'testFile', path: 'collateral/userFiles/e2e-user/' + samples[1].etag + '.jpg'}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"' + samples[1].etag + '"');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should be able to upload multiple files', function(done) {
                files.newFile = samples[1].path;
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    resp.body.sort(function(a, b) { return a.path < b.path ? -1 : 1; });
                    expect(resp.body).toEqual([
                        {code: 201, name: 'testFile', path: 'collateral/userFiles/e2e-user/' + samples[0].etag + '.jpg'},
                        {code: 201, name: 'newFile', path: 'collateral/userFiles/e2e-user/' + samples[1].etag + '.jpg'}
                    ]);
                    rmList.push(resp.body[0].path);
                    rmList.push(resp.body[1].path);
                    return q.all([
                        requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)}),
                        requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[1].path)})
                    ]);
                }).then(function(resps) {
                    expect(resps[0].response.statusCode).toBe(200);
                    expect(resps[0].response.headers.etag).toBe('"' + samples[0].etag + '"');
                    expect(resps[1].response.statusCode).toBe(200);
                    expect(resps[1].response.headers.etag).toBe('"' + samples[1].etag + '"');
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });

            it('should not forcibly set the file extension', function(done) {
                files = { testFile: samples[0].path.replace('.jpg', '') };
                fs.renameSync(samples[0].path, samples[0].path.replace('.jpg', ''));
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, name: 'testFile', path: 'collateral/userFiles/e2e-user/' + samples[0].etag}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                    fs.removeSync(samples[0].path.replace('.jpg', ''));
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    fs.removeSync(samples[0].path.replace('.jpg', ''));
                    done();
                });
            });

            it('should throw a 415 if a non-image file is provided', function(done) {
                files = { testFile: './fake.jpg' };
                fs.writeFileSync('./fake.jpg', "Ceci n'est pas une jpeg");
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(415);
                    expect(resp.body).toEqual([{code: 415, name: 'testFile', error: 'Unsupported file type'}]);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(function() {
                    fs.removeSync('./fake.jpg');
                    done();
                });
            });

            it('should throw a 400 if no files are provided', function(done) {
                files = {};
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toEqual('Must provide files to upload');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should throw a 401 if the user is not logged in', function(done) {
                delete options.jar;
                requestUtils.qRequest('post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(401);
                    expect(resp.body).toEqual('Unauthorized');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should allow an app to upload a file', function(done) {
                delete options.jar;
                requestUtils.makeSignedRequest(appCreds, 'post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, name: 'testFile', path: 'collateral/userFiles/app-e2e-collateral/' + samples[0].etag + '.jpg'}]);
                    rmList.push(resp.body[0].path);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            it('should fail if an app uses the wrong secret to make a request', function(done) {
                var badCreds = { key: mockApp.key, secret: 'WRONG' };
                requestUtils.makeSignedRequest(badCreds, 'post', options, files).then(function(resp) {
                    expect(resp.response.statusCode).toBe(401);
                    expect(resp.body).toBe('Unauthorized');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });

            afterAll(function(done) {
                q.all(samples.map(function(img) {
                    return q.npost(fs, 'remove', [img.path]);
                })).then(function(results) {
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });
        });
    });

    describe('POST /api/collateral/uri', function() {
        var options, samples, rmList;
        var success, failure;
        var apiResponse;

        function noArgs(fn) {
            return function() {
                return fn();
            };
        }

        beforeEach(function() {
            options = {
                url: config.collateralUrl + '/collateral/uri',
                json: {},
                jar: cookieJar
            };
            rmList = [];

            samples = [
                {
                    url: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg',
                    etag: '618475c6c98297a486607bc654052447'
                },
                {
                    url: 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample2.jpg',
                    etag: 'f538387c355263cb915d6a3cc4b42592'
                }
            ];

            success = jasmine.createSpy('success()').and.callFake(function(response) {
                apiResponse = response;
                if (response.body.path) { rmList.push(response.body.path); }
            });
            failure = jasmine.createSpy('failure()').and.callFake(function(error) {
                console.error(error);
            });

            apiResponse = null;
        });

        afterEach(function(done) {
            return q.all(rmList.map(function(key) {
                return testUtils.removeS3File(bucket, key);
            })).done(function() { done(); });
        });

        describe('if called with a valid image URI', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = samples[0].url;

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 201', function() {
                var response = success.calls.mostRecent().args[0];

                expect(response.response.statusCode).toBe(201);
                expect(response.body).toEqual({
                    path: 'collateral/userFiles/e2e-user/' + samples[0].etag + '.jpg'
                });
            });

            it('should upload the image to S3', function(done) {
                done = noArgs(done);

                requestUtils.qRequest('head', {
                    url: 'https://s3.amazonaws.com/' + path.join(bucket, apiResponse.body.path)
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).finally(done);
            });
        });

        describe('if called with a URI with a query param', function() {
            beforeEach(function(done) {
                options.json.uri = samples[0].url + '?foo=bar';

                requestUtils.qRequest('post', options).then(success, failure).finally(done);
            });

            it('should not upload the image with the query param', function(done) {
                var response = success.calls.mostRecent().args[0];

                expect(response.response.statusCode).toBe(201);
                expect(response.body).toEqual({
                    path: 'collateral/userFiles/e2e-user/' + samples[0].etag + '.jpg'
                });

                requestUtils.qRequest('head', {
                    url: 'https://s3.amazonaws.com/' + path.join(bucket, response.body.path)
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                }).then(done, done.fail);
            });
        });

        describe('if called with no uri', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                delete options.json.uri;

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 400', function() {
                expect(apiResponse.response.statusCode).toBe(400);
                expect(apiResponse.body).toBe('No image URI specified.');
            });
        });

        describe('if called with an invalid URI', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = 'f892y34hr8394r';

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 400', function() {
                expect(apiResponse.response.statusCode).toBe(400);
                expect(apiResponse.body).toBe('"' + options.json.uri + '" is not a valid URI.');
            });
        });

        describe('if called with a data: URI', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==';

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 400', function() {
                expect(apiResponse.response.statusCode).toBe(400);
                expect(apiResponse.body).toBe('"' + options.json.uri + '" is not a valid URI.');
            });
        });

        describe('if called with the URI of a non-image', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/foo.txt';

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 415', function() {
                expect(apiResponse.response.statusCode).toBe(415);
                expect(apiResponse.body).toBe('File [https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/foo.txt] is not an image.');
            });
        });

        describe('if called with the URI of an image that is too large', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/too-big.png';

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 413', function() {
                expect(apiResponse.response.statusCode).toBe(413);
                expect(apiResponse.body).toBe('File [https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/too-big.png] is too large (26187322 bytes.)');
            });
        });

        describe('if called with the URI of an image that does not exist', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                options.json.uri = 'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/does-not-exist.png';

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 400', function() {
                expect(apiResponse.response.statusCode).toBe(400);
                expect(apiResponse.body).toBe('Could not fetch image from "https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/does-not-exist.png."');
            });
        });

        describe('if the user is not logged in', function() {
            beforeEach(function(done) {
                done = noArgs(done);
                delete options.jar;

                requestUtils.qRequest('post', options).then(success, failure).then(done, done);
            });

            it('should respond with a 401', function() {
                expect(apiResponse.response.statusCode).toBe(401);
                expect(apiResponse.body).toBe('Unauthorized');
            });
        });

        it('should allow an app to upload a reupload a valid image uri', function(done) {
            delete options.jar;
            options.json.uri = samples[0].url;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    path: 'collateral/userFiles/app-e2e-collateral/' + samples[0].etag + '.jpg'
                });
                rmList.push(resp.body.path);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    [
        {
            desc: 'GET /api/collateral/website-data',
            endpoint: '/collateral/website-data',
            isPublic: false
        },
        {
            desc: 'GET /api/public/collateral/website-data',
            endpoint: '/public/collateral/website-data',
            isPublic: true
        }
    ].forEach(function(blockConfig) {
        describe(blockConfig.desc, function() {
            var options;
            var success, failure;
            var apiResponse;

            beforeEach(function() {
                options = {
                    url: config.collateralUrl + blockConfig.endpoint,
                    qs: {},
                    json: true,
                    jar: blockConfig.isPublic ? false : cookieJar
                };

                success = jasmine.createSpy('success()').and.callFake(function(response) {
                    apiResponse = response;
                });
                failure = jasmine.createSpy('failure()').and.callFake(function(error) {
                    console.error(error);
                });

                apiResponse = null;
            });

            describe('if called with a valid website URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/toyota.html';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.body).toEqual({
                        links: {
                            website: 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/toyota.html',
                            facebook: 'http://www.facebook.com/toyota',
                            twitter: 'http://twitter.com/toyota',
                            instagram: 'http://instagram.com/toyotausa/',
                            youtube: 'http://www.youtube.com/user/ToyotaUSA',
                            pinterest: null,
                            google: 'https://plus.google.com/+toyotausa/',
                            tumblr: null
                        },
                        images: {
                            profile: jasmine.any(String)
                        }
                    });
                    // Asserting that the profile image is a valid URL without making any assumptions
                    // about what it is.
                    expect(parseURL(apiResponse.body.images.profile)).toEqual(jasmine.objectContaining({
                        protocol: jasmine.any(String),
                        host: jasmine.any(String),
                        pathname: jasmine.any(String)
                    }));
                });
            });

            describe('if called with no URI', function() {
                beforeEach(function(done) {
                    delete options.qs.uri;

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('Must specify a URI.');
                });
            });

            describe('if the upstream server responds with a failing status code', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/I_DONT_EXIST_UGHHHHHH.html';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('Upstream server responded with status code [404].');
                });
            });

            describe('if called with something that is not actually a URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = '97erfg738trh784';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI [' + options.qs.uri + '] is not valid.');
                });
            });

            describe('if called with a non-existant address', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'http://evansux.reelcontent.com/';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('Upstream server not found.');
                });
            });

            if(blockConfig.isPublic) {
                it('should set appropriate headers on the response', function(done) {
                    options.qs.uri = 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/toyota.html';
                    requestUtils.qRequest('get', options).then(function(apiResponse) {
                        expect(apiResponse.response.headers['cache-control']).toBe('max-age=300');
                        expect(apiResponse.response.headers['access-control-allow-origin']).toBe('*');
                    }).then(done, done.fail);
                });
            } else {
                describe('if the user is not logged in', function() {
                    beforeEach(function(done) {
                        delete options.jar;

                        requestUtils.qRequest('get', options).then(success, failure).then(done, done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });

                it('should allow an app to get website data for a valid uri', function(done) {
                    delete options.jar;
                    options.qs.uri = 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/toyota.html';
                    requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.body).toEqual({
                            links: {
                                website: 'https://s3.amazonaws.com/c6.dev/e2e/samplePages/toyota.html',
                                facebook: 'http://www.facebook.com/toyota',
                                twitter: 'http://twitter.com/toyota',
                                instagram: 'http://instagram.com/toyotausa/',
                                youtube: 'http://www.youtube.com/user/ToyotaUSA',
                                pinterest: null,
                                google: 'https://plus.google.com/+toyotausa/',
                                tumblr: null
                            },
                            images: {
                                profile: jasmine.any(String)
                            }
                        });
                    }).catch(function(error) {
                        expect(util.inspect(error)).not.toBeDefined();
                    }).done(done);
                });
            }
        });
    });

    describe('GET /api/collateral/video-data', function() {
        var options;
        var success, failure;
        var apiResponse;

        beforeEach(function() {
            options = {
                url: config.collateralUrl + '/collateral/video-data',
                qs: {},
                json: true,
                jar: cookieJar
            };

            success = jasmine.createSpy('success()').and.callFake(function(response) {
                apiResponse = response;
            });
            failure = jasmine.createSpy('failure()').and.callFake(function(error) {
                console.error(error);
            });

            apiResponse = null;

        });

        describe('unauthenticated', function() {
            beforeEach(function() {
                options.jar = false;
            });

            it('should [401]', function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.response.statusCode).toBe(401);
                    expect(apiResponse.body).toBe('Unauthorized');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);

            });
        });

        describe('when missing key', function () {
            beforeEach(function() {
                options.qs.uri = 'https://www.instagram.com/p/BGhQhO2HDyZ/?taken-by=prissy_pig';
                options.qs.type = 'instagram';
            });
            it ('should [500]', function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.response.body).toBe('Error getting metadata');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        describe('when video type is facebook', function () {
            beforeEach(function() {
                options.qs.uri = 'https://www.facebook.com/reelc/videos/1710824435853560/';
                options.qs.type = 'facebook';
            });
            it ('should get metadata for a facebook video', function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.body).toEqual(jasmine.objectContaining({
                        type: 'facebook',
                        id: '1710824435853560',
                        uri: 'https://www.facebook.com/reelc/videos/1710824435853560/',
                        title: 'Get More Customers with Custom Video Ads',
                        description: 'Want to reach a broader audience and get more customers? It\'s as easy as 1, 2, 3...',
                        duration: 31.308
                    }));
                    expect(apiResponse.response.statusCode).toBe(200);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        describe('when video type is youtube', function () {
            beforeEach(function() {
                options.qs.uri = 'https://www.youtube.com/watch?v=v9grnO07aCE&feature=youtu.be';
                options.qs.type = 'youtube';
            });
            it ('should get metadata for a youtube video', function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.body).toEqual(jasmine.objectContaining({
                            id: 'v9grnO07aCE',
                            uri: 'https://www.youtube.com/watch?v=v9grnO07aCE&feature=youtu.be',
                            title: 'Easy Video Advertising',
                            description: 'Promote your videos in rich engaging format and get more customers!\n\nhttp://goo.gl/CHL8lE',
                            duration: 31
                    }));
                    expect(apiResponse.response.statusCode).toBe(200);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

        });

        describe ('if missing URI and ID params', function() {
            beforeEach(function() {
                options.qs.type = 'facebook';
                delete options.qs.uri;
                delete options.qs.id;
            });
            it('should not call metagetta',function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.response.body).toBe('Must specify either a URI or id.');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        describe ('if missing type param', function() {
            beforeEach(function() {
                delete options.qs.type;
                options.qs.uri = 'https://www.facebook.com/reelc/videos/1710824435853560/';
            });
            it ('should still get metadata with valid uri', function(done) {
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.body).toEqual(jasmine.objectContaining({
                        type: 'facebook',
                        id: '1710824435853560',
                        uri: 'https://www.facebook.com/reelc/videos/1710824435853560/',
                        title: 'Get More Customers with Custom Video Ads',
                        description: 'Want to reach a broader audience and get more customers? It\'s as easy as 1, 2, 3...',
                        duration: 31.308,
                    }));
                    expect(apiResponse.response.statusCode).toBe(200);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        describe ('if given an unsupported video type', function() {
            beforeEach(function() {
                options.qs.type = 'notavideo';
                options.qs.uri = 'https://www.facebook.com/reelc/videos/1710824435853560/';
            });
            it('should still get metadata with valid uri ',function(done){
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.body).toEqual(jasmine.objectContaining({
                        type: 'facebook',
                        id: '1710824435853560',
                        uri: 'https://www.facebook.com/reelc/videos/1710824435853560/',
                        title: 'Get More Customers with Custom Video Ads',
                        description: 'Want to reach a broader audience and get more customers? It\'s as easy as 1, 2, 3...',
                        duration: 31.308,

                    }));
                    expect(apiResponse.response.statusCode).toBe(200);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        describe ('if given an invalid uri', function() {
            beforeEach(function() {
                options.qs.type = 'youtube';
                options.qs.uri = 'notauri';
            });
            it('should throw an error ',function(done){
                requestUtils.qRequest('get', options).then(function(apiResponse) {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.response.body).toBe('Error getting metadata');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

    });

    [
        {
            desc: 'GET /api/collateral/product-data',
            endpoint: '/collateral/product-data',
            isPublic: false
        },
        {
            desc: 'GET /api/public/collateral/product-data',
            endpoint: '/public/collateral/product-data',
            isPublic: true
        }
    ].forEach(function(blockConfig) {
        describe(blockConfig.desc, function() {
            var options;
            var success, failure;
            var apiResponse;

            beforeEach(function() {
                options = {
                    url: config.collateralUrl + blockConfig.endpoint,
                    qs: {},
                    json: true,
                    jar: blockConfig.isPublic ? false : cookieJar
                };

                success = jasmine.createSpy('success()').and.callFake(function(response) {
                    apiResponse = response;
                });
                failure = jasmine.createSpy('failure()').and.callFake(function(error) {
                    console.error(error);
                });

                apiResponse = null;
            });

            if(blockConfig.isPublic) {
                it('should set appropriate headers on the response', function(done) {
                    options.qs.uri = 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8';
                    requestUtils.qRequest('get', options).then(function(apiResponse) {
                        expect(apiResponse.response.headers['cache-control']).toBe('max-age=300');
                        expect(apiResponse.response.headers['access-control-allow-origin']).toBe('*');
                    }).then(done, done.fail);
                });
            } else {
                describe('unauthenticated', function() {
                    beforeEach(function(done) {
                        options.jar = false;

                        requestUtils.qRequest('get', options).then(success, failure).finally(done);
                    });

                    it('should [401]', function() {
                        expect(apiResponse.response.statusCode).toBe(401);
                        expect(apiResponse.body).toBe('Unauthorized');
                    });
                });
            }

            describe('with no URI', function() {
                beforeEach(function(done) {
                    delete options.qs.uri;

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI is required.');
                });
            });

            describe('with a non-URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'this is not a URI.';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI is invalid.');
                });
            });

            describe('with an id-less App Store URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://itunes.apple.com/us/app/super-arc-light';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI has no ID.');
                });
            });

            describe('with an id-less Etsy URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://www.etsy.com/listing/277003994/huge-grab-bag-assorted-supplies-over-100?ref=featured_listings_row';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI is not for a shop.');
                });
            });

            describe('with a non-app App Store URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://itunes.apple.com/us/album/babel/id547449573';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI is not for an app.');
                });
            });

            describe('with a non-existent App', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://itunes.apple.com/us/app/facebook/id28488221584637?mt=8';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [404]', function() {
                    expect(apiResponse.response.statusCode).toBe(404);
                    expect(apiResponse.body).toBe('No app found with that ID.');
                });
            });

            describe('with a non-existent Etsy store', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://www.etsy.com/shop/jewf8934yhr8934hr49';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [404]', function() {
                    expect(apiResponse.response.statusCode).toBe(404);
                    expect(apiResponse.body).toBe('No store found with that name.');
                });
            });

            describe('with a URI from an unsupported platform', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://platform.reelcontent.com/api/public/players/solo?card=rc-411c18b3042409&preview=true';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [400]', function() {
                    expect(apiResponse.response.statusCode).toBe(400);
                    expect(apiResponse.body).toBe('URI is not from a valid platform.');
                });
            });

            describe('with an App Store app URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.body).toEqual({
                        type: 'app',
                        platform: 'iOS',
                        name: 'Facebook',
                        developer: 'Facebook, Inc.',
                        description: jasmine.any(String),
                        uri: 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8&uo=4',
                        categories: ['Social Networking'],
                        price: 'Free',
                        rating: jasmine.any(Number),
                        extID: 284882215,
                        ratingCount: jasmine.any(Number),                        
                        bundleId: jasmine.any(String),
                        images: jasmine.any(Array)
                    });
                    expect(apiResponse.body.images.length).toBeGreaterThan(0, 'App has no images.');
                    apiResponse.body.images.forEach(function(image) {
                        expect(image.uri).toEqual(jasmine.any(String));
                        expect(image.type).toMatch(/^(screenshot|thumbnail)$/, 'Image is not a screenshot or thumbnail.');
                        expect(image.device).toMatch(/^(phone|tablet|undefined)$/, 'Image device is not "phone," "tablet" or undefined.');
                    });
                });
            });

            describe('with an Etsy shop URI', function() {
                beforeEach(function(done) {
                    options.qs.uri = 'https://www.etsy.com/shop/BohemianFindings';

                    requestUtils.qRequest('get', options).then(success, failure).finally(done);
                });

                it('should [200]', function() {
                    expect(apiResponse.response.statusCode).toBe(200);
                    expect(apiResponse.body).toEqual({
                        type: 'ecommerce',
                        platform: 'etsy',
                        name: 'BohemianFindings',
                        description: jasmine.any(String),
                        uri: 'https://www.etsy.com/shop/BohemianFindings?utm_source=cinema6&utm_medium=api&utm_campaign=api',
                        extID: 6004422,
                        products: jasmine.any(Array)
                    });
                    expect(apiResponse.body.products.length).toBeGreaterThan(0, 'The store has no featured products!');
                    apiResponse.body.products.forEach(function(product, index) {
                        expect(product).toEqual({
                            name: jasmine.any(String),
                            description: jasmine.any(String),
                            uri: jasmine.stringMatching(/^https:\/\/www\.etsy\.com\/listing\//),
                            categories: jasmine.arrayContaining([jasmine.any(String)]),
                            price: jasmine.stringMatching(/^\$\d*\.?\d*/),
                            extID: jasmine.any(Number),
                            images: jasmine.any(Array)
                        }, 'Failed for products[' + index + ']');

                        expect(product.images.length).toBeGreaterThan(0, 'products[' + index + '] has no images!');
                        product.images.forEach(function(image, imageIndex) {
                            expect(image).toEqual({
                                uri: jasmine.stringMatching(/^https:\/\/img\d\.etsystatic\.com\//),
                                averageColor: jasmine.stringMatching(/^[0-9A-Z]{6}$/)
                            }, 'Failed for products[' + index + '].images[' + imageIndex + ']');
                        });
                    });
                });
            });
        });
    });

    [
        {
            desc: 'POST /api/collateral/splash/:expId',
            endpoint: '/collateral/splash/e-1234',
            params: { expId: 'e-1234' }
        },
        {
            desc: 'POST /api/collateral/splash',
            endpoint: '/collateral/splash',
            params: {}
        }
    ].forEach(function(blockConfig) {
        describe(blockConfig.desc, function() {
            var rmList, options, samples, reqBody;

            beforeEach(function() {
                samples = [
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg',
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample2.jpg',
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample3.jpg',
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample4.jpg',
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample5.jpg',
                    'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample6.jpg'
                ];
                reqBody = {thumbs: [samples[0]], imageSpecs: [{height: 300, width: 300, ratio: '__e2e'}]};
                options = {url:config.collateralUrl+blockConfig.endpoint,json:reqBody,jar:cookieJar};
                rmList = [];
            });

            afterEach(function(done) {
                return q.all(rmList.map(function(key) {
                    return testUtils.removeS3File(bucket, key);
                })).thenResolve().done(done);
            });

            it('should throw a 400 if the request is incomplete', function(done) {
                var bodies = [
                    { thumbs: [samples[0]] },
                    { imageSpecs: reqBody.imageSpecs },
                    { imageSpecs: [{height: 300, ratio: '__e2e'}], thumbs: [samples[0]] }
                ];
                q.all(bodies.map(function(body) {
                    options.json = body;
                    return requestUtils.qRequest('post', options);
                })).then(function(results) {
                    expect(results[0].response.statusCode).toBe(400);
                    expect(results[0].response.body).toBe('Must provide imageSpecs to create splashes for');
                    expect(results[1].response.statusCode).toBe(400);
                    expect(results[1].response.body).toBe('Must provide thumbs to create splashes from');
                    expect(results[2].response.statusCode).toBe(400);
                    expect(results[2].response.body).toEqual([{code: 400, ratio: '__e2e',
                                                               error: 'Must provide complete imgSpec'}]);
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should throw a 400 if the ratio name is invalid', function(done) {
                options.json.imageSpecs[0].ratio = 'foo';
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toEqual([{code: 400, ratio: 'foo', error: 'Invalid ratio name'}]);
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should generate a splash image', function(done) {
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, ratio: '__e2e', path: 'collateral/userFiles/e2e-user/1ac1b4765354b78678dac5f83a008892.jpg'}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"1ac1b4765354b78678dac5f83a008892"');
                    expect(resp.response.headers['cache-control']).toBe('max-age=31556926');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should write an entry to the audit collection', function(done) {
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    rmList.push(resp.body[0].path);
                    return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
                }).then(function(results) {
                    expect(results[0].user).toBe('e2e-user');
                    expect(results[0].created).toEqual(jasmine.any(Date));
                    expect(results[0].host).toEqual(jasmine.any(String));
                    expect(results[0].pid).toEqual(jasmine.any(Number));
                    expect(results[0].uuid).toEqual(jasmine.any(String));
                    expect(results[0].sessionID).toEqual(jasmine.any(String));
                    expect(results[0].service).toBe('collateral');
                    expect(results[0].version).toEqual(jasmine.any(String));
                    expect(results[0].data).toEqual({route: blockConfig.desc,
                                                     params: blockConfig.params, query: {} });
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should work if regenerating a splash image', function(done) {
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, ratio: '__e2e', path: 'collateral/userFiles/e2e-user/1ac1b4765354b78678dac5f83a008892.jpg'}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('post', options);
                }).then(function(resp) {
                    expect(resp.body).toEqual([{code: 201, ratio: '__e2e', path: 'collateral/userFiles/e2e-user/1ac1b4765354b78678dac5f83a008892.jpg'}]);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"1ac1b4765354b78678dac5f83a008892"');
                    expect(resp.response.headers['cache-control']).toBe('max-age=31556926');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should be able to handle protocol-relative urls', function(done) {
                options.json.thumbs = ['//s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg'];
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, ratio: '__e2e', path: 'collateral/userFiles/e2e-user/1ac1b4765354b78678dac5f83a008892.jpg'}]);
                    rmList.push(resp.body[0].path);
                    return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"1ac1b4765354b78678dac5f83a008892"');
                    expect(resp.response.headers['cache-control']).toBe('max-age=31556926');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should be able to generate splash images at different sizes', function(done) {
                options.json.imageSpecs = [
                    {height: 600, width: 600, ratio: '__e2e', name: 'imgA', etag: '273077b32f8fef2e6c730993f7a9a7f0'},
                    {height: 1000, width: 1000, ratio: '__e2e', name: 'imgB', etag: 'fc843376ada4a815ace6e645b551ccfa'},
                    {height: 80, width: 80, ratio: '__e2e', name: 'imgC', etag: 'b22555d2412dc29ca058dc1971a87742'},
                    {height: 400, width: 400, ratio: '__e2e', name: 'imgD', etag: '7e3d1c4546394e10c1c95ba59aa78496'}
                ];
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    return q.all(resp.body.map(function(respObj, index) {
                        var imgSpec = options.json.imageSpecs[index];
                        expect(respObj).toEqual({code: 201, ratio: '__e2e',
                                                 path: 'collateral/userFiles/e2e-user/' + imgSpec.etag + '.jpg'});
                        rmList.push(respObj.path);
                        return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, respObj.path)})
                        .then(function(s3Resp) {
                            expect(s3Resp.response.statusCode).toBe(200);
                            expect(s3Resp.response.headers.etag).toBe('"' + imgSpec.etag + '"');
                        });
                    })).then(function(results) {
                        done();
                    });
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should be able to generate splash images with multiple thumbs', function(done) {
                options.url += '?versionate=true';
                var etags = [
                    '1ac1b4765354b78678dac5f83a008892',
                    'f7e6da5b1cf6ceade95c96e7793aca8c',
                    'd7042320ccd90eda24b26e94b5012766',
                    '7c46ae535dbf56bf44d83aa26b6433f6',
                    '304f8ba0d5ccd4d8365d6bc8e4edb5e8',
                    'aa90445ca7d2d7e9fc995eaaa7c11b43',
                    'aa90445ca7d2d7e9fc995eaaa7c11b43'
                ];
                q.all(etags.map(function(etag, index) {
                    options.json.thumbs = samples.slice(0, index + 1);
                    if (index === 6) options.json.thumbs.push(samples[5]);
                    return requestUtils.qRequest('post', options).then(function(resp) {
                        expect(resp.response.statusCode).toBe(201);
                        expect(resp.body).toEqual([{code: 201, ratio: '__e2e',
                                                   path: 'collateral/userFiles/e2e-user/' + etag + '.jpg'}]);
                        rmList.push(resp.body[0].path);
                        return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
                    }).then(function(resp) {
                        expect(resp.response.statusCode).toBe(200);
                        expect(resp.response.headers.etag).toBe('"' + etag + '"');
                    }).catch(function(error) {
                        expect(error).not.toBeDefined();
                    });
                })).then(function() {
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should throw a 401 if the user is not logged in', function(done) {
                delete options.jar;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(401);
                    expect(resp.body).toEqual('Unauthorized');
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });

            it('should allow an app to generate splash a splash image', function(done) {
                delete options.jar;
                requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual([{code: 201, ratio: '__e2e', path: 'collateral/userFiles/app-e2e-collateral/1ac1b4765354b78678dac5f83a008892.jpg'}]);
                    rmList.push(resp.body[0].path);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
    });

    describe('POST /api/collateral/setHeaders', function() {
        var options, params;
        beforeEach(function(done) {
            options = {
                url: config.collateralUrl + '/collateral/setHeaders',
                json: { path: 'collateral/e-1234/test.txt', 'max-age': 2000 },
                jar: cookieJar
            };
            params = {
                Bucket: bucket,
                Key: 'collateral/e-1234/test.txt',
                ACL: 'public-read',
                ContentType: 'text/plain',
                CacheControl: 'max-age=0'
            };
            fs.writeFileSync(path.join(__dirname, 'test.txt'), 'This is a test');
            testUtils.putS3File(params, path.join(__dirname, 'test.txt')).thenResolve().done(done);
        });

        afterEach(function(done) {
            fs.removeSync(path.join(__dirname, 'test.txt'));
            testUtils.removeS3File(bucket, 'collateral/e-1234/test.txt').thenResolve().done(done);
        });

        it('should set the CacheControl header to a custom value', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('collateral/e-1234/test.txt');
                return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['cache-control']).toBe('max-age=2000');
                expect(resp.response.headers['content-type']).toBe('text/plain');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('collateral');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/collateral/setHeaders',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use a default CacheControl if not provided', function(done) {
            delete options.json['max-age'];
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('collateral/e-1234/test.txt');
                return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['cache-control']).toBe('max-age=31556926');
                expect(resp.response.headers['content-type']).toBe('text/plain');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 404 if the file is not found', function(done) {
            options.json.path = 'collateral/e-1234/fake.txt';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('File not found');
                return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, 'collateral/e-1234/test.txt')});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['cache-control']).toBe('max-age=0');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 if the user is not logged in', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should allow an app to set headers', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('collateral/e-1234/test.txt');
                return requestUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers['cache-control']).toBe('max-age=2000');
                expect(resp.response.headers['content-type']).toBe('text/plain');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
