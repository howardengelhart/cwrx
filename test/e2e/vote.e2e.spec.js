describe('vote (E2E)', function(){
    var flush, testUtils, makeUrl;
    beforeEach(function(){
        var urlBase;
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        testUtils   = require('./testUtils');
        
        urlBase = 'http://' + (process.env['E2EHOST'] ? process.env['E2EHOST'] : '33.33.33.10');
        makeUrl = function(fragment){
            return urlBase + fragment;
        }
        
    });

    beforeEach(function(done) {
        var mockData = [
            {
                id: 'e1',
                ballot:   {
                    'b1' : { 'red apple'      : 10, 'yellow banana'  : 20, 'orange carrot'  : 30 },
                    'b2' : { 'one chicken'    : 10, 'two ducks'      : 20 }
                }
            },
            {
                id: 'e2',
                ballot:   {
                    'b1' : { 'one fish'   : 10, 'two fish'   : 20, },
                    'b2' : { 'red fish'   : 30, 'blue fish'  : 40 }
                }
            }
        ];
        
        var options = {
            url: makeUrl('/maint/reset_collection'),
            json: {
                collection: "elections",
                data: mockData
            }
        };
        testUtils.qRequest('post', options).done(function(resp) {
            done();
        });
    });

    describe('GET /election/:id',function(){

        it('gets an election if it exists',function(done){
            testUtils.qRequest('get', { url : makeUrl('/election/e1')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body.id).toEqual('e1');
                    expect(resp.body.ballot.b1['red apple']).toEqual(0.17);
                    expect(resp.body.ballot.b1['yellow banana']).toEqual(0.33);
                    expect(resp.body.ballot.b1['orange carrot']).toEqual(0.50);
                    expect(resp.body.ballot.b2['one chicken']).toEqual(0.33);
                    expect(resp.body.ballot.b2['two ducks']).toEqual(0.67);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });

        it('returns with a 404 if the election does not exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/election/e1x')})
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
            testUtils.qRequest('get', { url : makeUrl('/election')})
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(404);
                    expect(resp.body).toEqual('Cannot GET /election');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });

    });


    describe('GET /election/:id/ballot:id',function(){

        it('gets a ballot if it and the election exist',function(done){
            testUtils.qRequest('get', { url : makeUrl('/election/e2/ballot/b2')})
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
            testUtils.qRequest('get', { url : makeUrl('/election/e2x/ballot/b2')})
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
            testUtils.qRequest('get', { url : makeUrl('/election/e2/ballot/b3')})
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

    describe('POST /vote/',function(){
        var options;
        beforeEach(function(){
            options = {
                url: makeUrl('/vote'),
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
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);

        });


    });
});
