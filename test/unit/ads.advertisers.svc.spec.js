var flush = true;
describe('ads-advertisers (UT)', function() {
    var util, mockLog, CrudSvc, Model, logger, q, advertModule, nextSpy, doneSpy, errorSpy, req, mockBeeswax;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        util            = require('util');
        logger          = require('../../lib/logger');
        advertModule    = require('../../bin/ads-advertisers');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');

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

        mockBeeswax = { advertisers: {
            create: jasmine.createSpy('beeswax.advertisers.create()'),
            edit: jasmine.createSpy('beeswax.advertisers.edit()'),
        } };

        req = { uuid: '1234' };

        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });

    describe('setupSvc', function() {
        var svc, mockColl;
        beforeEach(function() {
            mockColl = { collectionName: 'advertisers' };
            [advertModule.createBeeswaxAdvert, advertModule.editBeeswaxAdvert].forEach(function(fn) {
                spyOn(fn, 'bind').and.returnValue(fn);
            });

            svc = advertModule.setupSvc(mockColl, mockBeeswax);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'advertisers' });
            expect(svc.objName).toBe('advertisers');
            expect(svc._prefix).toBe('a');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(false);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(advertModule.advertSchema);
        });

        it('should create beeswax advertisers on create', function() {
            expect(svc._middleware.create).toContain(advertModule.createBeeswaxAdvert);
            expect(advertModule.createBeeswaxAdvert.bind).toHaveBeenCalledWith(advertModule, mockBeeswax);
        });

        it('should edit beeswax advertisers on edit', function() {
            expect(svc._middleware.edit).toContain(advertModule.editBeeswaxAdvert);
            expect(advertModule.editBeeswaxAdvert.bind).toHaveBeenCalledWith(advertModule, mockBeeswax);
        });
    });

    describe('advertiser validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = advertModule.setupSvc({ collectionName: 'advertisers' }, mockBeeswax);
            newObj = { name: 'test' };
            origObj = {};
            requester = { fieldValidation: { advertisers: {} } };
        });

        describe('when handling name', function() {
            it('should fail if the field is not a string', function() {
                newObj.name = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'name must be in format: string' });
            });

            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });

            it('should fail if the field is not defined', function() {
                delete newObj.name;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: name' });
            });

            it('should pass if the field was defined on the original object', function() {
                delete newObj.name;
                origObj.name = 'old org name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'old org name' });
            });

            it('should allow the field to be changed', function() {
                origObj.name = 'old pol name';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj).toEqual({ name: 'test' });
            });
        });

        ['defaultLinks', 'defaultLogos'].forEach(function(field) {
            describe('when handling ' + field, function() {
                it('should fail if the field is not an object', function() {
                    newObj[field] = 123;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: field + ' must be in format: object' });
                });

                it('should allow the field to be set', function() {
                    newObj[field] = { foo: 'bar' };
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj[field]).toEqual({ foo: 'bar' });
                });
            });
        });

        describe('when handling beeswaxIds', function() {
            it('should trim the field if set', function() {
                newObj.beeswaxIds = { advertiser: 1234 };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.beeswaxIds).not.toBeDefined();
            });

            it('should be able to allow some requesters to set the field', function() {
                requester.fieldValidation.advertisers.beeswaxIds = { __allowed: true };
                newObj.beeswaxIds = { advertiser: 1234 };
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.beeswaxIds).toEqual({ advertiser: 1234 });
            });

            it('should fail if the field is not an object', function() {
                requester.fieldValidation.advertisers.beeswaxIds = { __allowed: true };
                newObj.beeswaxIds = 'asdf';
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'beeswaxIds must be in format: object' });
            });
        });
    });

    describe('handleNameInUse', function() {
        var cb, beesBody, beesResp;
        beforeEach(function() {
            beesBody = {
                alternative_id: 'a-1234',
                advertiser_name: 'my advert name'
            };
            beesResp = {
                success: true,
                payload: { advertiser_id: 2345 }
            };
            cb = jasmine.createSpy('cb()').and.callFake(function() { return q(beesResp); });
        });

        it('should normally call the callback and return its response', function(done) {
            advertModule.handleNameInUse(req, beesBody, cb).then(function(resp) {
                expect(resp).toEqual({
                    success: true,
                    payload: { advertiser_id: 2345 }
                });
                expect(cb).toHaveBeenCalledWith();
                expect(cb.calls.count()).toBe(1);
                expect(beesBody).toEqual({
                    alternative_id: 'a-1234',
                    advertiser_name: 'my advert name'
                });
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        describe('if the cb fails with a "name in use" error', function() {
            var errorResp;
            beforeEach(function() {
                errorResp = q.reject({
                    statusCode: 406,
                    message: '406 - {"success":false,"message":"advertiser could not be created","errors":["ERROR: Advertiser name already in use"]}',
                    error: { somestuff: 'yes' }
                });
                cb.and.callFake(function() {
                    if (beesBody.advertiser_name === 'my advert name') {
                        return q(errorResp);
                    } else {
                        return q(beesResp)
                    }
                });
            });

            it('should alter the name, retry the cb, and resolve if that resolves', function(done) {
                advertModule.handleNameInUse(req, beesBody, cb).then(function(resp) {
                    expect(resp).toEqual({
                        success: true,
                        payload: { advertiser_id: 2345 }
                    });
                    expect(cb).toHaveBeenCalledWith();
                    expect(cb.calls.count()).toBe(2);
                    expect(beesBody).toEqual({
                        alternative_id: 'a-1234',
                        advertiser_name: 'my advert name (a-1234)'
                    });
                }).catch(function(error) {
                    expect(error).not.toBeDefined();
                }).done(done);
            });

            it('should fail if the cb fails on the second try as well', function(done) {
                beesResp = errorResp;
                advertModule.handleNameInUse(req, beesBody, cb).then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual({
                        statusCode: 406,
                        message: '406 - {"success":false,"message":"advertiser could not be created","errors":["ERROR: Advertiser name already in use"]}',
                        error: { somestuff: 'yes' }
                    });
                    expect(cb).toHaveBeenCalledWith();
                    expect(cb.calls.count()).toBe(2);
                    expect(beesBody).toEqual({
                        alternative_id: 'a-1234',
                        advertiser_name: 'my advert name (a-1234)'
                    });
                }).done(done);
            });
        });

        it('should reject if the cb fails with something besides a "name in use" error', function(done) {
            beesResp = q.reject({
                statusCode: 406,
                message: '406 - {"success":false,"message":"advertiser could not be created","errors":["ERROR: Advertiser is THE WORST"]}',
                error: { somestuff: 'yes' }
            });
            advertModule.handleNameInUse(req, beesBody, cb).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({
                    statusCode: 406,
                    message: '406 - {"success":false,"message":"advertiser could not be created","errors":["ERROR: Advertiser is THE WORST"]}',
                    error: { somestuff: 'yes' }
                });
                expect(cb).toHaveBeenCalledWith();
                expect(cb.calls.count()).toBe(1);
            }).done(done);
        });
    });

    describe('createBeeswaxAdvert', function() {
        var beesResp;
        beforeEach(function() {
            req.body = {
                id: 'a-1234',
                name: 'my new advert'
            };
            beesResp = {
                success: true,
                payload: {
                    advertiser_id: 3456,
                    advertiser_name: 'my new advert',
                    foo: 'bar'
                }
            };
            spyOn(advertModule, 'handleNameInUse').and.callFake(function(req, obj, cb) {
                return cb();
            });
            mockBeeswax.advertisers.create.and.callFake(function() { return q(beesResp); });
        });

        it('should create a beeswax advertiser for the new advertiser', function(done) {
            advertModule.createBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body).toEqual({
                    id: 'a-1234',
                    name: 'my new advert',
                    beeswaxIds: { advertiser: 3456 }
                });
                var beesBody = { alternative_id: 'a-1234', advertiser_name: 'my new advert' };
                expect(advertModule.handleNameInUse).toHaveBeenCalledWith(req, beesBody, jasmine.any(Function));
                expect(mockBeeswax.advertisers.create).toHaveBeenCalledWith(beesBody);
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should warn and return a 4xx if the beeswax request resolves with an unsuccessful response', function(done) {
            beesResp = { success: false, message: 'i cant do it' };
            advertModule.createBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Could not create Beeswax Advertiser' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(advertModule.handleNameInUse).toHaveBeenCalled();
                expect(mockBeeswax.advertisers.create).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('i cant do it');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the beeswax request fails', function(done) {
            beesResp = q.reject('beeswax struggles');
            advertModule.createBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error creating Beeswax advertiser');
                expect(advertModule.handleNameInUse).toHaveBeenCalled();
                expect(mockBeeswax.advertisers.create).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('beeswax struggles'));
            }).done(done);
        });
    });

    describe('editBeeswaxAdvert', function() {
        beforeEach(function() {
            req.body = {
                id: 'a-1234',
                name: 'my advert 1.1'
            };
            req.origObj = {
                id: 'a-1234',
                name: 'my advert',
                beeswaxIds: { advertiser: 3456 }
            };
            req.query = {

            };
            beesResp = {
                success: true,
                payload: {
                    advertiser_id: 3456,
                    advertiser_name: 'my advert 1.1',
                    foo: 'bar'
                }
            };

            spyOn(advertModule, 'handleNameInUse').and.callFake(function(req, obj, cb) {
                return cb();
            });
            mockBeeswax.advertisers.edit.and.callFake(function() { return q(beesResp); });
            mockBeeswax.advertisers.create.and.callFake(function() { return q(beesResp); });
        });

        it('should edit the beeswax advertiser for the C6 advertiser', function(done) {
            advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                var beesBody = { alternative_id: 'a-1234', advertiser_name: 'my advert 1.1' };
                expect(mockBeeswax.advertisers.create).not.toHaveBeenCalled();
                expect(advertModule.handleNameInUse).toHaveBeenCalledWith(req, beesBody, jasmine.any(Function));
                expect(mockBeeswax.advertisers.edit).toHaveBeenCalledWith(3456, beesBody);
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        it('should create a Beeswax advertiser for a pre-existing c6 advertiser', function (done) {
          delete req.origObj.beeswaxIds;
          req.query.initBeeswax = 'true';
          mockBeeswax.advertisers.create.and.callFake(function() { return q(beesResp); });
          spyOn(advertModule, 'createBeeswaxAdvert').and.callThrough(mockBeeswax, req, nextSpy, doneSpy);
          advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
            expect(req.query.initBeeswax).toBeTruthy();
            expect(req.origObj.beeswaxIds).toBeFalsy();
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
            expect(advertModule.createBeeswaxAdvert).toHaveBeenCalledWith(mockBeeswax, req, nextSpy, doneSpy);
            expect(advertModule.handleNameInUse).toHaveBeenCalled();
            expect(mockBeeswax.advertisers.edit).not.toHaveBeenCalled();
            expect(mockLog.warn).not.toHaveBeenCalled();
            expect(mockLog.error).not.toHaveBeenCalled();
          }).done(done);
        });
        it('should skip if the advertiser has no beeswax advertiser', function(done) {
            delete req.origObj.beeswaxIds;
            advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(advertModule.handleNameInUse).not.toHaveBeenCalled();
                expect(mockBeeswax.advertisers.edit).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should skip if the name is unchanged', function(done) {
            req.body.name = req.origObj.name;
            advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(advertModule.handleNameInUse).not.toHaveBeenCalled();
                expect(mockBeeswax.advertisers.edit).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should warn and return a 4xx if the beeswax request resolves with an unsuccessful response', function(done) {
            beesResp = { success: false, message: 'i cant do it' };
            advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Could not edit Beeswax Advertiser' });
                expect(errorSpy).not.toHaveBeenCalled();
                expect(advertModule.handleNameInUse).toHaveBeenCalled();
                expect(mockBeeswax.advertisers.edit).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.warn.calls.mostRecent().args).toContain('i cant do it');
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if the beeswax request fails', function(done) {
            beesResp = q.reject('beeswax struggles');
            advertModule.editBeeswaxAdvert(mockBeeswax, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error editing Beeswax advertiser');
                expect(advertModule.handleNameInUse).toHaveBeenCalled();
                expect(mockBeeswax.advertisers.edit).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
                expect(mockLog.error.calls.mostRecent().args).toContain(util.inspect('beeswax struggles'));
            }).done(done);
        });
    });
});
