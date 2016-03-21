var q               = require('q'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    host            = process.env.host || 'localhost',
    config = {
        accountantUrl   : 'http://' + (host === 'localhost' ? host + ':4300' : host) + '/api',
        authUrl         : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('accountant (E2E):', function() {
    var cookieJar, adminJar, mockRequester, mockAdmin, testPolicies, mockApp, appCreds;

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 10000;

        if (cookieJar && adminJar) {
            return done();
        }
        cookieJar = require('request').jar();
        adminJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'accountantuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['e2eGetOrgCamps']
        };
        mockAdmin = {
            id: 'e2e-admin-user',
            status: 'active',
            email : 'adminuser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            policies: ['e2eAdmin']
        };
        testPolicies = [
            {
                id: 'p-e2e-basic',
                name: 'e2eGetOrgCamps',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'org' },
                    campaigns: { read: 'org' }
                }
            },
            {
                id: 'p-e2e-admin',
                name: 'e2eAdmin',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'all' },
                    campaigns: { read: 'all' },
                    transactions: { read: 'all', create: 'all' }
                }
            }
        ];

        mockApp = {
            id: 'app-e2e-accountant',
            key: 'e2e-accountant',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                orgs: { read: 'all' },
                campaigns: { read: 'all' },
                transactions: { read: 'all', create: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };

        var logins = [
            { url: config.authUrl + '/login', json: { email: 'accountantuser', password: 'password' }, jar: cookieJar },
            { url: config.authUrl + '/login', json: { email: 'adminuser', password: 'password' }, jar: adminJar }
        ];
            
        q.all([
            testUtils.resetCollection('users', [mockRequester, mockAdmin]),
            testUtils.resetCollection('policies', testPolicies),
            testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
        ]).then(function(resp) {
            return q.all(logins.map(function(opts) {
                return requestUtils.qRequest('post', opts);
            }));
        }).done(function(resp) {
            done();
        });
    });
    
    // setup mock data for all tests
    beforeEach(function(done) {
        var transCounter = 9999;
        
        function creditRecord(org, amount, braintreeId, promotion, desc) {
            var recKey = transCounter++,
                id = 't-e2e-' + String(recKey);

            braintreeId = braintreeId || '';
            promotion = promotion || '';
            desc = desc || '';
            
            return '(' + recKey + ',\'2016-03-21T15:53:11.927Z\',\'' + id + '\',\'2016-03-21T15:53:11.927Z\',\'' +
                   org + '\',' + amount + ',1,1,\'\',\'' + braintreeId + '\',\'' + promotion + '\',\'' + desc + '\')';
        }
        function debitRecord(org, amount, units, campaign, desc) {
            var recKey = transCounter++,
                id = 't-e2e-' + String(recKey);

            units = units || 1;
            campaign = campaign || '';
            desc = desc || '';
            
            return '(' + recKey + ',\'2016-03-21T15:53:11.927Z\',\'' + id + '\',\'2016-03-21T15:53:11.927Z\',\'' +
                   org + '\',' + amount + ',-1,' + units + ',\'' + campaign + '\',\'\',\'\',\'' + desc + '\')';
        }
        
        var testOrgs = [
            { id: 'o-1234', name: 'org 1', status: 'active' },
            { id: 'o-5678', name: 'org 2', status: 'active' }
        ];
        var testCamps = [
            { id: 'cam-1', status: 'active', org: 'o-1234', pricing: { budget: 1000 } },
            { id: 'cam-2', status: 'paused', org: 'o-1234', pricing: { budget: 500 } },

            { id: 'cam-3', status: 'active', org: 'o-5678', pricing: { budget: 600 } },
            { id: 'cam-4', status: 'expired', org: 'o-5678', pricing: { budget: 8000 } },
            { id: 'cam-5', status: 'active', org: 'o-5678', pricing: { budget: 300 } }
        ];
        var testTransactions = [
            creditRecord('o-1234', 5000, 'pay1'),
            debitRecord('o-1234', 20, 10, 'cam-1'),
            debitRecord('o-1234', 444, 500, 'cam-1'),
            debitRecord('o-1234', 16, 1, 'cam-1'),
            debitRecord('o-1234', 200, 30, 'cam-1'),
            debitRecord('o-1234', 66, 5, 'cam-2'),
            debitRecord('o-1234', 77, 10, 'cam-2'),
        
            creditRecord('o-5678', 10000, 'pay2'),
            creditRecord('o-5678', 4000, 'pay3'),
            debitRecord('o-5678', 45, 10, 'cam-3'),
            debitRecord('o-5678', 123, 500, 'cam-3'),
            debitRecord('o-5678', 16, 1, 'cam-3'),
            debitRecord('o-5678', 6000, 666, 'cam-4'),
            debitRecord('o-5678', 1000, 666, 'cam-4'),
            debitRecord('o-5678', 500, 666, 'cam-4')
        ];
        
        return q.all([
            testUtils.resetCollection('orgs', testOrgs),
            testUtils.resetCollection('campaigns', testCamps),
            testUtils.resetPGTable('fct.billing_transactions', testTransactions)
        ]).done(function(results) {
            done();
        });
    });

    describe('POST /api/transaction', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/transactions',
                json: {
                    org: 'o-1234',
                    amount: 123.45,
                    braintreeId: 'payment1'
                },
                jar: adminJar
            };
        });
        
        it('should create a transaction record', function(done) {
            var createdObj;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : resp.body.created,
                    amount          : 123.45,
                    sign            : 1,
                    units           : 1,
                    org             : 'o-1234',
                    campaign        : null,
                    braintreeId     : 'payment1',
                    promotion       : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
                });
                expect(new Date(resp.body.created).toString()).not.toBe('Invalid Date');
                createdObj = resp.body;
                
                return testUtils.pgQuery('SELECT * FROM fct.billing_transactions WHERE transaction_id = $1', [resp.body.id]);
            }).then(function(results) {
                expect(results.rows.length).toBe(1);
                expect(results.rows[0]).toEqual(jasmine.objectContaining({
                    rec_key         : jasmine.any(String),
                    rec_ts          : new Date(createdObj.created),
                    transaction_id  : createdObj.id,
                    transaction_ts  : new Date(createdObj.created),
                    org_id          : 'o-1234',
                    amount          : '123.4500',
                    sign            : 1,
                    units           : 1,
                    campaign_id     : null,
                    braintree_id    : 'payment1',
                    promotion_id    : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
                }));
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', { service: 'accountant' }, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-admin-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('accountant');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/transactions?',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create a transaction linked to a promotion', function(done) {
            delete options.json.braintreeId;
            options.json.promotion = 'pro-skillz';
            
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : resp.body.created,
                    amount          : 123.45,
                    sign            : 1,
                    units           : 1,
                    org             : 'o-1234',
                    campaign        : null,
                    braintreeId     : null,
                    promotion       : 'pro-skillz',
                    description     : JSON.stringify({ eventType: 'credit', source: 'promotion' })
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should not allow creating unlinked transactions', function(done) {
            delete options.json.braintreeId;
            
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot create unlinked credit');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow specifying a custom description', function(done) {
            options.json.description = 'here have a lil walkin around money man';

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : resp.body.created,
                    amount          : 123.45,
                    sign            : 1,
                    units           : 1,
                    org             : 'o-1234',
                    campaign        : null,
                    braintreeId     : 'payment1',
                    promotion       : null,
                    description     : 'here have a lil walkin around money man'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim forbidden fields', function(done) {
            options.json.id = 't-!@*#^%!@*$&!%@*#&^!*@&#%!*@&$^*!&@$^';
            options.json.created = new Date('2000-03-21T15:53:11.927Z');
            options.json.sign = -1;
            options.json.units = 9001;
            
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : resp.body.created,
                    amount          : 123.45,
                    sign            : 1,
                    units           : 1,
                    org             : 'o-1234',
                    campaign        : null,
                    braintreeId     : 'payment1',
                    promotion       : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
                });
                expect(resp.body.id).not.toEqual(options.json.id);
                expect(resp.body.created).not.toEqual(options.json.created);
                expect(new Date(resp.body.created).toString()).not.toBe('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent users without transaction priviledges from creating transactions', function(done) {
            options.jar = cookieJar;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if no requester is authenticated', function(done) {
            delete options.jar;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an app to create transactions', function(done) {
            delete options.jar;

            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : resp.body.created,
                    amount          : 123.45,
                    sign            : 1,
                    units           : 1,
                    org             : 'o-1234',
                    campaign        : null,
                    braintreeId     : 'payment1',
                    promotion       : null,
                    description     : JSON.stringify({ eventType: 'credit', source: 'braintree' })
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
            delete options.jar;
            var badCreds = { key: mockApp.key, secret: 'WRONG' };
            requestUtils.makeSignedRequest(badCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/accounting/balance', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/accounting/balance',
                qs: {},
                jar: cookieJar
            };
        });
        
        it('should get balance information for the requester\'s org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    balance: 4177,
                    outstandingBudget: 677
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', { service: 'accountant' }, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].sessionID).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('accountant');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/accounting/balance',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow an admin to request the balance for another org', function(done) {
            options.qs.org = 'o-5678';
            
            q.all([cookieJar, adminJar].map(function(jar) {
                options.jar = jar;
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toEqual('Cannot fetch balance for this org');
                expect(results[1].response.statusCode).toBe(200);
                expect(results[1].body).toEqual({
                    balance: 6316,
                    outstandingBudget: 716
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if requesting the balance of a non-existent org', function(done) {
            options.qs.org = 'o-faaaaaake';
            options.jar = adminJar;

            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot fetch balance for this org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if no requester is authenticated', function(done) {
            delete options.jar;

            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an app to get balances', function(done) {
            delete options.jar;
            options.qs.org = 'o-1234';

            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    balance: 4177,
                    outstandingBudget: 677
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    afterAll(function(done) {
        testUtils.closeDbs().done(done);
    });
});

