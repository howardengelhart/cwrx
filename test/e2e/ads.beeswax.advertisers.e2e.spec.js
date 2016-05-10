var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    testUtils       = require('./testUtils'),
    BeeswaxClient   = require('../../lib/beeswax'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        advertUrl   : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api/account/advertisers/',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };
    
var beeswaxCreds = {
    email: 'ops@cinema6.com',
    password: '07743763902206f2b511bead2d2bf12292e2af82'
};

describe('ads: beeswax advertisers endpoints (E2E):', function() {
    var cookieJar, nonAdminJar, mockApp, appCreds, beeswax, beeswaxAdverts;

    beforeAll(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        cookieJar = request.jar();
        nonAdminJar = request.jar();
        var mockUser = {
            id: 'u-admin',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-admin',
            policies: ['manageAllAdverts']
        };
        var nonAdmin = {
            id: 'u-selfie',
            status: 'active',
            email : 'nonadminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['manageOrgAdverts']
        };
        var testPolicies = [
            {
                id: 'p-e2e-allAdverts',
                name: 'manageAllAdverts',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
                }
            },
            {
                id: 'p-e2e-orgAdverts',
                name: 'manageOrgAdverts',
                status: 'active',
                priority: 1,
                permissions: {
                    advertisers: { read: 'org', edit: 'org', delete: 'org' }
                }
            }
        ];
        mockApp = {
            id: 'app-e2e-adverts',
            key: 'e2e-adverts',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                advertisers: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            {url: config.authUrl + '/login', json: {email: mockUser.email, password: 'password'}, jar: cookieJar},
            {url: config.authUrl + '/login', json: {email: nonAdmin.email, password: 'password'}, jar: nonAdminJar},
        ];
        
        q.all([
            testUtils.resetCollection('users', [mockUser, nonAdmin]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(results) {
            return q.all(logins.map(function(opts) { return requestUtils.qRequest('post', opts); }));
        }).done(function(results) {
            done();
        });
    });
    
    // Setup beeswax advertisers
    beforeAll(function(done) {
        var nowStr = String(Date.now()) + ' - ';
        beeswax = new BeeswaxClient({ creds: beeswaxCreds });
        beeswaxAdverts = [];
        q.all([
            { advertiser_name: nowStr + 'test advert 1', alternative_id: 'a-existing-1', notes: 'foo' },
            { advertiser_name: nowStr + 'test advert 2', alternative_id: 'a-existing-2', notes: 'bar' },
            { advertiser_name: nowStr + 'test advert 3', alternative_id: 'a-existing-3', notes: 'baz' }
        ].map(function(body) {
            return beeswax.advertisers.create(body);
        })
        .then(function(results) {
            for (var i = 0; i < results.length; i++) {
                if (!results[i].success) {
                    return q.reject('Failed setting up Beeswax advert: ' + util.inspect(results[i]));
                }
                beeswaxAdverts.push(results[i]);
            }
        })
        .then(done, done.fail);
    });
    
    describe('GET /api/account/advertisers/:advertId/beeswax/advertisers', function() {
        var options;
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie' },
                { id: 'e2e-a-2', name: 'advert 2', status: 'active', org: 'o-other' },
                { id: 'e2e-deleted', name: 'advert deleted', status: 'deleted' }
            ];
            options = {
                url: config.advertUrl + 'e2e-a-1' + '/beeswax/advertisers',
                jar: cookieJar
            };
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        xit('should retrieve a beeswax advertiser', function(done) {
        
        });
        
        xit('should write an entry to the audit collection', function(done) {
        
        });
        
        xit('should return a 404 for advertisers without a Beeswax advertiser', function(done) {
        
        });
        
        xit('should return a 404 for non-existent advertisers', function(done) {
        
        });
        
        xit('should prevent non-admins from retrieving advertisers they do not own', function(done) {
        
        });

        xit('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should allow an app to get an advertiser', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({id: 'e2e-a-1', name: 'advert 1', status: 'active', org: 'o-selfie'});
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        xit('should fail if an app uses the wrong secret to make a request', function(done) {
            delete options.jar;
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    xdescribe('POST /api/account/advertisers/:advertId/beeswax/advertisers', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.advertUrl
                jar: cookieJar,
                json: {
                    name: 'fake advert',
                    defaultLinks: {
                        facebook: 'http://facebook.com'
                    },
                    defaultLogos: {
                        square: 'square.png'
                    }
                }
            };
            testUtils.resetCollection('advertisers').done(done);
        });

        xit('should create a beeswax advertiser for a C6 advertiser', function(done) {
            
        });
        
        xit('should write an entry to the audit collection', function(done) {
            //TODO: should we keep deleting created advertiser in an afterEach?
        });
        
        xit('should default the advertiser_name', function(done) {
            
        });
        
        xit('should make the advertiser_name unique if needed', function(done) {
        
        });
        
        xit('should prevent creating a beeswax advertiser for a C6 advertiser that already has one', function(done) {
        
        });
        
        xit('should prevent creating a beeswax advertiser for a non-existent C6 advertiser', function(done) {
        
        });
        
        xit('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });
        
        xit('should allow an app to create an advertiser', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body.id).toBeDefined();
                expect(resp.body.name).toBe('fake advert');
                expect(resp.body.org).not.toBeDefined();
                expect(resp.body.defaultLinks).toEqual({
                    facebook: 'http://facebook.com'
                });
                expect(resp.body.defaultLogos).toEqual({
                    square: 'square.png'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    xdescribe('PUT /api/account/advertisers/:advertId/beeswax/advertisers', function() {
        var mockAdverts, options;
        beforeEach(function(done) {
            mockAdverts = [
                { id: 'e2e-a-1', status: 'active', org: 'o-selfie', name: 'advert 1', defaultLogos: { square: 'square.png' } },
                { id: 'e2e-a-2', status: 'active', org: 'o-admin', name: 'advert 2', defaultLinks: { google: 'google.com' } },
                { id: 'e2e-a-eted', status: 'deleted', org: 'o-selfie', name: 'deleted advert' }
            ];
            options = {
                url: config.advertUrl + 'e2e-a-1',
                json: { name: 'new name', defaultLogos: { square: 'rhombus.png' } },
                jar: cookieJar
            };
            return testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });
        
        xit('should edit a Beeswax advertiser', function(done) {
        
        });
        
        xit('should write an entry to the audit collection', function(done) {
            
        });

        xit('should make the advertiser_name unique if needed', function(done) {
        
        });

        xit('should return a 404 if the C6 advertiser has no Beeswax advertiser', function(done) {
        
        });
        
        xit('should return a 404 if the C6 advertiser does not exist', function(done) {
        
        });

        xit('should prevent non-admins from editing advertisers they do not own', function(done) {
        
        });

        xit('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should allow an app to edit an advertiser', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e2e-a-1');
                expect(resp.body.name).toBe('new name');
                expect(resp.body.defaultLogos).toEqual({
                    square: 'rhombus.png'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    xdescribe('DELETE /api/account/advertisers/:advertId/beeswax/advertisers', function() {
        var options;
        beforeEach(function(done) {
            var mockAdverts = [
                { id: 'e2e-a-1', name: 'advert 1', org: 'o-selfie', status: 'active' },
                { id: 'e2e-a-2', name: 'advert 2', org: 'o-admin', status: 'active' },
                { id: 'e2e-deleted', name: 'advert 3', org: 'o-selfie', status: 'deleted' }
            ];
            options = {
                url: config.advertUrl + 'e2e-a-1',
                jar: cookieJar
            };
            testUtils.resetCollection('advertisers', mockAdverts).done(done);
        });

        xit('should delete a Beeswax advertiser', function(done) {
        
        });
        
        xit('should write an entry to the audit collection', function(done) {
            //TODO: rework into above?
        });

        xit('should return a 204 if the C6 advertiser has no Beeswax advertiser', function(done) {
        
        });
        
        xit('should return a 404 if the C6 advertiser does not exist', function(done) {
        
        });

        xit('should prevent non-admins from deleting advertisers they do not own', function(done) {
        
        });

        xit('should return a 401 error if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).done(done);
        });

        xit('should allow an app to delete an advertiser', function(done) {
            requestUtils.makeSignedRequest(appCreds, 'delete', {url: config.advertUrl + 'e2e-a-1'})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    // Cleanup all created Beeswax advertisers
    afterAll(function(done) {
    
    });

    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});
