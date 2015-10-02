var q               = require('q'),
    testUtils       = require('./testUtils');

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
    var pgdata_crosstab,
        pgdata_crosstab_daily,
        mockUser,
        mockCamps,
        pgconn;

    beforeEach(function(done){
        // TODO:  Work out what connection config should be!
        pgconn = {
            user    : 'cwrx',
            password: 'password',
            database: 'campfire_cwrx',
            host    : JSON.parse(process.env.mongo).host
        };
       
        pgdata_crosstab = [
            'INSERT INTO fct.v_cpv_campaign_activity_crosstab VALUES',
            '(\'cam-5bebbf1c34a3d7\',100000,1000,100,11.22),',
            '(\'cam-237505b42ee19f\',500000,2000,150,12.25),',
            '(\'cam-278b8150021c68\',300000,1200,500,13.13),',
            '(\'cam-bfc62ac554280e\',400000,1500,200,10.98),',
            '(\'cam-1ca2ee2c0ded77\',800000,2500,100,11.11),',
            '(\'cam-cde12a51a07e4c\',600000,300,50,4.40),',
            '(\'cam-27e8c3aceb3369\',800000,200,99,3.45),',
            '(\'cam-74b0b3b1f823d7\',500000,12000,1000,55.55);'
        ];
        
        pgdata_crosstab_daily = [
            'INSERT INTO fct.v_cpv_campaign_activity_crosstab_daily VALUES',
            '(\'2015-09-29\',\'cam-5bebbf1c34a3d7\',100000,1000,100,11.22),',
            '(\'2015-09-29\',\'cam-74b0b3b1f823d7\',500000,12000,1000,55.55);'
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
            { id: 'e2e-getid2', name: 'camp 3', status: 'deleted',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'e2e-getid3', name: 'camp 4', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' }
        ];

        function pgTruncate(){
            return pgQuery(pgconn,'TRUNCATE TABLE fct.v_cpv_campaign_activity_crosstab')
                .then(function(){
                    return pgQuery(pgconn,
                        'TRUNCATE TABLE fct.v_cpv_campaign_activity_crosstab_daily');
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

    it('lives',function(){
        expect(1).toEqual(1); 
    });

});

