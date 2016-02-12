var flush = true;
describe('geo (UT)', function() {
    var mockLog, CrudSvc, logger, q, geoModule, express, expressUtils, journal, authUtils,
        req, res, next;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q           = require('q');
        express     = require('express');
        geoModule   = require('../../bin/geo');
        logger      = require('../../lib/logger');
        CrudSvc     = require('../../lib/crudSvc');
        expressUtils= require('../../lib/expressUtils');
        authUtils   = require('../../lib/authUtils');
        journal     = require('../../lib/journal');

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
        
        req = { uuid: '1234' };
        res = {
            header: jasmine.createSpy('res.header()'),
            send: jasmine.createSpy('res.send()')
        }
        next = jasmine.createSpy('next');
    });

    describe('setupZipSvc', function() {
        var svc, mockColl, config;
        beforeEach(function() {
            spyOn(CrudSvc.prototype.validateUniqueProp, 'bind').and.returnValue(CrudSvc.prototype.validateUniqueProp);
            mockColl = { collectionName: 'zipcodes' };
            config = { maxReadLimit: 666 };
            svc = geoModule.setupZipSvc(mockColl, config);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'zipcodes' });
            expect(svc.objName).toBe('zipcodes');
            expect(svc._prefix).toBe(null);
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(true);
            expect(svc.maxReadLimit).toBe(666);
        });
    });
    
    describe('main', function() {
        var state, mockExpress, expressApp, mockSvc, basicMidware, errorHandler, fakeJournal;
        beforeEach(function() {
            function getCollSpy() {
                return jasmine.createSpy('db.collection()').and.callFake(function(collName) {
                    return { db: this, collectionName: collName };
                })
            }
            state = {
                clusterMaster: false,
                dbs: {
                    c6Db: { collection: getCollSpy() },
                    c6Journal: { collection: getCollSpy() },
                    geoDb: { collection: getCollSpy() }
                },
                sessions: jasmine.createSpy('sessions()'),
                config: {
                    appName: 'geo',
                    appVersion: 'geo-1.2.3',
                    maxReadLimit: 666
                },
                cmdl: {
                    port: 6666
                }
            };
            expressRoutes = {
                get: {}
            };
            mockExpress = require.cache[require.resolve('express')].exports = jasmine.createSpy('express()').and.callFake(function() {
                expressApp = express.apply(null, arguments);

                spyOn(expressApp, 'listen');
                spyOn(expressApp, 'use');
                spyOn(expressApp, 'get').and.callFake(function(route/*, middleware*/) {
                    var middleware = Array.prototype.slice.call(arguments, 1);

                    expressRoutes.get[route] = (expressRoutes.get[route] || []).concat(middleware);
                });
                spyOn(expressApp, 'set');

                return expressApp;
            });
            basicMidware = jasmine.createSpy('basicMidware()');
            errorHandler = jasmine.createSpy('errorHandler()');
            spyOn(expressUtils, 'basicMiddleware').and.returnValue(basicMidware);
            spyOn(expressUtils, 'errorHandler').and.returnValue(errorHandler);

            fakeJournal = {
                _midware: jasmine.createSpy('journal.middleware'),
                middleware: {
                    bind: jasmine.createSpy('bind()').and.callFake(function() { return fakeJournal._midware; })
                }
            };
            spyOn(journal, 'AuditJournal').and.returnValue(fakeJournal);
            
            delete require.cache[require.resolve('../../bin/geo')];
            geoModule = require('../../bin/geo');

            mockSvc = { getObjs: jasmine.createSpy('getObjs') };
            spyOn(geoModule, 'setupZipSvc').and.returnValue(mockSvc);
        });

        afterEach(function() {
            delete require.cache[require.resolve('express')];
            delete authUtils._db;
        });
        
        describe('if the process is the clusterMaster', function() {
            beforeEach(function() {
                state.clusterMaster = true;
            });

            it('should return without setting up express', function() {
                var resp = geoModule.main(state);
                expect(resp).toBe(state);
                expect(mockExpress).not.toHaveBeenCalled();
                expect(expressApp).not.toBeDefined();
            });
        });
        
        it('should setup the zipcode service', function() {
            var resp = geoModule.main(state);
            expect(resp).toBe(state);
            expect(geoModule.setupZipSvc).toHaveBeenCalledWith({ db: state.dbs.geoDb, collectionName: 'zipcodes' }, state.config);
        });
        
        it('should setup the express app', function() {
            var resp = geoModule.main(state);
            expect(mockExpress).toHaveBeenCalled();
            expect(expressApp.set).toHaveBeenCalledWith('json spaces', 2);
            expect(expressApp.set).toHaveBeenCalledWith('trust proxy', 1);
            expect(expressApp.use).toHaveBeenCalledWith(basicMidware);
            expect(expressApp.use).toHaveBeenCalledWith(errorHandler);
            expect(expressApp.listen).toHaveBeenCalledWith(6666);
        });
        
        it('should initialize the journal', function() {
            var resp = geoModule.main(state);
            expect(journal.AuditJournal).toHaveBeenCalledWith({ db: state.dbs.c6Journal, collectionName: 'audit' }, 'geo-1.2.3', 'geo');
        });
        
        it('should set the authUtils._db', function() {
            var resp = geoModule.main(state);
            expect(authUtils._db).toBe(state.dbs.c6Db);
        });
        
        describe('creates a handler for GET /api/geo/meta that', function() {
            beforeEach(function() {
                jasmine.clock().install();
                jasmine.clock().mockDate(new Date('2016-02-10T17:25:38.555Z'));
                geoModule.main(state);
            });
            
            afterEach(function() {
                jasmine.clock().uninstall();
            });

            it('should exist and include no middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/geo/meta', jasmine.any(Function));
            });
            
            it('should return some service metadata when called', function() {
                var handler = expressRoutes.get['/api/geo/meta'][0];
                handler(req, res, next);
                expect(res.send).toHaveBeenCalledWith(200, {
                    version: 'geo-1.2.3',
                    status: 'OK',
                    started: '2016-02-10T17:25:38.555Z'
                });
                expect(next).not.toHaveBeenCalled();
            });
        });

        describe('creates a handler for GET /api/geo/version that', function() {
            beforeEach(function() {
                geoModule.main(state);
            });
            
            it('should exist and include no middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/geo/version', jasmine.any(Function));
            });
            
            it('should return the service version when called', function() {
                var handler = expressRoutes.get['/api/geo/version'][0];
                handler(req, res, next);
                expect(res.send).toHaveBeenCalledWith(200, 'geo-1.2.3');
            });
        });

        describe('creates a handler for GET /api/geo/zipcodes/:code that', function() {
            var authMidware;
            beforeEach(function() {
                authMidware = jasmine.createSpy('authMidware()');
                spyOn(authUtils, 'middlewarify').and.returnValue(authMidware);
                geoModule.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/geo/zipcodes?/:code',
                    state.sessions, authMidware, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    req.params = { code: '08540' };
                    handler = expressRoutes.get['/api/geo/zipcodes?/:code'][expressRoutes.get['/api/geo/zipcodes?/:code'].length - 1];
                    mockSvc.getObjs.and.returnValue(q({ code: 400, body: 'i got a problem with YOU' }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(400, 'i got a problem with YOU');
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({ zipcode: '08540' }, req, false);
                    }).done(done);
                });
                
                it('should return a 500 if svc.getObjs rejects', function(done) {
                    mockSvc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error retrieving zipcode', detail: 'I GOT A PROBLEM' });
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({ zipcode: '08540' }, req, false);
                    }).done(done);
                });
            });
        });

        describe('creates a handler for GET /api/geo/zipcodes/ that', function() {
            var authMidware;
            beforeEach(function() {
                authMidware = jasmine.createSpy('authMidware()');
                spyOn(authUtils, 'middlewarify').and.returnValue(authMidware);
                geoModule.main(state);
            });
            
            it('should exist and include necessary middleware', function() {
                expect(expressApp.get).toHaveBeenCalledWith('/api/geo/zipcodes?/',
                    state.sessions, authMidware, fakeJournal._midware, jasmine.any(Function));
            });
            
            describe('when called', function() {
                var handler;
                beforeEach(function() {
                    req.query = {};
                    handler = expressRoutes.get['/api/geo/zipcodes?/'][expressRoutes.get['/api/geo/zipcodes?/'].length - 1];
                    mockSvc.getObjs.and.returnValue(q({
                        code: 200,
                        body: [{ zipcode: '08540' }],
                        headers: { 'content-range': 'items 1-10/43000' }
                    }));
                });
                
                it('should call svc.getObjs and return the response', function(done) {
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, [{ zipcode: '08540' }]);
                        expect(res.header).toHaveBeenCalledWith('content-range', 'items 1-10/43000');
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({}, req, true);
                    }).done(done);
                });
                
                it('should handle the zipcodes query param', function(done) {
                    req.query.zipcodes = '08540,07078';
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(200, [{ zipcode: '08540' }]);
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({ zipcode: ['08540', '07078'] }, req, true);
                    }).done(done);
                });
                
                it('should handle invalid zipcodes query param values', function(done) {
                    q.all([{ $gt: '' }, 'foo,,,bar'].map(function(val) {
                        var reqCopy = JSON.parse(JSON.stringify(req));
                        reqCopy.query.zipcodes = val;
                        return q(handler(reqCopy, res, next));
                    })).then(function() {
                        expect(res.send.calls.count()).toBe(2);
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs.calls.count()).toBe(2);
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({ zipcode: ['[object Object]'] }, jasmine.any(Object), true);
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({ zipcode: ['foo', '', '', 'bar'] }, jasmine.any(Object), true);
                    }).done(done);
                });
                
                it('should return a 500 if svc.getObjs rejects', function(done) {
                    mockSvc.getObjs.and.returnValue(q.reject('I GOT A PROBLEM'));
                    q(handler(req, res, next)).finally(function() {
                        expect(res.send).toHaveBeenCalledWith(500, { error: 'Error retrieving zipcodes', detail: 'I GOT A PROBLEM' });
                        expect(res.header).not.toHaveBeenCalled();
                        expect(next).not.toHaveBeenCalled();
                        expect(mockSvc.getObjs).toHaveBeenCalledWith({}, req, true);
                    }).done(done);
                });
            });
        });
    });
});
