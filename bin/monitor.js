#!/usr/bin/env node
(function(){
    'use strict';

    var q           = require('q'),
        fs          = require('fs-extra'),
        express     = require('express'),
        glob        = require('glob'),
        http        = require('http'),
        https       = require('https'),
        util        = require('util'),
        aws         = require('aws-sdk'),
        service     = require('../lib/service'),
        uuid        = require('../lib/uuid'),
        logger      = require('../lib/logger'),
        __ut__      = (global.jasmine !== undefined) ? true : false,
        app         = {},
        state       = {};

    state.services = [];
    state.defaultConfig = {
        appName : 'monitor',
        appDir  : __dirname,
        log    : {
            logLevel : 'info',
            media    : [ { type : 'console' } ],
            logDir   : './',
            logName  : 'monitor.log'
        },
        pidFile : 'monitor.pid',
        pidDir  : './',
        port    : 3333,
        checkHttpTimeout : 2000,
        requestTimeout  : 3000,
        monitorInc : './monitor.*.json',
        pubsub: {
            cacheCfg: {
                port: 21211,
                isPublisher: true
            }
        }
    };

    app.checkProcess = function(params){
        var log = logger.getLog();
        log.trace('checkProcess - check pidPath %1 for %2',
                params.checkProcess.pidPath, params.name);
        if (!fs.existsSync(params.checkProcess.pidPath)){
            log.error('Unable to locate pidPath %1 for %2',
                    params.checkProcess.pidPath, params.name);
            var err = new Error('Process unavailable.');
            err.httpCode = 503;
            return q.reject(err);
        }

        var pid = parseInt(fs.readFileSync(params.checkProcess.pidPath));
        log.trace('checkProcess - check pid %1 for %2', pid, params.name);

        try {
            process.kill(pid,0);
        } catch (e){
            var err = new Error('Process unavailable.');
            err.httpCode = 503;
            return q.reject(err);
        }

        return q(params);
    };

    app.checkHttp = function(params) {
        var log = logger.getLog(), deferred = q.defer(), server = http, opts, req;
        opts = {
            hostname : params.checkHttp.host || 'localhost',
            port     : params.checkHttp.port,
            path     : params.checkHttp.path,
            method   : 'GET'
        };

        if (params.checkHttp.https) {
            server = https;
            if (!opts.port){
                opts.port = 443;
            }
        } else {
            if (!opts.port){
                opts.port = 80;
            }
        }

        log.trace('checkHttp - check for %1: %2', params.name, JSON.stringify(opts));
        req = server.request(opts,function(res){
            var data = '';
            res.setEncoding('utf8');
            res.on('data',function(chunk){
                data += chunk;
            });
            res.on('end',function(){
                log.trace('checkHttp - %1 responds: %2', params.name, res.statusCode);
                if ((res.statusCode < 200) || (res.statusCode >= 300)){
                    log.error('checkHttp - %1 received: %2', params.name, res.statusCode);
                    var err = new Error(data);
                    err.httpCode = 502;
                    deferred.reject(err);
                    return;
                }

                if (res.headers['content-type'] === 'application/json'){
                    data = JSON.parse(data);
                }

                params.checkHttp.response = {
                    statusCode : res.statusCode,
                    data       : data
                };
                deferred.resolve(params);
            });
        });

        req.on('error',function(e){
            log.error('checkHttp - %1 error: %2', params.name, e.message);
            e.httpCode = 500;
            deferred.reject(e);
        });

        req.end();

        return deferred.promise;
    };

    app.checkService = function(serviceConfig){
        serviceConfig.checks = 0;
        return q(serviceConfig)
        .then(function(params){
            if (params.checkProcess){
                params.checks++;
                return app.checkProcess(params);
            }
            return params;
        })
        .then(function(params){
            if (params.checkHttp){
                params.checks++;
                if (params.checkHttp.timeout) {
                    return app.checkHttp(params).timeout(params.checkHttp.timeout,'ETIMEOUT');
                }
                return app.checkHttp(params);
            }
            return params;
        })
        .then(function(params){
            if (params.checks === 0){
                var err = new Error('No checks performed.');
                err.httpCode = 500;
                return q.reject(err);
            }
            return serviceConfig;
        })
        .catch(function(err){
            if (err.message === 'ETIMEOUT'){
                err.httpCode = 504;
                err.message = 'Request timed out.';
            }
            err.service = serviceConfig;
            return q.reject(err);
        });
    };

    app.checkServices = function(services){
        if (!services || services.length < 1){
            return q.reject({ httpCode : 500, message : 'No services monitored.' });
        }

        return q.allSettled(services.map(function(serviceConfig){
            return app.checkService(serviceConfig);
        }))
        .then(function(results){
            var output = {}, errors = 0, code = 0;
            results.forEach(function(result, index){
                if (result.state === 'fulfilled'){
                    output[result.value.name] = '200';
                } else {
                    errors++;
                    code = (result.reason.httpCode || 500);
                    if (result.reason.service){
                        output[result.reason.service.name] = code.toString();
                    } else {
                        output['PROCESS' + index] = code.toString();
                    }
                }
            });

            if (errors) {
                return q.reject({ httpCode : code, message : output });
            }
            return q.resolve(output);
        });
    };

    app.handleGetStatus = function(state, req,res){
        var log = logger.getLog();

        return app.checkServices(state.services).timeout(state.config.requestTimeout,'ETIMEOUT')
            .then(function(result){
                res.send(200,result);
            })
            .catch(function(e){
                if (e.message === 'ETIMEOUT'){
                    e.httpCode = 504;
                    e.message = 'Request timed out.';
                    log.error('[%1] - Request timed out.',req.uuid);
                } else {
                    log.error('[%1] - One or more checks failed', req.uuid);
                }
                res.send(e.httpCode || 500, e.message);
            });
    };

    app.loadMonitorProfiles = function(state) {
        var log = logger.getLog(),deferred = q.defer(), g;
        log.trace('Search %1 for monitor profiles',state.config.monitorInc);
        g = new glob.Glob(state.config.monitorInc, function(err, files){
            if (err) {
                deferred.reject(err);
                return;
            }

            if (!files){
                deferred.resolve(state);
                return;
            }

            state.services = [];
            files.every(function(file){
                try {
                    state.services.push(fs.readJsonSync(file));
                }
                catch(e){
                    state.services = [];
                    deferred.reject(new Error('Failed to read ' + file + ' with ' + e.message));
                    return false;
                }
                return true;
            });

            deferred.resolve(state);
        });

        return deferred.promise;
    };


    app.verifyConfiguration = function(state){
        var log = logger.getLog();
        if (!state.services || !state.services.length){
            log.error('monitor is not configured to monitor any services.');
            return q(state);
        }

        var reason;

        if (!state.services.every(function(service,index){
            if (!service.name){
                reason = 'Service at index ' + index + ' requires a name.';
                return false;
            }

            if (!service.checkProcess && !service.checkHttp){
                reason = 'Service ' + service.name + ' requires checkProcess or checkHttp.';
                return false;
            }

            if (service.checkProcess && !service.checkProcess.pidPath){
                reason = 'Service ' + service.name + ' requires pidPath for checkProcess.';
                return false;
            }

            if (service.checkHttp && !service.checkHttp.path){
                reason = 'Service ' + service.name + ' requires path for checkHttp.';
                return false;
            }

            if (service.checkHttp) {
                service.checkHttp.timeout =
                    (service.checkHttp.timeout || state.config.checkHttpTimeout);
            }

            return true;
        })) {
            return q.reject(new Error(reason));
        }

        return q(state);
    };


    //TODO: test, comment, where to call this?
    app.getMemcachedServers = function(config) {
        var log = logger.getLog();
        
        aws.config.region = config.aws.region; //TODO: setup config??
        var elb = new aws.ELB(), //TODO: probs want to init these once elsewhere...
            ec2 = new aws.EC2();
        
        // TODO: for dev/non-ASG nodes, should we be able to override this?
        return q.npost(elb, 'describeInstanceHealth', [{LoadBalancerName: config.elbName}])
        .then(function(data) {
            var instanceIds = data.InstanceStates.filter(function(instance) {
                return instance.State === 'InService'; //TODO: how to handle OutofService? research Desc/ReasonCode
            }).map(function(instance) {
                return instance.InstanceId;
            });
            
            if (instanceIds.length === 0) {
                log.warn('No active instances in load balancer %1', config.elbName);
                return q();
            }
            
            return q.npost(ec2, 'describeInstances', [{ InstanceIds: instanceIds }]);
        })
        .then(function(data) {
            var privateIps = data && data.Reservations.reduce(function(arr, reserv) {
                return arr.concat(reserv.Instances.map(function(inst) {
                    return inst.PrivateIpAddress;
                }));
            }, []) || [];
            
            var hosts = privateIps.map(function(ip) { return ip + ':' + config.memcPort; });
            
            //TODO: should we check that memcached is running on each host?
            // pubsub.broadcast(hosts); //TODO
        })
        .catch(function(error) {
            log.error('Failed looking up current memcached servers: %1', util.inspect(error));
            return q.reject(error);
        });
    };

    app.main = function(state){
        var log = logger.getLog(), webServer;
        
        //TODO: test code
        // var pubsub = require('../lib/pubsub');
        // var server = new pubsub.Publisher({ port: 21211 });
        setInterval(function() {
            var msg = { rand: Math.random() };
            // server.broadcast(msg).then(function() {
            //     log.info('Successfully broadcasted ' + util.inspect(msg));
            // })
            state.publishers.cacheCfg.broadcast(msg)
            .catch(function(error) {
                log.error('Failed to broadcast: %1', util.inspect(error));
            });
        }, 5000);
        
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }

        state.onSIGHUP = function(){
            return app.loadMonitorProfiles(state)
                .then(app.verifyConfiguration)
                .catch(function(err){
                    log.error('Caught HUP error: %1', err.message);
                });
        };

        webServer = express();
        webServer.use(express.bodyParser());

        webServer.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');
            next();
        });

        webServer.all('*',function(req, res, next){
            req.uuid = uuid.createUuid().substr(0,10);
            log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                req.method,req.url,req.httpVersion);
            next();
        });

        webServer.get('/api/status',function(req, res){
            app.handleGetStatus(state, req, res);
        });
        
        webServer.get('/api/monitor/version',function(req, res ){
            res.send(200, state.config.appVersion );
        });

        webServer.listen(state.config.port);
        log.info('Service is listening on port: ' + state.config.port);
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(app.loadMonitorProfiles)
        .then(app.verifyConfiguration)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
        .then(service.initPubSubs)
        .then(app.main)
        .catch( function(err){
            var log = logger.getLog();
            console.log(err.message);
            log.error(err.message);
            if (err.code)   {
                process.exit(err.code);
            }
            process.exit(1);
        })
        .done(function(){
            var log = logger.getLog();
            log.info('ready to serve');
        });
    } else {
        module.exports = {
            'app'         : app
        };
    }
}());
