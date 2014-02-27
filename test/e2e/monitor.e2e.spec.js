describe('monitor (E2E)', function(){
    var testUtils, q, makeUrl, restart = true;

    function restartService(r){
        if (r) {
            var options = {
                url : makeUrl('/maint/service/restart'),
                json : { service : 'monitor' }
            };
            return testUtils.qRequest('post',options);
        }
        return q(true);
    }

    function getStatus() { 
        return testUtils.qRequest('get', { url : makeUrl('/api/status')});
    }

    function createMonitorProfile(name,data){
        if (!data.name){
            data.name = name;
        }
        return testUtils.qRequest('post', { 
            url  : makeUrl('/maint/create_file'),
            json : {
                fpath : '/opt/sixxy/monitor/' + name,
                data  : JSON.stringify(data)
            }
        });
    }

    function deleteMonitorProfile(name){
        var fpath = '/opt/sixxy/monitor';
        if (name) {
            fpath += '/' + name;
        }
        var options = {
            url : makeUrl('/maint/delete_file'),
            json : { fpath : fpath }
        };
        return testUtils.qRequest('post',options);
    }



    beforeEach(function(){
        var urlBase; 
        q           = require('q');
        testUtils   = require('./testUtils');

        urlBase = 'http://' + (process.env['host'] ? process.env['host'] : 'localhost');
        makeUrl = function(fragment){
            return urlBase + fragment;
        }
    });

    beforeEach(function(done){
        deleteMonitorProfile()
        .then(restartService(restart))
        .done(function() {
            if (restart){
                restart = false;
                setTimeout(function(){ done(); },2000);
            } else {
                done();
            }
        });
    });

    it('returns 500 if nothing to monitor',function(done){
        getStatus()
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(500);
                expect(resp.body).toEqual('No services monitored.');
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .finally(done);
    });

    it('returns 200 if checkProcess succeeds',function(done){
        createMonitorProfile('maint', {
            checkProcess : {
                pidPath : '/opt/sixxy/run/maint.pid' 
            }
        })
        .then(restartService(true))
        .then(q.delay(1000))
        .then(getStatus)
        .then(function(resp){
            expect(resp.response.statusCode).toEqual(200);
            expect(resp.body).toEqual('No services monitored.');
        })
        .catch(function(err){
            expect(err).not.toBeDefined();
        })
        .finally(done);
    });

});
