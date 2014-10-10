jasmine.getEnv().defaultTimeoutInterval = 10000;

describe('vote (E2E)', function(){
    var testUtils, q, makeUrl, mockData, cookieJar, restart = true,
        dbEnv = JSON.parse(process.env['mongo'] || '{}');
    if (dbEnv && !dbEnv.db) {
        dbEnv.db = 'voteDb';
    }
    process.env['mongo'] = JSON.stringify(dbEnv);
    
    beforeEach(function(){
        var urlBase;
        q               = require('q');
        testUtils       = require('./testUtils');
        requestUtils    = require('../../lib/requestUtils'),

        urlBase = 'http://' + (process.env['host'] ? process.env['host'] : 'localhost');
        makeUrl = function(fragment){
            return urlBase + fragment;
        }
        
    });
    
    beforeEach(function(done) {
        var coll;
        mockData = [
            {
                id: 'e1',
                status: 'active',
                user: 'e2e-user',
                created: new Date(new Date() - 24*60*60*1000),
                ballot:   {
                    'b1' : [ 10, 20, 30 ],
                    'b2' : [ 0, 2 ]
                }
            },
            {
                id: 'e2',
                status: 'active',
                user: 'not-e2e-user',
                created: new Date(new Date() - 24*60*60*1000),
                ballot:   {
                    'b1' : [ 10, 20 ],
                    'b2' : [ 30, 40 ]
                }
            },
            {
                id: 'e3',
                status: 'inactive',
                user: 'e2e-user',
                created: new Date(new Date() - 24*60*60*1000),
                ballot:   {
                    'b1' : [ 20, 10 ],
                    'b2' : [ 40, 30 ]
                }
            },
            {
                id: 'e4',
                status: 'active',
                user: 'e2e-user',
                created: new Date(new Date() - 24*60*60*1000),
                ballot:   {
                    'b1' : { foo: 1, bar: 5 }
                }
            },
        ];

        testUtils.resetCollection('elections',mockData)
            .then(function(){
                if (restart){
                    var options = {
                        url : makeUrl('/maint/service/restart'),
                        json : { service : 'vote', checkUrl: makeUrl('/api/vote/meta') }
                    };
                    return requestUtils.qRequest('post',options);
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
    
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        var mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'vote_e2e_user',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {
                elections: {
                    read: 'org',
                    create: 'own',
                    edit: 'own',
                    delete: 'own'
                }
            }
        };
        var loginOpts = {
            url: makeUrl('/api/auth/login'),
            jar: cookieJar,
            json: {
                email: 'vote_e2e_user',
                password: 'password'
            }
        };
        var userDbCfg = JSON.parse(JSON.stringify(dbEnv));
        userDbCfg.db = 'c6Db'
        testUtils.resetCollection('users', mockUser, userDbCfg).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });

    describe('GET /api/public/election/:id',function(){

        it('gets an election if it exists',function(done){
            requestUtils.qRequest('get', { url : makeUrl('/api/public/election/e1')})
                .then(function(resp){
                    expect(resp.response.headers['cache-control']).toEqual('max-age=300');
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body.id).toEqual('e1');
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.ballot.b1).toEqual([0.17, 0.33, 0.50]);
                    expect(resp.body.ballot.b2).toEqual([0.0, 1.0]);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });

        it('returns with a 404 if the election does not exist',function(done){
            requestUtils.qRequest('get', { url : makeUrl('/api/public/election/e1x')})
                .then(function(resp){
                    expect(resp.response.headers['cache-control']).toEqual('max-age=300');
                    expect(resp.response.statusCode).toEqual(404);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });

        });
        
        it('returns a 404 if the user cannot read the election', function(done) {
            requestUtils.qRequest('get', { url : makeUrl('/api/public/election/e3')})
                .then(function(resp){
                    expect(resp.response.headers['cache-control']).toEqual('max-age=300');
                    expect(resp.response.statusCode).toEqual(404);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });
    });
    
    describe('GET /api/election/:id', function() {
        it('gets an election if it exists', function(done) {
            requestUtils.qRequest('get', { url : makeUrl('/api/election/e1'), jar: cookieJar })
                .then(function(resp){
                    expect(resp.response.headers['cache-control']).toEqual('max-age=0');
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body._id).not.toBeDefined();
                    expect(resp.body.id).toEqual('e1');
                    expect(resp.body.ballot).toEqual({
                        'b1' : [10, 20, 30],
                        'b2' : [0, 2]
                    });
                    expect(resp.body.user).toBe('e2e-user');
                    expect(resp.body.created).toBeDefined();
                    expect(resp.body.status).toBe('active');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });

        it('should write an entry to the audit collection', function(done) {
            requestUtils.qRequest('get', { url : makeUrl('/api/election/e1'), jar: cookieJar }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].service).toBe('vote');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'GET /api/election/:electionId',
                                                 params: { electionId: 'e1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('gets normally private elections the user is allowed to see', function(done) {
            requestUtils.qRequest('get', { url : makeUrl('/api/election/e3'), jar: cookieJar })
                .then(function(resp){
                    expect(resp.response.headers['cache-control']).toEqual('max-age=0');
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body.id).toEqual('e3');
                    expect(resp.body.status).toBe('inactive');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });
        
        it('forces a sync before returning data', function(done) {
            var postOpts = {
                url: makeUrl('/api/vote'),
                json: { election : 'e3', ballotItem: 'b1', vote: 0 }
            };
            requestUtils.qRequest('post', postOpts)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(200);
                    return requestUtils.qRequest('get', {url:makeUrl('/api/election/e3'),jar:cookieJar})
                }).then(function(resp) {
                    expect(resp.body.id).toEqual('e3');
                    expect(resp.body.ballot).toEqual({
                        'b1' : [21, 10],
                        'b2' : [40, 30]
                    });
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(function(){
                    done();
                });
        });
    });

    describe('POST /api/public/vote/',function(){
        var options;
        beforeEach(function(){
            options = {
                url: makeUrl('/api/public/vote'),
                json: { }
            };
        });
        it('fails with invalid request if body is invalid',function(done){
            requestUtils.qRequest('post', options)
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
            
            requestUtils.qRequest('post', options)
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
                vote:       0
            };
            
            requestUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .then(function(){
                    return requestUtils.qRequest('get', {url: makeUrl('/api/public/election/e1'), jar: cookieJar});
                })
                .then(function(resp){
                    expect(resp.body.ballot.b2[0]).toEqual(0.33);
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
                vote:       0
            };
            
            requestUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .then(function(){
                    var deferred = q.defer();
                    requestUtils.qRequest('post',{ 
                            url : makeUrl('/maint/service/restart'),
                            json : { service : 'vote', checkUrl: makeUrl('/api/vote/meta') } })
                        .finally(function(){
                            setTimeout(function(){
                                deferred.resolve(true);
                            },2000);
                        });
                    return deferred.promise;
                })
                .then(function(){
                    return requestUtils.qRequest('get', { url : makeUrl('/api/public/election/e1')});
                })
                .then(function(resp){
                    expect(resp.body.ballot.b2[0]).toEqual(0.50);
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);
        });
        
        it('should not add items through voting on nonexistent choices/ballots', function(done) {
            var options1 = { url: options.url, json: { election: 'e1', ballotItem: 'b1', vote: 3 } },
                options2 = { url: options.url, json: { election: 'e1', ballotItem: 'b8', vote: 'poop' } };
            q.all([requestUtils.qRequest('post', options1), requestUtils.qRequest('post', options2)])
            .then(function(resps) {
                resps.forEach(function(resp) {
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                });
                return requestUtils.qRequest('get', {url: makeUrl('/api/election/e1'), jar: cookieJar});
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.id).toBe('e1');
                expect(resp.body.ballot.b1).toEqual([10, 20, 30]);
                expect(resp.body.ballot.b8).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still work if the ballot items are objects', function(done) {
            options.json = { election: 'e4', ballotItem: 'b1', vote: 'foo' };
            requestUtils.qRequest('post', options)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual('OK');
                })
                .then(function(){
                    return requestUtils.qRequest('get', {url: makeUrl('/api/election/e4'), jar: cookieJar});
                })
                .then(function(resp){
                    expect(resp.body.ballot).toEqual({ b1: { foo: 2, bar: 5 } });
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .finally(done);
        });
    });

    describe('POST /api/election', function() {
        var mockElec;
        beforeEach(function() {
            mockElec = {
                ballot: { b1: [10, 20] },
                org: 'e2e-org'
            };
        });

        it('should be able to create an election', function(done) {
            var options = {
                url: makeUrl('/api/election'),
                jar: cookieJar,
                json: mockElec
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.id).toBeDefined();
                expect(resp.body.ballot).toEqual({ b1: [10, 20] });
                expect(resp.body.user).toBe('e2e-user');
                expect(resp.body.org).toBe('e2e-org');
                expect(resp.body.created).toBeDefined();
                expect(new Date(resp.body.created).toString()).not.toEqual('Invalid Date');
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            }); 
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: makeUrl('/api/election'), jar: cookieJar, json: mockElec };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].service).toBe('vote');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'POST /api/election',
                                                 params: {}, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to create an election that has special characters in its keys', function(done) {
            mockElec.ballot = { b1: { 'Dr. Who': 'good', 'Dr. No': 'bad', '$foo': 'bar' } };
            var options = {
                url: makeUrl('/api/election'),
                jar: cookieJar,
                json: mockElec
            };
            requestUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                expect(resp.body._id).not.toBeDefined();
                expect(resp.body.ballot).toEqual({b1:{'Dr. Who':'good','Dr. No':'bad','$foo':'bar'}});
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should fail if the request body or election ballot is empty', function(done) {
            var options1 = {url: makeUrl('/api/election'), jar: cookieJar},
                options2 = {url:makeUrl('/api/election'), json:{foo:'bar', ballot:{}}, jar:cookieJar};
            
            q.all([
                requestUtils.qRequest('post', options1),
                requestUtils.qRequest('post', options2)
            ]).then(function(resps) {
                expect(resps[0].response.statusCode).toBe(400);
                expect(resps[0].body).toBe('You must provide an object in the body');
                expect(resps[1].response.statusCode).toBe(400);
                expect(resps[1].body).toBe('Must provide non-empty ballot');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: makeUrl('/api/election'),
                json: mockElec
            };
            requestUtils.qRequest('post', options)
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
    });
    
    describe('PUT /api/election/:id', function() {
        it('should successfully update an election', function(done) {
            var options = {
                url: makeUrl('/api/election/e1'),
                jar: cookieJar,
                json: { tag: 'foo' }
            }, updatedElec;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedElec = resp.body;
                expect(updatedElec).not.toEqual(mockData[0]);
                expect(updatedElec).toBeDefined();
                expect(updatedElec._id).not.toBeDefined();
                expect(updatedElec.id).toBe('e1');
                expect(updatedElec.tag).toBe('foo');
                expect(updatedElec.ballot).toEqual(mockData[0].ballot);
                expect(updatedElec.user).toBe('e2e-user');
                expect(new Date(updatedElec.created)).toEqual(mockData[0].created);
                expect(new Date(updatedElec.lastUpdated)).toBeGreaterThan(mockData[0].created);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: makeUrl('/api/election/e1'), jar: cookieJar, json: { tag: 'foo' } };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].service).toBe('vote');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'PUT /api/election/:id',
                                                 params: { id: 'e1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should be able to add new ballot items, but not modify existing ones', function(done) {
            var options = {
                url: makeUrl('/api/election/e1'),
                jar: cookieJar,
                json: { ballot: { b1: [80, 90], b2: [0, 2, 3], b3: [33, 33] } }
            }, updatedElec;
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                updatedElec = resp.body;
                expect(updatedElec).not.toEqual(mockData[0]);
                expect(updatedElec).toBeDefined();
                expect(updatedElec._id).not.toBeDefined();
                expect(updatedElec.id).toBe('e1');
                expect(updatedElec.ballot).toEqual({b1: [10, 20, 30], b2: [0, 2], b3: [33, 33]});
                expect(new Date(updatedElec.lastUpdated)).toBeGreaterThan(mockData[0].created);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not create an election if it does not exist', function(done) {
            var options = {
                url: makeUrl('/api/election/e2e-putfake'),
                jar: cookieJar,
                json: { ballot: 'fakeBallot' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That election does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not update an election the user does not own', function(done) {
            var options = {
                url: makeUrl('/api/election/e2'),
                jar: cookieJar,
                json: { ballot: 'fakeBallot' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this election');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = {
                url: makeUrl('/api/election/e1'),
                json: { ballot: 'fakeBallot' }
            };
            requestUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('DELETE /api/election/:id', function() {
        
        it('should set the status of an election to deleted', function(done) {
            var options = {jar: cookieJar, url: makeUrl('/api/election/e1')};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should write an entry to the audit collection', function(done) {
            var options = { url: makeUrl('/api/election/e1'), jar: cookieJar };
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                return testUtils.mongoFind('audit', {}, {$natural: -1}, 1, 0, {db: 'c6Journal'});
            }).then(function(results) {
                expect(results[0].user).toBe('e2e-user');
                expect(results[0].created).toEqual(jasmine.any(Date));
                expect(results[0].host).toEqual(jasmine.any(String));
                expect(results[0].pid).toEqual(jasmine.any(Number));
                expect(results[0].service).toBe('vote');
                expect(results[0].version).toEqual(jasmine.any(String));
                expect(results[0].data).toEqual({route: 'DELETE /api/election/:id',
                                                 params: { id: 'e1' }, query: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should not delete an election the user does not own', function(done) {
            var options = {jar: cookieJar, url: makeUrl('/api/election/e2')};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this election');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 200 if the election was already deleted', function(done) {
            var options = {jar: cookieJar, url: makeUrl('/api/election/e1')};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                return requestUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still return a 204 if the election does not exist', function(done) {
            var options = {jar: cookieJar, url: makeUrl('/api/election/fake')};
            requestUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            requestUtils.qRequest('delete', {url: makeUrl('/api/election/e1')})
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
});
