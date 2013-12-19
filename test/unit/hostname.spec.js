var cp        = require('child_process'),
    hostname  = require('../../lib/hostname');

describe('hostname', function() {
    beforeEach(function() {
        spyOn(cp, 'exec');
    });
    
    it('should spawn a process with the right command', function(done) {
        cp.exec.andCallFake(function(cmd, cb) {
            cb(null, 'fakeHost', null);
        });
        
        hostname().then(function(host) {
            expect(host).toBe('fakeHost');
            expect(cp.exec).toHaveBeenCalled();
            expect(cp.exec.calls[0].args[0]).toBe('hostname --fqdn');
            done();
        }).catch(function(error) {
            expect(error).not.toBeDefined();
            done();
        });
    });
    
    it('should handle failures', function(done) {
        cp.exec.andCallFake(function(cmd, cb) {
            cb(null, null, 'Error!');
        });
        
        hostname().catch(function(error) {
            expect(error).toBe('Error!');
            expect(cp.exec).toHaveBeenCalled();
            cp.exec.andCallFake(function(cmd, cb) {
                cb('Different error',null, null);
            });
            return hostname();
        }).catch(function(error) {
            expect(error).toBe('Different error');
            expect(cp.exec.calls.length).toBe(2);
            done();
        });
    });
});
