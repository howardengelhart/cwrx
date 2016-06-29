'use strict';

describe('orgSvc-paymentPlans', function() {
    var proxyquire, express, authUtils, createUuid, expressUtils, q, Status, logger, inspect;
    var paymentPlans;
    var log, CrudSvc;
    var setupSvc, setupEndpoints;

    function MockCollection(name) {
        this.collectionName = name;

        this.count = jasmine.createSpy('count()').and.returnValue(q(0));
    }

    function MockDatabase(collections) {
        this.__private__ = {
            collections: collections.reduce(function(hash, collection) {
                hash[collection.collectionName] = collection;
                return hash;
            }, {})
        };
    }
    MockDatabase.prototype.collection = function(name) {
        return this.__private__.collections[name];
    };

    beforeAll(function() {
        Object.keys(require.cache).forEach(function(module) {
            delete require.cache[module];
        });

        proxyquire = require('proxyquire');
        express = require('express');
        authUtils = require('../../lib/authUtils');
        createUuid = require('rc-uuid').createUuid;
        expressUtils = require('../../lib/expressUtils');
        q = require('q');
        Status = require('../../lib/enums').Status;
        logger = require('../../lib/logger');
        inspect = require('util').inspect;
    });

    beforeEach(function() {
        log = jasmine.createSpyObj('log', ['trace', 'info', 'warn', 'error']);

        spyOn(logger, 'getLog').and.returnValue(log);

        CrudSvc = jasmine.createSpy('CrudSvc()').and.callFake(function(coll, prefix, opts, schema) {
            var service = new (require('../../lib/crudSvc'))(coll, prefix, opts, schema);

            spyOn(service, 'use').and.callThrough();

            return service;
        });

        paymentPlans = proxyquire('../../bin/orgSvc-paymentPlans', {
            '../lib/crudSvc': CrudSvc
        });

        setupSvc = paymentPlans.setupSvc;
        setupEndpoints = paymentPlans.setupEndpoints;
    });

    describe('setupSvc(db)', function() {
        var paymentPlans, orgs;
        var db;
        var result;

        beforeEach(function() {
            paymentPlans = new MockCollection('paymentPlans');
            orgs = new MockCollection('orgs');

            db = new MockDatabase([paymentPlans, orgs]);

            result = setupSvc(db);
        });

        it('should return a CrudSvc', function() {
            expect(CrudSvc).toHaveBeenCalledWith(paymentPlans, 'pp', { userProp: false, orgProp: false, allowPublic: true }, jasmine.objectContaining({
                label: {
                    __allowed: true,
                    __type: 'string',
                    __required: true
                },
                price: {
                    __allowed: true,
                    __type: 'number',
                    __required: true,
                    __min: 0
                },
                maxCampaigns: {
                    __allowed: true,
                    __type: 'number',
                    __required: true,
                    __min: 0
                },
                viewsPerMonth: {
                    __allowed: true,
                    __type: 'number',
                    __required: true,
                    __min: 0
                }
            }));

            expect(result).toBe(CrudSvc.calls.mostRecent().returnValue);
        });

        describe('middleware', function() {
            var middlewares;
            var middleware;

            describe('delete', function() {
                beforeEach(function() {
                    middlewares = result._middleware.delete.slice(-1);
                });

                describe('[0]', function() {
                    var success, failure;
                    var countDeferred;
                    var req, next, done;

                    beforeEach(function(proceed) {
                        middleware = middlewares[0];

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        db.collection('orgs').count.and.returnValue((countDeferred = q.defer()).promise);

                        req = {
                            uuid: createUuid(),
                            params: {
                                id: 'pp-' + createUuid()
                            }
                        };
                        next = jasmine.createSpy('next()');
                        done = jasmine.createSpy('done()');

                        middleware(req, next, done).then(success, failure);
                        process.nextTick(proceed);
                    });

                    it('should query for orgs', function() {
                        expect(orgs.count).toHaveBeenCalledWith({
                            status: { $ne: Status.Deleted },
                            $or: [
                                { paymentPlanId: req.params.id },
                                { nextPaymentPlanId: req.params.id }
                            ]
                        });
                    });

                    describe('if the count is 0', function() {
                        beforeEach(function(done) {
                            countDeferred.resolve(0);
                            process.nextTick(done);
                        });

                        it('should not call done()', function() {
                            expect(done).not.toHaveBeenCalled();
                        });

                        it('should call next()', function() {
                            expect(next).toHaveBeenCalledWith();
                        });

                        it('should fulfill the promise', function() {
                            expect(success).toHaveBeenCalled();
                        });
                    });

                    describe('if the count is greater than 0', function() {
                        beforeEach(function(done) {
                            countDeferred.resolve(1);
                            process.nextTick(done);
                        });

                        it('should not call next()', function() {
                            expect(next).not.toHaveBeenCalled();
                        });

                        it('should call done()', function() {
                            expect(done).toHaveBeenCalledWith({
                                code: 400,
                                body: 'Payment Plan is still in use'
                            });
                        });

                        it('should fulfill the promise', function() {
                            expect(success).toHaveBeenCalled();
                        });
                    });

                    describe('if there is a mongo error', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Some internal mongo BS');

                            countDeferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should not call next()', function() {
                            expect(next).not.toHaveBeenCalled();
                        });

                        it('should not call done()', function() {
                            expect(done).not.toHaveBeenCalled();
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalledWith(jasmine.any(String), req.uuid, inspect(reason));
                        });

                        it('should reject the Promise', function() {
                            expect(failure).toHaveBeenCalledWith(new Error('There was an Error from mongo'));
                        });
                    });
                });
            });
        });
    });

    describe('setupEndpoints(app, catSvc, sessions, audit, jobManager)', function() {
        var app, service, sessions, audit, jobManager;
        var router, publicAuth, auth, parseMultiQuery;

        beforeEach(function() {
            app = {
                use: jasmine.createSpy('app.use()')
            };

            service = setupSvc(new MockDatabase([new MockCollection('paymentPlans')]));

            sessions = jasmine.createSpy('sessions()');

            audit = jasmine.createSpy('audit()');

            jobManager = {
                setJobTimeout: jasmine.createSpy('jobManager.setJobTimeout()'),
                endJob: jasmine.createSpy('jobManager.endJob()')
            };

            spyOn(express, 'Router').and.callFake(function() {
                var router = {
                    __routes__: {
                        get: {},
                        post: {},
                        put: {},
                        delete: {}
                    },

                    use: jasmine.createSpy('router.use()')
                };

                ['get', 'post', 'put', 'delete'].forEach(function(method) {
                    router[method] = jasmine.createSpy('router.' + method + '()').and.callFake(function(route/*, middlewares*/) {
                        var middlewares = Array.prototype.slice.call(arguments, 1);

                        this.__routes__[method][route] = middlewares;
                    });
                });

                return router;
            });
            spyOn(jobManager.setJobTimeout, 'bind').and.callThrough();
            spyOn(authUtils, 'crudMidware').and.callThrough();
            spyOn(authUtils, 'middlewarify').and.callThrough();
            spyOn(expressUtils, 'parseQuery').and.callThrough();

            setupEndpoints(app, service, sessions, audit, jobManager);

            router = express.Router.calls.mostRecent().returnValue;
            publicAuth = authUtils.middlewarify.calls.mostRecent().returnValue;
            auth = authUtils.crudMidware.calls.mostRecent().returnValue;
            parseMultiQuery = expressUtils.parseQuery.calls.mostRecent().returnValue;
        });

        it('should create a Router', function() {
            expect(express.Router).toHaveBeenCalledWith();
        });

        it('should use the jobManager timeout', function() {
            expect(jobManager.setJobTimeout.bind).toHaveBeenCalledWith(jobManager);
            expect(router.use).toHaveBeenCalledWith(jobManager.setJobTimeout.bind.calls.mostRecent().returnValue);
        });

        it('should create some auth crudMidware', function() {
            expect(authUtils.crudMidware).toHaveBeenCalledWith('paymentPlans', { allowApps: true });
        });

        it('should create some public authMidware', function() {
            expect(authUtils.middlewarify).toHaveBeenCalledWith({ allowApps: true });
        });

        it('should create middleware for parsing multi-entity GET queries', function() {
            expect(expressUtils.parseQuery).toHaveBeenCalledWith({ arrays: ['ids'] });
        });

        it('should use the router', function() {
            expect(app.use).toHaveBeenCalledWith('/api/payment-plans', router);
        });

        describe('GET /:id', function() {
            var middlewares, handler;

            beforeEach(function() {
                var all = router.__routes__.get['/:id'] || [];

                middlewares = all.slice(0, -1);
                handler = all[all.length - 1];
            });

            it('should use middleware', function() {
                expect(middlewares).toEqual([sessions, publicAuth, audit]);
            });

            describe('when invoked', function() {
                var req, res;
                var deferred;

                beforeEach(function(done) {
                    req = {
                        params: {
                            id: 'pp-' + createUuid()
                        }
                    };
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };

                    spyOn(service, 'getObjs').and.returnValue((deferred = q.defer()).promise);

                    handler(req, res);
                    process.nextTick(done);
                });

                it('should get the Object', function() {
                    expect(service.getObjs).toHaveBeenCalledWith({ id: req.params.id }, req, false);
                });

                describe('if the get', function() {
                    var endJobDeferred;

                    beforeEach(function() {
                        jobManager.endJob.and.returnValue((endJobDeferred = q.defer()).promise);
                    });

                    describe('succeeds', function() {
                        var value;

                        beforeEach(function(done) {
                            value = {
                                id: req.params.id,
                                data: {
                                    foo: 'bar'
                                }
                            };

                            deferred.resolve(value);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });

                    describe('fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Something went wrong!');

                            deferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });
                });
            });
        });

        describe('GET /', function() {
            var middlewares, handler;

            beforeEach(function() {
                var all = router.__routes__.get['/'] || [];

                middlewares = all.slice(0, -1);
                handler = all[all.length - 1];
            });

            it('should use middleware', function() {
                expect(middlewares).toEqual([sessions, publicAuth, audit, parseMultiQuery]);
            });

            describe('when invoked', function() {
                var req, res;
                var deferred;

                beforeEach(function(done) {
                    req = {
                        params: {},
                        query: {
                            sort: 'created,1'
                        }
                    };
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };

                    spyOn(service, 'getObjs').and.returnValue((deferred = q.defer()).promise);

                    handler(req, res);
                    process.nextTick(done);
                });

                it('should get the Objects', function() {
                    expect(service.getObjs).toHaveBeenCalledWith({}, req, true);
                });

                describe('if the query has ids', function() {
                    beforeEach(function(done) {
                        service.getObjs.calls.reset();

                        req.query.ids = ['pp-' + createUuid(), 'pp-' + createUuid()];

                        handler(req, res);
                        process.nextTick(done);
                    });

                    it('should construct a query', function() {
                        expect(service.getObjs).toHaveBeenCalledWith({
                            id: req.query.ids
                        }, req, true);
                    });
                });

                describe('if the get', function() {
                    var endJobDeferred;

                    beforeEach(function() {
                        jobManager.endJob.and.returnValue((endJobDeferred = q.defer()).promise);
                    });

                    describe('succeeds', function() {
                        var value;

                        beforeEach(function(done) {
                            value = [
                                {
                                    id: req.params.id,
                                    data: {
                                        foo: 'bar'
                                    }
                                }
                            ];

                            deferred.resolve(value);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });

                    describe('fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Something went wrong!');

                            deferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });
                });
            });
        });

        describe('POST /', function() {
            var middlewares, handler;

            beforeEach(function() {
                var all = router.__routes__.post['/'] || [];

                middlewares = all.slice(0, -1);
                handler = all[all.length - 1];
            });

            it('should use middleware', function() {
                expect(middlewares).toEqual([sessions, auth.create, audit]);
            });

            describe('when invoked', function() {
                var req, res;
                var deferred;

                beforeEach(function(done) {
                    req = {
                        params: {},
                        query: {},
                        body: {
                            data: { foo: 'bar' }
                        }
                    };
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };

                    spyOn(service, 'createObj').and.returnValue((deferred = q.defer()).promise);

                    handler(req, res);
                    process.nextTick(done);
                });

                it('should create the Object', function() {
                    expect(service.createObj).toHaveBeenCalledWith(req);
                });

                describe('if the create', function() {
                    var endJobDeferred;

                    beforeEach(function() {
                        jobManager.endJob.and.returnValue((endJobDeferred = q.defer()).promise);
                    });

                    describe('succeeds', function() {
                        var value;

                        beforeEach(function(done) {
                            value = {
                                id: 'pp-' + createUuid(),
                                data: {
                                    foo: 'bar'
                                }
                            };

                            deferred.resolve(value);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });

                    describe('fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Something went wrong!');

                            deferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });
                });
            });
        });

        describe('PUT /:id', function() {
            var middlewares, handler;

            beforeEach(function() {
                var all = router.__routes__.put['/:id'] || [];

                middlewares = all.slice(0, -1);
                handler = all[all.length - 1];
            });

            it('should use middleware', function() {
                expect(middlewares).toEqual([sessions, auth.edit, audit]);
            });

            describe('when invoked', function() {
                var req, res;
                var deferred;

                beforeEach(function(done) {
                    req = {
                        params: {
                            id: 'pp-' + createUuid()
                        },
                        query: {},
                        body: {
                            data: { foo: 'bar' }
                        }
                    };
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };

                    spyOn(service, 'editObj').and.returnValue((deferred = q.defer()).promise);

                    handler(req, res);
                    process.nextTick(done);
                });

                it('should edit the Object', function() {
                    expect(service.editObj).toHaveBeenCalledWith(req);
                });

                describe('if the edit', function() {
                    var endJobDeferred;

                    beforeEach(function() {
                        jobManager.endJob.and.returnValue((endJobDeferred = q.defer()).promise);
                    });

                    describe('succeeds', function() {
                        var value;

                        beforeEach(function(done) {
                            value = {
                                id: req.params.id,
                                data: {
                                    foo: 'bar'
                                }
                            };

                            deferred.resolve(value);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });

                    describe('fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Something went wrong!');

                            deferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });
                });
            });
        });

        describe('DELETE /:id', function() {
            var middlewares, handler;

            beforeEach(function() {
                var all = router.__routes__.delete['/:id'] || [];

                middlewares = all.slice(0, -1);
                handler = all[all.length - 1];
            });

            it('should use middleware', function() {
                expect(middlewares).toEqual([sessions, auth.delete, audit]);
            });

            describe('when invoked', function() {
                var req, res;
                var deferred;

                beforeEach(function(done) {
                    req = {
                        params: {
                            id: 'pp-' + createUuid()
                        },
                        query: {},
                        body: {
                            data: { foo: 'bar' }
                        }
                    };
                    res = {
                        send: jasmine.createSpy('res.send()')
                    };

                    spyOn(service, 'deleteObj').and.returnValue((deferred = q.defer()).promise);

                    handler(req, res);
                    process.nextTick(done);
                });

                it('should delete the Object', function() {
                    expect(service.deleteObj).toHaveBeenCalledWith(req);
                });

                describe('if the delete', function() {
                    var endJobDeferred;

                    beforeEach(function() {
                        jobManager.endJob.and.returnValue((endJobDeferred = q.defer()).promise);
                    });

                    describe('succeeds', function() {
                        var value;

                        beforeEach(function(done) {
                            value = null;

                            deferred.resolve(value);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });

                    describe('fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Something went wrong!');

                            deferred.reject(reason);
                            process.nextTick(done);
                        });

                        it('should end the job', function() {
                            expect(jobManager.endJob).toHaveBeenCalledWith(req, res, deferred.promise.inspect());
                        });

                        describe('if ending the job fails', function() {
                            var reason;

                            beforeEach(function(done) {
                                reason = new Error('Something really bad happened!');

                                endJobDeferred.reject(reason);
                                process.nextTick(done);
                            });

                            it('should send a 500', function() {
                                expect(res.send).toHaveBeenCalledWith(500, { error: reason.message, detail: reason });
                            });
                        });
                    });
                });
            });
        });
    });
});
