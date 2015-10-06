var q               = require('q'),
    request         = require('request'),
    isArray         = require('util').isArray,
    requestUtils    = require('../../lib/requestUtils'),
    testUtils       = require('./testUtils'),
    host            = process.env.host || 'localhost',
    config = {
        querybotUrl : 'http://' + (host === 'localhost' ? host + ':4100' : host) +
            '/api/analytics/campaigns',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) +
            '/api/auth'
    };

function pgQuery(conn,statement) {
    var pg = require('pg.js'),
        deferred = q.defer();
    
    pg.connect(conn, function(err, client, done){
        if (err) {
            return deferred.reject(err);
        }

        client.query(statement, function(err,res) {
            if (err) {
                done();
                return deferred.reject(err);
            }

            done();
            return deferred.resolve(res);
        });

    });

    return deferred.promise;
}

describe('querybot (E2E)', function(){
    var pgdata_crosstab, pgdata_crosstab_daily, mockUser, mockCamps, pgconn,
        cookieJar, options;

    beforeEach(function(done){
        // TODO:  Work out what connection config should be!
        pgconn = {
            user    : 'cwrx',
            password: 'password',
            database: 'campfire_cwrx',
            host    : JSON.parse(process.env.mongo).host
        };
       
        pgdata_crosstab = [
            'INSERT INTO rpt.campaign_crosstab_live VALUES',
            '(\'cam-5bebbf1c34a3d7\',120000,100000,1000,11.22,670,350,130,0,0,29,11,7,0),',
            '(\'cam-237505b42ee19f\',550000,500000,2000,12.25,500,300,100,0,110,10,10,10,10),',
            '(\'cam-278b8150021c68\',390000,300000,1200,13.13,500,300,100,0,100,90,80,70,60),',
            '(\'cam-bfc62ac554280e\',425000,400000,1500,10.98,500,300,100,0,100,90,80,70,60),',
            '(\'cam-1ca2ee2c0ded77\',824000,800000,2500,11.11,500,300,100,0,100,90,80,70,60);'
        ];
        
        pgdata_crosstab_daily = [
            'INSERT INTO rpt.campaign_daily_crosstab_live VALUES',
            '(\'2015-09-28\',\'cam-5bebbf1c34a3d7\',120000,50000,500,7.22,300,100,100,0,0,10,5,2,0),',
            '(\'2015-09-29\',\'cam-5bebbf1c34a3d7\',120000,20000,300,2.00,200,100,0,0,0,10,2,1,0),',
            '(\'2015-09-30\',\'cam-5bebbf1c34a3d7\',120000,20000,100,1.00,90,80,0,0,0,8,2,2,0),',
            '(\'2015-10-01\',\'cam-5bebbf1c34a3d7\',120000,10000,100,1.00,80,70,30,0,0,1,2,2,0);'
        ];
        
        mockUser = {
            id: 'e2e-user', org: 'e2e-org', status: 'active', email : 'querybot',
            // hash of 'password'
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', 
            permissions: {
                cards: { delete: 'org' },
                experiences: { delete: 'org' },
                campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' }
            }
        };
        
        mockCamps = [
            { id: 'cam-5bebbf1c34a3d7', name: 'camp 1', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-237505b42ee19f', name: 'camp 2', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-278b8150021c68', name: 'camp 3', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'e2e-getid3', name: 'camp 4', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' }
        ];

        function pgTruncate(){
            return pgQuery(pgconn,'TRUNCATE TABLE rpt.campaign_crosstab_live')
                .then(function(){
                    return pgQuery(pgconn,
                        'TRUNCATE TABLE rpt.campaign_daily_crosstab_live');
                });
        }

        function pgInsert() {
            return pgQuery(pgconn,pgdata_crosstab.join(' '))
                .then(function(){
                    return pgQuery(pgconn,pgdata_crosstab_daily.join(' '));
                });
        }

        function mongoInsert() {
            return testUtils.resetCollection('users', mockUser)
                .then(function() {
                    return testUtils.resetCollection('campaigns', mockCamps);
                });
        }

        pgTruncate().then(pgInsert).then(mongoInsert).then(done,done.fail);
    });

    beforeEach(function(done){
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = request.jar();

        requestUtils.qRequest('post', {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'querybot',
                password: 'password'
            }
        })
        .then(done,done.fail);
    });

    beforeEach(function(){
        options = {
            url : config.querybotUrl,
            jar : cookieJar
        };
    });

    describe('GET /api/analytics/campaigns/:id', function() {
        it('requires authentication',function(done){
            delete options.jar;
            options.url += '/cam-5bebbf1c34a3d7';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(401);
                expect(resp.response.body).toEqual('Unauthorized');
            })
            .then(done,done.fail);

        });

        it('returns a 500 error if there is no campaignID',function(done){
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(500);
                expect(resp.response.body).toEqual('At least one campaignId is required.');
            })
            .then(done,done.fail);
        });

        it('returns a 404 if the campaignId is not found',function(done){
            options.url += '/cam-278b8150021c68';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(404);
                expect(resp.response.body).toEqual('Not Found');
            })
            .then(done,done.fail);
        });

        it('returns single document if the campaigns GET is singular form',function(done){
            options.url += '/cam-5bebbf1c34a3d7';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual({
                    campaignId : 'cam-5bebbf1c34a3d7',
                    summary : {
                        impressions: 100000,
                        views: 1000,
                        clicks: 47,
                        totalSpend : '11.2200'
                    }
                });
            })
            .then(done,done.fail);
        });
        
    });
    
    describe('GET /api/analytics/campaigns/?id=:id', function() {
        it('requires authentication',function(done){
            delete options.jar;
            options.url += '/?id=cam-5bebbf1c34a3d7';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(401);
                expect(resp.response.body).toEqual('Unauthorized');
            })
            .then(done,done.fail);
        });

        it('returns a 200 with empty array if the campaignId is not found',function(done){
            options.url += '/?id=cam-278b8150021c68';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual([]);
            })
            .then(done,done.fail);
        });

        it('returns single document array if the campaigns GET is plural form',function(done){
            options.url += '/?id=cam-5bebbf1c34a3d7';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual([{
                    campaignId : 'cam-5bebbf1c34a3d7',
                    summary : {
                        impressions: 100000,
                        views: 1000,
                        clicks: 47,
                        totalSpend : '11.2200'
                    }
                }]);
            })
            .then(done,done.fail);
        });
        
        it('returns document array if the campaigns GET is plural form',function(done){
            options.url += '/?id=cam-5bebbf1c34a3d7,cam-237505b42ee19f';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(isArray(resp.body)).toEqual(true);
                expect(resp.body).toContain(jasmine.objectContaining({
                    campaignId : 'cam-5bebbf1c34a3d7',
                    summary : {
                        impressions: 100000,
                        views: 1000,
                        clicks: 47,
                        totalSpend : '11.2200'
                    }
                }));
                expect(resp.body).toContain(jasmine.objectContaining({
                    campaignId : 'cam-237505b42ee19f',
                    summary : {
                        impressions: 500000,
                        views: 2000,
                        clicks: 150,
                        totalSpend : '12.2500'
                    }
                }));
            })
            .then(done,done.fail);
        });

        it('returns document array with found items, omits unfound ',function(done){
            options.url += '/?id=cam-5bebbf1c34a3d7,cam-237505b42ee19f,cam-278b8150021c68';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body.length).toEqual(2);
                expect(resp.body).toContain(jasmine.objectContaining({
                    campaignId : 'cam-5bebbf1c34a3d7',
                    summary : {
                        impressions: 100000,
                        views: 1000,
                        clicks: 47,
                        totalSpend : '11.2200'
                    }
                }));
                expect(resp.body).toContain(jasmine.objectContaining({
                    campaignId : 'cam-237505b42ee19f',
                    summary : {
                        impressions: 500000,
                        views: 2000,
                        clicks: 150,
                        totalSpend : '12.2500'
                    }
                }));
            })
            .then(done,done.fail);
        });
    });
});

