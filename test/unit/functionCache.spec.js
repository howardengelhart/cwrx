describe('FunctionCache()', function() {
    var FunctionCache;
    var q;

    beforeEach(function() {
        FunctionCache = require('../../lib/functionCache');
        q = require('q');

        jasmine.clock().install();
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should exist', function() {
        expect(FunctionCache).toEqual(jasmine.any(Function));
        expect(FunctionCache.name).toBe('FunctionCache');
    });

    describe('instance:', function() {
        var config;
        var cache;

        beforeEach(function() {
            config = {
                freshTTL: 15,
                maxTTL: 60,
                errorTTL: 2,
                gcInterval: 120,
                extractor: jasmine.createSpy('extractor()').and.callFake(function(value) { return value; })
            };

            cache = new FunctionCache(config);
        });

        describe('if instantiated with missing parameters', function() {
            var error;

            beforeEach(function() {
                error = new Error('Must provide a freshTTL and maxTTL.');
            });

            it('should throw an Error', function() {
                expect(function() { new FunctionCache(); }).toThrow(error);
                expect(function() { new FunctionCache({}); }).toThrow(error);
                expect(function() { new FunctionCache({ freshTTL: 1 }); }).toThrow(error);
                expect(function() { new FunctionCache({ maxTTL: 1 }); }).toThrow(error);

                expect(function() { new FunctionCache({ maxTTL: 0, freshTTL: 0 }); }).not.toThrow();
            });
        });

        describe('if instantiated without an errorTTL', function() {
            beforeEach(function() {
                delete config.errorTTL;

                cache = new FunctionCache(config);
            });

            it('should make it 10 seconds', function() {
                expect(cache.errorTTL).toBe(10*1000);
            });
        });

        describe('if instantiated without a gcInterval', function() {
            beforeEach(function() {
                delete config.gcInterval;

                cache = new FunctionCache(config);
            });

            it('should make it 15 mins.', function() {
                expect(cache.gcInterval).toBe(15*60*1000);
            });
        });

        describe('if instantiated without an extractor', function() {
            beforeEach(function() {
                delete config.extractor;

                cache = new FunctionCache(config);
            });

            it('should make it an identity function', function() {
                var value = {};

                expect(cache.extractor(value)).toBe(value);
            });
        });

        describe('properties:', function() {
            describe('freshTTL', function() {
                it('should be the supplied freshTTL in ms', function() {
                    expect(cache.freshTTL).toBe(15*60*1000);
                });
            });

            describe('maxTTL', function() {
                it('should be the supplied maxTTL in ms', function() {
                    expect(cache.maxTTL).toBe(60*60*1000);
                });
            });

            describe('errorTTL', function() {
                it('should be the supplied errorTTL in ms', function() {
                    expect(cache.errorTTL).toBe(2*60*1000);
                });
            });

            describe('gcInterval', function() {
                it('should be the supplied gcInterval in ms', function() {
                    expect(cache.gcInterval).toBe(120*60*1000);
                });
            });

            describe('extractor', function() {
                it('should be the supplied extractor', function() {
                    expect(cache.extractor).toBe(config.extractor);
                });
            });
        });

        describe('methods:', function() {
            describe('add(fn, arity)', function() {
                var fn, fnResult;
                var result;

                beforeEach(function() {
                    fnResult = { foo: 'bar', then: true };
                    fn = jasmine.createSpy('fn()').and.returnValue(fnResult);

                    result = cache.add(fn);
                });

                it('should return a function', function() {
                    expect(result).toEqual(jasmine.any(Function));
                    expect(result).not.toBe(fn);
                });

                describe('calling clear() on a returned function', function() {
                    beforeEach(function() {
                        result();
                        fn.calls.reset();

                        result.clear();
                        result();
                    });

                    it('should cause it to call the function again', function() {
                        expect(fn).toHaveBeenCalled();
                    });
                });

                describe('if called with an arity', function() {
                    var arity;

                    describe('that is positive', function() {
                        beforeEach(function() {
                            arity = 2;

                            result = cache.add(fn, arity);
                        });

                        it('should only cache by the first {arity} arguments', function() {
                            result('one', 'two', 'three', 'four');
                            fn.calls.reset();

                            result('one', 'two', 'foo', 'bar');
                            expect(fn).not.toHaveBeenCalled();
                            fn.calls.reset();

                            result('foo', 'bar', 'three', 'four');
                            expect(fn).toHaveBeenCalledWith('foo', 'bar', 'three', 'four');
                        });
                    });

                    describe('that is negative', function() {
                        beforeEach(function() {
                            arity = -1;

                            result = cache.add(fn, arity);
                        });

                        it('should only cache by the first - {arity} arguments', function() {
                            result('one', 'two', 'three', 'four');
                            fn.calls.reset();

                            result('one', 'two', 'three', 'foo');
                            expect(fn).not.toHaveBeenCalled();
                            fn.calls.reset();

                            result('foo', 'bar', 'bleh', 'four');
                            expect(fn).toHaveBeenCalledWith('foo', 'bar', 'bleh', 'four');
                        });
                    });

                    describe('that is 0', function() {
                        beforeEach(function() {
                            arity = 0;

                            result = cache.add(fn, arity);
                        });

                        it('should always return the cached value', function() {
                            result('one', 'two', 'three', 'four');
                            fn.calls.reset();

                            result(1, 2, 3, 4);
                            expect(fn).not.toHaveBeenCalled();
                        });
                    });
                });

                describe('when the result is called and the specified function returns a promise', function() {
                    var deferred;
                    var now;
                    var arg1, arg2;

                    beforeEach(function() {
                        cachedFn = result;

                        deferred = q.defer();
                        fn.and.returnValue(deferred.promise);

                        now = Date.now();
                        jasmine.clock().mockDate(now);

                        arg1 = { foo: 'foo' }; arg2 = { bar: 'bar' };

                        result = cachedFn(arg1, arg2);
                    });

                    it('should return the promise', function() {
                        expect(result).toBe(deferred.promise);
                    });

                    describe('and that promise is rejected', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('I goofed.');
                            deferred.reject(reason);
                            fn.calls.reset();

                            deferred.promise.finally(done);
                        });

                        describe('before the errorTTL is exceeded', function() {
                            beforeEach(function() {
                                jasmine.clock().tick(cache.errorTTL / 2);
                                result = cachedFn(arg1, arg2);
                            });

                            it('should return the rejected promise', function() {
                                expect(result).toBe(deferred.promise);
                            });
                        });

                        describe('after the errorTTL is exceeded', function() {
                            var newDeferred;

                            beforeEach(function() {
                                newDeferred = q.defer();
                                fn.and.returnValue(newDeferred.promise);
                                jasmine.clock().tick(cache.errorTTL + 1);

                                result = cachedFn(arg1, arg2);
                            });

                            it('should call the fn again', function() {
                                expect(fn).toHaveBeenCalledWith(arg1, arg2);
                            });

                            it('should return the new promise', function() {
                                expect(result).toBe(newDeferred.promise);
                            });

                            it('should reset the state so that it is not refreshed after errorTTL expires', function() {
                                fn.calls.reset();
                                fn.and.returnValue(q.defer().promise);
                                jasmine.clock().tick(cache.errorTTL + 1);

                                expect(cachedFn(arg1, arg2)).toBe(newDeferred.promise);
                            });
                        });
                    });

                    describe('and the promise is fulfilled', function() {
                        beforeEach(function(done) {
                            deferred.resolve(fnResult);
                            deferred.promise.finally(done);
                        });

                        describe('after the errorTTL has expired', function() {
                            beforeEach(function() {
                                fn.calls.reset();
                                jasmine.clock().tick(cache.errorTTL + 1);

                                result = cachedFn(arg1, arg2);
                            });

                            it('should not call the function', function() {
                                expect(fn).not.toHaveBeenCalled();
                            });

                            it('should return the cached promise', function() {
                                expect(result).toBe(deferred.promise);
                            });
                        });

                        describe('after the freshTTL has expired', function() {
                            var secondDeferred;
                            var secondResult;

                            beforeEach(function() {
                                secondDeferred = q.defer();
                                cache.maxTTL = Infinity;
                                jasmine.clock().tick(cache.freshTTL + 1);
                                fn.calls.reset();
                                fn.and.returnValue(secondDeferred.promise);

                                secondResult = cachedFn(arg1, arg2);
                            });

                            it('should return the old promise', function() {
                                expect(secondResult).toBe(result);
                            });

                            it('should call the function again', function() {
                                expect(fn).toHaveBeenCalledWith(arg1, arg2);
                            });

                            describe('when the new promise fulfills', function() {
                                beforeEach(function(done) {
                                    secondDeferred.fulfill(true);
                                    secondDeferred.promise.finally(done);
                                });

                                it('should return the new promise', function() {
                                    expect(cachedFn(arg1, arg2)).toBe(secondDeferred.promise);
                                });
                            });
                        });

                        describe('after the maxTTL has expired', function() {
                            var secondDeferred;
                            var secondResult;

                            beforeEach(function() {
                                secondDeferred = q.defer();
                                cache.freshTTL = Infinity;
                                jasmine.clock().tick(cache.maxTTL + 1);
                                fn.calls.reset();
                                fn.and.returnValue(secondDeferred.promise);

                                secondResult = cachedFn(arg1, arg2);
                            });

                            it('should return the new promise', function() {
                                expect(secondResult).toBe(secondDeferred.promise);
                            });
                        });
                    });
                });

                describe('when the result is called', function() {
                    var cachedFn;
                    var now;

                    beforeEach(function() {
                        cachedFn = result;

                        now = Date.now();
                        jasmine.clock().mockDate(now);

                        result = cachedFn('one', 'two', 'three');
                    });

                    it('should call the cached function with the same args and context', function() {
                        expect(fn).toHaveBeenCalledWith('one', 'two', 'three');
                    });

                    it('should return the result of calling extractor with the result of the function', function() {
                        expect(cache.extractor).toHaveBeenCalledWith(fnResult);
                        expect(result).toBe(cache.extractor.calls.mostRecent().returnValue);
                    });

                    describe('and the added function returns a non-object', function() {
                        beforeEach(function() {
                            fn.and.returnValue(null);
                        });

                        it('should work', function() {
                            expect(cachedFn()).toBeNull();
                        });
                    });

                    describe('after the gcInterval is reached', function() {
                        beforeEach(function() {
                            cache.freshTTL = Infinity;
                            cache.maxTTL = cache.gcInterval * 2;
                            jasmine.clock().tick(cache.gcInterval);
                            cachedFn('three', 'two', 'one');
                            fn.calls.reset();
                        });

                        describe('if an entry\'s maxAge has expired', function() {
                            beforeEach(function() {
                                jasmine.clock().tick(cache.gcInterval + 1);
                                cachedFn('one', 'two', 'three');
                            });

                            it('should call the fn', function() {
                                expect(fn).toHaveBeenCalled();
                            });
                        });

                        describe('if an entry\'s maxAge has not expired', function() {
                            beforeEach(function() {
                                cachedFn('three', 'two', 'one');
                            });

                            it('should not call the function', function() {
                                expect(fn).not.toHaveBeenCalled();
                            });
                        });
                    });

                    describe('again with the same arguments', function() {
                        var secondResult;

                        beforeEach(function() {
                            fn.calls.reset();
                            cache.extractor.calls.reset();
                            cache.extractor.and.returnValue({ foo: 'bar' });

                            secondResult = cachedFn('one', 'two', 'three');
                        });

                        it('should not call the function again', function() {
                            expect(fn).not.toHaveBeenCalled();
                        });

                        it('should return the result of calling the extractor with the previous value', function() {
                            expect(cache.extractor).toHaveBeenCalledWith(result);
                            expect(secondResult).toBe(cache.extractor.calls.mostRecent().returnValue);
                        });

                        describe('after the freshTTL has expired', function() {
                            var newResult;

                            beforeEach(function() {
                                newResult = { one: 1 };
                                cache.maxTTL = Infinity;
                                jasmine.clock().tick(cache.freshTTL + 1);
                                fn.calls.reset();
                                fn.and.returnValue(newResult);
                                cache.extractor.and.callFake(function(value) { return value; });

                                secondResult = cachedFn('one', 'two', 'three');
                            });

                            it('should call the function again', function() {
                                expect(fn).toHaveBeenCalledWith('one', 'two', 'three');
                            });

                            it('should return the new result', function() {
                                expect(secondResult).toBe(newResult);
                            });

                            describe('and the refresh has occurred', function() {
                                beforeEach(function() {
                                    fn.calls.reset();

                                    secondResult = cachedFn('one', 'two', 'three');
                                });

                                it('should not call the function', function() {
                                    expect(fn).not.toHaveBeenCalled();
                                });

                                it('should return the new result', function() {
                                    expect(secondResult).toBe(newResult);
                                });
                            });
                        });

                        describe('after the maxTTL has expired', function() {
                            var newResult;

                            beforeEach(function() {
                                newResult = { one: 1 };
                                cache.freshTTL = Infinity;
                                jasmine.clock().tick(cache.maxTTL + 1);
                                fn.calls.reset();
                                fn.and.returnValue(newResult);
                                cache.extractor.and.callFake(function(value) { return value; });

                                secondResult = cachedFn('one', 'two', 'three');
                            });

                            it('should call the function again', function() {
                                expect(fn).toHaveBeenCalledWith('one', 'two', 'three');
                            });

                            it('should return the new result', function() {
                                expect(secondResult).toBe(newResult);
                            });

                            describe('and the refresh has occurred', function() {
                                beforeEach(function() {
                                    fn.calls.reset();

                                    secondResult = cachedFn('one', 'two', 'three');
                                });

                                it('should not call the function', function() {
                                    expect(fn).not.toHaveBeenCalled();
                                });

                                it('should return the new result', function() {
                                    expect(secondResult).toBe(newResult);
                                });
                            });
                        });
                    });

                    describe('again with different arguments', function() {
                        var secondResult;
                        var origFnResult;

                        beforeEach(function() {
                            origFnResult = fnResult;
                            fn.calls.reset();
                            fnResult = { bar: 'foo' };
                            fn.and.returnValue(fnResult);

                            secondResult = cachedFn('one', 'three', 'two');
                        });

                        it('should call the fn again with the new arguments', function() {
                            expect(fn).toHaveBeenCalledWith('one', 'three', 'two');
                        });

                        it('should return the result of the second call', function() {
                            expect(secondResult).toBe(fnResult);
                        });

                        describe('but then with the original arguments', function() {
                            var thirdResult;

                            beforeEach(function() {
                                fn.calls.reset();
                                thirdResult = cachedFn('one', 'two', 'three');
                            });

                            it('should not call the function', function() {
                                expect(fn).not.toHaveBeenCalled();
                            });

                            it('should return the original value', function() {
                                expect(thirdResult).toBe(origFnResult);
                            });
                        });
                    });
                });
            });
        });
    });
});
