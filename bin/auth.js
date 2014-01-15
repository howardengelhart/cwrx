#!/usr/bin/env node

var __ut__      = (global.jasmine !== undefined) ? true : false;

var include     = require('../lib/inject').require,
    fs          = include('fs-extra'),
    path        = include('path'),
    express     = include('express'),
    passport    = include('passport'),
    localStrat  = include('passport-local').Strategy,
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

auth.configPassport = function(passport, config) {
    var log = logger.getLog();
    
    mongoUtils.connect(config.mongo.host, config.mongo.port)
    .done(function(mongoClient) { // TODO: handle errors here???
        var db = mongoClient.db(config.mongo.db);
        var accounts = db.collection('accounts');
        var users = db.collection('users');

        // serialize the user for the session
        passport.serializeUser(function(user, done) {
            console.log('serializing user');
            done(null, user.id);
        });

        // deserialize the user from the session
        passport.deserializeUser(function(id, done) { //TODO
            console.log('deserializing user');
            users.findOne({id: id}, done);
        });

        // setup a strategy for logging in with username/password        
        passport.use('local-login', {passReqToCallback : true}, new LocalStrategy(
        function(req, username, password, done) {
            accounts.findOne({username: username}, function(err, userAccount) {
                if (err) {
                    log.error('[%1] Error looking up user %2 in accounts: %3', req.uuid, username, err);
                    return done(err);
                }
                if (!userAccount) {
                    log.info('[%1] Failed login for user %2: unknown username', req.uuid, username);
                    return done('No user with that username found.');
                }   
                bcrypt.compare(password, userAccount.password, function(err, match) {
                    if (err) {
                        log.error('[%1] Error comparing passwords for user %2: %3', req.uuid, err);
                        return done('Error checking password');
                    }
                    if (match) {
                        log.info('[%1] Successful login for user %2', req.uuid, username);
                        users.findOne({username: username}, done);
                    } else {
                        log.info('[%1] Failed login for user %2: invalid password', req.uuid, username);
                        done('Wrong password for this user');
                    }
                });
            });
        }));
        
        // setup a strategy for creating a new account with username/password
        passport.use('local-signup', {passReqToCallback : true}, new LocalStrategy(
        function(req, username, password, done) {
            // check if the user exists first
            accounts.findOne({username: username}, function(err, userAccount) {
                if (err) {
                    log.error('[%1] Error looking up user %2 in accounts: %3', req.uuid, username, err);
                    return done(err);
                }
                if (userAccount) {
                    return done('That username is already taken');
                } else {
                    var newUser = {
                        username: username,
                    };
				    // if there is no user with that email
                    // create the user
                    var newUser            = new User();

                    // set the user's local credentials
                    newUser.local.email    = email;
                    newUser.local.password = newUser.generateHash(password);

				    // save the user
                    newUser.save(function(err) {
                        if (err)
                            throw err;
                        return done(null, newUser);
                    });
                }

            });        

        }));
    });
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
            maxAge: config.session.maxAge
        },
        store: new MongoStore({
            db: config.session.mongo.db,
            host: config.session.mongo.host,
            port: config.session.mongo.port
        })
    }));
    app.use(passport.initialize());
    app.use(passport.session()); // persistent login sessions

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
    
    app.post('/auth/login', function(req, res, next) {
        passport.authenticate('local', function(err, user, info) {
            if (err) {
                res.send(401, 'Invalid username or password');
            } else {
                res.send(200, {
                    user: user
                });
            }
        })(req, res, next);
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
}

if (__ut__) {
    module.exports = auth;
}
