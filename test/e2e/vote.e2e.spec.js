describe('vote (E2E)', function(){
    var testUtils, q, makeUrl, restart = true, testNum = 0,
        dbEnv = JSON.parse(process.env['mongo']);
    if (dbEnv && !dbEnv.db) {
        dbEnv.db = "voteDb";
    }
    process.env['mongo'] = JSON.stringify(dbEnv);
    
    beforeEach(function(){
        var urlBase; 
        q           = require('q');
        testUtils   = require('./testUtils');

        urlBase = 'http://' + (process.env['host'] ? process.env['host'] : 'localhost');
        makeUrl = function(fragment){
            return urlBase + fragment;
        }
        
    });
    
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: makeUrl('/maint/clear_log'),
            json: {
                logFile: 'vote.log'
            }
        };
        testUtils.qRequest('post', [options])
        .catch(function(error) {
            console.log("Error clearing vote log: " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });

    beforeEach(function(done) {
        var mockData = [
            {
                id: 'e1',
                ballot:   {
                    'b1' : { 'red apple'  : 10, 'yellow banana'  : 20, 'orange carrot'  : 30 },
                    'b2' : { 'one chicken': 0, 'two ducks'      : 2 }
                }
            },
            {
                id: 'e2',
                ballot:   {
                    'b1' : { 'one fish'   : 10, 'two fish'   : 20, },
                    'b2' : { 'red fish'   : 30, 'blue fish'  : 40 }
                }
            }
        ], cli, coll;

        testUtils.resetCollection('elections',mockData)
            .then(function(){
                if (restart){
                    var options = {
                        url : makeUrl('/maint/service/restart'),
                        json : { service : 'vote' }
                    };
                    return testUtils.qRequest('post',options);
                }
                return q(true);
            })
            .done(function() {
                if (restart){
                    restart = false;
                    setTimeout(function(){ done(); },2000);
                } else {
                    done();
                }
            });
    });
    
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('vote.log', makeUrl('/maint'), jasmine.getEnv().currentSpec, 'vote', ++testNum)
        .catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
        }).finally(function() {
            done();
        });
    });

    describe('GET /api/election/:id',function(){

        it('gets an election if it exists',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election/e1')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body.id).toEqual('e1');
                    expect(resp.body.ballot.b1['red apple']).toEqual(0.17);
                    expect(resp.body.ballot.b1['yellow banana']).toEqual(0.33);
                    expect(resp.body.ballot.b1['orange carrot']).toEqual(0.50);
                    expect(resp.body.ballot.b2['one chicken']).toEqual(0.0);
                    expect(resp.body.ballot.b2['two ducks']).toEqual(1.0);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });

        it('returns with a 404 if the election does not exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election/e1x')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(404);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });

        it('returns with 404 if the electionId is not passed',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(404);
                    expect(resp.body).toEqual('Cannot GET /api/election');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });

    });


    describe('GET /api/election/:id/ballot:id',function(){

        it('gets a ballot if it and the election exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election/e2/ballot/b2')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body.id).toEqual('e2');
                    expect(resp.body.ballot.b2['red fish']).toEqual(0.43);
                    expect(resp.body.ballot.b2['blue fish']).toEqual(0.57);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });
        
        it('returns with a 404 if the election does not exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election/e2x/ballot/b2')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(404);
                    expect(resp.body).toEqual('Unable to locate election.\n');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });

        it('returns with a 404 if the ballot does not exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/api/election/e2/ballot/b3')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(404);
                    expect(resp.body).toEqual('Unable to locate ballot item.\n');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });
    });

    describe('POST /api/vote/',function(){
        var options;
        beforeEach(function(){
            options = {
                url: makeUrl('/api/vote'),
                json: { }
            };
        });
        it('fails with invalid request if body is invalid',function(done){
            testUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(400);
                    expect(resp.body).toEqual('Invalid request.\n');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);
        });
        
        it('returns success if request is valid, but has bad election',function(done){
            options.json = {
                election : 'e9999',
                ballotItem: 'b99',
                vote:       '99 chicken'
            };
            
            testUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);

        });

        it('returns success if request is valid',function(done){
            options.json = {
                election : 'e1',
                ballotItem: 'b2',
                vote:       'one chicken'
            };
            
            testUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .then(function(){
                    return testUtils.qRequest('get', { url : makeUrl('/api/election/e1/ballot/b2')});
                })
                .then(function(resp){
                    expect(resp.body.ballot.b2['one chicken']).toEqual(0.33);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);

        });

        it('persists votes if terminated', function(done){
            options.json = {
                election : 'e1',
                ballotItem: 'b2',
                vote:       'one chicken'
            };
            
            testUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .then(function(){
                    var deferred = q.defer();
                    testUtils.qRequest('post',{ 
                            url : makeUrl('/maint/service/restart'),
                            json : { service : 'vote' } })
                        .finally(function(){
                            setTimeout(function(){
                                deferred.resolve(true);
                            },2000);
                        });
                    return deferred.promise;
                })
                .then(function(){
                    return testUtils.qRequest('get', { url : makeUrl('/election/e1/ballot/b2')});
                })
                .then(function(resp){
                    expect(resp.body.ballot.b2['one chicken']).toEqual(0.50);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);
        });

    });
});
