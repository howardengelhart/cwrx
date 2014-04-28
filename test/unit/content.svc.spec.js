var flush = true;
describe('content (UT)', function() {
    var mockLog, mockLogger, experiences, req, uuid, logger, content, q, QueryCache, FieldValidator,
        enums, Status, Scope, Access;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        content         = require('../../bin/content');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
        q               = require('q');
        enums           = require('../../lib/enums');
        Status          = enums.Status;
        Access          = enums.Access;
        Scope           = enums.Scope;
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        spyOn(content, 'getMostRecentState').andCallThrough();
        experiences = {};
        req = {uuid: '1234'};
    });
    
    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var user = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    experiences: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var exps = [{ id: 'e-1', user: 'u-1234', org: 'o-1234'},
                        { id: 'e-2', user: 'u-4567', org: 'o-1234'},
                        { id: 'e-3', user: 'u-1234', org: 'o-4567'},
                        { id: 'e-4', user: 'u-4567', org: 'o-4567'}];
            
            expect(exps.filter(function(experience) {
                return content.checkScope(user, experience, 'experiences', 'read');
            })).toEqual(exps);
            
            expect(exps.filter(function(experience) {
                return content.checkScope(user, experience, 'experiences', 'edit');
            })).toEqual([exps[0], exps[1], exps[2]]);
            
            expect(exps.filter(function(experience) {
                return content.checkScope(user, experience, 'experiences', 'delete');
            })).toEqual([exps[0], exps[2]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var experience = { id: 'e-1' };
            expect(content.checkScope({}, experience, 'experiences', 'read')).toBe(false);
            var user = { id: 'u-1234', org: 'o-1234' };
            expect(content.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions = {};
            expect(content.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences = {};
            user.permissions.orgs = { read: Scope.All };
            expect(content.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences.read = '';
            expect(content.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences.read = Scope.All;
            expect(content.checkScope(user, experience, 'experiences', 'read')).toBe(true);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(content.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof content.createValidator._condForbidden.org).toBe('function');
        });
        
        it('should prevent setting forbidden fields', function() {
            var exp = { id: 'foo', a: 'b' };
            expect(content.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { created: 'foo', a: 'b' };
            expect(content.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { bar: 'foo', a: 'b' };
            expect(content.createValidator.validate(exp, {}, {})).toBe(true);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var user = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    experiences: { create: Scope.Org }
                }
            };
            var exp = { a: 'b', org: 'o-1234' };
            spyOn(FieldValidator, 'eqReqFieldFunc').andCallThrough();
            spyOn(FieldValidator, 'scopeFunc').andCallThrough();
            
            expect(content.createValidator.validate(exp, {}, user)).toBe(true);
            expect(FieldValidator.eqReqFieldFunc).toHaveBeenCalledWith('org');
            expect(FieldValidator.scopeFunc).toHaveBeenCalledWith('experiences', 'create', Scope.All);
            
            exp.org = 'o-4567';
            expect(content.createValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.create = Scope.All;
            expect(content.createValidator.validate(exp, {}, user)).toBe(true);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initalized correctly', function() {
            expect(content.updateValidator._forbidden).toEqual(['id', 'org', 'created']);
        });
        
        it('should prevent illegal updates', function() {
            var updates = { id: 'foo', a: 'b' };
            expect(content.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { org: 'foo', a: 'b' };
            expect(content.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { created: 'foo', a: 'b' };
            expect(content.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { bar: 'foo', a: 'b' };
            expect(content.updateValidator.validate(updates, {}, {})).toBe(true);
        });
    });
    
    describe('getMostRecentState', function() {
        var experience;
        
        it('should convert .data to .data[0].data for the client', function() {
            var now = new Date();
            experience = { id: 'e1', data: [
                { username: 'otter', date: now, data: { foo: 'baz' } },
                { username: 'crosby', date: now, data: { foo: 'bar' } }
            ]};
            expect(content.getMostRecentState(experience)).toEqual({ id:'e1', data: { foo:'baz' } });
        });

        it('should convert .status to .status[0].status for the client', function() {
            var now = new Date();
            experience = { id: 'e1', status: [
                { username: 'otter', date: now, status: Status.Active },
                { username: 'crosby', date: now, status: Status.Pending }
            ]};
            expect(content.getMostRecentState(experience)).toEqual({ id:'e1', status: Status.Active });
        });
    });
    
    describe('getExperiences', function() {
        var req, cache, query, fakeCursor;
        beforeEach(function() {
            req = {
                uuid: '1234',
                query: {
                    sort: 'id,1',
                    limit: 20,
                    skip: 10
                },
                user: 'fakeUser'
            };
            query = 'fakeQuery';
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, q([{title: 'fake1'}]));
                })
            };
            cache = {
                _coll: {
                    find: jasmine.createSpy('cache._coll.find').andReturn(fakeCursor)
                },
                getPromise: jasmine.createSpy('cache.getPromise').andReturn(q([{title: 'fake2'}]))
            };
            spyOn(content, 'checkScope').andReturn(true);
            spyOn(QueryCache, 'formatQuery').andReturn('formatted')
        });
        
        it('should format the query and call cache._coll.find', function(done) {
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{title: 'fake1'}]);
                expect(QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery');
                expect(cache._coll.find)
                    .toHaveBeenCalledWith('formatted', {sort: {id: 1}, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(cache.getPromise).not.toHaveBeenCalled();
                expect(content.checkScope)
                    .toHaveBeenCalledWith('fakeUser', {title: 'fake1'}, 'experiences', 'read');
                expect(content.getMostRecentState.calls.length).toBe(1);
                expect(content.getMostRecentState.calls[0].args[0]).toEqual({title: 'fake1'});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{title: 'fake1'}]);
                expect(QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery');
                expect(cache._coll.find)
                    .toHaveBeenCalledWith('formatted', {sort: {}, limit: 0, skip: 0});
                expect(content.checkScope)
                    .toHaveBeenCalledWith('fakeUser', {title: 'fake1'}, 'experiences', 'read');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{title: 'fake1'}]);
                expect(mockLog.warn).toHaveBeenCalled();
                expect(QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery');
                expect(cache._coll.find)
                    .toHaveBeenCalledWith('formatted', {sort: {}, limit: 20, skip: 10});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should use the cache if no user is logged in', function(done) {
            delete req.user;
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{title: 'fake2'}]);
                expect(QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery');
                expect(cache.getPromise).toHaveBeenCalledWith('formatted', {id: 1}, 20, 10);
                expect(cache._coll.find).not.toHaveBeenCalled();
                expect(content.checkScope)
                    .toHaveBeenCalledWith(undefined, {title: 'fake2'}, 'experiences', 'read');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should only return experiences the user is allowed to see', function(done) {
            req.user = { id: 'u-1', applications: 'e-5' };
            var exps = [
                { id: 'e-1', status: Status.Active, access: Access.Private },
                { id: 'e-2', status: Status.Inactive, access: Access.Public },
                { id: 'e-3', status: Status.Active, access: Access.Public },
                { id: 'e-4', status: Status.Inactive, access: Access.Private },
                { id: 'e-5', status: Status.Inactive, access: Access.Private }
            ];
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, exps);
            });
            cache.getPromise.andReturn(q(exps));
            content.checkScope.andCallFake(function(user, experience, obj, verb) {
                if (user && experience.id === 'e-4') return true;
                else return false;
            });
            
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{ id: 'e-3', status: Status.Active, access: Access.Public },
                                           { id: 'e-4', status: Status.Inactive, access: Access.Private },
                                           { id: 'e-5', status: Status.Inactive, access: Access.Private }]);
                expect(content.checkScope.calls.length).toBe(5);
                expect(content.getMostRecentState.calls.length).toBe(5);
                return content.getExperiences(query, { uuid: '1234' }, cache);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{ id: 'e-3', status: Status.Active, access: Access.Public }]);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb(null, []);
            });
            cache.getPromise.andReturn(q([]));
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No experiences found');
                return content.getExperiences(query, { uuid: '1234' }, cache);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No experiences found');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the promise was rejected', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) {
                cb('Error!');
            });
            cache.getPromise.andReturn(q.reject('Other Error!'));
            content.getExperiences(query, req, cache).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery');
                expect(cache._coll.find).toHaveBeenCalled();
                return content.getExperiences(query, { uuid: '1234' }, cache);
            }).catch(function(error) {
                expect(error).toBe('Other Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(cache.getPromise).toHaveBeenCalled();
                done();
            }).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('createExperience', function() {
        beforeEach(function() {
            req.body = {title: 'fakeExp', data: { foo: 'bar' } };
            req.user = {id: 'u-1234', org: 'o-1234', username: 'otter'};
            experiences.insert = jasmine.createSpy('experiences.insert')
                .andCallFake(function(obj, opts, cb) { cb(); });
            spyOn(uuid, 'createUuid').andReturn('1234');
            spyOn(content.createValidator, 'validate').andReturn(true);
        });
        
        it('should fail with a 400 if no experience is provided', function(done) {
            delete req.body;
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(experiences.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully create an experience', function(done) {
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.title).toBe('fakeExp');
                expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.user).toBe('u-1234');
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.status).toBe(Status.Active);
                expect(content.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(experiences.insert).toHaveBeenCalled();
                var data = experiences.insert.calls[0].args[0].data[0];
                expect(data.user).toBe('otter');
                expect(data.date instanceof Date).toBeTruthy('data.date is a Date');
                expect(data.data).toEqual({foo: 'bar'});
                expect(experiences.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(content.getMostRecentState).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with a 400 if the request body contains illegal fields', function(done) {
            content.createValidator.validate.andReturn(false);
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(content.createValidator.validate).toHaveBeenCalled();
                expect(experiences.insert).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if inserting the record fails', function(done) {
            experiences.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(experiences.insert).toHaveBeenCalled();
                done();
            });
        });
    });

    describe('compareData', function() {
        it('should perform a deep equality check on two objects', function() {
            var a = { foo: 'bar', arr: [1, 3, 2] }, b = { foo: 'bar', arr: [1, 2, 2] };
            expect(content.compareData(a, b)).toBe(false);
            b.arr[1] = 3;
            expect(content.compareData(a, b)).toBe(true);
            a.foo = 'baz';
            expect(content.compareData(a, b)).toBe(false);
            a.foo = 'bar';
            a.data = { user: 'otter' };
            b.data = { user: 'otter', org: 'c6' };
            expect(content.compareData(a, b)).toBe(false);
            a.data.org = 'c6';
            expect(content.compareData(a, b)).toBe(true);
        });
    });
    
    describe('formatUpdates', function() {
        var req, orig, updates, user, start = new Date();
        
        beforeEach(function() {
            req = { uuid: '1234' };
            updates = {};
            orig = {
                id: 'e-1',
                created: start,
                data: [{user: 'johnny', date: start, data: {foo: 'bar'}}],
                status: [{user: 'johnny', date: start, status: Status.Pending}]
            };
            user = { id: 'u-1', username: 'otter' };
        });
        
        it('should append a new status entry on each change', function() {
            updates.status = Status.Deleted;
            content.formatUpdates(req, orig, updates, user);
            expect(updates.status instanceof Array).toBe(true);
            expect(updates.status.length).toBe(2);
            expect(updates.status[0].user).toBe('otter');
            expect(updates.status[0].date).toBeGreaterThan(start);
            expect(updates.status[0].status).toEqual(Status.Deleted);
            expect(updates.status[1].user).toBe('johnny');
            expect(updates.status[1].date).toBe(start);
            expect(updates.status[1].status).toEqual(Status.Pending);
            expect(updates.data).not.toBeDefined();
            expect(updates.lastUpdated).toBeGreaterThan(start);
        });
        
        it('should set the current data to active if the experience becomes active', function() {
            updates.status = Status.Active;
            content.formatUpdates(req, orig, updates, user);
            expect(updates.status.length).toBe(2);
            expect(updates.data.length).toBe(1);
            expect(updates.data[0].active).toBe(true);
        });
        
        it('should append a new data entry if the experience is active', function() {
            orig.status[0].status = Status.Active;
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data instanceof Array).toBe(true);
            expect(updates.data.length).toBe(2);
            expect(updates.data[0].user).toBe('otter');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'baz'});
            expect(updates.data[0].active).toBe(true);
            expect(updates.data[1].user).toBe('johnny');
            expect(updates.data[1].date).toBe(start);
            expect(updates.data[1].data).toEqual({foo: 'bar'});
            expect(updates.data[1].active).not.toBeDefined();
            expect(updates.status).not.toBeDefined();
        });

        it('should edit the current data entry if the experience is not active', function() {
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(1);
            expect(updates.data[0].user).toBe('otter');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'baz'});
        });
        
        it('should append a new data entry if the current data was active', function() {
            orig.data[0].active = true;
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(2);
            expect(updates.data[0].active).not.toBeDefined();
        });
        
        it('should not create a new data entry if the status is just becoming active', function() {
            updates.status = Status.Active;
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(1);
            expect(updates.status.length).toBe(2);
            expect(updates.data[0].active).toBe(true);
            expect(updates.data[0].user).toBe('otter');
        });
        
        it('should create a new data entry if the status is just becoming not active', function() {
            orig.status[0].status = Status.Active;
            updates.status = Status.Pending;
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(2);
            expect(updates.status.length).toBe(2);
            expect(updates.data[0].active).not.toBeDefined();
        });

        it('should prune out updates to the status and data if there\'s no change', function() {
            updates = {foo: 'bar'};
            updates.status = Status.Pending;
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data).not.toBeDefined();
            expect(updates.status).not.toBeDefined();
        });
        
        it('should turn the data and status props into arrays if necessary', function() {
            updates = { data: { foo: 'baz' }, status: Status.Deleted };
            orig.data = { foo: 'bar' };
            orig.status = Status.Active;
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(2);
            expect(updates.status.length).toBe(2);
            expect(updates.data[1].user).toBe('otter');
            expect(updates.data[1].date).toBe(start);
            expect(updates.data[1].data).toEqual({foo: 'bar'});
            expect(updates.status[1].user).toBe('otter');
            expect(updates.status[1].date).toBe(start);
            expect(updates.status[1].status).toBe(Status.Active);
        });
    });
    
    describe('updateExperience', function() {
        var start = new Date(),
            oldExp;
        beforeEach(function() {
            req.params = {id: 'e-1234'};
            req.body = {title: 'newExp', data: {foo: 'baz'} };
            oldExp = {id:'e-1234', title:'oldExp', user:'u-1234', created:start, lastUpdated:start,
                      data: [ { user: 'otter', date: start, data: { foo: 'bar' } } ],
                      status: [ { user: 'otter', date: start, status: Status.Pending } ] };
            req.user = {id: 'u-1234', username: 'otter'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.findAndModify = jasmine.createSpy('experiences.findAndModify').andCallFake(
                function(query, sort, obj, opts, cb) {
                    cb(null, [{ id: 'e-1234', data: obj.$set.data }]);
                });
            spyOn(content, 'formatUpdates').andCallThrough();
            spyOn(content, 'checkScope').andReturn(true);
            spyOn(content.updateValidator, 'validate').andReturn(true);
        });

        it('should fail with a 400 if no update object is provided', function(done) {
            delete req.body;
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(experiences.findOne).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should successfully update an experience', function(done) {
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(content.updateValidator.validate).toHaveBeenCalledWith(req.body, oldExp, req.user);
                expect(content.formatUpdates).toHaveBeenCalledWith(req, oldExp, req.body, req.user);
                expect(experiences.findAndModify).toHaveBeenCalled();
                expect(experiences.findAndModify.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(experiences.findAndModify.calls[0].args[1]).toEqual({id: 1});
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.title).toBe('newExp');
                expect(updates.$set.data[0].user).toBe('otter');
                expect(updates.$set.data[0].date instanceof Date).toBeTruthy('data.date is a Date');
                expect(updates.$set.data[0].data).toEqual({foo: 'baz'});
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(experiences.findAndModify.calls[0].args[3])
                    .toEqual({w: 1, journal: true, new: true});
                expect(content.getMostRecentState).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should not edit the experience if the updates contain illegal fields', function(done) {
            content.updateValidator.validate.andReturn(false);
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                expect(content.updateValidator.validate).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should only let a user edit experiences they are authorized to edit', function(done) {
            content.checkScope.andReturn(false);
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe("Not authorized to edit this experience");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not create an experience if it does not already exist', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb(); });
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if modifying the record fails', function(done) {
            experiences.findAndModify.andCallFake(function(query, sort, obj, opts, cb) { cb('Error!'); });
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(experiences.findAndModify).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if looking up the record fails', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('deleteExperience', function() {
        var start = new Date(),
            oldExp;
        beforeEach(function() {
            req.params = {id: 'e-1234'};
            oldExp = {id:'e-1234', status: Status.Active, user:'u-1234', lastUpdated:start};
            req.user = {id: 'u-1234'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.update = jasmine.createSpy('experiences.update')
                .andCallFake(function(query, obj, opts, cb) { cb(null, 1); });
            spyOn(content, 'checkScope').andReturn(true);
        });
        
        it('should successfully delete an experience', function(done) {
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'delete');
                expect(experiences.update).toHaveBeenCalled();
                expect(experiences.update.calls[0].args[0]).toEqual({id: 'e-1234'});
                var setProps = experiences.update.calls[0].args[1];
                expect(setProps.$set.status).toBe(Status.Deleted);
                expect(setProps.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(setProps.$set.lastUpdated).toBeGreaterThan(start);
                expect(experiences.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not do anything if the experience does not exist', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb(); });
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not do anything if the experience has been deleted', function(done) {
            oldExp.status = Status.Deleted;
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should only let a user delete experiences they are authorized to delete', function(done) {
            content.checkScope.andReturn(false);
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe("Not authorized to delete this experience");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'delete');
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail with an error if modifying the record fails', function(done) {
            experiences.update.andCallFake(function(query, obj, opts, cb) { cb('Error!'); });
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(experiences.update).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail with an error if looking up the record fails', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            });
        });
    });  // end -- describe deleteExperience
});  // end -- describe content
