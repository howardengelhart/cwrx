#!/usr/bin/env node
(function(){
    'use strict';
    var __ut__      = (global.jasmine !== undefined) ? true : false;

    process.env.maint = true;

    var fs          = require('fs-extra'),
        path        = require('path'),
        q           = require('q'),
        aws         = require('aws-sdk'),
        request     = require('request'),
        express     = require('express'),
        bodyParser  = require('body-parser'),
        logger      = require('../lib/logger'),
        daemon      = require('../lib/daemon'),
        uuid        = require('../lib/uuid'),
        cwrxConfig  = require('../lib/config'),
        app         = express(),

        // This is the template for maint's configuration
        defaultConfiguration = {
            caches : {
                run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
                line    : path.normalize('/usr/local/share/cwrx/dub/caches/line/'),
                blanks  : path.normalize('/usr/local/share/cwrx/dub/caches/blanks/'),
                script  : path.normalize('/usr/local/share/cwrx/dub/caches/script/'),
                video   : path.normalize('/usr/local/share/cwrx/dub/caches/video/'),
                output  : path.normalize('/usr/local/share/cwrx/dub/caches/output/'),
                jobs    : path.normalize('/usr/local/share/cwrx/dub/caches/jobs/'),
            },
            serviceRestart: {
                checkInterval   : 500, // milliseconds
                maxChecks       : 20
            },
            s3 : {
                share   : {
                    bucket  : 'c6.dev',
                    path    : 'media/usr/screenjack/video/'
                },
                tracks  : {
                    bucket  : 'c6.dev',
                    path    : 'media/usr/screenjack/track/'
                },
                auth    : path.join(process.env.HOME,'.aws.json')
            },
            tts : {
                auth        : path.join(process.env.HOME,'.tts.json'),
                bitrate     : '48k',
                frequency   : 22050,
                workspace   : __dirname
            }
        },

        // Attempt a graceful exit
        exitApp  = function(resultCode,msg){
            var log = logger.getLog();
            if (msg){
                if (resultCode){
                    log.error(msg);
                } else {
                    log.info(msg);
                }
            }
            process.exit(resultCode);
        };

    function getVersion() {
        var fpath = path.join(__dirname, 'maint.version'),
            log = logger.getLog();

        if (fs.existsSync(fpath)) {
            try {
                return fs.readFileSync(fpath).toString().trim();
            } catch(e) {
                log.error('Error reading version file: ' + e.message);
            }
        }
        log.warn('No version file found');
        return 'unknown';
    }

    function createConfiguration(cmdLine) {
        var cfgObject = cwrxConfig.createConfigObject(cmdLine.config, defaultConfiguration),
            log;

        if (cfgObject.log) {
            log = logger.createLog(cfgObject.log);
        }

        try {
            aws.config.loadFromPath(cfgObject.s3.auth);
        }  catch (e) {
            throw new SyntaxError('Failed to load s3 config: ' + e.message);
        }

        cfgObject.ensurePaths = function(){
            var self = this;
            Object.keys(self.caches).forEach(function(key){
                log.trace('Ensure cache[' + key + ']: ' + self.caches[key]);
                if (!fs.existsSync(self.caches[key])){
                    log.trace('Create cache[' + key + ']: ' + self.caches[key]);
                    fs.mkdirsSync(self.caches[key]);
                }
            });
        };

        cfgObject.cacheAddress = function(fname,cache){
            return path.join(this.caches[cache],fname);
        };

        return cfgObject;
    }

    function removeFiles(remList) {
        var delCount = 0,
            deferred = q.defer(),
            log = logger.getLog();

        q.all(remList.map(function(fpath) {
            if (fs.existsSync(fpath)) {
                log.info('Removing ' + fpath);
                delCount++;
                return q.npost(fs, 'remove', [fpath]);
            }
            else {
                return q();
            }
        })).then(
            function() { return deferred.resolve(delCount); },
            function(error) { return deferred.reject(error); }
        );
        return deferred.promise;
    }

    function restartService(serviceName, checkUrl, checkInterval, maxChecks) {
        var log = logger.getLog(), exec = require('child_process').exec, checks = 0,
            child, deferred;
        log.info('Will attempt to restart service: %1', serviceName);
        deferred = q.defer();
        
        child = exec('service ' + serviceName + ' restart', function (error, stdout, stderr) {
            log.info('stdout: %1' , stdout);
            log.info('stderr: %2' , stderr);
            if (error !== null) {
                log.error('exec error: %3' , error.message);
                return deferred.reject(error);
            }
            
            (function checkRunning() {
                log.info('Checking if service %1 is running', serviceName);
                if (checks++ >= maxChecks) {
                    return deferred.reject({message: 'Hit max call count for checking service'});
                }
                request.get({url: checkUrl}, function(error, response/*, body*/) {
                    if (error || response.statusCode !== 200) {
                        setTimeout(checkRunning, checkInterval);
                    } else {
                        deferred.resolve(serviceName);
                    }
                });
            }());
        });

        return deferred.promise;
    }

    function hupService(serviceName) {
        var log = logger.getLog(), exec = require('child_process').exec, child, deferred;
        log.info('Will attempt to hup service: %1', serviceName);
        deferred = q.defer();

        child = exec('service ' + serviceName + ' hup', function (error, stdout, stderr) {
            log.info('stdout: %1' , stdout);
            log.info('stderr: %2' , stderr);
            if (error !== null) {
                log.error('exec error: %3' , error.message);
                return deferred.reject(error);
            }

            deferred.resolve(serviceName);
        });

        return deferred.promise;
    }

    function main(done) {
        var program  = require('commander'),
            config = {},
            log;

        program
            .option('-c, --config [CFGFILE]','Specify a config file')
            .option('-g, --gid [GID]','Run as group (id or name).')
            .option('-u, --uid [UID]','Run as user (id or name).')
            .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
            .option('-p, --port [PORT]','Listent on port [4000].',4000)
            .option('-d, --daemon','Run as a daemon.')
            .option('--show-config','Display configuration and exit.')
            .parse(process.argv);

        if (program.gid){
            console.log('\nChange process to group: ' + program.gid);
            process.setgid(program.gid);
        }

        if (program.uid){
            console.log('\nChange process to user: ' + program.uid);
            process.setuid(program.uid);
        }

        if (!program.config) {
            throw new Error('Please use the -c option to provide a config file');
        }

        config = createConfiguration(program);

        if (program.showConfig){
            console.log(JSON.stringify(config,null,3));
            process.exit(0);
        }

        config.ensurePaths();

        log = logger.getLog();

        if (program.loglevel){
            log.setLevel(program.loglevel);
        }

        process.on('uncaughtException', function(err) {
            try{
                log.error('uncaught: ' + err.message + '\n' + err.stack);
            }catch(e){
                console.error('uncaught: ' + err.message + '\n' + err.stack);
            }
            return done(2);
        });

        process.on('SIGINT',function(){
            log.info('Received SIGINT, exitting app.');
            return done(1,'Exit');
        });

        process.on('SIGTERM',function(){
            log.info('Received TERM, exitting app.');
            if (program.daemon){
                daemon.removePidFile(config.cacheAddress('maint.pid', 'run'));
            }
            return done(0,'Exit');
        });

        log.info('Running version ' + getVersion());

        // Daemonize if so desired
        if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
            daemon.daemonize(config.cacheAddress('maint.pid', 'run'), done);
        }

        app.use(function(req, res, next) {
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

        app.use(function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] ||
                !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });

        app.use(bodyParser.json());

        app.post('/maint/remove_S3_script', function(req, res/*, next*/) {
            log.info('Starting remove S3 script');
            log.trace(JSON.stringify(req.body));
            var fname = req.body.fname;
            if (!fname) {
                log.error('Incomplete params in request');
                res.send(400, {
                    error   : 'Bad request',
                    detail  : 'Need filename in request'
                });
                return;
            }
            var s3 = new aws.S3(),
                params = {
                Bucket: config.s3.share.bucket,
                Key: path.join(config.s3.share.path, fname)
            };
            log.info('Removing script: Bucket = ' + params.Bucket + ', Key = ' + params.Key);
            s3.deleteObject(params, function(err/*, data*/) {
                if (err) {
                    log.error('Delete object error: ' + err);
                    res.send(500, {
                        error   : 'Unable to process request',
                        detail  : err
                    });
                } else {
                    log.info('Successfully removed script');
                    res.send(200, { msg: 'Successfully removed script' });
                }
            });
        });

        app.post('/maint/create_file',function(req, res){
            if (!req.body || !req.body.fpath || !req.body.data ) {
                log.error('Incomplete params in request');
                res.send(400, {
                    error   : 'Bad request',
                    detail  : 'Need fpath, and data in request'
                });
                return;
            }
            fs.outputFile(req.body.fpath, req.body.data, function(error) {
                if (error) {
                    log.error('Error writing to file: ' + error);
                    res.send(500, {
                        error   : 'Unable to process request',
                        detail  : error
                    });
                } else {
                    log.info('Successfully wrote file ' + req.body.fpath);
                    res.send(200, {msg: 'Successfully wrote file ' + req.body.fpath});
                }
            });
        });

        app.post('/maint/delete_file',function(req, res){
            if (!req.body || !req.body.fpath  ) {
                log.error('Incomplete params in request');
                res.send(400, {
                    error   : 'Bad request',
                    detail  : 'Need fpath in request'
                });
                return;
            }
            fs.remove(req.body.fpath, function(error) {
                if (error) {
                    log.error('Error removing file: ' + error);
                    res.send(500, {
                        error   : 'Unable to process request',
                        detail  : error
                    });
                } else {
                    log.info('Successfully removed file ' + req.body.fpath);
                    res.send(200, {msg: 'Successfully removed file ' + req.body.fpath});
                }
            });
        });

        app.post('/maint/cache_file', function(req, res/*, next*/) {
            log.info('Starting cache file');
            if (!req.body || !req.body.fname || !req.body.data || !req.body.cache) {
                log.error('Incomplete params in request');
                res.send(400, {
                    error   : 'Bad request',
                    detail  : 'Need filename, cache name, and data in request'
                });
                return;
            }
            fs.writeFile(config.cacheAddress(req.body.fname, req.body.cache),
                         JSON.stringify(req.body.data), function(error) {
                if (error) {
                    log.error('Error writing to file: ' + error);
                    res.send(500, {
                        error   : 'Unable to process request',
                        detail  : error
                    });
                } else {
                    log.info('Successfully wrote file ' + req.body.fname);
                    res.send(200, {msg: 'Successfully wrote file ' + req.body.fname});
                }
            });
        });

        app.post('/maint/clean_all_caches', function(req, res/*, next*/) {
            var remList = [];
            log.info('Starting clean all caches');
            for (var key in config.caches) {
                remList.push(config.caches[key]);
            }
            removeFiles(remList).finally(function() { config.ensurePaths(); }).then(
                function(val) {
                    log.info('Successfully removed ' + val + ' objects');
                    res.send(200, {msg: 'Successfully removed ' + val + ' objects'});
                }, function(error) {
                    log.error('Remove files error: ' + error);
                    res.send(500,{
                        error  : 'Unable to process request.',
                        detail : error
                    });
                }
            );
        });

        app.post('/maint/clear_log', function(req, res/*, next*/) {
            if (!req.body || (!req.body.logFile && !req.body.logPath)) {
                res.send(400, {
                    error: 'Bad request',
                    detail: 'You must include the log filename or full path in the request'
                });
                return;
            }
            var logFile = req.body.logPath || path.join(config.log.logDir, req.body.logFile);
            log.info('Clearing log %1', logFile);
            fs.writeFile(logFile, '', function(error) {
                if (error) {
                    log.error('Error clearing log %1: %2', logFile, error);
                    res.send(500, {
                        error: 'Unable to process request',
                        detail: error
                    });
                } else {
                    log.info('Successfully cleared log %1', logFile);
                    res.send(200, {msg: 'Successfully cleared log %1' + logFile});
                }
            });
        });

        app.get('/maint/get_log', function(req, res/*, next*/) {
            if (!req.query || (!req.query.logFile && !req.query.logPath)) {
                res.send(400, {
                    error: 'Bad request',
                    detail: 'You must include the log filename or full path in the request'
                });
                return;
            }
            var logFile = req.query.logPath || path.join(config.log.logDir, req.query.logFile);
            log.info('Reading log %1', logFile);
            fs.readFile(logFile, function(error, contents) {
                if (error) {
                    log.error('Error reading log %1: %2', logFile, error);
                    res.send(500, {
                        error: 'Unable to process request',
                        detail: error
                    });
                } else {
                    log.info('Successfully read log %1', logFile);
                    res.send(200, contents);
                }
            });
        });

        app.post('/maint/service/restart', function(req, res/*, next*/){
            if (!req.body || !req.body.service || !req.body.checkUrl) {
                res.send(400, {
                    error: 'Bad request',
                    detail: 'You must include service and checkUrl parameters'
                });
                return;
            }
            restartService(req.body.service, req.body.checkUrl,
                           config.serviceRestart.checkInterval, config.serviceRestart.maxChecks)
                .then(function(svcName){
                    log.info('Successfully restarted %1',svcName);
                    res.send(200);
                })
                .catch(function(error){
                    log.error('Failed to restart %1: %2',req.body.service,error.message);
                    res.send(500);
                });
        });

        app.post('/maint/service/hup', function(req, res/*, next*/){
            if (!req.body || !req.body.service) {
                res.send(400, {
                    error: 'Bad request',
                    detail: 'You must include service parameter'
                });
                return;
            }
            hupService(req.body.service)
                .then(function(svcName){
                    log.info('Successfully huped %1',svcName);
                    res.send(200);
                })
                .catch(function(error){
                    log.error('Failed to hup %1: %2',req.body.service,error.message);
                    res.send(500);
                });
        });

        app.get('/maint/meta', function(req, res/*, next*/){
            var data = {
                version: getVersion(),
                config: {
                    caches: config.caches,
                    s3: {
                        share: config.s3.share,
                        tracks: config.s3.tracks
                    }
                }
            };
            res.send(200, data);
        });

        app.use(function(err, req, res, next) {
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

        app.listen(program.port);
        log.info('Maintenance server is listening on port: ' + program.port);
    }

    if (!__ut__){
        try {
            main(function(rc,msg){
                exitApp(rc,msg);
            });
        } catch(e) {
            exitApp(1,e.stack);
        }
    }

    if (__ut__) {
        module.exports = {
            getVersion: getVersion,
            createConfiguration : createConfiguration,
            defaultConfiguration: defaultConfiguration,
            restartService      : restartService,
            hupService          : hupService,
            removeFiles         : removeFiles
        };
    }
}());
