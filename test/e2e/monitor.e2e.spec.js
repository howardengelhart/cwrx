var q               = require('q'),
    util            = require('util'),
    requestUtils    = require('../../lib/requestUtils'),
    cacheLib        = require('../../lib/cacheLib'),
    urlBase         = 'http://' + (process.env.host ? process.env.host : 'localhost'),
    makeUrl         = function(fragment) { return urlBase + fragment; },
    cacheServers    = process.env.cacheHost || 'localhost:11211';
    
if (cacheServers.match(/^[\w\.]+$/)) {
    cacheServers += ':11211';
}

describe('monitor (E2E)', function(){
    describe('GET /api/status', function() {
        function restartService(){
            var options = {
                url : makeUrl('/maint/service/restart'),
                json : { service : 'monitor', checkUrl: makeUrl('/api/monitor/version') }
            };
            return requestUtils.qRequest('post',options);
        }

        function getStatus() {
            return requestUtils.qRequest('get', { url : makeUrl('/api/status')});
        }

        function createMonitorProfile(name,data){
            if (!data.name){
                data.name = name;
            }
            return requestUtils.qRequest('post', {
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
            return requestUtils.qRequest('post',options);
        }

        beforeEach(function(done){
            deleteMonitorProfile().done(function() { done(); });
        });

        it('returns 500 if nothing to monitor',function(done){
            restartService()
            .then(getStatus)
                .then(function(resp){
                    expect(resp.response.statusCode).toEqual(500);
                    expect(resp.body).toEqual('No services monitored.');
                })
                .catch(function(err){
                    expect(err).not.toBeDefined();
                })
                .done(done);
        }, 10000);

        it('returns 200 if checkProcess succeeds',function(done){
            createMonitorProfile('maint', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/maint.pid'
                }
            })
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual({ maint : '200' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);

        it('returns 200 if checkHttp succeeds',function(done){
            createMonitorProfile('maint', {
                checkHttp : {
                    path : '/maint/meta'
                }
            })
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual({ maint : '200' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);

        it('returns 200 if checkHttp && checkProcess succeeds on same service',function(done){
            createMonitorProfile('maint', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/maint.pid'
                },
                checkHttp : {
                    path : '/maint/meta'
                }
            })
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual({ maint : '200' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);

        it('returns 503 if one service good one fails checkProcess',function(done){
            createMonitorProfile('maint', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/maint.pid'
                },
                checkHttp : {
                    path : '/maint/meta'
                }
            })
            .then(createMonitorProfile('phony', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/phony.pid'
                }
            }))
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(503);
                expect(resp.body).toEqual({ maint : '200', phony : '503' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);

        it('returns 502 if one service good one fails checkHttp',function(done){
            createMonitorProfile('maint', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/maint.pid'
                },
                checkHttp : {
                    path : '/maint/meta'
                }
            })
            .then(createMonitorProfile('phony', {
                checkHttp : {
                    path : '/phoney/path'
                }
            }))
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(502);
                expect(resp.body).toEqual({ maint : '200', phony : '502' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);

        it('returns 200 if two services pass',function(done){
            createMonitorProfile('maint', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/maint.pid'
                },
                checkHttp : {
                    path : '/maint/meta'
                }
            })
            .then(createMonitorProfile('monitor', {
                checkProcess : {
                    pidPath : '/opt/sixxy/run/monitor.pid'
                }
            }))
            .then(restartService)
            .then(getStatus)
            .then(function(resp){
                expect(resp.response.statusCode).toEqual(200);
                expect(resp.body).toEqual({ maint : '200', monitor : '200' });
            })
            .catch(function(err){
                expect(err).not.toBeDefined();
            })
            .done(done);
        },10000);
    });
    
    // NOTE: The monitor svc must be configured with a cache instance for these to work
    describe('/api/result/:reqId', function() {
        var mockData, cacheConn;
        beforeEach(function(done) {
            mockData = {
                'a1234': { code: 200, body: [{ foo: 'bar' }, {foo: 'baz'}] },
                'b4567': { code: 400, body: 'Your request stinks' },
                'c7890': { code: 500, body: { error: 'Internal error', detail: 'I GOT A PROBLEM' } }
            };
            cacheLib.createCache(cacheServers, 5000, 5000).then(function(cache) {
                cacheConn = cache;
                return q.all(Object.keys(mockData).map(function(key) {
                    return cacheConn.set('req:' + key, mockData[key], 10*1000);
                }));
            }).thenResolve().done(done);
        });
        
        afterEach(function(done) {
            return q.all(Object.keys(mockData).map(function(key) {
                return cacheConn.delete('req:' + key);
            })).then(function() {
                cacheConn.close();
            }).done(done);
        });
        
        it('should retrieve a status code and body from memcached', function(done) {
            q.allSettled([
                requestUtils.qRequest('get', { url: makeUrl('/api/result/a1234') }),
                requestUtils.qRequest('get', { url: makeUrl('/api/result/b4567') }),
                requestUtils.qRequest('get', { url: makeUrl('/api/result/c7890') })
            ]).then(function(results) {
                expect(results[0].state).toBe('fulfilled');
                expect(results[0].value.response.statusCode).toBe(200);
                expect(results[0].value.body).toEqual([{ foo: 'bar' }, {foo: 'baz'}]);
                expect(results[1].state).toBe('fulfilled');
                expect(results[1].value.response.statusCode).toBe(400);
                expect(results[1].value.body).toEqual('Your request stinks');
                expect(results[2].state).toBe('rejected');
                expect(results[2].reason.body).toEqual({ error: 'Internal error', detail: 'I GOT A PROBLEM' });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if the result is not found', function(done) {
            requestUtils.qRequest('get', { url: makeUrl('/api/result/fake3819') }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No result with that id found');
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
    });
});
