var q               = require('q'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env['host'] || 'localhost',
    config = {
        userSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3500' : host) + '/api/account',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('user-light (E2E):', function() {
    describe('user CRUD: ', function() {
        var currUser, origUser = {},
            cookieJar = require('request').jar(),
            testUser = {
                email: 'johnnytestmonkey@cinema6.com',
                password: 'bananas4bananas'
            },
            newUser = {
                email: 'usersvc-lighte2euser#' + Math.round(Math.random() * 1000000000000),
                password: 'password',
                org: 'e2e-org',
                e2e: true
            };
            
        it('login the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: testUser
            };
            requestUtils.qRequest('post', options).done(function(resp) {
                if (resp.response.statusCode !== 200) {
                    console.log('Could not log in the test user');
                    console.log('Double check that the user johnnytestmonkey@cinema6.com exists in the database');
                    return q.reject('Received response: code = ' + resp.response.statusCode +
                                    ', body = ' + resp.body);
                }
                done();
            }, function(error) {
                console.log('Could not log in the test user: ' + error);
                throw new Error('Error logging in the test user; failing');
                done();
            });
        });
        
        it('create a user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user',
                jar: cookieJar,
                json: newUser
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                currUser = resp.body;
                expect(currUser).toBeDefined();
                expect(currUser._id).not.toBeDefined();
                expect(currUser.id).toBeDefined();
                expect(currUser.email).toBe(newUser.email);
                expect(currUser.password).not.toBeDefined();
                expect(currUser.status).toBe('active');
                expect(currUser.e2e).toBe(true);
                expect(currUser.applications).toEqual(['e-51ae37625cb57f']);
                expect(currUser.created).toBeDefined();
                expect(currUser.lastUpdated).toEqual(currUser.created);
                expect(currUser.org).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('retrieve a user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/' + currUser.id,
                jar: cookieJar
            };
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(currUser);
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('update a user', function(done) {
            Object.keys(currUser).forEach(function(key) {
                origUser[key] = currUser[key];
            });
            var options = {
                url: config.userSvcUrl + '/user/' + currUser.id,
                jar: cookieJar,
                json: { status: 'inactive' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body).not.toEqual(origUser);
                expect(resp.body.status).toBe('inactive');
                expect(resp.body.id).toBe(origUser.id);
                expect(resp.body.created).toBe(origUser.created);
                expect(new Date(resp.body.lastUpdated)).toBeGreaterThan(new Date(origUser.lastUpdated));
                currUser = resp.body;
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('delete a user', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/' + currUser.id,
                jar: cookieJar
            };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('logout the e2e test user', function(done) {
            var options = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('/api/account/user/meta', function() {
        it('should print out appropriate metadata about the user service', function(done) {
            var options = {
                url: config.userSvcUrl + '/user/meta'
            };
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.body.version).toBeDefined();
                expect(resp.body.started).toBeDefined();
                expect(new Date(resp.body.started).toString()).not.toEqual('Invalid Date');
                expect(resp.body.status).toBe("OK");
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
});
