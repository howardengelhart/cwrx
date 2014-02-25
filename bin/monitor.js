(function(){
    'use strict';

    var q           = require('q'),
        fs          = require('fs-extra'),
        express     = require('express'),
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
        requestTimeout  : 2000
    };

    app.checkProcess = function(params){
        if (!fs.existsSync(params.checkProcess.pidPath)){
            return q.reject(new Error('Unable to locate pid.'));
        }

        var pid = parseInt(fs.readFileSync(params.checkProcess.pidPath));

        try {
            process.kill(pid,0);
        } catch (e){
            return q.reject(new Error('Unable to locate process.'));
        }

        return q(params);

    };

    app.checkHttp = function(params) {
        var deferred = q.defer(), opts, req, server = http;
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

        req = server.request(opts,function(res){
            var data = '';
            res.setEncoding('utf8');
            res.on('data',function(chunk){
                data += chunk;
            });
            res.on('end',function(){
                if ((res.statusCode < 200) || (res.statusCode >= 300)){
                    var err = new Error(data);
                    err.httpCode = res.statusCode;
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
                return app.checkProcess(params.checkProcess);
            }
            return params;
        })
        .then(function(params){
            if (params.checkHttp){
                params.checks++;
                return app.checkHttp(params.checkHttp);
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

    app.main = function(state){
        var log = logger.getLog(), webServer;

        if (state.clusterMaster){
            log.info('Cluster master, not a worker');
            return state;
        }

        webServer = express();
        webServer.use(express.bodyParser());

        webServer.all('*', function(req, res, next) {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers',
                       'Origin, X-Requested-With, Content-Type, Accept');
            res.header('cache-control', 'max-age=0');

            if (req.method.toLowerCase() === 'options') {
                res.send(200);
            } else {
                next();
            }
        });

        webServer.all('*',function(req, res, next){
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] ||
                    !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method,req.url,req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method,req.url,req.httpVersion);
            }
            next();
        });

        setInterval(function(){
            log.info('I am logging');
        },1000);
    };

    if (!__ut__){
        service.start(state)
        .then(service.parseCmdLine)
        .then(service.configure)
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
