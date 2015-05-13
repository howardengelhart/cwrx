var q               = require('q'),
    util            = require('util'),
    requestUtils    = require('../../lib/requestUtils'),
    pubsub          = require('../../lib/pubsub'),
    cacheServer     = process.env.cacheServer || 'localhost:11211',
    cacheCfgPort    = process.env.cacheCfgPort || 21211,
    urlBase         = 'http://' + (process.env.host || 'localhost'),
    makeUrl         = function(fragment) { return urlBase + fragment; };
    
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
    
    describe('GET /api/monitor/cacheServers', function() {
        it('should get a list of cache servers', function(done) {
            requestUtils.qRequest('get', { url: makeUrl('/api/monitor/cacheServers') }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toEqual({ servers: [cacheServer] });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the same list monitor is broadcasting on the cacheCfg channel', function(done) {
            requestUtils.qRequest('get', { url: makeUrl('/api/monitor/cacheServers') }).then(function(resp) {
                var servers = resp.body.servers,
                    connCfg = { host: process.env.host, port: cacheCfgPort };
                
                var sub = new pubsub.Subscriber('cacheCfg', connCfg, { reconnect: false })
                .on('message', function(msg) {
                    expect(msg).toEqual({ servers: servers });
                    sub.close();
                    done();
                });
            }).catch(function(error) {
                expect(util.inspect(error)).not.toBeDefined();
                done();
            });
        });
    });
});
