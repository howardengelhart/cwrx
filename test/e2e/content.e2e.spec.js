var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

describe('content (E2E):', function() {
    var cookieJar;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        var mockUser = {
            id: "e2e-user",
            status: "active",
            email : "contentE2EUser",
            password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq", // hash of 'password'
            org: "e2e-org",
            permissions: {
                experiences: {
                    read: "org",
                    create: "own",
                    edit: "own",
                    delete: "own"
                }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: {
                email: 'contentE2EUser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', mockUser).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/public/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExp = {
                id: "e2e-pubget1",
                title: "test experience",
                access: "public",
                status: "active"
            };
            testUtils.resetCollection('experiences', mockExp).done(done);
        });
    
        it('should get an experience by id', function(done) {
            var options = {
                url: config.contentUrl + '/public/content/experience/e2e-pubget1'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe("e2e-pubget1");
                expect(resp.body.title).toBe("test experience");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not get an experience that is private or inactive', function(done) {
            var mockExps = [
                {
                    id: "e2e-pubget2",
                    status: "inactive",
                    access: "public"
                },
                {
                    id: "e2e-pubget3",
                    status: "active",
                    access: "private"
                }
            ];

            testUtils.resetCollection('experiences', mockExps).then(function() {
                var options = {url: config.contentUrl + '/public/content/experience/e2e-pubget2'};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No experiences found');
                var options = {url: config.contentUrl + '/public/content/experience/e2e-pubget3'};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/public/content/experience/e2e-getid5678'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('GET /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: "e2e-getid1",
                    title: "test experience",
                    access: "public",
                    status: "inactive",
                    user: "e2e-user"
                },
                {
                    id: "e2e-getid2",
                    title: "test experience",
                    access: "private",
                    status: "active",
                    user: "not-e2e-user"
                },
                {
                    id: "e2e-getid3",
                    title: "test experience",
                    access: "public",
                    status: "inactive",
                    user: "not-e2e-user"
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should get an experience by id', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-getid1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(typeof resp.body).toBe('object');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe("e2e-getid1");
                expect(resp.body.title).toBe("test experience");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should not get private or inactive experiences the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-getid2',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No experiences found');
                options.url = config.contentUrl + '/content/experience/e2e-getid3';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-getid1'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-getid5678',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('GET /api/content/experience', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: "e2e-getquery1",
                    status: "active",
                    access: "public",
                    user: "e2e-user",
                    org: "e2e-org",
                    type: "foo"
                },
                {
                    id: "e2e-getquery2",
                    status: "inactive",
                    access: "private",
                    user: "e2e-user",
                    org: "not-e2e-org",
                    type: "foo"
                },
                {
                    id: "e2e-getquery3",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user",
                    org: "e2e-org",
                    type: "bar"
                },
                {
                    id: "e2e-getquery4",
                    status: "inactive",
                    access: "private",
                    user: "not-e2e-user",
                    org: "not-e2e-org",
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should get multiple experiences by id', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery3&sort=id,1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe("e2e-getquery1");
                expect(resp.body[1].id).toBe("e2e-getquery3");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should get experiences by user', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user&sort=id,1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-getquery1");
                expect(resp.body[1].id).toBe("e2e-getquery2");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should get experiences by type', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?type=foo&sort=id,1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-getquery1");
                expect(resp.body[1].id).toBe("e2e-getquery2");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should get experiences by org', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?org=e2e-org&sort=id,1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-getquery1");
                expect(resp.body[1].id).toBe("e2e-getquery3");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should not get experiences by any other query param', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?status=active&sort=id,1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Must specify at least one supported query param');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should only get private or inactive experiences the user owns', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery2,e2e-getquery4',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-getquery2");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=e2e-user'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should return a 404 if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/content/experiences?user=hamboneHarry',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                jar: cookieJar,
                url: config.contentUrl + '/content/experiences?ids=e2e-getquery1,e2e-getquery2,e2e-getquery3' +
                                         '&limit=2&sort=id,-1'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-getquery3");
                expect(resp.body[1].id).toBe("e2e-getquery2");
                options.url += '&skip=2';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-getquery1");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('POST /api/content/experience', function() {
        var mockExp;
        beforeEach(function(done) {
            mockExp = {
                title: 'testExp',
                org: 'e2e-org'
            };
            testUtils.resetCollection('experiences').done(done);
        });
        
        it('should be able to create an experience', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience',
                jar: cookieJar,
                json: mockExp
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe("testExp");
                expect(resp.body.user).toBe("e2e-user");
                expect(resp.body.org).toBe("e2e-org");
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                expect(resp.body.access).toBe('public');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            }); 
        });
        
        it('should be able to create a private experience', function(done) {
            mockExp.access = 'private';
            var options = {
                url: config.contentUrl + '/content/experience',
                jar: cookieJar,
                json: mockExp
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe("testExp");
                expect(resp.body.access).toBe('private');
                expect(resp.body.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            }); 
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience',
                json: mockExp
            };
            testUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
    });
    
    describe('PUT /api/content/experience/:id', function() {
        var mockExps, now;
        beforeEach(function(done) {
            // created = yesterday to allow for clock differences b/t server and test runner
            now = new Date(new Date() - 24*60*60*1000);
            mockExps = [
                {
                    id: "e2e-put1",
                    title: "origTitle",
                    status: "active",
                    access: "public",
                    created: now,
                    lastUpdated: now,
                    user: "e2e-user"
                },
                {
                    id: "e2e-put2",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user"
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should successfully update an experience', function(done) {
            mockExps[0].title = "newTitle";
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                jar: cookieJar,
                json: { title: 'newTitle' }
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedExp = resp.body;
                expect(updatedExp).not.toEqual(mockExps);
                expect(updatedExp).toBeDefined();
                expect(updatedExp._id).not.toBeDefined();
                expect(updatedExp.id).toBe('e2e-put1');
                expect(updatedExp.title).toBe('newTitle');
                expect(updatedExp.user).toBe('e2e-user');
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not create an experience if it does not exist', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-putfake',
                jar: cookieJar,
                json: { title: 'fakeTitle' }
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe("That experience does not exist");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not update an experience the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put2',
                jar: cookieJar,
                json: { title: 'newTitle' }
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe("Not authorized to edit this experience");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: config.contentUrl + '/content/experience/e2e-put1',
                json: { title: 'newTitle' }
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /api/content/experience/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: "e2e-del1",
                    status: "active",
                    access: "public",
                    user: "e2e-user"
                },
                {
                    id: "e2e-del2",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user"
                }
            ];
            testUtils.resetCollection('experiences', mockExps).done(done);
        });
        
        it('should set the status of an experience to deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = {url: config.contentUrl + '/content/experience/e2e-del1', jar: cookieJar};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No experiences found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete an experience the user does not own', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del2'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe("Not authorized to delete this experience");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 204 if the experience was already deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/e2e-del1'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return testUtils.qRequest('del', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 204 if the experience does not exist', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/content/experience/fake'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            testUtils.qRequest('del', {url: config.contentUrl + '/content/experience/e2e-del1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
});
