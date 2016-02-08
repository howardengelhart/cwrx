var flush = true;
describe('hostUtils', function() {
    var cp, hostname, os;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        hostUtils   = require('../../lib/hostUtils');
        cp          = require('child_process');
        os          = require('os');
        
    });
    
    describe('getHostname', function() {
        beforeEach(function() {
            spyOn(cp, 'exec');
        });

        it('should spawn a process with the right command', function(done) {
            cp.exec.and.callFake(function(cmd, cb) {
                cb(null, 'fakeHost', null);
            });
            
            hostUtils.getHostname().then(function(host) {
                expect(host).toBe('fakeHost');
                expect(cp.exec).toHaveBeenCalled();
                expect(cp.exec.calls.all()[0].args[0]).toBe('hostname');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should get the fqdn if called with full = true', function(done) {
            cp.exec.and.callFake(function(cmd, cb) {
                cb(null, 'fakeHost.com', null);
            });
            
            hostUtils.getHostname(true).then(function(host) {
                expect(host).toBe('fakeHost.com');
                expect(cp.exec).toHaveBeenCalled();
                expect(cp.exec.calls.all()[0].args[0]).toBe('hostname --fqdn');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should handle failures', function(done) {
            cp.exec.and.callFake(function(cmd, cb) {
                cb(null, null, 'Error!');
            });
            
            hostUtils.getHostname().catch(function(error) {
                expect(error).toBe('Error!');
                expect(cp.exec).toHaveBeenCalled();
                cp.exec.and.callFake(function(cmd, cb) {
                    cb('Different error',null, null);
                });
                return hostUtils.getHostname();
            }).catch(function(error) {
                expect(error).toBe('Different error');
                expect(cp.exec.calls.count()).toBe(2);
                done();
            });
        });
    });
    
    describe('getIp', function() { //TODO
    
    });
});
