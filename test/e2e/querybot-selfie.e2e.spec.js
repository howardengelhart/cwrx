var q               = require('q'),
    util            = require('util'),
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

describe('querybot - selfie (E2E)', function(){
    var pgdata_campaign_summary_hourly, pgdata_billing_transactions, mockUser, mockCamps,
        cookieJar, options, camp1Data, camp2Data, camp5Data, mockApp, appCreds;

    beforeEach(function(done){
        pgconn = {
            user    : 'cwrx',
            password: 'password',
            database: 'campfire_cwrx',
            host    : process.env.mongo ? JSON.parse(process.env.mongo).host : '33.33.33.100'
        };

        camp1Data = {
            campaignId : 'cam-1757d5cd13e383',
            summary : {
                impressions: 8409,
                views      : 6461, // 7461, <-- comments are actual numbers in the db
                quartile1  : 6073, // 7031, <-- values reflect adjustmentd based on
                quartile2  : 5040, // 5820, <-- billable views, see notes below
                quartile3  : 1680, // 1962,
                quartile4  : 1163, // 1330,
                totalSpend : '1227.5900', 
                linkClicks : {
                    action      : 224,
                    facebook    : 18,
                    instagram   : 2,
                    website     : 120,
                    youtube     : 5
                },
                shareClicks : {
                    facebook  : 53,
                    pinterest : 31,
                    twitter   : 32
                }
            },
            today : {
                impressions : 7903,
                views       : 6054,
                quartile1  : 5449, // 6362,
                quartile2  : 4601, // 5355,
                quartile3  : 1574, // 1806,
                quartile4  : 1090, // 1240,
                totalSpend  : '1150.2600',
                linkClicks : {
                    action      : 220,
                    facebook    : 18,
                    instagram   : 2,
                    website     : 114,
                    youtube     : 5
                },
                shareClicks : {
                    facebook  : 11,
                    twitter   : 21
                }
            }
        };

        camp2Data = {
            campaignId : 'cam-b651cde4158304',
            summary : {
                impressions : 612,
                views       : 512,
                quartile1  : 574,
                quartile2  : 560,
                quartile3  : 538,
                quartile4  : 511,
                totalSpend  : '56.3200',
                linkClicks  : {
                    action : 2,
                    facebook : 9,
                    instagram : 2,
                    twitter : 11,
                    website : 86,
                    youtube : 3
                },
                shareClicks : {}
            },
            today : {
                impressions : 385,
                views : 318,
                quartile1  : 359,
                quartile2  : 349,
                quartile3  : 336,
                quartile4  : 318,
                totalSpend  : '34.9800',
                linkClicks  : {
                    action : 2,
                    facebook : 9,
                    twitter : 11
                },
                shareClicks : {}
            }
        };
        
        camp5Data = {
            campaignId : 'cam-cabd93049d032a',
            summary : {
                impressions: 99,
                views      : 69, // 189,
                quartile1  : 63, // 174,
                quartile2  : 59, // 161,
                quartile3  : 48, // 132,
                quartile4  : 41, // 113,
                totalSpend : '3.4500',
                linkClicks : {
                    website     : 6
                },
                shareClicks : {}
            },
            today : {
                impressions: 0,
                views      : 0,
                quartile1  : 0,
                quartile2  : 0,
                quartile3  : 0,
                quartile4  : 0,
                totalSpend  : '0.0000',
                linkClicks  : {},
                shareClicks : {}
            }
        };
 
        var today = ((new Date()).toISOString()).substr(0,10);

        // Note: That there are less BillableViews than CompletedViews for cam-1757d5cd13e383
        // and cam-cabd93049d032a will result in quartiles being adjusted for those campaigns.
        // see lib.adjustCampaignSummary in bin/querybot.js.
        //
        // This table summarizes the actual data stored in the test tables.  The comments
        // above show the adjusted differences vs actual numbers for views/quartiles in comments.
        //
        // Aggregated by Campaign, Date
        //
        //     Campaign Id    |    Date    | CompViews  | BillViews |  Q1  |  Q2  |  Q3  |  Q4
        // -------------------|------------+------------+-----------+------+------+------+------
        // cam-1757d5cd13e383 | 2015-12-01 |         89 |        89 |  223 |  155 |   52 |   30
        // cam-1757d5cd13e383 | 2015-12-02 |        209 |       209 |  223 |  155 |   52 |   30
        // cam-1757d5cd13e383 | 2015-12-03 |        109 |       109 |  223 |  155 |   52 |   30
        // cam-1757d5cd13e383 | 2016-04-08 |       7054 |      6054 | 6362 | 5355 | 1806 | 1240
        // cam-b651cde4158304 | 2015-12-03 |        194 |       194 |  215 |  211 |  202 |  193
        // cam-b651cde4158304 | 2016-04-08 |        318 |       318 |  359 |  349 |  336 |  318
        // cam-cabd93049d032a | 2015-12-03 |        189 |        69 |  174 |  161 |  132 |  113
        //
        //
        // Aggregated by Campaign
        //
        // campaign_id        | CompViews | BillViews |  Q1  |  Q2  |  Q3  |  Q4 
        // -------------------+-----------+-----------+------+------+------+------
        // cam-1757d5cd13e383 |      7461 |      6461 | 7031 | 5820 | 1962 | 1330
        // cam-b651cde4158304 |       512 |       512 |  574 |  560 |  538 |  511
        // cam-cabd93049d032a |       189 |        69 |  174 |  161 |  132 |  113
        //

        pgdata_billing_transactions = [
            'INSERT INTO fct.billing_transactions (rec_ts,transaction_ts,transaction_id,',
            '   org_id,campaign_id,sign,units,amount) VALUES',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,987,187.53),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,499,94.81),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,1345,255.55),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,851,161.69),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,830,157.70),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-1\',\'o1\',\'cam-1757d5cd13e383\',-1,1000,0),',
            '(now(),\'' + today + ' 01:00:00+00\',\'t-2\',\'o1\',\'cam-1757d5cd13e383\',-1,1542,292.98),',
            '(now(),\'' + today + ' 00:00:00+00\',\'t-3\',\'o2\',\'cam-b651cde4158304\',-1,318,34.98),',
            '(now(),\'2015-12-01 00:00:00+00\',\'t-4\',\'o1\',\'cam-1757d5cd13e383\',-1,89,16.91),',
            '(now(),\'2015-12-02 12:00:00+00\',\'t-5\',\'o1\',\'cam-1757d5cd13e383\',-1,209,39.71),',
            '(now(),\'2015-12-03 23:00:00+00\',\'t-6\',\'o1\',\'cam-1757d5cd13e383\',-1,109,20.71),',
            '(now(),\'2015-12-03 23:00:00+00\',\'t-7\',\'o2\',\'cam-b651cde4158304\',-1,194,21.34),',
            '(now(),\'2015-12-03 23:00:00+00\',\'t-8\',\'o3\',\'cam-cabd93049d032a\',-1,69,3.45),',
            '(now(),\'2015-12-03 23:00:00+00\',\'t-9\',\'o3\',\'cam-cabd93049d032a\',-1,120,0);'
        ];

        pgdata_campaign_summary_hourly = [
            'INSERT INTO rpt.campaign_summary_hourly VALUES',
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
            '(\'' + today + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',5512,876.2800),',
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
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',100,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',89,16.9100),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',154,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',1,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'load\',299,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'play\',278,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',223,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',155,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',52,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',30,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.facebook\',21,0.0000),',
            '(\'2015-12-01 00:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.twitter\',11,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',283,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',209,39.7100),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',284,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',3,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'load\',299,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'play\',278,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',223,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',155,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',52,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',30,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.facebook\',21,0.0000),',
            '(\'2015-12-02 12:00:00+00\',\'cam-1757d5cd13e383\',\'shareLink.pinterest\',31,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',123,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',109,20.7100),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'launch\',284,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'link.Website\',6,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'load\',299,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'play\',278,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'q1\',223,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'q2\',155,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'q3\',52,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-1757d5cd13e383\',\'q4\',30,0.0000),',
            
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
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'cardView\',227,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'completedView\',194,21.3400),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'launch\',227,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'load\',227,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'link.Instagram\',2,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'link.Website\',86,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'link.YouTube\',3,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'play\',225,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'q1\',215,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'q2\',211,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'q3\',202,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-b651cde4158304\',\'q4\',193,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'cardView\',99,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'completedView\',189,9.4500),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'launch\',98,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'link.Website\',6,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'play\',89,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'q1\',174,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'q2\',161,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'q3\',132,0.0000),',
            '(\'2015-12-03 23:00:00+00\',\'cam-cabd93049d032a\',\'q4\',113,0.0000);'
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
        mockApp = {
            id: 'app-e2e-querybot',
            key: 'e2e-querybot',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
        mockCamps = [
            { id: 'cam-1757d5cd13e383', name: 'camp 1', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-b651cde4158304', name: 'camp 2', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-278b8150021c68', name: 'camp 3', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'e2e-getid3', name: 'camp 4', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'cam-cabd93049d032a', name: 'camp 5', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
        ];

        function pgTruncate(){
            return testUtils.pgQuery('TRUNCATE TABLE rpt.campaign_summary_hourly')
                .then(function(){
                    return testUtils.pgQuery('TRUNCATE TABLE fct.billing_transactions')
                });
        }

        function pgInsert() {
            return testUtils.pgQuery(pgdata_campaign_summary_hourly.join(' '))
                .then(function(){
                    return testUtils.pgQuery(pgdata_billing_transactions.join(' '))
                });
        }

        function mongoInsert() {
            return q.all([
                testUtils.resetCollection('users', mockUser),
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
            ]).thenResolve();
        }

        pgTruncate().then(pgInsert).then(mongoInsert).then(done,done.fail);
    });

    beforeEach(function(done){
        if (cookieJar) {
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

        it('returns a 400 if the request has a bad start date format',function(done){
            options.url += '/cam-1757d5cd13e383?startDate=apple';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(400);
                expect(resp.response.body).toEqual('Invalid startDate format, expecting YYYY-MM-DD.');
            })
            .then(done,done.fail);
        });

        it('returns a 400 if the request has a bad end date format',function(done){
            options.url += '/cam-1757d5cd13e383?startDate=2015-12-01&endDate=2015-12-02T12:55:00+00';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(400);
                expect(resp.response.body).toEqual('Invalid endDate format, expecting YYYY-MM-DD.');
            })
            .then(done,done.fail);
        });

        it('returns single doc with all data if the campaigns GET is singular with no dates',function(done){
            options.url += '/cam-1757d5cd13e383';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp1Data);
            })
            .then(done,done.fail);
        });
        
        it('returns single doc with initialized range data if the campaigns GET is singular with dates with no data',function(done){
            options.url += '/cam-1757d5cd13e383?startDate=2000-09-01&endDate=2000-09-02';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                camp1Data.range = {
                    startDate  : '2000-09-01',
                    endDate    : '2000-09-02',
                    impressions: 0,
                    views      : 0,
                    quartile1  : 0,
                    quartile2  : 0,
                    quartile3  : 0,
                    quartile4  : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                };
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp1Data);
            })
            .then(done,done.fail);
        });

        it('returns single doc with initialized range data if end date is < start date',function(done){
            options.url += '/cam-1757d5cd13e383?startDate=2015-12-02&endDate=2015-12-01';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                camp1Data.range = {
                    startDate  : '2015-12-02',
                    endDate    : '2015-12-01',
                    impressions: 0,
                    views      : 0,
                    quartile1  : 0,
                    quartile2  : 0,
                    quartile3  : 0,
                    quartile4  : 0,
                    totalSpend : '0.0000',
                    linkClicks : {},
                    shareClicks : {}
                };
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp1Data);
            })
            .then(done,done.fail);
        });

        it('returns single doc with range data with same start and end date',function(done){
            options.url += '/cam-1757d5cd13e383?startDate=2015-12-02&endDate=2015-12-02';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                camp1Data.range = {
                    startDate  : '2015-12-02',
                    endDate    : '2015-12-02',
                    impressions: 283,
                    views      : 209,
                    quartile1  : 223,
                    quartile2  : 155,
                    quartile3  : 52,
                    quartile4  : 30,
                    totalSpend : '39.7100',
                    linkClicks : {
                        action : 3 
                    },
                    shareClicks : {
                        facebook : 21,
                        pinterest : 31
                    }
                };
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp1Data);
            })
            .then(done,done.fail);
        });

        it('returns single doc with initialized today data if the campaigns GET is singular with dates with no today data',function(done){
            options.url += '/cam-cabd93049d032a?startDate=2015-12-01&endDate=2015-12-31';
            requestUtils.qRequest('get', options)
            .then(function(resp) {
                camp5Data.range = {
                    startDate  : '2015-12-01',
                    endDate    : '2015-12-31',
                    impressions: 99,
                    views      : 69,
                    quartile1  : 63,
                    quartile2  : 59,
                    quartile3  : 48,
                    quartile4  : 41,
                    totalSpend : '3.4500',
                    linkClicks : {
                        website     : 6
                    },
                    shareClicks : {}
                };
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual(camp5Data);
            })
            .then(done,done.fail);
        });

        it('should allow an app to get stats', function(done) {
            delete options.jar;
            options.url += '/cam-1757d5cd13e383';
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual(camp1Data);
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
        

        it('should allow an app to get stats', function(done) {
            delete options.jar;
            options.url += '/?ids=cam-1757d5cd13e383';
            requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual([ camp1Data ]);
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});
