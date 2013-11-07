var fs       = require('fs-extra'),
    path     = require('path'),
    aws      = require('aws-sdk'),
    cwrx     = require(path.join(__dirname,'../lib/index')),
    cp       = require('child_process'),
    crypto   = require('crypto'),
    
    util = {};

util.createConfiguration = function(cmdLine, defaultCfg){
    var log = cwrx.logger.getLog(),
        cfgObject = {},
        userCfg;
    
    if (cmdLine.config) {
        userCfg = JSON.parse(fs.readFileSync(cmdLine.config, { encoding : 'utf8' }));
    } else {
        userCfg = {};
    }

    if (!defaultCfg) {
        cfgObject = userCfg;
    } else {
        Object.keys(defaultCfg).forEach(function(section){
            cfgObject[section] = {};
            Object.keys(defaultCfg[section]).forEach(function(key){
                if ((cfgObject[section] !== undefined) && userCfg[section] &&
                    (userCfg[section][key] !== undefined)){
                    cfgObject[section][key] = userCfg[section][key];
                } else {
                    cfgObject[section][key] = defaultCfg[section][key];
                }
            });
        });

        if (userCfg.log) {
            if (!cfgObject.log) {
                cfgObject.log = {};
            }
            Object.keys(userCfg.log).forEach(function(key){
                cfgObject.log[key] = userCfg.log[key];
            });
        }
    }

    if (cfgObject.output && cfgObject.output.uri){
        if (cfgObject.output.uri.charAt(cfgObject.output.uri.length - 1) !== '/'){
            cfgObject.output.uri += '/';
        }
    }

    if (cfgObject.log) {
        log = cwrx.logger.createLog(cfgObject.log);
    }

    if (cmdLine.enableAws){
        try {
            aws.config.loadFromPath(cfgObject.s3.auth);
        }  catch (e) {
            throw new SyntaxError('Failed to load s3 config: ' + e.message);
        }
        if (cmdLine.enableAws){
            cfgObject.enableAws = true;
        }
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

    cfgObject.uriAddress = function(fname){
        if ((cfgObject.output) && (cfgObject.output.uri)){
            return (cfgObject.output.uri + fname);
        }
        return fname;
    };

    cfgObject.cacheAddress = function(fname,cache){
        return path.join(this.caches[cache],fname);
    };

    cfgObject.writePidFile = function(data, fname){
        var pidPath = this.cacheAddress(fname,'run');
        log.info('Write pid file: ' + pidPath);
        fs.writeFileSync(pidPath,data);
    };

    cfgObject.readPidFile = function(fname){
        var pidPath = this.cacheAddress(fname,'run'),
            result;
        try {
            if (fs.existsSync(pidPath)){
                result = fs.readFileSync(pidPath);
            }
        } catch(e){
            log.error('Error reading [' + pidPath + ']: ' + e.message); 
        }
        return result;
    };

    cfgObject.removePidFile = function(fname){
        var pidPath = this.cacheAddress(fname,'run');
        if (fs.existsSync(pidPath)){
            log.info('Remove pid file: ' + pidPath);
            fs.unlinkSync(pidPath);
        }
    };

    return cfgObject;
};

util.daemonize = function(config, pidname, done) {
    var log = cwrx.logger.getLog();

    // First check to see if we're already running as a daemon
    var pid = config.readPidFile(pidname + ".pid");
    if (pid){
        var exists = false;
        try {
            exists = process.kill(pid,0);
        }catch(e){
        }

        if (exists) {
            console.error('It appears daemon is already running (' + pid +
                          '), please sig term the old process if you wish to run a new one.');
            return done(1,'need to term ' + pid);
        } else {
            log.error('Process [' + pid + '] appears to be gone, will restart.');
            config.removePidFile(pidname + ".pid");
        }

    }

    // Proceed with daemonization
    console.log('Daemonizing.');
    log.info('Daemonizing and forking child..');
    var child_args = [];
    process.argv.forEach(function(val, index) {
        if (index > 0) {
            child_args.push(val);            
        }
    });
  
    // Add the RUNNING_AS_DAEMON var to the environment
    // we are forwarding along to the child process
    process.env.RUNNING_AS_DAEMON = true;
    var child = cp.spawn('node',child_args, { 
        stdio   : 'ignore',
        detached: true,
        env     : process.env
    });
  
    child.unref();
    log.info('child spawned, pid is ' + child.pid + ', exiting parent process..');
    config.writePidFile(child.pid, pidname + ".pid");
    console.log("child has been forked, exit.");
    process.exit(0);
};

util.hashText = function(txt){
    var hash = crypto.createHash('sha1');
    hash.update(txt);
    return hash.digest('hex');
};

util.getObjId = function(prefix, item) {
    return prefix + '-' + util.hashText(
        process.env.host                    +
        process.pid.toString()              +
        process.uptime().toString()         + 
        (new Date()).valueOf().toString()   +
        (JSON.stringify(item))            +
        (Math.random() * 999999999).toString()
    ).substr(0,14);
};

module.exports = util;

