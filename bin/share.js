#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var fs       = require('fs-extra'),
    path     = require('path'),
    crypto   = require('crypto'),
    cp       = require('child_process'),
    express  = require('express'),
    aws      = require('aws-sdk'),
    q        = require('q'),
    cwrx     = require(path.join(__dirname,'../lib/index')),
    app      = express(),

    // This is the template for share's configuration
    defaultConfiguration = {
        caches : {
            run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
        },
        s3 : {
            share     : {
                bucket  : 'c6media',
                path    : 'usr/screenjack/video/'
            },
            auth    : path.join(process.env.HOME,'.aws.json')
        }
    },

    // Attempt a graceful exit
    exitApp  = function(resultCode,msg){
        var log = cwrx.logger.getLog();
        if (msg){
            if (resultCode){
                log.error(msg);
            } else {
                log.info(msg);
            }
        }
        process.exit(resultCode);
    };

if (!__ut__){
    try {
        main(function(rc,msg){
            exitApp(rc,msg);
        });
    } catch(e) {
        exitApp(1,e.stack);
    }
}

function main(done) {
    var program  = require('commander'),
        config = {},
        log, userCfg;

    program
        .version('0.1.0')
        .option('-c, --config [CFGFILE]','Specify config file')
        .option('-d, --daemon','Run as a daemon (requires -s).')
        .option('-g, --gid [GID]','Run as group (id or name).')
        .option('-l, --loglevel [LEVEL]', 'Specify log level (TRACE|INFO|WARN|ERROR|FATAL)' )
        .option('-p, --port [PORT]','Listent on port (requires -s) [3100].', 3100)
        .option('-u, --uid [UID]','Run as user (id or name).')
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

    program.enableAws = true;

    config = createConfiguration(program);

    if (program.showConfig){
        console.log(JSON.stringify(config,null,3));
        process.exit(0);
    }

    config.ensurePaths();

    log = cwrx.logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }

    process.on('uncaughtException', function(err) {
        try{
            log.error('uncaught: ' + err.message + "\n" + err.stack);
        }catch(e){
            console.error(e);
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
            daemon.removePidFile(config.cacheAddress('share.pid', 'run'));
        }
        return done(0,'Exit');
    });

    log.info('Running version ' + program.version());
    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
        cwrx.util.daemonize(config.cacheAddress('share.pid', 'run'), done);
    }

    app.use(express.bodyParser());

    app.all('*', function(req, res, next) {
        req.uuid = cwrx.uuid().substr(0,10);
        log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
            req.method, req.url, req.httpVersion);
        next();
    });

    app.post('/share', function(req, res, next) {
        shareLink(req, config, function(err, output) {
            if (err) {
                res.send(400,{
                    error  : 'Unable to complete request.',
                    detail : err
                });
                return;
            }
            res.send(200, {
                url : output
            });
        });
    });

    app.listen(program.port);
    log.info('Share server is listening on port: ' + program.port);
}

function createConfiguration(cmdLine) {
    var cfgObject = cwrx.config.createConfigObject(cmdLine.config, defaultConfiguration),
        log;

    if (cfgObject.log) {
        log = cwrx.logger.createLog(cfgObject.log);
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

function hashText(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
}

function getObjId(prefix, item) {
    return prefix + '-' + hashText(
        process.env.host                    +
        process.pid.toString()              +
        process.uptime().toString()         + 
        (new Date()).valueOf().toString()   +
        (JSON.stringify(item))            +
        (Math.random() * 999999999).toString()
    ).substr(0,14);
}

function shareLink(req, config, done) {
    var log = cwrx.logger.getLog(),
        body = req.body;
    log.info("[%1] Starting shareLink", req.uuid);

    if (!body || !body.origin) {
        log.error("[%1] No origin url in request", req.uuid);
        done("You must include the origin url to generate a shareable url");
        return;
    }
    var origin = body.origin,
        item = body.data,
        prefix = body.origin.split('/#/')[0];
    var generateUrl = function(uri) {
        var url;
        if (!uri) {
            url = body.origin;
        } else {
            url = prefix + '/#/experiences/';
            url += uri;
        }
        //TODO: shorten URL
        log.info("[%1] Finished shareLink: URL = %2", req.uuid, url);
        done(null, url);
    };

    if (!item) {
        generateUrl();
        return;
    }

    var s3 = new aws.S3(),
        deferred = q.defer(),
        id = getObjId('e', item),
        fname = id + '.json',
        params = { Bucket       : config.s3.share.bucket,
                   ACL          : 'public-read',
                   ContentType  : 'application/JSON',
                   Key          : path.join(config.s3.share.path, fname)
                 },
        
        hash = crypto.createHash('md5'),
        headParams = { Bucket: params.Bucket, Key: params.Key};
    
    hash.update(JSON.stringify(item));
    item.id = id;
    item.uri = item.uri.replace('shared~', '');
    item.uri = 'shared~' + item.uri.split('~')[0] + '~' + id;
    params.Body = (item ? new Buffer(JSON.stringify(item)) : null);

    s3.headObject(headParams, function(err, data) {
        if (data && data.ETag && data.ETag.replace(/"/g, '') == hash.digest('hex')) {
            log.info("[%1] Item already exists on S3, skipping upload", req.uuid);
            generateUrl(item.uri);
        } else {
            log.info("[%1] Uploading data: Bucket = %2, Key = %3",
                      req.uuid, params.Bucket, params.Key);
            s3.putObject(params, function(err, data) {
                if (err) {
                    done(err);
                } else {
                    log.trace('[%1] SUCCESS: ' + JSON.stringify(data), req.uuid);
                    generateUrl(item.uri);
                }
            });
        }
    });
}

