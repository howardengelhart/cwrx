var flush = true;
describe('content (UT)', function() {
    var auth, mockLog, mockLogger, experiences, req, uuid, logger, content, promise, q;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid        = require('../../lib/uuid');
        logger      = require('../../lib/logger');
        content     = require('../../bin/content');
        promise     = require('../../lib/promise');
        q           = require('q');
        
        jasmine.Clock.useMock();
        
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
        experiences = {};
        req = {uuid: '1234'};
    });
    
    describe('QueryCache', function() {
        var fakeColl;
        
        beforeEach(function() {
            fakeColl = {
                find: jasmine.createSpy('coll.find')
            };
        });
        
        describe('initialization', function() {
            it('should throw an error if not provided with a cacheTTL or collection', function() {
                var msg = "Must provide a cacheTTL and mongo collection";
                expect(function() { new content.QueryCache() }).toThrow(msg);
                expect(function() { new content.QueryCache(5) }).toThrow(msg);
                expect(function() { new content.QueryCache(null, fakeColl) }).toThrow(msg);
                expect(function() { new content.QueryCache(5, fakeColl) }).not.toThrow();
            });
            
            it('should set or initialize any required properties', function() {
                var cache = new content.QueryCache(5, fakeColl);
                expect(cache.cacheTTL).toBe(5*60*1000);
                expect(cache._coll).toBe(fakeColl);
                expect(cache._keeper instanceof promise.Keeper).toBeTruthy('cache._keeper is Keeper');
            });
        });
    
        describe('sortQuery', function() {
            it('should simply return the query if not an object', function() {
                expect(content.QueryCache.sortQuery('abcd')).toBe('abcd');
                expect(content.QueryCache.sortQuery(10)).toBe(10);
            });
            
            it('should recursively sort an object by its keys', function() {
                var query = {b: 1, a: 2, c: 5};
                var sorted = content.QueryCache.sortQuery(query);
                expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: 1, c: 5}));
                
                var query = {b: {f: 3, e: 8}, a: 2, c: [3, 2, 1]};
                var sorted = content.QueryCache.sortQuery(query);
                expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: {e: 8, f: 3}, c: [3, 2, 1]}));
                
                var query = {b: [{h: 1, g: 2}, {e: 5, f: 3}], a: 2};
                var sorted = content.QueryCache.sortQuery(query);
                expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: [{g: 2, h: 1}, {e: 5, f: 3}]}));
            });
        });
        
        describe('formatQuery', function() {
            var query, userId;
            beforeEach(function() {
                query = {};
                userId = 'u-1234';
                spyOn(content.QueryCache, 'sortQuery').andCallThrough();
            });
            
            it('should create an $or combining a public and private query', function() {
                var newQuery = content.QueryCache.formatQuery(query, userId);
                expect(newQuery).toEqual({ $or: [{user: 'u-1234'}, {status: 'active', access: 'public'}]});
                expect(content.QueryCache.sortQuery).toHaveBeenCalled();
            });
            
            it('should return a public query if the original query specifies another user id', function() {
                query.user = 'u-4567';
                var newQuery = content.QueryCache.formatQuery(query, userId);
                expect(newQuery).toEqual({user: 'u-4567', status: 'active', access: 'public'});
                expect(content.QueryCache.sortQuery).toHaveBeenCalled();
            });
            
            it('should return a public query if no user is provided', function() {
                query.id = 'e-1234';
                var newQuery = content.QueryCache.formatQuery(query, '');
                expect(newQuery).toEqual({id: 'e-1234', status: 'active', access: 'public'});
                expect(content.QueryCache.sortQuery).toHaveBeenCalled();
            });
            
            it('should return a private query if the original query specifies the user\'s id', function() {
                query.user = 'u-1234';
                var newQuery = content.QueryCache.formatQuery(query, userId);
                expect(newQuery).toEqual({user: 'u-1234'});
                expect(content.QueryCache.sortQuery).toHaveBeenCalled();
            });
            
            it('should transform arrays into mongo-style $in objects', function() {
                query.id = ['e-1', 'e-2', 'e-3'];
                query.user = 'u-1234';
                var newQuery = content.QueryCache.formatQuery(query, userId);
                expect(newQuery).toEqual({user: 'u-1234', id: { $in: ['e-1', 'e-2', 'e-3']}});
                expect(content.QueryCache.sortQuery).toHaveBeenCalled();
            });
        });
        
        describe('getPromise', function() {
            var cache, fakeCursor;
            beforeEach(function() {
                cache = new content.QueryCache(1, fakeColl);
                spyOn(uuid, 'hashText').andReturn('fakeHash');
                fakeCursor = {
                    toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                        cb(null, [{id: 'e-1234'}])
                    })
                };
                fakeColl.find.andReturn(fakeCursor);
            });
            
            it('should retrieve a promise from the cache if the query matches', function(done) {
                var deferred = cache._keeper.defer('fakeHash');
                deferred.resolve([{id: 'e-1234'}]);
                cache.getPromise('1234', {id: 'e-1234'}, {id: 1}, 0, 0)
                .then(function(exps) {
                    expect(exps).toEqual([{id: 'e-1234'}]);
                    var key = JSON.stringify({ query:{id:"e-1234"}, sort:{id:1}, limit:0, skip:0 });
                    expect(uuid.hashText).toHaveBeenCalledWith(key);
                    expect(fakeColl.find).not.toHaveBeenCalled();
                    done();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                    done();
                });
            });
            
            it('should make a new promise and search mongo if the query is not cached', function(done) {
                var query = { id: "e-1234" },
                    opts = {sort: { id: 1 }, limit: 0, skip: 0 };
                cache.getPromise('1234', query, opts.sort, opts.limit, opts.skip)
                .then(function(exps) {
                    expect(exps).toEqual([{id: 'e-1234'}]);
                    expect(fakeColl.find).toHaveBeenCalledWith(query, opts);
                    expect(fakeCursor.toArray).toHaveBeenCalled();
                    expect(uuid.hashText).toHaveBeenCalled();
                    expect(cache._keeper._deferreds.fakeHash).toBeDefined();
                    expect(cache._keeper.pendingCount).toBe(0);
                    expect(cache._keeper.fulfilledCount).toBe(1);
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });
            
            it('should delete the cached query after the cacheTTL', function(done) {
                spyOn(cache._keeper, 'remove');
                var query = { id: "e-1234" },
                    opts = {sort: { id: 1 }, limit: 0, skip: 0 };
                cache.getPromise('1234', query, opts.sort, opts.limit, opts.skip)
                .then(function(exps) {
                    expect(exps).toEqual([{id: 'e-1234'}]);
                    expect(cache._keeper._deferreds.fakeHash).toBeDefined();
                    jasmine.Clock.tick(1*60*1000);
                    expect(cache._keeper.remove).toHaveBeenCalledWith('fakeHash', true);
                    done();
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                    done();
                });
            });
            
            it('should pass along errors from mongo', function(done) {
                fakeCursor.toArray.andCallFake(function(cb) { cb('Error!'); });
                cache.getPromise('1234', {id: 'e-1234'}, {id: 1}, 0, 0)
                .then(function(exps) {
                    expect(exps).not.toBeDefined();
                    done();
                }).catch(function(error) {
                    expect(error).toBe('Error!');
                    expect(fakeColl.find).toHaveBeenCalled();
                    expect(fakeCursor.toArray).toHaveBeenCalled();
                    expect(uuid.hashText).toHaveBeenCalled();
                    // should not cache errors from mongo
                    expect(cache._keeper._deferreds.fakeHash).not.toBeDefined();
                    expect(cache._keeper.rejectedCount).toBe(0);
                    done();
                });
            });
        });
    });
    
    describe('getExperiences', function() {
        var req, cache, query;
        beforeEach(function() {
            req = {
                uuid: '1234',
                query: {
                    sort: JSON.stringify({id: 1}),
                    limit: 20,
                    skip: 10
                },
                session: { user: 'fakeUser' }
            };
            query = 'fakeQuery';
            cache = {
                getPromise: jasmine.createSpy('cache.getPromise').andReturn(q(['fake1', 'fake2']))
            };
            spyOn(content.QueryCache, 'formatQuery').andReturn('formatted')
        });
        
        it('should format the query and call cache.getPromise', function(done) {
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fake1', 'fake2']);
                expect(content.QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery', 'fakeUser');
                expect(cache.getPromise).toHaveBeenCalledWith('1234', 'formatted', {id: 1}, 20, 10);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should use defaults if the user or other params are not defined', function(done) {
            req = { uuid: '1234', session: {} };
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fake1', 'fake2']);
                expect(content.QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery', '');
                expect(cache.getPromise).toHaveBeenCalledWith('1234', 'formatted', {}, 0, 0);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should fail if the promise was rejected', function(done) {
            cache.getPromise.andReturn(q.reject('Error!'));
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe(error);
                expect(mockLog.error).toHaveBeenCalled();
                expect(content.QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery', 'fakeUser');
                expect(cache.getPromise).toHaveBeenCalledWith('1234', 'formatted', {id: 1}, 20, 10);
                done();
            });
        });
        
        it('should just ignore the sort param if not an object', function(done) {
            req.query.sort = 'foo';
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fake1', 'fake2']);
                expect(content.QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery', 'fakeUser');
                expect(cache.getPromise).toHaveBeenCalledWith('1234', 'formatted', {}, 20, 10);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should access mongo directly if the query contains noCache', function(done) {
            req.query.noCache = true;
            var fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, ['fake1', 'fake2'])
                })
            };
            cache._coll = {
                find: jasmine.createSpy('coll.find').andReturn(fakeCursor)
            };
            content.getExperiences(query, req, cache).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['fake1', 'fake2']);
                expect(content.QueryCache.formatQuery).toHaveBeenCalledWith('fakeQuery', 'fakeUser');
                expect(cache.getPromise).not.toHaveBeenCalled();
                var opts = {sort: { id: 1}, limit: 20, skip: 10};
                expect(cache._coll.find).toHaveBeenCalledWith('formatted', opts);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('createExperience', function() {
        beforeEach(function() {
            req.body = {title: 'fakeExp'};
            req.user = {id: 'u-1234'};
            experiences.insert = jasmine.createSpy('experiences.insert')
                .andCallFake(function(obj, opts, cb) { cb(); });
            spyOn(uuid, 'createUuid').andReturn('1234');
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
                expect(resp.body.user).toBe('u-1234');
                expect(resp.body.status).toBe('active');
                expect(experiences.insert).toHaveBeenCalled();
                expect(experiences.insert.calls[0].args[0]).toBe(resp.body);
                expect(experiences.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
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
    
    describe('updateExperience', function() {
        var start = new Date(),
            oldExp;
        beforeEach(function() {
            req.params = {id: 'e-1234'};
            req.body = {id: 'e-1234', title: 'newExp', user: 'u-1234', created: start};
            oldExp = {id:'e-1234', title:'oldExp', user:'u-1234', created:start, lastUpdated:start};
            req.user = {id: 'u-1234'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.findAndModify = jasmine.createSpy('experiences.findAndModify')
                .andCallFake(function(query, sort, obj, opts, cb) { cb(null, obj, 'lastErrorObj'); });
        });
        
        it('should fail with a 400 if no experience is provided', function(done) {
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
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.title).toBe('newExp');
                expect(resp.body.created).toEqual(start);
                expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(resp.body.lastUpdated).toBeGreaterThan(oldExp.lastUpdated);
                expect(resp.body.user).toBe('u-1234');
                
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(experiences.findAndModify).toHaveBeenCalled();
                expect(experiences.findAndModify.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(experiences.findAndModify.calls[0].args[1]).toEqual({id: 1});
                expect(experiences.findAndModify.calls[0].args[2]).toBe(resp.body);
                expect(experiences.findAndModify.calls[0].args[3])
                    .toEqual({w: 1, journal: true, upsert: true, new: true});
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not allow a user to update an experience they do not own', function(done) {
            req.user = {id: 'u-4567'};
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(401);
                expect(resp.body).toBe("Not authorized to edit this experience");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should create an experience if it does not already exist', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb(); });
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.title).toBe('newExp');
                expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                expect(resp.body.created).toBeGreaterThan(start);
                expect(resp.body.lastUpdated).toEqual(resp.body.created);
                expect(resp.body.user).toBe('u-1234');
                
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
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
            oldExp = {id:'e-1234', status: 'active', user:'u-1234', lastUpdated:start};
            req.user = {id: 'u-1234'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.update = jasmine.createSpy('experiences.update')
                .andCallFake(function(query, obj, opts, cb) { cb(null, 1); });
        });
        
        it('should successfully delete an experience', function(done) {
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBe("Successfully deleted experience");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(experiences.update).toHaveBeenCalled();
                expect(experiences.update.calls[0].args[0]).toEqual({id: 'e-1234'});
                var setProps = experiences.update.calls[0].args[1];
                expect(setProps.$set.status).toBe('deleted');
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
                expect(resp.code).toBe(200);
                expect(resp.body).toBe("That experience does not exist");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not do anything if the experience has been deleted', function(done) {
            oldExp.status = 'deleted';
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(200);
                expect(resp.body).toBe("That experience has already been deleted");
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should not let a user delete an experience they do not own', function(done) {
            req.user = {id: 'u-4567'};
            content.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(401);
                expect(resp.body).toBe("Not authorized to delete this experience");
                expect(experiences.findOne).toHaveBeenCalled();
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
});  // end -- describe auth
