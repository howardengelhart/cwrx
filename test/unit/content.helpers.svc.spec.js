var flush = true;
describe('content (UT)', function() {
    var mockLog, mockLogger, uuid, logger, content, q, FieldValidator, mongoUtils,
        enums, Status, Scope, Access;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        content         = require('../../bin/content');
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
        spyOn(content, 'formatOutput').andCallThrough();
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
        var exp, user;
        beforeEach(function() {
            exp = { id: 'e1', status: Status.Pending, access: Access.Private };
            user = null;
            spyOn(content, 'checkScope').andReturn(false);
        });
        
        it('should let a guest see an active experience from outside cinema6.com', function() {
            expect(content.canGetExperience(exp, user, false)).toBe(false);
            exp.status = Status.Active;
            expect(content.canGetExperience(exp, user, false)).toBe(true);
            origin = 'http://staging.cinema6.com';
            expect(content.canGetExperience(exp, user, true)).toBe(false);
        });
        
        it('should let a guest see a public experience from cinema6.com', function() {
            exp.access = Access.Public;
            expect(content.canGetExperience(exp, user, false)).toBe(false);
            origin = 'http://staging.cinema6.com';
            expect(content.canGetExperience(exp, user, true)).toBe(true);
        });
        
        it('should let an authenticated user see an experience if their permissions are valid', function() {
            user = { foo: 'bar' };
            expect(content.canGetExperience(exp, user, false)).toBe(false);
            content.checkScope.andReturn(true);
            expect(content.canGetExperience(exp, user, false)).toBe(true);
            expect(content.checkScope).toHaveBeenCalledWith({foo: 'bar'}, exp, 'experiences', 'read');
        });
        
        it('should let a user see one of their authorized apps', function() {
            user = { id: 'u1', applications: ['e1'] };
            expect(content.canGetExperience(exp, user, false)).toBe(true);
        });
        
        it('should never let anyone see a deleted experience', function() {
            exp = { id: 'e1', status: Status.Deleted, access: Access.Public };
            content.checkScope.andReturn(true);
            expect(content.canGetExperience(exp, user, true)).toBe(false);
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
            content.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://staging.cinema6.com');
            expect(req.originHost).toBe('staging.cinema6.com');
            expect(req.isC6Origin).toBe(true);
            expect(req.headers).toEqual({ origin: 'http://staging.cinema6.com' });
        });
        
        it('should use the referer header as a fallback', function() {
            req = { headers: { referer: 'http://portal.cinema6.com' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://portal.cinema6.com');
            req = { headers: { referer: 'http://portal.cinema6.com', origin: 'http://staging.cinema6.com' } };
            content.parseOrigin(req, siteExceptions);
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
                content.parseOrigin(req, siteExceptions);
                expect(req.origin).toBe(test.url);
                expect(req.originHost).toBe(test.originHost);
            });
        });
        
        it('should properly decide if the origin is a cinema6 site using the siteExceptions', function() {
            req = { headers: { origin: 'http://google.com' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req = { headers: { origin: 'http://foo.demo.cinema6.com' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://www.cinema6.com' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req = { headers: { origin: 'http://demo.foo.cinema6.com' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://ci6.co/foo' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://c-6.co/foo' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req = { headers: { origin: 'http://ca6.co/foo' } };
            content.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
        });
        
        it('should handle the case where the origin is not defined', function() {
            [{}, { headers: {} }, { headers: { origin: '' } }].forEach(function(testReq) {
                content.parseOrigin(testReq, siteExceptions);
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

    describe('userPermQuery', function() {
        var query, user, origin, publicList;
        beforeEach(function() {
            query = { type: 'minireel' };
            user = { id: 'u-1', org: 'o-1', permissions: { experiences: { read: Scope.Own } } };
        });
        
        it('should just check that the experience is not deleted if the user is an admin', function() {
            user.permissions.experiences.read = Scope.All;
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted } });
            expect(query).toEqual({type: 'minireel'});
        });
        
        it('should not overwrite an existing query on the status field', function() {
            query['status.0.status'] = Status.Active;
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': Status.Active,
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the user owns the exp or if it\'s active if they have Scope.Own', function() {
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
        });
        
        it('should check if the org owns the exp or if it\'s active if they have Scope.Org', function() {
            user.permissions.experiences.read = Scope.Org;
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{org: 'o-1'}, {user: 'u-1'}, {'status.0.status': Status.Active}] });
        });
        
        it('should check if the exp is public instead if the origin is a cinema6 domain', function() {
            expect(content.userPermQuery(query, user, true))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { access: Access.Public } ] });
        });
        
        it('should append a check against their application list if the user has one', function() {
            user.applications = ['e1'];
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [{user: 'u-1'}, {'status.0.status': Status.Active}, {id: {$in: ['e1']}}] });
        });
        
        it('should log a warning if the user has an invalid scope', function() {
            user.permissions.experiences.read = 'arghlblarghl';
            expect(content.userPermQuery(query, user, false))
                .toEqual({ type: 'minireel', 'status.0.status': { $ne: Status.Deleted },
                           $or: [ { user: 'u-1' }, { 'status.0.status': Status.Active } ] });
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('formatTextQuery', function() {
        it('should split up the text string and format it into a regex', function() {
            expect(content.formatTextQuery({text: 'foo'}))
                .toEqual({'data.0.data.title': {$regex: '.*foo.*', $options: 'i'}});
            expect(content.formatTextQuery({text: ' foo bar.qwer '}))
                .toEqual({'data.0.data.title': {$regex: '.*foo.*bar.qwer.*', $options: 'i'}});
            expect(content.formatTextQuery({text: 'foo\tbar\nqwer '}))
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
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({id: 'e-1'});
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the experience already has an adConfig property', function(done) {
            exp.data.adConfig = { foo: 'baz' };
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'baz' } } });
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully put the org\'s adConfig on the experience', function(done) {
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes', adConfig: { foo: 'bar' } } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the org could not be found', function(done) {
            orgCache.getPromise.andReturn(q([]));
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should do nothing if the org is not active', function(done) {
            mockOrg.status = Status.Deleted;
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if the org has no adConfig', function(done) {
            delete mockOrg.adConfig;
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).toEqual({ id: 'e-1', data: { good: 'yes' } });
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if getPromise returns a rejected promise', function(done) {
            orgCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'))
            content.getAdConfig(exp, 'o-1', orgCache).then(function(result) {
                expect(result).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(orgCache.getPromise).toHaveBeenCalledWith({id: 'o-1'});
            }).done(done);
        });
    });
    
    describe('buildHostQuery', function() {
        it('should correctly build a query from a hostname', function() {
            expect(content.buildHostQuery('foo.com')).toEqual({host:{$in:['foo.com']}});
            expect(content.buildHostQuery('foo.bar.com')).toEqual({host:{$in:['foo.bar.com','bar.com']}});
            expect(content.buildHostQuery('foo.bar.baz.com')).toEqual({host:{$in:['foo.bar.baz.com','bar.baz.com','baz.com']}});
            expect(content.buildHostQuery('localhost')).toEqual({host:{$in:['localhost']}});
            expect(content.buildHostQuery('')).toEqual({host:{$in:['']}});
            expect(content.buildHostQuery('portal.cinema6.com')).toEqual({host:{$in:['portal.cinema6.com','cinema6.com']}});
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
            expect(content.chooseSite(sites)).toEqual({id: 's2', status: Status.Active, host: 'foobar'});
        });
        
        it('should not choose inactive sites', function() {
            sites[1].status = Status.Inactive;
            expect(content.chooseSite(sites)).toEqual({id: 's3', status: Status.Active, host: 'foob'});
            sites[0].status = Status.Deleted;
            sites[2].status = Status.Inactive;
            expect(content.chooseSite(sites)).toBe(null);
        });
        
        it('should handle arrays with 0 or 1 sites', function() {
            expect(content.chooseSite([])).toBe(null);
            expect(content.chooseSite([sites[0]])).toEqual({id: 's1', status: Status.Active, host: 'foo'});
        });
    });

    describe('getSiteConfig', function() {
        var exp, queryParams, host, mockSite, mockOrg, siteCache, orgCache, defaultSiteCfg;
        beforeEach(function() {
            exp = { id: 'e-1', data: { foo: 'bar' } };
            mockSite = { id: 's-1', status: Status.Active, branding: 'siteBrand', placementId: 456, wildCardPlacement: 654 };
            mockOrg = { id: 'o-1', status: Status.Active, branding: 'orgBrand' };
            queryParams = { context: 'embed', branding: 'widgetBrand', placementId: 123, wildCardPlacement: 321 };
            host = 'games.wired.com';
            siteCache = { getPromise: jasmine.createSpy('siteCache.getPromise').andReturn(q(['fake1', 'fake2'])) };
            orgCache = { getPromise: jasmine.createSpy('orgCache.getPromise').andReturn(q([mockOrg])) };
            defaultSiteCfg = { branding: 'c6', placementId: 789, wildCardPlacement: 987 };
            spyOn(content, 'buildHostQuery').andCallThrough();
            spyOn(content, 'chooseSite').andReturn(mockSite);
        });
        
        it('should log a warning if the experience has no data', function(done) {
            delete exp.data;
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
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
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {branding: 'expBranding', placementId: 234, wildCardPlacement: 543}});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should overwrite the existing mode if the context is mr2', function(done) {
            queryParams.context = 'mr2';
            exp.data = { branding: 'expBranding', placementId: 234, wildCardPlacement: 543, mode: 'not-lightbox' };
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {branding: 'expBranding', placementId: 234,
                                     wildCardPlacement: 543, mode: 'lightbox'}});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return the queryParam properties if the context is mr2', function(done) {
            queryParams.context = 'mr2';
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar', mode: 'lightbox',
                                    branding: 'widgetBrand', placementId: 123, wildCardPlacement: 321 }});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the queryParams being incomplete', function(done) {
            queryParams = { context: 'mr2' };
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar', mode: 'lightbox',
                                     branding: 'siteBrand', placementId: 456, wildCardPlacement: 654}});
                expect(siteCache.getPromise).toHaveBeenCalledWith({host: {$in: ['games.wired.com', 'wired.com']}});
                expect(content.buildHostQuery).toHaveBeenCalledWith('games.wired.com');
                expect(content.chooseSite).toHaveBeenCalledWith(['fake1', 'fake2']);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fall back on the site\'s config', function(done) {
            queryParams.context = 'embed';
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'siteBrand', placementId: 456, wildCardPlacement: 654}});
                expect(siteCache.getPromise).toHaveBeenCalledWith({host: {$in: ['games.wired.com', 'wired.com']}})
                expect(orgCache.getPromise).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not try to get the site if the host is not defined', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            content.getSiteConfig(exp, 'o-1', queryParams, '', siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).not.toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should next fall back to the org\'s config', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the site object not having necessary props', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn([{id: 's-1'}]);
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'orgBrand', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use the default config as a last resort', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q([]));
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'c6', placementId: 789, wildCardPlacement: 987}});
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle the org object not having a branding', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q([{id: 'o-1'}]));
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'c6', placementId: 789, wildCardPlacement: 987}});
                expect(orgCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not use the org if it is not active', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            mockOrg.status = Status.Deleted;
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
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
            queryParams.context = 'embed';
            content.chooseSite.andReturn({id :'w-1', wildCardPlacement: 876});
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).toEqual({id: 'e-1', data: {foo: 'bar',
                                     branding: 'expBranding', placementId: 789, wildCardPlacement: 876}});
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if siteCache.getPromise returns a rejected promise', function(done) {
            queryParams.context = 'embed';
            siteCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(siteCache.getPromise).toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if orgCache.getPromise returns a rejected promise', function(done) {
            queryParams.context = 'embed';
            content.chooseSite.andReturn(null);
            orgCache.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            content.getSiteConfig(exp, 'o-1', queryParams, host, siteCache, orgCache, defaultSiteCfg)
            .then(function(exp) {
                expect(exp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(siteCache.getPromise).toHaveBeenCalled();
                expect(orgCache.getPromise).toHaveBeenCalled();
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
});
