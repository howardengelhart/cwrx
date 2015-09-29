var path      = require('path'),
    fs        = require('fs-extra'),
    cp        = require('child_process'),
    daemon    = require('../../lib/daemon');

describe('daemon', function() {
    var pidPath = path.join(__dirname, 'util.pid');
    afterEach(function(){
        if (fs.existsSync(pidPath)){
            fs.removeSync(pidPath);
        }
    });

    describe('readPidFile', function() {
        it('should read a pid file successfully', function() {
            fs.writeFileSync(pidPath, 999999);
            expect(daemon.readPidFile(pidPath)).toBe('999999');
        });
    });
    
    describe('writePidFile', function() {
        it('should write to a pid file successfully', function() {
            daemon.writePidFile(pidPath, 999999);
            expect(fs.existsSync(pidPath)).toBeTruthy();
            expect(fs.readFileSync(pidPath).toString()).toBe('999999');
        });
    });
    
    describe('removePidFile', function() {
        it('should remove a pid file successfully', function() {
            fs.writeFileSync(pidPath, 999999);
            daemon.removePidFile(pidPath);
            expect(fs.existsSync(pidPath)).toBeFalsy();
        });
    });

    describe('daemonize', function() {
        var done, config, spawn, readPidFile, writePidFile, removePidFile;
            
        beforeEach(function() {
            done = jasmine.createSpy('done');
            readPidFile = spyOn(daemon, 'readPidFile');
            writePidFile = spyOn(daemon, 'writePidFile');
            removePidFile = spyOn(daemon, 'removePidFile');
            spawn = spyOn(cp, 'spawn');
        });
        
        it('should daemonize correctly', function() {
            spyOn(console, 'log');
            spyOn(process, 'exit');
            readPidFile.and.returnValue();
            var fakeChild = {
                pid: 888888,
                unref: jasmine.createSpy('unref')
            };
            spawn.and.returnValue(fakeChild);
            
            daemon.daemonize(pidPath, done);
            expect(readPidFile).toHaveBeenCalledWith(pidPath);
            expect(process.env.RUNNING_AS_DAEMON).toBeTruthy();
            expect(spawn).toHaveBeenCalled();
            var spawnArgs = spawn.calls.all()[0].args;
            expect(spawn.calls.all()[0].args[1]).toEqual(process.argv.slice(1));
            expect(spawn.calls.all()[0].args[2].env).toBe(process.env);
            expect(writePidFile).toHaveBeenCalledWith(pidPath, fakeChild.pid);
            expect(process.exit).toHaveBeenCalledWith(0);
        });
        
        it('should daemonize correctly even if there is an existing pid', function() {
            spyOn(console, 'log');
            spyOn(process, 'kill').and.returnValue();
            spyOn(process, 'exit');
            readPidFile.and.returnValue(999999);
            var fakeChild = {
                pid: 888888,
                unref: jasmine.createSpy('unref')
            };
            spawn.and.returnValue(fakeChild);
            
            daemon.daemonize(pidPath, done);
            expect(readPidFile).toHaveBeenCalledWith(pidPath);
            expect(process.kill).toHaveBeenCalledWith(999999, 0);
            expect(removePidFile).toHaveBeenCalledWith(pidPath);
            expect(process.env.RUNNING_AS_DAEMON).toBeTruthy();
            expect(spawn).toHaveBeenCalled();
            var spawnArgs = spawn.calls.all()[0].args;
            expect(spawn.calls.all()[0].args[1]).toEqual(process.argv.slice(1));
            expect(spawn.calls.all()[0].args[2].env).toBe(process.env);
            expect(writePidFile).toHaveBeenCalledWith(pidPath, fakeChild.pid);
            expect(process.exit).toHaveBeenCalledWith(0);
        });

        it('should fail to daemonize if already running', function() {
            spyOn(console, 'error');
            spyOn(process, 'kill').and.returnValue('this exists');
            readPidFile.and.returnValue(999999);
            
            daemon.daemonize(pidPath, done);
            expect(readPidFile).toHaveBeenCalledWith(pidPath);
            expect(process.kill).toHaveBeenCalledWith(999999, 0);
            expect(done).toHaveBeenCalled();
            expect(spawn).not.toHaveBeenCalled();
        });
    });
});
