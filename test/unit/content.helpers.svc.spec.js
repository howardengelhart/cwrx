var flush = true;
describe('content (UT)', function() {
    var mockLog, mockLogger, uuid, logger, expModule, q, FieldValidator, mongoUtils,
        enums, Status, Scope, Access;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        expModule       = require('../../bin/content-experiences');
        mongoUtils      = require('../../lib/mongoUtils');
        FieldValidator  = require('../../lib/fieldValidator');
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
        spyOn(expModule, 'formatOutput').andCallThrough();
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
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
                return expModule.checkScope(user, experience, 'experiences', 'read');
            })).toEqual(exps);
            
            expect(exps.filter(function(experience) {
                return expModule.checkScope(user, experience, 'experiences', 'edit');
            })).toEqual([exps[0], exps[1], exps[2]]);
            
            expect(exps.filter(function(experience) {
                return expModule.checkScope(user, experience, 'experiences', 'delete');
            })).toEqual([exps[0], exps[2]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var experience = { id: 'e-1' };
            expect(expModule.checkScope({}, experience, 'experiences', 'read')).toBe(false);
            var user = { id: 'u-1234', org: 'o-1234' };
            expect(expModule.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions = {};
            expect(expModule.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences = {};
            user.permissions.orgs = { read: Scope.All };
            expect(expModule.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences.read = '';
            expect(expModule.checkScope(user, experience, 'experiences', 'read')).toBe(false);
            user.permissions.experiences.read = Scope.All;
            expect(expModule.checkScope(user, experience, 'experiences', 'read')).toBe(true);
        });
    });
    
    describe('canGetExperience', function() {
        var exp, user;
        beforeEach(function() {
            exp = { id: 'e1', status: Status.Pending, access: Access.Private };
            user = null;
            spyOn(expModule, 'checkScope').andReturn(false);
        });
        
        it('should let a guest see an active experience from outside cinema6.com', function() {
            expect(expModule.canGetExperience(exp, user, false)).toBe(false);
            exp.status = Status.Active;
            expect(expModule.canGetExperience(exp, user, false)).toBe(true);
            expect(expModule.canGetExperience(exp, user, true)).toBe(false);
        });
        
        it('should let a guest see a public experience from cinema6.com', function() {
            exp.access = Access.Public;
            expect(expModule.canGetExperience(exp, user, false)).toBe(false);
            expect(expModule.canGetExperience(exp, user, true)).toBe(true);
        });
        
        it('should let an authenticated user see an experience if their permissions are valid', function() {
            user = { foo: 'bar' };
            expect(expModule.canGetExperience(exp, user, false)).toBe(false);
            expModule.checkScope.andReturn(true);
            expect(expModule.canGetExperience(exp, user, false)).toBe(true);
            expect(expModule.checkScope).toHaveBeenCalledWith({foo: 'bar'}, exp, 'experiences', 'read');
        });
        
        it('should let a user see one of their authorized apps', function() {
            user = { id: 'u1', applications: ['e1'] };
            expect(expModule.canGetExperience(exp, user, false)).toBe(true);
        });
        
        it('should never let anyone see a deleted experience', function() {
            exp = { id: 'e1', status: Status.Deleted, access: Access.Public };
            expModule.checkScope.andReturn(true);
            expect(expModule.canGetExperience(exp, user, true)).toBe(false);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(expModule.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof expModule.createValidator._condForbidden.org).toBe('function');
            expect(typeof expModule.createValidator._condForbidden.user).toBe('function');
        });
        
        it('should prevent setting forbidden fields', function() {
            var exp = { id: 'foo', a: 'b' };
            expect(expModule.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { created: 'foo', a: 'b' };
            expect(expModule.createValidator.validate(exp, {}, {})).toBe(false);
            exp = { bar: 'foo', a: 'b' };
            expect(expModule.createValidator.validate(exp, {}, {})).toBe(true);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var user = { id: 'u-1234', org: 'o-1234', permissions: { experiences: { create: Scope.Org } } };
            var exp = { a: 'b', org: 'o-1234' };
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(true);
            
            exp.org = 'o-4567';
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.create = Scope.All;
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(true);
        });

        it('should conditionally prevent setting the user field', function() {
            var user = { id: 'u-1234', permissions: { experiences: { create: Scope.Org } } };
            var exp = { a: 'b', user: 'u-1234' };
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(true);
            
            exp.user = 'u-4567';
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.create = Scope.All;
            expect(expModule.createValidator.validate(exp, {}, user)).toBe(true);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initalized correctly', function() {
            expect(expModule.updateValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(typeof expModule.updateValidator._condForbidden.org).toBe('function');
            expect(typeof expModule.updateValidator._condForbidden.user).toBe('function');
        });

        it('should prevent setting forbidden fields', function() {
            var exp = { id: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(exp, {}, {})).toBe(false);
            exp = { created: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(exp, {}, {})).toBe(false);
            exp = { _id: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(exp, {}, {})).toBe(false);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var user = { id: 'u-1234', org: 'o-1234', permissions: { experiences: { edit: Scope.Org } } };
            var exp = { a: 'b', org: 'o-1234' };
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(true);
            
            exp.org = 'o-4567';
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.edit = Scope.All;
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(true);
        });

        it('should conditionally prevent setting the user field', function() {
            var user = { id: 'u-1234', permissions: { experiences: { edit: Scope.Org } } };
            var exp = { a: 'b', user: 'u-1234' };
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(true);
            
            exp.user = 'u-4567';
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(false);
            user.permissions.experiences.edit = Scope.All;
            expect(expModule.updateValidator.validate(exp, {}, user)).toBe(true);
        });
        
        it('should prevent illegal updates', function() {
            var updates = { id: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { org: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { created: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { bar: 'foo', a: 'b' };
            expect(expModule.updateValidator.validate(updates, {}, {})).toBe(true);
        });
    });
    
    describe('parseOrigin', function() {
        var req, siteExceptions;
        beforeEach(function() {
            req = { headers: { origin: 'http://staging.cinema6.com' } };
            siteExceptions = {
                public: ['demo.cinema6.com', 'www.cinema6.com'],
                cinema6: ['c-6.co', 'ci6.co']
            };
        });
        
        it('should parse the origin and setup various properties', function() {
            expModule.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://staging.cinema6.com');
            expect(req.originHost).toBe('staging.cinema6.com');
            expect(req.isC6Origin).toBe(true);
            expect(req.headers).toEqual({ origin: 'http://staging.cinema6.com' });
        });
        
        it('should use the referer header as a fallback', function() {
            req = { headers: { referer: 'http://portal.cinema6.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://portal.cinema6.com');
            req = { headers: { referer: 'http://portal.cinema6.com', origin: 'http://staging.cinema6.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://staging.cinema6.com');
        });
        
        it('should properly get the short version of the origin from the original', function() {
            [
                { url: 'http://foo.com/', originHost: 'foo.com' },
                { url: 'http://bar.foo.com/qwer', originHost: 'bar.foo.com' },
                { url: 'http://bar.foo.com?foo=bar', originHost: 'bar.foo.com' },
                { url: 'http://foo.com.uk', originHost: 'foo.com.uk' }
            ].forEach(function(test) {
                req = { headers: { origin: test.url } };
                expModule.parseOrigin(req, siteExceptions);
                expect(req.origin).toBe(test.url);
                expect(req.originHost).toBe(test.originHost);
            });
        });
        
        it('should properly decide if the origin is a cinema6 site using the siteExceptions', function() {
            req = { headers: { origin: 'http://google.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req = { headers: { origin: 'http://foo.demo.cinema6.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://www.cinema6.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req = { headers: { origin: 'http://demo.foo.cinema6.com' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://ci6.co/foo' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://c-6.co/foo' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://ca6.co/foo' } };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
        });
        
        it('should handle the case where the origin is not defined', function() {
            [{}, { headers: {} }, { headers: { origin: '' } }].forEach(function(testReq) {
                expModule.parseOrigin(testReq, siteExceptions);
                expect(testReq.origin).toBe('');
                expect(testReq.originHost).toBe('');
                expect(testReq.isC6Origin).toBe(false);
            });
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
            expect(expModule.formatOutput(experience)).toEqual({ id:'e1', data: { foo:'baz' }, versionId: 'v2' });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });
        
        it('should create a .title property from .data[0].data.title', function() {
            var now = new Date();
            experience = { id: 'e1', data: [
                { email: 'otter', date: now, data: { title: 'Cool Tapes', foo: 'baz' } },
                { email: 'crosby', date: now, data: { title: 'Not Cool Tapes', foo: 'bar' } }
            ]};
            expect(expModule.formatOutput(experience))
                .toEqual({ id: 'e1', title: 'Cool Tapes', data: {title: 'Cool Tapes', foo: 'baz'} });
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });

        it('should convert .status to .status[0].status for the client', function() {
            var now = new Date();
            experience = { id: 'e1', status: [
                { email: 'otter', date: now, status: Status.Deleted },
                { email: 'crosby', date: now, status: Status.Pending }
            ]};
            expect(expModule.formatOutput(experience).status).toBe(Status.Deleted);
            expect(mongoUtils.unescapeKeys).toHaveBeenCalled();
        });
        
        it('should set the lastStatusChange date to the most recent status change', function() {
            var now = new Date();
            experience = { id: 'e1', status: [
                { date: new Date(now + 1000), status: Status.Active },
                { date: now, status: Status.Pending }
            ]};
            expect(expModule.formatOutput(experience).lastStatusChange).toEqual(new Date(now + 1000));
            experience.status.push({date: new Date(now + 2000), status: Status.Pending});
            experience.status.push({date: new Date(now + 3000), status: Status.Active});
            expect(expModule.formatOutput(experience).lastStatusChange).toEqual(new Date(now + 3000));
        });
        
        it('should prevent a guest user from seeing certain fields', function() {
            experience = { id: 'e1', user: 'u1', org: 'o1' };
            expect(expModule.formatOutput(experience, true)).toEqual({id: 'e1'});
            expect(expModule.formatOutput(experience)).toEqual({id: 'e1', user: 'u1', org: 'o1'});
        });
    });

    describe('userPermQuery', function() {
        var query, user, origin, publicList;
        beforeEach(function() {
            query = { type: 'minireel' };
            user = { id: 'u-1', org: 'o-1', permissions: { experiences: { read: Scope.Own } } };
        });
        
        it('should just check that the experience is not deleted if the user is an admin', function() {
            user.permissions.experiences.read = Scope.All;
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted } });
            expect(query).toEqual({type: 'minireel'});
        });
        
        it('should not overwrite an existing query on the status field', function() {
            query['status.0.status'] = Status.Active;
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': Status.Active,
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the user owns the exp or if it\'s active if they have Scope.Own', function() {
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the org owns the exp or if it\'s active if they have Scope.Org', function() {
            user.permissions.experiences.read = Scope.Org;
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{org: 'o-1'}, {user: 'u-1'}, {'status.0.status': Status.Active}] });
        });
        
        it('should check if the exp is public instead if the origin is a cinema6 domain', function() {
            expect(expModule.userPermQuery(query, user, true))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { access: Access.Public } ] });
        });
        
        it('should append a check against their application list if the user has one', function() {
            user.applications = ['e1'];
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{user: 'u-1'}, {'status.0.status': Status.Active}, {id: {$in: ['e1']}}] });
        });
        
        it('should log a warning if the user has an invalid scope', function() {
            user.permissions.experiences.read = 'arghlblarghl';
            expect(expModule.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('formatTextQuery', function() {
        it('should split up the text string and format it into a regex', function() {
            expect(expModule.formatTextQuery({text: 'foo'}))
                .toEqual({'data.0.data.title': {$regex: '.*foo.*', $options: 'i'}});
            expect(expModule.formatTextQuery({text: ' foo bar.qwer '}))
                .toEqual({'data.0.data.title': {$regex: '.*foo.*bar.qwer.*', $options: 'i'}});
            expect(expModule.formatTextQuery({text: 'foo\tbar\nqwer '}))
                .toEqual({'data.0.data.title': {$regex: '.*foo.*bar.*qwer.*', $options: 'i'}});
        });
    });
    
    describe('getAdConfig', function() {
        var orgCache, exp, mockOrg;
        beforeEach(function() {
            mockOrg = { id: 'o-1', status: Status.Active, adConfig: { foo: 'bar' } };
            exp = { id: 'e-1', data: { good: 'yes' } };
            orgCache = { getPromise: jasmine.createSpy('orgCache.getPromise').andReturn(q([mockOrg])) };
        });
        
        it('should do nothing if the experience has no data', function(done) {
            delete exp.data;
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({id: 'e-1'});
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the experience already has an adConfig property', function(done) {
            exp.data.adConfig = { foo: 'baz' };
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'baz' } } });
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully put the org\'s adConfig on the experience', function(done) {
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'bar' } } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the org could not be found', function(done) {
            orgCache.getPromise.andReturn(q([]));
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should do nothing if the org is not active', function(done) {
            mockOrg.status = Status.Deleted;
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the org has no adConfig', function(done) {
            delete mockOrg.adConfig;
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getPromise returns a rejected promise', function(done) {
            orgCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).done(done);
        });
    });
    
    describe('buildHostQuery', function() {
        it('should correctly build a query from a hostname', function() {
            expect(expModule.buildHostQuery('foo.com', 'a')).toEqual({host:{$in:['foo.com']}});
            expect(expModule.buildHostQuery('foo.bar.com', 'b')).toEqual({host:{$in:['foo.bar.com','bar.com']}});
            expect(expModule.buildHostQuery('foo.bar.baz.com', 'c')).toEqual({host:{$in:['foo.bar.baz.com','bar.baz.com','baz.com']}});
            expect(expModule.buildHostQuery('localhost')).toEqual({host:{$in:['localhost']}});
            expect(expModule.buildHostQuery('', 'd')).toEqual(null);
            expect(expModule.buildHostQuery('portal.cinema6.com')).toEqual({host:{$in:['portal.cinema6.com','cinema6.com']}});
        });
        
        it('should override the query if the container is veeseo or connatix', function() {
            expect(expModule.buildHostQuery('foo.com', 'veeseo')).toEqual({host: 'cinema6.com'});
            expect(expModule.buildHostQuery('', 'veeseo')).toEqual({host: 'cinema6.com'});
            expect(expModule.buildHostQuery('foo.com', 'connatix')).toEqual({host: 'cinema6.com'});
            expect(expModule.buildHostQuery('', 'connatix')).toEqual({host: 'cinema6.com'});
        });
    });
    
    describe('chooseSite', function() {
        var sites;
        beforeEach(function() {
            sites = [
                { id: 's1', status: Status.Active, host: 'foo' },
                { id: 's2', status: Status.Active, host: 'foobar' },
                { id: 's3', status: Status.Active, host: 'foob' }
            ];
        });

        it('should choose the site with the longest host property', function() {
            expect(expModule.chooseSite(sites)).toEqual({id: 's2', status: Status.Active, host: 'foobar'});
        });
        
        it('should not choose inactive sites', function() {
            sites[1].status = Status.Inactive;
            expect(expModule.chooseSite(sites)).toEqual({id: 's3', status: Status.Active, host: 'foob'});
            sites[0].status = Status.Deleted;
            sites[2].status = Status.Inactive;
            expect(expModule.chooseSite(sites)).toBe(null);
        });
        
        it('should handle arrays with 0 or 1 sites', function() {
            expect(expModule.chooseSite([])).toBe(null);
            expect(expModule.chooseSite([sites[0]])).toEqual({id: 's1', status: Status.Active, host: 'foo'});
        });
    });
    
    describe('chooseBranding', function() {
        beforeEach(function() {
            expModule.brandCache = {};
        });
        
        it('should just return the brandString if it\'s undefined or not a csv list', function() {
            expect(expModule.chooseBranding(null, 's-1', 'e-1')).toBe(null);
            expect(expModule.chooseBranding('', 's-1', 'e-1')).toBe('');
            expect(expModule.chooseBranding('asdf,', 's-1', 'e-1')).toBe('asdf,');
        });

        it('should cycle through a list of brandings', function() {
            expect(expModule.chooseBranding('foo,bar,baz', 's-1', 'e-1')).toBe('foo');
            expect(expModule.brandCache['s-1:foo,bar,baz']).toBe(1);
            expect(expModule.chooseBranding('foo,bar,baz', 's-1', 'e-1')).toBe('bar');
            expect(expModule.chooseBranding('foo,bar,baz', 's-1', 'e-1')).toBe('baz');
            expect(expModule.chooseBranding('foo,bar,baz', 's-1', 'e-1')).toBe('foo');
        });
        
        it('should maintain separate lists for different combos of prefix + brandString', function() {
            expect(expModule.chooseBranding('foo,bar,baz', 's-1', 'e-1')).toBe('foo');
            expect(expModule.chooseBranding('foo,bar,baz,buz', 's-1', 'e-1')).toBe('foo');
            expect(expModule.chooseBranding('foo,bar,baz', 'o-1', 'e-1')).toBe('foo');
            expect(expModule.brandCache).toEqual({'s-1:foo,bar,baz': 1, 's-1:foo,bar,baz,buz': 1, 'o-1:foo,bar,baz': 1});
        });
    });

    describe('getSiteConfig', function() {
        var exp, queryParams, host, mockSite, mockOrg, siteCache, orgCache, defaultSiteCfg;
        beforeEach(function() {
            exp = { id: 'e-1', data: { foo: 'bar' } };
            mockSite = { id: 's-1', status: Status.Active, branding: 'siteBrand', placementId: 456, wildCardPlacement: 654 };
            mockOrg = { id: 'o-1', status: Status.Active, branding: 'orgBrand' };
            queryParams = { branding: 'widgetBrand', placementId: 123, wildCardPlacement: 321 };
            host = 'games.wired.com';
            siteCache = { getPromise: jasmine.createSpy('siteCache.getPromise').andReturn(q(['fake1', 'fake2'])) };
            orgCache = { getPromise: jasmine.createSpy('orgCache.getPromise').andReturn(q([mockOrg])) };
            defaultSiteCfg = { branding: 'c6', placementId: 789, wildCardPlacement: 987 };
            spyOn(expModule, 'buildHostQuery').andCallThrough();
            spyOn(expModule, 'chooseSite').andReturn(mockSite);
            spyOn(expModule, 'chooseBranding').andCallThrough();
        });
        
        it('should log a warning if the experience has no data', function(done) {
            delete exp.data;
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({ id: 'e-1' });
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the experience\'s properties if they\'re defined', function(done) {
            exp.data = { branding: 'expBranding', placementId: 234, wildCardPlacement: 543 };
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {branding: 'expBranding', placementId: 234, wildCardPlacement: 543}});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(expModule.chooseBranding).toHaveBeenCalledWith('expBranding', 'e-1', 'e-1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the queryParam properties if defined', function(done) {
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                    branding: 'widgetBrand', placementId: 123, wildCardPlacement: 321 }});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(expModule.chooseBranding).toHaveBeenCalledWith('widgetBrand', 'queryParams', 'e-1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the queryParams being incomplete', function(done) {
            queryParams = {};
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar', branding: 'siteBrand',
                                                       placementId: 456, wildCardPlacement: 654}});
                expect(siteCache.getPromise).toHaveBeenCalledWith({host: {$in: ['games.wired.com', 'wired.com']}});
                expect(expModule.buildHostQuery).toHaveBeenCalledWith('games.wired.com', undefined);
                expect(expModule.chooseSite).toHaveBeenCalledWith(['fake1', 'fake2']);
                expect(expModule.chooseBranding).toHaveBeenCalledWith('siteBrand', 's-1', 'e-1');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass the container param to buildHostQuery if defined', function(done) {
            queryParams = { container: 'largeBox' };
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar', branding: 'siteBrand',
                                                       placementId: 456, wildCardPlacement: 654}});
                expect(expModule.buildHostQuery).toHaveBeenCalledWith('games.wired.com', 'largeBox');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('fetching container', function(done) {
            beforeEach(function() {
                expModule.chooseSite.andReturn({id: 's-2', host: 'foo.com', branding: 'siteBrand', containers: [
                    { id: 'embed', contentPlacementId: 12, displayPlacementId: 13 },
                    { id: 'mr2', contentPlacementId: 14, displayPlacementId: 15 }
                ], placementId: 11, wildCardPlacement: 22 });
                queryParams = { container: 'embed' };
            });
            
            it('should take placement ids from the matching container', function(done) {
                expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
                .then(function(exp) {
                    expect(exp.data).toEqual({foo:'bar',branding:'siteBrand',placementId:13,wildCardPlacement:12});
                    expect(orgCache.getPromise).not.toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(expModule.chooseBranding).toHaveBeenCalledWith('siteBrand', 's-2', 'e-1');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should fall back to the site params if there are no matching containers', function(done) {
                queryParams.container = 'taboola';
                expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
                .then(function(exp) {
                    expect(exp.data).toEqual({foo:'bar',branding:'siteBrand',placementId:11,wildCardPlacement:22});
                    expect(orgCache.getPromise).not.toHaveBeenCalled();
                    expect(mockLog.warn).toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should not try to get the site if the host is not defined', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            expModule.getSiteConfig(exp, 'o-1', queryParams, '', siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
                expect(expModule.chooseBranding).toHaveBeenCalledWith('orgBrand', 'o-1', 'e-1');
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should next fall back to the org\'s config', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
                expect(mockLog.info).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the site object not having necessary props', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn([{id: 's-1'}]);
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use the default config as a last resort', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q([]));
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'c6', placementId: 789, wildCardPlacement: 987}});
                expect(expModule.chooseBranding).toHaveBeenCalledWith('c6', 'default', 'e-1');
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the org object not having a branding', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q([{id: 'o-1'}]));
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'c6', placementId: 789, wildCardPlacement: 987}});
                expect(orgCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not use the org if it is not active', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            mockOrg.status = Status.Deleted;
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'c6', placementId: 789, wildCardPlacement: 987}});
                expect(orgCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be able to get props from different sources', function(done) {
            exp.data.branding = 'expBranding';
            queryParams = {};
            expModule.chooseSite.andReturn({id :'w-1', wildCardPlacement: 876});
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'expBranding', placementId: 789, wildCardPlacement: 876}});
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if siteCache.getPromise returns a rejected promise', function(done) {
            queryParams = {};
            siteCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if orgCache.getPromise returns a rejected promise', function(done) {
            queryParams = {};
            expModule.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(siteCache.getPromise).toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('swapCard', function() {
        var req, exp, camp, cardSvc;
        beforeEach(function() {
            req = { uuid: '1234', query: {} };
            exp = { id: 'e-1', data: { deck: [
                { id: 'rc-p1', title: 'placeholder 1' },
                { id: 'rc-real1', title: 'card 1' },
                { id: 'rc-p2', title: 'placeholder 2' }
            ] } };
            camp = {
                id: 'cam-1',
                cards: [{id: 'rc-1', adtechId: 11}, {id: 'rc-2', adtechId: 12}],
                staticCardMap: { 'e-1': { 'rc-p1': 'rc-2', 'rc-p2': 'rc-fake' } }
            };
            cardSvc = { getPublicCard: jasmine.createSpy('getPubCard').andCallFake(function(newId, req) {
                return q({ id: newId, title: 'sp card ' + newId });
            }) };
        });
        
        it('should swap a placeholder with a card retrieved from the cardSvc', function(done) {
            expModule.swapCard(req, exp, 0, camp, cardSvc).then(function() {
                expect(exp.data.deck).toEqual([
                    { id: 'rc-2', title: 'sp card rc-2', adtechId: 12 },
                    { id: 'rc-real1', title: 'card 1' },
                    { id: 'rc-p2', title: 'placeholder 2' }
                ]);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the card is not in the campaign\'s cards list', function(done) {
            expModule.swapCard(req, exp, 2, camp, cardSvc).then(function() {
                expect(exp.data.deck[2]).toEqual({ id: 'rc-p2', title: 'placeholder 2' });
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the entry in the campaign\'s cards list has no adtechId', function(done) {
            delete camp.cards[1].adtechId;
            expModule.swapCard(req, exp, 0, camp, cardSvc).then(function() {
                expect(exp.data.deck[0]).toEqual({ id: 'rc-p1', title: 'placeholder 1' });
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not append the adtechId if req.query.preview = true', function(done) {
            req.query.preview = 'true';
            expModule.swapCard(req, exp, 0, camp, cardSvc).then(function() {
                expect(exp.data.deck[0]).toEqual({ id: 'rc-2', title: 'sp card rc-2' });
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the card cannot be found', function(done) {
            cardSvc.getPublicCard.andReturn(q());
            expModule.swapCard(req, exp, 0, camp, cardSvc).then(function() {
                expect(exp.data.deck[0]).toEqual({ id: 'rc-p1', title: 'placeholder 1' });
                expect(cardSvc.getPublicCard).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the card service fails', function(done) {
            cardSvc.getPublicCard.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.swapCard(req, exp, 0, camp, cardSvc).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(exp.data.deck[0]).toEqual({ id: 'rc-p1', title: 'placeholder 1' });
                expect(cardSvc.getPublicCard).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('handleCampaign', function() {
        var req, exp, campCache, cardSvc, mockCamp;
        beforeEach(function() {
            req = { uuid: '1234' };
            exp = { id: 'e-1', data: { deck: [
                { id: 'rc-p1', title: 'placeholder 1' },
                { id: 'rc-real1', title: 'card 1' },
                { id: 'rc-p2', title: 'placeholder 2' },
                { id: 'rc-p3', title: 'placeholder 3' }
            ] } };
            mockCamp = {
                id: 'cam-1',
                status: Status.Active,
                staticCardMap: { 'e-1': { 'rc-p1': 'rc-2', 'rc-p2': 'rc-3' } }
            };
            campCache = { getPromise: jasmine.createSpy('getPromise').andCallFake(function() { return q([mockCamp]); }) };
            cardSvc = 'fakeCardSvc';
            spyOn(expModule, 'swapCard').andReturn(q());
        });
        
        it('should get the campaign and call swapCard for each mapping the staticCardMap', function(done) {
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).toEqual({id: 'e-1', data: { deck: [
                    { id: 'rc-p1', title: 'placeholder 1' },
                    { id: 'rc-real1', title: 'card 1' },
                    { id: 'rc-p2', title: 'placeholder 2' },
                    { id: 'rc-p3', title: 'placeholder 3' }
                ] } });
                expect(campCache.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(expModule.swapCard.calls.length).toBe(2);
                expect(expModule.swapCard).toHaveBeenCalledWith(req, exp, 0, mockCamp, 'fakeCardSvc');
                expect(expModule.swapCard).toHaveBeenCalledWith(req, exp, 2, mockCamp, 'fakeCardSvc');
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if there\'s no campaign id', function(done) {
            expModule.handleCampaign(req, exp, undefined, campCache, cardSvc).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).not.toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the experience has no cards', function(done) {
            var exps = [{ id: 'e-1' }, { id: 'e-1', data: {} }, { id: 'e-1', data: { deck: [] } }];
            q.all(exps.map(function(obj) {
                return expModule.handleCampaign(req, obj, 'cam-1', campCache, cardSvc).then(function(resp) {
                    expect(resp).toBe(obj);
                });
            })).then(function(results) {
                expect(campCache.getPromise).not.toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the campaign has no staticCardMap', function(done) {
            delete mockCamp.staticCardMap;
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if the campaign has no mapping for the current experience', function(done) {
            exp.id = 'e-2';
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the campaign is not found or not active', function(done) {
            mockCamp.status = Status.Inactive;
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).toBe(exp);
                campCache.getPromise.andReturn(q([]));
                return expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc);
            }).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should defend against query selection injector attacks', function(done) {
            expModule.handleCampaign(req, exp, {$gt: ''}, campCache, cardSvc).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalledWith({id: '[object Object]'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if retrieving the campaign fails', function(done) {
            campCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if one of the swapCard calls fails', function(done) {
            expModule.swapCard.andCallFake(function(req, exp, idx, camp, cardSvc) {
                if (idx === 0) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            expModule.handleCampaign(req, exp, 'cam-1', campCache, cardSvc).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard.calls.length).toBe(2);
            }).done(done);
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

        it('should trim off certain fields not allowed on the top-level', function() {
            updates = { title: 'this is a title', versionId: 'thabestversion',
                        lastStatusChange: 'yesterday', tag: 'bloop' };
            expModule.formatUpdates(req, orig, updates, user);
            expect(updates).toEqual({tag: 'bloop', lastUpdated: jasmine.any(Date)});
        });
        
        it('should append a new status entry on each change', function() {
            updates.status = Status.Deleted;
            expModule.formatUpdates(req, orig, updates, user);
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
        
        it('should update the first data entry if the req data differs from the original', function() {
            updates.data = {foo: 'baz'};
            expModule.formatUpdates(req, orig, updates, user);
            expect(updates.data instanceof Array).toBe(true);
            expect(updates.data.length).toBe(1);
            expect(updates.data[0].user).toBe('otter');
            expect(updates.data[0].userId).toBe('u-1');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'baz'});
            expect(updates.data[0].versionId).toBe('version2');
        });

        it('should prune out updates to the status and data if there\'s no change', function() {
            updates = { tag: 'bloop', data: { foo: 'bar' }, status: Status.Pending };
            expModule.formatUpdates(req, orig, updates, user);
            expect(updates).toEqual({tag: 'bloop', lastUpdated: jasmine.any(Date)});
        });
        
        it('should turn the data and status props into arrays if necessary', function() {
            updates = { data: { foo: 'bar' }, status: Status.Deleted };
            orig.data = { foo: 'bar' };
            orig.status = Status.Active;
            expModule.formatUpdates(req, orig, updates, user);
            expect(updates.data.length).toBe(1);
            expect(updates.status.length).toBe(2);
            expect(updates.data[0].user).toBe('otter');
            expect(updates.data[0].userId).toBe('u-1');
            expect(updates.data[0].date).toBeGreaterThan(start);
            expect(updates.data[0].data).toEqual({foo: 'bar'});
            expect(updates.data[0].versionId).toBe('version1');
            expect(updates.status[0].user).toBe('otter');
            expect(updates.status[0].userId).toBe('u-1');
            expect(updates.status[0].date).toBeGreaterThan(start);
            expect(updates.status[0].status).toBe(Status.Deleted);
            expect(updates.status[1].user).toBe('otter');
            expect(updates.status[1].userId).toBe('u-1');
            expect(updates.status[1].date).toBe(start);
            expect(updates.status[1].status).toBe(Status.Active);
        });
    });
});
