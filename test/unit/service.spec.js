describe('service (UT)',function(){
    
    var vote, state, mockLog, processProperties, resolveSpy, rejectSpy,
        path, q, cluster, fs, logger, daemon;
    
    beforeEach(function() {
        for (var mod in require.cache){
            delete require.cache[mod];
        }
        
        path        = require('path');
        q           = require('q');
        cluster     = require('cluster');
        fs          = require('fs-extra');
        logger      = require('../../lib/logger');
        daemon      = require('../../lib/daemon');
        service     = require('../../lib/service');

        state       = { cmdl : {}, defaultConfig : {}  };
        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };

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

        spyOn(cluster,'on');
        spyOn(cluster,'fork');
        spyOn(cluster,'setupMaster');
    });

    afterEach(function(){
        for (var prop in processProperties){
            process[prop] = processProperties[prop];
        }
    });

    describe('getVersion',function(){
        beforeEach(function(){
            fs.existsSync.andReturn(true);
            fs.readFileSync.andReturn('abc123');
        });

        it('looks for version file with name if passed',function(){
            service.getVersion('test');
            expect(fs.existsSync).toHaveBeenCalledWith('test.version');
        });

        it('looks for version file with name in dir if passed',function(){
            service.getVersion('test','somedir');
            expect(fs.existsSync).toHaveBeenCalledWith('somedir/test.version');
        });

        it('looks for version file named .version if name not passed',function(){
            service.getVersion();
            expect(fs.existsSync).toHaveBeenCalledWith('.version');
        });

        it('returns unknown if the version file does not exist',function(){
            fs.existsSync.andReturn(false);
            expect(service.getVersion()).toEqual('unknown');
        });

        it('returns unknown if reading the file results in an exception',function(){
            fs.readFileSync.andCallFake(function(){
                throw new Error('test error');
            });
            expect(service.getVersion()).toEqual('unknown');
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
        
        it('sets uid if uid commandline arg is set',function(done){
            process.argv = ['node','test','--uid=test'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setuid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
        it('sets gid if gid commandline arg is set',function(done){
            process.argv = ['node','test','--gid=test'];
            q.fcall(service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setgid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
    });
    
    describe('configure',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('configure.resolve');
            rejectSpy  = jasmine.createSpy('configure.reject');
        });

        it('uses defaults if no config is passed',function(done){
            state.defaultConfig = {
                pidFile : 'vote.pid',
                pidDir  : '/opt/sixxy/run/'
            };
            q.fcall(service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(state.config.pidPath).toEqual('/opt/sixxy/run/vote.pid');
                }).done(done);
        });

    });

    describe('handleSignals',function(){
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('parseCmdLine.resolve');
            rejectSpy  = jasmine.createSpy('parseCmdLine.reject');
        });

        it('does nothing if not running as server',function(done){
            q.fcall(service.handleSignals,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.on).not.toHaveBeenCalled();
                }).done(done);
        });

        it('sets up process handlers if in server mode',function(done){
            state.cmdl.server = true;
            q.fcall(service.handleSignals,state)
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
            state.cmdl.daemon = true;
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
            state.config = { pidFile : 'xxx' };
            spyOn(daemon,'daemonize').andCallFake(function(pidFile,cb){
                cb(4,'test error');
            });
            q.fcall(service.daemonize,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(daemon.daemonize).toHaveBeenCalled();
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

        it ('does nothing if state.cmdl.kids < 1',function(done){
            state.cmdl.kids =0 ;
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
            state.cmdl.kids =3 ;
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
            state.cmdl.kids =3 ;
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
