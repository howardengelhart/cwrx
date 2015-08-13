var fs          = require('fs-extra'),
    path        = require('path'),
    spawn       = require('child_process').spawn,
    filewatcher = require('filewatcher');

var watches = {}, config = {
    minWatchIval    : 1000,
    minRestartIval  : 5000,
    dirs : [
        '/vagrant/bin',
        '/vagrant/lib'
    ]
}, lastRestart = 0, restartTimer;

if (process.getuid() !== 0){
    console.log('I need to be run with sudo!');
    process.exit(1);
}

process.title = 'watchit';

process.argv.forEach(function(val,index){
    if (index < 2) {
        return;
    }
    if (!config.services){
        config.services = [];
    }
    config.services.push(val.split(','));
});

if (!config.services){
    console.log('Need to specify at least one service!');
    process.exit(1);
}

console.log('\nWatching changes to sources for service(s): ', config.services.join(','));

function setupWatch(dir,watchCache,fn){
    console.log('\nSetup watch over: ',dir);
    var watchData = watchCache[dir];

    if (watchData) {
        if (watchData.dw) {
            watchData.dw.removeAll();
            watchData.dw = null;
        }
        
        if (watchData.fw) {
            watchData.fw.removeAll();
            watchData.fw = null;
        }

        watchData.files = null;
    }

    watchData = {
        dir   : dir,
        files : fs.readdirSync(dir).map(function(f){ return path.join(dir,f); }),
        dw    : filewatcher({
            forcePolling : true,
            debounce     : config.minWatchIval,
            interval     : config.minWatchIval,
            persistent   : true
        }),
        fw    : filewatcher({
            forcePolling : true,
            debounce     : config.minWatchIval,
            interval     : config.minWatchIval,
            persistent   : true
        })
    };

    watchData.dw.add(dir);
    watchData.files.forEach(function(f){
        console.log('+', f);
        watchData.fw.add(f);
    });

    watchData.dw.on('change', function(){
        console.log('Directory changed: ',dir);
        process.nextTick(function(){
            setupWatch(dir);
        });
    });

    watchData.fw.on('change', function(file, stat){
        process.nextTick(function(){
            fn(file,stat,watchData);
        });
    });

    return watchCache[dir] = watchData;
}

function restartService(service){
    console.log('Restart ',service);
    var svc  = spawn('sudo', ['service',service,'restart']);
    svc.stdout.on('data', function(data){
        console.log(service + ':' + data.toString());
    });
    svc.stderr.on('data', function(data){
        console.log(service + ':' + data.toString());
    });
    svc.on('error', function(err){
        console.log(service + ':' + err.message);
    });
    svc.on('close', function(code){
        console.log('Restart of service [' + service + '] exited with: ' + code);
    });

}

function restartServices(services){
    if (restartTimer) {
        console.log('Restart is pending..');
        return;
    }
    var now = Date.now();
    if (now - lastRestart > config.minRestartIval){
        lastRestart = now;
        services.forEach(function(service){
            restartService(service);
        });
        return;
    }

    console.log('Will restart in ', (now - lastRestart), ' ms.');
    return restartTimer = setTimeout(function(){
        restartTimer = null; 
        lastRestart = now;
        services.forEach(function(service){
            restartService(service);
        });
    },now - lastRestart);
}

function copyFileToService(file,service){
    var target =  '/opt/sixxy/install/' + service + '/current' + file.replace('/vagrant',''),
        stats = fs.statSync(target);
    try {
        fs.copySync(file,target);
        fs.chmodSync(target,stats.mode);
        fs.chownSync(target,stats.uid,stats.gid);
    }catch(e){
        console.log('Failed to copy ', file, ' to ', target, ': ' + e.message);
        process.exit(1);
    }
    console.log('Copied ',file,' to ',target);
}

function getServices() {
    return Array.prototype.concat(
        config.services || [], 
        config.servicePath ? fs.readdirSync(config.servicePath) : []
    );
}

function handleFileChange(file,stat,watchData){
    console.log('File changed: ',file);
    var services = getServices();
    services.forEach(function(service){
        copyFileToService(file,service);
    });
    restartServices(services);
}

config.dirs.forEach(function(d){
    setupWatch(d,watches,handleFileChange);
});

console.log('\n\nWaiting for things to change...');
