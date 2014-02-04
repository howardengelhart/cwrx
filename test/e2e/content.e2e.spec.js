var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    config      = {
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/content',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/auth',
        maintUrl    : 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint'
    };

jasmine.getEnv().defaultTimeoutInterval = 5000;

describe('content (E2E):', function() {
    var testNum = 0,
        cookieJar;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        var mockUser = {
            id: "e2e-user",
            status: "active",
            username : "contentE2EUser",
            password : "$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq", // hash of 'password'
            permissions: {
                createExperience: true,
                deleteExperience: true
            }
        };
        var resetOpts = {
            url: config.maintUrl + '/reset_collection',
            json: {
                collection: 'users',
                data: mockUser
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                username: 'contentE2EUser',
                password: 'password'
            }
        };
        testUtils.qRequest('post', resetOpts).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'content.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing content log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('content.log', config.maintUrl, jasmine.getEnv().currentSpec, 'content', ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });
    
    describe('public GET /content/experiences/:id', function() {
        beforeEach(function(done) {
            var mockExp = {
                id: "e2e-1",
                title: "test experience",
                access: "public",
                status: "active",
                e2e: true
            };
            var options = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "experiences",
                    data: mockExp
                }
            };
            testUtils.qRequest('post', options).done(function() {
                done();
            });
        });
        
        it('should get an experience by id', function(done) {
            var options = {
                url: config.contentUrl + '/experiences/e2e-1?noCache=true'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-1");
                expect(resp.body[0].title).toBe("test experience");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not get an experience that is private or inactive', function(done) {
            var mockExps = [
                {
                    id: "e2e-1",
                    status: "inactive",
                    access: "public"
                },
                {
                    id: "e2e-2",
                    status: "active",
                    access: "private"
                }
            ];
            var resetOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: 'experiences',
                    data: mockExps
                }
            };

            testUtils.qRequest('post', resetOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = {url: config.contentUrl + '/experiences/e2e-1?noCache=true'};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(0);
                var options = {url: config.contentUrl + '/experiences/e2e-2?noCache=true'};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(0);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not return an error if nothing is found', function(done) {
            var options = {
                url: config.contentUrl + '/experiences/e2e-5678?noCache=true'
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(0);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('authenticated GET /content/experiences', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: "e2e-1",
                    status: "active",
                    access: "public",
                    user: "e2e-user",
                    tag: "foo"
                },
                {
                    id: "e2e-2",
                    status: "inactive",
                    access: "private",
                    user: "e2e-user"
                },
                {
                    id: "e2e-3",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user"
                },
                {
                    id: "e2e-4",
                    status: "inactive",
                    access: "private",
                    user: "not-e2e-user"
                }
            ];
            var resetExpsOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "experiences",
                    data: mockExps
                }
            };
            testUtils.qRequest('post', resetExpsOpts).done(function() {
                done();
            });
        });
    
        it('should find experiences using a query', function(done) {
            var options = {
                url: config.contentUrl + '/experiences?noCache=true&selector=' +
                         encodeURIComponent(JSON.stringify({tag: 'foo'})),
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-1");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to find multiple experiences using an array of options', function(done) {
            var options = {
                url: config.contentUrl + '/experiences?noCache=true&selector=' +
                         encodeURIComponent(JSON.stringify({id: ["e2e-1", "e2e-3"]})) +
                         '&sort=' + encodeURIComponent(JSON.stringify({id: 1})),
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-1");
                expect(resp.body[1].id).toBe("e2e-3");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should only get private or inactive experiences the user owns', function(done) {
            var options = {
                url: config.contentUrl + '/experiences?noCache=true&selector=' +
                        encodeURIComponent(JSON.stringify({id: ["e2e-2", "e2e-4"]})),
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-2");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authorized', function(done) {
            var options = {
                url: config.contentUrl + '/experiences?noCache=true&selector=' +
                         encodeURIComponent(JSON.stringify({id: "e2e-1"}))
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                jar: cookieJar,
                url: config.contentUrl + '/experiences?noCache=true&limit=2&sort=' +
                         encodeURIComponent(JSON.stringify({id: -1}))
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe("e2e-3");
                expect(resp.body[1].id).toBe("e2e-2");
                options.url += '&skip=2';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe("e2e-1");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('POST /content/experiences', function() {
        var mockExp;
        beforeEach(function(done) {
            mockExp = {
                title: "testExp"
            };
            var resetOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: 'experiences'
                }
            };
            testUtils.qRequest('post', resetOpts).done(function() {
                done();
            });
        });
        
        it('should be able to create an experience', function(done) {
            var options = {
                url: config.contentUrl + '/experiences',
                jar: cookieJar,
                json: mockExp
            };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.title).toBe("testExp");
                expect(resp.body.user).toBe("e2e-user");
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                expect(resp.body.access).toBe('public');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            }); 
        });
        
        it('should be able to create a private experience', function(done) {
            mockExp.access = 'private';
            var options = {
                url: config.contentUrl + '/experiences',
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
                expect(error.toString()).not.toBeDefined();
                done();
            }); 
        });
        
        it('should throw a 401 error if the user is not authorized', function(done) {
            var options = {
                url: config.contentUrl + '/experiences',
                json: mockExp
            };
            testUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
    });
    
    describe('PUT /content/experiences/:id', function() {
        var mockExps, now;
        beforeEach(function(done) {
            now = new Date();
            mockExps = [
                {
                    id: "e2e-1",
                    title: "origTitle",
                    tag: "foo",
                    status: "active",
                    access: "public",
                    created: now,
                    lastUpdated: now,
                    user: "e2e-user"
                },
                {
                    id: "e2e-2",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user"
                }
            ];
            var resetExpsOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "experiences",
                    data: mockExps
                }
            };
            testUtils.qRequest('post', resetExpsOpts).done(function() {
                done();
            });
        });
        
        it('should fully update an experience', function(done) {
            mockExps[0].title = "newTitle";
            delete mockExps[0].tag;
            var options = {
                url: config.contentUrl + '/experiences/e2e-1',
                jar: cookieJar,
                json: mockExps[0]
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                updatedExp = resp.body;
                expect(updatedExp).toBeDefined();
                expect(updatedExp.id).toBe('e2e-1');
                expect(updatedExp.title).toBe("newTitle");
                expect(updatedExp.tag).not.toBeDefined();
                expect(new Date(updatedExp.created)).toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                return testUtils.qRequest('get', {url: options.url += '?noCache=true'});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body[0]).toEqual(updatedExp);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should create an experience if it does not exist', function(done) {
            mockExps[0].id = "e2e-3";
            var options = {
                url: config.contentUrl + '/experiences/e2e-3',
                jar: cookieJar,
                json: mockExps[0]
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                updatedExp = resp.body;
                expect(updatedExp).toBeDefined();
                expect(updatedExp.id).toBe('e2e-3');
                expect(new Date(updatedExp.created)).not.toEqual(now);
                expect(new Date(updatedExp.lastUpdated)).toBeGreaterThan(now);
                return testUtils.qRequest('get', {url: options.url += '?noCache=true'});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body[0]).toEqual(updatedExp);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not update an experience the user does not own', function(done) {
            var options = {
                url: config.contentUrl + '/experiences/e2e-2',
                jar: cookieJar,
                json: mockExps[1]
            }, updatedExp;
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Not authorized to edit this experience");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authorized', function(done) {
            var options = {
                url: config.contentUrl + '/experiences/e2e-1',
                json: mockExps[0]
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /content/experiences/:id', function() {
        beforeEach(function(done) {
            var mockExps = [
                {
                    id: "e2e-1",
                    status: "active",
                    access: "public",
                    user: "e2e-user"
                },
                {
                    id: "e2e-2",
                    status: "active",
                    access: "public",
                    user: "not-e2e-user"
                }
            ];
            var resetExpsOpts = {
                url: config.maintUrl + '/reset_collection',
                json: {
                    collection: "experiences",
                    data: mockExps
                }
            };
            testUtils.qRequest('post', resetExpsOpts).done(function() {
                done();
            });
        });
        
        it('should set the status of an experience to deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/experiences/e2e-1'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Successfully deleted experience");
                options = {url: config.contentUrl + '/experiences/e2e-1?noCache=true'};
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(0);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not delete an experience the user does not own', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/experiences/e2e-2'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Not authorized to delete this experience");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 200 if the experience was already deleted', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/experiences/e2e-1'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("Successfully deleted experience");
                return testUtils.qRequest('del', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("That experience has already been deleted");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 200 if the experience does not exist', function(done) {
            var options = {jar: cookieJar, url: config.contentUrl + '/experiences/fake'};
            testUtils.qRequest('del', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBe("That experience does not exist");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authorized', function(done) {
            testUtils.qRequest('del', {url: config.contentUrl + '/experiences/e2e-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});
