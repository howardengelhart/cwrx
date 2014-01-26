var flush = true;
describe('vote.data',function(){
    
    var VoteData, mockLog, resolveSpy, rejectSpy, q, logger, mockDb, mockCursor;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        
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
            findOne     : jasmine.createSpy('mockDb.findOne')
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

        it('defaults syncIval to 10000 ms.',function(){
            var vd = new VoteData({});
            expect(vd._syncIval).toEqual(10000);
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
            var mockData = { id : 'abc' };
            vd._cache['abc'] = {
                lastSync : (new Date()).valueOf(),
                data     :  mockData
            }
            
            vd.getElection('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.findOne).not.toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0])
                        .toEqual(mockData);
                }).done(done);
        });

        it('queries the db if the cached election is old',function(done){
            var mockData = { _id : 'xyz', id : 'abc', foo : 'bar' },
                oldSync = (new Date()).valueOf() - 5000;
            vd._syncIval = 1000;
            vd._cache['abc'] = {
                lastSync : oldSync,
                data     :  mockData
            }
            
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    cb(null,mockData);
                });
            });
            
            vd.getElection('abc')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.findOne).toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0].foo).toEqual('bar');
                    expect(vd._cache['abc'].lastSync - oldSync).toBeGreaterThan(4999);
                    expect(vd._deferred['abc']).not.toBeDefined();
                }).done(done);
        });

        it('fails if the election is not available',function(done){
            mockDb.findOne.andCallFake(function(query,cb){
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
                    expect(vd._deferred['abc']).not.toBeDefined();
                }).done(done);
        });

        it('batches calls while waiting for mongo',function(done){
            var mockData = { _id : 'xyz', id : 'abc', foo : 'bar' };
            mockDb.findOne.andCallFake(function(query,cb){
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
                    expect(mockDb.findOne.callCount).toEqual(1);
                    expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
                    expect(resolveSpy.argsForCall[0][0][0].foo).toEqual('bar');
                    expect(vd._deferred['abc']).not.toBeDefined();
                }).done(done);
        });
    });

    describe('getBallotItem',function(){
        var vd, mockData;

        beforeEach(function(){
            mockData = {
                id: 'r-738c2403d83ddc',
                ballot:   {
                    'rv-22119a8cf9f755' : {
                        question : 'Good, bad or ugly?',
                        returns  : [
                            { response : 'good and plenty', votes    : 100 },
                            { response : 'bad and nasty',   votes    : 200 },
                            { response : 'ugly and fat',    votes    : 300 }
                        ]
                    },
                    'rv-4770a2d7f85ce0' : {
                        question : 'Smelly or not smelly?',
                        returns  : [
                            { response : 'smelly',      votes    : 100 },
                            { response : 'not smelly',  votes    : 200 }
                        ]
                    }
                }
            };
            vd = new VoteData(mockDb);
            vd._cache['r-738c2403d83ddc'] = {
                lastSync : (new Date()).valueOf(),
                data : mockData
            };
            resolveSpy = jasmine.createSpy('getBallotItem.resolve');
            rejectSpy = jasmine.createSpy('getBallotItem.reject');
        });

        it('will fail if getElection fails',function(done){
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    cb(new Error('I have failed.'),null);
                });
            });

            vd.getBallotItem('abc','123')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).not.toHaveBeenCalled();
                    expect(rejectSpy).toHaveBeenCalled();
                    expect(rejectSpy.argsForCall[0][0].message)
                        .toEqual('I have failed.');
                    expect(vd._deferred['abc::123']).not.toBeDefined();
                })
                .done(done);
        });

        it('will fail if passed an invalid id',function(done){
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    cb(null,null);
                });
            });

            vd.getBallotItem('abc','123')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).not.toHaveBeenCalled();
                    expect(rejectSpy).toHaveBeenCalled();
                    expect(rejectSpy.argsForCall[0][0].message)
                        .toEqual('Unable to locate election');
                    expect(vd._deferred['abc::123']).not.toBeDefined();
                })
                .done(done);
        });

        it('will fail if passed an invalid ballot item Id',function(done){
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    cb(null,null);
                });
            });

            vd.getBallotItem('r-738c2403d83ddc','123')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).not.toHaveBeenCalled();
                    expect(rejectSpy).toHaveBeenCalled();
                    expect(rejectSpy.argsForCall[0][0].message)
                        .toEqual('Unable to locate ballot item.');
                    expect(vd._deferred['r-738c2403d83ddc:::123']).not.toBeDefined();
                })
                .done(done);
        });

        it('will return a ballot item from cache if it exists',function(done){
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    mockData._id = 'xxx';
                    cb(null,mockData);
                });
            });

            vd.getBallotItem('r-738c2403d83ddc','rv-22119a8cf9f755')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.findOne).not.toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0].question)
                        .toEqual('Good, bad or ugly?');
                    expect(vd._deferred['r-738c2403d83ddc::rv-22119a8cf9f755'])
                        .not.toBeDefined();
                })
                .done(done);
        });

        it('will return a ballot item from db if not in the cache',function(done){
            vd._cache = {};
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    mockData._id = 'xxx';
                    cb(null,mockData);
                });
            });

            vd.getBallotItem('r-738c2403d83ddc','rv-22119a8cf9f755')
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.findOne).toHaveBeenCalled();
                    expect(resolveSpy.argsForCall[0][0].question)
                        .toEqual('Good, bad or ugly?');
                    expect(vd._deferred['r-738c2403d83ddc::rv-22119a8cf9f755'])
                        .not.toBeDefined();
                })
                .done(done);
        });
        
        it('batches calls while waiting for mongo',function(done){
            vd._cache = {};
            mockDb.findOne.andCallFake(function(query,cb){
                process.nextTick(function(){
                    mockData._id = 'xxx';
                    cb(null,mockData);
                });
            });

            q.all([
                    vd.getBallotItem('r-738c2403d83ddc','rv-22119a8cf9f755') ,
                    vd.getBallotItem('r-738c2403d83ddc','rv-22119a8cf9f755') ,
                    vd.getBallotItem('r-738c2403d83ddc','rv-22119a8cf9f755') 
                 ])
                .then(resolveSpy,rejectSpy)
                .finally(function(){
                    expect(resolveSpy).toHaveBeenCalled();
                    expect(rejectSpy).not.toHaveBeenCalled();
                    expect(mockDb.findOne.callCount).toEqual(1);
                    expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
                    expect(resolveSpy.argsForCall[0][0][0].question)
                        .toEqual('Good, bad or ugly?');
                    expect(vd._deferred['r-738c2403d83ddc::rv-22119a8cf9f755'])
                        .not.toBeDefined();
                }).done(done);
        });
    });
});
