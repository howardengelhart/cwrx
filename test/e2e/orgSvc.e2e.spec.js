var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        orgSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/account',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('org (E2E):', function() {
    var cookieJar, mockRequester, noPermsUser;
        
    beforeEach(function(done) {
        cookieJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'orgsvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        noPermsUser = {
            id: 'e2e-noPermsUser',
            status: 'active',
            email : 'orgsvce2enopermsuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                orgs: { read: 'own', create: 'own', edit: 'own', delete: 'own' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'orgsvce2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', [mockRequester, noPermsUser]).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
 
    afterEach(function(done) {
        var logoutOpts = {
            url: config.authUrl + '/logout',
            jar: cookieJar
        };
       testUtils.qRequest('post',logoutOpts)
        .done(function(){
            done();
        });
    });

    describe('GET /api/account/org/:id', function() {
        var mockOrg;
        beforeEach(function(done) {
            mockOrg = {
                id: 'o-1234',
                name: 'e2e-getId1',
                status: 'active',
                waterfalls: {video: ['cinema6'], display: ['cinema6']}
            };
            mockOrg2 = {
                id: 'o-1234'
            }
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', mockOrg);
            })
            .done(function(){
                done()
            });
        });
        
        it('should get an org by id', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            testUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockOrg);
                expect(resp.body.id).toBe('o-1234');
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.name).toBe('e2e-getId1');
                expect(resp.body.status).toBe('active');
                expect(resp.body.waterfalls).toEqual({video: ['cinema6'], display: ['cinema6']});
                expect(resp.response.headers['content-range']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should get an org even when multiple with the same id exist', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            testUtils.resetCollection('orgs', [mockOrg, mockOrg2]).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should not be able to get a deleted org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            mockOrg.status = 'deleted';
            testUtils.resetCollection('orgs', mockOrg).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if the requester cannot see the org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-4567', jar: cookieJar };
            mockOrg.id = 'e2e-getId2';
            testUtils.resetCollection('orgs', mockOrg).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = { url: config.orgSvcUrl + '/org/e2e-fake1', jar: cookieJar };
            testUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/e2e-fake1' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('GET /api/account/orgs', function() {
        var mockOrgs;
        beforeEach(function(done) {
            mockOrgs = [
                { id: 'o-1234', name: 'e2e-getOrg3' },
                { id: 'o-4567', name: 'e2e-getOrg2' },
                { id: 'o-7890', name: 'e2e-getOrg1' }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
            return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
        });
        
        it('should get orgs', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(3);
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('o-1234');
                expect(resp.body[0].name).toBe('e2e-getOrg3');
                expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('o-4567');
                expect(resp.body[1].name).toBe('e2e-getOrg2');
                expect(resp.body[2]._id).not.toBeDefined();
                expect(resp.body[2].id).toBe('o-7890');
                expect(resp.body[2].name).toBe('e2e-getOrg1');
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                url: config.orgSvcUrl + '/orgs?sort=name,1&limit=1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('o-7890');
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].name).toBe('e2e-getOrg1');
                expect(resp.response.headers['content-range']).toBe('items 1-1/3');
                options.url += '&skip=1';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('o-4567');
                expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].name).toBe('e2e-getOrg2');
                expect(resp.body[0].password).not.toBeDefined();
                expect(resp.response.headers['content-range']).toBe('items 2-2/3');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 404 error if no orgs are found', function(done) {
           var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
            testUtils.resetCollection('orgs')
            .then(function(){
                return testUtils.qRequest('get', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No orgs found');
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should not allow non-admins to use this endpoint', function(done) {
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: { email: 'orgsvce2enopermsuser', password: 'password' }
            };
            testUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to read all orgs');
                expect(resp.response.headers['content-range']).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('POST /api/account/org', function() {
        var mockOrg;
        beforeEach(function(done) {
            mockOrg = {
                name: 'e2e-org'
            };
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs');
            })
            .done(function(){
                done();
            });
        });
        
        it('should be able to create an org', function(done) {
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newOrg = resp.body;
                expect(newOrg).toBeDefined();
                expect(newOrg._id).not.toBeDefined();
                expect(newOrg.id).toBeDefined();
                expect(new Date(newOrg.created).toString()).not.toEqual('Invalid Date');
                expect(newOrg.lastUpdated).toEqual(newOrg.created);
                expect(newOrg.name).toBe('e2e-org');
                expect(newOrg.status).toBe('active');
                expect(newOrg.waterfalls).toEqual({video: ['cinema6'], display: ['cinema6']});
                expect(newOrg.config).toEqual({});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should be able to override default properties', function(done) {
            mockOrg.status = 'pending';
            mockOrg.waterfalls = {video: ['cinema6']};
            mockOrg.config = {foo: 'bar'};
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newOrg = resp.body;
                expect(newOrg).toBeDefined();
                expect(newOrg.status).toBe('pending');
                expect(newOrg.waterfalls).toEqual({video: ['cinema6'], display: ['cinema6']});
                expect(newOrg.config).toEqual({foo: 'bar'});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error when trying to set forbidden properties', function(done) {
            mockOrg.id = 'o-1234';
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error if the body is missing or incomplete', function(done) {
            var options = { url: config.orgSvcUrl + '/org', jar: cookieJar};
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                options.json = { tag: 'foo' };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New org object must have a name');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 409 error if a user with that name exists', function(done) {
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An org with that name already exists');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 403 error if the user is not authenticated for creating orgs', function(done) {
            var options = { url: config.orgSvcUrl + '/org', jar: cookieJar, json: {name: 'someOrg'}};
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgsvce2enopermsuser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                return testUtils.qRequest('post', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe("Not authorized to create orgs");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org' };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

    });

    describe('PUT /api/account/org/:id', function() {
        var start = new Date(),
            mockOrgs, updates;
        beforeEach(function(done) {
            mockOrgs = [
                {
                    id: 'o-1234',
                    name: 'e2e-put1',
                    tag: 'foo',
                    created: start,
                    waterfalls: {
                        video: ['cinema6', 'publisher'],
                        display: ['cinema6', 'publisher']
                    }
                },
                {
                    id: 'o-4567',
                    name: 'e2e-put2',
                    tag: 'baz',
                    created: start
                }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
            updates = { tag: 'bar', waterfalls: {video: ['cinema6'], display: ['cinema6']}};
        });
        
        it('should successfully update an org', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-1234',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var org = resp.body;
                expect(org._id).not.toBeDefined();
                expect(org.id).toBe('o-1234');
                expect(org.tag).toBe('bar');
                expect(org.waterfalls).toEqual({video: ['cinema6'], display: ['cinema6']});
                expect(new Date(org.lastUpdated)).toBeGreaterThan(new Date(org.created));
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 404 if the org does not exist', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/org-fake',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That org does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to edit the org', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-4567',
                json: updates,
                jar: cookieJar
            };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgsvce2enopermsuser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            }).then(function(){
                return testUtils.qRequest('put', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this org');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 if any of the update fields are illegal', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-1234',
                json: { created: 'new_created' },
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake' };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('DELETE /api/account/org/:id', function() {
        var mockOrgs;
        beforeEach(function(done) {
            mockOrgs = [
                { id: 'org1', name: 'e2e-delete1', status: 'active'},
                { id: 'org2', name: 'e2e-delete2', status: 'active' },
                { id: 'o-1234', name: 'e2e-delete3', status: 'active' }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
        });
        
        it('should successfully mark an org as deleted', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org1', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/org/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the org does not exist', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the org has already been deleted', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org1', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/org/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not allow a user to delete their own org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete your own org');
                options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to delete the org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org2', jar: cookieJar };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgsvce2enopermsuser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                return testUtils.qRequest('delete', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this org');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent deleting an org with active users', function(done) {
            var org = {id: 'o-del-1', status: 'active'},
                user = {id: 'u-del-1', status: 'active', org: 'o-del-1'},
                options = { url: config.orgSvcUrl + '/org/o-del-1', jar: cookieJar };
            testUtils.resetCollection('orgs', org).then(function() {
                return testUtils.resetCollection('users', [mockRequester, user]);
            }).then(function() {
                return testUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Org still has active users');
                options = { url: config.orgSvcUrl + '/org/o-del-1', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should allow deleting an org with inactive users', function(done) {
            var org = {id: 'o-del-1', status: 'active'},
                user = {id: 'u-del-1', status: 'deleted', org: 'o-del-1'},
                options = { url: config.orgSvcUrl + '/org/o-del-1', jar: cookieJar };
            testUtils.resetCollection('orgs', org).then(function() {
                return testUtils.resetCollection('users', [mockRequester, user]);
            }).then(function() {
                return testUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/org/o-del-1', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No orgs found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake' };
            testUtils.qRequest('delete', options).then(function(resp) {
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
