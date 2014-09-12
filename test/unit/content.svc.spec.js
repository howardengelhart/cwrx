var flush = true;
describe('content (UT)', function() {
    var mockLog, mockLogger, experiences, req, uuid, logger, content, q, objUtils, FieldValidator,
        mongoUtils, enums, Status, Scope, Access;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        content         = require('../../bin/content');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
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
        spyOn(content, 'formatOutput').andCallThrough();
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        
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
    
    describe('canGetExperience', function() {
        var exp, user, origin, pubList;
        beforeEach(function() {
            exp = { id: 'e1', status: Status.Pending, access: Access.Private };
            user = null;
            origin = 'http://google.com';
            pubList = ['www.cinema6.com', 'demo.cinema6.com'];
            spyOn(content, 'checkScope').andReturn(false);
        });
        
        it('should let a guest see an active experience from outside cinema6.com', function() {
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
            exp.status = Status.Active;
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(true);
            origin = 'http://staging.cinema6.com';
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
        });
        
        it('should let a guest see a public experience from cinema6.com', function() {
            exp.access = Access.Public;
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
            origin = 'http://staging.cinema6.com';
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(true);
        });
        
        it('should not treat a site in the public list as part of cinema6.com', function() {
            origin = 'http://demo.cinema6.com/foo/bar';
            exp.access = Access.Public;
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
            exp.access = Access.Private;
            exp.status = Status.Active;
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(true);
        });
        
        it('should let an authenticated user see an experience if their permissions are valid', function() {
            user = { foo: 'bar' };
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
            content.checkScope.andReturn(true);
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(true);
            expect(content.checkScope).toHaveBeenCalledWith({foo: 'bar'}, exp, 'experiences', 'read');
        });
        
        it('should let a user see one of their authorized apps', function() {
            user = { id: 'u1', applications: ['e1'] };
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(true);
        });
        
        it('should never let anyone see a deleted experience', function() {
            exp = { id: 'e1', status: Status.Deleted, access: Access.Public };
            origin = 'http://cinema6.com';
            content.checkScope.andReturn(true);
            expect(content.canGetExperience(exp, user, origin, pubList)).toBe(false);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(content.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof content.createValidator._condForbidden.org).toBe('function');
            expect(typeof content.createValidator._condForbidden.user).toBe('function');
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

        it('should conditionally prevent setting the user field', function() {
            var user = {
                id: 'u-1234',
                permissions: {
                    experiences: { create: Scope.Org }
                }
            };
            var exp = { a: 'b', user: 'u-1234' };
            spyOn(FieldValidator, 'eqReqFieldFunc').andCallThrough();
            spyOn(FieldValidator, 'scopeFunc').andCallThrough();
            
            expect(content.createValidator.validate(exp, {}, user)).toBe(true);
            expect(FieldValidator.scopeFunc).toHaveBeenCalledWith('experiences', 'create', Scope.All);
            
            exp.user = 'u-4567';
            expect(content.createValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.create = Scope.All;
            expect(content.createValidator.validate(exp, {}, user)).toBe(true);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initalized correctly', function() {
            expect(content.updateValidator._forbidden).toEqual(['id', 'org', 'created', '_id']);
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
    
    describe('formatOutput', function() {
        var experience;
        
        it('should convert .data to .data[0].data for the client', function() {
            var now = new Date();
            experience = { id: 'e1', data: [
                { email: 'otter', date: now, data: { foo: 'baz' }, versionId: 'v2' },
                { email: 'crosby', date: now, data: { foo: 'bar' }, versionId: 'v1' }
            ]};
            expect(content.formatOutput(experience)).toEqual({ id:'e1', data: { foo:'baz' }, versionId: 'v2' });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });
        
        it('should create a .title property from .data[0].data.title', function() {
            var now = new Date();
            experience = { id: 'e1', data: [
                { email: 'otter', date: now, data: { title: 'Cool Tapes', foo: 'baz' } },
                { email: 'crosby', date: now, data: { title: 'Not Cool Tapes', foo: 'bar' } }
            ]};
            expect(content.formatOutput(experience))
                .toEqual({ id: 'e1', title: 'Cool Tapes', data: {title: 'Cool Tapes', foo: 'baz'} });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });

        it('should convert .status to .status[0].status for the client', function() {
            var now = new Date();
            experience = { id: 'e1', status: [
                { email: 'otter', date: now, status: Status.Deleted },
                { email: 'crosby', date: now, status: Status.Pending }
            ]};
            expect(content.formatOutput(experience)).toEqual({ id:'e1', status: Status.Deleted });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });
        
        it('should set the lastPublished date if the experience was active', function() {
            var now = new Date();
            experience = { id: 'e1', status: [
                { date: new Date(now + 1000), status: Status.Active },
                { date: now, status: Status.Pending }
            ]};
            expect(content.formatOutput(experience)).toEqual({id:'e1',status:Status.Active,
                                                              lastPublished:new Date(now + 1000)});
            experience.status.push({date: new Date(now + 2000), status: Status.Pending});
            experience.status.push({date: new Date(now + 3000), status: Status.Active});
            expect(content.formatOutput(experience)).toEqual({id:'e1',status:Status.Active,
                                                              lastPublished:new Date(now + 3000)});
        });
        
        it('should prevent a guest user from seeing certain fields', function() {
            experience = { id: 'e1', user: 'u1', org: 'o1' };
            expect(content.formatOutput(experience, true)).toEqual({id: 'e1'});
            expect(content.formatOutput(experience)).toEqual({id: 'e1', user: 'u1', org: 'o1'});
        });
    });
    
    describe('getAdConfig', function() {
        var orgCache, exp;
        beforeEach(function() {
            orgCache = {
                getPromise: jasmine.createSpy('orgCache.getPromise').andReturn(q([{id:'o-1',adConfig:{foo:'bar'}}]))
            };
            exp = { id: 'e-1', data: { good: 'yes' } };
        });
        
        it('should do nothing if the experience has no data', function(done) {
            delete exp.data;
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({id: 'e-1'});
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should do nothing if the experience already has an adConfig property', function(done) {
            exp.data.adConfig = { foo: 'baz' };
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'baz' } } });
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should successfully put the org\'s adConfig on the experience', function(done) {
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'bar' } } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should do nothing if the org could not be found', function(done) {
            orgCache.getPromise.andReturn(q([]));
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should do nothing if the org has no adConfig', function(done) {
            orgCache.getPromise.andReturn(q([{ id: 'o-1' }]))
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should reject if getPromise returns a rejected promise', function(done) {
            orgCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'))
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).finally(done);
        });
    });
    
    describe('userPermQuery', function() {
        var query, user, origin, publicList;
        beforeEach(function() {
            query = { type: 'minireel' };
            user = { id: 'u-1', org: 'o-1', permissions: { experiences: { read: Scope.Own } } };
            origin = 'google.com';
            publicList = ['www.cinema6.com'];
        });
        
        it('should just check that the experience is not deleted if the user is an admin', function() {
            user.permissions.experiences.read = Scope.All;
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted } });
            expect(query).toEqual({type: 'minireel'});
        });
        
        it('should not overwrite an existing query on the status field', function() {
            query['status.0.status'] = Status.Active;
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': Status.Active,
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the user owns the exp or if it\'s active if they have Scope.Own', function() {
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the org owns the exp or if it\'s active if they have Scope.Org', function() {
            user.permissions.experiences.read = Scope.Org;
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{org: 'o-1'}, {user: 'u-1'}, {'status.0.status': Status.Active}] });
        });
        
        it('should check if the exp is public instead if the origin is a cinema6 domain', function() {
            origin = 'staging.cinema6.com';
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { access: Access.Public } ] });
        });
        
        it('should properly use the publicList to whitelist certain cinema6 domains', function() {
            origin = 'http://www.cinema6.com';
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should append a check against their application list if the user has one', function() {
            user.applications = ['e1'];
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{user: 'u-1'}, {'status.0.status': Status.Active}, {id: {$in: ['e1']}}] });
        });
        
        it('should log a warning if the user has an invalid scope', function() {
            user.permissions.experiences.read = 'arghlblarghl';
            expect(content.userPermQuery(query, user, origin, publicList))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('getPublicExp', function() {
        var id, req, expCache, orgCache, pubList;
        beforeEach(function() {
            id = 'e-1';
            req = { headers: { origin: 'http://google.com' }, uuid: '1234' };
            expCache = {
                getPromise: jasmine.createSpy('expCache.getPromise').andReturn(q([{id: 'e-1', org: 'o-1'}]))
            };
            orgCache = 'fakeOrgCache';
            pubList = ['www.c6.com'];
            spyOn(content, 'canGetExperience').andReturn(true);
            content.formatOutput.andReturn('formatted');
            spyOn(content, 'getAdConfig').andReturn(q('withAdConfig'));
        });
        
        it('should call cache.getPromise to get the experience', function(done) {
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withAdConfig');
                expect(expCache.getPromise).toHaveBeenCalledWith({id: 'e-1'});
                expect(content.formatOutput).toHaveBeenCalledWith({id: 'e-1', org: 'o-1'}, true);
                expect(content.canGetExperience)
                    .toHaveBeenCalledWith('formatted', null, 'http://google.com', ['www.c6.com']);
                expect(content.getAdConfig).toHaveBeenCalledWith('formatted', 'o-1', 'fakeOrgCache');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if nothing was found', function(done) {
            expCache.getPromise.andReturn(q([]));
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(expCache.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
                expect(content.canGetExperience).not.toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 404 if the user cannot see the experience', function(done) {
            content.canGetExperience.andReturn(false);
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(expCache.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should pass the referer header to canGetExperience if the origin is not defined', function(done) {
            req.headers = { referer: 'http://yahoo.com' };
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withAdConfig');
                expect(content.canGetExperience)
                    .toHaveBeenCalledWith('formatted', null, 'http://yahoo.com', ['www.c6.com']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should prefer the origin header if both are defined', function(done) {
            req.headers = { referer: 'http://yahoo.com', origin: 'http://google.com' };
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withAdConfig');
                expect(content.canGetExperience)
                    .toHaveBeenCalledWith('formatted', null, 'http://google.com', ['www.c6.com']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if the promise was rejected', function(done) {
            expCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(expCache.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
                expect(content.canGetExperience).not.toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
            }).finally(done);
        });
        
        it('should fail if calling getAdConfig fails', function(done) {
            content.getAdConfig.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, expCache, pubList, orgCache).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(expCache.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).toHaveBeenCalled();
            }).finally(done);
        });
    });
    
    describe('getExperiences', function() {
        var req, expColl, query, pubList;
        beforeEach(function() {
            req = {
                headers: { origin: 'google.com' },
                uuid: '1234',
                query: {
                    sort: 'id,1',
                    limit: 20,
                    skip: 10
                },
                user: 'fakeUser'
            };
            query = {type: 'minireel'};
            pubList = ['demo.c6.com'];
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, [{id: 'e1'}]);
                }),
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) {
                    cb(null, 50);
                })
            };
            expColl = { find: jasmine.createSpy('expColl.find').andReturn(fakeCursor) };
            spyOn(content, 'userPermQuery').andReturn('userPermQuery');
            content.formatOutput.andReturn('formatted');
        });
        
        it('should format the query and call expColl.find', function(done) {
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser','google.com',['demo.c6.com']);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: { id: 1 }, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalledWith({id: 'e1'}, false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should properly use hints if querying by user or org', function(done) {
            content.userPermQuery.andCallFake(function(orig) { return orig; });
            content.getExperiences({user: 'u-1'}, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith({user: 'u-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
                return content.getExperiences({org: 'o-1'}, req, expColl, pubList, false);
            }).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find.calls[1].args).toEqual([{org: 'o-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {org: 1}}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should prefer to hint on the user index if querying by user and org', function(done) {
            content.userPermQuery.andCallFake(function(orig) { return orig; });
            content.getExperiences({org: 'o-1', user: 'u-1'}, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith({org: 'o-1', user: 'u-1'}, 
                    {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });

        it('should not allow a user to query for deleted experiences', function(done) {
            query.status = Status.Deleted;
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Cannot get deleted experiences');
                expect(mockLog.warn).toHaveBeenCalled();
                expect(content.userPermQuery).not.toHaveBeenCalled();
                expect(expColl.find).not.toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should properly format a query on the status field', function(done) {
            query.status = Status.Active;
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type: 'minireel',
                    'status.0.status': Status.Active}, 'fakeUser', 'google.com', ['demo.c6.com']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should set resp.pagination if multiExp is true', function(done) {
            content.getExperiences(query, req, expColl, pubList, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(resp.pagination).toEqual({start: 11, end: 30, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            content.getExperiences(query, req, expColl, pubList, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(resp.pagination).toEqual({start: 46, end: 50, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 200 and empty array if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            content.getExperiences(query, req, expColl, pubList, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.pagination).toEqual({start: 0, end: 0, total: 0});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should pass the referer header to userPermQuery if the origin is not defined', function(done) {
            req.headers = { referer: 'yahoo.com' };
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser','yahoo.com',['demo.c6.com']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should prefer the origin header if both are defined', function(done) {
            req.headers = { referer: 'yahoo.com', origin: 'google.com' };
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser','google.com',['demo.c6.com']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            content.getExperiences(query, req, expColl, pubList, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Find Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).finally(done);
        });

        it('should fail if cursor.count has an error and multiExp is true', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            content.getExperiences(query, req, expColl, pubList, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Count Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).finally(done);
        });
    });
    
    describe('createExperience', function() {
        beforeEach(function() {
            req.body = {tag: 'fakeExp', data: { foo: 'bar' } };
            req.user = {id: 'u-1234', org: 'o-1234', email: 'otter'};
            experiences.insert = jasmine.createSpy('experiences.insert')
                .andCallFake(function(obj, opts, cb) { cb(); });
            spyOn(uuid, 'createUuid').andReturn('1234');
            spyOn(content.createValidator, 'validate').andReturn(true);
            spyOn(uuid, 'hashText').andReturn('fakeVersion');
            spyOn(content, 'checkScope').andReturn(false);
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
                expect(resp.body.tag).toBe('fakeExp');
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.user).toBe('u-1234');
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.status).toBe(Status.Pending);
                expect(resp.body.access).toBe(Access.Public);
                expect(content.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(experiences.insert).toHaveBeenCalled();
                expect(experiences.insert.calls[0].args[0].data[0]).toEqual({user:'otter',userId:'u-1234',
                    date:jasmine.any(Date),versionId:'fakeVers',data:{foo:'bar'}});
                expect(experiences.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(content.formatOutput).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(content.checkScope).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should trim off certain fields not allowed on the top-level', function(done) {
            req.body.title = 'this is a title';
            req.body.versionId = 'thabestversion';
            req.body.data.title = 'data title';
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.title).toBe('data title');
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.data).toEqual({foo: 'bar', title: 'data title'});
                expect(content.createValidator.validate).toHaveBeenCalled();
                expect(experiences.insert).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent ordinary users from setting the adConfig', function(done) {
            req.body.data.adConfig = {ads: 'good'};
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to set adConfig');
                expect(content.checkScope).toHaveBeenCalledWith(req.user, req.body, 'experiences', 'editAdConfig');
                expect(experiences.insert).not.toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let users set the adConfig if they have permission to do so', function(done) {
            content.checkScope.andReturn(true);
            req.body.data.adConfig = {ads: 'good'};
            content.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.data).toEqual({foo: 'bar', adConfig: {ads: 'good'}});
                expect(content.checkScope).toHaveBeenCalledWith(req.user, req.body, 'experiences', 'editAdConfig');
                expect(experiences.insert).toHaveBeenCalled();
                expect(experiences.insert.calls[0].args[0].data[0].data).toEqual({foo:'bar',adConfig:{ads:'good'}});
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

    describe('formatUpdates', function() {
        var req, orig, updates, user, start = new Date();
        
        beforeEach(function() {
            req = { uuid: '1234' };
            updates = {};
            orig = {
                id: 'e-1',
                created: start,
                data: [{user: 'johnny', userId: 'u-2', date: start, data: {foo: 'bar'}, versionId: 'v1'}],
                status: [{user: 'johnny', userId: 'u-2', date: start, status: Status.Pending}]
            };
            user = { id: 'u-1', email: 'otter' };
            spyOn(uuid, 'hashText').andCallFake(function(dataString) {
                return dataString === JSON.stringify({foo:'bar'}) ? 'version1.0' : 'version2.0';
            });
        });
        
        it('should append a new status entry on each change', function() {
            updates.status = Status.Deleted;
            content.formatUpdates(req, orig, updates, user);
            expect(updates.status instanceof Array).toBe(true);
            expect(updates.status.length).toBe(2);
            expect(updates.status[0].user).toBe('otter');
            expect(updates.status[0].userId).toBe('u-1');
            expect(updates.status[0].date).toBeGreaterThan(start);
            expect(updates.status[0].status).toEqual(Status.Deleted);
            expect(updates.status[1].user).toBe('johnny');
            expect(updates.status[1].userId).toBe('u-2');
            expect(updates.status[1].date).toBe(start);
            expect(updates.status[1].status).toEqual(Status.Pending);
            expect(updates.data).not.toBeDefined();
            expect(updates.lastUpdated).toBeGreaterThan(start);
            expect(mongoUtils.escapeKeys).toHaveBeenCalled();
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
            expect(updates.data[0].userId).toBe('u-1');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'baz'});
            expect(updates.data[0].active).toBe(true);
            expect(updates.data[0].versionId).toBe('version2');
            expect(updates.data[1].user).toBe('johnny');
            expect(updates.data[1].userId).toBe('u-2');
            expect(updates.data[1].date).toBe(start);
            expect(updates.data[1].data).toEqual({foo: 'bar'});
            expect(updates.data[1].active).not.toBeDefined();
            expect(updates.data[1].versionId).toBe('v1');
            expect(updates.status).not.toBeDefined();
        });

        it('should edit the current data entry if the experience is not active', function() {
            updates.data = {foo: 'baz'};
            content.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(1);
            expect(updates.data[0].user).toBe('otter');
            expect(updates.data[0].userId).toBe('u-1');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'baz'});
            expect(updates.data[0].versionId).toBe('version2');
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
            expect(updates.data[0].versionId).toBe('version2');
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
            expect(updates.data[1].userId).toBe('u-1');
            expect(updates.data[1].date).toBe(start);
            expect(updates.data[1].data).toEqual({foo: 'bar'});
            expect(updates.data[1].versionId).toBe('version1');
            expect(updates.data[0].versionId).toBe('version2');
            expect(updates.status[1].user).toBe('otter');
            expect(updates.status[1].userId).toBe('u-1');
            expect(updates.status[1].date).toBe(start);
            expect(updates.status[1].status).toBe(Status.Active);
        });
    });
    
    describe('updateExperience', function() {
        var start = new Date(),
            oldExp;
        beforeEach(function() {
            req.params = {id: 'e-1234'};
            req.body = {tag: 'newTag', data: {foo: 'baz'} };
            oldExp = {id:'e-1234', tag:'oldTag', user:'u-1234', created:start, lastUpdated:start,
                      data: [ { user: 'otter', date: start, data: { foo: 'bar' } } ],
                      status: [ { user: 'otter', date: start, status: Status.Pending } ] };
            req.user = {id: 'u-1234', email: 'otter'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.findAndModify = jasmine.createSpy('experiences.findAndModify').andCallFake(
                function(query, sort, obj, opts, cb) {
                    cb(null, [{ id: 'e-1234', data: obj.$set.data }]);
                });
            spyOn(objUtils, 'compareObjects').andCallThrough();
            spyOn(content, 'formatUpdates').andCallThrough();
            spyOn(content, 'checkScope').andReturn(true);
            spyOn(content.updateValidator, 'validate').andReturn(true);
            spyOn(uuid, 'hashText').andReturn('fakeVersion');
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
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(content.updateValidator.validate).toHaveBeenCalledWith(req.body, oldExp, req.user);
                expect(content.formatUpdates).toHaveBeenCalledWith(req, oldExp, req.body, req.user);
                expect(experiences.findAndModify).toHaveBeenCalled();
                expect(experiences.findAndModify.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(experiences.findAndModify.calls[0].args[1]).toEqual({id: 1});
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(Object.keys(updates)).toEqual(['$set']);
                expect(updates.$set.tag).toBe('newTag');
                expect(updates.$set.data[0].user).toBe('otter');
                expect(updates.$set.data[0].date instanceof Date).toBeTruthy('data.date is a Date');
                expect(updates.$set.data[0].data).toEqual({foo: 'baz'});
                expect(updates.$set.data[0].versionId).toBe('fakeVers');
                expect(updates.$set.lastUpdated instanceof Date).toBeTruthy('lastUpdated is Date');
                expect(experiences.findAndModify.calls[0].args[3])
                    .toEqual({w: 1, journal: true, new: true});
                expect(content.formatOutput).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
                expect(content.checkScope).not.toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent improper direct edits to some properties', function(done) {
            req.body.title = 'a title';
            req.body.versionId = 'qwer1234';
            req.body.lastPublished = new Date();
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.tag).toBe('newTag');
                expect(updates.$set.title).not.toBeDefined();
                expect(updates.$set.versionId).not.toBeDefined();
                expect(updates.$set.lastPublished).not.toBeDefined();
                expect(content.formatOutput).toHaveBeenCalled();
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
                expect(resp.body).toBe('Not authorized to edit this experience');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should prevent ordinary users from editing the adConfig', function(done) {
            content.checkScope.andCallFake(function(user, orig, obj, verb) {
                if (verb == 'editAdConfig') return false;
                else return true;
            });
            req.body.data.adConfig = { ads: 'good' };
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit adConfig of this experience');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
                expect(objUtils.compareObjects).toHaveBeenCalledWith({ ads: 'good' }, null);
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });

        it('should allow the edit if the adConfig is unchanged', function(done) {
            content.checkScope.andCallFake(function(user, orig, obj, verb) {
                if (verb == 'editAdConfig') return false;
                else return true;
            });
            req.body.data.adConfig = { ads: 'good' };
            oldExp.data[0].data.adConfig = { ads: 'good' };
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id:'e-1234',data:{foo:'baz',adConfig:{ads:'good'}},versionId:'fakeVers'});
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.data[0].data.adConfig).toEqual({ ads: 'good' });
                expect(objUtils.compareObjects).toHaveBeenCalledWith({ads: 'good'}, {ads: 'good'});
                expect(content.checkScope).not.toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should let users edit the adConfig if they have permission to do so', function(done) {
            content.checkScope.andReturn(true);
            req.body.data.adConfig = { ads: 'bad' };
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id:'e-1234',data:{foo:'baz',adConfig:{ads:'bad'}},versionId:'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.data[0].data.adConfig).toEqual({ ads: 'bad' });
                expect(content.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
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

        it('should not edit an experience that has been deleted', function(done) {
            oldExp.status = [{user: 'otter', status: Status.Deleted}];
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
            oldExp = {id:'e-1234', status: [{user:'otter', date:start, status:Status.Active}],
                      user:'u-1234', lastUpdated:start};
            req.user = {id: 'u-1234', email: 'johnny'};
            experiences.findOne = jasmine.createSpy('experiences.findOne')
                .andCallFake(function(query, cb) { cb(null, oldExp); });
            experiences.update = jasmine.createSpy('experiences.update')
                .andCallFake(function(query, obj, opts, cb) { cb(null, 1); });
            spyOn(uuid, 'hashText').andReturn('fakeHash');
            spyOn(content, 'formatUpdates').andCallThrough();
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
                var setProps = experiences.update.calls[0].args[1].$set;
                expect(setProps.status instanceof Array).toBe(true);
                expect(setProps.status.length).toBe(2);
                expect(setProps.status[0].status).toBe(Status.Deleted);
                expect(setProps.status[0].user).toBe('johnny');
                expect(setProps.status[0].date).toBeGreaterThan(setProps.status[1].date);
                expect(setProps.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(setProps.lastUpdated).toBeGreaterThan(start);
                expect(experiences.update.calls[0].args[2]).toEqual({w: 1, journal: true});
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
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
            oldExp.status[0].status = Status.Deleted;
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
                expect(resp.body).toBe('Not authorized to delete this experience');
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
