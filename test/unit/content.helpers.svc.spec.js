var flush = true;
describe('content (UT)', function() {
    var urlUtils, mockLog, mockLogger, uuid, logger, expModule, q, FieldValidator, mongoUtils,
        enums, Status, Scope, Access, req;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        urlUtils        = require('url');
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
        spyOn(logger, 'createLog').and.returnValue(mockLog);
        spyOn(logger, 'getLog').and.returnValue(mockLog);
        spyOn(expModule, 'formatOutput').and.callThrough();
        spyOn(mongoUtils, 'escapeKeys').and.callThrough();
        spyOn(mongoUtils, 'unescapeKeys').and.callThrough();
        
        req = { uuid: '1234', params: {}, query: {} };
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
            spyOn(expModule, 'checkScope').and.returnValue(false);
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
            expModule.checkScope.and.returnValue(true);
            expect(expModule.canGetExperience(exp, user, false)).toBe(true);
            expect(expModule.checkScope).toHaveBeenCalledWith({foo: 'bar'}, exp, 'experiences', 'read');
        });
        
        it('should let a user see one of their authorized apps', function() {
            user = { id: 'u1', applications: ['e1'] };
            expect(expModule.canGetExperience(exp, user, false)).toBe(true);
        });
        
        it('should never let anyone see a deleted experience', function() {
            exp = { id: 'e1', status: Status.Deleted, access: Access.Public };
            expModule.checkScope.and.returnValue(true);
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
        var siteExceptions;
        beforeEach(function() {
            req.headers = { origin: 'http://staging.cinema6.com' };
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
            req.headers = { referer: 'http://portal.cinema6.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.origin).toBe('http://portal.cinema6.com');
            req.headers = { referer: 'http://portal.cinema6.com', origin: 'http://staging.cinema6.com' };
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
                req.headers = { origin: test.url };
                expModule.parseOrigin(req, siteExceptions);
                expect(req.origin).toBe(test.url);
                expect(req.originHost).toBe(test.originHost);
            });
        });
        
        it('should properly decide if the origin is a cinema6 site using the siteExceptions', function() {
            req.headers = { origin: 'http://google.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req.headers = { origin: 'http://foo.demo.cinema6.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req.headers = { origin: 'http://www.cinema6.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
            req.headers = { origin: 'http://demo.foo.cinema6.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req.headers = { origin: 'http://ci6.co/foo' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req.headers = { origin: 'http://c-6.co/foo' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req.headers = { origin: 'http://ca6.co/foo' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(false);
        });
        
        it('should treat reelcontent.com hosts as internal sites', function() {
            req.headers = { origin: 'http://reelcontent.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
            req.headers = { origin: 'http://platform.reelcontent.com' };
            expModule.parseOrigin(req, siteExceptions);
            expect(req.isC6Origin).toBe(true);
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
                .toEqual({ id: 'e1', title: 'Cool Tapes', data: {title: 'Cool Tapes', foo: 'baz'}, versionId: undefined });
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

        it('should preserve existing $or clauses', function() {
            user.permissions.experiences.read = Scope.Org;
            query.$or = [ { a: 1 }, { b: 2 } ];
            expect(expModule.userPermQuery(query, user, false)).toEqual({
                type: 'minireel',
                'status.0.status': { $ne: Status.Deleted },
                $and: [
                    { $or: [ { a: 1 }, { b: 2 } ] },
                    { $or: [ { org: 'o-1' }, { user: 'u-1' }, { 'status.0.status': 'active' } ] }
                ]
            });
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
    
    describe('swapCard', function() {
        var exp, camp, cardSvc;
        beforeEach(function() {
            exp = { id: 'e-1', data: { deck: [
                { id: 'rc-p1', title: 'placeholder 1' },
                { id: 'rc-real1', title: 'card 1' },
                { id: 'rc-p2', title: 'placeholder 2' }
            ] } };
            camp = {
                id: 'cam-1',
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }],
                staticCardMap: { 'e-1': { 'rc-p1': 'rc-2', 'rc-p2': 'rc-fake' } }
            };
            cardSvc = { getPublicCard: jasmine.createSpy('getPubCard').and.callFake(function(newId, req) {
                return q({ id: newId, title: 'sp card ' + newId });
            }) };
        });
        
        it('should swap a placeholder with a card retrieved from the cardSvc', function(done) {
            expModule.swapCard(cardSvc, camp, exp, 0, req).then(function() {
                expect(exp.data.deck).toEqual([
                    { id: 'rc-2', title: 'sp card rc-2' },
                    { id: 'rc-real1', title: 'card 1' },
                    { id: 'rc-p2', title: 'placeholder 2' }
                ]);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the card cannot be found', function(done) {
            cardSvc.getPublicCard.and.returnValue(q());
            expModule.swapCard(cardSvc, camp, exp, 0, req).then(function() {
                expect(exp.data.deck[0]).toEqual({ id: 'rc-p1', title: 'placeholder 1' });
                expect(cardSvc.getPublicCard).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the card service fails', function(done) {
            cardSvc.getPublicCard.and.returnValue(q.reject('I GOT A PROBLEM'));
            expModule.swapCard(cardSvc, camp, exp, 0, req).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(exp.data.deck[0]).toEqual({ id: 'rc-p1', title: 'placeholder 1' });
                expect(cardSvc.getPublicCard).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('handleCampaign', function() {
        var exp, campCache, cardSvc, mockCamp;
        beforeEach(function() {
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
            campCache = { getPromise: jasmine.createSpy('getPromise').and.callFake(function() { return q([mockCamp]); }) };
            cardSvc = 'fakeCardSvc';
            spyOn(expModule, 'swapCard').and.returnValue(q());
        });
        
        it('should get the campaign and call swapCard for each mapping the staticCardMap', function(done) {
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                expect(resp).toEqual({id: 'e-1', data: { deck: [
                    { id: 'rc-p1', title: 'placeholder 1' },
                    { id: 'rc-real1', title: 'card 1' },
                    { id: 'rc-p2', title: 'placeholder 2' },
                    { id: 'rc-p3', title: 'placeholder 3' }
                ] } });
                expect(campCache.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(expModule.swapCard.calls.count()).toBe(2);
                expect(expModule.swapCard).toHaveBeenCalledWith('fakeCardSvc', mockCamp, exp, 0, req);
                expect(expModule.swapCard).toHaveBeenCalledWith('fakeCardSvc', mockCamp, exp, 2, req);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should skip if there\'s no campaign id', function(done) {
            expModule.handleCampaign(cardSvc, campCache, undefined, exp, req).then(function(resp) {
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
                return expModule.handleCampaign(cardSvc, campCache, 'cam-1', obj, req).then(function(resp) {
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
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
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
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should log a warning if the campaign is not found', function(done) {
            campCache.getPromise.and.returnValue(q([]));
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the campaign is not running', function(done) {
            q.all([Status.Canceled, Status.Expired, Status.Deleted].map(function(status) {
                mockCamp.status = status;
                return expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                    expect(resp).toBe(exp);
                });
            })).then(function(results) {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
                expect(campCache.getPromise.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle pending, draft, and paused campaigns', function(done) {
            q.all([Status.Pending, Status.Draft, Status.Paused].map(function(status) {
                mockCamp.status = status;
                return expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                    expect(resp).toBe(exp);
                });
            })).then(function(results) {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(expModule.swapCard.calls.count()).toBe(6);
                expect(campCache.getPromise.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should defend against query selection injector attacks', function(done) {
            expModule.handleCampaign(cardSvc, campCache, {$gt: ''}, exp, req).then(function(resp) {
                expect(resp).toBe(exp);
                expect(campCache.getPromise).toHaveBeenCalledWith({id: '[object Object]'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if retrieving the campaign fails', function(done) {
            campCache.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if one of the swapCard calls fails', function(done) {
            expModule.swapCard.and.callFake(function(cardSvc, camp, exp, idx, req) {
                if (idx === 0) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            expModule.handleCampaign(cardSvc, campCache, 'cam-1', exp, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campCache.getPromise).toHaveBeenCalled();
                expect(expModule.swapCard.calls.count()).toBe(2);
            }).done(done);
        });
    });
    
    describe('formatUpdates', function() {
        var orig, updates, user, start = new Date();
        
        beforeEach(function() {
            updates = {};
            orig = {
                id: 'e-1',
                created: start,
                data: [{user: 'johnny', userId: 'u-2', date: start, data: {foo: 'bar'}, versionId: 'v1'}],
                status: [{user: 'johnny', userId: 'u-2', date: start, status: Status.Pending}]
            };
            user = { id: 'u-1', email: 'otter' };
            spyOn(uuid, 'hashText').and.callFake(function(dataString) {
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

    describe('handlePublicGet', function() {
        var res, cardSvc, config, caches;
        beforeEach(function() {
            req.params.id = 'e-1';
            req.originHost = 'http://cinema6.com';
            res = {
                header: jasmine.createSpy('res.header()')
            };
            caches = 'fakeCaches';
            cardSvc = 'fakeCardSvc';
            spyOn(expModule, 'getPublicExp').and.returnValue(q({ code: 200, body: { exp: 'yes' } }));
            config = { cacheTTLs: { cloudFront: 5 } };
        });
        
        it('should set headers and return an experience', function(done) {
            expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { exp: 'yes' } });
                expect(expModule.getPublicExp).toHaveBeenCalledWith('fakeCardSvc', 'fakeCaches', config, 'e-1', req);
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should still return a non-200 response', function(done) {
            expModule.getPublicExp.and.returnValue(q({ code: 404, body: 'Experience not found' }));
            expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Experience not found' });
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 if getPublicExp fails', function(done) {
            expModule.getPublicExp.and.returnValue(q.reject('I GOT A PROBLEM'));
            expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: { error: 'Error retrieving content', detail: 'I GOT A PROBLEM' } });
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=60');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not set the cache-control header if the request is in preview mode', function(done) {
            req.query.preview = true;
            expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { exp: 'yes' } });
                expect(res.header).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the extension is js', function() {
            beforeEach(function() {
                req.params.ext = 'js';
            });

            it('should return the card as a CommonJS module', function(done) {
                expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: 'module.exports = {"exp":"yes"};' });
                    expect(expModule.getPublicExp).toHaveBeenCalledWith('fakeCardSvc', 'fakeCaches', config, 'e-1', req);
                    expect(res.header.calls.count()).toBe(2);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                    expect(res.header).toHaveBeenCalledWith('content-type', 'application/javascript');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter the response if not a 2xx response', function(done) {
                expModule.getPublicExp.and.returnValue(q({ code: 404, body: 'Experience not found' }));
                expModule.handlePublicGet(req, res, caches, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 404, body: 'Experience not found' });
                    expect(res.header.calls.count()).toBe(1);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
    });
});
