var flush = true;
describe('service (UT)',function(){
    
    var vote, state, mockLog, processProperties, resolveSpy, rejectSpy, console_log,
        path, q, cluster, fs, logger, daemon;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        
        path        = require('path');
        q           = require('q');
        cluster     = require('cluster');
        fs          = require('fs-extra');
        logger      = require('../../lib/logger');
        daemon      = require('../../lib/daemon');
        service     = require('../../lib/service');

        state       = { cmdl : {}, defaultConfig : {}, config : {}  };
        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };

        console_log = console.log;
        spyOn(console,'log');

        processProperties = {};
        Object.keys(process).forEach(function(key){
            processProperties[key] = process[key];
        });

        process.env  = {};
        process.argv = [];

        spyOn(process,'on');
        spyOn(process,'exit');
        spyOn(process,'setuid');
        spyOn(process,'setgid');

        spyOn(logger,'createLog').andReturn(mockLog);
        spyOn(logger,'getLog').andReturn(mockLog);

        spyOn(fs,'existsSync');
        spyOn(fs,'readFileSync');
        spyOn(fs,'mkdirsSync');

        spyOn(cluster,'on');
        spyOn(cluster,'fork');
        spyOn(cluster,'setupMaster');
    });

    afterEach(function(){
        for (var prop in processProperties){
            process[prop] = processProperties[prop];
        }
        console.log = console_log;
    });

    describe('getVersion',function(){
        beforeEach(function(){
            fs.existsSync.andReturn(true);
            fs.readFileSync.andReturn('abc123');
        });

        it('looks for version file with name if passed',function(){
            service.getVersion('test');
            expect(fs.existsSync).toHaveBeenCalledWith('test');
        });

        it('looks for version file with name in dir if passed',function(){
            service.getVersion('test','somedir');
            expect(fs.existsSync).toHaveBeenCalledWith('somedir/test');
        });

        it('looks for version file named .version if name not passed',function(){
            service.getVersion();
            expect(fs.existsSync).toHaveBeenCalledWith('.version');
        });

        it('returns undefined if the version file does not exist',function(){
            fs.existsSync.andReturn(false);
            expect(service.getVersion()).not.toBeDefined();
        });

        it('returns undefined if reading the file results in an exception',function(){
            fs.readFileSync.andCallFake(function(){
                throw new Error('test error');
            });
            expect(service.getVersion()).not.toBeDefined();
            expect(mockLog.error.callCount).toEqual(1);
        });
    });

    describe('parseCmdLine',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('parseCmdLine.resolve');
            rejectSpy  = jasmine.createSpy('parseCmdLine.reject');
        });

        it('adds proper defaults to state object',function(done){
            process.argv = ['node','test'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl).toBeDefined(); 
                    expect(state.cmdl.kids).toEqual(0);
                    expect(state.cmdl.port).toEqual(3100);
                    expect(state.cmdl.config).not.toBeDefined('cmdl.config');
                    expect(state.cmdl.daemon).not.toBeDefined('cmdl.daemon');
                    expect(state.cmdl.gid).not.toBeDefined('cmdl.gid');
                    expect(state.cmdl.loglevel).not.toBeDefined('cmdl.loglevel');
                    expect(state.cmdl.server).not.toBeDefined('cmdl.server');
                    expect(state.cmdl.uid).not.toBeDefined('cmdl.uid');
                    expect(state.cmdl.showConfig).not.toBeDefined('cmdl.showConfig');
                })
                .done(done);
        });

        it ('handles command line arguments',function(done){
            process.argv = ['node','test','--server','--uid=test','--show-config'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl.server).toBeTruthy('cmdl.server');
                    expect(state.cmdl.uid).toEqual('test');
                    expect(state.cmdl.showConfig).toBeTruthy('cmdl.showConfig');
                }).done(done);
        });

        it('sets server to true if daemon is true',function(done){
            process.argv = ['node','test','--daemon'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl.daemon).toBeTruthy('cmdl.daemon');
                    expect(state.cmdl.server).toBeTruthy('cmdl.server');
                }).done(done);
        });
        
        it('sets server,daemon to true if kids > 0',function(done){
            process.argv = ['node','test','--kids=3'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl.kids).toEqual(3);
                    expect(state.cmdl.daemon).toBeTruthy('cmdl.daemon');
                    expect(state.cmdl.server).toBeTruthy('cmdl.server');
                }).done(done);
        });
        
    });
    
    describe('configure',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('configure.resolve');
            rejectSpy  = jasmine.createSpy('configure.reject');
        });

        it('uses defaults if no config is passed',function(done){
            process.argv[1] = 'somefile.js';
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(state.config.appName).toEqual('somefile');
                    expect(state.config.appVersion).not.toBeDefined();
                    expect(state.config.pidPath).toEqual('somefile.pid');
                }).done(done);
        });

        it('overrides config with cmdl if set',function(done){
            state.defaultConfig = {
                kids : 2,
                uid  : 'test1',
                gid  : 'test0'
            };
            state.cmdl = {
                kids : 3,
                uid : 'test2',
                daemon : true
            };
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(state.config.kids).toEqual(3);
                    expect(state.config.gid).toEqual('test0');
                    expect(state.config.uid).toEqual('test2');
                    expect(state.config.daemon).toEqual(true);
                }).done(done);
        });

        it('creates cache dirs if caches are configured',function(done){
            state.defaultConfig = {
                caches : {
                    run : '/opt/sixxy/run',
                    log : '/opt/sixxy/log'
                 }
            };

            fs.existsSync.andReturn(false);
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(fs.existsSync.argsForCall[0][0]).toEqual('/opt/sixxy/run');
                    expect(fs.existsSync.argsForCall[1][0]).toEqual('/opt/sixxy/log');
                    expect(fs.mkdirsSync.argsForCall[0][0]).toEqual('/opt/sixxy/run');
                    expect(fs.mkdirsSync.argsForCall[1][0]).toEqual('/opt/sixxy/log');
                }).done(done);
        });

        it('adds cacheAddress method if caches are configured',function(done){
            process.argv[1] = 'somefile';
            state.defaultConfig = {
                caches : {
                    run : '/opt/sixxy/run',
                    log : '/opt/sixxy/log'
                 }
            };

            fs.existsSync.andReturn(false);
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(state.config.cacheAddress('f','run')).toEqual('/opt/sixxy/run/f');
                    expect(state.config.cacheAddress('f','log')).toEqual('/opt/sixxy/log/f');
                    expect(state.config.pidPath).toEqual('/opt/sixxy/run/somefile.pid');
                }).done(done);
        });

        it('will show configuartion and exit if cmdl.showConfig is true',function(done){
            process.argv[1] = 'test';
            state.defaultConfig = {
                kids : 2,
                uid  : 'test1',
                gid  : 'test0',
                caches : {
                    'test' : '/opt/test'
                }
            };
            state.cmdl = {
                kids : 3,
                uid : 'test2',
                daemon : true,
                showConfig : true
            };
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(console.log).toHaveBeenCalled();
                    expect(process.exit).toHaveBeenCalledWith(0);
                }).done(done);
        });
    });

    describe('prepareServer',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('prepareServer.resolve');
            rejectSpy  = jasmine.createSpy('prepareServer.reject');
        });

        it('does nothing if not running as server',function(done){
            q.fcall(service.prepareServer,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.on).not.toHaveBeenCalled();
                }).done(done);
        });

        it('sets up process handlers if in server mode',function(done){
            state.config.server = true;
            q.fcall(service.prepareServer,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.on.callCount).toEqual(3);
                    expect(process.on.argsForCall[0][0]).toEqual('uncaughtException');
                    expect(process.on.argsForCall[1][0]).toEqual('SIGINT');
                    expect(process.on.argsForCall[2][0]).toEqual('SIGTERM');
                }).done(done);
        });
        
        it('sets uid if uid commandline arg is set',function(done){
            state.config.uid = 'test';
            state.config.server = true;
            q.fcall(service.prepareServer,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setuid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
        it('sets gid if gid commandline arg is set',function(done){
            state.config.gid = 'test';
            state.config.server = true;
            q.fcall(service.prepareServer,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setgid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
    });

    describe('daemonize',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('daemonize.resolve');
            rejectSpy  = jasmine.createSpy('daemonize.reject');
        });

        it('does nothing if daemonize not in command line',function(done){
            q.fcall(service.daemonize,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                }).done(done);
        });

        it('does nothing if RUNNING_AS_DAEMON is true',function(done){
            state.config.daemon = true;
            process.env.RUNNING_AS_DAEMON = true;
            q.fcall(service.daemonize,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                }).done(done);
        });

        it('will return an error if daemonization fails',function(done){
            state.cmdl.daemon = true;
            state.defaultConfig = {
                pidFile : 'test.pid',
                caches  : {
                    run : '/opt/sixxy/run',
                 }
            };
            spyOn(daemon,'daemonize').andCallFake(function(pidFile,cb){
                cb(4,'test error');
            });
            q.fcall(service.configure,state)
                .then(service.daemonize)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(daemon.daemonize.argsForCall[0][0]).toEqual('/opt/sixxy/run/test.pid');
                    expect(resolveSpy).not.toHaveBeenCalledWith(state);
                    expect(rejectSpy).toHaveBeenCalled();
                    expect(rejectSpy.argsForCall[0]).toEqual(
                        [{ message: 'test error', code : 4}]
                    );
                }).done(done);
        });
    });

    describe('cluster',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('cluster.resolve');
            rejectSpy  = jasmine.createSpy('cluster.reject');
        });

        it ('does nothing if state.config.kids < 1',function(done){
            state.config.kids =0 ;
            q.fcall(service.cluster,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(cluster.fork).not.toHaveBeenCalled();
                    expect(state.clusterMaster).not.toBeTruthy();
                }).done(done);
        });

        it ('does nothing if cluster.isMaster is false',function(done){
            state.config.kids =3 ;
            cluster.isMaster = false;
            q.fcall(service.cluster,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(cluster.fork).not.toHaveBeenCalled();
                    expect(state.clusterMaster).not.toBeTruthy();
                }).done(done);
        });

        it ('will fork the right number of kids',function(done){
            state.config.kids =3 ;
            cluster.isMaster = true;
            q.fcall(service.cluster,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(cluster.fork.callCount).toEqual(3);
                    expect(state.clusterMaster).toEqual(true);
                }).done(done);
        });
    });
});
