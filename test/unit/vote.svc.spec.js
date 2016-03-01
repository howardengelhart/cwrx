describe('vote (UT)',function(){
    var VotingBooth, mockLog, resolveSpy, rejectSpy, q, logger, app, enums, Status, Scope, fv,
        mongoUtils, elections, req, uuid, flush = true;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        jasmine.clock().install();
        
        q             = require('q');
        logger        = require('../../lib/logger');
        uuid          = require('rc-uuid');
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
        
        spyOn(logger,'createLog').and.returnValue(mockLog);
        spyOn(logger,'getLog').and.returnValue(mockLog);
        spyOn(mongoUtils, 'escapeKeys').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        req = {uuid: '1234'};
    });

    afterEach(function() {
        jasmine.clock().uninstall();
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
            
            expect(app.createValidator.validate(exp, {}, user)).toBe(true);
            
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
                expect(function(){ new VotingBooth() }).toThrow(new SyntaxError('ElectionId is required.'));
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
                expect(vb._items['item1']).toEqual({happy: 1});
            });
            
            it('will increment the ballot item choice vote count if they do exist',function(){
                vb.voteForBallotItem('item1','happy');
                vb.voteForBallotItem('item1','happy');
                expect(vb._items['item1']['happy']).toEqual(2);
            });

            it('will work if the ballotItem is an array', function() {
                vb.voteForBallotItem('item1', 0);
                vb.voteForBallotItem('item1', 1);
                expect(vb._items['item1']).toEqual([1, 1]);
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
                expect(eachSpy.calls.count()).toEqual(5);
                expect(eachSpy.calls.allArgs()[0]).toEqual(['item1','happy',2]);
                expect(eachSpy.calls.allArgs()[1]).toEqual(['item1','sad',1]);
                expect(eachSpy.calls.allArgs()[4]).toEqual(['item2','blue',1]);
            });
            
            it('works for ballot items that are arrays or objects', function() {
                vb._items = { item1: mockVotes.item1, item3: [1, 2] };
                vb.each(eachSpy);
                expect(eachSpy.calls.count()).toEqual(4);
                expect(eachSpy.calls.all()[0].args).toEqual(['item1', 'happy', 2]);
                expect(eachSpy.calls.all()[1].args).toEqual(['item1', 'sad', 1]);
                expect(eachSpy.calls.all()[2].args).toEqual(['item3', '0', 1]);
                expect(eachSpy.calls.all()[3].args).toEqual(['item3', '1', 2]);
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
            
            it('handles a ballotItem that is an array instead of a hash', function() {
                expect(app.convertObjectValsToPercents([25, 75])).toEqual([0.25, 0.75]);
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

        describe('createElection', function() {
            beforeEach(function() {
                req.body = { ballot: { fake: { yes: 0, no: 0 } } };
                req.user = {id: 'u-1234', org: 'o-1234'};
                spyOn(mongoUtils, 'createObject').and.callFake(function(coll, obj) { return q(obj); });
                spyOn(uuid, 'createUuid').and.returnValue('1234');
                spyOn(app.createValidator, 'validate').and.returnValue(true);
            });
            
            it('should fail with a 400 if no election is provided', function(done) {
                delete req.body;
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(mongoUtils.createObject).not.toHaveBeenCalled();
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
                    expect(resp.body.id).toEqual('el-1234');
                    expect(resp.body.ballot).toEqual({ fake: { yes: 0, no: 0 } });
                    expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                    expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                    expect(resp.body.user).toBe('u-1234');
                    expect(resp.body.org).toBe('o-1234');
                    expect(resp.body.status).toBe(Status.Active);
                    expect(app.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                    expect(mongoUtils.createObject).toHaveBeenCalledWith(elections, resp.body);
                    expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 400 if the request body contains illegal fields', function(done) {
                app.createValidator.validate.and.returnValue(false);
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(app.createValidator.validate).toHaveBeenCalled();
                    expect(mongoUtils.createObject).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with a 400 if the ballot is empty or undefined', function(done) {
                q.all([
                    app.createElection({uuid:'1234', user:req.user, body:{foo:'bar'}}, elections),
                    app.createElection({uuid:'1234', user:req.user, body:{ballot:'foo'}}, elections),
                    app.createElection({uuid:'1234', user:req.user, body:{ballot: {}}}, elections)
                ]).then(function(results) {
                    results.forEach(function(result) {
                        expect(result.code).toBe(400);
                        expect(result.body).toBe('Must provide non-empty ballot');
                    });
                    expect(app.createValidator.validate).not.toHaveBeenCalled();
                    expect(mongoUtils.createObject).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if inserting the record fails', function(done) {
                mongoUtils.createObject.and.returnValue(q.reject('Error!'));
                app.createElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(mongoUtils.createObject).toHaveBeenCalled();
                    done();
                });
            });
        });
        
        describe('updateElection', function() {
            var start = new Date(),
                oldElec;
            beforeEach(function() {
                req.params = {id: 'el-1234'};
                req.body = {tag: 'fake2'};
                oldElec = {id:'el-1234',tag:'fake1',user:'u-1234',created:start,lastUpdated:start};
                req.user = {id: 'u-1234'};
                spyOn(mongoUtils, 'findObject').and.returnValue(q(oldElec));
                elections.findOneAndUpdate = jasmine.createSpy('elections.findOneAndUpdate').and.returnValue({ value: { id: 'el-1234', updated: true } });
                spyOn(app, 'checkScope').and.returnValue(true);
                spyOn(app.updateValidator, 'validate').and.returnValue(true);
            });

            it('should fail with a 400 if no update object is provided', function(done) {
                delete req.body;
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(400);
                    expect(mongoUtils.findObject).not.toHaveBeenCalled();
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
                    expect(mongoUtils.findObject).toHaveBeenCalledWith(elections, {id: 'el-1234'});
                    expect(app.updateValidator.validate).toHaveBeenCalledWith(req.body, oldElec, req.user);
                    expect(elections.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'el-1234' },
                        { $set: {
                            tag: 'fake2',
                            lastUpdated: jasmine.any(Date)
                        } },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                    expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });

            it('should not edit the election if the updates contain illegal fields', function(done) {
                app.updateValidator.validate.and.returnValue(false);
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(400);
                    expect(resp.body).toBe('Invalid request body');
                    expect(app.updateValidator.validate).toHaveBeenCalled();
                    expect(elections.findOneAndUpdate).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should permit ballot updates only if they create new items', function(done) {
                oldElec.ballot = { b1: [0, 3], b2: [2, 5] };
                req.body.ballot = { b1: [1, 4], b2: 'foo', b4: [10, 20] };
                
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(200);
                    expect(resp.body).toEqual({id: 'el-1234', updated: true});
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(app.updateValidator.validate).toHaveBeenCalledWith(req.body, oldElec, req.user);
                    expect(elections.findOneAndUpdate).toHaveBeenCalledWith(
                        { id: 'el-1234' },
                        { $set: {
                            tag: 'fake2',
                            lastUpdated: jasmine.any(Date),
                            'ballot.b4': [10, 20]
                        } },
                        { w: 1, j: true, returnOriginal: false, sort: { id: 1 } }
                    );
                    expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                    expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should only let a user edit elections they are authorized to edit', function(done) {
                app.checkScope.and.returnValue(false);
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(403);
                    expect(resp.body).toBe("Not authorized to edit this election");
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(elections.findOneAndUpdate).not.toHaveBeenCalled();
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'edit');
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should not create an election if it does not already exist', function(done) {
                mongoUtils.findObject.and.returnValue(q());
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp.code).toBe(404);
                    expect(resp.body).toBe('That election does not exist');
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(elections.findOneAndUpdate).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if modifying the record fails', function(done) {
                elections.findOneAndUpdate.and.returnValue(q.reject('Error!'));
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(elections.findOneAndUpdate).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with an error if looking up the record fails', function(done) {
                mongoUtils.findObject.and.returnValue(q.reject('Error!'));
                app.updateElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(elections.findOneAndUpdate).not.toHaveBeenCalled();
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
                spyOn(mongoUtils, 'findObject').and.returnValue(q(oldElec));
                spyOn(mongoUtils, 'editObject').and.returnValue(q());
                spyOn(app, 'checkScope').and.returnValue(true);
            });
            
            it('should successfully delete an election', function(done) {
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(204);
                    expect(resp.body).not.toBeDefined();
                    expect(mongoUtils.findObject).toHaveBeenCalledWith(elections, { id: 'el-1234' });
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'delete');
                    expect(mongoUtils.editObject).toHaveBeenCalledWith(elections, { status: Status.Deleted }, 'el-1234');
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should not do anything if the election does not exist', function(done) {
                mongoUtils.findObject.and.returnValue(q());
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(204);
                    expect(resp.body).not.toBeDefined();
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
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
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should only let a user delete elections they are authorized to delete', function(done) {
                app.checkScope.and.returnValue(false);
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).toBeDefined();
                    expect(resp.code).toBe(403);
                    expect(resp.body).toBe("Not authorized to delete this election");
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(app.checkScope).toHaveBeenCalledWith(req.user, oldElec, 'delete');
                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should fail with an error if modifying the record fails', function(done) {
                mongoUtils.editObject.and.returnValue(q.reject('Error!'));
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).toBe('Error!');
                    expect(mongoUtils.editObject).toHaveBeenCalled();
                    done();
                });
            });
            
            it('should fail with an error if looking up the record fails', function(done) {
                mongoUtils.findObject.and.returnValue(q.reject('Error!'));
                app.deleteElection(req, elections).then(function(resp) {
                    expect(resp).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).toBe('Error!');
                    expect(mongoUtils.findObject).toHaveBeenCalled();
                    expect(mongoUtils.editObject).not.toHaveBeenCalled();
                    done();
                });
            });
        });
    });
});
