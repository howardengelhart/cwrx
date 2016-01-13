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
    var pgdata_campaign_summary_hourly, mockUser, mockCamps, pgconn,
        cookieJar, options, camp1Data, camp2Data;

    beforeEach(function(done){
        // TODO:  Work out what connection config should be!
        pgconn = {
            user    : 'cwrx',
            password: 'password',
            database: 'campfire_cwrx',
            host    : process.env.mongo ? JSON.parse(process.env.mongo).host : '33.33.33.100'
        };

        camp1Data = {
            campaignId : 'cam-1757d5cd13e383',
            summary : {
                impressions: 8186,
                views      : 6263,
                totalSpend : '1189.9700',
                viewsToday  : 6054,
                spendToday  : '1150.2600',
                linkClicks : {
                    action      : 223,
                    facebook    : 18,
                    instagram   : 2,
                    website     : 114,
                    youtube     : 5
                },
                shareClicks : {
                    facebook  : 32,
                    pinterest : 31,
                    twitter   : 21
                }
            }
        };

        camp2Data = {
            campaignId : 'cam-b651cde4158304',
            summary : {
                impressions : 612,
                views       : 512,
                totalSpend  : '56.3200',
                viewsToday  : 318,
                spendToday  : '34.9800',
                linkClicks  : {
                    action : 2,
                    facebook : 9,
                    instagram : 2,
                    twitter : 11,
                    website : 86,
                    youtube : 3
                },
                shareClicks : {}
            }
        };
     
        var today = ((new Date()).toISOString()).substr(0,10);
        pgdata_campaign_summary_hourly = [
            'INSERT INTO rpt.campaign_summary_hourly_all VALUES',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',2032,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',1542,292.9800),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',2032,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',69,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.Facebook\',7,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.Website\',28,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.YouTube\',2,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'load\',2038,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'play\',1881,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',1597,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',1374,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',473,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',322,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.facebook\',11,0.0000),',
            '(\'' + today + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.twitter\',21,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',5871,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',4512,857.2800),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',5871,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',151,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Facebook\',11,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Instagram\',2,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Website\',86,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.YouTube\',3,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'load\',5928,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'play\',5469,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',4765,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',3981,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',1333,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',918,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',283,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',209,39.7100),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',284,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',3,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'load\',299,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'play\',278,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',223,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',155,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',52,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',30,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.facebook\',21,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.pinterest\',31,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'cardView\',385,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'completedView\',318,34.9800),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'launch\',384,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Action\',2,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Facebook\',9,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Twitter\',11,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'load\',384,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'play\',384,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'q1\',359,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'q2\',349,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'q3\',336,0.0000),',
            '(\'' + today + ' 00:00:00+00\',\'cam-b651cde4158304\',\'q4\',318,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'cardView\',227,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'completedView\',194,21.3400),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'launch\',227,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'load\',227,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'link.Instagram\',2,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'link.Website\',86,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'link.YouTube\',3,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'play\',225,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'q1\',215,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'q2\',211,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'q3\',202,0.0000),',
            '(\'2015-12-02 23:00:00+00\',\'cam-b651cde4158304\',\'q4\',193,0.0000);'
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
            { id: 'cam-1757d5cd13e383', name: 'camp 1', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-b651cde4158304', name: 'camp 2', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-278b8150021c68', name: 'camp 3', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'e2e-getid3', name: 'camp 4', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' }
        ];

        function pgTruncate(){
            return pgQuery(pgconn,'TRUNCATE TABLE rpt.campaign_summary_hourly_all');
        }

        function pgInsert() {
            return pgQuery(pgconn,pgdata_campaign_summary_hourly.join(' '));
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
            options.url += '/cam-1757d5cd13e383';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(401);
                expect(resp.response.body).toEqual('Unauthorized');
            })
            .then(done,done.fail);

        });

        it('returns a 400 error if there is no campaignID',function(done){
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(400);
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
            options.url += '/cam-1757d5cd13e383';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp1Data);
            })
            .then(done,done.fail);
        });
        
    });
    
    describe('GET /api/analytics/campaigns/?ids=:id', function() {
        it('requires authentication',function(done){
            delete options.jar;
            options.url += '/?ids=cam-1757d5cd13e383';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(401);
                expect(resp.response.body).toEqual('Unauthorized');
            })
            .then(done,done.fail);
        });

        it('returns a 200 with empty array if the campaignId is not found',function(done){
            options.url += '/?ids=cam-278b8150021c68';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual([]);
            })
            .then(done,done.fail);
        });

        it('returns single document array if the campaigns GET is plural form',function(done){
            options.url += '/?ids=cam-1757d5cd13e383';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual([ camp1Data ]);
            })
            .then(done,done.fail);
        });
        
        it('returns document array if the campaigns GET is plural form',function(done){
            options.url += '/?ids=cam-1757d5cd13e383,cam-b651cde4158304';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(isArray(resp.body)).toEqual(true);
                expect(resp.body).toContain(camp1Data);
                expect(resp.body).toContain(camp2Data);
            })
            .then(done,done.fail);
        });

        it('returns document array with found items, omits unfound ',function(done){
            options.url += '/?ids=cam-1757d5cd13e383,cam-b651cde4158304,cam-278b8150021c68';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body.length).toEqual(2);
                expect(resp.body).toContain(jasmine.objectContaining(camp1Data));
                expect(resp.body).toContain(jasmine.objectContaining(camp2Data));
            })
            .then(done,done.fail);
        });
    });
});
