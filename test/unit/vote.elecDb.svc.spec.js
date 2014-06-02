describe('vote.elecDb (UT)',function(){
    var ElectionDb, VotingBooth, mockLog, resolveSpy, rejectSpy, q, logger, app, enums, Status,
        mongoUtils, mockDb, mockData, mockCursor, flush = true;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();
        
        q           = require('q');
        logger      = require('../../lib/logger');
        ElectionDb    = require('../../bin/vote').ElectionDb;
        VotingBooth   = require('../../bin/vote').VotingBooth;
        app           = require('../../bin/vote').app;
        mongoUtils    = require('../../lib/mongoUtils');
        enums         = require('../../lib/enums');
        Status        = enums.Status;

        mockCursor  = {
            limit       : jasmine.createSpy('cursor.limit').andReturn(mockCursor), 
            sort        : jasmine.createSpy('cursor.sort').andReturn(mockCursor),
            rewind      : jasmine.createSpy('cursor.rewind').andReturn(mockCursor),
            nextObject  : jasmine.createSpy('cursor.nextObject'),
            each        : jasmine.createSpy('cursor.each'),
            toArray     : jasmine.createSpy('cursor.toArray')
        };

        mockDb      = {
            findOne         : jasmine.createSpy('mockDb.findOne'),
            findAndModify   : jasmine.createSpy('mockDb.findAndModify')
        };

        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        
        mockData = {
            id: 'el-abc',
            status: Status.Active,
            ballot:   {
                'item-1' : {
                    'good and plenty'  : 100 ,
                    'bad and nasty'    : 200 ,
                    'ugly and fat'     : 300 
                },
                'item-2' : {
                    'smelly'     : 100,
                    'not smelly' : 200 
                }
            }
        };

        spyOn(logger,'createLog').andReturn(mockLog);
        spyOn(logger,'getLog').andReturn(mockLog);
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
    });

    describe('ElectionDb',function(){

        describe('initialization',function(){
            it('fails if no db is passed',function(){
                expect(function(){ new ElectionDb() }).toThrow('A mongo db connection is required.');
            });

            it ('fails if syncIval is < 1000 ms.',function(){
                expect(function(){ new ElectionDb({}, 1) })
                    .toThrow('ElectionDb syncIval cannot be less than 1000 ms.');
            });

            it('defaults syncIval to 10000 ms.',function(){
                var elDb = new ElectionDb({});
                expect(elDb._syncIval).toEqual(10000);
            });

        });

        describe('shouldSync',function(){
            var elDb;
            beforeEach(function(){
                elDb = new ElectionDb({});
            });

            it('returns true when _lastSync is null',function(){
                expect(elDb.shouldSync(null)).toEqual(true);
            });

            it('returns true when syncIval has expired',function(){
                var lastSync = new Date((new Date()).valueOf() - 2000);
                elDb._syncIval = 1000;
                expect(elDb.shouldSync(lastSync)).toEqual(true);
            });

            it('returns false when syncIval has not expired',function(){
                var lastSync = new Date((new Date()).valueOf() - 1000);
                elDb._syncIval = 3000;
                expect(elDb.shouldSync(lastSync)).toEqual(false);
            });
            
            it('does not round dates to seconds when syncIval < 30 seconds',function(){
                var lastSync = new Date((new Date()).valueOf() - 29500);
                elDb._syncIval = 30000;
                expect(elDb.shouldSync(lastSync)).toEqual(false);
            });

            it('rounds dates to seconds when syncIval > 60 seconds',function(){
                var lastSync = new Date((new Date()).valueOf() - 59500);
                elDb._syncIval = 60000;
                expect(elDb.shouldSync(lastSync)).toEqual(true);
            });
        });

        describe('getElection',function(){
            var elDb;

            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                resolveSpy = jasmine.createSpy('getElection.resolve');
                rejectSpy = jasmine.createSpy('getElection.reject');
            });

            it('returns the cached election if lastSync < syncInterval',function(done){
                mockData = { id : 'abc', status: Status.Active };
                elDb._cache['abc'] = {
                    lastSync : new Date(),
                    data     :  mockData
                }
                
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).not.toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0][0]).toEqual(mockData);
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('queries the db if the user is defined',function(done){
                var now = new Date(new Date() - 1000), user = { id: 'u-1', email: 'otter' };
                mockData = { _id : 'xyz', id : 'abc', status: Status.Active, foo : 'bar' };
                elDb._cache['abc'] = {
                    lastSync : now,
                    data     : mockData
                }
                
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });
                
                elDb.getElection('abc', null, user)
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0][0].foo).toEqual('bar');
                        expect(elDb._cache['abc'].lastSync).toBeGreaterThan(now);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('queries the db if the cached election is old',function(done){
                var oldSync = new Date((new Date()).valueOf() - 5000);
                mockData = { _id : 'xyz', id : 'abc', status: Status.Active, foo : 'bar' };
                elDb._syncIval = 1000;
                elDb._cache['abc'] = {
                    lastSync : oldSync,
                    data     : mockData
                };
                
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });
                
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0][0].foo).toEqual('bar');
                        expect(elDb._cache['abc'].lastSync - oldSync).toBeGreaterThan(4999);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('queries the db if the election is not in the cache',function(done){
                mockData = { _id : 'xyz', id : 'abc', status: Status.Active, foo : 'bar' };
                elDb._syncIval = 1000;
                elDb._cache['abc'] = {};
                
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });
                
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0][0].foo).toEqual('bar');
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('queries the db if the election is in the cache but has no data',function(done){
                elDb._syncIval = 1000;
                elDb._cache['el-abc'] = {
                    lastSync : new Date(),
                    data     : null,
                    votingBooth : new VotingBooth('el-abc')
                };
                elDb._cache['el-abc'].votingBooth._items = {
                    'item-1' : {
                        'bad and nasty'    : 20 ,
                        'ugly and fat'     : 30 
                    }
                };
                
                mockDb.findAndModify.andCallFake(function(query,sort,update,options,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });
                
                elDb.getElection('el-abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0]).toEqual([mockData]);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(elDb._cache['el-abc']).toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('clears the election from cache if has votes, but cannot find the election',function(done){
                elDb._syncIval = 1000;
                elDb._cache['el-abc'] = {
                    lastSync : new Date(),
                    data     : null,
                    votingBooth : new VotingBooth('el-abc')
                };
                elDb._cache['el-abc'].votingBooth._items = {
                    'item-1' : {
                        'bad and nasty'    : 20 ,
                        'ugly and fat'     : 30 
                    }
                };
                
                mockDb.findAndModify.andCallFake(function(query,sort,update,options,cb){
                    process.nextTick(function(){
                        cb(null,null);
                    });
                });
                
                elDb.getElection('el-abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockLog.warn).toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalled();
                        expect(elDb._cache['el-abc']).not.toBeDefined();
                    }).done(done);
            });

            it('updates db with votes and queries for new if election has votes',function(done){
                var oldSync = new Date ((new Date()).valueOf() - 5000), election;
                election = {
                    lastSync : oldSync,
                    data     :  mockData,
                    votingBooth : new VotingBooth('el-abc')
                };
                election.votingBooth._items = {
                    'item-1' : {
                        'bad and nasty'    : 20 ,
                        'ugly and fat'     : 30 
                    }
                };
                elDb._syncIval = 1000;
                elDb._cache['el-abc'] = election;
                
                mockDb.findAndModify.andCallFake(function(query,sort,update,options,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });
                
                elDb.getElection('el-abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalled();
                        expect(election.votingBooth._items).toEqual({});
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });
            
            it('returns nothing if the election is not available',function(done){
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,null);
                    });
                });

                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockLog.warn).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                    }).done(done);
            });

            it('fails with timeout if passed timeout parameter',function(done){
                mockDb.findOne.andCallFake(function(query,cb){ });
                elDb.getElection('abc',1000)
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalled();
                        expect(rejectSpy.argsForCall[0][0].message)
                            .toEqual('Timed out after 1000 ms');
                        expect(elDb._keeper.getDeferred('abc')).toBeDefined();
                    }).done(done);
                jasmine.Clock.tick(1500);
            });

            it('batches calls while waiting for mongo',function(done){
                mockData = { _id : 'xyz', id : 'abc', status: Status.Active, foo : 'bar' };
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });

                q.all([ elDb.getElection('abc'),
                        elDb.getElection('abc'), 
                        elDb.getElection('abc')])
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne.callCount).toEqual(1);
                        expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
                        expect(resolveSpy.argsForCall[0][0][0].foo).toEqual('bar');
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });
            
            it('does not return elections the user is not allowed to see', function(done) {
                spyOn(app, 'checkScope').andCallFake(function(user, election, verb) {
                    return !!user;
                });
                spyOn(elDb._keeper, 'getDeferred').andCallThrough();
                mockData.status = Status.Inactive;
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });

                q.all([ elDb.getElection('abc'),
                        elDb.getElection('abc', null, 'fakeUser')])
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne.callCount).toEqual(1);
                        expect(app.checkScope.callCount).toEqual(2);
                        expect(app.checkScope.argsForCall[0][0]).not.toBeDefined();
                        expect(app.checkScope.argsForCall[1][0]).toBe('fakeUser');
                        expect(resolveSpy.argsForCall[0][0].length).toEqual(2);
                        expect(resolveSpy.argsForCall[0][0][0]).not.toBeDefined()
                        expect(resolveSpy.argsForCall[0][0][1]).toBeDefined()
                        expect(resolveSpy.argsForCall[0][0][1].status).toBe(Status.Inactive);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(elDb._cache['abc']).toBeDefined();
                        expect(elDb._cache['abc'].data.status).toBe(Status.Inactive);
                    }).done(done);
            });
            
            it('does not show any deleted experiences', function(done) {
                spyOn(app, 'checkScope').andReturn(true);
                mockData.status = Status.Deleted;
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,mockData);
                    });
                });

                elDb.getElection('abc', null, 'fakeUser')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne.callCount).toEqual(1);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(elDb._cache['abc']).toBeDefined();
                        expect(elDb._cache['abc'].data.status).toBe(Status.Deleted);
                    }).done(done);
            });
        });

        describe('recordVote',function(){
            var elDb;

            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                elDb._cache['el-abc'] = {
                    lastSync    : null,
                    data        : mockData,
                    votingBooth : null
                }
            });

            it('will initialize cache if empty when first vote is recorded',function(){
                expect(elDb._cache['el-abc'].votingBooth).toBeNull();
                elDb.recordVote({
                    election    : 'el-abc',
                    ballotItem  : 'item-1',
                    vote        : 'bad and nasty'
                });
                expect(elDb._cache['el-abc'].votingBooth).toBeDefined();
                expect(elDb._cache['el-abc'].votingBooth.dirty).toEqual(true);
            });

            it('will update cached election data if it exists with vote',function(){
                expect(elDb._cache['el-abc'].data.ballot['item-1']['bad and nasty'])
                    .toEqual(200);
                elDb.recordVote({
                    election    : 'el-abc',
                    ballotItem  : 'item-1',
                    vote        : 'bad and nasty'
                });
                expect(elDb._cache['el-abc'].data.ballot['item-1']['bad and nasty'])
                    .toEqual(201);
            });
        });

        describe('getCachedElections',function(){
            var elDb;
            
            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                elDb._cache['el-abc'] = {
                    lastSync    : null,
                    data        : mockData,
                    votingBooth : null
                }
                elDb._cache['el-def'] = {
                    lastSync    : null,
                    data        : mockData,
                    votingBooth : null
                }
            });

            it('returns elections if they are cached',function(){
                expect(elDb.getCachedElections().length).toEqual(2);
            });

            it('returns an empty array if there are none cached',function(){
                elDb._cache = {};
                expect(elDb.getCachedElections().length).toEqual(0);
            });
        });


        describe('updateVoteCounts',function(){
            var elDb ;
            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                resolveSpy = jasmine.createSpy('updateVoteCounts.resolve');
                rejectSpy = jasmine.createSpy('updateVoteCounts.reject');
            });

            it ('will send mongo an update for each item with pending votes', function(done){
                var clearSpy = jasmine.createSpy('vb.clear');
                elDb._cache = {
                    'abc' : { id : 'abc', votingBooth : new VotingBooth('abc') },
                    'def' : { id : 'def', votingBooth : new VotingBooth('def') },
                    'ghi' : { id : 'ghi', votingBooth : new VotingBooth('ghi') }
                };

                elDb._cache['abc'].votingBooth._items = { 'a' : { 'a1' : 2, 'a2' : 3 } };
                elDb._cache['abc'].votingBooth.clear = clearSpy;
                elDb._cache['def'].votingBooth._items = { 'd' : { 'd1' : 2, 'd2' : 3 } };
                elDb._cache['def'].votingBooth.clear = clearSpy;

                spyOn(q,'allSettled').andCallFake(function(){
                    return q.resolve(true);
                });
                
                spyOn(q,'ninvoke').andReturn(q.resolve(true));;
               
                elDb.updateVoteCounts()
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(q.allSettled).toHaveBeenCalled();
                        expect(q.ninvoke.callCount).toEqual(2);
                        expect(clearSpy.callCount).toEqual(2);
                    }).done(done);
            });
        });
    });
});
