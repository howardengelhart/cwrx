(function(){
    'use strict';
    
    var /*q           = require('q'),*/
        express     = require('express'),
        service     = require('../lib/service'),
        uuid        = require('../lib/uuid'),
//        promise     = require('../lib/promise'),
        logger      = require('../lib/logger'),
        __ut__      = (global.jasmine !== undefined) ? true : false,
        app         = {},
        state       = {};

    state.defaultConfig = {
        appName : 'monitr',
        appDir  : __dirname,
        log    : {
            logLevel : 'info',
            media    : [ { type : 'file' } ],
            logDir   : './',
            logName  : 'monitr.log'
        },
        pidFile : 'monitr.pid',
        pidDir  : './',
        requestTimeout  : 2000
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
