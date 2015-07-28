var flush = true;
describe('content (UT)', function() {
    var mockLog, experiences, uuid, logger, expModule, q, objUtils,
        mongoUtils, enums, Status, Scope, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        expModule       = require('../../bin/content-experiences');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
        enums           = require('../../lib/enums');
        Status          = enums.Status;
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
        
        experiences = {};
        req = {uuid: '1234'};
    });
    
    describe('getPublicExp', function() {
        var id, req, caches, cardSvc, siteCfg;
        beforeEach(function() {
            id = 'e-1';
            req = { isC6Origin: false, originHost: 'c6.com', uuid: '1234', query: {foo: 'bar'} };
            siteCfg = { sites: 'good' };
            caches = {
                experiences: {
                    getPromise: jasmine.createSpy('expCache.getPromise').andReturn(q([{id: 'e-1', org: 'o-1'}]))
                },
                orgs: 'fakeOrgCache',
                sites: 'fakeSiteCache',
                campaigns: 'fakeCampCache'
            };
            cardSvc = 'fakeCardSvc';
            spyOn(expModule, 'canGetExperience').andReturn(true);
            expModule.formatOutput.andReturn('formatted');
            spyOn(expModule, 'getAdConfig').andReturn(q('withAdConfig'));
            spyOn(expModule, 'getSiteConfig').andReturn(q('withSiteConfig'));
            spyOn(expModule, 'handleCampaign').andReturn(q('withCampSwaps'));
        });

        it('should call cache.getPromise to get the experience', function(done) {
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withCampSwaps');
                expect(caches.experiences.getPromise).toHaveBeenCalledWith({id: 'e-1'});
                expect(expModule.formatOutput).toHaveBeenCalledWith({id: 'e-1', org: 'o-1'}, true);
                expect(expModule.canGetExperience).toHaveBeenCalledWith('formatted', null, false);
                expect(expModule.getAdConfig).toHaveBeenCalledWith('formatted', 'o-1', 'fakeOrgCache');
                expect(expModule.getSiteConfig).toHaveBeenCalledWith('withAdConfig', 'o-1', {foo: 'bar'},
                    'c6.com', 'fakeSiteCache', 'fakeOrgCache', {sites: 'good'});
                expect(expModule.handleCampaign).toHaveBeenCalledWith(req, 'withSiteConfig', undefined,
                    'fakeCampCache', 'fakeCardSvc');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass the campaign query param to handleCampaign', function(done) {
            req.query.campaign = 'cam-1';
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withCampSwaps');
                expect(expModule.handleCampaign).toHaveBeenCalledWith(req, 'withSiteConfig', 'cam-1',
                    'fakeCampCache', 'fakeCardSvc');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing was found', function(done) {
            caches.experiences.getPromise.andReturn(q([]));
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
                expect(expModule.canGetExperience).not.toHaveBeenCalled();
                expect(expModule.getAdConfig).not.toHaveBeenCalled();
                expect(expModule.getSiteConfig).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the user cannot see the experience', function(done) {
            expModule.canGetExperience.andReturn(false);
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
                expect(expModule.getAdConfig).not.toHaveBeenCalled();
                expect(expModule.getSiteConfig).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the promise was rejected', function(done) {
            caches.experiences.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
                expect(expModule.canGetExperience).not.toHaveBeenCalled();
                expect(expModule.getAdConfig).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling getAdConfig fails', function(done) {
            expModule.getAdConfig.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
                expect(expModule.getAdConfig).toHaveBeenCalled();
                expect(expModule.getSiteConfig).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling getSiteConfig fails', function(done) {
            expModule.getSiteConfig.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
                expect(expModule.getAdConfig).toHaveBeenCalled();
                expect(expModule.getSiteConfig).toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling handleCampaign fails', function(done) {
            expModule.handleCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
                expect(expModule.getAdConfig).toHaveBeenCalled();
                expect(expModule.getSiteConfig).toHaveBeenCalled();
                expect(expModule.handleCampaign).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('getExperiences', function() {
        var req, expColl, query, fakeCursor;
        beforeEach(function() {
            req = {
                isC6Origin: false,
                uuid: '1234',
                query: {
                    sort: 'id,1',
                    limit: 20,
                    skip: 10
                },
                user: 'fakeUser'
            };
            query = {type: 'minireel'};
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, [{id: 'e1'}]);
                }),
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) {
                    cb(null, 50);
                })
            };
            expColl = { find: jasmine.createSpy('expColl.find').andReturn(fakeCursor) };
            spyOn(expModule, 'userPermQuery').andReturn('userPermQuery');
            spyOn(expModule, 'formatTextQuery').andCallThrough();
            expModule.formatOutput.andReturn('formatted');
        });

        it('should format the query and call expColl.find', function(done) {
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser',false);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: { id: 1 }, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalledWith({id: 'e1'}, false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly use hints if querying by user or org', function(done) {
            expModule.userPermQuery.andCallFake(function(orig) { return orig; });
            expModule.getExperiences({user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith({user: 'u-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
                return expModule.getExperiences({org: 'o-1'}, req, expColl, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find.calls[1].args).toEqual([{org: 'o-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {org: 1}}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prefer to hint on the user index if querying by user and org', function(done) {
            expModule.userPermQuery.andCallFake(function(orig) { return orig; });
            expModule.getExperiences({org: 'o-1', user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith({org: 'o-1', user: 'u-1'},
                    {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a user to query for deleted experiences', function(done) {
            query.status = Status.Deleted;
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 400, body: 'Cannot get deleted experiences'});
                expect(mockLog.warn).toHaveBeenCalled();
                expect(expModule.userPermQuery).not.toHaveBeenCalled();
                expect(expColl.find).not.toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query by multiple ids', function(done) {
            query = { id: ['e-1', 'e-2'] };
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({id: {$in: ['e-1', 'e-2']}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query by multiple categories', function(done) {
            query = { categories: ['food', 'sports'] };
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({categories: {$in: ['food', 'sports']}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format queries for sponsored/non-sponsored minireels', function(done) {
            expModule.getExperiences({sponsored: true}, req, expColl, false).then(function(resp) {
                return expModule.getExperiences({sponsored: false}, req, expColl, false);
            }).then(function() {
                expect(expModule.userPermQuery.calls[0].args).toEqual([{campaignId: {$exists: true}}, 'fakeUser', false]);
                expect(expModule.userPermQuery.calls[1].args).toEqual([{campaignId: {$exists: false}}, 'fakeUser', false]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query on the status field', function(done) {
            query.status = Status.Active;
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({type: 'minireel',
                    'status.0.status': Status.Active}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should format a text query', function(done) {
            query.text = 'foo bar';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.formatTextQuery).toHaveBeenCalledWith({type: 'minireel', text: 'foo bar'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({type: 'minireel',
                    'data.0.data.title': {$regex: '.*foo.*bar.*', $options: 'i'}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should set the content-range header if multiExp is true', function(done) {
            expModule.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: ['formatted'],
                                       headers: { 'content-range': 'items 11-30/50' } });
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            expModule.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: ['formatted'],
                                       headers: { 'content-range': 'items 46-50/50' } });
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if requesting a single experience returned nothing', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Experience not found' });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and empty array if requesting multiple experiences returned nothing', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            expModule.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: [],
                                       headers: { 'content-range': 'items 0-0/0' } });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Find Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if cursor.count has an error and multiExp is true', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            expModule.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Count Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('createExperience', function() {
        beforeEach(function() {
            req.body = { tag: 'fakeExp', data: { foo: 'bar' }, user: 'u-1', org: 'o-1',
                         status: Status.Active, access: 'private' };
            req.user = {id: 'u-1234', org: 'o-1234', email: 'otter'};
            experiences.insert = jasmine.createSpy('experiences.insert')
                .andCallFake(function(obj, opts, cb) { cb(); });
            spyOn(uuid, 'createUuid').andReturn('1234');
            spyOn(expModule.createValidator, 'validate').andReturn(true);
            spyOn(uuid, 'hashText').andReturn('fakeVersion');
            spyOn(expModule, 'checkScope').andReturn(false);
        });

        it('should fail with a 400 if no experience is provided', function(done) {
            delete req.body;
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(experiences.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully create an experience', function(done) {
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.tag).toBe('fakeExp');
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.user).toBe('u-1');
                expect(resp.body.org).toBe('o-1');
                expect(resp.body.status).toBe(Status.Active);
                expect(resp.body.access).toBe('private');
                expect(expModule.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(experiences.insert).toHaveBeenCalled();
                expect(experiences.insert.calls[0].args[0].data[0]).toEqual({user:'otter',userId:'u-1234',
                    date:jasmine.any(Date),versionId:'fakeVers',data:{foo:'bar'}});
                expect(experiences.insert.calls[0].args[1]).toEqual({w: 1, journal: true});
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(expModule.checkScope).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should set default values for some fields if not specified in the request', function(done) {
            req.body = { tag: 'fakeExp' };
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.tag).toBe('fakeExp');
                expect(resp.body.data).toEqual({});
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.user).toBe('u-1234');
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.status).toBe(Status.Pending);
                expect(resp.body.access).toBe('public');
                expect(experiences.insert.calls[0].args[0].data[0]).toEqual({user:'otter',userId:'u-1234',
                    date:jasmine.any(Date),versionId:'fakeVers',data:{}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prevent ordinary users from setting the adConfig', function(done) {
            req.body.data.adConfig = {ads: 'good'};
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to set adConfig');
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, req.body, 'experiences', 'editAdConfig');
                expect(experiences.insert).not.toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should let users set the adConfig if they have permission to do so', function(done) {
            expModule.checkScope.andReturn(true);
            req.body.data.adConfig = {ads: 'good'};
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.data).toEqual({foo: 'bar', adConfig: {ads: 'good'}});
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, req.body, 'experiences', 'editAdConfig');
                expect(experiences.insert).toHaveBeenCalled();
                expect(experiences.insert.calls[0].args[0].data[0].data).toEqual({foo:'bar',adConfig:{ads:'good'}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 400 if the request body contains illegal fields', function(done) {
            expModule.createValidator.validate.andReturn(false);
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(expModule.createValidator.validate).toHaveBeenCalled();
                expect(experiences.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if inserting the record fails', function(done) {
            experiences.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(experiences.insert).toHaveBeenCalled();
            }).done(done);
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
            spyOn(expModule, 'formatUpdates').andCallThrough();
            spyOn(expModule, 'checkScope').andReturn(true);
            spyOn(expModule.updateValidator, 'validate').andReturn(true);
            spyOn(uuid, 'hashText').andReturn('fakeVersion');
        });

        it('should fail with a 400 if no update object is provided', function(done) {
            delete req.body;
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(experiences.findOne).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully update an experience', function(done) {
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(expModule.updateValidator.validate).toHaveBeenCalledWith(req.body, oldExp, req.user);
                expect(expModule.formatUpdates).toHaveBeenCalledWith(req, oldExp, req.body, req.user);
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
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
                expect(expModule.checkScope).not.toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prevent improper direct edits to some properties', function(done) {
            req.body.title = 'a title';
            req.body.versionId = 'qwer1234';
            req.body.lastStatusChange = new Date();
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.tag).toBe('newTag');
                expect(updates.$set.title).not.toBeDefined();
                expect(updates.$set.versionId).not.toBeDefined();
                expect(updates.$set.lastStatusChange).not.toBeDefined();
                expect(expModule.formatOutput).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not edit the experience if the updates contain illegal fields', function(done) {
            expModule.updateValidator.validate.andReturn(false);
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                expect(expModule.updateValidator.validate).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should only let a user edit experiences they are authorized to edit', function(done) {
            expModule.checkScope.andReturn(false);
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this experience');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prevent ordinary users from editing the adConfig', function(done) {
            expModule.checkScope.andCallFake(function(user, orig, obj, verb) {
                if (verb === 'editAdConfig') return false;
                else return true;
            });
            req.body.data.adConfig = { ads: 'good' };
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit adConfig of this experience');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
                expect(objUtils.compareObjects).toHaveBeenCalledWith({ ads: 'good' }, null);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should allow the edit if the adConfig is unchanged', function(done) {
            expModule.checkScope.andCallFake(function(user, orig, obj, verb) {
                if (verb === 'editAdConfig') return false;
                else return true;
            });
            req.body.data.adConfig = { ads: 'good' };
            oldExp.data[0].data.adConfig = { ads: 'good' };
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id:'e-1234',data:{foo:'baz',adConfig:{ads:'good'}},versionId:'fakeVers'});
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.data[0].data.adConfig).toEqual({ ads: 'good' });
                expect(objUtils.compareObjects).toHaveBeenCalledWith({ads: 'good'}, {ads: 'good'});
                expect(expModule.checkScope).not.toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should let users edit the adConfig if they have permission to do so', function(done) {
            expModule.checkScope.andReturn(true);
            req.body.data.adConfig = { ads: 'bad' };
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id:'e-1234',data:{foo:'baz',adConfig:{ads:'bad'}},versionId:'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.data[0].data.adConfig).toEqual({ ads: 'bad' });
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'editAdConfig');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not create an experience if it does not already exist', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb(); });
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not edit an experience that has been deleted', function(done) {
            oldExp.status = [{user: 'otter', status: Status.Deleted}];
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if modifying the record fails', function(done) {
            experiences.findAndModify.andCallFake(function(query, sort, obj, opts, cb) { cb('Error!'); });
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(experiences.findAndModify).toHaveBeenCalled();
            }).done(done);
        });

        it('should fail with an error if looking up the record fails', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).not.toHaveBeenCalled();
            }).done(done);
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
            spyOn(expModule, 'formatUpdates').andCallThrough();
            spyOn(expModule, 'checkScope').andReturn(true);
        });

        it('should successfully delete an experience', function(done) {
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findOne.calls[0].args[0]).toEqual({id: 'e-1234'});
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'delete');
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
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not do anything if the experience does not exist', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb(); });
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not do anything if the experience has been deleted', function(done) {
            oldExp.status[0].status = Status.Deleted;
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should only let a user delete experiences they are authorized to delete', function(done) {
            expModule.checkScope.andReturn(false);
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this experience');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'delete');
                expect(experiences.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if modifying the record fails', function(done) {
            experiences.update.andCallFake(function(query, obj, opts, cb) { cb('Error!'); });
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(experiences.update).toHaveBeenCalled();
            }).done(done);
        });

        it('should fail with an error if looking up the record fails', function(done) {
            experiences.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.update).not.toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe deleteExperience
});  // end -- describe content
