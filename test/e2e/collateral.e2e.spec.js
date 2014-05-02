var q           = require('q'),
    fs          = require('fs-extra'),
    path        = require('path'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    bucket      = process.env.bucket || 'c6.dev',
    config      = {
        collateralUrl   : 'http://' + host + ':3600/api',
        authUrl         : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

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

        it('should upload a file', function(done) {
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({testFile: {code: 201, path: 'collateral/e2e-org/ce114e4501d2f4e2dcea3e17b546f339.test.txt'}});
                rmList.push(resp.body.testFile.path);
                return testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.testFile.path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('This is a test');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if reuploading a file', function(done) {
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({testFile: {code: 201, path: 'collateral/e2e-org/ce114e4501d2f4e2dcea3e17b546f339.test.txt'}});
                rmList.push(resp.body.testFile.path);
                return testUtils.qRequest('post', options, files);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({testFile: {code: 201, path: 'collateral/e2e-org/ce114e4501d2f4e2dcea3e17b546f339.test.txt'}});
                return testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.testFile.path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('This is a test');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should upload a new file if it has different contents', function(done) {
            fs.writeFileSync(files.testFile, 'This is a good test');
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({testFile: {code: 201, path: 'collateral/e2e-org/77815a86e0fdc3168df95ea8db6e3775.test.txt'}});
                rmList.push(resp.body.testFile.path);
                return testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.testFile.path)});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe('This is a good test');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to upload multiple files', function(done) {
            files.newFile = './foo.txt';
            fs.writeFileSync(files.newFile, 'Foobar is my fave thang');
            testUtils.qRequest('post', options, files).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    testFile: {code: 201, path: 'collateral/e2e-org/ce114e4501d2f4e2dcea3e17b546f339.test.txt'},
                    newFile: {code: 201, path: 'collateral/e2e-org/ad44a02eeeb5a2f5fadd6a3c9b743183.foo.txt'}
                });
                rmList.push(resp.body.testFile.path);
                rmList.push(resp.body.newFile.path);
                return q.all([
                    testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.testFile.path)}),
                    testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.newFile.path)}),
                ]);
            }).then(function(resps) {
                expect(resps[0].response.statusCode).toBe(200);
                expect(resps[0].body).toBe('This is a test');
                expect(resps[1].response.statusCode).toBe(200);
                expect(resps[1].body).toBe('Foobar is my fave thang');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
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
                expect(resp.body).toEqual({testFile: {code: 201, path: 'collateral/not-e2e-org/ce114e4501d2f4e2dcea3e17b546f339.test.txt'}});
                rmList.push(resp.body.testFile.path);
                return testUtils.qRequest('get', {url: 'https://s3.amazonaws.com/' + path.join(bucket, resp.body.testFile.path)});
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
});
