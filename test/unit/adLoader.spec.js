describe('AdLoader()', function() {
    var AdLoader;
    var ADTECHBannerClient;
    var q;
    var FunctionCache;
    var request;
    var BluebirdPromise;
    var Promise;
    var resolveURL;
    var clonePromise;

    var MockFunctionCache;
    var fnCache;
    var requestDeferreds;

    beforeEach(function() {
        ADTECHBannerClient = require('../../lib/adtechBannerClient');
        q = require('q');
        FunctionCache = require('../../lib/functionCache');
        request = require('request-promise');
        BluebirdPromise = require('bluebird');
        Promise = require('q').defer().promise.constructor;
        resolveURL = require('url').resolve;
        clonePromise = require('../../lib/promise').clone;

        jasmine.clock().install();

        requestDeferreds = {};
        spyOn(request, 'get').and.callFake(function(url) {
            var deferred = {};
            var req = new BluebirdPromise(function(resolve, reject) {
                deferred.resolve = resolve;
                deferred.reject = reject;
            });

            requestDeferreds[url] = deferred;
            deferred.request = req;

            return req;
        });

        MockFunctionCache = require.cache[require.resolve('../../lib/functionCache')].exports = jasmine.createSpy('MockFunctionCache()').and.callFake(function(config) {
            fnCache = new FunctionCache(config);

            var add = fnCache.add;
            spyOn(fnCache, 'add').and.callFake(function() {
                var result = add.apply(fnCache, arguments);

                fnCache.add.calls.all()[fnCache.add.calls.count() - 1].returnValue = result;

                return  result;
            });

            return fnCache;
        });

        AdLoader = require('../../lib/adLoader');
    });

    afterEach(function() {
        jasmine.clock().uninstall();

        delete require.cache[require.resolve('../../lib/functionCache')];
        delete require.cache[require.resolve('../../lib/adLoader')];
    });

    it('should exist', function() {
        expect(AdLoader).toEqual(jasmine.any(Function));
        expect(AdLoader.name).toBe('AdLoader');
    });

    describe('static:', function() {
        describe('@public', function() {
            describe('methods:', function() {
                describe('addTrackingPixels(pixels, card)', function() {
                    var pixels, card;
                    var originalCard;
                    var result;

                    beforeEach(function() {
                        pixels = {
                            countUrls: ['px1.jpg', 'px2.jpg'],
                            playUrls: ['px3.jpg', 'px4.jpg'],
                            loadUrls: ['px5.jpg', 'px6.jpg'],
                            fooUrls: ['px7.jpg', 'px8.jpg']
                        };

                        card = {
                            "campaign": {
                                "campaignId": null,
                                "advertiserId": null,
                                "minViewTime": -1,
                                "countUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=completedView&cb={cachebreaker}"
                                ],
                                "clickUrls": [],
                                "viewUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=cardView&cb={cachebreaker}"
                                ],
                                "playUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=play&cb={cachebreaker}&pd={playDelay}"
                                ],
                                "loadUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=load&cb={cachebreaker}"
                                ],
                                "q1Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q1&cb={cachebreaker}"
                                ],
                                "q2Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q2&cb={cachebreaker}"
                                ],
                                "q3Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q3&cb={cachebreaker}"
                                ],
                                "q4Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q4&cb={cachebreaker}"
                                ]
                            },
                            "campaignId": "cam-19849e91e5e46b",
                            "collateral": {
                                "logo": ""
                            },
                            "created": "2015-03-09T20:57:45.262Z",
                            "data": {
                                "hideSource": true,
                                "controls": true,
                                "autoadvance": false,
                                "skip": true,
                                "modestbranding": 0,
                                "rel": 0,
                                "videoid": "M7FIvfx5J10",
                                "href": "https://www.youtube.com/watch?v=M7FIvfx5J10",
                                "thumbs": {
                                    "small": "//img.youtube.com/vi/M7FIvfx5J10/2.jpg",
                                    "large": "//img.youtube.com/vi/M7FIvfx5J10/0.jpg"
                                }
                            },
                            "id": "rc-7a28568c31b689",
                            "lastUpdated": "2015-09-17T14:49:27.324Z",
                            "links": {},
                            "modules": [],
                            "note": "",
                            "params": {
                                "sponsor": "Diageo Staging",
                                "action": null,
                                "ad": false
                            },
                            "placementId": null,
                            "shareLinks": {},
                            "source": "YouTube",
                            "sponsored": true,
                            "status": "active",
                            "templateUrl": null,
                            "thumbs": null,
                            "title": "",
                            "type": "youtube",
                            "advertiserId": "a-274d023a4fd14d",
                            "adtechId": 6593565,
                            "bannerId": 1
                        };

                        originalCard = JSON.parse(JSON.stringify(card));

                        result = AdLoader.addTrackingPixels(pixels, card);
                    });

                    it('should add add pixels to existing arrays', function() {
                        expect(card.campaign.countUrls).toEqual(originalCard.campaign.countUrls.concat(pixels.countUrls));
                        expect(card.campaign.playUrls).toEqual(originalCard.campaign.playUrls.concat(pixels.playUrls));
                        expect(card.campaign.loadUrls).toEqual(originalCard.campaign.loadUrls.concat(pixels.loadUrls));
                    });

                    it('should create arrays that don\'t exist', function() {
                        expect(card.campaign.fooUrls).toEqual(pixels.fooUrls);
                    });

                    it('should return the card', function() {
                        expect(result).toBe(card);
                    });

                    describe('if the card has no campaign', function() {
                        beforeEach(function() {
                            delete card.campaign;

                            result = AdLoader.addTrackingPixels(pixels, card);
                        });

                        it('should create a campaign object', function() {
                            expect(card.campaign).toEqual(pixels);
                            expect(card.campaign).not.toBe(pixels);
                        });
                    });

                    describe('if some pixels are undefined or null', function() {
                        beforeEach(function() {
                            card = JSON.parse(JSON.stringify(originalCard));
                            pixels = {
                                countUrls: null,
                                playUrls: undefined
                            };

                            result = AdLoader.addTrackingPixels(pixels, card);
                        });

                        it('should have no effect', function() {
                            expect(card.campaign.countUrls).toEqual(originalCard.campaign.countUrls);
                            expect(card.campaign.playUrls).toEqual(originalCard.campaign.playUrls);
                        });
                    });
                });

                describe('hasAds(experience)', function() {
                    var experience;

                    beforeEach(function() {
                        experience = {
                            data: {
                                deck: ['youtube', 'vimeo', 'dailymotion', 'recap'].map(function(type, index) {
                                    return {
                                        type: type,
                                        campaignId: null,
                                        data: {},
                                        modules: []
                                    };
                                })
                            }
                        };
                    });

                    describe('if the experience has a static sponsored card', function() {
                        beforeEach(function() {
                            experience.data.deck.splice(1, 0, {
                                type: 'vimeo',
                                campaignId: 'cam-d9e8ry8394rh',
                                data: {},
                                modules: []
                            });
                        });

                        it('should be true', function() {
                            expect(AdLoader.hasAds(experience)).toBe(true);
                        });
                    });

                    describe('if the experience has a sponsored card placeholder', function() {
                        beforeEach(function() {
                            experience.data.deck.splice(2, 0, {
                                type: 'wildcard',
                                data: {}
                            });
                        });

                        it('should be true', function() {
                            expect(AdLoader.hasAds(experience)).toBe(true);
                        });
                    });

                    describe('if the experience has no sponsored cards or placeholders', function() {
                        it('should be false', function() {
                            expect(AdLoader.hasAds(experience)).toBe(false);
                        });
                    });
                });

                describe('removePlaceholders(experience)', function() {
                    var experience;
                    var originalDeck;
                    var result;

                    beforeEach(function() {
                        experience = {
                            data: {
                                deck: ['wildcard', 'youtube', 'vimeo', 'wildcard', 'dailymotion', 'recap'].map(function(type) {
                                    return {
                                        type: type,
                                        data: {}
                                    };
                                })
                            }
                        };

                        originalDeck = experience.data.deck.slice();

                        result = AdLoader.removePlaceholders(experience);
                    });

                    it('should remove all the wildcards from the deck', function() {
                        expect(experience.data.deck).toEqual([
                            originalDeck[1],
                            originalDeck[2],
                            originalDeck[4],
                            originalDeck[5]
                        ]);
                    });

                    it('should return the experience', function() {
                        expect(result).toBe(experience);
                    });
                });

                describe('removeSponsoredCards(experience)', function() {
                    var experience;
                    var result;
                    var sponsoredCards, originalDeck;

                    beforeEach(function() {
                        experience = {
                            data: {
                                deck: [null, 'cam-2955fce737e487', 'cam-1e05bbe2a3ef74', null, null, 'cam-8a2f40a0344018'].map(function(campaignId, index) {
                                    return {
                                        id: 'rc-' + index,
                                        type: 'youtube',
                                        data: { modules: [] },
                                        campaignId: campaignId
                                    };
                                })
                            }
                        };
                        sponsoredCards = experience.data.deck.filter(function(card) { return !!card.campaignId; });
                        originalDeck = experience.data.deck.slice();

                        result = AdLoader.removeSponsoredCards(experience);
                    });

                    it('should remove the sponsored cards from the deck', function() {
                        expect(experience.data.deck).not.toEqual(jasmine.arrayContaining(sponsoredCards));
                        expect(experience.data.deck.length).toBe(originalDeck.length - sponsoredCards.length);
                    });

                    it('should return the experience', function() {
                        expect(result).toBe(experience);
                    });
                });

                describe('getSponsoredCards(experience)', function() {
                    var experience;
                    var result;
                    var sponsoredCards;

                    beforeEach(function() {
                        experience = {
                            data: {
                                deck: [null, 'cam-2955fce737e487', 'cam-1e05bbe2a3ef74', null, null, 'cam-8a2f40a0344018'].map(function(campaignId, index) {
                                    return {
                                        id: 'rc-' + index,
                                        type: 'youtube',
                                        data: { modules: [] },
                                        campaignId: campaignId
                                    };
                                })
                            }
                        };
                        sponsoredCards = experience.data.deck.filter(function(card) { return !!card.campaignId; });

                        result = AdLoader.getSponsoredCards(experience);
                    });

                    it('should return an Array of sponsored cards', function() {
                        expect(result).toEqual(sponsoredCards);
                    });
                });

                describe('getPlaceholders(experience)', function() {
                    var experience;
                    var result;
                    var placeholders;

                    beforeEach(function() {
                        experience = {
                            data: {
                                deck: ['youtube', 'wildcard', 'vimeo', 'dailymotion', 'wildcard', 'wildcard'].map(function(type, index) {
                                    return {
                                        id: 'rc-' + index,
                                        type: type,
                                        data: { modules: [] }
                                    };
                                })
                            }
                        };
                        placeholders = experience.data.deck.filter(function(card) { return card.type === 'wildcard'; });

                        result = AdLoader.getPlaceholders(experience);
                    });

                    it('should return an Array of placeholders', function() {
                        expect(result).toEqual(placeholders);
                    });
                });
            });
        });
    });

    describe('instance:', function() {
        var config;
        var loader;

        beforeEach(function() {
            config = {
                server: 'my.adserver.com',
                network: '12345.6',
                maxSockets: 300,
                cardCacheTTLs: {
                    fresh: 5,
                    max: 10
                },
                envRoot: 'https://staging.cinema6.com/',
                cardEndpoint: '/api/public/content/cards/'
            };

            loader = new AdLoader(config);
        });

        it('should create a FunctionCache', function() {
            expect(MockFunctionCache).toHaveBeenCalledWith({
                freshTTL: config.cardCacheTTLs.fresh,
                maxTTL: config.cardCacheTTLs.max,
                extractor: clonePromise
            });
        });

        describe('if created without params', function() {
            beforeEach(function() {
                MockFunctionCache.calls.reset();

                loader = new AdLoader();
            });

            it('should create the FunctionCache with defaults', function() {
                expect(MockFunctionCache).toHaveBeenCalledWith({
                    freshTTL: 1,
                    maxTTL: 4,
                    extractor: clonePromise
                });
            });

            it('should set the envRoot to a default', function() {
                expect(loader.envRoot).toBe('http://localhost/');
            });

            it('should set the cardEndpoint to a default', function() {
                expect(loader.cardEndpoint).toBe('/api/public/content/card/');
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
                describe('__getCard__(id, params, uuid)', function() {
                    var id, params, uuid;
                    var success, failure;
                    var result;

                    beforeEach(function(done) {
                        id = 'rc-ea0578d64519fd';
                        params = {
                            container: 'pocketmath',
                            hostApp: 'My Talking Tom',
                            network: 'MoPub',
                            experience: 'e-a29116c67021f9',
                            pageUrl: 'http://www.cinema6.com/'
                        };
                        uuid = 'ry398r4y9';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        result = loader.__getCard__(id, params, uuid);
                        result.then(success, failure);
                        q().then(function() {}).then(done);
                    });

                    it('should be cached', function() {
                        expect(fnCache.add.calls.all().map(function(call) { return call.returnValue; })).toContain(loader.__getCard__);
                        fnCache.add.calls.all().forEach(function(call) {
                            if (call.returnValue === loader.__getCard__) {
                                expect(call.args).toEqual([jasmine.any(Function), 2]);
                            }
                        });
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should make a request to the content service', function() {
                        expect(request.get).toHaveBeenCalledWith(resolveURL(resolveURL(loader.envRoot, loader.cardEndpoint), id), {
                            qs: params,
                            json: true
                        });
                    });
                });
            });
        });

        describe('@public', function() {
            describe('properties:', function() {
                describe('client', function() {
                    it('should be an ADTECHBannerClient', function() {
                        expect(loader.client).toEqual(jasmine.any(ADTECHBannerClient));
                    });

                    it('should be configured with the provided configuration', function() {
                        expect(loader.client.server).toBe(config.server);
                        expect(loader.client.network).toBe(config.network);
                        expect(loader.client.maxSockets).toBe(config.maxSockets);
                    });
                });

                describe('envRoot', function() {
                    it('should be the provided envRoot', function() {
                        expect(loader.envRoot).toBe(config.envRoot);
                    });
                });

                describe('cardEndpoint', function() {
                    it('should be the provided cardEndpoint', function() {
                        expect(loader.cardEndpoint).toBe(config.cardEndpoint);
                    });
                });
            });

            describe('methods:', function() {
                describe('decorateWithCampaign(card, placement, uuid)', function() {
                    var card, placement, uuid;
                    var success, failure;
                    var getBannerDeferred;

                    beforeEach(function(done) {
                        card = {
                            "campaign": {
                                "campaignId": null,
                                "advertiserId": null,
                                "minViewTime": -1,
                                "countUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=completedView&cb={cachebreaker}"
                                ],
                                "clickUrls": [],
                                "viewUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=cardView&cb={cachebreaker}"
                                ],
                                "playUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=play&cb={cachebreaker}&pd={playDelay}"
                                ],
                                "loadUrls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=load&cb={cachebreaker}"
                                ],
                                "q1Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q1&cb={cachebreaker}"
                                ],
                                "q2Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q2&cb={cachebreaker}"
                                ],
                                "q3Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q3&cb={cachebreaker}"
                                ],
                                "q4Urls": [
                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-3f8388f7956d26&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q4&cb={cachebreaker}"
                                ]
                            },
                            "campaignId": "cam-19849e91e5e46b",
                            "collateral": {
                                "logo": ""
                            },
                            "created": "2015-03-09T20:57:45.262Z",
                            "data": {
                                "hideSource": true,
                                "controls": true,
                                "autoadvance": false,
                                "skip": true,
                                "modestbranding": 0,
                                "rel": 0,
                                "videoid": "M7FIvfx5J10",
                                "href": "https://www.youtube.com/watch?v=M7FIvfx5J10",
                                "thumbs": {
                                    "small": "//img.youtube.com/vi/M7FIvfx5J10/2.jpg",
                                    "large": "//img.youtube.com/vi/M7FIvfx5J10/0.jpg"
                                }
                            },
                            "id": "rc-7a28568c31b689",
                            "lastUpdated": "2015-09-17T14:49:27.324Z",
                            "links": {},
                            "modules": [],
                            "note": "",
                            "params": {
                                "sponsor": "Diageo Staging",
                                "action": null,
                                "ad": false
                            },
                            "placementId": null,
                            "shareLinks": {},
                            "source": "YouTube",
                            "sponsored": true,
                            "status": "active",
                            "templateUrl": null,
                            "thumbs": null,
                            "title": "",
                            "type": "youtube",
                            "advertiserId": "a-274d023a4fd14d",
                            "adtechId": 6593565,
                            "bannerId": 1
                        };
                        placement = '3477331';
                        uuid = 'dj8294ru4389';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        getBannerDeferred = q.defer();
                        spyOn(loader.client, 'getBanner').and.returnValue(getBannerDeferred.promise);

                        loader.decorateWithCampaign(card, placement, uuid).then(success, failure);
                        q().then(done);
                    });

                    it('should get the banner from ADTECH', function() {
                        expect(loader.client.getBanner).toHaveBeenCalledWith(placement, card.adtechId, card.bannerId, uuid);
                    });

                    describe('when the banner is fetched', function() {
                        var banner;

                        beforeEach(function(done) {
                            spyOn(AdLoader, 'addTrackingPixels').and.callThrough();

                            banner = {
                                placementId: placement,
                                campaignId: card.adtechId,
                                externalId: card.id,
                                clickUrl: 'http://adserver.adtechus.com/adlink/5491/3507986/0/277/AdId=6603289;BnId=1;itime=105386806;ku=3208039;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals;nodecode=yes;link=',
                                countUrl: 'http://adserver.adtechus.com/adcount/3.0/5491/3507986/0/277/AdId=6603289;BnId=1;ct=670200808;st=15769;adcid=1;itime=105386806;reqtype=5;;kwlp1=cam%2D75662e1495abfd;kwlp3=comedy%2Banimals'
                            };
                            getBannerDeferred.fulfill(banner);

                            getBannerDeferred.promise.then(function() {}).then(function() {}).finally(done);
                        });

                        it('should add the pixels from the banner to the card', function() {
                            expect(AdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                playUrls: [banner.clickUrl],
                                countUrls: [banner.countUrl]
                            }, card);
                        });

                        it('should fulfill with the card', function() {
                            expect(success).toHaveBeenCalledWith(card);
                        });
                    });

                    describe('if the card has no adtechId', function() {
                        beforeEach(function(done) {
                            card.adtechId = null;
                            loader.client.getBanner.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            loader.decorateWithCampaign(card, placement, uuid).then(success, failure).finally(done);
                        });

                        it('should reject the promise', function() {
                            expect(failure).toHaveBeenCalledWith(new Error('Card [' + card.id + '] has no adtechId.'));
                        });
                    });
                });

                describe('fillPlaceholders(experience, categories, campaign, uuid)', function() {
                    var experience, categories, campaign, uuid;
                    var success, failure;
                    var findBannersDeferred;

                    beforeEach(function() {
                        experience = {
                            "access": "public",
                            "appUri": "mini-reel-player",
                            "categories": [
                                "comedy",
                                "animals"
                            ],
                            "created": "2015-03-12T13:50:54.939Z",
                            "data": {
                                "title": "Must Love Labradoodles",
                                "mode": "light",
                                "autoplay": true,
                                "autoadvance": true,
                                "adConfig": {
                                    "video": {
                                        "firstPlacement": -1,
                                        "frequency": 0,
                                        "waterfall": "cinema6",
                                        "skip": 6
                                    },
                                    "display": {
                                        "waterfall": "cinema6",
                                        "enabled": false
                                    }
                                },
                                "sponsored": false,
                                "links": {},
                                "params": {
                                    "categories": [
                                        "comedy",
                                        "animals"
                                    ]
                                },
                                "campaign": {
                                    "launchUrls": [
                                        "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-75662e1495abfd&experience=e-349638d007fe9f&container=standalone&host=staging.cinema6.com&hostApp=&network=&event=launch&cb={cachebreaker}"
                                    ]
                                },
                                "collateral": {
                                    "splash": "/collateral/experiences/e-349638d007fe9f/splash"
                                },
                                "splash": {
                                    "source": "specified",
                                    "ratio": "3-2",
                                    "theme": "img-only"
                                },
                                "deck": [
                                    {
                                        "data": {},
                                        "id": "rc-33af92bd49802e",
                                        "type": "wildcard"
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "Qy3csNW_opA",
                                            "href": "https://www.youtube.com/watch?v=Qy3csNW_opA",
                                            "thumbs": {
                                                "small": "https://i.ytimg.com/vi/Qy3csNW_opA/default.jpg",
                                                "large": "https://i.ytimg.com/vi/Qy3csNW_opA/maxresdefault.jpg"
                                            }
                                        },
                                        "id": "rc-72f2dd1b3dd678",
                                        "type": "youtube",
                                        "title": "Some things you didn't know about labradoodles",
                                        "note": "Learn!",
                                        "source": "YouTube",
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "params": {}
                                    },
                                    {
                                        "data": {},
                                        "id": "rc-c7d87b9082bc08",
                                        "type": "wildcard"
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "uZZJvOllEsE",
                                            "href": "https://www.youtube.com/watch?v=uZZJvOllEsE",
                                            "thumbs": {
                                                "small": "https://i.ytimg.com/vi/uZZJvOllEsE/default.jpg",
                                                "large": "https://i.ytimg.com/vi/uZZJvOllEsE/hqdefault.jpg"
                                            }
                                        },
                                        "id": "rc-a0a7c4e0a11f7f",
                                        "type": "youtube",
                                        "title": "They do tricks!",
                                        "note": "Ha!!",
                                        "source": "YouTube",
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "params": {}
                                    },
                                    {
                                        "data": {},
                                        "id": "rc-e3b00954c214e1",
                                        "type": "wildcard"
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "aWwPjA6VsG4",
                                            "href": "https://www.youtube.com/watch?v=aWwPjA6VsG4",
                                            "thumbs": {
                                                "small": "https://i.ytimg.com/vi/aWwPjA6VsG4/default.jpg",
                                                "large": "https://i.ytimg.com/vi/aWwPjA6VsG4/hqdefault.jpg"
                                            }
                                        },
                                        "id": "rc-aceebdeb2ef5be",
                                        "type": "youtube",
                                        "title": "So Cute",
                                        "note": null,
                                        "source": "YouTube",
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "params": {}
                                    },
                                    {
                                        "data": {},
                                        "id": "rc-6747b17960b894",
                                        "type": "recap",
                                        "title": "Recap of Must Love Labradoodles",
                                        "note": null,
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "params": {}
                                    }
                                ],
                                "branding": "cinema6",
                                "placementId": 3507987,
                                "wildCardPlacement": 3507986
                            },
                            "versionId": "f75eb56b",
                            "title": "Must Love Labradoodles",
                            "id": "e-349638d007fe9f",
                            "lastUpdated": "2015-05-13T19:13:52.519Z",
                            "status": "active",
                            "lastStatusChange": "2015-03-12T13:55:40.245Z",
                            "lastPublished": "2015-03-12T13:55:40.245Z",
                            "type": "minireel",
                            $params: {
                                container: 'pocketmath',
                                hostApp: 'My Talking Tom',
                                network: 'MoPub',
                                pageUrl: 'http://www.cinema6.com',
                                branding: 'foo',
                                wildCardPlacement: '7583475',
                                preview: false
                            }
                        };
                        categories = ['food', 'gaming', 'tech', 'lifestyle', 'humor'];
                        campaign = 'cam-74cfe164c53fc9';
                        uuid = 'fj829rhf849';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        findBannersDeferred = q.defer();
                        spyOn(loader.client, 'findBanners').and.returnValue(findBannersDeferred.promise);

                        loader.fillPlaceholders(experience, categories, campaign, uuid).then(success, failure);
                    });

                    it('should get ADTECH banners for each of the cards', function() {
                        expect(loader.client.findBanners).toHaveBeenCalledWith(3, experience.data.wildCardPlacement, ['2x2'], {
                            kwlp1: campaign,
                            kwlp3: 'food+gaming+tech+lifestyle'
                        }, uuid);
                    });

                    describe('if the same banner is returned', function() {
                        var banners;

                        beforeEach(function(done) {
                            banners = [
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: 'rc-3fef9cb732c596',
                                    clickUrl: 'rc-3fef9cb732c596-click.jpg',
                                    countUrl: 'rc-3fef9cb732c596-count.jpg'
                                },
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: 'rc-1658700e561f26',
                                    clickUrl: 'rc-a0a7c4e0a11f7f-click.jpg',
                                    countUrl: 'rc-a0a7c4e0a11f7f-count.jpg'
                                },
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: 'rc-3fef9cb732c596',
                                    clickUrl: 'rc-3fef9cb732c596-click.jpg',
                                    countUrl: 'rc-3fef9cb732c596-count.jpg'
                                }
                            ];

                            spyOn(loader, '__getCard__').and.callFake(function(id) {
                                return q({
                                    id: id,
                                    type: 'youtube',
                                    data: {}
                                });
                            });

                            findBannersDeferred.fulfill(banners);
                            q.allSettled([success, failure]).finally(done);
                        });

                        it('should only get a card once', function() {
                            expect(loader.__getCard__).toHaveBeenCalledWith(banners[0].externalId, jasmine.any(Object), jasmine.any(String));
                            expect(loader.__getCard__).toHaveBeenCalledWith(banners[1].externalId, jasmine.any(Object), jasmine.any(String));
                            expect(loader.__getCard__.calls.count()).toBe(2);
                        });
                    });

                    describe('if getting banners succeeds', function() {
                        var banners;
                        var getCardDeferreds;

                        beforeEach(function(done) {
                            banners = [
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: 'rc-3fef9cb732c596',
                                    clickUrl: 'rc-3fef9cb732c596-click.jpg',
                                    countUrl: 'rc-3fef9cb732c596-count.jpg'
                                },
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: experience.data.deck[3].id, // Simulate ADTECH loading a card that is already in the MR
                                    clickUrl: 'rc-a0a7c4e0a11f7f-click.jpg',
                                    countUrl: 'rc-a0a7c4e0a11f7f-count.jpg'
                                },
                                {
                                    placementId: experience.data.wildCardPlacement,
                                    campaignId: campaign,
                                    externalId: 'rc-822dfc305faa57',
                                    clickUrl: 'rc-822dfc305faa57-click.jpg',
                                    countUrl: 'rc-822dfc305faa57-count.jpg'
                                }
                            ];

                            findBannersDeferred.fulfill(banners);

                            getCardDeferreds = [];
                            spyOn(loader, '__getCard__').and.callFake(function() {
                                var deferred = q.defer();

                                getCardDeferreds.push(deferred);

                                return deferred.promise;
                            });

                            findBannersDeferred.promise.finally(done);
                        });

                        it('should make a request for the cards that are not already in the MiniReel', function() {
                            expect(loader.__getCard__).toHaveBeenCalledWith(banners[0].externalId, {
                                container: 'pocketmath',
                                hostApp: 'My Talking Tom',
                                network: 'MoPub',
                                pageUrl: 'http://www.cinema6.com',
                                experience: experience.id,
                                preview: false
                            }, uuid);
                            expect(loader.__getCard__).toHaveBeenCalledWith(banners[2].externalId, {
                                container: 'pocketmath',
                                hostApp: 'My Talking Tom',
                                network: 'MoPub',
                                pageUrl: 'http://www.cinema6.com',
                                experience: experience.id,
                                preview: false
                            }, uuid);
                            expect(loader.__getCard__.calls.count()).toBe(2);
                        });

                        describe('and preview mode is true', function() {
                            beforeEach(function(done) {
                                loader.client.findBanners.and.returnValue(q(banners));
                                loader.__getCard__.and.returnValue(q({ data: {} }));
                                spyOn(AdLoader.prototype, '__getCard__').and.returnValue(q({ data: {} }));

                                success.calls.reset();
                                failure.calls.reset();
                                loader.__getCard__.calls.reset();
                                loader.client.findBanners.calls.reset();

                                experience.$params.preview = true;

                                loader.fillPlaceholders(experience, categories, campaign, uuid).then(success, failure).finally(done);
                            });

                            it('should call the uncached version of __getCard__()', function() {
                                expect(AdLoader.prototype.__getCard__).toHaveBeenCalledWith(banners[0].externalId, {
                                    container: 'pocketmath',
                                    hostApp: 'My Talking Tom',
                                    network: 'MoPub',
                                    pageUrl: 'http://www.cinema6.com',
                                    experience: experience.id,
                                    preview: true
                                }, uuid);
                                expect(AdLoader.prototype.__getCard__).toHaveBeenCalledWith(banners[2].externalId, {
                                    container: 'pocketmath',
                                    hostApp: 'My Talking Tom',
                                    network: 'MoPub',
                                    pageUrl: 'http://www.cinema6.com',
                                    experience: experience.id,
                                    preview: true
                                }, uuid);
                                expect(AdLoader.prototype.__getCard__.calls.count()).toBe(2);
                                expect(loader.__getCard__).not.toHaveBeenCalled();
                            });
                        });

                        describe('when the cards are fetched', function() {
                            var card1, card2;
                            var originalDeck;

                            beforeEach(function(done) {
                                card1 = {
                                    id: banners[0].externalId,
                                    type: 'youtube',
                                    data: {}
                                };
                                card2 = {
                                    id: banners[2].externalId,
                                    type: 'youtube',
                                    data: {}
                                };

                                originalDeck = experience.data.deck.slice();

                                spyOn(AdLoader, 'addTrackingPixels').and.callThrough();
                                spyOn(AdLoader, 'removePlaceholders').and.callThrough();

                                getCardDeferreds[0].fulfill(card1);
                                getCardDeferreds[1].fulfill(card2);

                                q.all([getCardDeferreds[0].promise, getCardDeferreds[1].promise]).finally(done);
                            });

                            it('should add the banner tracking pixels to each card', function() {
                                expect(AdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                    playUrls: [banners[0].clickUrl],
                                    countUrls: [banners[0].countUrl]
                                }, card1);
                                expect(AdLoader.addTrackingPixels).toHaveBeenCalledWith({
                                    playUrls: [banners[2].clickUrl],
                                    countUrls: [banners[2].countUrl]
                                }, card2);
                            });

                            it('should replace the wildcard placeholders with actual sponsored cards', function() {
                                expect(experience.data.deck).toEqual([
                                    card1,
                                    originalDeck[1],
                                    card2
                                ].concat(originalDeck.slice(3).filter(function(card) {
                                    return card.type !== 'wildcard';
                                })));
                            });

                            it('should removePlaceholders() from the deck', function() {
                                expect(AdLoader.removePlaceholders).toHaveBeenCalledWith(experience);
                            });
                        });
                    });
                });

                describe('loadAds(experience, categories, campaignId, uuid)', function() {
                    var experience, categories, campaignId, uuid;
                    var result;
                    var success, failure;

                    beforeEach(function(done) {
                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        experience = {
                            "access": "public",
                            "appUri": "mini-reel-player",
                            "categories": [
                                "comedy",
                                "animals"
                            ],
                            "created": "2015-03-12T13:50:54.939Z",
                            "data": {
                                "title": "Must Love Labradoodles",
                                "mode": "light",
                                "autoplay": true,
                                "autoadvance": true,
                                "adConfig": {
                                    "video": {
                                        "firstPlacement": -1,
                                        "frequency": 0,
                                        "waterfall": "cinema6",
                                        "skip": 6
                                    },
                                    "display": {
                                        "waterfall": "cinema6",
                                        "enabled": false
                                    }
                                },
                                "sponsored": false,
                                "links": {},
                                "params": {
                                    "categories": [
                                        "comedy",
                                        "animals"
                                    ]
                                },
                                "campaign": {
                                    "launchUrls": [
                                        "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=launch&cb={cachebreaker}"
                                    ]
                                },
                                "collateral": {
                                    "splash": "/collateral/experiences/e-349638d007fe9f/splash"
                                },
                                "splash": {
                                    "source": "specified",
                                    "ratio": "3-2",
                                    "theme": "img-only"
                                },
                                "deck": [
                                    {
                                        "data": {},
                                        "id": "rc-33af92bd49802e",
                                        "type": "wildcard"
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "Qy3csNW_opA",
                                            "href": "https://www.youtube.com/watch?v=Qy3csNW_opA",
                                            "thumbs": {
                                                "small": "//img.youtube.com/vi/Qy3csNW_opA/2.jpg",
                                                "large": "//img.youtube.com/vi/Qy3csNW_opA/0.jpg"
                                            }
                                        },
                                        "id": "rc-72f2dd1b3dd678",
                                        "type": "youtube",
                                        "title": "Some things you didn't know about labradoodles",
                                        "note": "Learn!",
                                        "source": "YouTube",
                                        "modules": [],
                                        "thumbs": null,
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "shareLinks": {},
                                        "params": {}
                                    },
                                    {
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": -1,
                                            "countUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=completedView&cb={cachebreaker}"
                                            ],
                                            "clickUrls": [],
                                            "viewUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=cardView&cb={cachebreaker}"
                                            ],
                                            "playUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=play&cb={cachebreaker}&pd={playDelay}"
                                            ],
                                            "loadUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=load&cb={cachebreaker}"
                                            ],
                                            "q1Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q1&cb={cachebreaker}"
                                            ],
                                            "q2Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q2&cb={cachebreaker}"
                                            ],
                                            "q3Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q3&cb={cachebreaker}"
                                            ],
                                            "q4Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-7a28568c31b689&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q4&cb={cachebreaker}"
                                            ]
                                        },
                                        "campaignId": "cam-19849e91e5e46b",
                                        "collateral": {
                                            "logo": ""
                                        },
                                        "created": "2015-03-09T20:57:45.262Z",
                                        "data": {
                                            "hideSource": true,
                                            "controls": true,
                                            "autoadvance": false,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "M7FIvfx5J10",
                                            "href": "https://www.youtube.com/watch?v=M7FIvfx5J10",
                                            "thumbs": {
                                                "small": "//img.youtube.com/vi/M7FIvfx5J10/2.jpg",
                                                "large": "//img.youtube.com/vi/M7FIvfx5J10/0.jpg"
                                            }
                                        },
                                        "id": "rc-7a28568c31b689",
                                        "lastUpdated": "2015-09-17T14:49:27.324Z",
                                        "links": {},
                                        "modules": [],
                                        "note": "",
                                        "params": {
                                            "sponsor": "Diageo Staging",
                                            "action": null,
                                            "ad": false
                                        },
                                        "placementId": null,
                                        "shareLinks": {},
                                        "source": "YouTube",
                                        "sponsored": true,
                                        "status": "active",
                                        "templateUrl": null,
                                        "thumbs": null,
                                        "title": "",
                                        "type": "youtube",
                                        "advertiserId": "a-274d023a4fd14d",
                                        "adtechId": 6593565,
                                        "bannerId": 1
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "uZZJvOllEsE",
                                            "href": "https://www.youtube.com/watch?v=uZZJvOllEsE",
                                            "thumbs": {
                                                "small": "//img.youtube.com/vi/uZZJvOllEsE/2.jpg",
                                                "large": "//img.youtube.com/vi/uZZJvOllEsE/0.jpg"
                                            }
                                        },
                                        "id": "rc-a0a7c4e0a11f7f",
                                        "type": "youtube",
                                        "title": "They do tricks!",
                                        "note": "Ha!!",
                                        "source": "YouTube",
                                        "modules": [],
                                        "thumbs": null,
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "shareLinks": {},
                                        "params": {}
                                    },
                                    {
                                        "data": {},
                                        "id": "rc-fe7d0296934256",
                                        "type": "wildcard"
                                    },
                                    {
                                        "data": {
                                            "hideSource": true,
                                            "controls": true,
                                            "autoadvance": false,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "tukQDg22o9M",
                                            "reportingId": "kings"
                                        },
                                        "type": "youtube",
                                        "title": "My Card",
                                        "note": "This is pretty sweet.",
                                        "source": "YouTube",
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": true,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": 20,
                                            "viewUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=cardView&cb={cachebreaker}"
                                            ],
                                            "playUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=play&cb={cachebreaker}&pd={playDelay}"
                                            ],
                                            "loadUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=load&cb={cachebreaker}"
                                            ],
                                            "countUrls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=completedView&cb={cachebreaker}"
                                            ],
                                            "q1Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q1&cb={cachebreaker}"
                                            ],
                                            "q2Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q2&cb={cachebreaker}"
                                            ],
                                            "q3Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q3&cb={cachebreaker}"
                                            ],
                                            "q4Urls": [
                                                "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=q4&cb={cachebreaker}"
                                            ]
                                        },
                                        "collateral": {
                                            "logo": "https://s3-us-west-2.amazonaws.com/slack-files2/avatars/2014-11-25/3088275948_c07157485185eef0b7db_192.jpg"
                                        },
                                        "links": {
                                            "Action": {
                                                "uri": "https://www.youtube.com/watch?v=tukQDg22o9M",
                                                "tracking": [
                                                    "//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif?campaign=cam-19849e91e5e46b&card=rc-5a88ad6637ab90&experience=e-349638d007fe9f&container=embed&host=staging.cinema6.com&hostApp=&network=&event=link.Action&cb={cachebreaker}"
                                                ]
                                            }
                                        },
                                        "params": {
                                            "sponsor": "Diageo Staging",
                                            "action": {
                                                "type": "button",
                                                "label": "Check it out!"
                                            },
                                            "ad": true
                                        },
                                        "campaignId": "cam-19849e91e5e46b",
                                        "id": "rc-5a88ad6637ab90",
                                        "created": "2015-03-09T22:13:40.036Z",
                                        "lastUpdated": "2015-03-09T22:13:40.036Z",
                                        "status": "active",
                                        "advertiserId": "a-274d023a4fd14d",
                                        "adtechId": 6593568,
                                        "bannerId": 1
                                    },
                                    {
                                        "data": {
                                            "controls": true,
                                            "skip": true,
                                            "modestbranding": 0,
                                            "rel": 0,
                                            "videoid": "aWwPjA6VsG4",
                                            "href": "https://www.youtube.com/watch?v=aWwPjA6VsG4",
                                            "thumbs": {
                                                "small": "//img.youtube.com/vi/aWwPjA6VsG4/2.jpg",
                                                "large": "//img.youtube.com/vi/aWwPjA6VsG4/0.jpg"
                                            }
                                        },
                                        "id": "rc-aceebdeb2ef5be",
                                        "type": "youtube",
                                        "title": "So Cute",
                                        "note": null,
                                        "source": "YouTube",
                                        "modules": [],
                                        "thumbs": null,
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "shareLinks": {},
                                        "params": {}
                                    },
                                    {
                                        "data": {},
                                        "id": "rc-3b0ae89f3eefeb",
                                        "type": "recap",
                                        "title": "Recap of Must Love Labradoodles",
                                        "note": null,
                                        "modules": [],
                                        "placementId": null,
                                        "templateUrl": null,
                                        "sponsored": false,
                                        "campaign": {
                                            "campaignId": null,
                                            "advertiserId": null,
                                            "minViewTime": null,
                                            "countUrls": [],
                                            "clickUrls": []
                                        },
                                        "collateral": {},
                                        "links": {},
                                        "params": {}
                                    }
                                ],
                                "branding": "cinema6",
                                "placementId": 3477332,
                                "wildCardPlacement": 3477331
                            },
                            "versionId": "58a6610e",
                            "title": "Must Love Labradoodles",
                            "id": "e-349638d007fe9f",
                            "lastUpdated": "2015-09-29T12:26:59.765Z",
                            "status": "active",
                            "lastStatusChange": "2015-03-12T13:55:40.245Z",
                            "lastPublished": "2015-03-12T13:55:40.245Z",
                            "type": "minireel"
                        };
                        categories = ['food', 'tech', 'gaming', 'music', 'auto'];
                        campaignId = 'cam-19849e91e5e46b';
                        uuid = 'ufr8934yr849';

                        spyOn(loader, 'decorateWithCampaign').and.callFake(function(card) {
                            return q(card);
                        });
                        spyOn(loader, 'fillPlaceholders').and.callFake(function(experience) {
                            return q(experience);
                        });

                        result = loader.loadAds(experience, categories, campaignId, uuid);
                        result.then(success, failure);

                        result.finally(done);
                    });

                    it('should decorate all the static sponsored cards with campaign data', function() {
                        var sponsoredCards = [experience.data.deck[2], experience.data.deck[5]];

                        sponsoredCards.forEach(function(card) {
                            expect(loader.decorateWithCampaign).toHaveBeenCalledWith(card, experience.data.wildCardPlacement, uuid);
                        });
                        expect(loader.decorateWithCampaign.calls.count()).toBe(sponsoredCards.length);
                    });

                    it('should fill the experience\'s placeholders', function() {
                        expect(loader.fillPlaceholders).toHaveBeenCalledWith(experience, categories, campaignId, uuid);
                    });

                    it('should fulfill with the experience', function() {
                        expect(success).toHaveBeenCalledWith(experience);
                    });

                    describe('if the experience has no wildCardPlacement', function() {
                        beforeEach(function(done) {
                            delete experience.data.wildCardPlacement;
                            loader.decorateWithCampaign.calls.reset();
                            loader.fillPlaceholders.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();
                            spyOn(AdLoader, 'removeSponsoredCards').and.callThrough();
                            spyOn(AdLoader, 'removePlaceholders').and.callThrough();

                            loader.loadAds(experience, categories, campaignId, uuid).then(success, failure).finally(done);
                        });

                        it('should not decorate the sponsored cards with campaign data', function() {
                            expect(loader.decorateWithCampaign).not.toHaveBeenCalled();
                        });

                        it('should not fill the placeholders', function() {
                            expect(loader.fillPlaceholders).not.toHaveBeenCalled();
                        });

                        it('should remove the placeholders and sponsored cards', function() {
                            expect(AdLoader.removePlaceholders).toHaveBeenCalledWith(experience);
                            expect(AdLoader.removeSponsoredCards).toHaveBeenCalledWith(experience);
                        });

                        it('should fulfill the promise', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });

                    describe('if the experience has no ads', function() {
                        beforeEach(function(done) {
                            delete experience.data.wildCardPlacement;
                            experience.data.deck = experience.data.deck.filter(function(card) {
                                return !(card.type === 'wildcard' || typeof card.campaignId === 'string');
                            });
                            loader.decorateWithCampaign.calls.reset();
                            loader.fillPlaceholders.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            loader.loadAds(experience, categories, campaignId, uuid).then(success, failure).finally(done);
                        });

                        it('should not decorate the sponsored cards with campaign data', function() {
                            expect(loader.decorateWithCampaign).not.toHaveBeenCalled();
                        });

                        it('should not fill the placeholders', function() {
                            expect(loader.fillPlaceholders).not.toHaveBeenCalled();
                        });

                        it('should fulfill the promise with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });

                    describe('if no categories are provided', function() {
                        beforeEach(function(done) {
                            loader.decorateWithCampaign.calls.reset();
                            loader.fillPlaceholders.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            loader.loadAds(experience, null, campaignId, uuid).then(success, failure).finally(done);
                        });

                        it('should call fillPlaceholders() with the experience\'s categories', function() {
                            expect(loader.fillPlaceholders).toHaveBeenCalledWith(experience, experience.categories, campaignId, uuid);
                        });

                        describe('and the experience has no categories', function() {
                            beforeEach(function(done) {
                                delete experience.categories;
                                loader.decorateWithCampaign.calls.reset();
                                loader.fillPlaceholders.calls.reset();
                                success.calls.reset();
                                failure.calls.reset();

                                loader.loadAds(experience, null, campaignId, uuid).then(success, failure).finally(done);
                            });

                            it('should call fillPlaceholders() with an empty array', function() {
                                expect(loader.fillPlaceholders).toHaveBeenCalledWith(experience, [], campaignId, uuid);
                            });
                        });
                    });

                    describe('if the banners for some static cards cannot be fetched', function() {
                        var originalDeck, sponsoredCards;

                        beforeEach(function(done) {
                            loader.decorateWithCampaign.calls.reset();
                            loader.fillPlaceholders.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            originalDeck = experience.data.deck.slice();
                            sponsoredCards = [originalDeck[2], originalDeck[5]];

                            loader.decorateWithCampaign.and.returnValue(q.reject('Failed to load banner.'));

                            loader.loadAds(experience, categories, campaignId, uuid).then(success, failure).finally(done);
                        });

                        it('should remove those cards from the experience', function() {
                            expect(experience.data.deck).not.toEqual(jasmine.arrayContaining(sponsoredCards));
                            expect(experience.data.deck.length).toBe(originalDeck.length - 2);
                        });

                        it('should fulfill with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });
                });
            });
        });
    });
});
