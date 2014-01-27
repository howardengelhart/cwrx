describe('vote.data',function(){
    var ElectionDb, VotingBooth, mockLog, resolveSpy, rejectSpy, q, logger,
        mockDb, mockData, mockCursor, flush = true;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();
        
        q           = require('q');
        logger      = require('../../lib/logger');
        ElectionDb    = require('../../bin/vote').ElectionDb;
        VotingBooth    = require('../../bin/vote').VotingBooth;

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
    });

    describe('VotingBooth',function(){
        describe('initialization',function(){
            it('fails without an election id',function(){
                expect(function(){ new VotingBooth() }).toThrow('ElectionId is required.');
            });

            it('sets electionId property based on electionId param.',function(){
                var vb = new VotingBooth('xyz');
                expect(vb.electionId).toEqual('xyz');
            });
        });

        describe('voteForBallotItem',function(){
            var vb;
            beforeEach(function(){
                vb = new VotingBooth('xyz');
            });

            it('will initialize the ballot item and choice if they do not exist',function(){
                expect(vb._items['item1']).not.toBeDefined();
                vb.voteForBallotItem('item1','happy');
                expect(vb._items['item1']).toBeDefined();
                expect(vb._items['item1']['happy']).toEqual(1);
            });

            it('will increment the ballot item choice vote count if they do exist',function(){
                vb.voteForBallotItem('item1','happy');
                vb.voteForBallotItem('item1','happy');
                expect(vb._items['item1']['happy']).toEqual(2);
            });
        });

        describe('clear',function(){
            var vb;
            beforeEach(function(){
                vb = new VotingBooth('xyz');
            });

            it('will clear all data',function(){
                vb._items  = {
                    'item1' : {
                        'happy' : 2,
                        'sad'   : 1
                    },
                    'item2' : {
                        'red'   : 2,
                        'green' : 2,
                        'blue'  : 1
                    }
                };
                vb.clear();
                expect(vb._items).toEqual({});
            });
        });

        describe('markSynced',function(){
            var vb;
            beforeEach(function(){
                vb = new VotingBooth('xyz');
                vb._items  = {
                    'item1' : {
                        'happy' : 2,
                        'sad'   : 1
                    },
                    'item2' : {
                        'red'   : 2,
                        'green' : 2,
                        'blue'  : 1
                    }
                };
            });

            it('will clear all data',function(){
                expect(vb._items).not.toEqual({});
                vb.markSynced();
                expect(vb._items).toEqual({});
            });

            it('will update the lastSync',function(){
                vb._lastSync = null;
                vb.markSynced();
                expect(vb.lastSync).not.toBeNull();
            });
        });

        describe('dirty property',function(){
            var vb, mockVotes;
            beforeEach(function(){
                vb = new VotingBooth('xyz');
                mockVotes = {
                    'item1' : {
                        'happy' : 2,
                        'sad'   : 1
                    },
                    'item2' : {
                        'red'   : 2,
                        'green' : 2,
                        'blue'  : 1
                    }
                };
            });

            it('returns false if no votes to update',function(){
                expect(vb.dirty).toEqual(false);
            });

            it('returns true if there are votes to update',function(){
                expect(vb.dirty).toEqual(false);
                vb._items = mockVotes;
                expect(vb.dirty).toEqual(true);
            });
        });

        describe('each',function(){
            var vb, mockVotes, eachSpy;
            beforeEach(function(){
                vb = new VotingBooth('xyz');
                eachSpy = jasmine.createSpy('VotingBooth.each');
                mockVotes = {
                    'item1' : {
                        'happy' : 2,
                        'sad'   : 1
                    },
                    'item2' : {
                        'red'   : 2,
                        'green' : 2,
                        'blue'  : 1
                    }
                };
            });

            it('does nothing if there is no data',function(){
                vb.each(eachSpy);
                expect(eachSpy).not.toHaveBeenCalled();
            });

            it('execs callback with data for each vote if exists',function(){
                vb._items = mockVotes;
                vb.each(eachSpy);
                expect(eachSpy.callCount).toEqual(5);
                expect(eachSpy.argsForCall[0]).toEqual(['item1','happy',2]);
                expect(eachSpy.argsForCall[1]).toEqual(['item1','sad',1]);
                expect(eachSpy.argsForCall[4]).toEqual(['item2','blue',1]);
            });
        });
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
                var lastSync = (new Date()).valueOf() - 2000;
                elDb._syncIval = 1000;
                expect(elDb.shouldSync(lastSync)).toEqual(true);
            });

            it('returns false when syncIval has not expired',function(){
                var lastSync = (new Date()).valueOf() - 200;
                elDb._syncIval = 1000;
                expect(elDb.shouldSync(lastSync)).toEqual(false);
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
                mockData = { id : 'abc' };
                elDb._cache['abc'] = {
                    lastSync : (new Date()).valueOf(),
                    data     :  mockData
                }
                
                elDb.getElection('abc')
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
                var oldSync = (new Date()).valueOf() - 5000;
                mockData = { _id : 'xyz', id : 'abc', foo : 'bar' };
                elDb._syncIval = 1000;
                elDb._cache['abc'] = {
                    lastSync : oldSync,
                    data     :  mockData
                }
                
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
                    }).done(done);
            });

            it('updates db with votes and queries for new if election has votes',function(done){
                var oldSync = (new Date()).valueOf() - 5000,
                    vb = new VotingBooth('el-abc');
                elDb._syncIval = 1000;
                elDb._cache['el-abc'] = {
                    lastSync : oldSync,
                    data     :  mockData
                }
                elDb._voteCache['el-abc'] = vb;
                vb._items = {
                    'item-1' : {
                        'bad and nasty'    : 20 ,
                        'ugly and fat'     : 30 
                    }
                };
                
                mockDb.findAndModify.andCallFake(function(query,sort,update,options,cb){
                    process.nextTick(function(){
                        cb(null,[mockData]);
                    });
                });
                
                elDb.getElection('el-abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalled();
                        expect(vb.lastSync).not.toBeNull();
                        expect(vb._items).toEqual({});
                    }).done(done);
            });

            it('fails if the election is not available',function(done){
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,null);
                    });
                });

                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalled();
                        expect(rejectSpy.argsForCall[0][0].message)
                            .toEqual('Unable to locate election');
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
                mockData = { _id : 'xyz', id : 'abc', foo : 'bar' };
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
                    }).done(done);
            });
        });

        describe('getBallotItem',function(){
            var elDb;

            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                elDb._cache['el-abc'] = {
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

                elDb.getBallotItem('abc','123')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalled();
                        expect(rejectSpy.argsForCall[0][0].message)
                            .toEqual('I have failed.');
                        expect(elDb._keeper.getDeferred('abc::123',true)).not.toBeDefined();
                    })
                    .done(done);
            });

            it('will fail if passed an invalid id',function(done){
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,null);
                    });
                });

                elDb.getBallotItem('abc','123')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalled();
                        expect(rejectSpy.argsForCall[0][0].message)
                            .toEqual('Unable to locate election');
                        expect(elDb._keeper.getDeferred('abc::123',true)).not.toBeDefined();
                    })
                    .done(done);
            });

            it('will fail if passed an invalid ballot item Id',function(done){
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        cb(null,null);
                    });
                });

                elDb.getBallotItem('el-abc','123')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalled();
                        expect(rejectSpy.argsForCall[0][0].message)
                            .toEqual('Unable to locate ballot item.');
                        expect(elDb._keeper.getDeferred('el-abc:::123',true)).not.toBeDefined();
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

                elDb.getBallotItem('el-abc','item-1')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).not.toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0]).toEqual([{
                            election    : 'el-abc',
                            ballotItem  : 'item-1',
                            votes       : {
                                'good and plenty' : 100,
                                'bad and nasty'   : 200,
                                'ugly and fat'    : 300
                            }
                        }]);
                        expect(elDb._keeper.getDeferred('el-abc::item-1',true)).not.toBeDefined();
                    })
                    .done(done);
            });

            it('will return a ballot item from db if not in the cache',function(done){
                elDb._cache = {};
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        mockData._id = 'xxx';
                        cb(null,mockData);
                    });
                });

                elDb.getBallotItem('el-abc','item-1')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0]).toEqual([{
                            election    : 'el-abc',
                            ballotItem  : 'item-1',
                            votes       : {
                                'good and plenty' : 100,
                                'bad and nasty'   : 200,
                                'ugly and fat'    : 300
                            }
                        }]);
                        expect(elDb._keeper.getDeferred('el-abc::item-1',true)).not.toBeDefined();
                    })
                    .done(done);
            });
            
            it('batches calls while waiting for mongo',function(done){
                elDb._cache = {};
                mockDb.findOne.andCallFake(function(query,cb){
                    process.nextTick(function(){
                        mockData._id = 'xxx';
                        cb(null,mockData);
                    });
                });

                q.all([
                        elDb.getBallotItem('el-abc','item-1') ,
                        elDb.getBallotItem('el-abc','item-1') ,
                        elDb.getBallotItem('el-abc','item-1') 
                     ])
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockDb.findOne.callCount).toEqual(1);
                        expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
                        expect(elDb._keeper.getDeferred('el-abc::item-1',true)).not.toBeDefined();
                    }).done(done);
            });
        });

        describe('recordVote',function(){
            var elDb;

            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                elDb._cache['el-abc'] = {
                    lastSync : null,
                    data     : mockData
                }
            });

            it('will initialize cache if empty when first vote is recorded',function(){
                expect(elDb._voteCache).toEqual({});
                elDb.recordVote({
                    election    : 'el-abc',
                    ballotItem  : 'item-1',
                    vote        : 'bad and nasty'
                });
                expect(elDb._voteCache['el-abc']).toBeDefined();
                expect(elDb._voteCache['el-abc'].dirty).toEqual(true);
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
    });
});
