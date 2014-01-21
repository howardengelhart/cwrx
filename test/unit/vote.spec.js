var path        = require('path'),
    q           = require('q'),
    sanitize    = require('../sanitize');

describe('vote (UT)',function(){
    
    var vote, state, mockLog, mockLogger, mockFs, processProperties;
    
    beforeEach(function() {
        state = { cmdl : {}, defaultConfig : {}  },
        mockFs = {},
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        mockLogger = {
            createLog   : jasmine.createSpy('create_log').andReturn(mockLog),
            getLog      : jasmine.createSpy('get_log').andReturn(mockLog)
        };

        processProperties = {
            'on'        : process.on,
            'setuid'    : process.setuid,
            'setgid'    : process.setgid,
            'exit'      : process.exit,
            'argv'      : process.argv
        }

        spyOn(process,'on');
        spyOn(process,'exit');
        spyOn(process,'setuid');
        spyOn(process,'setgid');

        vote = sanitize(['../bin/vote'])
                .andConfigure([
                    ['fs-extra'     , mockFs],
                    ['../lib/logger', mockLogger]
                ])
                .andRequire();
    });

    afterEach(function(){
        for (var prop in processProperties){
            process[prop] = processProperties[prop];
        }
    });

    describe('getVersion',function(){
        beforeEach(function(){
            mockFs.existsSync   = jasmine.createSpy('fs.existsSync').andReturn(true);
            mockFs.readFileSync = jasmine.createSpy('fs.readFileSync').andReturn('abc123');
        });

        it('looks for version file with name if passed',function(){
            vote.service.getVersion('test');
            expect(mockFs.existsSync).toHaveBeenCalledWith(
                path.resolve(path.join(__dirname,'../../bin/test.version'))
            );
        });

        it('looks for version file named .version if name not passed',function(){
            vote.service.getVersion();
            expect(mockFs.existsSync).toHaveBeenCalledWith(
                path.resolve(path.join(__dirname,'../../bin/.version'))
            );
        });

        it('returns unknown if the version file does not exist',function(){
            mockFs.existsSync.andReturn(false);
            expect(vote.service.getVersion()).toEqual('unknown');
        });

        it('returns unknown if reading the file results in an exception',function(){
            mockFs.readFileSync.andCallFake(function(){
                throw new Error('test error');
            });
            expect(vote.service.getVersion()).toEqual('unknown');
            expect(mockLog.error.callCount).toEqual(1);
        });
    });

    describe('parseCmdLine',function(){
        var resolveSpy, rejectSpy, argv;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('parseCmdLine.resolve');
            rejectSpy  = jasmine.createSpy('parseCmdLine.reject');
            argv = process.argv;
        });

        afterEach(function(){
            process.argv = argv;
        });

        it('adds proper defaults to state object',function(done){
            process.argv = ['node','test'];
            q.fcall(vote.service.parseCmdLine,state)
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
            q.fcall(vote.service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl.server).toBeTruthy('cmdl.server');
                    expect(state.cmdl.uid).toEqual('test');
                    expect(state.cmdl.showConfig).toBeTruthy('cmdl.showConfig');
                }).done(done);
        });
        
        it('sets uid if uid commandline arg is set',function(done){
            process.argv = ['node','test','--uid=test'];
            q.fcall(vote.service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setuid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
        it('sets gid if gid commandline arg is set',function(done){
            process.argv = ['node','test','--gid=test'];
            q.fcall(vote.service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.setgid).toHaveBeenCalledWith('test');
                }).done(done);
        });
        
    });
    
    describe('configure',function(){
        var resolveSpy, rejectSpy;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('configure.resolve');
            rejectSpy  = jasmine.createSpy('configure.reject');
        });

        it('uses defaults if no config is passed',function(done){
            state.defaultConfig = {
                pidFile : 'abc'
            };
            q.fcall(vote.service.configure,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(state.config.pidFile).toEqual('abc');
                }).done(done);
        });

    });

    describe('handleSignals',function(){
        var resolveSpy, rejectSpy;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('parseCmdLine.resolve');
            rejectSpy  = jasmine.createSpy('parseCmdLine.reject');
        });

        it('does nothing if not running as server',function(done){
            q.fcall(vote.service.handleSignals,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(process.on).not.toHaveBeenCalled();
                }).done(done);
        });

        it('sets up process handlers if in server mode',function(done){
            state.cmdl.server = true;
            q.fcall(vote.service.handleSignals,state)
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



    });


});
