var q = require('q');

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

        pgTruncate().then(pgInsert).then(done,done.fail);
    });

    it('lives',function(){
        expect(1).toEqual(1); 
    });

});

