var path     = require('path'),
    fs       = require('fs-extra'),
    cp       = require('child_process'),
    logger   = require('./logger'),
    
    daemon = {};

daemon.writePidFile = function(pidPath, data) {
    var log = logger.getLog();
    log.info('Write pid file: ' + pidPath);
    fs.writeFileSync(pidPath,data);
};

daemon.readPidFile = function(pidPath){
    var log = logger.getLog(),
        result;
    try {
        if (fs.existsSync(pidPath)){
            result = fs.readFileSync(pidPath);
        }
    } catch(e){
        log.error('Error reading [' + pidPath + ']: ' + e.message); 
    }
    return result.toString();
};

daemon.removePidFile = function(pidPath){
    var log = logger.getLog();
    if (fs.existsSync(pidPath)){
        log.info('Remove pid file: ' + pidPath);
        fs.unlinkSync(pidPath);
    }
};

daemon.daemonize = function(pidPath, done) {
    var log = logger.getLog();

    // First check to see if we're already running as a daemon
    var pid = daemon.readPidFile(pidPath);
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
            daemon.removePidFile(pidPath);
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
    daemon.writePidFile(pidPath, child.pid);
    console.log("child has been forked, exit.");
    process.exit(0);
};

module.exports = daemon;

