var flush = true;
describe('content-cards (UT)', function() {
    var urlUtils, q, cardModule, CrudSvc, Status, Model, objUtils, mongoUtils, logger, mockLog,
        mockDb, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        urlUtils        = require('url');
        q               = require('q');
        cardModule      = require('../../bin/content-cards');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        objUtils        = require('../../lib/objUtils');
        mongoUtils      = require('../../lib/mongoUtils');
        logger          = require('../../lib/logger');
        Status          = require('../../lib/enums').Status;

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
        
        cardModule.config = {
            trackingPixel: 'track.me',
        };

        mockDb = {
            collection: jasmine.createSpy('db.collection()').and.callFake(function(name) {
                return { collectionName: name };
            })
        };
        
        req = {
            uuid: '1234',
            baseUrl: '',
            route: { path: '' },
            params: {},
            query: {},
            user: { id: 'u-1' },
            requester: { id: 'u-1', permissions: {} },
        };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
        
        jasmine.clock().install();
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    describe('setupSvc', function() {
        var svc, boundFns, config, caches, metagetta;

        function getBoundFn(original, argParams) {
            var boundObj = boundFns.filter(function(call) {
                return call.original === original && objUtils.compareObjects(call.args, argParams);
            })[0] || {};
            
            return boundObj.bound;
        }

        beforeEach(function() {
            config = {
                trackingPixel: 'track.me.plz',
            };
            caches = { cash: 'money' };
            metagetta = { hasGoogleKey: true };

            boundFns = [];
            var bind = Function.prototype.bind;
            
            [cardModule.fetchCamp, cardModule.campStatusCheck, cardModule.getPublicCard, cardModule.chooseCards].forEach(function(fn) {
                spyOn(fn, 'bind').and.callFake(function() {
                    var boundFn = bind.apply(fn, arguments);

                    boundFns.push({
                        bound: boundFn,
                        original: fn,
                        args: Array.prototype.slice.call(arguments)
                    });

                    return boundFn;
                });
            });
            
            svc = cardModule.setupSvc(mockDb, config, caches, metagetta);
        });

        it('should return a CrudSvc', function() {
            expect(svc).toEqual(jasmine.any(CrudSvc));
            expect(svc._coll).toEqual({ collectionName: 'cards' });
            expect(svc._db).toBe(mockDb);
            expect(svc.objName).toBe('cards');
            expect(svc._prefix).toBe('rc');
            expect(svc._userProp).toBe(true);
            expect(svc._orgProp).toBe(true);
            expect(svc._allowPublic).toBe(true);
            expect(svc.model).toEqual(jasmine.any(Model));
            expect(svc.model.schema).toBe(cardModule.cardSchema);
            expect(mockLog.warn).not.toHaveBeenCalled();
        });
        
        it('should save some config variables locally', function() {
            expect(cardModule.config.trackingPixel).toBe('track.me.plz');
            expect(cardModule.metagetta).toBe(metagetta);
        });
        
        it('should save some bound methods on the service', function() {
            expect(svc.getPublicCard).toEqual(getBoundFn(cardModule.getPublicCard, [cardModule, svc, caches]));
            expect(svc.chooseCards).toEqual(getBoundFn(cardModule.chooseCards, [cardModule, svc, caches]));
        });
        
        it('should fetch the campaign on create, edit, and delete', function() {
            expect(svc._middleware.create).toContain(getBoundFn(cardModule.fetchCamp, [cardModule, svc]));
            expect(svc._middleware.edit).toContain(getBoundFn(cardModule.fetchCamp, [cardModule, svc]));
            expect(svc._middleware.delete).toContain(getBoundFn(cardModule.fetchCamp, [cardModule, svc]));
        });
        
        it('should check the campaign\'s status on edit + delete', function() {
            expect(svc._middleware.edit).toContain(getBoundFn(cardModule.campStatusCheck, [cardModule, [Status.Draft]]));
            expect(svc._middleware.delete).toContain(getBoundFn(cardModule.campStatusCheck,
                [cardModule, [Status.Draft, Status.Pending, Status.Canceled, Status.Expired]]));
        });
        
        it('should prevent editing cards if the campaign has an update request', function() {
            expect(svc._middleware.edit).toContain(cardModule.enforceUpdateLock);
        });
        
        it('should get video metadata on create + edit', function() {
            expect(svc._middleware.create).toContain(cardModule.getMetaData);
            expect(svc._middleware.edit).toContain(cardModule.getMetaData);
        });
        
        it('should setup moat data on create + edit', function() {
            expect(svc._middleware.create).toContain(cardModule.setupMoat);
            expect(svc._middleware.edit).toContain(cardModule.setupMoat);
        });

        it('should complain if there is no youtube key',function(){
            cardModule.setupSvc(mockDb, config, caches, { hasGoogleKey : false });
            expect(mockLog.warn).toHaveBeenCalledWith('Missing googleKey from secrets, will not be able to lookup meta data for youtube videos.');
        });
    });
    
    describe('card validation', function() {
        var svc, newObj, origObj, requester;
        beforeEach(function() {
            svc = cardModule.setupSvc(mockDb, cardModule.config, { cash: 'money' }, { hasGoogleKey: true });
            newObj = { campaignId: 'cam-1' };
            origObj = {};
            requester = { fieldValidation: { cards: {} } };
        });
        
        describe('when handling campaignId', function() {
            it('should fail if the field is not a string', function() {
                newObj.campaignId = 123;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'campaignId must be in format: string' });
            });
            
            it('should allow the field to be set on create', function() {
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaignId).toEqual('cam-1');
            });

            it('should fail if the field is not defined', function() {
                delete newObj.campaignId;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: false, reason: 'Missing required field: campaignId' });
            });
            
            it('should pass if the field was defined on the original object', function() {
                delete newObj.campaignId;
                origObj.campaignId = 'cam-old';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaignId).toEqual('cam-old');
            });

            it('should revert the field if defined on edit', function() {
                origObj.campaignId = 'cam-old';
                expect(svc.model.validate('edit', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaignId).toEqual('cam-old');
            });
        });
        
        describe('when handling campaign', function() {
            beforeEach(function() {
                newObj.campaign = {};
                requester.fieldValidation.cards.campaign = {};
            });

            it('should default to an empty object', function() {
                delete newObj.campaign;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.campaign).toEqual({
                    minViewTime: 3
                });
            });
        
            ['reportingId', 'startDate', 'endDate'].forEach(function(field) {
                describe('subfield ' + field, function() {
                    it('should fail if the field is not a string', function() {
                        newObj.campaign[field] = 1234;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'campaign.' + field + ' must be in format: string' });
                    });
                    
                    it('should allow the field to be set', function() {
                        newObj.campaign[field] = 'foo';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.campaign[field]).toEqual('foo');
                    });
                });
            });
            
            describe('subfield minViewTime', function() {
                it('should replace user input with a default', function() {
                    newObj.campaign.minViewTime = 666;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.campaign.minViewTime).toBe(3);
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    requester.fieldValidation.cards.campaign.minViewTime = { __allowed: true };
                    newObj.campaign.minViewTime = 666;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.campaign.minViewTime).toBe(666);
                });

                it('should fail if the field is not a number', function() {
                    requester.fieldValidation.cards.campaign.minViewTime = { __allowed: true };
                    newObj.campaign.minViewTime = 'foo';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'campaign.minViewTime must be in format: number' });
                });
            });
        });
        
        describe('when handling data', function() {
            beforeEach(function() {
                newObj.data = {};
                requester.fieldValidation.cards.data = {};
            });

            it('should default to an object', function() {
                delete newObj.data;
                expect(svc.model.validate('create', newObj, origObj, requester))
                    .toEqual({ isValid: true, reason: undefined });
                expect(newObj.data).toEqual({
                    skip: 5,
                    controls: true,
                    autoplay: true,
                    autoadvance: false,
                    moat: {}
                });
            });

            describe('subfield skip', function() {
                it('should replace user input with a default', function() {
                    newObj.data.skip = 666;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.skip).toBe(5);
                });
                
                it('should be able to allow some requesters to set the field', function() {
                    requester.fieldValidation.cards.data.skip = { __allowed: true };
                    newObj.data.skip = 666;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.skip).toBe(666);

                    newObj.data.skip = false;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.skip).toBe(false);
                });
                
                it('should not allow the field to be unset', function() {
                    requester.fieldValidation.cards.data.skip = { __allowed: true };
                    newObj.data.skip = null;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.skip).toBe(5);
                });
            });
            
            ['controls', 'autoplay', 'autoadvance'].forEach(function(field) {
                describe('subfield ' + field, function() {
                    it('should replace user input with a default', function() {
                        newObj.data[field] = 666;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.data[field]).toBe(field === 'autoadvance' ? false : true);
                    });
                    
                    it('should be able to allow some requesters to set the field', function() {
                        requester.fieldValidation.cards.data[field] = { __allowed: true };
                        newObj.data[field] = field === 'autoadvance' ? true : false;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.data[field]).toBe(field === 'autoadvance' ? true : false);
                    });

                    it('should fail if the field is not a boolean', function() {
                        requester.fieldValidation.cards.data[field] = { __allowed: true };
                        newObj.data[field] = 'true';
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: false, reason: 'data.' + field + ' must be in format: boolean' });
                    });
                    
                    it('should not allow the field to be unset', function() {
                        requester.fieldValidation.cards.data[field] = { __allowed: true };
                        newObj.data[field] = null;
                        expect(svc.model.validate('create', newObj, origObj, requester))
                            .toEqual({ isValid: true, reason: undefined });
                        expect(newObj.data[field]).toBe(field === 'autoadvance' ? false : true);
                    });
                });
            });
            
            describe('subfield moat', function() {
                it('should default to an empty object', function() {
                    delete newObj.data;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.moat).toEqual({});
                });
                
                it('should prevent users from unsetting the field', function() {
                    newObj.data.moat = null;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.moat).toEqual({});
                });
                
                it('should allow some users to set the field to null', function() {
                    requester.fieldValidation.cards.data.moat = { __required: false };
                    newObj.data.moat = null;
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: true, reason: undefined });
                    expect(newObj.data.moat).toEqual(null);
                });
                
                it('should fail if the field is not an object', function() {
                    newObj.data.moat = 'foo';
                    expect(svc.model.validate('create', newObj, origObj, requester))
                        .toEqual({ isValid: false, reason: 'data.moat must be in format: object' });
                });
            });
        });
    });
    
    describe('fetchCamp', function() {
        var mockColl, svc;
        beforeEach(function() {
            req.body = { id: 'rc-1', campaignId: 'cam-1', campaign: {} };
            req.method = 'PUT';
            mockColl = 'fakeColl';
            spyOn(mongoUtils, 'findObject').and.returnValue(q({ campaign: 'yes' }));
            mockDb.collection.and.returnValue(mockColl);
            svc = { _db: mockDb };
        });
        
        it('should fetch the campaign and attach it to the request', function(done) {
            cardModule.fetchCamp(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual({ campaign: 'yes' });
                expect(mockDb.collection).toHaveBeenCalledWith('campaigns');
                expect(mongoUtils.findObject).toHaveBeenCalledWith('fakeColl', { id: 'cam-1', status: { $ne: Status.Deleted } });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        describe('if no campaign is found', function() {
            beforeEach(function() {
                mongoUtils.findObject.and.returnValue(q());
            });
            
            it('should log a warning if the request is a put or delete', function(done) {
                var req2 = JSON.parse(JSON.stringify(req));
                req2.method = 'DELETE';

                q.all([
                    cardModule.fetchCamp(svc, req, nextSpy, doneSpy).catch(errorSpy),
                    cardModule.fetchCamp(svc, req2, nextSpy, doneSpy).catch(errorSpy),
                ]).finally(function() {
                    expect(nextSpy.calls.count()).toBe(2);
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(req.campaign).not.toBeDefined();
                    expect(req2.campaign).not.toBeDefined();
                    expect(mockLog.warn.calls.count()).toBe(2);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });

            it('should not warn if the request is a post', function(done) {
                req.method = 'POST';
                cardModule.fetchCamp(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                    expect(nextSpy).toHaveBeenCalled();
                    expect(doneSpy).not.toHaveBeenCalled();
                    expect(errorSpy).not.toHaveBeenCalled();
                    expect(req.campaign).not.toBeDefined();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).done(done);
            });
        });
        
        it('should reject if mongo fails', function(done) {
            mongoUtils.findObject.and.returnValue(q.reject('I GOT A PROBLEM'));
            cardModule.fetchCamp(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Error fetching campaign');
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('campStatusCheck', function() {
        var permitted;
        beforeEach(function() {
            req.origObj = { id: 'rc-1' };
            req.campaign = { id: 'cam-1', status: Status.Active };
            req.requester.entitlements = {};
            permitted = [Status.Draft, Status.Canceled];
        });

        it('should call done if the campaign is not one of the permitted statuses', function() {
            cardModule.campStatusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Action not permitted on ' + Status.Active + ' campaign' });
        });
        
        it('should call next if the campaign is one of the permitted statuses', function() {
            req.campaign.status = Status.Canceled;
            cardModule.campStatusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call next if the user has the directEditCampaigns entitlement', function() {
            req.requester.entitlements.directEditCampaigns = true;
            cardModule.campStatusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call next if there is no req.campaign', function() {
            delete req.campaign;
            cardModule.campStatusCheck(permitted, req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('enforceUpdateLock', function() {
        beforeEach(function() {
            req.origObj = { id: 'rc-1' };
            req.campaign = { id: 'cam-1', name: 'camp 1' };
        });

        it('should call next if there is no updateRequest on the campaign', function() {
            cardModule.enforceUpdateLock(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
        
        it('should call done if there is an updateRequest on the campaign', function() {
            req.campaign.updateRequest = 'ur-1';
            cardModule.enforceUpdateLock(req, nextSpy, doneSpy);
            expect(nextSpy).not.toHaveBeenCalled();
            expect(doneSpy).toHaveBeenCalledWith({ code: 400, body: 'Campaign + cards locked until existing update request resolved' });
        });

        it('should call next if there is no req.campaign', function() {
            delete req.campaign;
            cardModule.enforceUpdateLock(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
        });
    });

    describe('isVideoCard', function(){
        it('returns true if card type is a video type',function(){
            expect(cardModule.isVideoCard({type : 'youtube'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'dailymotion'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'vimeo'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'adUnit'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'vzaar'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'wistia'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'jwplayer'})).toEqual(true);
            expect(cardModule.isVideoCard({type : 'instagram', data : { type : 'video' }}))
                .toEqual(true);
        });

        it('returns false if card type is not a video type',function(){
            expect(cardModule.isVideoCard({type : 'article'})).toEqual(false);
            expect(cardModule.isVideoCard({type : 'instagram', data : { type : 'photo' }}))
                .toEqual(false);
        });
    });

    describe('getMetaData', function(){
        var mockReq, mockData, mockNext, mockDone ;
        beforeEach(function(){
            mockReq = { body : { data : {} }, uuid : 'testid-0000' };
            mockData = { type: 'vast', duration: 666 };
            mockNext = jasmine.createSpy('nextSpy');
            mockDone = jasmine.createSpy('doneSpy');
            cardModule.metagetta = jasmine.createSpy('metagettaSpy').and.callFake(function(){
                return q.resolve(mockData);
            });
            cardModule.metagetta.hasGoogleKey = true;
        });

        it('should not call metagetta if the req is not a video card',function(done){
            mockReq.body.data.videoid   = 'def456';
            mockReq.body.type           = 'youtube';
            spyOn(cardModule,'isVideoCard').and.returnValue(false);
            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('should not call metagetta if the req has no data property',function(done){
            delete mockReq.body.data;
            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('should not call metagetta if the req has empty data property',function(done){
            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('should not call metagetta for unsupported cards',function(done){
            q.all(['instagram','wistia','jwplayer'].map(function(cardType){
                return cardModule.getMetaData({
                    uuid : 'testid-0000',
                    body : {
                        data : { id : 'abc', type : 'video' },
                        type : cardType,
                    }
                },mockNext,mockDone);
            }))
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockLog.info.calls.allArgs()).toEqual([
                    [ '[%1] - MetaData unsupported for CardType [%2].',
                        'testid-0000', 'instagram' ],
                    [ '[%1] - MetaData unsupported for CardType [%2].',
                        'testid-0000', 'wistia' ],
                    [ '[%1] - MetaData unsupported for CardType [%2].',
                        'testid-0000', 'jwplayer' ]
                 ]);
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });
        
        it('should not call metagetta if youtube card, but no secrets.googleKey',function(done){
            cardModule.metagetta.hasGoogleKey = false;

            mockReq.body.data.videoid   = 'def456';
            mockReq.body.type           = 'youtube';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockReq.body.data.duration).toEqual(-1);
                expect(mockLog.warn).toHaveBeenCalledWith(
                    '[%1] - Cannot get youtube duration without secrets.googleKey.',
                    'testid-0000'
                );
                expect(mockReq.body.data.duration).toBe(-1);
            })
            .then(done,done.fail);
        });

        it('should not call metagetta if its a put and video is same',function(done){
            mockReq.origObj = {
                data : {
                    vast : 'https://myvast/is/vast.xml',
                    duration : 29
                },
                type : 'adUnit',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(mockReq.origObj.lastUpdated);
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).not.toHaveBeenCalled();
                expect(mockNext).toHaveBeenCalled();
                expect(mockReq.body.data.duration).toBe(29);
            })
            .then(done,done.fail);
        });

        it('should call metagetta if its a put with same video, but no duration.',function(done){
            mockReq.origObj = {
                data : {
                    vast : 'https://myvast/is/vast.xml'
                },
                type : 'adUnit',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(mockReq.origObj.lastUpdated);
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalled();
                expect(mockReq.body.data.duration).toBe(666);
            })
            .then(done,done.fail);
        });

        it('should call metagetta if its a put with different card vast.',function(done){
            mockReq.origObj = {
                data : {
                    vast : 'https://myvast/is/vast.xml',
                    duration : 29
                },
                type : 'adUnit',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(mockReq.origObj.lastUpdated);
            mockReq.body.data.vast  = 'https://myvast/is/different_vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalled();
                expect(mockReq.body.data.duration).toBe(666);
            })
            .then(done,done.fail);
        });

        it('should call metagetta if its a put with different video.',function(done){
            mockReq.origObj = {
                data : {
                    videoid : 'abc123',
                    duration : 29
                },
                type : 'youtube',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(mockReq.origObj.lastUpdated);
            mockReq.body.data.videoid   = 'def456';
            mockReq.body.type           = 'youtube';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalled();
                expect(mockReq.body.data.duration).toBe(666);
            })
            .then(done,done.fail);
        });

        it('should call metagetta if its a put with same video, but lastUpdated > 60 secs.',function(done){
            mockReq.origObj = {
                data : {
                    vast : 'https://myvast/is/vast.xml',
                    duration : 29
                },
                type : 'adUnit',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(new Date(mockReq.origObj.lastUpdated.valueOf() + 100000));
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalled();
                expect(mockReq.body.data.duration).toBe(666);
            })
            .then(done,done.fail);
        });

        it('should get duration from valid vast on create card',function(done){
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'https://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(666);
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('should get duration from vast with protocol relative addr',function(done){
            mockReq.body.data.vast  = '//myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'http://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(666);
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });
        
        it('should be able to get duration metdata from vzaar videos', function(done) {
            mockReq.origObj = {
                data : {
                    videoid : 'abc123',
                    duration : 29
                },
                type : 'vzaar',
                lastUpdated : new Date(1446063211664)
            };
            jasmine.clock().mockDate(mockReq.origObj.lastUpdated);
            mockReq.body.data.videoid   = 'def456';
            mockReq.body.type           = 'vzaar';

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith({
                    type: 'vzaar',
                    id: 'def456'
                });
                expect(mockReq.body.data.duration).toBe(666);
            })
            .then(done,done.fail);
        });

        it('logs warning, sets duration to -1 on meta err on create card',function(done){
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            cardModule.metagetta.and.callFake(function(){
                return q.reject(
                    new Error('Could not find metadata for the specified resource.')
                );
            });

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'https://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(-1);
                expect(mockLog.warn).toHaveBeenCalledWith(
                    '[%1] - [%2] [%3]',
                    'testid-0000',
                    'Could not find metadata for the specified resource.',
                    '{"type":"vast","uri":"https://myvast/is/vast.xml"}'
                );
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('logs warning, sets duration to -1 on missing dur. create card',function(done){
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';
            delete mockData.duration;

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'https://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(-1);
                expect(mockLog.warn).toHaveBeenCalledWith(
                    '[%1] - [%2] [%3]',
                    'testid-0000',
                    'Missing duration for the specified resource.',
                    '{"type":"vast","uri":"https://myvast/is/vast.xml"}'
                );
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });
        
        describe('if the requester is attempting to set a custom duration', function() {
            beforeEach(function() {
                mockReq.body = {
                    type: 'adUnit',
                    data: {
                        vast: 'https://myvast/is/vast.xml',
                        duration: 123
                    }
                };
                mockReq.origObj = {
                    data : {
                        vast : 'https://myvast/is/vast.xml'
                    },
                    type : 'adUnit',
                    lastUpdated : new Date(1446063211664)
                };
                jasmine.clock().mockDate(mockReq.origObj.lastUpdated);

            });
            
            it('should overwrite the custom duration if metagetta succeeds', function(done) {
                cardModule.getMetaData(mockReq,mockNext,mockDone)
                .then(function() {
                    expect(cardModule.metagetta).toHaveBeenCalled();
                    expect(mockReq.body.data.duration).toBe(666);
                })
                .then(done,done.fail);
            });
            
            it('should not overwrite the custom duration if metagetta has no google key', function(done) {
                cardModule.metagetta.hasGoogleKey = false;
                mockReq.body = { type: 'youtube', data: { duration: 123, videoid: 'def123' } };
                cardModule.getMetaData(mockReq,mockNext,mockDone)
                .then(function() {
                    expect(cardModule.metagetta).not.toHaveBeenCalled();
                    expect(mockReq.body.data.duration).toBe(123);
                })
                .then(done,done.fail);
            });
            
            it('should not overwrite the custom duration if the card type is unsupported', function(done) {
                mockReq.body.type = 'instagram';
                cardModule.getMetaData(mockReq,mockNext,mockDone)
                .then(function() {
                    expect(cardModule.metagetta).not.toHaveBeenCalled();
                    expect(mockReq.body.data.duration).toBe(123);
                })
                .then(done,done.fail);
            });
            
            it('should not overwrite the custom duration if metagetta gets no duration', function(done) {
                delete mockData.duration;
                cardModule.getMetaData(mockReq,mockNext,mockDone)
                .then(function() {
                    expect(cardModule.metagetta).toHaveBeenCalled();
                    expect(mockReq.body.data.duration).toBe(123);
                })
                .then(done,done.fail);
            });
            
            it('should not overwrite the custom duration if metagetta fails', function(done) {
                cardModule.metagetta.and.returnValue(q.reject(new Error('I GOT A PROBLEM')));
                cardModule.getMetaData(mockReq,mockNext,mockDone)
                .then(function() {
                    expect(cardModule.metagetta).toHaveBeenCalled();
                    expect(mockReq.body.data.duration).toBe(123);
                })
                .then(done,done.fail);
            });
        });
    });
    
    describe('setupMoat', function() {
        beforeEach(function() {
            req.body = { id: 'rc-1', campaignId: 'cam-1', advertiserId: 'a-1', data: { moat: {} } };
        });
        
        it('should setup the moat object on the card\'s data', function() {
            cardModule.setupMoat(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body.data.moat).toEqual({ campaign: 'cam-1', advertiser: 'a-1', creative: 'rc-1' });
        });
        
        it('should override user-provided values', function() {
            req.body.data.moat = { campaign: 'foo', advertiser: 'bar', creative: 'baz' };
            cardModule.setupMoat(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body.data.moat).toEqual({ campaign: 'cam-1', advertiser: 'a-1', creative: 'rc-1' });
        });
        
        it('should be able to take necessary ids from the origObj', function() {
            req.body = { title: 'bloop', data: { moat: {} } };
            req.origObj = { id: 'rc-1', campaignId: 'cam-1', advertiserId: 'a-1', data: { moat: {} } };
            
            cardModule.setupMoat(req, nextSpy, doneSpy);
            expect(nextSpy).toHaveBeenCalled();
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req.body.data.moat).toEqual({ campaign: 'cam-1', advertiser: 'a-1', creative: 'rc-1' });
        });
        
        it('should skip if the data or data.moat props are not defined', function() {
            var req1 = JSON.parse(JSON.stringify(req)), req2 = JSON.parse(JSON.stringify(req));
            req1.body = { id: 'rc-1', campaignId: 'cam-1', advertiserId: 'a-1' };
            req2.body = { id: 'rc-1', campaignId: 'cam-1', advertiserId: 'a-1', data: { moat: null } };

            cardModule.setupMoat(req1, nextSpy, doneSpy);
            cardModule.setupMoat(req2, nextSpy, doneSpy);
            expect(nextSpy.calls.count()).toBe(2);
            expect(doneSpy).not.toHaveBeenCalled();
            expect(req1.body.data).not.toBeDefined();
            expect(req2.body.data).toEqual({ moat: null });
        });
    });

    describe('objectifyLinks', function() {
        var card;
        beforeEach(function() {
            card = {
                id: 'rc-1',
                campaignId: 'cam-1',
                links: {
                    Website: 'http://website.com/foo',
                    Action: 'http://action.com/bar'
                },
                shareLinks: {
                    Facebook: 'http://facebook.com/foo',
                    Twitter: 'http://twitter.com/bar'
                }
            };
        });
        
        it('should convert links and shareLinks entries to objects', function() {
            cardModule.objectifyLinks(card);
            expect(card).toEqual({
                id: 'rc-1',
                campaignId: 'cam-1',
                links: {
                    Website: {
                        uri: 'http://website.com/foo',
                        tracking: []
                    },
                    Action: {
                        uri: 'http://action.com/bar',
                        tracking: []
                    }
                },
                shareLinks: {
                    Facebook: {
                        uri: 'http://facebook.com/foo',
                        tracking: []
                    },
                    Twitter: {
                        uri: 'http://twitter.com/bar',
                        tracking: []
                    }
                }
            });
        });
        
        it('should not mess with existing entries that are objects', function() {
            card.links.Website = { uri: 'http://website.com/foo', tracking: ['bigbrother.iswatching'] };
            card.shareLinks.Twitter = { uri: 'http://twitter.com/bar', tracking: ['bigbrother.isgood'] };

            cardModule.objectifyLinks(card);
            expect(card.links).toEqual({
                Website: {
                    uri: 'http://website.com/foo',
                    tracking: ['bigbrother.iswatching']
                },
                Action: {
                    uri: 'http://action.com/bar',
                    tracking: []
                }
            });
            expect(card.shareLinks).toEqual({
                Facebook: {
                    uri: 'http://facebook.com/foo',
                    tracking: []
                },
                Twitter: {
                    uri: 'http://twitter.com/bar',
                    tracking: ['bigbrother.isgood']
                }
            });
        });
        
        it('should do nothing if no links or shareLinks exist', function() {
            delete card.links;
            delete card.shareLinks;
            cardModule.objectifyLinks(card);
            expect(card).toEqual({
                id: 'rc-1',
                campaignId: 'cam-1'
            });
        });
    });
    
    describe('getPublicCard', function() {
        var cardSvc, mockCard, mockCamp, caches;
        beforeEach(function() {
            mockCard = {
                id: 'rc-1',
                campaignId: 'cam-1',
                campaign: {},
                status: Status.Active,
                user: 'u-1',
                org: 'o-1'
            };
            mockCamp = {
                id: 'cam-1',
                status: Status.Active,
                user: 'u-1',
                org: 'o-1',
                advertiserId: 'a-1',
                customerId: 'cu-1',
                advertiserDisplayName: 'Heinz',
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }]
            };
            caches = {
                cards: {
                    getPromise: jasmine.createSpy('caches.cards.getPromise').and.callFake(function() {
                        return q([mockCard]);
                    })
                },
                campaigns: {
                    getPromise: jasmine.createSpy('caches.campaigns.getPromise').and.callFake(function() {
                        return q([mockCamp]);
                    })
                }
            };
            cardSvc = {
                formatOutput: jasmine.createSpy('svc.formatOutput').and.callFake(function(card) {
                    var newCard = JSON.parse(JSON.stringify(card));
                    newCard.formatted = true;
                    return newCard;
                })
            };
        });
        
        it('should retrieve a card from the cache', function(done) {
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual({
                    id: 'rc-1',
                    campaignId: 'cam-1',
                    campaign: {},
                    status: Status.Active,
                    params: { sponsor: 'Heinz' },
                    formatted: true
                });
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle an existing params object', function(done) {
            mockCard.params = { foo: 'bar', sponsor: 'Hunts' };
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp.params).toEqual({ foo: 'bar', sponsor: 'Heinz' });
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should not overwrite params.sponsor if camp.advertiserDisplayName is undefined', function(done) {
            mockCard.params = { foo: 'bar', sponsor: 'Hunts' };
            delete mockCamp.advertiserDisplayName;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp.params).toEqual({ foo: 'bar', sponsor: 'Hunts' });
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if there are links or shareLinks on the card', function() {
            beforeEach(function() {
                mockCard.links = {
                    Website: 'http://website.com'
                };
                mockCard.shareLinks = {
                    Facebook: 'http://facebook.com'
                };
            });

            it('should always objectify the links, even if the request is a preview', function(done) {
                q.all(['true', 'false'].map(function(val) {
                    var reqCopy = JSON.parse(JSON.stringify(req));
                    reqCopy.query.preview = val;
                    return cardModule.getPublicCard(cardSvc, caches, 'rc-1', reqCopy).then(function(resp) {
                        expect(resp).toEqual(jasmine.objectContaining({
                            links: {
                                Website: {
                                    uri: 'http://website.com',
                                    tracking: []
                                }
                            },
                            shareLinks: {
                                Facebook: {
                                    uri: 'http://facebook.com',
                                    tracking: []
                                }
                            }
                        }));
                    });
                })).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should return nothing if the card was not found', function(done) {
            caches.cards.getPromise.and.returnValue(q([]));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card is not active', function(done) {
            mockCard.status = Status.Pending;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s campaign was not found', function(done) {
            caches.campaigns.getPromise.and.returnValue(q([]));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s campaign was deleted', function(done) {
            mockCamp.status = Status.Deleted;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should fail if the card promise was rejected', function(done) {
            caches.cards.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should fail if the campaign promise was rejected', function(done) {
            caches.campaigns.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalled();
                expect(cardSvc.formatOutput).toHaveBeenCalled();
            }).done(done);
        });
    });

    describe('handlePublicGet', function() {
        var res, cardSvc, config;
        beforeEach(function() {
            req.params.id = 'e-1';
            req.originHost = 'http://cinema6.com';
            res = {
                header: jasmine.createSpy('res.header()')
            };
            cardSvc = {
                getPublicCard: jasmine.createSpy('cardSvc.getPublicCard()').and.returnValue(q({ card: 'yes' }))
            };
            config = { cacheTTLs: { cloudFront: 5 } };
        });
        
        it('should set headers and return a card', function(done) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { card: 'yes' } });
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('e-1', req);
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 404 if no card is found', function(done) {
            cardSvc.getPublicCard.and.returnValue(q());
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Card not found' });
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 500 if getPublicCard fails', function(done) {
            cardSvc.getPublicCard.and.returnValue(q.reject('I GOT A PROBLEM'));
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 500, body: { error: 'Error retrieving card', detail: 'I GOT A PROBLEM' } });
                expect(res.header.calls.count()).toBe(1);
                expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=60');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not set the cache-control header if the request is in preview mode', function(done) {
            req.query.preview = true;
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                expect(resp).toEqual({ code: 200, body: { card: 'yes' } });
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('e-1', req);
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
                cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 200, body: 'module.exports = {"card":"yes"};' });
                    expect(cardSvc.getPublicCard).toHaveBeenCalledWith('e-1', req);
                    expect(res.header.calls.count()).toBe(2);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                    expect(res.header).toHaveBeenCalledWith('content-type', 'application/javascript');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should not alter the response if no card is found', function(done) {
                cardSvc.getPublicCard.and.returnValue(q());
                cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                    expect(resp).toEqual({ code: 404, body: 'Card not found' });
                    expect(res.header.calls.count()).toBe(1);
                    expect(res.header).toHaveBeenCalledWith('cache-control', 'max-age=300');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
    });
    
    describe('chooseCards', function() {
        var cardSvc, mockCamp, caches;
        beforeEach(function() {
            var existent = ['rc-1', 'rc-2', 'rc-3'];
            mockCamp = {
                id: 'cam-1',
                status: Status.Active,
                cards: [{ id: 'rc-1' }, { id: 'rc-2' }, { id: 'rc-3' }]
            };
            caches = {
                campaigns: {
                    getPromise: jasmine.createSpy('caches.campaigns.getPromise').and.callFake(function() {
                        return q([mockCamp]);
                    })
                }
            };
            cardSvc = {
                getPublicCard: jasmine.createSpy('svc.getPublicCard').and.callFake(function(id, req) {
                    if (existent.indexOf(id) !== -1) return { id: id, title: 'card ' + id.replace('rc-', '') };
                    else return q();
                })
            };
            req.query = { campaign: 'cam-1' };
        });
        
        it('should fetch and return all cards from a campaign', function(done) {
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    { id: 'rc-1', title: 'card 1' },
                    { id: 'rc-2', title: 'card 2' },
                    { id: 'rc-3', title: 'card 3' }
                ]);
                expect(resp.headers).toEqual({ 'content-range': 'items 1-3/3' });
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({ id: 'cam-1' });
                expect(cardSvc.getPublicCard.calls.count()).toBe(3);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-1', req);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-3', req);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should be use the limit param to fetch a subset of the cards from a campaign', function(done) {
            req.query.limit = '2';
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    { id: 'rc-1', title: 'card 1' },
                    { id: 'rc-2', title: 'card 2' },
                ]);
                expect(resp.headers).toEqual({ 'content-range': 'items 1-2/3' });
                expect(cardSvc.getPublicCard.calls.count()).toBe(2);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-1', req);
                expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should cap the limit property appropriately', function(done) {
            req.query.limit = '20000';
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    { id: 'rc-1', title: 'card 1' },
                    { id: 'rc-2', title: 'card 2' },
                    { id: 'rc-3', title: 'card 3' }
                ]);
                expect(resp.headers).toEqual({ 'content-range': 'items 1-3/3' });
                expect(cardSvc.getPublicCard.calls.count()).toBe(3);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle weird query parameter values', function(done) {
            req.query.random = 'omg im soooo random!11!!!1 lol XD ;)';
            req.query.campaign = { $gt: '' };
            req.query.limit = 'gimme all ya got';
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(200);
                expect(resp.body).toEqual([
                    { id: 'rc-1', title: 'card 1' },
                    { id: 'rc-2', title: 'card 2' },
                    { id: 'rc-3', title: 'card 3' }
                ]);
                expect(resp.headers).toEqual({ 'content-range': 'items 1-3/3' });
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({ id: '[object Object]' });
                expect(cardSvc.getPublicCard.calls.count()).toBe(3);
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 400 if the campaign param is not set', function(done) {
            delete req.query.campaign;
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(400);
                expect(resp.body).toEqual('Must provide campaign id');
                expect(resp.headers).not.toBeDefined();
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return a 404 if the campaign is not found', function(done) {
            mockCamp = undefined;
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp.code).toEqual(404);
                expect(resp.body).toEqual('Campaign not found');
                expect(resp.headers).not.toBeDefined();
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return a 400 if the campaign is deleted', function(done) {
            mockCamp.status = Status.Deleted;
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp).toEqual({ code: 404, body: 'Campaign not found' });
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if the random parameter is set', function() {
            beforeEach(function() {
                req.query.random = 'true';
            });
            
            it('should return all cards in a random order if limit is not set', function(done) {
                cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                    expect(resp.code).toEqual(200);
                    expect(resp.body).toContain({ id: 'rc-1', title: 'card 1' });
                    expect(resp.body).toContain({ id: 'rc-2', title: 'card 2' });
                    expect(resp.body).toContain({ id: 'rc-3', title: 'card 3' });
                    expect(resp.headers).not.toBeDefined();
                    expect(cardSvc.getPublicCard.calls.count()).toBe(3);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });

            it('should return a random subset of cards if limit is set', function(done) {
                req.query.limit = '2';
                cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                    expect(resp.code).toEqual(200);
                    var optionalMatcher = { asymmetricMatch: function(actual) {
                        return (actual.id === 'rc-1' && actual.title === 'card 1') ||
                            (actual.id === 'rc-2' && actual.title === 'card 2') ||
                            (actual.id === 'rc-3' && actual.title === 'card 3');
                    } };
                    expect(resp.body).toEqual([optionalMatcher, optionalMatcher]);
                    expect(resp.body[1]).not.toEqual(resp.body[0]);
                    expect(resp.headers).not.toBeDefined();
                    expect(cardSvc.getPublicCard.calls.count()).toBe(2);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        describe('if some cards cannot be fetched', function() {
            beforeEach(function() {
                mockCamp.cards.unshift({ id: 'rc-4' });
                req.query.limit = 2;
            });
            
            it('should make additional calls to get enough cards', function(done) {
                cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                    expect(resp.code).toEqual(200);
                    expect(resp.body).toEqual([
                        { id: 'rc-1', title: 'card 1' },
                        { id: 'rc-2', title: 'card 2' }
                    ]);
                    expect(resp.headers).toEqual({ 'content-range': 'items 1-2/4' });
                    expect(cardSvc.getPublicCard.calls.count()).toBe(3);
                    expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-4', req);
                    expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-1', req);
                    expect(cardSvc.getPublicCard).toHaveBeenCalledWith('rc-2', req);
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should return what it can if not enough can be fetched', function(done) {
                req.query.limit = 4;
                mockCamp.cards.unshift({ id: 'rc-5' }, { id: 'rc-6' });
                cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                    expect(resp.code).toEqual(200);
                    expect(resp.body).toEqual([
                        { id: 'rc-1', title: 'card 1' },
                        { id: 'rc-2', title: 'card 2' },
                        { id: 'rc-3', title: 'card 3' }
                    ]);
                    expect(resp.headers).toEqual({ 'content-range': 'items 1-3/6' });
                    expect(cardSvc.getPublicCard.calls.count()).toBe(6);
                    ['rc-1', 'rc-2', 'rc-3', 'rc-4', 'rc-5', 'rc-6'].forEach(function(id) {
                        expect(cardSvc.getPublicCard).toHaveBeenCalledWith(id, req);
                    });
                    expect(mockLog.error).not.toHaveBeenCalled();
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        
        it('should reject if fetching the campaign rejects', function(done) {
            caches.campaigns.getPromise.and.returnValue(q.reject('I GOT A PROBLEM'));
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(cardSvc.getPublicCard).not.toHaveBeenCalled();
            }).done(done);
        });

        it('should reject if fetching a card rejects', function(done) {
            cardSvc.getPublicCard.and.callFake(function(id, req) {
                if (id === 'rc-2') return q.reject('I GOT A PROBLEM');
                else return { id: id, title: 'card ' + id.replace('rc-', '') };
            });
            cardModule.chooseCards(cardSvc, caches, req).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Mongo error');
                expect(mockLog.error).toHaveBeenCalled();
                expect(cardSvc.getPublicCard.calls.count()).toBe(3);
            }).done(done);
        });
    });
});
