var flush = true;
describe('content (UT)', function() {
    var mockLog, experiences, req, uuid, logger, content, q, objUtils,
        mongoUtils, enums, Status, Scope, Access;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        content         = require('../../bin/content');
        mongoUtils      = require('../../lib/mongoUtils');
        objUtils        = require('../../lib/objUtils');
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
            spyOn(content, 'canGetExperience').andReturn(true);
            content.formatOutput.andReturn('formatted');
            spyOn(content, 'getAdConfig').andReturn(q('withAdConfig'));
            spyOn(content, 'getSiteConfig').andReturn(q('withSiteConfig'));
            spyOn(content, 'handleCampaign').andReturn(q('withCampSwaps'));
        });

        it('should call cache.getPromise to get the experience', function(done) {
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withCampSwaps');
                expect(caches.experiences.getPromise).toHaveBeenCalledWith({id: 'e-1'});
                expect(content.formatOutput).toHaveBeenCalledWith({id: 'e-1', org: 'o-1'}, true);
                expect(content.canGetExperience).toHaveBeenCalledWith('formatted', null, false);
                expect(content.getAdConfig).toHaveBeenCalledWith('formatted', 'o-1', 'fakeOrgCache');
                expect(content.getSiteConfig).toHaveBeenCalledWith('withAdConfig', 'o-1', {foo: 'bar'},
                    'c6.com', 'fakeSiteCache', 'fakeOrgCache', {sites: 'good'});
                expect(content.handleCampaign).toHaveBeenCalledWith(req, 'withSiteConfig', undefined,
                    'fakeCampCache', 'fakeCardSvc');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should pass the campaign query param to handleCampaign', function(done) {
            req.query.campaign = 'cam-1';
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toBe('withCampSwaps');
                expect(content.handleCampaign).toHaveBeenCalledWith(req, 'withSiteConfig', 'cam-1',
                    'fakeCampCache', 'fakeCardSvc');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if nothing was found', function(done) {
            caches.experiences.getPromise.andReturn(q([]));
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
                expect(content.canGetExperience).not.toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
                expect(content.getSiteConfig).not.toHaveBeenCalled();
                expect(content.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the user cannot see the experience', function(done) {
            content.canGetExperience.andReturn(false);
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
                expect(content.getSiteConfig).not.toHaveBeenCalled();
                expect(content.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the promise was rejected', function(done) {
            caches.experiences.getPromise.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
                expect(content.canGetExperience).not.toHaveBeenCalled();
                expect(content.getAdConfig).not.toHaveBeenCalled();
                expect(content.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling getAdConfig fails', function(done) {
            content.getAdConfig.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).toHaveBeenCalled();
                expect(content.getSiteConfig).not.toHaveBeenCalled();
                expect(content.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling getSiteConfig fails', function(done) {
            content.getSiteConfig.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).toHaveBeenCalled();
                expect(content.getSiteConfig).toHaveBeenCalled();
                expect(content.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling handleCampaign fails', function(done) {
            content.handleCampaign.andReturn(q.reject('I GOT A PROBLEM'));
            content.getPublicExp(id, req, caches, cardSvc, siteCfg).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalled();
                expect(content.canGetExperience).toHaveBeenCalled();
                expect(content.getAdConfig).toHaveBeenCalled();
                expect(content.getSiteConfig).toHaveBeenCalled();
                expect(content.handleCampaign).toHaveBeenCalled();
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
            spyOn(content, 'userPermQuery').andReturn('userPermQuery');
            spyOn(content, 'formatTextQuery').andCallThrough();
            content.formatOutput.andReturn('formatted');
        });

        it('should format the query and call expColl.find', function(done) {
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser',false);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: { id: 1 }, limit: 20, skip: 10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(content.formatOutput).toHaveBeenCalledWith({id: 'e1'}, false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should use defaults if some params are not defined', function(done) {
            req = { uuid: '1234', user: 'fakeUser' };
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 0, skip: 0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery', {sort: {}, limit: 20, skip: 10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly use hints if querying by user or org', function(done) {
            content.userPermQuery.andCallFake(function(orig) { return orig; });
            content.getExperiences({user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith({user: 'u-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
                return content.getExperiences({org: 'o-1'}, req, expColl, false);
            }).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find.calls[1].args).toEqual([{org: 'o-1'}, {sort: {id: 1}, limit: 20, skip: 10, hint: {org: 1}}]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prefer to hint on the user index if querying by user and org', function(done) {
            content.userPermQuery.andCallFake(function(orig) { return orig; });
            content.getExperiences({org: 'o-1', user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(expColl.find).toHaveBeenCalledWith({org: 'o-1', user: 'u-1'},
                    {sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not allow a user to query for deleted experiences', function(done) {
            query.status = Status.Deleted;
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Cannot get deleted experiences');
                expect(mockLog.warn).toHaveBeenCalled();
                expect(content.userPermQuery).not.toHaveBeenCalled();
                expect(expColl.find).not.toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query by multiple ids', function(done) {
            query = { id: ['e-1', 'e-2'] };
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({id: {$in: ['e-1', 'e-2']}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query by multiple categories', function(done) {
            query = { categories: ['food', 'sports'] };
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({categories: {$in: ['food', 'sports']}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format queries for sponsored/non-sponsored minireels', function(done) {
            content.getExperiences({sponsored: true}, req, expColl, false).then(function(resp) {
                return content.getExperiences({sponsored: false}, req, expColl, false);
            }).then(function() {
                expect(content.userPermQuery.calls[0].args).toEqual([{campaignId: {$exists: true}}, 'fakeUser', false]);
                expect(content.userPermQuery.calls[1].args).toEqual([{campaignId: {$exists: false}}, 'fakeUser', false]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly format a query on the status field', function(done) {
            query.status = Status.Active;
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.userPermQuery).toHaveBeenCalledWith({type: 'minireel',
                    'status.0.status': Status.Active}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should format a text query', function(done) {
            query.text = 'foo bar';
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(content.formatTextQuery).toHaveBeenCalledWith({type: 'minireel', text: 'foo bar'});
                expect(content.userPermQuery).toHaveBeenCalledWith({type: 'minireel',
                    'data.0.data.title': {$regex: '.*foo.*bar.*', $options: 'i'}}, 'fakeUser', false);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).finally(done);
        });
        
        it('should set resp.pagination if multiExp is true', function(done) {
            content.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(resp.pagination).toEqual({start: 11, end: 30, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            content.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(['formatted']);
                expect(resp.pagination).toEqual({start: 46, end: 50, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and empty array if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            content.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([]);
                expect(resp.pagination).toEqual({start: 0, end: 0, total: 0});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            content.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Find Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if cursor.count has an error and multiExp is true', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            content.getExperiences(query, req, expColl, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Count Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(content.formatOutput).not.toHaveBeenCalled();
            }).done(done);
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
            req.body.lastStatusChange = new Date();
            content.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(experiences.findOne).toHaveBeenCalled();
                expect(experiences.findAndModify).toHaveBeenCalled();
                var updates = experiences.findAndModify.calls[0].args[2];
                expect(updates.$set.tag).toBe('newTag');
                expect(updates.$set.title).not.toBeDefined();
                expect(updates.$set.versionId).not.toBeDefined();
                expect(updates.$set.lastStatusChange).not.toBeDefined();
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
                expect(resp.body).toBe('Invalid request body');
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
                if (verb === 'editAdConfig') return false;
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
                if (verb === 'editAdConfig') return false;
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
