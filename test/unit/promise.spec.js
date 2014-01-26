
describe('promise',function(){
    var flush = true, promise;
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        promise = require('../../lib/promise');
        jasmine.Clock.useMock();
    });

    afterEach(function(){

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
            
            it('returns deferred if completed but force param is used',function(){
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
            
            it('returns deferred if completedd but force param is used',function(){
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
                    expect(rejectSpy.callCount).toEqual(1);
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
                    expect(resolveSpy.callCount).toEqual(3);
                    expect(resolveSpy.argsForCall[0][0]).toEqual(100);
                    expect(resolveSpy.argsForCall[1][0]).toEqual(100);
                    expect(resolveSpy.argsForCall[2][0]).toEqual(100);
                    done();
                });
            });
            
            it('will resolve all pending promises with id if not passed value',function(done){
                keeper.resolveAll();
                process.nextTick(function(){
                    expect(resolveSpy.callCount).toEqual(3);
                    expect(resolveSpy.argsForCall[0][0]).toEqual('abc');
                    expect(resolveSpy.argsForCall[1][0]).toEqual('def');
                    expect(resolveSpy.argsForCall[2][0]).toEqual('ghi');
                    done();
                });
            });

            it('will not resolve a completed promise',function(done){
                keeper.getDeferred('def').reject({});
                keeper.resolveAll();
                process.nextTick(function(){
                    expect(resolveSpy.callCount).toEqual(2);
                    expect(resolveSpy.argsForCall[0][0]).toEqual('abc');
                    expect(resolveSpy.argsForCall[1][0]).toEqual('ghi');
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
                    expect(rejectSpy.callCount).toEqual(3);
                    expect(rejectSpy.argsForCall[0][0]).toEqual(100);
                    expect(rejectSpy.argsForCall[1][0]).toEqual(100);
                    expect(rejectSpy.argsForCall[2][0]).toEqual(100);
                    done();
                });
            });
            
            it('will reject all pending promises with id if not passed value',function(done){
                keeper.rejectAll();
                process.nextTick(function(){
                    expect(rejectSpy.callCount).toEqual(3);
                    expect(rejectSpy.argsForCall[0][0]).toEqual('abc');
                    expect(rejectSpy.argsForCall[1][0]).toEqual('def');
                    expect(rejectSpy.argsForCall[2][0]).toEqual('ghi');
                    done();
                });
            });

            it('will not reject a completed promise',function(done){
                keeper.getDeferred('def').resolve();
                keeper.rejectAll();
                process.nextTick(function(){
                    expect(rejectSpy.callCount).toEqual(2);
                    expect(rejectSpy.argsForCall[0][0]).toEqual('abc');
                    expect(rejectSpy.argsForCall[1][0]).toEqual('ghi');
                    done();
                });
            });
        });
    });
});
        

