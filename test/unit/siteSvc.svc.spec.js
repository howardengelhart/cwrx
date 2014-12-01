var flush = true;
describe('siteSvc (UT)', function() {
    var mockLog, mockLogger, req, uuid, logger, siteSvc, q, QueryCache, mongoUtils, FieldValidator,
        enums, Status, Scope, anyFunc;
    
    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid            = require('../../lib/uuid');
        logger          = require('../../lib/logger');
        siteSvc         = require('../../bin/siteSvc');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
        mongoUtils      = require('../../lib/mongoUtils');
        q               = require('q');
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
        spyOn(mongoUtils, 'escapeKeys').andCallThrough();
        spyOn(mongoUtils, 'unescapeKeys').andCallThrough();
        req = {uuid: '1234'};
        anyFunc = jasmine.any(Function);
    });
    
    describe('checkScope', function() {
        it('should correctly handle the scopes', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    sites: {
                        read: Scope.All,
                        edit: Scope.Org,
                        delete: Scope.Own
                    }
                }
            };
            var sites = [{ id: 'w-1234', org: 'o-1234'},
                            { id: 'w-4567', org: 'o-4567'}];
            
            expect(sites.filter(function(target) {
                return siteSvc.checkScope(requester, target, 'read');
            })).toEqual(sites);
            expect(sites.filter(function(target) {
                return siteSvc.checkScope(requester, target, 'edit');
            })).toEqual([sites[0]]);
            expect(sites.filter(function(target) {
                return siteSvc.checkScope(requester, target, 'delete');
            })).toEqual([sites[0]]);
        });
    
        it('should sanity-check the user permissions object', function() {
            var target = { id: 'w-1' };
            expect(siteSvc.checkScope({}, target, 'read')).toBe(false);
            var requester = { id: 'u-1234', org: 'o-1234' };
            expect(siteSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions = {};
            expect(siteSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.sites = {};
            requester.permissions.orgs = { read: Scope.All };
            expect(siteSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.sites.read = '';
            expect(siteSvc.checkScope(requester, target, 'read')).toBe(false);
            requester.permissions.sites.read = Scope.All;
            expect(siteSvc.checkScope(requester, target, 'read')).toBe(true);
        });
    });
    
    describe('createValidator', function() {
        it('should have initialized correctly', function() {
            expect(siteSvc.createValidator._forbidden).toEqual(['id', 'created']);
            expect(typeof siteSvc.createValidator._condForbidden.org).toBe('function');
        });
        
        it('should prevent setting forbidden fields', function() {
            var updates = { a: 'b' };
            expect(siteSvc.createValidator.validate(updates, {}, {})).toBe(true);
            var updates = { a: 'b', id: 'foo' };
            expect(siteSvc.createValidator.validate(updates, {}, {})).toBe(false);
            var updates = { a: 'b', created: 'foo' };
            expect(siteSvc.createValidator.validate(updates, {}, {})).toBe(false);
        });
        
        it('should conditionally prevent setting the org field', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    sites: { create: Scope.Org }
                }
            };
            var site = { a: 'b', org: 'o-1234' };
            
            expect(siteSvc.createValidator.validate(site, {}, requester)).toBe(true);
            
            site.org = 'o-4567';
            expect(siteSvc.createValidator.validate(site, {}, requester)).toBe(false);
            requester.permissions.sites.create = Scope.All;
            expect(siteSvc.createValidator.validate(site, {}, requester)).toBe(true);
        });
    });
    
    describe('updateValidator', function() {
        it('should have initialized correctly', function() {
            expect(siteSvc.updateValidator._forbidden).toEqual(['id', 'created', '_id']);
            expect(typeof siteSvc.updateValidator._condForbidden.org).toBe('function');
        });
        
        it('should prevent illegal updates', function() {
            var updates = { a: 'b' };
            expect(siteSvc.updateValidator.validate(updates, {}, {})).toBe(true);
            updates = { a: 'b', id: 'w-4567' };
            expect(siteSvc.updateValidator.validate(updates, {}, {})).toBe(false);
            updates = { a: 'b', created: 'long, long ago' };
            expect(siteSvc.updateValidator.validate(updates, {}, {})).toBe(false);
        });

        it('should conditionally prevent setting the org field', function() {
            var requester = {
                id: 'u-1234',
                org: 'o-1234',
                permissions: {
                    sites: { edit: Scope.Org }
                }
            };
            var site = { a: 'b', org: 'o-1234' };
            
            expect(siteSvc.updateValidator.validate(site, {}, requester)).toBe(true);
            
            site.org = 'o-4567';
            expect(siteSvc.updateValidator.validate(site, {}, requester)).toBe(false);
            requester.permissions.sites.edit = Scope.All;
            expect(siteSvc.updateValidator.validate(site, {}, requester)).toBe(true);
        });
    });
    
    describe('validateHost', function() {
        it('should return true for valid hosts', function() {
            [
                { host: 'http://cinema6.com', result: false },
                { host: 'cinema6.com/foo', result: false },
                { host: 'cinema6.com?foo=bar', result: false },
                { host: 'cinema6.com', result: true },
                { host: 'staging.cinema6.com', result: true },
                { host: 'foo.bar.cinema6.com', result: true },
                { host: 'guardian.co.uk', result: true }
            ].map(function(test) {
                expect(siteSvc.validateHost(test.host)).toBe(test.result);
            });
        });
    });
    
    describe('userPermQuery', function() {
        var query, requester;
        beforeEach(function() {
            query = { host: 'c6.com' };
            requester = { id: 'u-1', org: 'o-1', permissions: { sites: { read: Scope.Own } } };
        });
        
        it('should just check that the user is not deleted if the requester is an admin', function() {
            requester.permissions.sites.read = Scope.All;
            expect(siteSvc.userPermQuery(query, requester))
                .toEqual({ host: 'c6.com', status: { $ne: Status.Deleted } });
            expect(query).toEqual({ host: 'c6.com' });
        });
        
        it('should check that the orgs match if the requester is not an admin', function() {
            expect(siteSvc.userPermQuery(query, requester))
                .toEqual({ host: 'c6.com', org: 'o-1', status: { $ne: Status.Deleted }});
        });
        
        it('should treat Scope.Org the same as Scope.Own', function() {
            requester.permissions.sites.read = Scope.Org;
            expect(siteSvc.userPermQuery(query, requester))
                .toEqual({ host: 'c6.com', org: 'o-1', status: { $ne: Status.Deleted }});
        });
        
        it('should log a warning if the requester has an invalid scope', function() {
            requester.permissions.sites.read = 'alfkjdf';
            expect(siteSvc.userPermQuery(query, requester))
                .toEqual({ host: 'c6.com', org: 'o-1', status: { $ne: Status.Deleted }});
            expect(mockLog.warn).toHaveBeenCalled();
        });
    });
    
    describe('getSites', function() {
        var query, siteColl, fakeCursor;
        beforeEach(function() {
            req.user = { id: 'u-1234', org: 'o-1', permissions: { sites: { read: Scope.Own } } };
            req.query = {
                sort: 'id,1',
                limit: 20,
                skip: 10
            };
            query = { host: 'c6.com', org: 'o-1' };
            fakeCursor = {
                toArray: jasmine.createSpy('cursor.toArray').andCallFake(function(cb) {
                    cb(null, q([{id: '1', _id: 'mongoId'}]));
                }),
                count: jasmine.createSpy('cursor.count').andCallFake(function(cb) {
                    cb(null, 50);
                })
            };
            siteColl = {
                find: jasmine.createSpy('sites.find').andReturn(fakeCursor)
            };
            spyOn(siteSvc, 'userPermQuery').andReturn('permQuery');
        });
        
        it('should call sites.find to get sites', function(done) {
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).not.toBeDefined();
                expect(siteColl.find).toHaveBeenCalledWith('permQuery',{sort:{id:1},limit:20,skip:10});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(siteSvc.userPermQuery).toHaveBeenCalledWith({ host: 'c6.com', org: 'o-1' },
                    { id: 'u-1234', org: 'o-1', permissions: { sites: { read: Scope.Own } } });
                expect(mongoUtils.unescapeKeys).toHaveBeenCalledWith({id: '1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should use defaults for sorting/paginating options if not provided', function(done) {
            req.query = { host: 'c6.com' };
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(siteColl.find).toHaveBeenCalledWith('permQuery',{sort:{},limit:0,skip:0});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should ignore the sort param if invalid', function(done) {
            req.query.sort = 'foo';
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(mockLog.warn).toHaveBeenCalled();
                expect(siteColl.find).toHaveBeenCalledWith('permQuery',{sort:{},limit:20,skip:10});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should set resp.pagination if multiGet is true', function(done) {
            siteSvc.getSites(query, req, siteColl, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 11, end: 30, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle end behavior properly when paginating', function(done) {
            req.query.skip = 45;
            siteSvc.getSites(query, req, siteColl, true).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(resp.pagination).toEqual({start: 46, end: 50, total: 50});
                expect(fakeCursor.count).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent non-admin users from getting all sites', function(done) {
            query = {};
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to read all sites');
                expect(siteColl.find).not.toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent non-admin users from getting sites outside their org', function(done) {
            query.org = 'o-2';
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to read non-org sites');
                expect(siteColl.find).not.toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow admin users to get all sites', function(done) {
            query = {};
            req.user.permissions.sites.read = Scope.All;
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(siteColl.find).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow admin users to get sites outside their org', function(done) {
            query.org = 'o-2';
            req.user.permissions.sites.read = Scope.All;
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual([{id:'1'}]);
                expect(siteColl.find).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if nothing was found', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb(null, []); });
            fakeCursor.count.andCallFake(function(cb) { cb(null, 0); });
            siteSvc.getSites(query, req, siteColl, true).then(function(resp) {
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('No sites found');
                expect(resp.pagination).toEqual({start: 0, end: 0, total: 0});
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if cursor.toArray has an error', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            siteSvc.getSites(query, req, siteColl, false).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Find Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).toHaveBeenCalled();
                expect(fakeCursor.count).not.toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should fail if cursor.count has an error and multiGet is true', function(done) {
            fakeCursor.toArray.andCallFake(function(cb) { cb('Find Error!'); });
            fakeCursor.count.andCallFake(function(cb) { cb('Count Error!'); });
            siteSvc.getSites(query, req, siteColl, true).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Count Error!');
                expect(mockLog.error).toHaveBeenCalled();
                expect(fakeCursor.toArray).not.toHaveBeenCalled();
                expect(fakeCursor.count).toHaveBeenCalled();
                expect(mongoUtils.unescapeKeys).not.toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('setupSite', function() {
        var newSite;
        beforeEach(function() {
            newSite = { host: 'c6.com', branding: 'c6' };
            spyOn(uuid, 'createUuid').andReturn('1234567890abcdefg');
        });

        it('should setup some default fields', function() {
            expect(siteSvc.setupSite(newSite)).toEqual(
                { id: 's-1234567890abcd', created: jasmine.any(Date), host: 'c6.com', branding: 'c6',
                  lastUpdated: jasmine.any(Date), status: Status.Active});
            expect(mongoUtils.escapeKeys).toHaveBeenCalledWith(newSite);
        });
        
        it('should allow the user to provide a custom status and org properties', function() {
            newSite.org = 'o-4567';
            newSite.status = Status.Pending;
            expect(siteSvc.setupSite(newSite)).toEqual(
                { id: 's-1234567890abcd', created: jasmine.any(Date), host: 'c6.com', branding: 'c6',
                  lastUpdated: jasmine.any(Date), status: Status.Pending, org: 'o-4567'});
        });
    });
    
    describe('createSite', function() {
        var siteColl;
        beforeEach(function() {
            siteColl = {
                findOne: jasmine.createSpy('sites.findOne').andCallFake(function(query, cb) {
                    cb(null, null);
                }),
                insert: jasmine.createSpy('sites.insert').andCallFake(function(obj, opts, cb) {
                    obj._id = 'mongoId';
                    cb();
                })
            };
            req.body = { host: 'c6.com', branding: 'c6'};
            req.user = { id: 'u-1234', org: 'o-1234' };
            spyOn(siteSvc, 'setupSite').andCallFake(function(newSite, requester) {
                newSite.id = 's-1';
                return newSite;
            });
            spyOn(siteSvc.createValidator, 'validate').andReturn(true);
            spyOn(siteSvc, 'validateHost').andReturn(true);
        });
        
        it('should reject with a 400 if no site object is provided', function(done) {
            delete req.body;
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('You must provide an object in the body');
                expect(siteColl.findOne).not.toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with a 400 if the host is unspecified', function(done) {
            delete req.body.host;
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('New site object must have a host property');
                expect(siteSvc.validateHost).not.toHaveBeenCalled();
                expect(siteColl.findOne).not.toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject with a 400 if the host is in the wrong format', function(done) {
            siteSvc.validateHost.andReturn(false);
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Host property must be the root domain');
                expect(siteSvc.validateHost).toHaveBeenCalled();
                expect(siteColl.findOne).not.toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with a 409 if the site already exists', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) {
                cb(null, { id: 's-4567', host: 'c6.com' });
            });
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(409);
                expect(resp.body).toEqual('A site with that host already exists');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should successfully create a new site', function(done) {
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.body).toEqual({id: 's-1', host: 'c6.com', branding: 'c6'});
                expect(siteSvc.validateHost).toHaveBeenCalledWith('c6.com');
                expect(siteColl.findOne).toHaveBeenCalledWith({host: 'c6.com'}, anyFunc);
                expect(siteSvc.createValidator.validate).toHaveBeenCalledWith(req.body, {}, req.user);
                expect(siteSvc.setupSite).toHaveBeenCalledWith(req.body);
                expect(siteColl.insert).toHaveBeenCalledWith(resp.body, {w: 1, journal: true}, anyFunc);
                expect(mongoUtils.unescapeKeys).toHaveBeenCalledWith(resp.body);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with a 400 if the new site contains illegal fields', function(done) {
            siteSvc.createValidator.validate.andReturn(false);
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toEqual('Illegal fields');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteSvc.createValidator.validate).toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with an error if finding the existing site fails', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.insert).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail with an error if inserting the site fails', function(done) {
            siteColl.insert.andCallFake(function(obj, opts, cb) { cb('Error!'); });
            siteSvc.createSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.insert).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('updateSite', function() {
        var siteColl;
        beforeEach(function() {
            siteColl = {
                findOne: jasmine.createSpy('sites.findOne').andCallFake(function(query, cb) {
                    if (query.host) cb(null, null);
                    else cb(null, {orig: 'yes'});
                }),
                findAndModify: jasmine.createSpy('sites.findAndModify').andCallFake(
                    function(query, sort, obj, opts, cb) {
                        cb(null, [{ id: 's-4567', updated: true, _id: 'mongoId' }]);
                    })
            };
            req.body = { foo: 'bar' };
            req.params = { id: 's-4567' };
            req.user = { id: 'u-1234' };
            spyOn(siteSvc, 'checkScope').andReturn(true);
            spyOn(siteSvc.updateValidator, 'validate').andReturn(true);
            spyOn(siteSvc, 'validateHost').andReturn(true);
        });
        
        it('should fail immediately if no update object is provided', function(done) {
            delete req.body;
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                req.body = 'foo';
                return siteSvc.updateSite(req, siteColl);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBeDefined(400);
                expect(resp.body).toBe('You must provide an object in the body');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should successfully update a site', function(done) {
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 's-4567', updated: true });
                expect(siteSvc.validateHost).not.toHaveBeenCalled();
                expect(siteColl.findOne).toHaveBeenCalledWith({id: 's-4567'}, anyFunc);
                expect(siteColl.findOne.callCount).toBe(1);
                expect(siteSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, {orig: 'yes'}, 'edit');
                expect(siteSvc.updateValidator.validate)
                    .toHaveBeenCalledWith(req.body, {orig: 'yes'}, {id: 'u-1234'});
                expect(siteColl.findAndModify).toHaveBeenCalledWith({id: 's-4567'}, {id: 1},
                    {$set: {foo: 'bar', lastUpdated: jasmine.any(Date)}}, {w: 1, journal: true, new: true}, anyFunc);
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to update the host if no other site exists with that host', function(done) {
            req.body.host = 'newHost';
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(200);
                expect(resp.body).toEqual({ id: 's-4567', updated: true });
                expect(siteSvc.validateHost).toHaveBeenCalledWith('newHost');
                expect(siteColl.findOne).toHaveBeenCalledWith({id: 's-4567'}, anyFunc);
                expect(siteColl.findOne).toHaveBeenCalledWith({host: 'newHost', id: {$ne: 's-4567'}}, anyFunc);
                expect(siteColl.findAndModify).toHaveBeenCalled();
                expect(mongoUtils.escapeKeys).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the new host is not valid', function(done) {
            req.body.host = 'newHost';
            siteSvc.validateHost.andReturn(false);
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Host property must be the root domain');
                expect(siteSvc.validateHost).toHaveBeenCalledWith('newHost');
                expect(siteColl.findOne).not.toHaveBeenCalled();
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should prevent updating the host if another site exists with that host', function(done) {
            req.body.host = 'newHost';
            siteColl.findOne.andCallFake(function(query, cb) {
                if (query.host) cb(null, {existing: 'yes'});
                else cb(null, {orig: 'yes'});
            });
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(409);
                expect(resp.body).toBe('A site with that host already exists');
                expect(siteColl.findOne.callCount).toBe(2);
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not create a site if they do not exist', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(404);
                expect(resp.body).toBe('That site does not exist');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteSvc.checkScope).not.toHaveBeenCalled();
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit a site the requester is not authorized to edit', function(done) {
            siteSvc.checkScope.andReturn(false);
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this site');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteSvc.checkScope).toHaveBeenCalled();
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit the site if the updates contain illegal fields', function(done) {
            siteSvc.updateValidator.validate.andReturn(false);
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteSvc.updateValidator.validate).toHaveBeenCalled();
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with an error if the first call to findOne fails', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) { cb('Error!'); });
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne.callCount).toBe(1);
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });

        it('should fail with an error if the second call to findOne fails', function(done) {
            req.body.host = 'newHost';
            siteColl.findOne.andCallFake(function(query, cb) {
                if (query.host) cb('Error!');
                else cb(null, {orig: 'yes'});
            });
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne.callCount).toBe(2);
                expect(siteSvc.checkScope).toHaveBeenCalled();
                expect(siteSvc.updateValidator.validate).toHaveBeenCalled();
                expect(siteColl.findAndModify).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            siteColl.findAndModify.andCallFake(function(query, sort, obj, opts, cb) {
                cb('Error!', null);
            });
            siteSvc.updateSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.findAndModify).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('deleteSite', function() {
        var siteColl;
        beforeEach(function() {
            siteColl = {
                findOne: jasmine.createSpy('sites.findOne').andCallFake(function(query, cb) {
                    cb(null, 'original');
                }),
                update: jasmine.createSpy('sites.update').andCallFake(function(query,obj,opts,cb) {
                    cb(null, 1);
                })
            };
            req.params = { id: 's-4567' };
            req.user = { id: 'u-1234' };
            spyOn(siteSvc, 'checkScope').andReturn(true);
        });
        
        it('should successfully mark a site as deleted', function(done) {
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(siteColl.findOne).toHaveBeenCalledWith({id: 's-4567'}, anyFunc);
                expect(siteSvc.checkScope).toHaveBeenCalledWith({id: 'u-1234'}, 'original', 'delete');
                expect(siteColl.update).toHaveBeenCalledWith({id: 's-4567'},
                    {$set: {status: Status.Deleted, lastUpdated: jasmine.any(Date)}}, {w: 1, journal: true}, anyFunc);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not delete a nonexistent site', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) { cb(null, null); });
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not delete a site the requester is not authorized to delete', function(done) {
            siteSvc.checkScope.andReturn(false);
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this site');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteSvc.checkScope).toHaveBeenCalled();
                expect(siteColl.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not edit the site if it has already been deleted', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) {
                cb(null, {id: 's-4567', status: Status.Deleted});
            });
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp.code).toBe(204);
                expect(resp.body).not.toBeDefined();
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.update).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail with an error if findOne fails', function(done) {
            siteColl.findOne.andCallFake(function(query, cb) {
                cb('Error!', null);
            });
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.update).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail with an error if findAndModify fails', function(done) {
            siteColl.update.andCallFake(function(query, obj, ops, cb) {
                cb('Error!', null);
            });
            siteSvc.deleteSite(req, siteColl).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Error!');
                expect(siteColl.findOne).toHaveBeenCalled();
                expect(siteColl.update).toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
});
