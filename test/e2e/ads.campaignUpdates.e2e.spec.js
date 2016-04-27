var q               = require('q'),
    braintree       = require('braintree'),
    request         = require('request'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        adsUrl      : 'http://' + (host === 'localhost' ? host + ':3900' : host) + '/api',
        contentUrl  : 'http://' + (host === 'localhost' ? host + ':3300' : host) + '/api/content',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    },
    gateway = braintree.connect({
        environment : braintree.Environment.Sandbox,
        merchantId  : 'ztrphcf283bxgn2f',
        publicKey   : 'rz2pht7gyn6d266b',
        privateKey  : '0a150dac004756370706a195e2bde296'
    });

jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

describe('ads campaignUpdates endpoints (E2E):', function() {
    var selfieJar, adminJar, testPolicies, createdCamp, createdCampDecorated, mailman, mockOrgs, mockApp, appCreds, mockman;

    beforeAll(function(done) {

        if (selfieJar && adminJar) {
            return done();
        }
        selfieJar = request.jar();
        var selfieUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'c6e2etester@gmail.com',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            company: 'Heinz',
            policies: ['selfieCampPolicy']
        };
        adminJar = request.jar();
        var adminUser = {
            id: 'admin-e2e-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-selfie',
            policies: ['adminCampPolicy']
        };

        testPolicies = [
            {
                id: 'p-e2e-selfie',
                name: 'selfieCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'own', edit: 'own' },
                    cards: { read: 'org', create: 'org', edit: 'org', delete: 'org' },
                    campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' },
                    campaignUpdates: { read: 'org', create: 'org', edit: 'org' }
                },
                fieldValidation: {
                    campaigns: {
                        application: {
                            __allowed: false,
                            __default: 'selfie'
                        }
                    }
                }
            },
            {
                id: 'p-e2e-admin',
                name: 'adminCampPolicy',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all', edit: 'all', delete: 'all' },
                    cards: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' },
                    campaignUpdates: { read: 'all', create: 'all', edit: 'all' }
                },
                fieldValidation: {
                    campaigns: {
                        status: { __allowed: true },
                        advertiserId : { __allowed: true },
                        pricing: {
                            model: { __allowed: true },
                            cost: { __allowed: true }
                        },
                        staticCardMap: { __allowed: true },
                        cards: {
                            __unchangeable: false,
                            __length: 10,
                        },
                        miniReels: { __allowed: true }
                    },
                    campaignUpdates: {
                        status: { __allowed: true },
                        rejectionReason: { __allowed: true }
                    }
                },
                entitlements: {
                    directEditCampaigns: true,
                    autoApproveUpdates: true
                }
            },
        ];
        mockApp = {
            id: 'app-e2e-campUpdates',
            key: 'e2e-campUpdates',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: JSON.parse(JSON.stringify(testPolicies[1].permissions)),
            fieldValidation: JSON.parse(JSON.stringify(testPolicies[1].fieldValidation)),
            entitlements: {
                directEditCampaigns: true,
                autoApproveUpdates: true
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: selfieJar,
            json: {
                email: selfieUser.email,
                password: 'password'
            }
        };
        var adminLoginOpts = {
            url: config.authUrl + '/login',
            jar: adminJar,
            json: {
                email: adminUser.email,
                password: 'password'
            }
        };
        q.all([
            testUtils.resetCollection('users', [selfieUser, adminUser]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(resp) {
            return q.all([
                requestUtils.qRequest('post', loginOpts),
                requestUtils.qRequest('post', adminLoginOpts)
            ]);
        }).done(function(resp) {
            done();
        });
    });
    
    // Setup a card to test with
    beforeAll(function(done) {
        requestUtils.qRequest('post', {
            url: config.adsUrl + '/campaigns/',
            jar: selfieJar,
            json: {
                name: 'camp with card',
                advertiserId: 'e2e-a-keepme',
                targeting: { interests: ['cat-1'] },
                cards: [{
                    title: 'my test card'
                }]
            }
        }).then(function(resp) {
            if (resp.response.statusCode !== 201) {
                done.fail(util.inspect({ code: resp.response.statusCode, body: resp.body }));
            }
            createdCampDecorated = resp.body;
            
            return testUtils.mongoFind('campaigns', { id: createdCampDecorated.id });
        }).then(function(results) {
            // As long as createdCamp is used in resetCollection, changes to this campaign will not persist
            createdCamp = results[0];
        }).then(function() {
            mockman = new testUtils.Mockman();
            return mockman.start();
        }).done(done, done.fail);
    });
    
    // Setup mailman for receiving email messages
    beforeEach(function(done) {
        if (mailman && mailman.state === 'authenticated') {
            mailman.on('error', function(error) { throw new Error(error); });
            return done();
        }
        
        mailman = new testUtils.Mailman();
        return mailman.start().then(function() {
            mailman.on('error', function(error) { throw new Error(error); });
        }).done(done);
    });
    
    // Setup mock credit transactions and mock orgs
    beforeEach(function(done) {
        return testUtils.resetPGTable('fct.billing_transactions', [
            '(9998,\'2016-03-21T15:53:11.927Z\',\'t-1\',\'2016-03-21T15:53:11.927Z\',\'o-selfie\',700.0,1,1,\'\',\'payment1\',\'\',\'\')',
            '(9999,\'2016-03-21T15:53:11.927Z\',\'t-2\',\'2016-03-21T15:53:11.927Z\',\'o-selfie\',800.0,1,1,\'\',\'payment2\',\'\',\'\')'
        ]).then(function() {
            return testUtils.resetCollection('orgs', [
                { id: 'o-selfie', status: 'active', name: 'selfie org' },
                { id: 'o-admin', status: 'active', name: 'admin org' }
            ]);
        })
        .done(done);
    });

    afterEach(function() {
        mailman.removeAllListeners();
        mockman.removeAllListeners();
    });

    
    // Performs some checks on a "New update request" email sent to support
    function testNewUpdateMsg(msg, camp) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        [
            new RegExp('created\\s*by\\s*c6e2etester@gmail.com\\s*for\\s*campaign.*' + camp.name),
            new RegExp('review\\s*the\\s*campaign.*\\s*http.*' + camp.id + '\/admin')
        ].forEach(function(regex) {
            expect(regex.test(msg.text)).toBeTruthy('Expected text to match ' + regex);
            expect(regex.test(msg.html)).toBeTruthy('Expected html to match ' + regex);
        });
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }

    function testApprovalMsg(msg, camp, isInitial) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        
        var regex = new RegExp('Your\\s*' + (!isInitial ? 'change\\s*request\\s*to\\s*' : '') +
                               'campaign.*' + camp.name + '.*has\\s*been\\s*approved');
        expect(regex.test(msg.text)).toBeTruthy('Expected text to match ' + regex);
        expect(regex.test(msg.html)).toBeTruthy('Expected html to match ' + regex);
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }
    
    function testRejectMsg(msg, camp, reason, isInitial) {
        expect(msg.from[0].address.toLowerCase()).toBe('no-reply@cinema6.com');
        expect(msg.to[0].address.toLowerCase()).toBe('c6e2etester@gmail.com');
        [
            new RegExp('Your\\s*' + (!isInitial ? 'change\\s*request\\s*to\\s*' : '') +
                       'campaign.*' + camp.name + '.*has\\s*been\\s*rejected'),
            new RegExp(reason)
        ].forEach(function(regex) {
            expect(regex.test(msg.text)).toBeTruthy('Expected text to match ' + regex);
            expect(regex.test(msg.html)).toBeTruthy('Expected html to match ' + regex);
        });
        expect((new Date() - msg.date)).toBeLessThan(30000); // message should be recent
    }


    describe('GET /api/campaigns/:campId/updates/:id', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-getId1/updates/ur-getId1',
                qs: {},
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getId2', campaign: 'cam-getId1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });
        
        it('should get a campaign update by id', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending',
                    user: 'e2e-user', org: 'o-selfie', data: {} });
                expect(resp.response.headers['content-range']).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/:campId/updates?/:id',
                                                 params: { campId: 'cam-getId1', id: 'ur-getId1' }, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,campaign';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should not show updates a user cannot see', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getId1/updates/ur-getId2';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
                options.jar = adminJar;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId2', campaign: 'cam-getId1', status: 'pending',
                    user: 'not-e2e-user', org: 'o-admin', data: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the update is not for the given campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getId2/updates/ur-getId1';
            options.jar = adminJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get an update', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ id: 'ur-getId1', campaign: 'cam-getId1', status: 'pending',
                    user: 'e2e-user', org: 'o-selfie', data: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
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

    describe('GET /api/campaigns/:campId/updates/', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/cam-getQry1/updates/',
                qs: { sort: 'id,1' },
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getQry1', campaign: 'cam-getQry1', status: 'paused', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry2', campaign: 'cam-getQry1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} },
                { id: 'ur-getQry3', campaign: 'cam-getQry1', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry4', campaign: 'cam-getQry1', status: 'canceled', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry5', campaign: 'cam-getQry1', status: 'rejected', user: 'e2e-user', org: 'o-selfie', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });

        it('should get all updates a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.body[2].id).toBe('ur-getQry4');
                expect(resp.body[3].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/:campId/updates?/',
                                                 params: { campId: 'cam-getQry1' }, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,user';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual({ id: 'ur-getQry1', status: 'paused', user: 'e2e-user' });
                expect(resp.body[1]).toEqual({ id: 'ur-getQry3', status: 'approved', user: 'e2e-user' });
                expect(resp.body[2]).toEqual({ id: 'ur-getQry4', status: 'canceled', user: 'e2e-user' });
                expect(resp.body[3]).toEqual({ id: 'ur-getQry5', status: 'rejected', user: 'e2e-user' });
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of statuses', function(done) {
            options.qs.statuses = 'paused,rejected';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of ids', function(done) {
            options.qs.ids = 'ur-getQry1,ur-getQry4';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        ['ids', 'statuses'].forEach(function(param) {
            it('should get no campaigns if the ' + param + ' param is empty', function(done) {
                options.qs[param] = '';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.ids = 'ur-getFake';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and [] if there are no updates for the campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-getQry2/updates/';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'status,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry5');
                expect(resp.body[1].id).toBe('ur-getQry1');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry4');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get updates', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry2');
                expect(resp.body[2].id).toBe('ur-getQry3');
                expect(resp.body[3].id).toBe('ur-getQry4');
                expect(resp.body[4].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-5/5');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('GET /api/campaigns/updates/', function() {
        var options;
        beforeEach(function(done) {
            options = {
                url: config.adsUrl + '/campaigns/updates/',
                qs: { sort: 'id,1' },
                jar: selfieJar
            };
            var mockUpdates = [
                { id: 'ur-getQry1', campaign: 'cam-getQry1', status: 'paused', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry2', campaign: 'cam-getQry1', status: 'pending', user: 'not-e2e-user', org: 'o-admin', data: {} },
                { id: 'ur-getQry3', campaign: 'cam-getQry2', status: 'approved', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry4', campaign: 'cam-getQry2', status: 'canceled', user: 'e2e-user', org: 'o-selfie', data: {} },
                { id: 'ur-getQry5', campaign: 'cam-getQry3', status: 'rejected', user: 'e2e-user', org: 'o-selfie', data: {} }
            ];
            testUtils.resetCollection('campaignUpdates', mockUpdates).done(done, done.fail);
        });

        it('should get all updates a user can see', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.body[2].id).toBe('ur-getQry4');
                expect(resp.body[3].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('ads');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/campaigns/updates?/',
                                                 params: {}, query: { sort: 'id,1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow a user to specify which fields to return', function(done) {
            options.qs.fields = 'status,user';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual({ id: 'ur-getQry1', status: 'paused', user: 'e2e-user' });
                expect(resp.body[1]).toEqual({ id: 'ur-getQry3', status: 'approved', user: 'e2e-user' });
                expect(resp.body[2]).toEqual({ id: 'ur-getQry4', status: 'canceled', user: 'e2e-user' });
                expect(resp.body[3]).toEqual({ id: 'ur-getQry5', status: 'rejected', user: 'e2e-user' });
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of statuses', function(done) {
            options.qs.statuses = 'paused,rejected';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should get updates by list of ids', function(done) {
            options.qs.ids = 'ur-getQry1,ur-getQry4';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry4');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should get updates by list of campaign ids', function(done) {
            options.qs.campaigns = 'cam-getQry1,cam-getQry3';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-2/2');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        ['ids', 'statuses', 'campaigns'].forEach(function(param) {
            it('should get no updates if the ' + param + ' param is empty', function(done) {
                options.qs[param] = '';
                requestUtils.qRequest('get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual([]);
                    expect(resp.response.headers['content-range']).toBe('items 0-0/0');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 200 and [] if nothing is found', function(done) {
            options.qs.ids = 'ur-getFake';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.response.headers['content-range']).toBe('items 0-0/0');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to sort and paginate the results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'status,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry5');
                expect(resp.body[1].id).toBe('ur-getQry1');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('ur-getQry4');
                expect(resp.body[1].id).toBe('ur-getQry3');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get updates', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(5);
                expect(resp.body[0].id).toBe('ur-getQry1');
                expect(resp.body[1].id).toBe('ur-getQry2');
                expect(resp.body[2].id).toBe('ur-getQry3');
                expect(resp.body[3].id).toBe('ur-getQry4');
                expect(resp.body[4].id).toBe('ur-getQry5');
                expect(resp.response.headers['content-range']).toBe('items 1-5/5');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/campaigns/:campId/updates', function() {
        var options, mockCamps, msgSubject;
        beforeEach(function(done) {
            msgSubject = 'New update request from Heinz for campaign "e2e test 1"';
            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/',
                json: { data: {
                    name: 'updated name',
                    pricing: { budget: 900 },
                    targeting: {
                        geo: { dmas: ['princeton'] },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    }
                } },
                jar: selfieJar
            };
            mockCamps = [
                {
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'draft',
                    application: 'selfie',
                    pricing: { budget: 500, dailyLimit: 200, cost: 0.07, model: 'cpv' },
                    targeting: {
                        geo: { states: ['new jersey' ] },
                        interests: ['cat-1', 'cat-2']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                },
                { id: 'cam-active', advertiserId: 'e2e-a-keepme', status: 'active', user: 'e2e-user', org: 'o-selfie' },
                { id: 'cam-expired', name: 'expired camp', pricing: { budget: 200 }, advertiserId: 'e2e-a-keepme', status: 'expired', user: 'e2e-user', org: 'o-selfie' },
                { id: 'cam-other-org', status: 'draft', user: 'not-e2e-user', org: 'o-admin' },
                { id: 'cam-other-budget', status: 'active', user: 'e2e-user', org: 'o-selfie', pricing: { budget: 400 } },
                { id: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie' },
                createdCamp
            ];
            q.all([
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.resetCollection('campaignUpdates'),
            ]).done(function() { done(); });
        });

// TODO: ensure all tests that should produce a mockman event are waiting for the mockman event
        
        it('should create an update and email support', function(done) {
            var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.autoApproved).toBe(false);
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    name: 'updated name',
                    application: 'selfie',
                    status: 'draft',
                    pricing: { budget: 900, dailyLimit: 200, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['princeton']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
                createdUpdate = resp.body;

                // test that updateRequest is set successfully on campaign
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).toBe(createdUpdate.id);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mailman.once(msgSubject, function(msg) {
                testNewUpdateMsg(msg, mockCamps[0]);
                mailmanDef.resolve();
            });
            mockman.on('newUpdateRequest', function(record) {
                expect(new Date(record.data.date)).not.toBe(NaN);
                expect(record.data.campaign).toEqual(jasmine.objectContaining({
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'draft',
                    user: 'e2e-user'
                }));
                expect(record.data.updateRequest).toEqual(createdUpdate);
                expect(record.data.user).toEqual(jasmine.objectContaining({
                    id: 'e2e-user',
                    status: 'active',
                    email: 'c6e2etester@gmail.com',
                    org: 'o-selfie'
                }));
                mockmanDef.resolve();
            });
            q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
        });
        
        it('should immediately apply if the requester has the autoApproveUpdates entitlement', function(done) {
            options.jar = adminJar;
            options.json.data = { name: 'auto-approved yo' };
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('approved');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.autoApproved).toBe(true);
                expect(resp.body.user).toBe('admin-e2e-user');
                expect(resp.body.org).toBe('o-selfie');
                expect(resp.body.data.name).toEqual('auto-approved yo');
            
                // test campaign updated successfully
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).not.toBeDefined();
                expect(resp.body.name).toEqual('auto-approved yo');
                expect(resp.body.targeting).toEqual(mockCamps[0].targeting);
                expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        describe('if sending an initial submit request', function() {
            beforeEach(function() {
                options.json.data = { status: 'pending' };
            });

            it('should set the status of the campaign to pending', function(done) {
                var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe('cam-1');
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.initialSubmit).toBe(true);
                    expect(resp.body.data.status).toBe('pending');
                    createdUpdate = resp.body;

                    // test campaign updated successfully
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.updateRequest).toBe(createdUpdate.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    testNewUpdateMsg(msg, mockCamps[0]);
                    mailmanDef.resolve();
                });
                mockman.on('newUpdateRequest', function(record) {
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toBeDefined();
                    expect(record.data.updateRequest).toBeDefined();
                    expect(record.data.user).toBeDefined();
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });
            
            it('should 400 if the campaign\'s current budget is too high for the account to afford', function(done) {
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                
                testUtils.mongoUpsert('campaigns', { id: 'cam-1' }, { $set: { 'pricing.budget': 2000 } }).then(function() {
                    return requestUtils.qRequest('post', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(402);
                    expect(resp.body).toEqual({
                        message: 'Insufficient funds for changes to campaign',
                        depositAmount: 900
                    });
                    
                    // test campaign not locked
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-1',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.pricing.budget).toBe(2000);
                    expect(resp.body.updateRequest).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });

        describe('if renewing a previously ended campaign', function() {
            beforeEach(function() {
                options.json.data = { status: 'pending' };
                options.url = config.adsUrl + '/campaigns/cam-expired/updates/';
                msgSubject = 'New update request from Heinz for campaign "expired camp"';
            });

            it('should set the status of the campaign to pending', function(done) {
                var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe('cam-expired');
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.renewal).toBe(true);
                    expect(resp.body.data.status).toBe('pending');
                    createdUpdate = resp.body;

                    // test campaign updated successfully
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-expired',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.updateRequest).toBe(createdUpdate.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    testNewUpdateMsg(msg, mockCamps[2]);
                    mailmanDef.resolve();
                });
                mockman.on('newUpdateRequest', function(record) {
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toBeDefined();
                    expect(record.data.updateRequest).toBeDefined();
                    expect(record.data.user).toBeDefined();
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });

            it('should 400 if the campaign\'s current budget is too high for the account to afford', function(done) {
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                
                testUtils.mongoUpsert('campaigns', { id: 'cam-expired' }, { $set: { 'pricing.budget': 2000 } }).then(function() {
                    return requestUtils.qRequest('post', options);
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(402);
                    expect(resp.body).toEqual({
                        message: 'Insufficient funds for changes to campaign',
                        depositAmount: 900
                    });
                    
                    // test campaign not locked
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/cam-expired',
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('expired');
                    expect(resp.body.pricing.budget).toBe(2000);
                    expect(resp.body.updateRequest).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if creating an update for a campaign with cards', function() {
            beforeEach(function() {
                options = {
                    url: config.adsUrl + '/campaigns/' + createdCampDecorated.id + '/updates/',
                    json: { data: {
                        name: 'updated name',
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            title: 'Brand New Title!'
                        }]
                    } },
                    jar: selfieJar
                };
                msgSubject = 'New update request from Heinz for campaign "' + createdCamp.name + '"';
            });
            
            it('should allow editing card attributes', function(done) {
                var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe(createdCamp.id);
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual(jasmine.objectContaining({
                        id: createdCamp.id,
                        name: 'updated name',
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            campaignId: createdCampDecorated.id,
                            title: 'Brand New Title!'
                        }]
                    }));
                    createdUpdate = resp.body;
                    
                    // test that updateRequest is set successfully on campaign
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).toBe(createdUpdate.id);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    testNewUpdateMsg(msg, createdCampDecorated);
                    mailmanDef.resolve();
                });
                mockman.on('newUpdateRequest', function(record) {
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toBeDefined();
                    expect(record.data.updateRequest).toBeDefined();
                    expect(record.data.user).toBeDefined();
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });
            
            it('should trim forbidden card fields', function(done) {
                var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
                options.json.data.cards[0].data = {
                    skip: true,
                    controls: false,
                    autoplay: false,
                    autoadvance: true
                };
                options.json.data.cards[0].campaign = {
                    minViewTime: 55,
                    reportingId: createdCampDecorated.cards[0].campaign.reportingId
                };
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(201);
                    if (resp.response.statusCode !== 201) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }
                    
                    expect(resp.body.id).toEqual(jasmine.any(String));
                    expect(resp.body.status).toBe('pending');
                    expect(resp.body.campaign).toBe(createdCamp.id);
                    expect(resp.body.autoApproved).toBe(false);
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.org).toBe('o-selfie');
                    expect(resp.body.data).toEqual(jasmine.objectContaining({
                        id: createdCampDecorated.id,
                        name: 'updated name',
                        cards: [ jasmine.objectContaining({
                            id: createdCampDecorated.cards[0].id,
                            campaignId: createdCampDecorated.id,
                            title: 'Brand New Title!',
                            campaign: createdCampDecorated.cards[0].campaign,
                            data: createdCampDecorated.cards[0].data
                        }) ]
                    }));
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });
                
                mailman.once(msgSubject, function(msg) {
                    mailmanDef.resolve();
                });
                mockman.on('newUpdateRequest', function(record) {
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });

            it('should prevent selfie users from adding a second card', function(done) {
                options.json.data = { cards: [{ id: createdCampDecorated.cards[0].id }, { title: 'my new card' }] };
                mailman.once(msgSubject, function(msg) {
                    expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
                });
                requestUtils.qRequest('post', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(400);
                    expect(resp.body).toBe('cards must have at most 1 entries');
                    
                    // test campaign not locked
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.updateRequest).not.toBeDefined();
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return a 400 for invalid pricing opts', function(done) {
            options.json.data = { pricing: { budget: 999999999999999999999999999999 } };
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toMatch(/pricing.budget must be less than the max: \d+/);
                
                // test campaign not locked
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org cannot afford the new budget', function(done) {
            options.json.data.pricing.budget = 2000;
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(402);
                expect(resp.body).toEqual({
                    message: 'Insufficient funds for changes to campaign',
                    depositAmount: 900
                });
                
                // test campaign not locked
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).not.toBeDefined();
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the user sends up invalid zipcode radius targeting', function(done) {
            q.all([
                { radius: 9999999999999999999999 },
                { radius: -1234 },
                { codes: new Array(1000).join(',').split(',').map(function() { return 'a'; }) },
                { codes: ['66666'] },
                { codes: ['yo mommas house'] }
            ].map(function(zipcodeTarg) {
                options.json.data = { targeting: { geo: { zipcodes: zipcodeTarg } } };
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toMatch(/targeting.geo.zipcodes.radius must be less than the max: \d+/);
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toMatch(/targeting.geo.zipcodes.radius must be greater than the min: \d+/);
                expect(results[2].response.statusCode).toBe(400);
                expect(results[2].body).toMatch(/targeting.geo.zipcodes.codes must have at most \d+ entries/);
                expect(results[3].response.statusCode).toBe(400);
                expect(results[3].body).toBe('These zipcodes were not found: [66666]');
                expect(results[4].response.statusCode).toBe(400);
                expect(results[4].body).toBe('These zipcodes were not found: [yo mommas house]');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should trim off forbidden fields from the data', function(done) {
            var mockmanDef = q.defer(), mailmanDef = q.defer(), createdUpdate;
            options.json.data = {
                name: 'updated name',
                miniReels: [{ id: 'e-1' }],
                staticCardMap: { foo: 'bar' },
                rejectionReason: 'i am a bad selfie user',
            };
            
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                if (resp.response.statusCode !== 201) {
                    return q.reject({ code: resp.response.statusCode, body: resp.body });
                }
                
                expect(resp.body.id).toEqual(jasmine.any(String));
                expect(resp.body.status).toBe('pending');
                expect(resp.body.data.name).toBe('updated name');
                expect(resp.body.data.miniReels).not.toBeDefined();
                expect(resp.body.data.staticCardMap).not.toBeDefined();
                expect(resp.body.data.rejectionReason).not.toBeDefined();
                createdUpdate = resp.body;
                
                // test that updateRequest is set successfully on campaign
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('draft');
                expect(resp.body.updateRequest).toBe(createdUpdate.id);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
            
            mailman.once(msgSubject, function(msg) {
                testNewUpdateMsg(msg, mockCamps[0]);
                mailmanDef.resolve();
            });
            mockman.on('newUpdateRequest', function(record) {
                mockmanDef.resolve();
            });
            q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
        });
        
        it('should prevent creating updates for a campaign the user cannot see', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-other-org/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent creating updates for a deleted campaign', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-deleted/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent creating updates for a nonexistent campaign', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            options.url = config.adsUrl + '/campaigns/cam-fake/updates/';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            mailman.once(msgSubject, function(msg) {
                expect(util.inspect(msg).substring(0, 200)).not.toBeDefined();
            });
            delete options.jar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('PUT /api/campaigns/:campId/updates/:id', function() {
        var options, mockCamps, mockUpdates, approveSubject, rejectSubject;
        beforeEach(function(done) {
            approveSubject = 'Your Campaign Change Request Has Been Approved';
            rejectSubject = 'Your Campaign Change Request Has Been Rejected';
            mockUpdates = [
                {
                    id: 'ur-1', 
                    campaign: 'cam-1',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    data: {
                        name: 'updated name',
                        pricing: { budget: 500 },
                        targeting: {
                            geo: { dmas: ['princeton'] },
                            interests: ['cat-3']
                        }
                    }
                },
                { id: 'ur-deletedCamp', campaign: 'cam-deleted', status: 'pending', data: { foo: 'bar' } }
            ];
            mockCamps = [
                {
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'active',
                    application: 'selfie',
                    pricing: { budget: 1000, dailyLimit: 200, cost: 0.07, model: 'cpv' },
                    targeting: {
                        geo: { states: ['new jersey' ] },
                        interests: ['cat-1', 'cat-2']
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                },
                { id: 'cam-2', name: 'camp 2', status: 'draft', user: 'e2e-user', org: 'o-selfie' },
                { id: 'cam-other-budget', status: 'active', user: 'e2e-user', org: 'o-selfie', pricing: { budget: 400 } },
                { id: 'cam-deleted', status: 'deleted', user: 'e2e-user', org: 'o-selfie' }
            ];
            if (createdCamp) {
                mockCamps.push(createdCamp);
            }

            options = {
                url: config.adsUrl + '/campaigns/cam-1/updates/ur-1',
                json: { data: {
                    name: 'fernando',
                    pricing: { dailyLimit: 100 },
                    targeting: {
                        geo: { dmas: ['new york city', 'newark'] },
                        demographics: { gender: ['male'] }
                    }
                } },
                jar: adminJar
            };
            q.all([
                testUtils.resetCollection('campaignUpdates', mockUpdates),
                testUtils.resetCollection('campaigns', mockCamps),
            ]).done(function() { done(); });
        });

        it('should be able to edit the data of an update', function(done) {
            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'active',
                    application: 'selfie',
                    name: 'fernando',
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to approve an update and notify the campaign owner', function(done) {
            var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;
            options.json.status = 'approved';
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('approved');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'active',
                    application: 'selfie',
                    name: 'fernando',
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3']
                    },
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
                returnedBody = resp.body;
                
                // test that campaign successfully edited
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.updateRequest).not.toBeDefined();
                expect(resp.body.name).toBe('fernando');
                expect(resp.body.pricing).toEqual({ budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' });
                expect(resp.body.targeting).toEqual({
                    geo: {
                        states: ['new jersey'],
                        dmas: ['new york city', 'newark']
                    },
                    demographics: { gender: ['male'] },
                    interests: ['cat-3']
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mailman.once(approveSubject, function(msg) {
                testApprovalMsg(msg, mockCamps[0], false);
                mailmanDef.resolve();
            });
            mockman.on('campaignUpdateApproved', function(record) {
                expect(new Date(record.data.date)).not.toBe(NaN);
                expect(record.data.campaign).toEqual(jasmine.objectContaining({
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'active',
                    user: 'e2e-user'
                }));
                expect(record.data.updateRequest).toEqual(returnedBody);
                mockmanDef.resolve();
            });
            q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
        });

        it('should be able to reject an update and notify the campaign owner', function(done) {
            var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;
            options.json = { status: 'rejected', rejectionReason: 'yo campaign stinks' };
            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('rejected');
                expect(resp.body.rejectionReason).toBe('yo campaign stinks');
                expect(resp.body.campaign).toBe('cam-1');
                returnedBody = resp.body;
                
                // test that campaign successfully unlocked
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.updateRequest).not.toBeDefined();
                expect(resp.body.rejectionReason).toBe('yo campaign stinks');
                expect(resp.body.name).toBe(mockCamps[0].name);
                expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
                expect(resp.body.targeting).toEqual(mockCamps[0].targeting);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });

            mailman.once(rejectSubject, function(msg) {
                testRejectMsg(msg, mockCamps[0], 'yo campaign stinks', false);
                mailmanDef.resolve();
            });
            mockman.on('campaignUpdateRejected', function(record) {
                expect(new Date(record.data.date)).not.toBe(NaN);
                expect(record.data.campaign).toEqual(jasmine.objectContaining({
                    id: 'cam-1',
                    name: 'e2e test 1',
                    status: 'active',
                    user: 'e2e-user'
                }));
                expect(record.data.updateRequest).toEqual(returnedBody);
                mockmanDef.resolve();
            });
            q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
        });
        
        it('should return a 400 if attempting to reject an update without a reason', function(done) {
            options.json = { status: 'rejected' };
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Cannot reject update without a reason');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        describe('if an update is an inital request for approval', function() {
            var pendingCamp, pendingUpdate;
            beforeEach(function(done) {
                approveSubject = 'Reelcontent Campaign Approved';
                rejectSubject = 'Reelcontent Campaign Rejected';
                pendingCamp = {
                    id: 'cam-pending-approval',
                    name: 'my first campaign',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    advertiserId: 'e2e-a-keepme',
                    updateRequest: 'ur-pending-approval',
                    statusHistory: [
                        { date: new Date('2016-04-26T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                        { date: new Date('2016-04-25T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'draft' }
                    ]
                };
                pendingUpdate = {
                    id: 'ur-pending-approval',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    campaign: 'cam-pending-approval',
                    initialSubmit: true,
                    data: {
                        status: 'pending',
                        statusHistory: [
                            { date: new Date('2016-04-26T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                            { date: new Date('2016-04-25T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'draft' }
                        ]
                    }
                };
                
                options.url = config.adsUrl + '/campaigns/' + pendingCamp.id + '/updates/' + pendingUpdate.id;
                options.json = {};

                q.all([
                    testUtils.mongoUpsert('campaignUpdates', { id: pendingUpdate.id }, pendingUpdate),
                    testUtils.mongoUpsert('campaigns', { id: pendingCamp.id }, pendingCamp)
                ]).done(function() { done(); });
            });
            
            it('should send a different email and a campaignApproved event when approving the update', function(done) {
                options.json.status = 'approved';

                var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual(pendingUpdate.id);
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe(pendingCamp.id);
                    expect(resp.body.data.status).toBe('pending');
                    returnedBody = resp.body;
                    
                    // test that campaign successfully edited
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + pendingCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.name).toBe(pendingCamp.name);
                    expect(resp.body.status).toBe('pending');
                    expect(JSON.stringify(resp.body.statusHistory)).toEqual(JSON.stringify(pendingCamp.statusHistory));
                    expect(resp.body.pricing).toEqual(pendingCamp.pricing);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(approveSubject, function(msg) {
                    testApprovalMsg(msg, pendingCamp, true);
                    mailmanDef.resolve();
                });
                mockman.on('campaignApproved', function(record) {
                    expect(record.type).toBe('campaignApproved');
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toEqual(jasmine.objectContaining({
                        id: pendingCamp.id,
                        name: pendingCamp.name,
                        status: 'pending',
                        user: 'e2e-user'
                    }));
                    expect(record.data.updateRequest).toEqual(returnedBody);
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });

            it('should switch the campaign back to draft if rejecting the update', function(done) {
                options.json.status = 'rejected';
                options.json.rejectionReason = 'I got a problem with YOU';

                var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual(pendingUpdate.id);
                    expect(resp.body.status).toBe('rejected');
                    expect(resp.body.campaign).toBe(pendingCamp.id);
                    expect(resp.body.data.status).toBe('pending');
                    returnedBody = resp.body;
                    
                    // test that campaign successfully edited
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + pendingCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.name).toBe(pendingCamp.name);
                    expect(resp.body.status).toBe('draft');
                    expect(resp.body.statusHistory).toEqual([
                        { date: jasmine.anything(), userId: 'admin-e2e-user', user: 'adminuser', status: 'draft' },
                        { date: '2016-04-26T20:43:14.321Z', userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                        { date: '2016-04-25T20:43:14.321Z', userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'draft' }
                    ]);
                    expect(resp.body.rejectionReason).toBe('I got a problem with YOU');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(rejectSubject, function(msg) {
                    testRejectMsg(msg, pendingCamp, 'I got a problem with YOU', true);
                    mailmanDef.resolve();
                });
                mockman.on('campaignRejected', function(record) {
                    expect(record.type).toBe('campaignRejected');
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toEqual(jasmine.objectContaining({
                        id: pendingCamp.id,
                        name: pendingCamp.name,
                        status: 'pending',
                        user: 'e2e-user'
                    }));
                    expect(record.data.updateRequest).toEqual(returnedBody);
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });
        });
        
        describe('if an update was a renewal', function() {
            var pendingCamp, pendingUpdate;
            beforeEach(function(done) {
                pendingCamp = {
                    id: 'cam-pending-renewal',
                    name: 'my first campaign',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    advertiserId: 'e2e-a-keepme',
                    updateRequest: 'ur-pending-renewal',
                    statusHistory: [
                        { date: new Date('2016-04-26T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                        { date: new Date('2016-04-25T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'expired' },
                        { date: new Date('2016-04-24T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'active' }
                    ]
                };
                pendingUpdate = {
                    id: 'ur-pending-renewal',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    campaign: 'cam-pending-renewal',
                    renewal: true,
                    data: {
                        status: 'pending',
                        statusHistory: [
                            { date: new Date('2016-04-26T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                            { date: new Date('2016-04-25T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'expired' },
                            { date: new Date('2016-04-24T20:43:14.321Z'), userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'active' }
                        ]
                    }
                };
                
                options.url = config.adsUrl + '/campaigns/' + pendingCamp.id + '/updates/' + pendingUpdate.id;
                options.json = {};

                q.all([
                    testUtils.mongoUpsert('campaignUpdates', { id: pendingUpdate.id }, pendingUpdate),
                    testUtils.mongoUpsert('campaigns', { id: pendingCamp.id }, pendingCamp)
                ]).done(function() { done(); });
            });
            
            it('should send an email and a campaignUpdateApproved event when approving the update', function(done) {
                options.json.status = 'approved';

                var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual(pendingUpdate.id);
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe(pendingCamp.id);
                    expect(resp.body.data.status).toBe('pending');
                    returnedBody = resp.body;
                    
                    // test that campaign successfully edited
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + pendingCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.name).toBe(pendingCamp.name);
                    expect(resp.body.status).toBe('pending');
                    expect(JSON.stringify(resp.body.statusHistory)).toEqual(JSON.stringify(pendingCamp.statusHistory));
                    expect(resp.body.pricing).toEqual(pendingCamp.pricing);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(approveSubject, function(msg) {
                    testApprovalMsg(msg, pendingCamp, false);
                    mailmanDef.resolve();
                });
                mockman.on('campaignUpdateApproved', function(record) {
                    expect(record.type).toBe('campaignUpdateApproved');
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toEqual(jasmine.objectContaining({
                        id: pendingCamp.id,
                        name: pendingCamp.name,
                        status: 'pending',
                        user: 'e2e-user'
                    }));
                    expect(record.data.updateRequest).toEqual(returnedBody);
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });

            it('should switch the campaign back to its previous status if rejecting the update', function(done) {
                options.json.status = 'rejected';
                options.json.rejectionReason = 'I got a problem with YOU';

                var mockmanDef = q.defer(), mailmanDef = q.defer(), returnedBody;
                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.id).toEqual(pendingUpdate.id);
                    expect(resp.body.status).toBe('rejected');
                    expect(resp.body.campaign).toBe(pendingCamp.id);
                    expect(resp.body.data.status).toBe('pending');
                    returnedBody = resp.body;
                    
                    // test that campaign successfully edited
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + pendingCamp.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.name).toBe(pendingCamp.name);
                    expect(resp.body.status).toBe('expired');
                    expect(resp.body.statusHistory).toEqual([
                        { date: jasmine.anything(), userId: 'admin-e2e-user', user: 'adminuser', status: 'expired' },
                        { date: '2016-04-26T20:43:14.321Z', userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'pending' },
                        { date: '2016-04-25T20:43:14.321Z', userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'expired' },
                        { date: '2016-04-24T20:43:14.321Z', userId: 'e2e-user', user: 'c6e2etester@gmail.com', status: 'active' }
                    ]);
                    expect(resp.body.rejectionReason).toBe('I got a problem with YOU');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(rejectSubject, function(msg) {
                    testRejectMsg(msg, pendingCamp, 'I got a problem with YOU', false);
                    mailmanDef.resolve();
                });
                mockman.on('campaignUpdateRejected', function(record) {
                    expect(record.type).toBe('campaignUpdateRejected');
                    expect(new Date(record.data.date)).not.toBe(NaN);
                    expect(record.data.campaign).toEqual(jasmine.objectContaining({
                        id: pendingCamp.id,
                        name: pendingCamp.name,
                        status: 'pending',
                        user: 'e2e-user'
                    }));
                    expect(record.data.updateRequest).toEqual(returnedBody);
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });
        });
        
        describe('if the update was modifying the campaign\'s cards', function(done) {
            beforeEach(function(done) {
                var mockUpdate = {
                    id: 'ur-cards',
                    status: 'pending',
                    user: 'e2e-user',
                    org: 'o-selfie',
                    campaign: createdCampDecorated.id,
                    data: {
                        cards: [{
                            id: createdCampDecorated.cards[0].id,
                            title: 'test card 2.0',
                            data: createdCampDecorated.cards[0].data
                        }]
                    }
                };
                mockUpdate.data.cards[0].data.videoid = 'v123';
                
                createdCamp.updateRequest = 'ur-cards';
                
                return q.all([
                    testUtils.resetCollection('campaignUpdates', mockUpdate),
                    testUtils.resetCollection('campaigns', createdCamp),
                ]).done(function() { done(); });
            });

            it('should apply edits to the cards as well', function(done) {
                var mockmanDef = q.defer(), mailmanDef = q.defer();
                mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

                options = {
                    url: config.adsUrl + '/campaigns/' + createdCampDecorated.id + '/updates/ur-cards',
                    json: { status: 'approved' },
                    jar: adminJar
                };

                requestUtils.qRequest('put', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    if (resp.response.statusCode !== 200) {
                        return q.reject({ code: resp.response.statusCode, body: resp.body });
                    }

                    expect(resp.body.id).toEqual('ur-cards');
                    expect(resp.body.status).toBe('approved');
                    expect(resp.body.campaign).toBe(createdCampDecorated.id);
                    
                    // test that campaign successfully edited
                    return requestUtils.qRequest('get', {
                        url: config.adsUrl + '/campaigns/' + createdCampDecorated.id,
                        jar: selfieJar
                    });
                }).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body.updateRequest).not.toBeDefined();
                    expect(resp.body.cards[0].title).toBe('test card 2.0');
                    expect(resp.body.cards[0].campaign).toEqual(createdCampDecorated.cards[0].campaign);
                    expect(resp.body.cards[0].data).toEqual({
                        skip: 5,
                        controls: true,
                        autoplay: true,
                        autoadvance: false,
                        moat: createdCampDecorated.cards[0].data.moat,
                        videoid: 'v123'
                    });
                    
                    createdCampDecorated = resp.body;
                    return testUtils.checkCardEntities(createdCampDecorated, adminJar, config.contentUrl);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                    done();
                });

                mailman.once(approveSubject, function(msg) {
                    testApprovalMsg(msg, createdCampDecorated, false);

                    mailmanDef.resolve();
                });
                mockman.on('campaignUpdateApproved', function(record) {
                    mockmanDef.resolve();
                });
                q.all([mockmanDef.promise, mailmanDef.promise]).thenResolve().then(done);
            });
        });
        
        it('should allow a selfie user to edit their update request but not approve it', function(done) {
            options.jar = selfieJar;
            options.json.status = 'approved';
            options.json.data.pricing.cost = 0.000000001;

            mailman.once(approveSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });
            mailman.once(rejectSubject, function(msg) { expect(util.inspect(msg).substring(0, 200)).not.toBeDefined(); });

            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toEqual('ur-1');
                expect(resp.body.status).toBe('pending');
                expect(resp.body.campaign).toBe('cam-1');
                expect(resp.body.data).toEqual({
                    id: 'cam-1',
                    status: 'active',
                    application: 'selfie',
                    name: 'fernando',
                    pricing: { budget: 500, dailyLimit: 100, cost: 0.08, model: 'cpv' },
                    targeting: {
                        geo: {
                            states: ['new jersey' ],
                            dmas: ['new york city', 'newark']
                        },
                        demographics: { gender: ['male'] },
                        interests: ['cat-3'],
                    },
                    updateRequest: 'ur-1',
                    advertiserId: 'e2e-a-keepme',
                    user: 'e2e-user',
                    org: 'o-selfie'
                });
                
                // test that campaign not edited yet
                return requestUtils.qRequest('get', {
                    url: config.adsUrl + '/campaigns/cam-1',
                    jar: selfieJar
                });
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.updateRequest).toBe('ur-1');
                expect(resp.body.name).toBe(mockCamps[0].name);
                expect(resp.body.pricing).toEqual(mockCamps[0].pricing);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org cannot afford the budget increase', function(done) {
            options.json.data.pricing.budget = 4000;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(402);
                expect(resp.body).toEqual({
                    message: 'Insufficient funds for changes to campaign',
                    depositAmount: 2900
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent editing updates for a different campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-2/updates/ur-1';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Update request does not apply to this campaign');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should prevent editing updates for a deleted campaign', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-deleted/updates/ur-deletedCamp';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Object not found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a nonexistent update', function(done) {
            options.url = config.adsUrl + '/campaigns/cam-1/updates/ur-fake';
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('That does not exist');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if the user is not authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    afterAll(function(done) {
        mockman.stop();
        testUtils.closeDbs().done(done);
    });
});
