#!/usr/bin/env node
(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        fs              = require('fs-extra'),
        glob            = require('glob'),
        http            = require('http'),
        https           = require('https'),
        aws             = require('aws-sdk'),
        express         = require('express'),
        bodyParser      = require('body-parser'),
        expressUtils    = require('../lib/expressUtils'),
        requestUtils    = require('../lib/requestUtils'),
        service         = require('../lib/service'),
        logger          = require('../lib/logger'),
        __ut__          = (global.jasmine !== undefined) ? true : false,
        app             = {},
        state           = {};

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
        cacheDiscovery: {
            awsRegion   : 'us-east-1',      // needed to initiate AWS API clients
            groupName   : null,             // name of ASG to check
            serverIps   : ['localhost'],    // in lieu of groupName, provide static array of ips
            cachePort   : 11211,            // port we expect cache to run on
            scanTimeout : 2000,             // ms to wait when scanning cachePort on hosts
            interval    : 60*1000           // how often to re-discover cache servers
        },
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

    
    // Get a list of private ip addresses for the InService instances in an AutoScaling group.
    app.getASGInstances = function(ASG, EC2, groupName) {
        var log = logger.getLog();
        
        log.trace('Getting list of instances for ASG %1', groupName);

        return q.npost(ASG, 'describeAutoScalingGroups', [{AutoScalingGroupNames: [groupName]}])
        .then(function(data) {
            var group = data && data.AutoScalingGroups && data.AutoScalingGroups[0] || null;
            if (!group || !group.Instances) {
                return q.reject('Incomplete data from describing ASG ' + groupName);
            }
            
            var instanceIds = group.Instances.filter(function(instance) {
                return instance.LifecycleState === 'InService';
            }).map(function(instance) {
                return instance.InstanceId;
            });
            
            if (instanceIds.length === 0) {
                log.warn('No InService instances in group %1', groupName);
                return q();
            }
            
            return q.npost(EC2, 'describeInstances', [{ InstanceIds: instanceIds }]);
        })
        .then(function(data) {
            var privateIps = data && data.Reservations.reduce(function(arr, reserv) {
                return arr.concat(reserv.Instances.map(function(inst) {
                    return inst.PrivateIpAddress;
                }));
            }, []) || [];
            
            log.trace('%1 active instances in ASG %2', privateIps.length, groupName);
            
            return q(privateIps);
        })
        .catch(function(error) {
            log.error('Failed to retrieve instances in ASG %1: %2', groupName, util.inspect(error));
            return q.reject('AWS Error');
        });
    };

    /* Get a list of active hosts ("ip:port") running the cache. If cfg.groupName is provided,
     * queries the AWS API for the instances in this ASG; otherwise, uses cfg.serverIps, a static
     * list of instance ips. Then checks that a server is actually listening on cfg.cachePort on
     * each ip. */
    app.getCacheServers = function(ASG, EC2, cfg) {
        var log = logger.getLog(),
            ipPromise;
        
        if (cfg.groupName) {
            ipPromise = app.getASGInstances(ASG, EC2, cfg.groupName);
        } else {
            if (cfg.serverIps) {
                log.trace('Using static list of server ips: [%1]', cfg.serverIps);
                ipPromise = q(cfg.serverIps);
            } else {
                log.warn('No ASG groupName or list of serverIps, not getting cache servers');
                return q.reject('No way to get servers');
            }
        }

        return ipPromise.then(function(ips) {
            var activeHosts = [];
            
            return q.allSettled(ips.map(function(ip) {
                return requestUtils.portScan(ip, cfg.cachePort, cfg.scanTimeout);
            }))
            .then(function(results) {
                results.forEach(function(result, idx) {
                    if (result.state === 'rejected') {
                        log.warn('Cache not running on InService server %1:%2: %3',
                                 ips[idx], cfg.cachePort, util.inspect(result.reason));
                    } else {
                        activeHosts.push(ips[idx] + ':' + cfg.cachePort);
                    }
                });

                log.info('Current active cache servers: [%1]', activeHosts);
                return q(activeHosts);
            });
        })
        .catch(function(error) {
            log.error('Failed looking up current cache servers: %1', util.inspect(error));
            return q.reject(error);
        });
    };
    
    app.main = function(state){
        var log = logger.getLog(),
            webServer, EC2, ASG;
        
        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }

        aws.config.region = state.config.cacheDiscovery.awsRegion;
        EC2 = new aws.EC2();
        ASG = new aws.AutoScaling();

        function broadcastCacheServers() {
            app.getCacheServers(ASG, EC2, state.config.cacheDiscovery)
            .then(function(servers) {
                return state.publishers.cacheCfg.broadcast({ servers: servers });
            });
        }
        
        log.info('Performing initial check for cache servers');
        broadcastCacheServers();

        setInterval(broadcastCacheServers, state.config.cacheDiscovery.interval);

        state.onSIGHUP = function(){
            return app.loadMonitorProfiles(state)
                .then(app.verifyConfiguration)
                .catch(function(err){
                    log.error('Caught HUP error: %1', err.message);
                });
        };

        webServer = express();

        webServer.set('json spaces', 2);

        webServer.use(expressUtils.basicMiddleware());

        webServer.use(bodyParser.json());

        webServer.get('/api/status',function(req, res){
            app.handleGetStatus(state, req, res);
        });

        webServer.get('/api/monitor/cacheServers', function(req, res) {
            log.info('Starting getCacheServers in response to request');
            app.getCacheServers(ASG, EC2, state.config.cacheDiscovery).then(function(servers) {
                res.send(200, { servers: servers });
            })
            .catch(function(error) {
                log.error('Failed getCacheServers: %1', error && error.stack || error);
                res.send(500, error);
            });
        });
        
        webServer.get('/api/monitor/version',function(req, res ){
            res.send(200, state.config.appVersion );
        });

        webServer.use(function(err, req, res, next) {
            if (err) {
                if (err.status && err.status < 500) {
                    log.warn('[%1] Bad Request: %2', req.uuid, err && err.message || err);
                    res.send(err.status, err.message || 'Bad Request');
                } else {
                    log.error('[%1] Internal Error: %2', req.uuid, err && err.message || err);
                    res.send(err.status || 500, err.message || 'Internal error');
                }
            } else {
                next();
            }
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
        .then(service.initPubSubChannels)
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
            'app' : app
        };
    }
}());
