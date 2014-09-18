var q               = require('q'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        siteSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('site (E2E):', function() {
    var cookieJar, mockRequester, mockAdmin;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'sitesvce2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                sites: { read: 'org', create: 'org', edit: 'org', delete: 'org' }
            }
        };
        mockAdmin = {
            id: 'e2e-admin-user',
            status: 'active',
            email: 'admine2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-4567',
            permissions: {
                sites: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'sitesvce2euser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', [mockRequester, mockAdmin]).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/site/:id', function() {
        var mockSite;
        beforeEach(function(done) {
            mockSites = [
                { id: 'e2e-getId1', host: 'c6.com', org: 'o-1234', status: 'active' },
                { id: 'e2e-getId2', host: 'c6.com', org: 'o-4567', status: 'active' },
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });
        
        it('should get a site by id', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-getId1', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-getId1', host: 'c6.com', org: 'o-1234', status: 'active'});
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if the requester cannot see the site', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-getId2', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No sites found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-fake1', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No sites found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-fake1' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('GET /api/sites', function() {
        var mockSites;
        beforeEach(function(done) {
            mockSites = [
                { id: 'e2e-get1', status: 'active', host: 'c7.com', org: 'o-1234' },
                { id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234' },
                { id: 'e2e-get3', status: 'active', host: 'usatoday.com', org: 'o-4567' }
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });
        
        it('should get sites by host', function(done) {
            var options = { url: config.siteSvcUrl + '/sites?host=c6.com', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234'}]);
                expect(resp.response.headers['content-range']).toBe('items 1-1/1');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should get sites by org', function(done) {
            var options = { url: config.siteSvcUrl + '/sites?org=o-1234', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-get1', status: 'active', host: 'c7.com', org: 'o-1234' },
                    { id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                url: config.siteSvcUrl + '/sites?org=o-1234&sort=host,1&limit=1',
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234'}]);
                expect(resp.response.headers['content-range']).toBe('items 1-1/2');
                options.url += '&skip=1';
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([{id: 'e2e-get1', status: 'active', host: 'c7.com', org: 'o-1234'}]);
                expect(resp.response.headers['content-range']).toBe('items 2-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not show sites the requester cannot see', function(done) {
            var options = { url: config.siteSvcUrl + '/sites?host=usatoday.com', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No sites found');
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should prevent a non-admin user from getting all sites', function(done) {
            var options = { url: config.siteSvcUrl + '/sites', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Not authorized to read all sites');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not let a non-admin user search for sites outside their org', function(done) {
            var options = { url: config.siteSvcUrl + '/sites?org=o-4567', jar: cookieJar };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to read non-org sites');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should allow admins to get all sites', function(done) {
            var altJar = request.jar();
            var options = { url: config.siteSvcUrl + '/sites?sort=id,1', jar: altJar };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: altJar,
                json: { email: 'admine2euser', password: 'password' }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-get1', status: 'active', host: 'c7.com', org: 'o-1234' },
                    { id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234' },
                    { id: 'e2e-get3', status: 'active', host: 'usatoday.com', org: 'o-4567' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-3/3');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should allow an admin to search or sites outside their org', function(done) {
            var altJar = request.jar();
            var options = { url: config.siteSvcUrl + '/sites?org=o-1234&sort=id,1', jar: altJar };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: altJar,
                json: { email: 'admine2euser', password: 'password' }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([
                    { id: 'e2e-get1', status: 'active', host: 'c7.com', org: 'o-1234' },
                    { id: 'e2e-get2', status: 'active', host: 'c6.com', org: 'o-1234' }
                ]);
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.siteSvcUrl + '/sites?org=o-1234' };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('POST /api/site', function() {
        var mockSite, options;
        beforeEach(function(done) {
            mockSite = {
                name: 'Test Site',
                host: 'c6.com'
            };
            options = { url: config.siteSvcUrl + '/site', json: mockSite, jar: cookieJar };
            testUtils.resetCollection('sites').done(done);
        });
        
        it('should be able to create a site', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id.match(/s-\w{14}/)).toBeTruthy();
                expect(resp.body.name).toBe('Test Site');
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(new Date(resp.body.lastUpdated).toString()).not.toEqual('Invalid Date');
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.status).toBe('active');
                expect(resp.body.host).toBe('c6.com');
                expect(resp.body._id).not.toBeDefined();
           }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to override default properties', function(done) {
            mockSite.status = 'pending';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.status).toBe('pending');
                expect(resp.body._id).not.toBeDefined();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });

        it('should throw a 400 error if the body is missing or incomplete', function(done) {
            delete options.json;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New site object must have a host property');
                options.json = { foo: 'bar' };
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New site object must have a host property');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 409 error if a site with that host exists', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('A site with that host already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 400 if the new site is not in the requester\'s org', function(done) {
            mockSite.org = 'o-4567';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should allow an admin to create a site in another org', function(done) {
            var altJar = request.jar();
            mockSite.org = 'o-1234';
            options.jar = altJar;
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: altJar,
                json: { email: 'admine2euser', password: 'password' }
            };
            requestUtils.qRequest('post', loginOpts).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return requestUtils.qRequest('post', options)
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id.match(/s-\w{14}/)).toBeTruthy();
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body._id).not.toBeDefined();
           }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('PUT /api/site/:id', function() {
        var start = new Date(),
            mockSites, options;
        beforeEach(function(done) {
            mockSites = [
                { id: 'e2e-put1', host: 'c6.com', status: 'active', org: 'o-1234', created: start },
                { id: 'e2e-put2', host: 'c7.com', status: 'active', org: 'o-4567', created: start }
            ];
            options = { url: config.siteSvcUrl + '/site/e2e-put1', json: {foo: 'bar', host: 'c6.com'}, jar: cookieJar };
            testUtils.resetCollection('sites', mockSites).done(done);
        });
        
        it('should successfully update a site', function(done) {
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.foo).toBe('bar');
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(resp.body.created));
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should allow updating the host if no other site exists with that host', function(done) {
            options.json.host = 'c8.com';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBe('e2e-put1');
                expect(resp.body.foo).toBe('bar');
                expect(resp.body.host).toBe('c8.com');
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(resp.body.created));
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should prevent updating the host if another site exists with that host', function(done) {
            options.json.host = 'c7.com';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('A site with that host already exists');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 404 if the site does not exist', function(done) {
            options.url = config.siteSvcUrl + '/site/e2e-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That site does not exist');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 403 if the requester is not authorized to edit the site', function(done) {
           options.url = config.siteSvcUrl + '/site/e2e-put2';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this site');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 400 if any of the update fields are illegal', function(done) {
            options.json.id = 'new-id';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-fake' };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
    
    describe('DELETE /api/site/:id', function() {
        var mockSites;
        beforeEach(function(done) {
            mockSites = [
                { id: 'e2e-delete1', email: 'abcd', password: 'thisisasecret', org: 'o-1234' },
                { id: 'e2e-delete2', email: 'defg', password: 'thisisasecret', org: 'o-4567' }
            ];
            testUtils.resetCollection('sites', mockSites).done(done);
        });
        
        it('should successfully mark a site as deleted', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.siteSvcUrl + '/site/e2e-delete1', jar: cookieJar };
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No sites found');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should still succeed if the site does not exist', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-fake', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should still succeed if the site has already been deleted', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-delete1', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.siteSvcUrl + '/site/e2e-delete1', jar: cookieJar };
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should throw a 403 if the requester is not authorized to delete the site', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-delete2', jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this site');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    
        it('should throw a 401 error if the site is not authenticated', function(done) {
            var options = { url: config.siteSvcUrl + '/site/e2e-fake' };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
});
