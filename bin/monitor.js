#!/usr/bin/env node
(function(){
    'use strict';

    var q           = require('q'),
        fs          = require('fs-extra'),
        express     = require('express'),
        glob        = require('glob'),
        http        = require('http'),
        https       = require('https'),
        service     = require('../lib/service'),
        uuid        = require('../lib/uuid'),
        logger      = require('../lib/logger'),
        __ut__      = (global.jasmine !== undefined) ? true : false,
        app         = {},
        state       = {};

    state.defaultConfig = {
        appName : 'monitor',
        appDir  : __dirname,
        log    : {
            logLevel : 'info',
            media    : [ { type : 'file' } ],
            logDir   : './',
            logName  : 'monitor.log'
        },
        pidFile : 'monitor.pid',
        pidDir  : './',
        requestTimeout  : 2000,
        monitorInc : './monitor.*.json'
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
            err.service = serviceConfig;
            return q.reject(err);
        });
    };

    app.checkServices = function(services){
        return q.all(services.map(function(serviceConfig){
            return app.checkService(serviceConfig);
        }));
    };

    app.handleGetStatus = function(state, req,res){
        var log = logger.getLog();

        return app.checkServices(state.services).timeout(state.requestTimeout,'ETIMEOUT')
            .then(function(){
                res.send(200,'OK');
            })
            .catch(function(e){
                if (e.message === 'ETIMEOUT'){
                    e.httpCode = 504;
                    e.message = 'Request timed out.';
                }
                log.info('[%1] - caught error: (%2) %3', req.uuid, e.httpCode, e.message);
                res.send(e.httpCode || 500, e.message);
            });
    };

    app.loadMonitorProfiles = function(state) {
        var log = logger.getLog() deferred = q.defer(), g;
        log.trace('Search %1 for monitor profiles',state.monitorInc);
        g = new glob.Glob(state.monitorInc, function(err, files){
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

            });

        });

        return deferred.promise;
    };

    app.verifyConfiguration = function(state){
        if (!state.services || !state.services.length){
            return q.reject(new Error('monitor needs at least one service to monitor.'));
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

            return true;
        })) {
            return q.reject(new Error(reason));
        }

        return q(state);
    };

    app.main = function(state){
        var log = logger.getLog(), webServer;

        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }

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

    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
        .then(app.verifyConfiguration)
        .then(service.prepareServer)
        .then(service.daemonize)
        .then(service.cluster)
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
