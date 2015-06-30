var flush = true;
describe('JobManager', function() {
    var JobManager, q, logger, mockLog, mockCache, req, res, nextSpy, events, jobMgr;
    
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
        events      = require('events');
        q           = require('q');
        logger      = require('../../lib/logger');
        JobManager  = require('../../lib/jobManager');

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
        res = new events.EventEmitter();
        res.send = jasmine.createSpy('res.send()');
        res.header = jasmine.createSpy('res.header()');
        nextSpy = jasmine.createSpy('next()');

        mockCache = {
            set: jasmine.createSpy('cache.set').andReturn(q()),
            add: jasmine.createSpy('cache.add').andReturn(q()),
            get: jasmine.createSpy('cache.get').andReturn(q())
        };

        jobMgr = new JobManager(mockCache, { enabled: true, timeout: 2000, cacheTTL: 6000, urlPrefix: '/api/job' });
        spyOn(jobMgr, 'sendResponse').andCallThrough();
    });
    
    describe('initialization', function() {
        it('should store the cache and options', function() {
            var opts = { enabled: true, timeout: 2000, cacheTTL: 30*1000, urlPrefix: '/api/test' },
                mgr = new JobManager(mockCache, opts);
                
            expect(mgr.cache).toBe(mockCache);
            expect(mgr.cfg).toEqual({
                enabled: true,
                timeout: 2000,
                cacheTTL: 30*1000,
                urlPrefix: '/api/test'
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should have defaults for the options', function() {
            var mgr = new JobManager(mockCache);
                
            expect(mgr.cache).toBe(mockCache);
            expect(mgr.cfg).toEqual({
                enabled: false,
                timeout: 5000,
                cacheTTL: 60*60*1000,
                urlPrefix: '/job'
            });
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should log a warning if enabled is true but no cache is provided', function() {
            var mgr = new JobManager(undefined, { enabled: true });
                
            expect(mgr.cache).not.toBeDefined();
            expect(mgr.cfg.enabled).toBe(false);
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('sendResponse', function() {
        it('should call res.send with the result', function() {
            jobMgr.sendResponse(res, { code: 200, body: 'ok!' });
            expect(res.send).toHaveBeenCalledWith(200, 'ok!');
            jobMgr.sendResponse(res, { code: 500, body: { error: 'Error!', detail: 'Problems!' } });
            expect(res.send).toHaveBeenCalledWith(500, { error: 'Error!', detail: 'Problems!' });
            expect(res.header).not.toHaveBeenCalled();
        });
        
        it('should call res.send with a 204 if no result is provided', function() {
            jobMgr.sendResponse(res);
            expect(res.send).toHaveBeenCalledWith(204);
            expect(res.header).not.toHaveBeenCalled();
        });
        
        it('should appropriately set headers if defined', function() {
            var headers = { 'cache-control': 0, 'content-range': 'items 1-2/2' };
            jobMgr.sendResponse(res, { code: 200, body: 'ok!', headers: headers });
            expect(res.send).toHaveBeenCalledWith(200, 'ok!');
            expect(res.header).toHaveBeenCalledWith('cache-control', 0);
            expect(res.header).toHaveBeenCalledWith('content-range', 'items 1-2/2');
        });
    });
    
    describe('setJobTimeout', function() {
        it('should do nothing if job timeouts are not enabled', function() {
            jobMgr.cfg.enabled = false;
            jobMgr.setJobTimeout(req, res, nextSpy);
            expect(req._job.timedOut).toBe(false);
            expect(req._job.timeout).not.toBeDefined();
            expect(nextSpy).toHaveBeenCalled();
        });
        
        it('should create a _job object on the req', function() {
            jobMgr.setJobTimeout(req, res, nextSpy);
            expect(req._job.timedOut).toBe(false);
            expect(req._job.timeout).toBeDefined();
            clearTimeout(req._job.timeout);
            expect(nextSpy).toHaveBeenCalled();
        });
        
        describe('timeout function', function() {
            it('should call cache.add and sendResponse', function(done) {
                jobMgr.setJobTimeout(req, res, nextSpy);
                expect(req._job.timedOut).toBe(false);
                expect(nextSpy).toHaveBeenCalled();
                jasmine.Clock.tick(jobMgr.cfg.timeout + 1);
                process.nextTick(function() {
                    expect(req._job.timedOut).toBe(true);
                    expect(mockCache.add).toHaveBeenCalledWith('req:1234', {code: 202, body: {url: '/api/job/1234'}}, jobMgr.cfg.cacheTTL);
                    expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 202, body: {url: '/api/job/1234'}});
                    expect(mockLog.error).not.toHaveBeenCalled();
                    done();
                });
            });
            
            it('should log a warning and set timedOut to false if writing to the cache fails', function(done) {
                mockCache.add.andReturn(q.reject('I GOT A PROBLEM'));
                jobMgr.setJobTimeout(req, res, nextSpy);
                expect(req._job.timedOut).toBe(false);
                expect(nextSpy).toHaveBeenCalled();
                jasmine.Clock.tick(jobMgr.cfg.timeout + 1);
                process.nextTick(function() {
                    expect(req._job.timedOut).toBe(false);
                    expect(mockCache.add).toHaveBeenCalled();
                    expect(jobMgr.sendResponse).not.toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should be canceled whenever a response finishes', function(done) {
                jobMgr.setJobTimeout(req, res, nextSpy);
                expect(req._job.timedOut).toBe(false);
                expect(nextSpy).toHaveBeenCalled();
                res.emit('finish');
                jasmine.Clock.tick(jobMgr.cfg.timeout + 1);
                process.nextTick(function() {
                    expect(req._job.timedOut).toBe(false);
                    expect(mockCache.add).not.toHaveBeenCalled();
                    expect(jobMgr.sendResponse).not.toHaveBeenCalled();
                    done();
                });
            });
        });
    });

    describe('endJob', function() {
        var promiseResult, timeoutObj;
        beforeEach(function() {
            promiseResult = q({code: 200, body: 'all good'}).inspect();
            jobMgr.setJobTimeout(req, res, nextSpy);
        });
        
        it('should do nothing if req timeouts are not enabled', function(done) {
            jobMgr.cfg.enabled = false;
            jasmine.Clock.tick(jobMgr.cfg.timeout + 1000);
            jobMgr.endJob(req, res, promiseResult).then(function() {
                expect(req._job.timedOut).toBe(true);
                expect(mockCache.set).not.toHaveBeenCalled();
                expect(jobMgr.sendResponse.calls.length).toBe(2);
                expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 200, body: 'all good'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just clear the timeout if it has not fired yet', function(done) {
            jasmine.Clock.tick(jobMgr.cfg.timeout - 1000);
            jobMgr.endJob(req, res, promiseResult).then(function() {
                expect(req._job.timedOut).toBe(false);
                expect(mockCache.set).not.toHaveBeenCalled();
                expect(jobMgr.sendResponse.calls.length).toBe(1);
                expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 200, body: 'all good'});
                jasmine.Clock.tick(1000);
                expect(req._job.timedOut).toBe(false);
                expect(mockCache.add).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should write the final result to the cache', function(done) {
            jasmine.Clock.tick(jobMgr.cfg.timeout + 1000);
            expect(mockCache.add).toHaveBeenCalled();
            jobMgr.endJob(req, res, promiseResult).then(function() {
                expect(req._job.timedOut).toBe(true);
                expect(mockCache.set).toHaveBeenCalledWith('req:1234', {code: 200, body: 'all good'}, jobMgr.cfg.cacheTTL);
                expect(jobMgr.sendResponse.calls.length).toBe(1);
                expect(jobMgr.sendResponse).not.toHaveBeenCalledWith(res, {code: 200, body: 'all good'});
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should write a 500 to the cache if the promiseResult was rejected', function(done) {
            promiseResult = q.reject('I GOT A PROBLEM').inspect();
            jasmine.Clock.tick(jobMgr.cfg.timeout + 1000);
            jobMgr.endJob(req, res, promiseResult).then(function() {
                expect(mockCache.set).toHaveBeenCalledWith('req:1234',
                    { code: 500, body: { error: 'Internal Error', detail: '\'I GOT A PROBLEM\'' } },
                    jobMgr.cfg.cacheTTL);
                expect(jobMgr.sendResponse.calls.length).toBe(1);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log an error if cache.set fails', function(done) {
            mockCache.set.andReturn(q.reject('I GOT A PROBLEM'));
            jasmine.Clock.tick(jobMgr.cfg.timeout + 1000);
            jobMgr.endJob(req, res, promiseResult).then(function() {
                expect(mockCache.set).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(jobMgr.sendResponse.calls.length).toBe(1);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('getJobResult', function() {
        it('should get a result from the cache', function(done) {
            mockCache.get.andReturn(q({code: 200, body: 'yes'}));
            jobMgr.getJobResult(req, res, '5678').then(function(resp) {
                expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 200, body: 'yes'});
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should warn and send a 404 if not enabled', function(done) {
            jobMgr.cfg.enabled = false;
            jobMgr.getJobResult(req, res, '5678').then(function(resp) {
                expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 404, body: 'No result with that id found'});
                expect(mockCache.get).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should send a 404 if no result is found', function(done) {
            mockCache.get.andReturn(q());
            jobMgr.getJobResult(req, res, '5678').then(function(resp) {
                expect(jobMgr.sendResponse).toHaveBeenCalledWith(res, {code: 404, body: 'No result with that id found'});
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle cache errors', function(done) {
            mockCache.get.andReturn(q.reject('I GOT A PROBLEM'));
            jobMgr.getJobResult(req, res, '5678').then(function(resp) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Cache error');
                expect(jobMgr.sendResponse).not.toHaveBeenCalled();
                expect(mockCache.get).toHaveBeenCalledWith('req:5678');
                expect(mockLog.error).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).done(done);
        });
    });
});
