var q           = require('q'),
    fs          = require('fs-extra'),
    path        = require('path'),
    testUtils   = require('./testUtils'),
    request     = require('request'),
    host        = process.env['host'] || 'localhost',
    bucket      = process.env.bucket || 'c6.dev',
    config      = {
        collateralUrl   : 'http://' + (host === 'localhost' ? host + ':3600' : host) + '/api',
        authUrl         : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('collateral (E2E):', function() {
    var cookieJar, mockUser;
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'collateralE2EUser',
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
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'collateralE2EUser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUser).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
/**
 * Rather than keep updating two sets of nearly identical tests, I'm just going to remove the tests
 * for this deprecated endpoint. I'm leaving these two tests for the unique functionality here for
 * the future, should we need this endpoint again.
 */
/*
    describe('POST /api/collateral/files', function() {
        var files, rmList, options;
        
        beforeEach(function() {
            options = { url: config.collateralUrl + '/collateral/files', jar: cookieJar };
            rmList = [];
            files = { testFile: './test.txt' };
            fs.writeFileSync(files.testFile, 'This is a test');
        });
        
        afterEach(function(done) {
            Object.keys(files).forEach(function(key) {
                fs.removeSync(files[key]);
            });

            return q.all(rmList.map(function(key) {
                return testUtils.removeS3File(bucket, key);
            })).done(function() { done(); });
        });
        
        it('should throw a 403 if a non-admin user tries to upload to another org', function(done) {
            options.url += '?org=not-e2e-org';
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Cannot upload files to that org');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should allow an admin to upload files to another org', function(done) {
            options.url += '?org=not-e2e-org';
            mockUser.id = 'not-e2e-user';
            mockUser.email = 'adminE2EUser';
            mockUser.permissions.experiences.edit = 'all';
            var loginOpts = {
                url: config.authUrl + '/auth/login',
                jar: cookieJar,
                json: {
                    email: 'adminE2EUser',
                    password: 'password'
                }
            };
            testUtils.resetCollection('users', mockUser).then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.qRequest('post', options, files);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/not-e2e-org/test.txt'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('This is a test');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
*/

    describe('POST /api/collateral/files/:expId', function() {
        var files, rmList, options, samples;
        
        beforeEach(function(done) {
            options = { url: config.collateralUrl + '/collateral/files/e-1234', jar: cookieJar };
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
            Object.keys(files).forEach(function(key) {
                fs.removeSync(files[key]);
            });

            return q.all(rmList.map(function(key) {
                return testUtils.removeS3File(bucket, key);
            })).done(function() { done(); });
        });

        it('should upload a file', function(done) {
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/sample1.jpg'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should be able to versionate a file', function(done) {
            options.url += '?versionate=true';
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/' + samples[0].etag + '.sample1.jpg'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if reuploading a file', function(done) {
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/sample1.jpg'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('post', options, files);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/sample1.jpg'}]);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should upload a different versionated file if it has different contents', function(done) {
            options.url += '?versionate=true';
            files.testFile = samples[1].path;
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/' + samples[1].etag + '.sample2.jpg'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
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
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([
                    {name: 'testFile', code: 201, path: 'collateral/e-1234/sample1.jpg'},
                    {name: 'newFile', code: 201, path: 'collateral/e-1234/sample2.jpg'}
                ]);
                rmList.push(resp.body[0].path);
                rmList.push(resp.body[1].path);
                return q.all([
                    testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)}),
                    testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[1].path)})
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
        
        it('should set the file type correctly regardless of the original\'s extension', function(done) {
            files = { testFile: samples[0].path.replace('.jpg', '.png') };
            fs.renameSync(samples[0].path, samples[0].path.replace('.jpg', '.png'));
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual([{name: 'testFile', code: 201, path: 'collateral/e-1234/sample1.jpg'}]);
                rmList.push(resp.body[0].path);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body[0].path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"' + samples[0].etag + '"');
                fs.removeSync(samples[0].path.replace('.jpg', '.png'));
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                fs.removeSync(samples[0].path.replace('.jpg', '.png'));
                done();
            });
        });
        
        it('should throw a 415 if a non-image file is provided', function(done) {
            files = { testFile: './fake.jpg' };
            fs.writeFileSync('./fake.jpg', "Ceci n'est pas une jpeg");
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(415);
                expect(resp.body).toEqual([{name: 'testFile', code: 415, error: 'Unsupported file type'}]);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 400 if no files are provided', function(done) {
            files = {};
            testUtils.qRequest('post', options, files).then(function(resp) {
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
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        
        // THIS SHOULD ALWAYS GO LAST IN THIS DESCRIBE BLOCK
        it(': clean up after all these tests are done', function(done) {
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
    
    describe('POST /api/collateral/splash/:expId', function() {
        var rmList, options, samples;
        
        beforeEach(function() {
            samples = [
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample1.jpg',
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample2.jpg',
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample3.jpg',
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample4.jpg',
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample5.jpg',
                'https://s3.amazonaws.com/c6.dev/e2e/sampleThumbs/sample6.jpg'
            ];
            var reqBody = {size: {height: 300, width: 300}, ratio: '__e2e', thumbs: [samples[0]]};
            options = {url:config.collateralUrl+'/collateral/splash/e-1234',json:reqBody,jar:cookieJar};
            rmList = [];
        });
        
        afterEach(function(done) {
            return q.all(rmList.map(function(key) {
                return testUtils.removeS3File(bucket, key);
            })).done(function() { done(); });
        });
        
        it('should throw a 400 if the request is incomplete', function(done) {
            var bodies = [
                { size: { height: 300, width: 300 }, thumbs: [samples[0]] },
                { ratio: 'square', thumbs: [samples[0]] },
                { size: { height: 300, width: 300 }, ratio: 'square' }
            ];
            q.all(bodies.map(function(body) {
                options.json = body;
                return testUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].response.body).toBe('Must provide ratio name to choose template');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].response.body).toBe('Must provide size object with width + height');
                expect(results[2].response.statusCode).toBe(400);
                expect(results[2].response.body).toBe('Must provide thumbs to create splash from');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 400 if the ratio name is invalid', function(done) {
            options.json.ratio = 'foo';
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Invalid ratio name');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should generate a splash image', function(done) {
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual('collateral/e-1234/generatedSplash.jpg');
                rmList.push(resp.body);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"1ac1b4765354b78678dac5f83a008892"')
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should be able to versionate the splash image', function(done) {
            options.url += '?versionate=true';
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual('collateral/e-1234/1ac1b4765354b78678dac5f83a008892.generatedSplash.jpg');
                rmList.push(resp.body);
                return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.response.headers.etag).toBe('"1ac1b4765354b78678dac5f83a008892"');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to generate splash images at different sizes', function(done) {
            options.url += '?versionate=true';
            var profiles = [
                { size: { height: 600, width: 600 }, etag: '273077b32f8fef2e6c730993f7a9a7f0' },
                { size: { height: 1000, width: 1000 }, etag: 'fc843376ada4a815ace6e645b551ccfa' },
                { size: { height: 80, width: 80 }, etag: 'b22555d2412dc29ca058dc1971a87742' },
                { size: { height: 400, width: 400 }, etag: '7e3d1c4546394e10c1c95ba59aa78496' }
            ];
            q.all(profiles.map(function(profile) {
                options.json.size = profile.size;
                return testUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual('collateral/e-1234/' + profile.etag + '.generatedSplash.jpg');
                    rmList.push(resp.body);
                    return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.response.headers.etag).toBe('"' + profile.etag + '"');
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
        
        it('should be able to generate splash images with multiple thumbs', function(done) {
            options.url += '?versionate=true';
            var etags = [
                '1ac1b4765354b78678dac5f83a008892',
                'f7e6da5b1cf6ceade95c96e7793aca8c',
                'd7042320ccd90eda24b26e94b5012766',
                '7c46ae535dbf56bf44d83aa26b6433f6',
                '7c46ae535dbf56bf44d83aa26b6433f6',
                'aa90445ca7d2d7e9fc995eaaa7c11b43',
                'aa90445ca7d2d7e9fc995eaaa7c11b43'
            ];
            q.all(etags.map(function(etag, index) {
                options.json.thumbs = samples.slice(0, index + 1);
                if (index == 6) options.json.thumbs.push(samples[5]);
                return testUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    expect(resp.body).toEqual('collateral/e-1234/' + etag + '.generatedSplash.jpg');
                    rmList.push(resp.body);
                    return testUtils.qRequest('head', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body)});
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
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

    });
});
