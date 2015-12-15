var flush = true;
describe('content-cards (UT)', function() {
    var urlUtils, q, cardModule, CrudSvc, Status, Model, objUtils, logger, mockLog,
        mockDb, req, nextSpy, doneSpy, errorSpy;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        urlUtils        = require('url');
        q               = require('q');
        cardModule      = require('../../bin/content-cards');
        CrudSvc         = require('../../lib/crudSvc');
        Model           = require('../../lib/model');
        objUtils        = require('../../lib/objUtils');
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
        
        req = { uuid: '1234', baseUrl: '', route: { path: '' }, params: {}, query: {}, user: { id: 'u-1' } };
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
            
            [cardModule.fetchCamp, cardModule.campStatusCheck, cardModule.getPublicCard].forEach(function(fn) {
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
                    newObj.campaign.minViewTime = 666
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
            mockColl = {
                findOne: jasmine.createSpy('coll.findOne').and.callFake(function(query, cb) {
                    cb(null, { campaign: 'yes' });
                })
            };
            mockDb.collection.and.returnValue(mockColl);
            svc = { _db: mockDb };
        });
        
        it('should fetch the campaign and attach it to the request', function(done) {
            cardModule.fetchCamp(svc, req, nextSpy, doneSpy).catch(errorSpy).finally(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.campaign).toEqual({ campaign: 'yes' });
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).done(done);
        });
        
        describe('if no campaign is found', function() {
            beforeEach(function() {
                mockColl.findOne.and.callFake(function(query, cb) { cb(); });
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
            mockColl.findOne.and.callFake(function(query, cb) { cb('I GOT A PROBLEM'); });
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
            req.user.entitlements = {};
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
            req.user.entitlements.directEditCampaigns = true;
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
            mockData = {};
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
            })
            .then(done,done.fail);
        });

        it('should get duration from valid vast on create card',function(done){
            mockReq.body.data.vast  = 'https://myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            mockData.type       = 'vast';
            mockData.duration   = 29;

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'https://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(29);
                expect(mockNext).toHaveBeenCalled();
            })
            .then(done,done.fail);
        });

        it('should get duration from vast with protocol relative addr',function(done){
            mockReq.body.data.vast  = '//myvast/is/vast.xml';
            mockReq.body.type       = 'adUnit';

            mockData.type       = 'vast';
            mockData.duration   = 29;

            cardModule.getMetaData(mockReq,mockNext,mockDone)
            .then(function(){
                expect(cardModule.metagetta).toHaveBeenCalledWith(jasmine.objectContaining({
                    type : 'vast',
                    uri : 'http://myvast/is/vast.xml'
                }));
                expect(mockReq.body.data.duration).toEqual(29);
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

    describe('formatUrl', function() {
        var card;
        beforeEach(function() {
            card = { id: 'rc-1', campaignId: 'cam-1' };
            req.originHost = 'cinema6.com';
            req.route.path = '/api/public/content/experience/:id';
            req.params.id = 'e-1';
            req.query = {
                container: 'embed',
                hostApp: 'Mapsaurus',
                network: 'pocketmath'
            };
            cardModule.config.trackingPixel = '//cinema6.com/track.png';
        });
        
        it('should build a tracking pixel url', function() {
            var url = cardModule.formatUrl(card, req, 'completedView'),
                parsed = urlUtils.parse(url, true, true);
                
            expect(parsed.protocol).toBe(null);
            expect(parsed.host).toBe('cinema6.com');
            expect(parsed.pathname).toBe('/track.png');
            expect(parsed.query).toEqual({
                campaign: 'cam-1',
                card: 'rc-1',
                experience: 'e-1',
                container: 'embed',
                host: 'cinema6.com',
                hostApp: 'Mapsaurus',
                network: 'pocketmath',
                cb: '{cachebreaker}',
                event: 'completedView',
                d: '{delay}'
            });
        });
        
        it('should be able to get the experience id from query params', function() {
            req.route.path = '/api/public/content/card/:id';
            req.query.experience = 'e-2';
            var url = cardModule.formatUrl(card, req, 'load'),
                parsed = urlUtils.parse(url, true, true);
            expect(parsed.query.experience).toBe('e-2');
        });
        
        it('should allow overriding the host through the pageUrl param', function() {
            req.query.pageUrl = 'clickhole.com';
            var url = cardModule.formatUrl(card, req, 'load'),
                parsed = urlUtils.parse(url, true, true);
            expect(parsed.query.host).toBe('clickhole.com');
        });
        
        it('should leave some params blank if they are not provided', function() {
            req.route.path = '/api/public/content/card/:id';
            req.query = {};
            var url = cardModule.formatUrl(card, req, 'completedView'),
                parsed = urlUtils.parse(url, true, true);

            expect(parsed.protocol).toBe(null);
            expect(parsed.host).toBe('cinema6.com');
            expect(parsed.pathname).toBe('/track.png');
            expect(parsed.query).toEqual({
                campaign: 'cam-1',
                card: 'rc-1',
                experience: '',
                container: '',
                host: 'cinema6.com',
                hostApp: '',
                network: '',
                cb: '{cachebreaker}',
                event: 'completedView',
                d: '{delay}'
            });
        });
        
        it('should add a playDelay param if the event is play', function() {
            var url = cardModule.formatUrl(card, req, 'play'),
                parsed = urlUtils.parse(url, true, true);
                
            expect(parsed.query).toEqual({
                campaign: 'cam-1',
                card: 'rc-1',
                experience: 'e-1',
                container: 'embed',
                host: 'cinema6.com',
                hostApp: 'Mapsaurus',
                network: 'pocketmath',
                cb: '{cachebreaker}',
                d: '{delay}',
                pd: '{playDelay}',
                event: 'play'
            });
        });

        it('should add a loadDelay param if the event is load', function() {
            var url = cardModule.formatUrl(card, req, 'load'),
                parsed = urlUtils.parse(url, true, true);
                
            expect(parsed.query).toEqual({
                campaign: 'cam-1',
                card: 'rc-1',
                experience: 'e-1',
                container: 'embed',
                host: 'cinema6.com',
                hostApp: 'Mapsaurus',
                network: 'pocketmath',
                cb: '{cachebreaker}',
                d: '{delay}',
                ld: '{loadDelay}',
                event: 'load'
            });
        });
    });
    
    describe('setupTrackingPixels', function() {
        var card;
        beforeEach(function() {
            card = { id: 'rc-1', campaignId: 'cam-1' };
        
            spyOn(cardModule, 'formatUrl').and.callFake(function(card, req, event) {
                return 'track.png?event=' + event;
            });
        });
        
        it('should setup a bunch of tracking pixel arrays on the card', function() {
            cardModule.setupTrackingPixels(card, req);
            expect(card).toEqual({
                id          : 'rc-1',
                campaignId  : 'cam-1',
                campaign    : {
                    bufferUrls  : [ 'track.png?event=buffer' ],
                    viewUrls    : [ 'track.png?event=cardView' ],
                    playUrls    : [ 'track.png?event=play' ],
                    loadUrls    : [ 'track.png?event=load' ],
                    countUrls   : [ 'track.png?event=completedView' ],
                    q1Urls      : [ 'track.png?event=q1' ],
                    q2Urls      : [ 'track.png?event=q2' ],
                    q3Urls      : [ 'track.png?event=q3' ],
                    q4Urls      : [ 'track.png?event=q4' ]
                }
            });
        });
        
        it('should not overwrite any existing pixels', function() {
            card.campaign = {
                viewUrls    : [ 'view.me' ],
                playUrls    : [ 'play.me' ],
                loadUrls    : [ 'load.me' ],
                countUrls   : [ 'count.me' ],
                q1Urls      : [ 'q1.me' ],
                q2Urls      : [ 'q2.me' ],
                q3Urls      : [ 'q3.me' ]
            };
            
            cardModule.setupTrackingPixels(card, req);
            expect(card).toEqual({
                id          : 'rc-1',
                campaignId  : 'cam-1',
                campaign    : {
                    bufferUrls  : [ 'track.png?event=buffer' ],
                    viewUrls    : [ 'view.me', 'track.png?event=cardView' ],
                    playUrls    : [ 'play.me', 'track.png?event=play' ],
                    loadUrls    : [ 'load.me', 'track.png?event=load' ],
                    countUrls   : [ 'count.me', 'track.png?event=completedView' ],
                    q1Urls      : [ 'q1.me', 'track.png?event=q1' ],
                    q2Urls      : [ 'q2.me', 'track.png?event=q2' ],
                    q3Urls      : [ 'q3.me', 'track.png?event=q3' ],
                    q4Urls      : [ 'track.png?event=q4' ]
                }
            });
        });
        
        describe('if there are links on the card', function() {
            beforeEach(function() {
                card.links = {
                    Facebook: 'http://facebook.com/foo',
                    Twitter: 'http://twitter.com/bar'
                };
            });
            
            it('should also create tracking pixels for the links', function() {
                cardModule.setupTrackingPixels(card, req);
                expect(card).toEqual({
                    id          : 'rc-1',
                    campaignId  : 'cam-1',
                    campaign    : {
                        bufferUrls  : [ 'track.png?event=buffer' ],
                        viewUrls    : [ 'track.png?event=cardView' ],
                        playUrls    : [ 'track.png?event=play' ],
                        loadUrls    : [ 'track.png?event=load' ],
                        countUrls   : [ 'track.png?event=completedView' ],
                        q1Urls      : [ 'track.png?event=q1' ],
                        q2Urls      : [ 'track.png?event=q2' ],
                        q3Urls      : [ 'track.png?event=q3' ],
                        q4Urls      : [ 'track.png?event=q4' ]
                    },
                    links: {
                        Facebook: {
                            uri: 'http://facebook.com/foo',
                            tracking: [ 'track.png?event=link.Facebook' ]
                        },
                        Twitter: {
                            uri: 'http://twitter.com/bar',
                            tracking: [ 'track.png?event=link.Twitter' ]
                        }
                    }
                });
            });
            
            it('should not overwrite existing tracking pixels for the links', function() {
                card.links.Facebook = {
                    uri: 'http://facebook.com/foo',
                    tracking: ['track.facebook']
                };

                cardModule.setupTrackingPixels(card, req);
                expect(card.links).toEqual({
                    Facebook: {
                        uri: 'http://facebook.com/foo',
                        tracking: [ 'track.facebook', 'track.png?event=link.Facebook' ]
                    },
                    Twitter: {
                        uri: 'http://twitter.com/bar',
                        tracking: [ 'track.png?event=link.Twitter' ]
                    }
                });
            });
            
            it('should do nothing if the links prop is empty', function() {
                card.links = {};

                cardModule.setupTrackingPixels(card, req);
                expect(card.links).toEqual({});
            });
        });

        describe('if there are shareLinks on the card', function() {
            beforeEach(function() {
                card.shareLinks = {
                    Facebook: 'http://facebook.com/foo',
                    Twitter: 'http://twitter.com/bar'
                };
            });
            
            it('should also create tracking pixels for the links', function() {
                cardModule.setupTrackingPixels(card, req);
                expect(card).toEqual({
                    id          : 'rc-1',
                    campaignId  : 'cam-1',
                    campaign    : {
                        bufferUrls  : [ 'track.png?event=buffer' ],
                        viewUrls    : [ 'track.png?event=cardView' ],
                        playUrls    : [ 'track.png?event=play' ],
                        loadUrls    : [ 'track.png?event=load' ],
                        countUrls   : [ 'track.png?event=completedView' ],
                        q1Urls      : [ 'track.png?event=q1' ],
                        q2Urls      : [ 'track.png?event=q2' ],
                        q3Urls      : [ 'track.png?event=q3' ],
                        q4Urls      : [ 'track.png?event=q4' ]
                    },
                    shareLinks: {
                        Facebook: {
                            uri: 'http://facebook.com/foo',
                            tracking: [ 'track.png?event=shareLink.Facebook' ]
                        },
                        Twitter: {
                            uri: 'http://twitter.com/bar',
                            tracking: [ 'track.png?event=shareLink.Twitter' ]
                        }
                    }
                });
            });
            
            it('should not overwrite existing tracking pixels for the links', function() {
                card.shareLinks.Facebook = {
                    uri: 'http://facebook.com/foo',
                    tracking: ['track.facebook']
                };

                cardModule.setupTrackingPixels(card, req);
                expect(card.shareLinks).toEqual({
                    Facebook: {
                        uri: 'http://facebook.com/foo',
                        tracking: [ 'track.facebook', 'track.png?event=shareLink.Facebook' ]
                    },
                    Twitter: {
                        uri: 'http://twitter.com/bar',
                        tracking: [ 'track.png?event=shareLink.Twitter' ]
                    }
                });
            });
            
            it('should do nothing if the links prop is empty', function() {
                card.shareLinks = {};

                cardModule.setupTrackingPixels(card, req);
                expect(card.shareLinks).toEqual({});
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
                cards: [
                    { id: 'rc-1', adtechId: 11, bannerId: 1234, bannerNumber: 2 },
                    { id: 'rc-2', adtechId: 12, bannerId: 5678, bannerNumber: 1 }
                ]
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
            spyOn(cardModule, 'setupTrackingPixels').and.callFake(function(card, req) {
                card.campaign.pixels = 'setup';
            });
        });
        
        it('should retrieve a card from the cache', function(done) {
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual({
                    id: 'rc-1',
                    campaignId: 'cam-1',
                    campaign: { pixels: 'setup' },
                    status: Status.Active,
                    advertiserId: 'a-1',
                    params: { sponsor: 'Heinz' },
                    adtechId: 11,
                    bannerId: 2,
                    formatted: true
                });
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(cardModule.setupTrackingPixels).toHaveBeenCalledWith(resp, req);
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
        
        it('should take adtechId + bannerId from the campaign hash if defined', function(done) {
            mockCard.campaign = { adtechId: 101, bannerNumber: 5 };
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp.adtechId).toEqual(101);
                expect(resp.bannerId).toEqual(5);
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not setup tracking pixels if request is a preview', function(done) {
            req.query.preview = 'true';
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual(jasmine.objectContaining({ campaign: { } }));
                expect(cardModule.setupTrackingPixels).not.toHaveBeenCalled();
            }).then(done,done.fail);
        });

        it('should setup tracking pixels if request is not a preview', function(done) {
            req.query.preview = 'false';
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(cardModule.setupTrackingPixels).toHaveBeenCalledWith(jasmine.any(Object), req);
            }).then(done,done.fail);
        });
        
        it('should return nothing if the card was not found', function(done) {
            caches.cards.getPromise.and.returnValue(q([]));
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).not.toHaveBeenCalled();
                expect(cardSvc.formatOutput).not.toHaveBeenCalled();
                expect(cardModule.setupTrackingPixels).not.toHaveBeenCalled();
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
                expect(cardModule.setupTrackingPixels).not.toHaveBeenCalled();
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
                expect(cardModule.setupTrackingPixels).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s campaign is not running', function(done) {
            q.all([Status.Canceled, Status.Expired, Status.Deleted].map(function(status) {
                mockCamp.status = status;
                return cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                    expect(resp).not.toBeDefined();
                });
            })).then(function(results) {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(caches.campaigns.getPromise.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should show a card for a pending, draft, or paused campaign', function(done) {
            q.all([Status.Pending, Status.Draft, Status.Paused].map(function(status) {
                mockCamp.status = status;
                return cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                    expect(resp).toEqual(jasmine.objectContaining({ id: 'rc-1' }));
                });
            })).then(function(results) {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(caches.campaigns.getPromise.calls.count()).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should return nothing if the card does not exist in the campaign', function(done) {
            mockCamp.cards[0].id = 'rc-2';
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(cardModule.setupTrackingPixels).toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should return nothing if the card\'s entry in the campaign has no adtechId', function(done) {
            delete mockCamp.cards[0].adtechId;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).not.toBeDefined();
                expect(caches.cards.getPromise).toHaveBeenCalledWith({id: 'rc-1'});
                expect(caches.campaigns.getPromise).toHaveBeenCalledWith({id: 'cam-1'});
                expect(cardSvc.formatOutput).toHaveBeenCalled();
                expect(cardModule.setupTrackingPixels).toHaveBeenCalled();
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
                expect(cardModule.setupTrackingPixels).not.toHaveBeenCalled();
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
                expect(cardModule.setupTrackingPixels).toHaveBeenCalled();
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
});
