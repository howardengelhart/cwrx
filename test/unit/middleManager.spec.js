var flush = true;
describe('MiddleManager', function() {
    var q, mockLog, logger, MiddleManager, req, svc, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        MiddleManager   = require('../../lib/middleManager');
        logger          = require('../../lib/logger');

        req = {
            uuid: '1234',
            requester: { id: 'u1', permissions: {} },
            user: { id: 'u1', org: 'o1' }
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        
        svc = new MiddleManager();
        spyOn(svc, '_runMiddleware').and.callThrough();
    });

    describe('initialization', function() {
        it('should correctly initialize', function() {
            expect(svc).toEqual(jasmine.any(MiddleManager));
            expect(svc._middleware).toEqual({});
        });
    });
    
    describe('use', function() {
        it('should push the function onto the appropriate middleware array', function() {
            var foo = function() {}, bar = function() {}, baz = function() {};
            svc.use('action1', foo);
            svc.use('action2', bar);
            expect(svc._middleware).toEqual({
                action1: [foo],
                action2: [bar]
            });
            svc.use('action2', baz);
            expect(svc._middleware).toEqual({
                action1: [foo],
                action2: [bar, baz]
            });
        });

        it('should throw an error if passed something thats not a function', function() {
            expect(function() { svc.use('action1', 'foo'); }).toThrow(new Error('Cannot push item of type string onto midware stack'));
            expect(function() { svc.use('action1', { foo: 'bar' }); }).toThrow(new Error('Cannot push item of type object onto midware stack'));
            expect(function() { svc.use('action1'); }).toThrow(new Error('Cannot push item of type undefined onto midware stack'));
        });
    });

    describe('_runMiddleware', function() {
        var mw, req, resolve, reject;
        beforeEach(function() {
            req = 'fakeReq';
            mw = [
                jasmine.createSpy('mw1').and.callFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw2').and.callFake(function(req, next, done) { next(); }),
                jasmine.createSpy('mw3').and.callFake(function(req, next, done) { next(); }),
            ];
            svc._middleware.test = mw;
            resolve = jasmine.createSpy('resolved');
            reject = jasmine.createSpy('rejected');
        });

        it('should call a chain of middleware and then call done', function(done) {
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                mw.forEach(function(mwFunc) { expect(mwFunc).toHaveBeenCalledWith(req, jasmine.any(Function), jasmine.any(Function)); });
                expect(svc._runMiddleware.calls.count()).toBe(4);
                expect(svc._runMiddleware.calls.all()[1].args).toEqual([req, 'test', doneSpy, 1, jasmine.any(Object)]);
                expect(svc._runMiddleware.calls.all()[2].args).toEqual([req, 'test', doneSpy, 2, jasmine.any(Object)]);
                expect(svc._runMiddleware.calls.all()[3].args).toEqual([req, 'test', doneSpy, 3, jasmine.any(Object)]);
                done();
            });
        });

        it('should break out and resolve if one of the middleware funcs calls done', function(done) {
            mw[1].and.callFake(function(req, next, done) { done('a response'); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(2);
                done();
            });
        });

        it('should only allow next to be called once per middleware func', function(done) {
            mw[1].and.callFake(function(req, next, done) { next(); next(); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(4);
                mw.forEach(function(mwFunc) { expect(mwFunc.calls.count()).toBe(1); });
                expect(doneSpy.calls.count()).toBe(1);
                done();
            });
        });

        it('should only allow done to be called once per middleware func', function(done) {
            mw[1].and.callFake(function(req, next, done) { done('a response'); done('poop'); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).toHaveBeenCalledWith('a response');
                expect(resolve.calls.count()).toBe(1);
                expect(reject).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(2);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs rejects', function(done) {
            mw[0].and.callFake(function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith('I GOT A PROBLEM');
                expect(mw[1]).not.toHaveBeenCalled();
                expect(mw[2]).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(1);
                done();
            });
        });

        it('should break out and reject if one of the middleware funcs throws an error', function(done) {
            mw[2].and.callFake(function(req, next, done) { throw new Error('Catch this!'); });
            svc._runMiddleware(req, 'test', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).not.toHaveBeenCalled();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).toHaveBeenCalledWith(new Error('Catch this!'));
                expect(svc._runMiddleware.calls.count()).toBe(3);
                done();
            });
        });

        it('should handle the case where there is no middleware', function(done) {
            svc._runMiddleware(req, 'fake', doneSpy).then(resolve, reject);
            process.nextTick(function() {
                expect(doneSpy).toHaveBeenCalledWith();
                expect(resolve).not.toHaveBeenCalled();
                expect(reject).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(1);
                done();
            });
        });
    });

    describe('runAction', function() {
        var cb;
        beforeEach(function() {
            svc._middleware.foo = [jasmine.createSpy('fakeMidware').and.callFake(function(req, next, done) {
                req.myProp = 'myVal';
                next();
            })];
            cb = jasmine.createSpy('cb').and.callFake(function() {
                return q(req.myProp + ' - updated');
            });
        });

        it('should run a custom middleware stack and then call a callback', function(done) {
            svc.runAction(req, 'foo', cb).then(function(resp) {
                expect(resp).toBe('myVal - updated');
                expect(svc._middleware.foo[0]).toHaveBeenCalledWith(req, jasmine.any(Function), jasmine.any(Function));
                expect(svc._runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should still resolve if there is no middleware for the custom action', function(done) {
            svc.runAction(req, 'bar', cb).then(function(resp) {
                expect(resp).toBe('undefined - updated');
                expect(svc._middleware.foo[0]).not.toHaveBeenCalled();
                expect(svc._runMiddleware.calls.count()).toBe(1);
                expect(cb).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call the callback if a middleware function breaks out early', function(done) {
            svc.use('foo', function(req, next, done) { done({code: 400, body: 'NOPE'}); });
            svc.runAction(req, 'foo', cb).then(function(resp) {
                expect(resp).toEqual({ code: 400, body: 'NOPE' });
                expect(svc._runMiddleware.calls.count()).toBe(2);
                expect(cb).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not call the callback if a middleware function rejects', function(done) {
            svc.use('foo', function(req, next, done) { return q.reject('I GOT A PROBLEM'); });
            svc.runAction(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._runMiddleware.calls.count()).toBe(2);
                expect(cb).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the callback rejects', function(done) {
            cb.and.returnValue(q.reject('I GOT A PROBLEM'));
            svc.runAction(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(svc._runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the callback throws an error', function(done) {
            cb.and.callFake(function() { throw new Error('I GOT A PROBLEM'); });
            svc.runAction(req, 'foo', cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.message).toBe('I GOT A PROBLEM');
                expect(svc._runMiddleware.calls.count()).toBe(2);
                expect(cb).toHaveBeenCalled();
            }).done(done);
        });
    });
});
