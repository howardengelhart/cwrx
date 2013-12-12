var fs          = require('fs-extra'),
    sanitize    = require('../sanitize'),
    cwrxConfig  = require('../../lib/config');

describe('dub job remover (UT)', function() {

    var dub, mockLog, mockLogger;
    
    beforeEach(function() {
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

        dub = sanitize(['../bin/dub'])
                .andConfigure([['../lib/logger', mockLogger]])
                .andRequire();
    });

    describe('removeJobFiles', function() {
        var maxAge = 10,
            start = new Date().valueOf(),
            jobs, config;
        beforeEach(function() {
            jobs = {
                'caches/jobs/job-1.json': { createTime: start - (maxAge - 2) * 1000 },
                'caches/jobs/job-2.json': { createTime: start - (maxAge + 1) * 1000 },
                'caches/jobs/job-3.json': { createTime: start }
            };
            var configObject = {
                caches: { jobs: 'caches/jobs/' }
            };
            spyOn(cwrxConfig, 'createConfigObject').andReturn(configObject);
            config = dub.createConfiguration({});
            spyOn(fs, 'readdir').andCallFake(function(path, cb) {
                cb(null, ['job-1.json', 'job-2.json', 'job-3.json']);
            });
            spyOn(fs, 'readJson').andCallFake(function(fpath, cb) {
                cb(null, jobs[fpath]);
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
                expect(fs.readJson.calls.length).toBe(3);
                fs.readJson.calls.forEach(function(fcall, ind) {
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
            fs.readJson.andCallFake(function(fpath, cb) {
                if (fpath.match('caches/jobs/job-2.json')) cb('Error!');
                else cb(null, jobs[fpath]);
            });
            dub.removeJobFiles(config, maxAge, function(error) {
                expect(error).not.toBeDefined();
                expect(fs.readJson.calls.length).toBe(3);
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
                expect(fs.readJson).not.toHaveBeenCalled();
                expect(fs.remove).not.toHaveBeenCalled();
                done();
            });
        });
    });
});
