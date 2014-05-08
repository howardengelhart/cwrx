describe('vote (UT)',function(){
    var VotingBooth, mockLog, resolveSpy, rejectSpy, q, logger, app, enums, Status, Scope, fv,
        mongoUtils, elections, req, uuid, flush = true;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.Clock.useMock();
        
        q             = require('q');
        logger        = require('../../lib/logger');
        uuid          = require('../../lib/uuid');
        VotingBooth   = require('../../bin/vote').VotingBooth;
        mongoUtils    = require('../../lib/mongoUtils');
        app           = require('../../bin/vote').app;
        enums         = require('../../lib/enums');
        fv            = require('../../lib/fieldValidator');
        Status        = enums.Status;
        Scope         = enums.Scope;

        mockLog     = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        
        elections = {};
        
        spyOn(logger,'createLog').andReturn(mockLog);
        spyOn(logger,'getLog').andReturn(mockLog);
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        req = {uuid: '1234'};
    });

    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var user = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    elections: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var elections = [{ id: 'el-1', user: 'u-1234', org: 'o-1234'},
                        { id: 'el-2', user: 'u-4567', org: 'o-1234'},
                        { id: 'el-3', user: 'u-1234', org: 'o-4567'},
                        { id: 'el-4', user: 'u-4567', org: 'o-4567'}];
            
            expect(elections.filter(function(election) {
                return app.checkScope(user, election, 'read');
            })).toEqual(elections);
            
            expect(elections.filter(function(election) {
                return app.checkScope(user, election, 'edit');
            })).toEqual([elections[0], elections[1], elections[2]]);
            
            expect(elections.filter(function(election) {
                return app.checkScope(user, election, 'delete');
            })).toEqual([elections[0], elections[2]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var election = { id: 'el-1' };
            expect(app.checkScope({}, election, 'read')).toBe(false);
            var user = { id: 'u-1234', org: 'o-1234' };
            expect(app.checkScope(user, election, 'read')).toBe(false);
            user.permissions = {};
            expect(app.checkScope(user, election, 'read')).toBe(false);
            user.permissions.elections = {};
            user.permissions.orgs = { read: Scope.All };
            expect(app.checkScope(user, election, 'read')).toBe(false);
            user.permissions.elections.read = '';
            expect(app.checkScope(user, election, 'read')).toBe(false);
            user.permissions.elections.read = Scope.All;
            expect(app.checkScope(user, election, 'read')).toBe(true);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(app.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof app.createValidator._condForbidden.org).toBe('function');
        });
        
        it('should prevent setting forbidden fields', function() {
            var exp = { id: 'foo', a: 'b' };
            expect(app.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { created: 'foo', a: 'b' };
            expect(app.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { bar: 'foo', a: 'b' };
            expect(app.createValidator.validate(exp, {}, {})).toBe(true);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var user = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    elections: { create: Scope.Org }
                }
            };
            var exp = { a: 'b', org: 'o-1234' };
            spyOn(fv, 'eqReqFieldFunc').andCallThrough();
            spyOn(fv, 'scopeFunc').andCallThrough();
            
            expect(app.createValidator.validate(exp, {}, user)).toBe(true);
            expect(fv.eqReqFieldFunc).toHaveBeenCalledWith('org');
            expect(fv.scopeFunc).toHaveBeenCalledWith('elections', 'create', Scope.All);
            
            exp.org = 'o-4567';
            expect(app.createValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.elections.create = Scope.All;
            expect(app.createValidator.validate(exp, {}, user)).toBe(true);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initalized correctly', function() {
            expect(app.updateValidator._forbidden).toEqual(['id', 'org', 'created', '_id']);
        });
        
        it('should prevent illegal updates', function() {
            var updates = { id: 'foo', a: 'b' };
            expect(app.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { org: 'foo', a: 'b' };
            expect(app.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { created: 'foo', a: 'b' };
            expect(app.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { bar: 'foo', a: 'b' };
            expect(app.updateValidator.validate(updates, {}, {})).toBe(true);
        });
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
                vb.clear();
                expect(vb._items).toEqual({});
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

    describe('app',function(){
        describe('convertObjectValsToPercents',function(){
            it('converts numbers to percents',function(){
                var obj = { 'a' : 25, 'b' : 50, 'c' : 25 };
                expect(app.convertObjectValsToPercents(obj))
                    .toEqual({ a : 0.25, b : 0.50, c: 0.25 });
            });

            it('rounds numbers down to hundredths',function(){
                var result = app.convertObjectValsToPercents({ a : 34, b : 65 });
                expect(result.a.toString()).toEqual('0.34');
                expect(result.b.toString()).toEqual('0.66');
            });

            it('creates a copy of the objct and does not modify the original',function(){
                var obj = { 'a' : 25, 'b' : 50, 'c' : 25 },
                    res = app.convertObjectValsToPercents(obj);
                
                expect(obj.a).toEqual(25);
                expect(res.a).toEqual(0.25);
            });

            it('handles an empty object',function(){
                expect(app.convertObjectValsToPercents({})).toEqual({});
            });

            it('handles zero values',function(){
                expect(app.convertObjectValsToPercents({ a : 0, b : 30, c : 70}))
                    .toEqual({ a : 0.0, b : 0.30, c : 0.70});
            });
        });

        describe('convertElection',function(){
            it('converts an election from vals to percents',function(){
                var election = {
                        id : 'abc',
                        ballot : {
                            'b1' : { 'v1' : 10, 'v2' : 20 },
                            'b2' : { 'v1' : 5, 'v2' : 20 }
                        }
                    },
                    result = app.convertElection(election);

                expect(result.id).toEqual('abc');
                expect(result.ballot.b1.v1).toEqual(0.33);
                expect(result.ballot.b1.v2).toEqual(0.67);
                expect(result.ballot.b2.v1).toEqual(0.20);
                expect(result.ballot.b2.v2).toEqual(0.80);
            });
        });

        describe('syncElections',function(){
            var elDb, mockElection;
            beforeEach(function(){
                elDb = {
                    getCachedElections  : jasmine.createSpy('elDb.getCachedElections'),
                    getElection         : jasmine.createSpy('elDb.getElection'),
                };
                mockElection = {
                    id : 'abc',
                    lastSync : new Date(),
                    data : null,
                    votingBooth : {
                        dirty : false
                    }
                };
            });


            it('will do nothing if there are no elections in the cache',function(){
                elDb.getCachedElections.andReturn([]);
                app.syncElections(elDb);
                expect(elDb.getElection).not.toHaveBeenCalled();
            });

            it('will not attempt to sync an election that does not need it',function(){
                elDb.getCachedElections.andReturn([mockElection]); 
                app.syncElections(elDb);
                expect(elDb.getElection).not.toHaveBeenCalled();
            });

            it('will call getElection if there is an election that shouldSync',function(){
                mockElection.votingBooth.dirty = true;
                elDb.getCachedElections.andReturn([mockElection]); 
                app.syncElections(elDb);
                expect(elDb.getElection).toHaveBeenCalledWith('abc');
            });
        });

        describe('createElection', function() {
            beforeEach(function() {
                req.body = {ballot: 'fake'};
                req.user = {id: 'u-1234', org: 'o-1234'};
                elections.insert = jasmine.createSpy('elections.insert')
                    .andCallFake(function(obj, opts, cb) { cb(); });
                spyOn(uuid, 'createUuid').andReturn('1234');
                spyOn(app.createValidator, 'validate').andReturn(true);
            });
            
            it('should fail with a 400 if no election is provided', function(done) {
                delete req.body;
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(elections.insert).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should successfully create an election', function(done) {
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(201);
                    expect(resp.body.id).toBe('el-1234');
                    expect(resp.body.ballot).toBe('fake');
                    expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                    expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                    expect(resp.body.user).toBe('u-1234');
                    expect(resp.body.org).toBe('o-1234');
                    expect(resp.body.status).toBe(Status.Active);
                    expect(app.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                    expect(elections.insert).toHaveBeenCalled();
                    expect(elections.insert.calls[0].args[0]).toEqual(resp.body);
                    expect(elections.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                    expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                    expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 400 if the request body contains illegal fields', function(done) {
                app.createValidator.validate.andReturn(false);
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(app.createValidator.validate).toHaveBeenCalled();
                    expect(elections.insert).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if inserting the record fails', function(done) {
                elections.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(mockLog.error).toHaveBeenCalled();
                    expect(elections.insert).toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('updateElection', function() {
            var start = new Date(),
                oldElec;
            beforeEach(function() {
                req.params = {id: 'el-1234'};
                req.body = {ballot: 'fake2'};
                oldElec = {id:'el-1234',ballot:'fake1',user:'u-1234',created:start,lastUpdated:start};
                req.user = {id: 'u-1234'};
                elections.findOne = jasmine.createSpy('elections.findOne')
                    .andCallFake(function(query, cb) { cb(null, oldElec); });
                elections.findAndModify = jasmine.createSpy('elections.findAndModify').andCallFake(
                    function(query, sort, obj, opts, cb) {
                        cb(null, [{ id: 'el-1234', updated: true }]);
                    });
                spyOn(app, 'checkScope').andReturn(true);
                spyOn(app.updateValidator, 'validate').andReturn(true);
            });

            it('should fail with a 400 if no update object is provided', function(done) {
                delete req.body;
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(elections.findOne).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should successfully update an election', function(done) {
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(200);
                    expect(resp.body).toEqual({id: 'el-1234', updated: true});
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.findOne.calls[0].args[0]).toEqual({id: 'el-1234'});
                    expect(app.updateValidator.validate).toHaveBeenCalledWith(req.body, oldElec, req.user);
                    expect(elections.findAndModify).toHaveBeenCalled();
                    expect(elections.findAndModify.calls[0].args[0]).toEqual({id: 'el-1234'});
                    expect(elections.findAndModify.calls[0].args[1]).toEqual({id: 1});
                    var updates = elections.findAndModify.calls[0].args[2];
                    expect(Object.keys(updates)).toEqual(['$set']);
                    expect(updates.$set.ballot).toBe('fake2');
                    expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                    expect(elections.findAndModify.calls[0].args[3])
                        .toEqual({w: 1, journal: true, new: true});
                    expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                    expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });

            it('should not edit the election if the updates contain illegal fields', function(done) {
                app.updateValidator.validate.andReturn(false);
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Illegal fields');
                    expect(app.updateValidator.validate).toHaveBeenCalled();
                    expect(elections.findAndModify).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should only let a user edit elections they are authorized to edit', function(done) {
                app.checkScope.andReturn(false);
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(403);
                    expect(resp.body).toBe("Not authorized to edit this election");
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.findAndModify).not.toHaveBeenCalled();
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'edit');
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should not create an election if it does not already exist', function(done) {
                elections.findOne.andCallFake(function(query, cb) { cb(); });
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(404);
                    expect(resp.body).toBe('That election does not exist');
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.findAndModify).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if modifying the record fails', function(done) {
                elections.findAndModify.andCallFake(function(query, sort, obj, opts, cb) { cb('Error!'); });
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(elections.findAndModify).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with an error if looking up the record fails', function(done) {
                elections.findOne.andCallFake(function(query, cb) { cb('Error!'); });
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.findAndModify).not.toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('deleteElection', function() {
            var start = new Date(),
                oldElec;
            beforeEach(function() {
                req.params = {id: 'el-1234'};
                oldElec = {id:'el-1234', status: Status.Active, user:'u-1234', lastUpdated:start};
                req.user = {id: 'u-1234'};
                elections.findOne = jasmine.createSpy('elections.findOne')
                    .andCallFake(function(query, cb) { cb(null, oldElec); });
                elections.update = jasmine.createSpy('elections.update')
                    .andCallFake(function(query, obj, opts, cb) { cb(null, 1); });
                spyOn(app, 'checkScope').andReturn(true);
            });
            
            it('should successfully delete an election', function(done) {
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(204);
                    expect(resp.body).not.toBeDefined();
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.findOne.calls[0].args[0]).toEqual({id: 'el-1234'});
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'delete');
                    expect(elections.update).toHaveBeenCalled();
                    expect(elections.update.calls[0].args[0]).toEqual({id: 'el-1234'});
                    var setProps = elections.update.calls[0].args[1];
                    expect(setProps.$set.status).toBe(Status.Deleted);
                    expect(setProps.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                    expect(setProps.$set.lastUpdated).toBeGreaterThan(start);
                    expect(elections.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should not do anything if the election does not exist', function(done) {
                elections.findOne.andCallFake(function(query, cb) { cb(); });
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(204);
                    expect(resp.body).not.toBeDefined();
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.update).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should not do anything if the election has been deleted', function(done) {
                oldElec.status = Status.Deleted;
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(204);
                    expect(resp.body).not.toBeDefined();
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.update).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should only let a user delete elections they are authorized to delete', function(done) {
                app.checkScope.andReturn(false);
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(403);
                    expect(resp.body).toBe("Not authorized to delete this election");
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'delete');
                    expect(elections.update).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if modifying the record fails', function(done) {
                elections.update.andCallFake(function(query, obj, opts, cb) { cb('Error!'); });
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).toBe('Error!');
                    expect(elections.update).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with an error if looking up the record fails', function(done) {
                elections.findOne.andCallFake(function(query, cb) { cb('Error!'); });
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).toBe('Error!');
                    expect(elections.findOne).toHaveBeenCalled();
                    expect(elections.update).not.toHaveBeenCalled();
                    done();
                });
            });
        });
    });
});
