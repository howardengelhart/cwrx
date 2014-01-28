var flush = true;
describe('dub job remover (UT)', function() {
    var dub, mockLog, mockLogger, mockHostname,
        fs, path, sanitize, q, cwrxConfig;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        fs          = require('fs-extra');
        path        = require('path');
        sanitize    = require('../sanitize');
        q           = require('q');
        cwrxConfig  = require('../../lib/config');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        mockLogger = {
            createLog: jasmine.createSpy('create_log').andReturn(mockLog),
            getLog : jasmine.createSpy('get_log').andReturn(mockLog)
        };
        mockHostname = jasmine.createSpy('hostname').andReturn(q('fakeHost'));

        dub = sanitize(['../bin/dub'])
                .andConfigure([['../lib/logger', mockLogger], ['../lib/hostname', mockHostname]])
                .andRequire();
    });

    describe('removeJobFiles', function() {
        var maxAge = 10,
            start, jobs, config;
        beforeEach(function() {
            start = new Date().valueOf();
            jobs = {
                'caches/jobs/job-1.json': { createTime: start - (maxAge - 2) * 1000 },
                'caches/jobs/job-2.json': { createTime: start - (maxAge + 1) * 1000 },
                'caches/jobs/job-3.json': { createTime: start }
            };
            config = {
                caches: { jobs: 'caches/jobs/' },
                cacheAddress: function(fname, cache) {
                    return path.join(this.caches[cache],fname);
                }
            };
            spyOn(fs, 'readdir').andCallFake(function(path, cb) {
                cb(null, ['job-1.json', 'job-2.json', 'job-3.json']);
            });
            spyOn(fs, 'stat').andCallFake(function(fpath, cb) {
                cb(null, {mtime: jobs[fpath].createTime});
            });
            spyOn(fs, 'remove').andCallFake(function(fpath, cb) {
                cb();
            });
        });
        
        it('should remove files that are older than a provided max age', function(done) {
            dub.removeJobFiles(config, maxAge, function(error) {
                expect(error).not.toBeDefined();
                expect(fs.readdir).toHaveBeenCalled();
                expect(fs.readdir.calls[0].args[0]).toBe('caches/jobs/');
                expect(fs.stat.calls.length).toBe(3);
                fs.stat.calls.forEach(function(fcall, ind) {
                    expect(fcall.args[0]).toBe(Object.keys(jobs)[ind]);
                });
                expect(fs.remove.calls.length).toBe(1);
                expect(fs.remove.calls[0].args[0]).toBe('caches/jobs/job-2.json');
                done();
            });
        });
        
        it('should handle failures to delete individual files', function(done) {
            fs.remove.andCallFake(function(fpath, cb) {
                if (fpath.match('job-2.json')) cb('Error!');
                else cb();
            });
            dub.removeJobFiles(config, maxAge, function(error) {
                expect(error).not.toBeDefined();
                expect(fs.remove.calls[0].args[0]).toBe('caches/jobs/job-2.json');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls[0].args[1].match('Error!')).toBeTruthy();
                done();
            });
        });
        
        it('should handle failures to read individual files', function(done) {
            fs.stat.andCallFake(function(fpath, cb) {
                if (fpath.match('caches/jobs/job-2.json')) cb('Error!');
                else cb(null, {mtime: jobs[fpath].createTime});
            });
            dub.removeJobFiles(config, maxAge, function(error) {
                expect(error).not.toBeDefined();
                expect(fs.stat.calls.length).toBe(3);
                expect(fs.remove).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls[0].args[1].match('Error!')).toBeTruthy();
                done();
            });
        });
        
        it('should fail if it fails to read the jobs directory', function(done) {
            fs.readdir.andCallFake(function(path, cb) {
                cb('Error!');
            });
            dub.removeJobFiles(config, maxAge, function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls[0].args[0].match('Error!')).toBeTruthy();
                expect(fs.stat).not.toHaveBeenCalled();
                expect(fs.remove).not.toHaveBeenCalled();
                done();
            });
        });
    });
});
