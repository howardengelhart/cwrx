#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    path        = include('path'),
    request     = include('request'),
    cp          = include('child_process'),
    express     = include('express'),
    aws         = include('aws-sdk'),
    q           = include('q'),
    querystring = include('querystring'),
    logger      = include('../lib/logger'),
    cwrxConfig  = include('../lib/config'),
    uuid        = include('../lib/uuid'),
    daemon      = include('../lib/daemon'),
    app         = express(),
    
    share = {}, // for exporting functions to unit tests

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

// This is the template for share's configuration
share.defaultConfiguration = {
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/dub/caches/run/'),
    },
    s3 : {
        share     : {
            bucket  : 'c6media',
            path    : 'usr/screenjack/video/'
        },
        auth    : path.join(process.env.HOME,'.aws.json')
    },
    awesm: {
        auth: path.join(process.env.HOME, '.awesm.json')
    }
};

share.getVersion = function() {
    var fpath = path.join(__dirname, 'share.version'),
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
};

share.createConfiguration = function(cmdLine) {
    var cfgObject = cwrxConfig.createConfigObject(cmdLine.config, share.defaultConfiguration),
        log;

    if (cfgObject.log) {
        log = logger.createLog(cfgObject.log);
    }

    try {
        aws.config.loadFromPath(cfgObject.s3.auth);
    }  catch (e) {
        throw new SyntaxError('Failed to load s3 config: ' + e.message);
    }
    
    fs.readJson(cfgObject.awesm.auth, function(error, awesmAuth) {
        if (error) {
            log.error('Failed to load awesm credentials');
            return;
        }
        if (!awesmAuth.apiKey || !awesmAuth.toolKey) {
            log.error('Incomplete awesm credentials: needs apiKey + toolKey');
            return;
        }
        cfgObject.awesmKey = awesmAuth.apiKey;
        cfgObject.awesmTool = awesmAuth.toolKey;
    });

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
};

share.shortenUrl = function(origUrl, config, params, staticLink) {
    var deferred = q.defer(),
        log = logger.getLog(),
        options = {};
    params = params || {};

    if (!config.awesmKey || ! config.awesmTool) {
        deferred.reject('Never loaded awesm credentials properly');
        return deferred.promise;
    }
    if (staticLink) {
        options.url = 'http://api.awe.sm/url/static.json?v=3&key=' + config.awesmKey;
    } else {
        options.url = 'http://api.awe.sm/url.json?v=3&key=' + config.awesmKey;
    }
    options.url += '&tool=' + config.awesmTool;
    if (params.channel) {
        options.url += '&channel=' + params.channel;
    } else {
        options.url += '&channel=email';
    }
    delete params.channel;
    for (var key in params) {
        options.url += '&' + key + '=' + encodeURIComponent(params[key]);
    }
    options.url += '&url=' + encodeURIComponent(origUrl);
    log.trace(options.url);
    
    request.post(options, function(error, response, body) {
        var data;
        try {
            data = JSON.parse(body);
        } catch(e) {
            deferred.reject('error parsing response as json');
            return;
        }
        if (error || data.error) {
            deferred.reject(error || body);
            return;
        }
        deferred.resolve(data.awesm_url);
    });
    return deferred.promise;
};

share.shareLink = function(req, config, done) {
    var log = logger.getLog(),
        body = req.body;
    log.info("[%1] Starting shareLink", req.uuid);

    if (!body || !body.origin) {
        log.error("[%1] No origin url in request", req.uuid);
        done("You must include the origin url to generate a shareable url");
        return;
    }
    var origin = body.origin,
        item = body.data,
        prefix = body.origin.split('experiences/')[0];

    var generateUrl = function(uri) {
        var url;
        if (!uri) {
            url = body.origin;
        } else {
            url = prefix + 'experiences/';
            url += uri;
        }
        
        share.shortenUrl(url, config, req.body.awesmParams, req.body.staticLink).then(function(shortUrl) {
            log.info("[%1] Finished shareLink: URL = %2, short = %3", req.uuid, url, shortUrl);
            done(null, url, shortUrl);
        }).catch(function(error) {
            log.error('[%1] Failed to shorten url: url = %2, error = %3', req.uuid, url, error);
            done(null, url, null);
        });
    };

    if (!item) {
        generateUrl();
        return;
    }
    if (!item.uri || !item.uri.match(/^(shared~)?[^~]+~[^~]+$/)) {
        log.error('[%1] Bad item uri: %2', req.uuid, (item.uri || 'missing uri'));
        done('Bad item uri: ' + (item.uri || 'missing uri'));
        return;
    }

    var s3 = new aws.S3(),
        deferred = q.defer(),
        id = 'e-' + uuid.createUuid().substr(0,14),
        fname = id + '.json',
        params = { Bucket       : config.s3.share.bucket,
                   ACL          : 'public-read',
                   ContentType  : 'application/JSON',
                   Key          : path.join(config.s3.share.path, fname)
                 };
    item.id = id;
    item.uri = item.uri.replace('shared~', '');
    item.uri = 'shared~' + item.uri.split('~')[0] + '~' + id;
    params.Body = (item ? new Buffer(JSON.stringify(item)) : null);

    log.info("[%1] Uploading data: Bucket = %2, Key = %3", req.uuid, params.Bucket, params.Key);
    s3.putObject(params, function(err, data) {
        if (err) {
            log.error('[%1] Error uploading data: %2', req.uuid, JSON.stringify(err));
            done(err);
        } else {
            log.trace('[%1] SUCCESS: %2', req.uuid, JSON.stringify(data));
            generateUrl(item.uri);
        }
    });
};

