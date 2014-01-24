describe('vote.data (UT)',function(){
    
    var VoteData, mockLog, resolveSpy, rejectSpy, q, logger, mockDb, mockCursor;
    
    beforeEach(function() {
        for (var mod in require.cache){
            delete require.cache[mod];
        }
        
        q           = require('q');
        logger      = require('../../lib/logger');
        VoteData    = require('../../bin/vote').VoteData;

        mockCursor  = {
            limit       : jasmine.createSpy('cursor.limit').andReturn(mockCursor), 
            sort        : jasmine.createSpy('cursor.sort').andReturn(mockCursor),
            rewind      : jasmine.createSpy('cursor.rewind').andReturn(mockCursor),
            nextObject  : jasmine.createSpy('cursor.nextObject'),
            each        : jasmine.createSpy('cursor.each'),
            toArray     : jasmine.createSpy('cursor.toArray')
        };

        mockDb      = {
            find    : jasmine.createSpy('mockDb.find').andReturn(mockCursor)
        };

        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };

        spyOn(logger,'createLog').andReturn(mockLog);
        spyOn(logger,'getLog').andReturn(mockLog);
    });

    describe('initialization',function(){
        it('fails if no db is passed',function(){
            expect(function(){ new VoteData() }).toThrow('A mongo db connection is required.');
        });

        it ('fails if syncIval is < 1000 ms.',function(){
            expect(function(){ new VoteData({}, 1) })
                .toThrow('VoteData syncIval cannot be less than 1000 ms.');
        });

        it ('fails if syncTimeout is < 100 ms.',function(){
            expect(function(){ new VoteData({},5000, 1) })
                .toThrow('VoteData syncTimeout cannot be less than 100 ms.');
        });

        it('defaults syncIval to 10000 ms.',function(){
            var vd = new VoteData({});
            expect(vd._syncIval).toEqual(10000);
        });

        it('defaults syncTimeout to 10000 ms.',function(){
            var vd = new VoteData({});
            expect(vd._syncTimeout).toEqual(2000);
        });

    });

    describe('shouldSync',function(){
        var vd;
        beforeEach(function(){
            vd = new VoteData({});
        });

        it('returns true when _lastSync is null',function(){
            expect(vd.shouldSync(null)).toEqual(true);
        });

        it('returns true when syncIval has expired',function(){
            var lastSync = (new Date()).valueOf() - 2000;
            vd._syncIval = 1000;
            expect(vd.shouldSync(lastSync)).toEqual(true);
        });

        it('returns false when syncIval has not expired',function(){
            var lastSync = (new Date()).valueOf() - 200;
            vd._syncIval = 1000;
            expect(vd.shouldSync(lastSync)).toEqual(false);
        });
    });

    describe('getElection',function(){
        var vd;

        beforeEach(function(){
            vd = new VoteData(mockDb);
            resolveSpy = jasmine.createSpy('getElection.resolve');
            rejectSpy = jasmine.createSpy('getElection.reject');
        });

        it('returns the cached election if lastSync < syncInterval',function(done){
            var mockData = { electionId : 'abc' };
            vd._cache['abc'] = {
                lastSync : (new Date()).valueOf(),
                data     :  mockData
            }
            
            vd.getElection('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.find).not.toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0])
                        .toEqual(mockData);
                }).done(done);
        });

        it('queries the db if the cached election is old',function(done){
            var mockData = { _id : 'xyz', electionId : 'abc', foo : 'bar' },
                oldSync = (new Date()).valueOf() - 5000;
            vd._syncIval = 1000;
            vd._cache['abc'] = {
                lastSync : oldSync,
                data     :  mockData
            }
            
            mockCursor.nextObject.andCallFake(function(cb){
                process.nextTick(function(){
                    cb(null,mockData);
                });
            });
            
            vd.getElection('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.find).toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0].foo).toEqual('bar');
                    expect(vd._cache['abc'].lastSync - oldSync).toBeGreaterThan(4999);
                    expect(vd._defGetElection['abc']).not.toBeDefined();
                }).done(done);
        });

        it('fails if the election is not available',function(done){
            mockCursor.nextObject.andCallFake(function(cb){
                process.nextTick(function(){
                    cb(null,null);
                });
            });

            vd.getElection('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).not.toHaveBeenCalled();
                    expect(rejectSpy).toHaveBeenCalled();
                    expect(rejectSpy.argsForCall[0][0].message)
                        .toEqual('Unable to locate election');
                    expect(vd._defGetElection['abc']).not.toBeDefined();
                }).done(done);
        });

        it('batches calls while waiting for mongo',function(done){
            var mockData = { _id : 'xyz', electionId : 'abc', foo : 'bar' };
            mockCursor.nextObject.andCallFake(function(cb){
                process.nextTick(function(){
                    cb(null,mockData);
                });
            });

            q.all([ vd.getElection('abc'),
                    vd.getElection('abc'), 
                    vd.getElection('abc')])
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.find.callCount).toEqual(1);
                    expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
                    expect(resolveSpy.argsForCall[0][0][0].foo).toEqual('bar');
                    expect(vd._defGetElection['abc']).not.toBeDefined();
                }).done(done);
        });
    });
});
