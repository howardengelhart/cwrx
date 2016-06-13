var q               = require('q'),
    util            = require('util'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    objUtils        = require('../../lib/objUtils'),
    host            = process.env.host || 'localhost',
    config = {
        accountantUrl   : 'http://' + (host === 'localhost' ? host + ':4300' : host) + '/api',
        authUrl         : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('accountant (E2E):', function() {
    var cookieJar, adminJar, mockRequester, mockAdmin, testPolicies, mockApp, appCreds, mockman;

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
            policies: ['e2eGetOrgData']
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
                name: 'e2eGetOrgData',
                status: 'active',
                priority: 1,
                permissions: {
                    orgs: { read: 'org' },
                    campaigns: { read: 'org' },
                    transactions: { read: 'org' }
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

    beforeAll(function(done) {
        mockman = new testUtils.Mockman();

        mockman.start().then(done, done.fail);
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
            { id: 'o-5678', name: 'org 2', status: 'active' },
            { id: 'o-abcd', name: 'org 3', status: 'active' },
            { id: 'o-efgh', name: 'org 4', status: 'active' },
        ];
        var testCamps = [
            { id: 'cam-o1-active', status: 'active', org: 'o-1234', pricing: { budget: 1000 } },
            { id: 'cam-o1-paused', status: 'paused', org: 'o-1234', pricing: { budget: 500 } },
            { id: 'cam-o1-pending', status: 'pending', org: 'o-1234', pricing: { budget: 50 } },

            { id: 'cam-o2-active', status: 'active', org: 'o-5678', pricing: { budget: 600 } },
            { id: 'cam-o2-expired', status: 'expired', org: 'o-5678', pricing: { budget: 8000 } },
            { id: 'cam-o2-active-2', status: 'active', org: 'o-5678', pricing: { budget: 300 } }
        ];
        var testTransactions = [
            creditRecord('o-1234', 2200, 'pay11'),
            creditRecord('o-1234', 1500, null, 'pro-11'),
            creditRecord('o-1234', 500, 'pay12'),
            creditRecord('o-1234', 800, 'pay13'),
            debitRecord('o-1234', 20, 10, 'cam-o1-active'),
            debitRecord('o-1234', 444, 500, 'cam-o1-active'),
            debitRecord('o-1234', 16, 1, 'cam-o1-active'),
            debitRecord('o-1234', 200, 30, 'cam-o1-active'),
            debitRecord('o-1234', 66, 5, 'cam-o1-paused'),
            debitRecord('o-1234', 77, 10, 'cam-o1-paused'),
        
            creditRecord('o-5678', 10000, 'pay21'),
            creditRecord('o-5678', 3000, 'pay22'),
            creditRecord('o-5678', 1000, null, 'pro-21'),
            debitRecord('o-5678', 45, 10, 'cam-o2-active'),
            debitRecord('o-5678', 123, 500, 'cam-o2-active'),
            debitRecord('o-5678', 16, 1, 'cam-o2-active'),
            debitRecord('o-5678', 6000, 666, 'cam-o2-expired'),
            debitRecord('o-5678', 1000, 666, 'cam-o2-expired'),
            debitRecord('o-5678', 500, 666, 'cam-o2-expired'),
            
            creditRecord('o-efgh', 400, null, 'pro-31'),
            creditRecord('o-efgh', 400, 'pay31'),
            debitRecord('o-efgh', 56, 1),
        ];
        
        return q.all([
            testUtils.resetCollection('orgs', testOrgs),
            testUtils.resetCollection('campaigns', testCamps),
            testUtils.resetPGTable('fct.billing_transactions', testTransactions)
        ]).done(function(results) {
            done();
        });
    });

    afterEach(function() {
        mockman.removeAllListeners();
    });
    
    describe('GET /api/transactions', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/transactions',
                qs: { sort: 'amount,-1', },
                jar: cookieJar
            };
        });
        
        it('should get transaction records from the requester\'s org', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual(jasmine.objectContaining({ id: 't-e2e-9999', org: 'o-1234', amount: 2200, braintreeId: 'pay11' }));
                expect(resp.body[1]).toEqual(jasmine.objectContaining({ id: 't-e2e-10000', org: 'o-1234', amount: 1500, promotion: 'pro-11' }));
                expect(resp.body[2]).toEqual(jasmine.objectContaining({ id: 't-e2e-10002', org: 'o-1234', amount: 800, braintreeId: 'pay13' }));
                expect(resp.body[3]).toEqual(jasmine.objectContaining({ id: 't-e2e-10001', org: 'o-1234', amount: 500, braintreeId: 'pay12' }));
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
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
                expect(results[0].data).toEqual({route: 'GET /api/transactions/',
                                                 params: {}, query: { sort: 'amount,-1' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should only allow an admin to specify another org', function(done) {
            q.all([cookieJar, adminJar].map(function(jar) {
                options.jar = jar;
                options.qs.org = 'o-5678';
                return requestUtils.qRequest('get', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(403);
                expect(results[0].body).toBe('Not authorized to get transactions for this org');
                expect(results[1].response.statusCode).toBe(200);
                expect(results[1].body).toEqual(jasmine.any(Array));
                expect(results[1].body.length).toBe(3);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 200 and [] if nothing is found', function(done) {
            options.jar = adminJar;
            options.qs.org = 'o-aewoiruOIuvvsdf';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow specifying which fields to fetch', function(done) {
            options.qs.fields = 'amount,units,braintreeId';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0]).toEqual({ id: 't-e2e-9999', units: 1, amount: 2200, braintreeId: 'pay11' });
                expect(resp.body[1]).toEqual({ id: 't-e2e-10000', units: 1, amount: 1500, braintreeId: '' });
                expect(resp.body[2]).toEqual({ id: 't-e2e-10002', units: 1, amount: 800, braintreeId: 'pay13' });
                expect(resp.body[3]).toEqual({ id: 't-e2e-10001', units: 1, amount: 500, braintreeId: 'pay12' });
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow paginating and sorting results', function(done) {
            options.qs.limit = 2;
            options.qs.sort = 'id,-1';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('t-e2e-9999');
                expect(resp.body[1].id).toBe('t-e2e-10002');
                expect(resp.response.headers['content-range']).toBe('items 1-2/4');
                
                options.qs.skip = 2;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(2);
                expect(resp.body[0].id).toBe('t-e2e-10001');
                expect(resp.body[1].id).toBe('t-e2e-10000');
                expect(resp.response.headers['content-range']).toBe('items 3-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 401 if no user is authenticated', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow an app to get transactions', function(done) {
            delete options.jar;
            options.qs.org = 'o-1234';
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.length).toBe(4);
                expect(resp.body[0].id).toBe('t-e2e-9999');
                expect(resp.body[1].id).toBe('t-e2e-10000');
                expect(resp.body[2].id).toBe('t-e2e-10002');
                expect(resp.body[3].id).toBe('t-e2e-10001');
                expect(resp.response.headers['content-range']).toBe('items 1-4/4');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the app does not specify an org param', function(done) {
            delete options.jar;
            delete options.qs.org;
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Must provide an org id');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });

    describe('POST /api/transactions', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/transactions',
                json: {
                    org: 'o-1234',
                    amount: 123.45,
                    braintreeId: 'payment1'
                }
            };
        });
        
        it('should create a transaction record', function(done) {
            var createdObj;

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

        it('should produce a transactionCreated event', function(done) {
            var transaction;

            mockman.on('transactionCreated', function(record) {
                if (record.data.transaction.id !== transaction.id) { return; }

                expect(record).toEqual({
                    type: 'transactionCreated',
                    data: {
                        transaction: transaction,
                        date: jasmine.any(String)
                    }
                });

                return done();
            });

            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                if (resp.response.statusCode !== 201) {
                    done.fail(resp.body);
                } else {
                    transaction = resp.body;
                }
            });
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', { service: 'accountant' }, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].application).toBe('app-e2e-accountant');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].uuid).toEqual(jasmine.any(String));
                expect(results[0].service).toBe('accountant');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/transactions/',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should be able to create a transaction linked to a promotion', function(done) {
            delete options.json.braintreeId;
            options.json.promotion = 'pro-skillz';
            
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
                    braintreeId     : null,
                    promotion       : 'pro-skillz',
                    description     : JSON.stringify({ eventType: 'credit', source: 'promotion' })
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to specify a custom transactionTS', function(done) {
            options.json.transactionTS = new Date('2016-03-17T20:29:06.754Z');
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toEqual({
                    id              : jasmine.any(String),
                    created         : jasmine.any(String),
                    transactionTS   : '2016-03-17T20:29:06.754Z',
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
        
        it('should not allow creating unlinked transactions', function(done) {
            delete options.json.braintreeId;
            
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot create unlinked credit');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow specifying a custom description', function(done) {
            options.json.description = 'here have a lil walkin around money man';

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
                    description     : 'here have a lil walkin around money man'
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the description is too long', function(done) {
            options.json.description = new Array(1000).join(',').split(',').map(function() { return 'a'; }).join('');
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('description must have at most 255 characters');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should trim forbidden fields', function(done) {
            options.json.id = 't-!@*#^%!@*$&!%@*#&^!*@&#%!*@&$^*!&@$^';
            options.json.created = new Date('2000-03-21T15:53:11.927Z');
            options.json.sign = -1;
            options.json.units = 9001;
            
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
                expect(resp.body.id).not.toEqual(options.json.id);
                expect(resp.body.created).not.toEqual(options.json.created);
                expect(new Date(resp.body.created).toString()).not.toBe('Invalid Date');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent apps without transaction priviledges from creating transactions', function(done) {
            var newApp = {
                id: 'app-e2e-watchkid',
                key: 'e2e-watchkid',
                status: 'active',
                secret: 'wowsuchsecretverysecureamaze',
                permissions: {
                    orgs: { read: 'all' },
                    campaigns: { read: 'all' },
                    transactions: { read: 'all' }
                }
            };
            var newAppCreds = { key: newApp.key, secret: newApp.secret };
            testUtils.mongoUpsert('applications', { key: newApp.key }, newApp).then(function() {
                return requestUtils.makeSignedRequest(newAppCreds, 'post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toEqual('Forbidden');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should return a 401 if a user attempts to send a request', function(done) {
            options.jar = adminJar;

            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toEqual('Unauthorized');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail if an app uses the wrong secret to make a request', function(done) {
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
                    outstandingBudget: 727,
                    totalSpend: 823
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
        
        it('should handle update requests that change campaign budgets', function(done) {
            var updates = [
                { id: 'ur-pending-1', status: 'pending', campaign: 'cam-o1-active', data: { pricing: { budget: 4 } } }, // decrease, but will be ignored
                { id: 'ur-pending-2', status: 'pending', campaign: 'cam-o1-paused', data: { pricing: { budget: 1000 } } } // increase of $500
            ];

            // Insert update requests, and update parent campaigns with update's id. Will be overriden in beforeEach for next test.
            q.all(updates.map(function(obj) {
                return q.all([
                    testUtils.mongoUpsert('campaignUpdates', { id: obj.id }, obj),
                    testUtils.mongoUpsert('campaigns', { id: obj.campaign }, { $set: { updateRequest: obj.id } })
                ]);
            })).then(function() {
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    balance: 4177,
                    outstandingBudget: 1227,
                    totalSpend: 823
                });
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
                expect(results[0].response.statusCode).toBe(404);
                expect(results[0].body).toEqual('Cannot fetch this org');
                expect(results[1].response.statusCode).toBe(200);
                expect(results[1].body).toEqual({
                    balance: 6316,
                    outstandingBudget: 716,
                    totalSpend: 7684
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle orgs without any transactions', function(done) {
            options.qs.org = 'o-abcd';
            options.jar = adminJar;

            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    balance: 0,
                    outstandingBudget: 0,
                    totalSpend: 0
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done); 
        });
        
        it('should handle orgs without any campaigns', function(done) {
            options.qs.org = 'o-efgh';
            options.jar = adminJar;

            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({
                    balance: 744,
                    outstandingBudget: 0,
                    totalSpend: 56
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done); 
        });
        
        it('should return a 404 if requesting the balance of a non-existent org', function(done) {
            options.qs.org = 'o-faaaaaake';
            options.jar = adminJar;

            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('Cannot fetch this org');
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
                    outstandingBudget: 727,
                    totalSpend: 823
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('GET /api/accounting/balances', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/accounting/balances',
                qs: { orgs: 'o-1234,o-5678,o-abcd,o-efgh' },
                jar: adminJar
            };
        });
        
        it('should get the balance for multiple orgs', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body['o-1234']).toEqual({
                    balance: 4177,
                    outstandingBudget: 727,
                    totalSpend: 823
                });
                expect(resp.body['o-5678']).toEqual({
                    balance: 6316,
                    outstandingBudget: 716,
                    totalSpend: 7684
                });
                expect(resp.body['o-abcd']).toEqual({
                    balance: 0,
                    outstandingBudget: 0,
                    totalSpend: 0
                });
                expect(resp.body['o-efgh']).toEqual({
                    balance: 744,
                    outstandingBudget: 0,
                    totalSpend: 56
                });
                expect(Object.keys(resp.body).sort()).toEqual(['o-1234', 'o-5678', 'o-abcd', 'o-efgh']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
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
                expect(results[0].data).toEqual({route: 'GET /api/accounting/balances',
                                                 params: {}, query: { orgs: 'o-1234,o-5678,o-abcd,o-efgh' } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should only allow a non-admin to get the balance for their org', function(done) {
            options.jar = cookieJar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body['o-1234']).toEqual({
                    balance: 4177,
                    outstandingBudget: 727,
                    totalSpend: 823
                });
                expect(resp.body['o-5678']).toEqual(null);
                expect(resp.body['o-abcd']).toEqual(null);
                expect(resp.body['o-efgh']).toEqual(null);
                expect(Object.keys(resp.body).sort()).toEqual(['o-1234', 'o-5678', 'o-abcd', 'o-efgh']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should default the list of orgs to the requester\'s org', function(done) {
            delete options.qs.orgs;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ 'o-1234': {
                    balance: 4177,
                    outstandingBudget: 727,
                    totalSpend: 823
                } });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return null responses for non-existent orgs', function(done) {
            options.qs.orgs = 'o-faaaake';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ 'o-faaaake': null });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });

        it('should allow an app to get balances', function(done) {
            delete options.jar;
            options.qs.org = 'o-1234';

            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body['o-1234']).toEqual({
                    balance: 4177,
                    outstandingBudget: 727,
                    totalSpend: 823
                });
                expect(resp.body['o-5678']).toEqual({
                    balance: 6316,
                    outstandingBudget: 716,
                    totalSpend: 7684
                });
                expect(resp.body['o-abcd']).toEqual({
                    balance: 0,
                    outstandingBudget: 0,
                    totalSpend: 0
                });
                expect(resp.body['o-efgh']).toEqual({
                    balance: 744,
                    outstandingBudget: 0,
                    totalSpend: 56
                });
                expect(Object.keys(resp.body).sort()).toEqual(['o-1234', 'o-5678', 'o-abcd', 'o-efgh']);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('POST /api/accounting/credit-check', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.accountantUrl + '/accounting/credit-check',
                json: {
                    org: 'o-1234',
                    campaign: 'cam-o1-active',
                    newBudget: 1500
                },
                jar: cookieJar
            };
        });
        
        it('should return a 204 if the credit check succeeds', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toEqual('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
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
                expect(results[0].data).toEqual({route: 'POST /api/accounting/credit-check',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should still succeed if no newBudget is passed', function(done) {
            delete options.json.newBudget;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toEqual('');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 402 if the org cannot afford the campaign changes', function(done) {
            options.json.newBudget = 5000.123;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(402);
                expect(resp.body).toEqual({
                    message: 'Insufficient funds for changes to campaign',
                    depositAmount: 550.12
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a minimum depositAmount of 1.00', function(done) {
            options.json.newBudget = 4450.66;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(402);
                expect(resp.body).toEqual({
                    message: 'Insufficient funds for changes to campaign',
                    depositAmount: 1
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should exclude expired campaigns from calculations except for the request campaign', function(done) {
            delete options.json.newBudget;

            var newCamp = { id: 'cam-o1-bigbudget', status: 'expired', org: 'o-1234', pricing: { budget: 9999 } };
            testUtils.mongoUpsert('campaigns', { id: newCamp.id }, newCamp).then(function() {
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                // credit check succeeds with other campaign, since new camp is ignored
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toEqual('');
                
                options.json.campaign = 'cam-o1-bigbudget';
                return requestUtils.qRequest('post', options);
            }).then(function(resp) {
                // credit check fails with this campaign, as it assumes campaign is renewing
                expect(resp.response.statusCode).toBe(402);
                expect(resp.body).toEqual({
                    message: 'Insufficient funds for changes to campaign',
                    depositAmount: 6549
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if required parameters are not passed', function(done) {
            q.all([{ org: 'o-1234' }, { campaign: 'cam-o1-active' }].map(function(body) {
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('Missing required field: campaign');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('Missing required field: org');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the org or campaign are not found', function(done) {
            q.all([
                { org: 'o-faaaaaaake', campaign: 'cam-o1-active' },
                { org: 'o-1234', campaign: 'cam-faaaaaaake' }
            ].map(function(body) {
                objUtils.extend(body, options.json);
                options.json = body;
                return requestUtils.qRequest('post', options);
            })).then(function(results) {
                expect(results[0].response.statusCode).toBe(400);
                expect(results[0].body).toBe('Cannot fetch this org');
                expect(results[1].response.statusCode).toBe(400);
                expect(results[1].body).toBe('Cannot fetch this campaign');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign + org do not match', function(done) {
            options.json.org = 'o-5678';
            options.jar = adminJar;
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Campaign cam-o1-active does not belong to o-5678');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        
        it('should return a 400 if the requester does not have permission to fetch the org or campaign', function(done) {
            options.json.org = 'o-5678';
            options.json.campaign = 'cam-o2-active';
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toEqual('Cannot fetch this org');
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
        
        it('allow an app to make a credit check', function(done) {
            delete options.jar;
            requestUtils.makeSignedRequest(appCreds, 'post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toEqual('');
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