share.processUrl = function(url) {
    var urlParts = url.split('?');
    var query = querystring.parse(urlParts[1] || '');
    var newUrl = urlParts[0] + '?';
    for (var key in query) {
        newUrl += '&' + key + '=' + encodeURIComponent(query[key]);
    }
    return newUrl;
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
    var program  = include('commander'),
        config = {},
        log, userCfg;

    program
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

    config = share.createConfiguration(program);

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

    log.info('Running version ' + share.getVersion());
    
    // Daemonize if so desired
    if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
        daemon.daemonize(config.cacheAddress('share.pid', 'run'), done);
    }

    app.use(express.bodyParser());

    app.all('*', function(req, res, next) {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Headers", 
                   "Origin, X-Requested-With, Content-Type, Accept");

        if (req.method.toLowerCase() === "options") {
            res.send(200);
        } else {
            next();
        }
    });

    app.all('*', function(req, res, next) {
        req.uuid = uuid.createUuid().substr(0,10);
        log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
            req.method, req.url, req.httpVersion);
        next();
    });
    
    app.get('/share/facebook', function(req, res, next) {
        log.info('[%1] Starting facebook share', req.uuid);
        if (!req.query || !req.query.origin || !req.query.fbUrl) {
            log.error('[%1] Need origin and fbUrl to redirect to in query string', req.uuid);
            res.send(400, 'Unable to complete request.');
            return;
        }
        var origin = req.query.origin;
        var newUrl = share.processUrl(req.query.fbUrl);
        share.shortenUrl(req.query.origin, config, {channel: 'facebook-post'}, req.query.staticLink)
        .then(function(url) {
            log.info('[%1] Got short url %2', req.uuid, url);
            res.redirect(newUrl + '&link=' + encodeURIComponent(url));
        }).catch(function(error) {
            log.error('[%1] Failed to shorten url: url = %2, error = %3', req.uuid, origin, error);
            res.redirect(newUrl + '&link=' + encodeURIComponent(req.query.origin));
        });
    });
    
    app.get('/share/twitter', function(req, res, next) {
        log.info('[%1] Starting twitter share', req.uuid);
        if (!req.query || !req.query.origin || !req.query.twitUrl) {
            log.error('[%1] Need origin and twitUrl to redirect to in query string', req.uuid);
            res.send(400, 'Unable to complete request.');
            return;
        }
        var origin = req.query.origin;
        var newUrl = share.processUrl(req.query.twitUrl);
        share.shortenUrl(req.query.origin, config, {channel: 'twitter'}, req.query.staticLink)
        .then(function(url) {
            log.info('[%1] Got short url %2', req.uuid, url);
            res.redirect(newUrl + '&url=' + encodeURIComponent(url));
        }).catch(function(error) {
            log.error('[%1] Failed to shorten url: url = %2, error = %3', req.uuid, origin, error);
            res.redirect(newUrl + '&url=' + encodeURIComponent(req.query.origin));
        });
    });

    app.post('/share', function(req, res, next) {
        share.shareLink(req, config, function(err, output, shortUrl) {
            if (err) {
                res.send(400,{
                    error  : 'Unable to complete request.',
                    detail : err
                });
                return;
            }
            res.send(200, {
                url: output,
                shortUrl: shortUrl
            });
        });
    });
    
    app.get('/share/meta', function(req, res, next){
        var data = {
            version: share.getVersion(),
            config: {
                output: config.output,
                s3: {
                    share: config.s3.share
                }
            }
        };
        res.send(200, data);
    });

    app.listen(program.port);
    log.info('Share server is listening on port: ' + program.port);
}

if (__ut__) {
    module.exports = share;
}
