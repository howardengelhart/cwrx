describe('vote.elecDb (UT)',function(){
    var ElectionDb, VotingBooth, mockLog, resolveSpy, rejectSpy, q, logger, app, enums, Status,
        mongoUtils, mockDb, mockData, flush = true;
    
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

        describe('syncCached', function() {
            var elDb;
            beforeEach(function() {
                elDb = new ElectionDb(mockDb);
                elDb._cache = {
                    foo: { id: 'foo', votingBooth: new VotingBooth('foo') },
                    bar: { id: 'bar', votingBooth: new VotingBooth('bar') },
                    baz: { id: 'baz' }
                };
                elDb._cache.bar.votingBooth.voteForBallotItem('cool', 'tapes');
                spyOn(elDb, 'getCachedElections').andCallThrough();
                spyOn(elDb, 'syncElection').andReturn(q('fakeElection'));
                resolveSpy = jasmine.createSpy('syncCached.resolve');
                rejectSpy = jasmine.createSpy('syncCached.reject');
            });
            
            it('should call syncElection for elections that are dirty', function(done) {
                elDb.syncCached()
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith([{state:'fulfilled',value:'fakeElection'}]);
                        expect(elDb.getCachedElections).toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalledWith('bar');
                        expect(elDb.syncElection.calls.length).toBe(1);
                        expect(rejectSpy).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should just pass on errors', function(done) {
                elDb.syncElection.andReturn(q.reject('I GOT A PROBLEM'));
                elDb.syncCached()
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith([{state:'rejected',reason:'I GOT A PROBLEM'}]);
                        expect(elDb.syncElection).toHaveBeenCalledWith('bar');
                        expect(elDb.syncElection.calls.length).toBe(1);
                        expect(rejectSpy).not.toHaveBeenCalled();
                    }).done(done);
            });
        });
        
        describe('syncElection', function() {
            var elDb, oldDate;
            beforeEach(function(){
                oldDate = new Date(new Date() - 5000);
                elDb = new ElectionDb(mockDb);
                elDb._cache['el-abc'] = {
                    lastSync    : oldDate,
                    data        : mockData,
                    votingBooth : new VotingBooth('el-abc')
                }
                resolveSpy = jasmine.createSpy('syncElection.resolve');
                rejectSpy = jasmine.createSpy('syncElection.reject');
                mockDb.findOne.andCallFake(function(query, cb) {
                    mockData._id = 'mongoId';
                    cb(null, mockData);
                });
                mockDb.findAndModify.andCallFake(function(query, sort, updates, opts, cb) {
                    var newObj = JSON.parse(JSON.stringify(mockData));
                    newObj._id = 'mongoId';
                    newObj.updated = true;
                    cb(null, [newObj, 'lastErrorObject']);
                });
            });
            
            it('should just return a clean election without writing anything', function(done) {
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(mockData._id).not.toBeDefined();
                        expect(elDb._cache['el-abc'].lastSync).toBeGreaterThan(oldDate);
                        expect(elDb._cache['el-abc'].votingBooth.dirty).toBe(false);
                        expect(mockDb.findOne).toHaveBeenCalledWith({id: 'el-abc'}, jasmine.any(Function));
                        expect(mockDb.findAndModify).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should write votes to the db if the election is dirty', function(done) {
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-1', 'good and plenty');
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-2', 'smelly');
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(resolveSpy.calls[0].args[0]._id).not.toBeDefined();
                        expect(resolveSpy.calls[0].args[0].updated).toBe(true);
                        expect(elDb._cache['el-abc'].lastSync).toBeGreaterThan(oldDate);
                        expect(elDb._cache['el-abc'].votingBooth.dirty).toBe(false);
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalledWith(
                            {id:'el-abc'}, null,
                            {'$inc':{'ballot.item-1.good and plenty':1,'ballot.item-2.smelly':1}},
                            {new:true,w:0,journal:true}, jasmine.any(Function)
                        );
                    }).done(done);
            });
            
            it('should prune out invalid votes', function(done) {
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-1', 'good and bad');
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-2', 'smelly');
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-3', 'brent rambo');
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(resolveSpy.calls[0].args[0]._id).not.toBeDefined();
                        expect(resolveSpy.calls[0].args[0].updated).toBe(true);
                        expect(elDb._cache['el-abc'].lastSync).toBeGreaterThan(oldDate);
                        expect(elDb._cache['el-abc'].votingBooth.dirty).toBe(false);
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalledWith(
                            {id:'el-abc'}, null, {'$inc':{'ballot.item-2.smelly':1}},
                            {new:true,w:0,journal:true}, jasmine.any(Function)
                        );
                    }).done(done);
            });
            
            it('should not write anything if all votes are invalid', function(done) {
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-1', 'good and bad');
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-3', 'brent rambo');
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb._cache['el-abc'].lastSync).toBeGreaterThan(oldDate);
                        expect(elDb._cache['el-abc'].votingBooth.dirty).toBe(false);
                        expect(mockDb.findAndModify).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should initialize the cached election if it did not exist', function(done) {
                delete elDb._cache['el-abc'];
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb._cache['el-abc']).toEqual({
                            id: 'el-abc',
                            lastSync: jasmine.any(Date),
                            data: mockData,
                            votingBooth: jasmine.any(VotingBooth)
                        });
                        expect(mockDb.findAndModify).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should remove the cached election if not found in the db', function(done) {
                mockDb.findOne.andCallFake(function(query, cb) { cb(null, null); });
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb._cache['el-abc']).not.toBeDefined();
                        expect(mockDb.findAndModify).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should fail if findOne fails', function(done) {
                mockDb.findOne.andCallFake(function(query, cb) { cb('I GOT A PROBLEM'); });
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                        expect(elDb._cache['el-abc'].lastSync).toBe(oldDate);
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(mockDb.findAndModify).not.toHaveBeenCalled();
                    }).done(done);
            });
            
            it('should fail if findAndModify fails', function(done) {
                elDb._cache['el-abc'].votingBooth.voteForBallotItem('item-2', 'smelly');
                mockDb.findAndModify.andCallFake(function(query, sort, updates, opts, cb) { cb('I GOT A PROBLEM'); });
                elDb.syncElection('el-abc')
                    .then(resolveSpy, rejectSpy)
                    .finally(function() {
                        expect(resolveSpy).not.toHaveBeenCalled();
                        expect(rejectSpy).toHaveBeenCalledWith('I GOT A PROBLEM');
                        expect(elDb._cache['el-abc'].lastSync).toBe(oldDate);
                        expect(mockDb.findOne).toHaveBeenCalled();
                        expect(mockDb.findAndModify).toHaveBeenCalled();
                    }).done(done);
            });
        });

        describe('getElection',function(){
            var elDb;

            beforeEach(function(){
                elDb = new ElectionDb(mockDb);
                resolveSpy = jasmine.createSpy('getElection.resolve');
                rejectSpy = jasmine.createSpy('getElection.reject');
                mockData = { id: 'abc', status: Status.Active, foo: 'bar' };
                spyOn(elDb, 'syncElection').andReturn(q(mockData));
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
                        expect(elDb.syncElection).not.toHaveBeenCalled();
                        expect(resolveSpy.argsForCall[0][0]).toEqual(mockData);
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('syncs the election if the user is defined',function(done){
                var now = new Date(new Date() - 1000), user = { id: 'u-1', email: 'otter' };
                elDb._cache['abc'] = {
                    lastSync : now,
                    data     : mockData
                }
                
                elDb.getElection('abc', null, user)
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalledWith('abc');
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('syncs the election if the cached election is old',function(done){
                var oldSync = new Date((new Date()).valueOf() - 5000);
                elDb._syncIval = 1000;
                elDb._cache['abc'] = {
                    lastSync : oldSync,
                    data     : mockData
                };
                
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalled();
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('syncs the election if the election is not in the cache',function(done){
                elDb._syncIval = 1000;
                elDb._cache['abc'] = {};
                
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalled();
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });

            it('syncs the election if the election is in the cache but has no data',function(done){
                elDb._syncIval = 1000;
                elDb._cache['el-abc'] = {
                    lastSync : new Date(),
                    data     : null,
                    votingBooth : new VotingBooth('el-abc')
                };
                
                elDb.getElection('el-abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(mockData);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalled();
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                        expect(elDb._cache['el-abc']).toBeDefined();
                        expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    }).done(done);
            });
            
            it('returns nothing if the election is not available',function(done){
                elDb.syncElection.andReturn(q());
                elDb.getElection('abc')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection).toHaveBeenCalled();
                        expect(mockLog.warn).not.toHaveBeenCalled();
                        expect(mockLog.error).not.toHaveBeenCalled();
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                    }).done(done);
            });

            it('fails with timeout if passed timeout parameter',function(done){
                elDb.syncElection.andCallFake(function(electionId){
                    var deferred = q.defer();
                    setTimeout(2000, deferred.resolve);
                    return deferred.promise;
                });
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
                elDb.syncElection.andCallFake(function(electionId){
                    var deferred = q.defer();
                    process.nextTick(function() { deferred.resolve(mockData); });
                    return deferred.promise;
                });

                q.all([ elDb.getElection('abc'),
                        elDb.getElection('abc'), 
                        elDb.getElection('abc')])
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection.callCount).toEqual(1);
                        expect(resolveSpy.argsForCall[0][0].length).toEqual(3);
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

                q.all([ elDb.getElection('abc'),
                        elDb.getElection('abc', null, 'fakeUser')])
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalled();
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection.callCount).toEqual(1);
                        expect(app.checkScope.callCount).toEqual(2);
                        expect(app.checkScope.argsForCall[0][0]).not.toBeDefined();
                        expect(app.checkScope.argsForCall[1][0]).toBe('fakeUser');
                        expect(resolveSpy.argsForCall[0][0].length).toEqual(2);
                        expect(resolveSpy.argsForCall[0][0][0]).not.toBeDefined()
                        expect(resolveSpy.argsForCall[0][0][1]).toBeDefined()
                        expect(resolveSpy.argsForCall[0][0][1].status).toBe(Status.Inactive);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
                    }).done(done);
            });
            
            it('does not show any deleted experiences', function(done) {
                spyOn(app, 'checkScope').andReturn(true);
                mockData.status = Status.Deleted;

                elDb.getElection('abc', null, 'fakeUser')
                    .then(resolveSpy,rejectSpy)
                    .finally(function(){
                        expect(resolveSpy).toHaveBeenCalledWith(undefined);
                        expect(rejectSpy).not.toHaveBeenCalled();
                        expect(elDb.syncElection.callCount).toEqual(1);
                        expect(elDb._keeper.getDeferred('abc',true)).not.toBeDefined();
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
    });
});
