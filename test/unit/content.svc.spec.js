var flush = true;
describe('content (UT)', function() {
    var mockLog, experiences, uuid, logger, expModule, q, objUtils,
        mongoUtils, enums, Status, Scope, Access, req;

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
        
        experiences = {};
        req = {uuid: '1234'};
    });
    
    describe('getPublicExp', function() {
        var id, caches, cardSvc, config, mockExp;
        beforeEach(function() {
            spyOn(expModule, 'canGetExperience').and.returnValue(true);
            expModule.formatOutput.and.callFake(function(exp) {
                var newExp = JSON.parse(JSON.stringify(exp));
                newExp.formatted = true;
                return newExp;
            });
            spyOn(expModule, 'handleCampaign').and.callFake(function(cardSvc, cache, campId, exp, req) {
                exp.withCampSwaps = true;
                return q(exp);
            });

            mockExp = { id: 'e-1', data: { campaign: {}, branding: 'brandA' } };
            caches = {
                experiences: {
                    getPromise: jasmine.createSpy('expCache.getPromise').and.callFake(function() { return q([mockExp]); })
                },
                campaigns: 'fakeCampCache'
            };

            id = 'e-1';
            cardSvc = 'fakeCardSvc';
            req.isC6Origin = false;
            req.originHost = 'c6.com';
            req.query = { branding: 'brandB' };
            config = { trackingPixel: 'track.me', defaultSiteConfig: { branding: 'default' } };
        });

        it('should call cache.getPromise to get the experience', function(done) {
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e-1',
                    data: { campaign: {}, branding: 'brandA' },
                    formatted: true,
                    withCampSwaps: true
                });
                expect(caches.experiences.getPromise).toHaveBeenCalledWith({ id: 'e-1' });
                expect(expModule.formatOutput).toHaveBeenCalledWith(mockExp, true);
                expect(expModule.canGetExperience).toHaveBeenCalledWith(resp.body, null, false);
                expect(expModule.handleCampaign).toHaveBeenCalledWith('fakeCardSvc', 'fakeCampCache', undefined, resp.body, req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not setup tracking pixels for preview', function(done) {
            req.query.preview = true;
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({
                    id: 'e-1',
                    data: { campaign: {}, branding: 'brandA' },
                    formatted: true,
                    withCampSwaps: true
                });
            }).then(done,done.fail);
        });
        
        it('should pass the campaign query param to handleCampaign', function(done) {
            req.query.campaign = 'cam-1';
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual(jasmine.objectContaining({ withCampSwaps: true }));
                expect(expModule.handleCampaign).toHaveBeenCalledWith('fakeCardSvc', 'fakeCampCache', 'cam-1', resp.body, req);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('when handling branding', function() {
            it('should fall back to the query param\'s branding if not on the experience', function(done) {
                delete mockExp.data.branding;
                expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                    expect(resp.code).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e-1',
                        data: { campaign: {}, branding: 'brandB' },
                        formatted: true,
                        withCampSwaps: true
                    });
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should fall back to a default if it\'s not defined anywhere else', function(done) {
                delete mockExp.data.branding;
                delete req.query.branding;
                expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                    expect(resp.code).toBe(200);
                    expect(resp.body).toEqual({
                        id: 'e-1',
                        data: { campaign: {}, branding: 'default' },
                        formatted: true,
                        withCampSwaps: true
                    });
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

        it('should return a 404 if nothing was found', function(done) {
            mockExp = undefined;
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
                expect(expModule.canGetExperience).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the user cannot see the experience', function(done) {
            expModule.canGetExperience.and.returnValue(false);
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('Experience not found');
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the promise was rejected', function(done) {
            caches.experiences.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
                expect(expModule.canGetExperience).not.toHaveBeenCalled();
                expect(expModule.handleCampaign).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if calling handleCampaign fails', function(done) {
            expModule.handleCampaign.and.returnValue(q.reject('I GOT A PROBLEM'));
            expModule.getPublicExp(cardSvc, caches, config, id, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.experiences.getPromise).toHaveBeenCalled();
                expect(expModule.formatOutput).toHaveBeenCalled();
                expect(expModule.canGetExperience).toHaveBeenCalled();
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
                toArray: jasmine.createSpy('cursor.toArray').and.returnValue(q([{ id: 'e1' }])),
                count: jasmine.createSpy('cursor.count').and.returnValue(q(50))
            };
            expColl = { find: jasmine.createSpy('expColl.find').and.returnValue(fakeCursor) };
            spyOn(expModule, 'userPermQuery').and.returnValue('userPermQuery');
            spyOn(expModule, 'formatTextQuery').and.callThrough();
            expModule.formatOutput.and.returnValue('formatted');
        });

        it('should format the query and call expColl.find', function(done) {
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expModule.userPermQuery).toHaveBeenCalledWith({type:'minireel'},'fakeUser',false);
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: {} });
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
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: {}, limit: 0, skip: 0, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: {}, limit: 20, skip: 10, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should ignore the limit param if invalid', function(done) {
            req.query.limit = -123.4;
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 0, skip: 10, fields: {} });
                
                expColl.find.calls.reset();
                req.query.limit = { foo: 'bar' };
                return expModule.getExperiences(query, req, expColl, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 0, skip: 10, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should ignore the skip param if invalid', function(done) {
            req.query.skip = -123.4;
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 0, fields: {} });
                
                expColl.find.calls.reset();
                req.query.skip = { foo: 'bar' };
                return expModule.getExperiences(query, req, expColl, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 0, fields: {} });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow specifiying which fields to return', function(done) {
            req.query.fields = 'id,user';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { id: 1, user: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should always include the id field', function(done) {
            req.query.fields = 'user,org';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { id: 1, user: 1, org: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle data specially in the fields param', function(done) {
            req.query.fields = 'data.foo,data.nest.bar';
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { 'data.data.foo': 1, 'data.data.nest.bar': 1, id: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should guard against non-string fields params', function(done) {
            req.query.fields = { foo: 'bar' };
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith('userPermQuery',
                    { sort: { id: 1 }, limit: 20, skip: 10, fields: { '[object Object]': 1, id: 1 } });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should properly use hints if querying by user or org', function(done) {
            expModule.userPermQuery.and.callFake(function(orig) { return orig; });
            expModule.getExperiences({user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith({ user: 'u-1' },
                    { sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}, fields: {} });
                return expModule.getExperiences({org: 'o-1'}, req, expColl, false);
            }).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find.calls.all()[1].args).toEqual([{org: 'o-1'},
                    { sort: {id: 1}, limit: 20, skip: 10, hint: {org: 1}, fields: {} }]);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should prefer to hint on the user index if querying by user and org', function(done) {
            expModule.userPermQuery.and.callFake(function(orig) { return orig; });
            expModule.getExperiences({org: 'o-1', user: 'u-1'}, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({code: 200, body: 'formatted'});
                expect(expColl.find).toHaveBeenCalledWith({org: 'o-1', user: 'u-1'},
                    { sort: {id: 1}, limit: 20, skip: 10, hint: {user: 1}, fields: {} });
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
                expect(expModule.userPermQuery.calls.all()[0].args).toEqual([{campaignId: {$exists: true}}, 'fakeUser', false]);
                expect(expModule.userPermQuery.calls.all()[1].args).toEqual([{campaignId: {$exists: false}}, 'fakeUser', false]);
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
            fakeCursor.toArray.and.returnValue(q([]));
            expModule.getExperiences(query, req, expColl, false).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Experience not found' });
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(expModule.formatOutput).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 200 and empty array if requesting multiple experiences returned nothing', function(done) {
            fakeCursor.toArray.and.returnValue(q([]));
            fakeCursor.count.and.returnValue(q(0));
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
            fakeCursor.toArray.and.returnValue(q.reject('Find Error!'));
            fakeCursor.count.and.returnValue(q.reject('Count Error!'));
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
            fakeCursor.toArray.and.returnValue(q.reject('Find Error!'));
            fakeCursor.count.and.returnValue(q.reject('Count Error!'));
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
            req.body = { data: { foo: 'bar' }, user: 'u-1', org: 'o-1',
                         status: Status.Active, access: Access.Private };
            req.user = {id: 'u-1234', org: 'o-1234', email: 'otter'};
            spyOn(mongoUtils, 'createObject').and.callFake(function(coll, obj) { return q(obj); });
            spyOn(uuid, 'createUuid').and.returnValue('1234');
            spyOn(expModule.createValidator, 'validate').and.returnValue(true);
            spyOn(uuid, 'hashText').and.returnValue('fakeVersion');
            spyOn(expModule, 'checkScope').and.returnValue(false);
        });

        it('should fail with a 400 if no experience is provided', function(done) {
            delete req.body;
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(mongoUtils.createObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully create an experience', function(done) {
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body.id).toBe('e-1234');
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.created instanceof Date).toBeTruthy('created is a Date');
                expect(resp.body.lastUpdated instanceof Date).toBeTruthy('lastUpdated is a Date');
                expect(resp.body.data).toEqual({foo: 'bar'});
                expect(resp.body.user).toBe('u-1');
                expect(resp.body.org).toBe('o-1');
                expect(resp.body.status).toBe(Status.Active);
                expect(resp.body.access).toBe(Access.Private);
                expect(expModule.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(mongoUtils.createObject).toHaveBeenCalledWith(experiences, req.body);
                expect(mongoUtils.createObject.calls.argsFor(0)[1].data).toEqual([{user:'otter',userId:'u-1234',
                    date:jasmine.any(Date),versionId:'fakeVers',data:{foo:'bar'}}]);
                expect(expModule.formatOutput).toHaveBeenCalled();
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
                expect(resp.body.data).toEqual({});
                expect(resp.body.versionId).toBe('fakeVers');
                expect(resp.body.user).toBe('u-1234');
                expect(resp.body.org).toBe('o-1234');
                expect(resp.body.status).toBe(Status.Pending);
                expect(resp.body.access).toBe(Access.Public);
                expect(mongoUtils.createObject).toHaveBeenCalledWith(experiences, req.body);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with a 400 if the request body contains illegal fields', function(done) {
            expModule.createValidator.validate.and.returnValue(false);
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(expModule.createValidator.validate).toHaveBeenCalled();
                expect(mongoUtils.createObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if inserting the record fails', function(done) {
            mongoUtils.createObject.and.returnValue(q.reject('Error!'));
            expModule.createExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
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
            spyOn(mongoUtils, 'findObject').and.returnValue(q(oldExp));
            spyOn(mongoUtils, 'editObject').and.callFake(function(coll, obj, id) {
                return q({ id: 'e-1234', data: obj.data });
            });
            spyOn(objUtils, 'compareObjects').and.callThrough();
            spyOn(expModule, 'formatUpdates').and.callThrough();
            spyOn(expModule, 'checkScope').and.returnValue(true);
            spyOn(expModule.updateValidator, 'validate').and.returnValue(true);
            spyOn(uuid, 'hashText').and.returnValue('fakeVersion');
        });

        it('should fail with a 400 if no update object is provided', function(done) {
            delete req.body;
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(mongoUtils.findObject).not.toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully update an experience', function(done) {
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({id: 'e-1234', data: {foo:'baz'}, versionId: 'fakeVers'});
                expect(mongoUtils.findObject).toHaveBeenCalledWith(experiences, { id: 'e-1234' });
                expect(expModule.updateValidator.validate).toHaveBeenCalledWith(req.body, oldExp, req.user);
                expect(expModule.formatUpdates).toHaveBeenCalledWith(req, oldExp, req.body, req.user);
                expect(mongoUtils.editObject).toHaveBeenCalledWith(experiences, {
                    tag: 'newTag',
                    data: [{
                        user: 'otter',
                        userId: 'u-1234',
                        date: jasmine.any(Date),
                        data: { foo: 'baz' },
                        versionId: 'fakeVers'
                    }],
                    lastUpdated: jasmine.any(Date)
                }, 'e-1234');
                expect(expModule.formatOutput).toHaveBeenCalled();
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
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).toHaveBeenCalled();
                var updates = mongoUtils.editObject.calls.argsFor(0)[1];
                expect(updates.tag).toBe('newTag');
                expect(updates.title).not.toBeDefined();
                expect(updates.versionId).not.toBeDefined();
                expect(updates.lastStatusChange).not.toBeDefined();
                expect(expModule.formatOutput).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not edit the experience if the updates contain illegal fields', function(done) {
            expModule.updateValidator.validate.and.returnValue(false);
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Invalid request body');
                expect(expModule.updateValidator.validate).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should only let a user edit experiences they are authorized to edit', function(done) {
            expModule.checkScope.and.returnValue(false);
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this experience');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'edit');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not create an experience if it does not already exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not edit an experience that has been deleted', function(done) {
            oldExp.status = [{user: 'otter', status: Status.Deleted}];
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That experience does not exist');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if modifying the record fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('Error!'));
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongoUtils.editObject).toHaveBeenCalled();
            }).done(done);
        });

        it('should fail with an error if looking up the record fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('Error!'));
            expModule.updateExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
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
            spyOn(mongoUtils, 'findObject').and.callFake(function() { return q(oldExp); });
            spyOn(mongoUtils, 'editObject').and.returnValue(q());
            spyOn(uuid, 'hashText').and.returnValue('fakeHash');
            spyOn(expModule, 'formatUpdates').and.callThrough();
            spyOn(expModule, 'checkScope').and.returnValue(true);
        });

        it('should successfully delete an experience', function(done) {
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(mongoUtils.findObject).toHaveBeenCalledWith(experiences, { id: 'e-1234' });
                expect(mongoUtils.editObject).toHaveBeenCalledWith(experiences, {
                    lastUpdated: jasmine.any(Date),
                    status: [
                        { user: 'johnny', userId: 'u-1234', date: jasmine.any(Date), status: Status.Deleted },
                        { user: 'otter', date: start, status: Status.Active }
                    ]
                }, 'e-1234');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not do anything if the experience does not exist', function(done) {
            mongoUtils.findObject.and.returnValue(q());
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
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
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should only let a user delete experiences they are authorized to delete', function(done) {
            expModule.checkScope.and.returnValue(false);
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this experience');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(expModule.checkScope).toHaveBeenCalledWith(req.user, oldExp, 'experiences', 'delete');
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail with an error if modifying the record fails', function(done) {
            mongoUtils.editObject.and.returnValue(q.reject('Error!'));
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(mongoUtils.editObject).toHaveBeenCalled();
            }).done(done);
        });

        it('should fail with an error if looking up the record fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('Error!'));
            expModule.deleteExperience(req, experiences).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).toBe('Error!');
                expect(mongoUtils.findObject).toHaveBeenCalled();
                expect(mongoUtils.editObject).not.toHaveBeenCalled();
            }).done(done);
        });
    });  // end -- describe deleteExperience
});  // end -- describe content
