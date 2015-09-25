describe('promise',function(){
    var flush = true, promise, q;
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        promise = require('../../lib/promise');
        q = require('q');
        jasmine.clock().install();
    });

    afterEach(function(){
        jasmine.clock().uninstall();
    });

    describe('Keeper',function(){

        describe('initialization',function(){

            it('is instantiated with new',function(){
                var k = new promise.Keeper();
                expect(k.constructor.name).toEqual('Keeper');
            });
        });

        describe('defer',function(){
            var keeper;
            beforeEach(function(){
                keeper = new promise.Keeper();
            });

            it('creates a promise if one with id does not exist',function(){
                var p = keeper.defer('abc');
                expect(p.resolve).toBeDefined('p.resolve');
                expect(p.reject).toBeDefined('p.reject');
                expect(p.keeperId).toEqual('abc');
                expect(p.keeperCreateTime instanceof Date).toBeTruthy('keeperCreateTime is Date');
            });

            it('returns existing promise if one with id already exists',function(){
                var p1, p2;
                p1 = keeper.defer('abc');
                p2 = keeper.defer('abc');
                expect(p2).toBe(p1);
            });

            it('creates new promise if existing promise is already rejected/resolved',
                function(){
                var p1, p2;
                p1 = keeper.defer('abc');
                p1.reject({});
                p2 = keeper.defer('abc');
                expect(p2).not.toBe(p1);
            });
        });

        describe('count properties',function(){
            var keeper, resolveSpy, rejectSpy;
            beforeEach(function(){
                keeper = new promise.Keeper();
                resolveSpy = jasmine.createSpy('resolveSpy');
                rejectSpy  = jasmine.createSpy('rejectSpy');
                keeper.defer('abc').promise.done(resolveSpy,rejectSpy);
                keeper.defer('def').promise.done(resolveSpy,rejectSpy);
                keeper.defer('ghi').promise.done(resolveSpy,rejectSpy);
                keeper.defer('jkl').promise.done(resolveSpy,rejectSpy);
                keeper.defer('mno').promise.done(resolveSpy,rejectSpy);
            });

            describe('with five promises, all pending',function(){
                it('has a pendingCount of five',function(){
                    expect(keeper.pendingCount).toEqual(5);
                });

                it('has a completedCount of  zero',function(){
                    expect(keeper.completedCount).toEqual(0);
                });
                
                it('has a fulfilledCount of  zero',function(){
                    expect(keeper.fulfilledCount).toEqual(0);
                });
                
                it('has a rejectedCount of  zero',function(){
                    expect(keeper.rejectedCount).toEqual(0);
                });
            });

            describe('with five promises, 2 resolved, 2 rejected, 1 pending',function(){
                beforeEach(function(){
                    keeper.getDeferred('def').resolve();
                    keeper.getDeferred('ghi').resolve();
                    keeper.getDeferred('jkl').reject({});
                    keeper.getDeferred('mno').reject({});
                });
                it('has a pendingCount of one',function(){
                    expect(keeper.pendingCount).toEqual(1);
                });

                it('has a completedCount of four',function(){
                    expect(keeper.completedCount).toEqual(4);
                });
                
                it('has a fulfilledCount of two',function(){
                    expect(keeper.fulfilledCount).toEqual(2);
                });
                
                it('has a rejectedCount of two',function(){
                    expect(keeper.rejectedCount).toEqual(2);
                });
            });
        });

        describe('getDeferred',function(){
            var keeper, deferred;
            beforeEach(function(){
                keeper = new promise.Keeper();
                deferred = keeper.defer('abc');
            });

            it('returns deferred if exists and not fullfiled',function(){
                expect(keeper.getDeferred('abc')).toBe(deferred);
            });

            it('returns undefined if does not exist',function(){
                expect(keeper.getDeferred('xyz')).not.toBeDefined();
            });

            it('returns undefined if exists but completed',function(){
                deferred.resolve();
                expect(keeper.getDeferred('abc')).not.toBeDefined();
            });
            
            it('returns deferred if completed but includeCompleted param is used',function(){
                deferred.resolve();
                expect(keeper.getDeferred('abc',true)).toBe(deferred);
            });
        });

        describe('remove',function(){
            var keeper, deferred;
            beforeEach(function(){
                keeper = new promise.Keeper();
                deferred = keeper.defer('abc');
            });
            
            it('returns deferred if exists and not fullfiled',function(){
                expect(keeper.remove('abc')).toBe(deferred);
                expect(keeper.getDeferred('abc',true)).not.toBeDefined();
            });

            it('returns undefined if does not exist',function(){
                expect(keeper.remove('xyz')).not.toBeDefined();
                expect(keeper.getDeferred('xyz',true)).not.toBeDefined();
            });

            it('returns undefined if exists but completed',function(){
                deferred.resolve();
                expect(keeper.remove('abc')).not.toBeDefined();
                expect(keeper.getDeferred('abc',true)).not.toBeDefined();
            });
            
            it('returns deferred if completedd but includeCompleted param is used',function(){
                deferred.resolve();
                expect(keeper.remove('abc',true)).toBe(deferred);
                expect(keeper.getDeferred('abc',true)).not.toBeDefined();
            });
        });

        describe('removeCompleted',function(){
            var keeper, resolveSpy, rejectSpy;
            beforeEach(function(){
                keeper = new promise.Keeper();
                resolveSpy = jasmine.createSpy('resolveSpy');
                rejectSpy  = jasmine.createSpy('rejectSpy');
                keeper.defer('abc').promise.done(resolveSpy,rejectSpy);
                keeper.defer('def').promise.done(resolveSpy,rejectSpy);
                keeper.defer('ghi').promise.done(resolveSpy,rejectSpy);
            });

            it('removes completed promises',function(done){
                keeper.defer('abc').reject({}); 
                process.nextTick(function(){
                    expect(rejectSpy.calls.count()).toEqual(1);
                    expect(keeper.getDeferred('abc',true)).toBeDefined();
                    expect(keeper.getDeferred('def',true)).toBeDefined();
                    expect(keeper.getDeferred('ghi',true)).toBeDefined();
                    keeper.removeCompleted();
                    expect(keeper.getDeferred('abc',true)).not.toBeDefined();
                    expect(keeper.getDeferred('def',true)).toBeDefined();
                    expect(keeper.getDeferred('ghi',true)).toBeDefined();
                    done();
                });
            });
        });

        describe('resolveAll',function(){
            var keeper, resolveSpy, rejectSpy;
            beforeEach(function(){
                keeper = new promise.Keeper();
                resolveSpy = jasmine.createSpy('resolveSpy');
                rejectSpy  = jasmine.createSpy('rejectSpy');
                keeper.defer('abc').promise.done(resolveSpy,rejectSpy);
                keeper.defer('def').promise.done(resolveSpy,rejectSpy);
                keeper.defer('ghi').promise.done(resolveSpy,rejectSpy);
            });

            it('will resolve all pending promises with passed value',function(done){
                keeper.resolveAll(100);
                process.nextTick(function(){
                    expect(resolveSpy.calls.count()).toEqual(3);
                    expect(resolveSpy.calls.allArgs()[0][0]).toEqual(100);
                    expect(resolveSpy.calls.allArgs()[1][0]).toEqual(100);
                    expect(resolveSpy.calls.allArgs()[2][0]).toEqual(100);
                    done();
                });
            });
            
            it('will resolve all pending promises with id if not passed value',function(done){
                keeper.resolveAll();
                process.nextTick(function(){
                    expect(resolveSpy.calls.count()).toEqual(3);
                    expect(resolveSpy.calls.allArgs()[0][0]).toEqual('abc');
                    expect(resolveSpy.calls.allArgs()[1][0]).toEqual('def');
                    expect(resolveSpy.calls.allArgs()[2][0]).toEqual('ghi');
                    done();
                });
            });

            it('will not resolve a completed promise',function(done){
                keeper.getDeferred('def').reject({});
                keeper.resolveAll();
                process.nextTick(function(){
                    expect(resolveSpy.calls.count()).toEqual(2);
                    expect(resolveSpy.calls.allArgs()[0][0]).toEqual('abc');
                    expect(resolveSpy.calls.allArgs()[1][0]).toEqual('ghi');
                    done();
                });
            });
        });
        
        describe('rejectAll',function(){
            var keeper, resolveSpy, rejectSpy;
            beforeEach(function(){
                keeper = new promise.Keeper();
                resolveSpy = jasmine.createSpy('resolveSpy');
                rejectSpy  = jasmine.createSpy('rejectSpy');
                keeper.defer('abc').promise.done(resolveSpy,rejectSpy);
                keeper.defer('def').promise.done(resolveSpy,rejectSpy);
                keeper.defer('ghi').promise.done(resolveSpy,rejectSpy);
            });

            it('will reject all pending promises with passed value',function(done){
                keeper.rejectAll(100);
                process.nextTick(function(){
                    expect(rejectSpy.calls.count()).toEqual(3);
                    expect(rejectSpy.calls.allArgs()[0][0]).toEqual(100);
                    expect(rejectSpy.calls.allArgs()[1][0]).toEqual(100);
                    expect(rejectSpy.calls.allArgs()[2][0]).toEqual(100);
                    done();
                });
            });
            
            it('will reject all pending promises with id if not passed value',function(done){
                keeper.rejectAll();
                process.nextTick(function(){
                    expect(rejectSpy.calls.count()).toEqual(3);
                    expect(rejectSpy.calls.allArgs()[0][0]).toEqual('abc');
                    expect(rejectSpy.calls.allArgs()[1][0]).toEqual('def');
                    expect(rejectSpy.calls.allArgs()[2][0]).toEqual('ghi');
                    done();
                });
            });

            it('will not reject a completed promise',function(done){
                keeper.getDeferred('def').resolve();
                keeper.rejectAll();
                process.nextTick(function(){
                    expect(rejectSpy.calls.count()).toEqual(2);
                    expect(rejectSpy.calls.allArgs()[0][0]).toEqual('abc');
                    expect(rejectSpy.calls.allArgs()[1][0]).toEqual('ghi');
                    done();
                });
            });
        });
    });

    describe('Timer(time)', function() {
        var timer;
        var time;

        beforeEach(function() {
            time = 500;
            timer = new promise.Timer(time);
        });

        it('should exist', function() {
            expect(timer).toEqual(jasmine.any(Object));
        });

        describe('properties:', function() {
            describe('expired', function() {
                it('should be false', function() {
                    expect(timer.expired).toBe(false);
                });

                it('should not be settable', function() {
                    expect(function() { timer.expired = true; }).toThrow();
                });
            });
        });

        describe('methods:', function() {
            var WAIT_TIME = 10;

            describe('watch(promise)', function() {
                var deferred;
                var success, failure;
                var result;

                beforeEach(function() {
                    deferred = q.defer();
                    success = jasmine.createSpy('success()');
                    failure = jasmine.createSpy('failure()');

                    jasmine.clock().tick(WAIT_TIME);

                    result = timer.watch(deferred.promise);
                    result.then(success, failure);
                });

                it('should return a new promise', function() {
                    expect(result).toEqual(jasmine.any(q().constructor));
                    expect(result).not.toBe(deferred.promise);
                });

                describe('if the provided promise is fulfilled', function() {
                    var value;

                    beforeEach(function(done) {
                        value = { foo: 'bar' };

                        jasmine.clock().tick(time - WAIT_TIME - 1);
                        deferred.resolve(value);
                        q.allSettled([success, failure]).finally(done);
                    });

                    it('should fulfill the returned promise', function() {
                        expect(success).toHaveBeenCalledWith(value);
                    });
                });

                describe('if the provided promise is rejected', function() {
                    var reason;

                    beforeEach(function(done) {
                        reason = new Error('I suck.');

                        jasmine.clock().tick(time - WAIT_TIME - 1);
                        deferred.reject(reason);
                        q.allSettled([success, failure]).finally(done);
                    });

                    it('should reject the returned promise', function() {
                        expect(failure).toHaveBeenCalledWith(reason);
                    });
                });

                describe('if the timer expires', function() {
                    beforeEach(function(done) {
                        jasmine.clock().tick((time - WAIT_TIME) + 1);
                        deferred.resolve('foo');

                        q.allSettled([success, failure]).finally(done);
                    });

                    it('should set expired to true', function() {
                        expect(timer.expired).toBe(true);
                    });

                    it('should reject the promise with a timeout error', function() {
                        expect(failure).toHaveBeenCalledWith(jasmine.any(Error));
                        var error = failure.calls.mostRecent().args[0];

                        expect(error.message).toBe('Timed out after ' + time + ' ms');
                        expect(error.code).toBe('ETIMEDOUT');
                    });

                    describe('if another promise is watched', function() {
                        beforeEach(function(done) {
                            failure.calls.reset();
                            success.calls.reset();

                            timer.watch(q({})).then(success, failure);
                            q.allSettled([success, failure]).finally(done);
                        });

                        it('should reject the promise', function() {
                            expect(failure).toHaveBeenCalledWith(jasmine.any(Error));

                            var error = failure.calls.mostRecent().args[0];
                            expect(error.message).toBe('Timed out after ' + time + ' ms');
                            expect(error.code).toBe('ETIMEDOUT');
                        });
                    });
                });

                describe('when called with different promises', function() {
                    var deferred1, deferred2, deferred3;
                    var deferreds;
                    var failure1, failure2, failure3;
                    var failures;

                    beforeEach(function() {
                        deferred1 = q.defer();
                        deferred2 = q.defer();
                        deferred3 = q.defer();
                        deferreds = [deferred1, deferred2, deferred3];

                        failure1 = jasmine.createSpy('failure1()');
                        failure2 = jasmine.createSpy('failure2()');
                        failure3 = jasmine.createSpy('failure3()');
                        failures = [failure1, failure2, failure3];

                        time = 100;
                        timer = new promise.Timer(time);

                        failures.forEach(function(spy, index) {
                            var promise = deferreds[index].promise;

                            timer.watch(promise).catch(spy);
                        });
                    });

                    describe('and the timer expires', function() {
                        beforeEach(function(done) {
                            jasmine.clock().tick(time + 1);
                            q().then(function() {}).then(done);
                        });

                        it('should reject all the promises', function() {
                            failures.forEach(function(spy) {
                                expect(spy).toHaveBeenCalledWith(jasmine.any(Error));
                            });
                        });

                        it('should clean up references to the deferreds', function() {
                            expect(timer.__private__.deferreds.length).toBe(0);
                        });
                    });

                    describe('and a promise fulfills', function() {
                        var firstDeferred;

                        beforeEach(function(done) {
                            firstDeferred = timer.__private__.deferreds[0];
                            deferred1.resolve({});

                            q().then(function() {}).then(done);
                        });

                        it('should remove the reference to that promise\'s deferred', function() {
                            expect(timer.__private__.deferreds.length).toBe(2);
                            expect(timer.__private__.deferreds).not.toContain(firstDeferred);
                        });
                    });

                    describe('and a promise rejects', function() {
                        var secondDeferred;

                        beforeEach(function(done) {
                            secondDeferred = timer.__private__.deferreds[1];
                            deferred2.reject(new Error());

                            q().then(function() {}).then(done);
                        });

                        it('should remove the reference to that promise\'s deferred', function() {
                            expect(timer.__private__.deferreds.length).toBe(2);
                            expect(timer.__private__.deferreds).not.toContain(secondDeferred);
                        });
                    });
                });
            });

            describe('wrap(fn)', function() {
                var fn;
                var result;

                beforeEach(function() {
                    fn = jasmine.createSpy('fn()');

                    result = timer.wrap(fn);
                });

                it('should return a function', function() {
                    expect(result).toEqual(jasmine.any(Function));
                });

                describe('when the returned function is called', function() {
                    var arg;
                    var watchPromise;
                    var fnResult;

                    beforeEach(function() {
                        arg = { foo: 'bar' };
                        watchPromise = q.defer().promise;

                        spyOn(timer, 'watch').and.returnValue(watchPromise);
                    });

                    describe('if fn() returns a promise', function() {
                        var value;
                        var promise;

                        beforeEach(function(done) {
                            value = { val: 'hello' };
                            promise = q(value);
                            fn.and.returnValue(promise);

                            fnResult = result(arg);
                            q().then(done);
                        });

                        it('should call the provided fn with the supplied args', function() {
                            expect(fn).toHaveBeenCalledWith(arg);
                        });

                        it('should watch() the returned promise', function(done) {
                            expect(timer.watch).toHaveBeenCalledWith(jasmine.any(q().constructor));

                            q.all([promise, timer.watch.calls.mostRecent().args[0]]).then(function(vals) {
                                expect(vals[0]).toBe(vals[1]);
                            }).done(done);
                        });

                        it('should return the promise returned by watch()', function() {
                            expect(fnResult).toBe(watchPromise);
                        });
                    });

                    describe('if fn() does not return a promise', function() {
                        var value;

                        beforeEach(function(done) {
                            value = { value: 'value' };
                            fn.and.returnValue(value);

                            fnResult = result(arg);
                            q().then(done);
                        });

                        it('should call the provided fn with the supplied args', function() {
                            expect(fn).toHaveBeenCalledWith(arg);
                        });

                        it('should watch() a promise that fulfills with the return value', function(done) {
                            expect(timer.watch).toHaveBeenCalledWith(jasmine.any(q().constructor));

                            timer.watch.calls.mostRecent().args[0].then(function(val) {
                                expect(val).toBe(value);
                            }).done(done);
                        });

                        it('should return the promise returned by watch()', function() {
                            expect(fnResult).toBe(watchPromise);
                        });
                    });
                });
            });
        });
    });
});
        

