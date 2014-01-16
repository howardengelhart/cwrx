#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    path        = include('path'),
    q           = include('q'),
    express     = include('express'),
    MongoStore  = include('connect-mongo')(express),
    bcrypt      = include('bcrypt'),
    logger      = include('../lib/logger'),
    cwrxConfig  = include('../lib/config'),
    uuid        = include('../lib/uuid'),
    daemon      = include('../lib/daemon'),
    mongoUtils  = include('../lib/mongoUtils'),
    app         = express(),

    auth = {}, // for exporting functions to unit tests

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

// This is the template for auth's configuration
auth.defaultConfiguration = {
    caches : {
        run     : path.normalize('/usr/local/share/cwrx/auth/caches/run/'),
    },
    session: {
        key: 'c6Auth',
        maxAge: 14*24*60*60*1000, // 14 days; unit here is milliseconds
        mongo: {
            db: 'sessions',
            host: 'localhost',
            port: 27017
        }
    },
    secrets: {
        path: path.join(process.env.HOME,'.secrets.json')
    }
};

auth.getVersion = function() {
    var fpath = path.join(__dirname, 'auth.version'),
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

auth.createConfiguration = function(cmdLine) { // TODO
    var cfgObject = cwrxConfig.createConfigObject(cmdLine.config, auth.defaultConfiguration),
        log;

    if (cfgObject.log) {
        log = logger.createLog(cfgObject.log);
    }
    
    var secretsObj = fs.readJsonSync(cfgObject.secrets.path);
    for (var key in secretsObj) {
        cfgObject.secrets[key] = secretsObj[key];
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
};

auth.login = function(req, users) {
    if (!req.body || !req.body.username || !req.body.password) {
        return q({
            code: 400,
            body: 'You need to provide a username and password in the body'
        });
    }
    var deferred = q.defer(),
        log = logger.getLog(),
        userAccount;
    
    log.info('[%1] Starting login for user %2', req.uuid, req.body.username);
    q.npost(users, 'findOne', [{username: req.body.username}])
    .then(function(account) {
        if (!account) {
            log.info('[%1] Failed login for user %2: unknown username', req.uuid, req.body.username);
            return q.reject();
        }
        userAccount = account;
        return q.npost(bcrypt, 'compare', [req.body.password, userAccount.password]);
    }).then(function(matching) {
        if (matching) {
            log.info('[%1] Successful login for user %2', req.uuid, req.body.username);
            var user = mongoUtils.safeUser(userAccount);
            req.session.regenerate(function() {
                req.session.user = user;
            });
            deferred.resolve({
                code: 200,
                body: {
                    user: user
                }
            });
        } else {
            log.info('[%1] Failed login for user %2: invalid password', req.uuid, req.body.username);
            return q.reject();
        }
    }).catch(function(error) {
        if (error) { // actual server error, reject the promise
            log.error('[%1] Error logging in user %2: %3', req.uuid, req.body.username, error);
            deferred.reject(error);
        } else { // failed authentication b/c of bad credentials, resolve with 401
            deferred.resolve({
                code: 401,
                body: 'Invalid username or password'
            });
        }
    });
    
    return deferred.promise;
};

// This may be subject to significant change later, but should act as a basic start/example
auth.signup = function(req, users) {
    if (!req.body || !req.body.username || !req.body.password) {
        return q({
            code: 400,
            body: 'You need to provide a username and password in the body'
        });
    }
    var deferred = q.defer(),
        log = logger.getLog(),
        newUser;
    
    log.info('[%1] Starting signup of user %2', req.uuid, req.body.username);
    // check if a user already exists with that username
    q.npost(users, 'findOne', [{username: req.body.username}])
    .then(function(userAccount) {
        if (userAccount) {
            log.info('[%1] User %2 already exists', req.uuid, req.body.username);
            deferred.resolve({
                code: 400,
                body: 'A user with that username already exists'
            });
            return q();
        }
        newUser = {
            id: 'u-' + uuid.createUuid().substr(0,14),
            created: new Date(),
            username: req.body.username
        };
        return q.npost(bcrypt, 'hash', [req.body.password, bcrypt.genSaltSync()])
        .then(function(hashed) {
            newUser.password = hashed;
            // save to users with normal + journal write concern; guarantees write goes through
            return q.npost(users, 'insert', [newUser, {w: 1, journal: true}]);
        }).then(function() {
            // Log the user in
            log.info('[%1] Successfully created an account for user %2, id: %3',
                     req.uuid, req.body.username, newUser.id);
            var user = mongoUtils.safeUser(newUser);
            req.session.regenerate(function() {
                req.session.user = user;
            });
            deferred.resolve({
                code: 200,
                body: {
                    user: user
                }
            });
        });
    }).catch(function(error) {
        log.error('[%1] Error creating user account %2: %3', req.uuid, req.body.username, error);
        deferred.reject(error);
    });
    
    return deferred.promise;
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

    config = auth.createConfiguration(program);
    
    if (program.showConfig){
        console.log(JSON.stringify(config,null,3));
        process.exit(0);
    }

    config.ensurePaths();

    log = logger.getLog();

    if (program.loglevel){
        log.setLevel(program.loglevel);
    }
    
    mongoUtils.connect(config.mongo.host, config.mongo.port).done(function(mongoClient) {
        log.info('Successfully connected to mongo at %1:%2', config.mongo.host, config.mongo.port);
        
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
                daemon.removePidFile(config.cacheAddress('auth.pid', 'run'));
            }
            return done(0,'Exit');
        });

        log.info('Running version ' + auth.getVersion());
        
        // Daemonize if so desired
        if ((program.daemon) && (process.env.RUNNING_AS_DAEMON === undefined)) {
            daemon.daemonize(config.cacheAddress('auth.pid', 'run'), done);
        }

        app.use(express.bodyParser());
        app.use(express.cookieParser(config.secrets.cookieParser || '')); //TODO different session config????
        app.use(express.session({
            key: config.session.key,
            secret: config.secrets.session || '',
            cookie: {
                httpOnly: false,
                maxAge: config.session.maxAge
            },
            store: new MongoStore({
                db: config.session.mongo.db,
                host: config.session.mongo.host,
                port: config.session.mongo.port
            })
        }));

        app.all('*', function(req, res, next) { // TODO keep all this????
            res.header("Access-Control-Allow-Origin", "*");
            res.header("Access-Control-Allow-Headers", 
                       "Origin, X-Requested-With, Content-Type, Accept");
            res.header("cache-control", "max-age=0");

            if (req.method.toLowerCase() === "options") {
                res.send(200);
            } else {
                next();
            }
        });

        app.all('*', function(req, res, next) {
            req.uuid = uuid.createUuid().substr(0,10);
            if (!req.headers['user-agent'] || !req.headers['user-agent'].match(/^ELB-HealthChecker/)) {
                log.info('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            } else {
                log.trace('REQ: [%1] %2 %3 %4 %5', req.uuid, JSON.stringify(req.headers),
                    req.method, req.url, req.httpVersion);
            }
            next();
        });
        var users = mongoClient.db(config.mongo.db).collection('users');
        app.post('/auth/login', function(req, res, next) { //TODO change how failed auth is dealt with???
            auth.login(req, users).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, 'Error processing login');
            });
        });
        
        app.post('/auth/signup', function(req, res, next) {
            auth.signup(req, users).then(function(resp) {
                res.send(resp.code, resp.body);
            }).catch(function(error) {
                res.send(500, 'Error processing login');
            });
        });
        
        app.get('/auth/meta', function(req, res, next){
            var data = {
                version: auth.getVersion(),
                config: {
                    session: config.session
                }
            };
            res.send(200, data);
        });

        app.listen(program.port);
        log.info('auth server is listening on port: ' + program.port);
    });
}

if (__ut__) {
    module.exports = auth;
}
