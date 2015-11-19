var flush = true;
describe('content-cards (UT)', function() {
    var urlUtils, q, cardModule, QueryCache, FieldValidator, CrudSvc, Status, logger, mockLog, req;

    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }

        urlUtils        = require('url');
        q               = require('q');
        cardModule      = require('../../bin/content-cards');
        CrudSvc         = require('../../lib/crudSvc');
        logger          = require('../../lib/logger');
        QueryCache      = require('../../lib/queryCache');
        FieldValidator  = require('../../lib/fieldValidator');
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
        
        req = { uuid: '1234', baseUrl: '', route: { path: '' }, params: {}, query: {} };
        
        jasmine.clock().install();
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    describe('setupCardSvc', function() {
        it('should setup the card service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').and.returnValue(CrudSvc.prototype.preventGetAll);
            spyOn(cardModule.getPublicCard, 'bind').and.returnValue(cardModule.getPublicCard);
            spyOn(FieldValidator, 'orgFunc').and.callThrough();
            spyOn(FieldValidator, 'userFunc').and.callThrough();

            var mockColl = { collectionName: 'cards' },
                config = { trackingPixel: 'track.me' },
                cardSvc = cardModule.setupCardSvc(mockColl, { caches: 'yes' }, config,
                    { hasGoogleKey : true });

            expect(cardModule.getPublicCard.bind).toHaveBeenCalledWith(cardModule, cardSvc, { caches: 'yes' });

            expect(cardModule.config.trackingPixel).toBe('track.me');
            
            expect(mockLog.warn).not.toHaveBeenCalled();

            expect(cardSvc instanceof CrudSvc).toBe(true);
            expect(cardSvc._prefix).toBe('rc');
            expect(cardSvc.objName).toBe('cards');
            expect(cardSvc._userProp).toBe(true);
            expect(cardSvc._orgProp).toBe(true);
            expect(cardSvc._allowPublic).toBe(true);
            expect(cardSvc._coll).toBe(mockColl);
            
            expect(cardSvc.createValidator._required).toContain('campaignId');
            expect(Object.keys(cardSvc.createValidator._condForbidden)).toEqual(['user', 'org']);
            expect(Object.keys(cardSvc.editValidator._condForbidden)).toEqual(['user', 'org']);
            expect(FieldValidator.userFunc).toHaveBeenCalledWith('cards', 'create');
            expect(FieldValidator.userFunc).toHaveBeenCalledWith('cards', 'edit');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('cards', 'create');
            expect(FieldValidator.orgFunc).toHaveBeenCalledWith('cards', 'edit');
            
            expect(cardSvc._middleware.read).toEqual([CrudSvc.prototype.preventGetAll]);
        });

        it('should complain if there is no youtube key',function(){
            cardModule.setupCardSvc({ collectionName: 'cards' }, { caches: 'yes' }, {},
                { hasGoogleKey : false });
            expect(mockLog.warn).toHaveBeenCalledWith('Missing googleKey from secrets, will not be able to lookup meta data for youtube videos.');
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
            q.all(['instagram','vzaar','wistia','article'].map(function(cardType){
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
                        'testid-0000', 'vzaar' ],
                    [ '[%1] - MetaData unsupported for CardType [%2].',
                        'testid-0000', 'wistia' ]
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
                event: 'completedView'
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
                event: 'completedView'
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
            req.query.preview = true;
            cardModule.getPublicCard(cardSvc, caches, 'rc-1', req).then(function(resp) {
                expect(resp).toEqual(jasmine.objectContaining({ campaign: { } }));
                expect(cardModule.setupTrackingPixels).not.toHaveBeenCalled();
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
