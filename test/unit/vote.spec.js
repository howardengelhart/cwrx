var path        = require('path'),
    q           = require('q'),
    sanitize    = require('../sanitize');

describe('vote (UT)',function(){
    
    var vote, mockLog, mockLogger, mockFs;
    
    beforeEach(function() {
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

        vote = sanitize(['../bin/vote'])
                .andConfigure([
                    ['fs-extra'     , mockFs],
                    ['../lib/logger', mockLogger]
                ])
                .andRequire();
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
        var state, resolveSpy, rejectSpy;
        beforeEach(function(){
            resolveSpy = jasmine.createSpy('parseCmdLine.resolve');
            rejectSpy  = jasmine.createSpy('parseCmdLine.reject');
            state = {};
        });

        it('adds proper defaults to state object',function(done){
            state.argv = ['node','test'];
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
                    done();
                });
        });

        it ('handles command line arguments',function(done){
            state.argv = ['node','test','--server','--uid=test','--show-config'];
            q.fcall(vote.service.parseCmdLine,state)
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(resolveSpy).toHaveBeenCalledWith(state);
                    expect(state.cmdl.server).toBeTruthy('cmdl.server');
                    expect(state.cmdl.uid).toEqual('test');
                    expect(state.cmdl.showConfig).toBeTruthy('cmdl.showConfig');
                    done();
                });
        });

    });



});
