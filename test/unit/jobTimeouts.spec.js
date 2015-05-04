var flush = true;
describe('jobTimeouts', function() {
    var jobTimeouts, q, logger, mockLog, mockCache, jobCfg, req, res;
    
    beforeEach(function() {
        jasmine.Clock.useMock();
        // clearTimeout/clearInterval not properly mocked in jasmine-node: https://github.com/mhevery/jasmine-node/issues/276
        spyOn(global, 'clearTimeout').andCallFake(function() {
            return jasmine.Clock.installed.clearTimeout.apply(this, arguments);
        });
        spyOn(global, 'clearInterval').andCallFake(function() {
            return jasmine.Clock.installed.clearInterval.apply(this, arguments);
        });

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        logger      = require('../../lib/logger');
        jobTimeouts = require('../../lib/jobTimeouts');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);

        req = { uuid: '1234' };
        res = { send: jasmine.createSpy('res.send()') };

        mockCache = {
            set: jasmine.createSpy('cache.set').andReturn(q()),
            add: jasmine.createSpy('cache.add').andReturn(q()),
            get: jasmine.createSpy('cache.get').andReturn(q())
        };

        jobCfg = { enabled: true, timeout: 5000, cacheTTL: 6000, urlPrefix: '/api/job' };
    });
    
    describe('setReqTimeout', function() {
        it('should do nothing if job timeouts are not enabled', function() {
            jobCfg.enabled = false;
            var timeoutObj = jobTimeouts.setJobTimeout(mockCache, jobCfg, req, res);
            expect(timeoutObj.timedOut).toBe(false);
            expect(timeoutObj.timeout).not.toBeDefined();
        });
        
        it('should create and return a timeout object', function() {
            var timeoutObj = jobTimeouts.setJobTimeout(mockCache, jobCfg, req, res);
            expect(timeoutObj.timedOut).toBe(false);
            expect(timeoutObj.timeout).toBeDefined();
            clearTimeout(timeoutObj.timeout);
        });
        
        describe('timeout function', function() {
            it('should call cache.add and res.send', function(done) {
                var timeoutObj = jobTimeouts.setJobTimeout(mockCache, jobCfg, req, res);
                expect(timeoutObj.timedOut).toBe(false);
                jasmine.Clock.tick(jobCfg.timeout + 1);
                process.nextTick(function() {
                    expect(timeoutObj.timedOut).toBe(true);
                    expect(mockCache.add).toHaveBeenCalledWith('req:1234', {code: 202, body: {url: '/api/job/1234'}}, jobCfg.cacheTTL);
                    expect(res.send).toHaveBeenCalledWith(202, {url: '/api/job/1234'});
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
            
            it('should just log an error if writing to the cache fails', function(done) {
                mockCache.add.andReturn(q.reject('I GOT A PROBLEM'));
                var timeoutObj = jobTimeouts.setJobTimeout(mockCache, jobCfg, req, res);
                expect(timeoutObj.timedOut).toBe(false);
                jasmine.Clock.tick(jobCfg.timeout + 1);
                process.nextTick(function() {
                    expect(timeoutObj.timedOut).toBe(true);
                    expect(mockCache.add).toHaveBeenCalled();
                    expect(res.send).not.toHaveBeenCalled();
                    expect(mockLog.error).toHaveBeenCalled();
                    done();
                });
            });
        });
    });

    describe('checkReqTimeout', function() {
        var promiseResult, timeoutObj;
        beforeEach(function() {
            jobCfg.enabled = true;
            promiseResult = q({code: 200, body: 'all good'}).inspect();
            timeoutObj = jobTimeouts.setJobTimeout(mockCache, jobCfg, req, res);
        });
        
        it('should do nothing if req timeouts are not enabled', function(done) {
            jobCfg.enabled = false;
            jasmine.Clock.tick(jobCfg.timeout + 1000);
            jobTimeouts.checkJobTimeout(mockCache, jobCfg, req, promiseResult, timeoutObj).then(function() {
                expect(timeoutObj.timedOut).toBe(true);
                expect(mockCache.set).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just clear the timeout if it has not fired yet', function(done) {
            jasmine.Clock.tick(jobCfg.timeout - 1000);
            jobTimeouts.checkJobTimeout(mockCache, jobCfg, req, promiseResult, timeoutObj).then(function() {
                expect(timeoutObj.timedOut).toBe(false);
                expect(mockCache.set).not.toHaveBeenCalled();
                jasmine.Clock.tick(1000);
                expect(timeoutObj.timedOut).toBe(false);
                expect(mockCache.add).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should write the final result to the cache', function(done) {
            jasmine.Clock.tick(jobCfg.timeout + 1000);
            expect(mockCache.add).toHaveBeenCalled();
            jobTimeouts.checkJobTimeout(mockCache, jobCfg, req, promiseResult, timeoutObj).then(function() {
                expect(timeoutObj.timedOut).toBe(true);
                expect(mockCache.set).toHaveBeenCalledWith('req:1234', {code: 200, body: 'all good'}, jobCfg.cacheTTL);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should write a 500 to the cache if the promiseResult was rejected', function(done) {
            promiseResult = q.reject('I GOT A PROBLEM').inspect();
            jasmine.Clock.tick(jobCfg.timeout + 1000);
            jobTimeouts.checkJobTimeout(mockCache, jobCfg, req, promiseResult, timeoutObj).then(function() {
                expect(mockCache.set).toHaveBeenCalledWith('req:1234',
                    { code: 500, body: { error: 'Internal Error', detail: '\'I GOT A PROBLEM\'' } },
                    jobCfg.cacheTTL);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log an error if cache.set fails', function(done) {
            mockCache.set.andReturn(q.reject('I GOT A PROBLEM'));
            jasmine.Clock.tick(jobCfg.timeout + 1000);
            jobTimeouts.checkJobTimeout(mockCache, jobCfg, req, promiseResult, timeoutObj).then(function() {
                expect(mockCache.set).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('getJobResult', function() {
        it('should get a result from the cache', function(done) {
            mockCache.get.andReturn(q({code: 200, body: 'yes'}));
            jobTimeouts.getJobResult(mockCache, req, '5678').then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'yes'});
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and send a 404 if a cache is not provided', function(done) {
            jobTimeouts.getJobResult(null, req, '5678').then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'No result with that id found'});
                expect(mockCache.get).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should send a 404 if no result is found', function(done) {
            mockCache.get.andReturn(q());
            jobTimeouts.getJobResult(mockCache, req, '5678').then(function(resp) {
                expect(resp).toEqual({code: 404, body: 'No result with that id found'});
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle cache errors', function(done) {
            mockCache.get.andReturn(q.reject('I GOT A PROBLEM'));
            jobTimeouts.getJobResult(mockCache, req, '5678').then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Cache error');
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).done(done);
        });
    });
});

