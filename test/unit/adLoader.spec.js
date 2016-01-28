describe('AdLoader()', function() {
    var AdLoader;
    var q;
    var FunctionCache;
    var request;
    var BluebirdPromise;
    var Promise;
    var resolveURL;
    var clonePromise;
    var _;
    var extend;

    var MockFunctionCache;
    var fnCache;
    var requestDeferreds;
    var logger, log;

    beforeEach(function() {
        q = require('q');
        FunctionCache = require('../../lib/functionCache');
        request = require('request-promise');
        BluebirdPromise = require('bluebird');
        Promise = require('q').defer().promise.constructor;
        resolveURL = require('url').resolve;
        clonePromise = require('../../lib/promise').clone;
        logger = require('../../lib/logger');
        _ = require('lodash');
        extend = require('../../lib/objUtils').extend;

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

        log = {
            info: jasmine.createSpy('log.info()'),
            trace: jasmine.createSpy('log.trace()'),
            warn: jasmine.createSpy('log.warn()'),
            error: jasmine.createSpy('log.error()')
        };
        spyOn(logger, 'getLog').and.returnValue(log);

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
                describe('isSponsored(card)', function() {
                    var card;

                    beforeEach(function() {
                        card = {};
                    });

                    describe('if the card has a campaignId', function() {
                        beforeEach(function() {
                            card.campaignId = 'cam-8h6r5bv674e5tg';
                        });

                        it('should be true', function() {
                            expect(AdLoader.isSponsored(card)).toBe(true);
                        });
                    });

                    describe('if the card has no campaignId', function() {
                        beforeEach(function() {
                            delete card.campaignId;
                        });

                        it('should be false', function() {
                            expect(AdLoader.isSponsored(card)).toBe(false);
                        });
                    });

                    [null, undefined, 33, true, false, {}, []].forEach(function(value) {
                        describe('if the card\'s campaignId is ' + value, function() {
                            beforeEach(function() {
                                card.campaignId = value;
                            });

                            it('should be false', function() {
                                expect(AdLoader.isSponsored(card)).toBe(false);
                            });
                        });
                    });
                });

                describe('addTrackingPixels(pixels, card)', function() {
                    var pixels, card;
                    var originalCard;
                    var result;

                    beforeEach(function() {
                        pixels = {
                            countUrls: ['px1.jpg', 'px2.jpg'],
                            playUrls: ['px3.jpg', 'px4.jpg'],
                            loadUrls: ['px5.jpg', 'px6.jpg'],
                            fooUrls: ['px7.jpg', 'px8.jpg'],
                            clickUrls: ['px9.jpg', 'px10.jpg']
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
                            "links": {
                                "Action": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Action&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "Facebook": {
                                    "uri": "https://www.facebook.com/dannon",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Facebook&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "Twitter": {
                                    "uri": "https://www.twitter.com/Dannon",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Twitter&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "Website": {
                                    "uri": "http://www.dannon.com",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Website&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "Instagram": {
                                    "uri": "http://instagram.com/dannon",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Instagram&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "YouTube": {
                                    "uri": "http://www.youtube.com/user/dannon",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.YouTube&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "Pinterest": {
                                    "uri": "http://www.pinterest.com/dannonyogurt/",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=link.Pinterest&d={delay}&cb={cachebreaker}"
                                    ]
                                }
                            },
                            "modules": [],
                            "note": "",
                            "params": {
                                "sponsor": "Diageo Staging",
                                "action": null,
                                "ad": false
                            },
                            "placementId": null,
                            "shareLinks": {
                                "facebook": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=shareLink.facebook&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "twitter": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=shareLink.twitter&d={delay}&cb={cachebreaker}"
                                    ]
                                },
                                "pinterest": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": [
                                        "//audit-staging.cinema6.com/pixel.gif?campaign=cam-ac039170b567ff&card=rc-e93e7cc5832401&experience=&container=&host=&hostApp=&network=&event=shareLink.pinterest&d={delay}&cb={cachebreaker}"
                                    ]
                                }
                            },
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

                    it('should not add clickUrls to the campaign', function() {
                        expect(card.campaign.clickUrls).toEqual(originalCard.campaign.clickUrls);
                    });

                    it('should add the clickUrls to every link and shareLink', function() {
                        expect(Object.keys(card.links).length).toBeGreaterThan(0);
                        Object.keys(card.links).forEach(function(type) {
                            expect(card.links[type].tracking).toEqual(originalCard.links[type].tracking.concat(pixels.clickUrls), type);
                        });

                        expect(Object.keys(card.shareLinks).length).toBeGreaterThan(0);
                        Object.keys(card.shareLinks).forEach(function(type) {
                            expect(card.shareLinks[type].tracking).toEqual(originalCard.shareLinks[type].tracking.concat(pixels.clickUrls), type);
                        });
                    });

                    it('should return the card', function() {
                        expect(result).toBe(card);
                    });

                    describe('if no clickUrls are specified', function() {
                        beforeEach(function() {
                            delete pixels.clickUrls;
                            card.links = JSON.parse(JSON.stringify(originalCard.links));
                            card.shareLinks = JSON.parse(JSON.stringify(originalCard.shareLinks));

                            result = AdLoader.addTrackingPixels(pixels, card);
                        });

                        it('should not add anything to the tracking Arrays', function() {
                            expect(Object.keys(card.links).length).toBeGreaterThan(0);
                            Object.keys(card.links).forEach(function(type) {
                                expect(card.links[type].tracking).toEqual(originalCard.links[type].tracking, type);
                            });

                            expect(Object.keys(card.shareLinks).length).toBeGreaterThan(0);
                            Object.keys(card.shareLinks).forEach(function(type) {
                                expect(card.shareLinks[type].tracking).toEqual(originalCard.shareLinks[type].tracking, type);
                            });
                        });
                    });

                    describe('if the card has no links or shareLinks', function() {
                        beforeEach(function() {
                            delete card.links;
                            delete card.shareLinks;

                            result = AdLoader.addTrackingPixels(pixels, card);
                        });

                        it('should create the Objects', function() {
                            expect(card.links).toEqual({});
                            expect(card.shareLinks).toEqual({});
                        });
                    });

                    describe('if the card has no campaign', function() {
                        beforeEach(function() {
                            delete card.campaign;

                            result = AdLoader.addTrackingPixels(pixels, card);
                        });

                        it('should create a campaign object', function() {
                            expect(card.campaign).toEqual(_.omit(pixels, ['clickUrls']));
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
                cardEndpoint: '/api/public/content/cards/',
                trackingPixel: '//s3.amazonaws.com/c6.dev/e2e/1x1-pixel.gif'
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
                expect(loader.cardEndpoint).toBe('/api/public/content/cards/');
            });

            it('should set the trackingPixel to null', function() {
                expect(loader.trackingPixel).toBeNull();
            });
        });

        describe('@private', function() {
            describe('methods:', function() {
                describe('__addTrackingPixels__(card, meta)', function() {
                    var card, meta;
                    var result;
                    var originalCard;

                    beforeEach(function() {
                        card = {
                            "campaign": {
                                "campaignId": null,
                                "advertiserId": null,
                                "minViewTime": -1,
                                "countUrls": [],
                                "clickUrls": [],
                                "loadUrls": [],
                                "q1Urls": ["http://www.example.com/pixel.gif?event=q1"],
                                "q3Urls": [],
                                "q4Urls": []
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
                            "links": {
                                "Action": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": []
                                },
                                "Facebook": {
                                    "uri": "https://www.facebook.com/dannon",
                                    "tracking": []
                                },
                                "Twitter": {
                                    "uri": "https://www.twitter.com/Dannon",
                                    "tracking": []
                                },
                                "Website": {
                                    "uri": "http://www.dannon.com",
                                    "tracking": ['http://www.example.com/pixel.gif?event=link.Website']
                                },
                                "Instagram": {
                                    "uri": "http://instagram.com/dannon",
                                    "tracking": []
                                },
                                "YouTube": {
                                    "uri": "http://www.youtube.com/user/dannon",
                                    "tracking": []
                                },
                                "Pinterest": {
                                    "uri": "http://www.pinterest.com/dannonyogurt/",
                                    "tracking": []
                                }
                            },
                            "modules": [],
                            "note": "",
                            "params": {
                                "sponsor": "Diageo Staging",
                                "action": null,
                                "ad": false
                            },
                            "placementId": null,
                            "shareLinks": {
                                "facebook": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": []
                                },
                                "twitter": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": ['http://www.example.com/pixel.gif?event=shareLink.twitter']
                                },
                                "pinterest": {
                                    "uri": "http://www.smashingmagazine.com",
                                    "tracking": []
                                }
                            },
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
                        meta = {
                            campaign: 'cam-585f78a09b4cf6',
                            card: 'rc-7e95af1d928a17',
                            experience: 'e-00000000000000',
                            container: 'beeswax',
                            placement: 'pl-1e5878cf989cbd',
                            origin: 'http://reelcontent.com/',
                            hostApp: 'My Talking Tom',
                            network: 'MoPub',
                            secure: true,
                            reqUuid: '87r893434',
                            uuid: 'wr98y3498f3r4',
                            preview: false,
                            debug: 2,
                            branding: 'rcplatform',
                            ex: 'my-experiment',
                            vr: 'my-variant'
                        };

                        originalCard = JSON.parse(JSON.stringify(card));

                        result = loader.__addTrackingPixels__(card, meta);
                    });

                    it('should return the card', function() {
                        expect(result).toBe(card);
                    });

                    it('should add tracking pixels to the card\'s campaign', function() {
                        var pixel = require('url').parse(loader.trackingPixel);

                        [
                            { prop: 'bufferUrls', event: 'buffer' },
                            { prop: 'viewUrls', event: 'cardView' },
                            { prop: 'playUrls', event: 'play' },
                            { prop: 'loadUrls', event: 'load' },
                            { prop: 'launchUrls', event: 'launch' },
                            { prop: 'countUrls', event: 'completedView' },
                            { prop: 'q1Urls', event: 'q1' },
                            { prop: 'q2Urls', event: 'q2' },
                            { prop: 'q3Urls', event: 'q3' },
                            { prop: 'q4Urls', event: 'q4' }
                        ].forEach(function(item) {
                            var urls = card.campaign[item.prop];

                            expect(urls).toEqual((originalCard.campaign[item.prop] || []).concat([jasmine.any(String)]));
                            expect(card.campaign[item.prop][card.campaign[item.prop].length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                campaign: card.campaignId,
                                card: card.id,
                                experience: meta.experience,
                                container: meta.container,
                                placement: meta.placement,
                                host: 'reelcontent.com',
                                hostApp: meta.hostApp,
                                network: meta.network,
                                sessionId: meta.reqUuid,
                                extSessionId: meta.uuid,
                                branding: meta.branding,
                                ex: meta.ex,
                                vr: meta.vr,
                                event: item.event
                            }) + '&d={delay}&cb={cachebreaker}');
                        });
                    });

                    it('should add tracking pixels to the card\'s links', function() {
                        Object.keys(card.links).forEach(function(type) {
                            expect(card.links[type].tracking).toEqual(originalCard.links[type].tracking.concat([jasmine.any(String)]));
                            expect(card.links[type].tracking[card.links[type].tracking.length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                campaign: card.campaignId,
                                card: card.id,
                                experience: meta.experience,
                                container: meta.container,
                                placement: meta.placement,
                                host: 'reelcontent.com',
                                hostApp: meta.hostApp,
                                network: meta.network,
                                sessionId: meta.reqUuid,
                                extSessionId: meta.uuid,
                                branding: meta.branding,
                                ex: meta.ex,
                                vr: meta.vr,
                                event: 'link.' + type
                            }) + '&d={delay}&cb={cachebreaker}');
                        });
                    });

                    it('should add tracking pixels to the card\'s shareLinks', function() {
                        Object.keys(card.shareLinks).forEach(function(type) {
                            expect(card.shareLinks[type].tracking).toEqual(originalCard.shareLinks[type].tracking.concat([jasmine.any(String)]));
                            expect(card.shareLinks[type].tracking[card.shareLinks[type].tracking.length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                campaign: card.campaignId,
                                card: card.id,
                                experience: meta.experience,
                                container: meta.container,
                                placement: meta.placement,
                                host: 'reelcontent.com',
                                hostApp: meta.hostApp,
                                network: meta.network,
                                sessionId: meta.reqUuid,
                                extSessionId: meta.uuid,
                                branding: meta.branding,
                                ex: meta.ex,
                                vr: meta.vr,
                                event: 'shareLink.' + type
                            }) + '&d={delay}&cb={cachebreaker}');
                        });
                    });

                    describe('if the card has no campaign', function() {
                        beforeEach(function() {
                            result = undefined;
                            card = JSON.parse(JSON.stringify(originalCard));
                            delete card.campaign;
                            originalCard = JSON.parse(JSON.stringify(card));

                            result = loader.__addTrackingPixels__(card, meta);
                        });

                        it('should return the card', function() {
                            expect(result).toBe(card);
                        });

                        it('should give the card a campaign', function() {
                            expect(card.campaign).toEqual([
                                { prop: 'bufferUrls', event: 'buffer' },
                                { prop: 'viewUrls', event: 'cardView' },
                                { prop: 'playUrls', event: 'play' },
                                { prop: 'loadUrls', event: 'load' },
                                { prop: 'launchUrls', event: 'launch' },
                                { prop: 'countUrls', event: 'completedView' },
                                { prop: 'q1Urls', event: 'q1' },
                                { prop: 'q2Urls', event: 'q2' },
                                { prop: 'q3Urls', event: 'q3' },
                                { prop: 'q4Urls', event: 'q4' }
                            ].reduce(function(campaign, item) {
                                campaign[item.prop] = [loader.trackingPixel + '?' + require('querystring').stringify({
                                    campaign: card.campaignId,
                                    card: card.id,
                                    experience: meta.experience,
                                    container: meta.container,
                                    placement: meta.placement,
                                    host: 'reelcontent.com',
                                    hostApp: meta.hostApp,
                                    network: meta.network,
                                    sessionId: meta.reqUuid,
                                    extSessionId: meta.uuid,
                                    branding: meta.branding,
                                    ex: meta.ex,
                                    vr: meta.vr,
                                    event: item.event
                                }) + '&d={delay}&cb={cachebreaker}'];

                                return campaign;
                            }, {}));
                        });
                    });

                    describe('if there is no origin', function() {
                        beforeEach(function() {
                            result = undefined;
                            card = JSON.parse(JSON.stringify(originalCard));
                            originalCard = JSON.parse(JSON.stringify(card));

                            delete meta.origin;

                            result = loader.__addTrackingPixels__(card, meta);
                        });

                        it('should return the card', function() {
                            expect(result).toBe(card);
                        });

                        it('should not set the host param', function() {
                            [
                                { prop: 'bufferUrls', event: 'buffer' },
                                { prop: 'viewUrls', event: 'cardView' },
                                { prop: 'playUrls', event: 'play' },
                                { prop: 'loadUrls', event: 'load' },
                                { prop: 'launchUrls', event: 'launch' },
                                { prop: 'countUrls', event: 'completedView' },
                                { prop: 'q1Urls', event: 'q1' },
                                { prop: 'q2Urls', event: 'q2' },
                                { prop: 'q3Urls', event: 'q3' },
                                { prop: 'q4Urls', event: 'q4' }
                            ].forEach(function(item) {
                                var urls = card.campaign[item.prop];

                                expect(card.campaign[item.prop][card.campaign[item.prop].length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                    campaign: card.campaignId,
                                    card: card.id,
                                    experience: meta.experience,
                                    container: meta.container,
                                    placement: meta.placement,
                                    host: undefined,
                                    hostApp: meta.hostApp,
                                    network: meta.network,
                                    sessionId: meta.reqUuid,
                                    extSessionId: meta.uuid,
                                    branding: meta.branding,
                                    ex: meta.ex,
                                    vr: meta.vr,
                                    event: item.event
                                }) + '&d={delay}&cb={cachebreaker}');
                            });

                            Object.keys(card.links).forEach(function(type) {
                                expect(card.links[type].tracking[card.links[type].tracking.length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                    campaign: card.campaignId,
                                    card: card.id,
                                    experience: meta.experience,
                                    container: meta.container,
                                    placement: meta.placement,
                                    host: undefined,
                                    hostApp: meta.hostApp,
                                    network: meta.network,
                                    sessionId: meta.reqUuid,
                                    extSessionId: meta.uuid,
                                    branding: meta.branding,
                                    ex: meta.ex,
                                    vr: meta.vr,
                                    event: 'link.' + type
                                }) + '&d={delay}&cb={cachebreaker}');
                            });

                            Object.keys(card.shareLinks).forEach(function(type) {
                                expect(card.shareLinks[type].tracking[card.shareLinks[type].tracking.length - 1]).toBe(loader.trackingPixel + '?' + require('querystring').stringify({
                                    campaign: card.campaignId,
                                    card: card.id,
                                    experience: meta.experience,
                                    container: meta.container,
                                    placement: meta.placement,
                                    host: undefined,
                                    hostApp: meta.hostApp,
                                    network: meta.network,
                                    sessionId: meta.reqUuid,
                                    extSessionId: meta.uuid,
                                    branding: meta.branding,
                                    ex: meta.ex,
                                    vr: meta.vr,
                                    event: 'shareLink.' + type
                                }) + '&d={delay}&cb={cachebreaker}');
                            });
                        });
                    });

                    describe('if the card has no links or shareLinks', function() {
                        beforeEach(function() {
                            result = undefined;
                            card = JSON.parse(JSON.stringify(originalCard));
                            originalCard = JSON.parse(JSON.stringify(card));

                            delete card.links;
                            delete card.shareLinks;

                            result = loader.__addTrackingPixels__(card, meta);
                        });

                        it('should return the card', function() {
                            expect(result).toBe(card);
                        });

                        it('should give the card links and shareLinks', function() {
                            expect(card.links).toEqual({});
                            expect(card.shareLinks).toEqual({});
                        });
                    });

                    describe('if meta.preview is true', function() {
                        beforeEach(function() {
                            result = undefined;
                            card = JSON.parse(JSON.stringify(originalCard));
                            originalCard = JSON.parse(JSON.stringify(card));

                            meta.preview = true;

                            result = loader.__addTrackingPixels__(card, meta);
                        });

                        it('should return the card', function() {
                            expect(result).toBe(card);
                        });

                        it('should not mutate the card', function() {
                            expect(card).toEqual(originalCard);
                        });
                    });

                    describe('if there is no trackingPixel', function() {
                        beforeEach(function() {
                            result = undefined;
                            card = JSON.parse(JSON.stringify(originalCard));
                            originalCard = JSON.parse(JSON.stringify(card));

                            loader.trackingPixel = null;

                            result = loader.__addTrackingPixels__(card, meta);
                        });

                        it('should return the card', function() {
                            expect(result).toBe(card);
                        });

                        it('should not mutate the card', function() {
                            expect(card).toEqual(originalCard);
                        });
                    });
                });

                describe('__getCard__(id, params, origin, uuid)', function() {
                    var id, params, origin, uuid;
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
                        origin = 'https://my-site.com/';
                        uuid = 'ry398r4y9';

                        jasmine.clock().uninstall();

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        result = loader.__getCard__(id, params, origin, uuid);
                        result.then(success, failure);
                        process.nextTick(done);
                    });

                    afterEach(function() {
                        jasmine.clock().install();
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
                            json: true,
                            headers: { origin: origin }
                        });
                    });

                    describe('if the request succeeds', function() {
                        var card;

                        beforeEach(function(done) {
                            card = {
                                id: 'rc-2b68a445c20317',
                                modules: [],
                                type: 'adUnit',
                                data: {}
                            };

                            requestDeferreds[request.get.calls.mostRecent().args[0]].resolve(card);
                            setTimeout(done);
                        });

                        it('should fulfill with the card', function() {
                            expect(success).toHaveBeenCalledWith(card);
                        });

                        it('should not log an error', function() {
                            expect(log.error).not.toHaveBeenCalled();
                        });
                    });

                    describe('if something else goes wrong in request', function() {
                        var error;

                        beforeEach(function(done) {
                            error = new Error('Error: BLEH');
                            error.name = 'RequestError';
                            error.cause = new Error('BLEH');
                            error.cause.code = 'EBLEH';

                            requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                            setTimeout(done);
                        });

                        it('should reject', function() {
                            expect(failure).toHaveBeenCalledWith(error);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });

                    [400, 409, 404].forEach(function(status) {
                        describe('if the upstream server responds with a ' + status, function() {
                            var error;

                            beforeEach(function(done) {
                                error = new Error(status + ' - The page could not be loaded.');
                                error.name = 'StatusCodeError';
                                error.statusCode = status;

                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                                setTimeout(done);
                            });

                            it('should reject with the reason', function() {
                                expect(failure).toHaveBeenCalledWith(error);
                            });

                            it('should not log an error', function() {
                                expect(log.error).not.toHaveBeenCalled();
                            });
                        });
                    });

                    [500, 502, 510].forEach(function(status) {
                        describe('if the upstream server responds with a ' + status, function() {
                            var error;

                            beforeEach(function(done) {
                                error = new Error(status + ' - The page could not be loaded.');
                                error.name = 'StatusCodeError';
                                error.statusCode = status;

                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                                setTimeout(done);
                            });

                            it('should reject with the reason', function() {
                                expect(failure).toHaveBeenCalledWith(error);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });
                        });
                    });

                    describe('if there is some unknown error', function() {
                        var error;

                        beforeEach(function(done) {
                            error = new SyntaxError('You can\'t type.');

                            requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                            setTimeout(done);
                        });

                        it('should reject', function() {
                            expect(failure).toHaveBeenCalledWith(error);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });
                });

                describe('__findCards__(campaign, params, amount, origin, uuid)', function() {
                    var campaign, params, amount, origin, uuid;
                    var success, failure;
                    var result;

                    beforeEach(function(done) {
                        campaign = 'cam-a4e4829f18f5fd';
                        params = {
                            container: 'pocketmath',
                            hostApp: 'My Talking Tom',
                            network: 'MoPub',
                            experience: 'e-a29116c67021f9',
                            pageUrl: 'http://www.cinema6.com/'
                        };
                        amount = 3;
                        origin = 'https://awesome-pub.com/';
                        uuid = '3ryuf3987yr';

                        jasmine.clock().uninstall();

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        result = loader.__findCards__(campaign, params, amount, origin, uuid);
                        result.then(success, failure);

                        process.nextTick(done);
                    });

                    afterEach(function() {
                        jasmine.clock().install();
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should make a request for the cards', function() {
                        expect(request.get).toHaveBeenCalledWith(resolveURL(loader.envRoot, loader.cardEndpoint), {
                            qs: {
                                container: 'pocketmath',
                                hostApp: 'My Talking Tom',
                                network: 'MoPub',
                                experience: 'e-a29116c67021f9',
                                pageUrl: 'http://www.cinema6.com/',
                                campaign: campaign,
                                random: true,
                                limit: amount
                            },
                            headers: { origin: origin },
                            json: true
                        });
                    });

                    describe('if something else goes wrong in request', function() {
                        var error;

                        beforeEach(function(done) {
                            error = new Error('Error: BLEH');
                            error.name = 'RequestError';
                            error.cause = new Error('BLEH');
                            error.cause.code = 'EBLEH';

                            requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                            setTimeout(done);
                        });

                        it('should reject', function() {
                            expect(failure).toHaveBeenCalledWith(error);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });

                    [400, 409, 404].forEach(function(status) {
                        describe('if the upstream server responds with a ' + status, function() {
                            var error;

                            beforeEach(function(done) {
                                error = new Error(status + ' - The page could not be loaded.');
                                error.name = 'StatusCodeError';
                                error.statusCode = status;

                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                                setTimeout(done);
                            });

                            it('should reject with the reason', function() {
                                expect(failure).toHaveBeenCalledWith(error);
                            });

                            it('should not log an error', function() {
                                expect(log.error).not.toHaveBeenCalled();
                            });
                        });
                    });

                    [500, 502, 510].forEach(function(status) {
                        describe('if the upstream server responds with a ' + status, function() {
                            var error;

                            beforeEach(function(done) {
                                error = new Error(status + ' - The page could not be loaded.');
                                error.name = 'StatusCodeError';
                                error.statusCode = status;

                                requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                                setTimeout(done);
                            });

                            it('should reject with the reason', function() {
                                expect(failure).toHaveBeenCalledWith(error);
                            });

                            it('should log an error', function() {
                                expect(log.error).toHaveBeenCalled();
                            });
                        });
                    });

                    describe('if there is some unknown error', function() {
                        var error;

                        beforeEach(function(done) {
                            error = new SyntaxError('You can\'t type.');

                            requestDeferreds[request.get.calls.mostRecent().args[0]].reject(error);
                            setTimeout(done);
                        });

                        it('should reject', function() {
                            expect(failure).toHaveBeenCalledWith(error);
                        });

                        it('should log an error', function() {
                            expect(log.error).toHaveBeenCalled();
                        });
                    });

                    describe('when the request succeeds', function() {
                        var cards;

                        beforeEach(function(done) {
                            cards = [undefined, undefined, undefined].map(function(value, index) {
                                return { id: 'rc-' + index, data: {} };
                            });

                            requestDeferreds[request.get.calls.mostRecent().args[0]].resolve(cards);
                            result.finally(done);
                        });

                        it('should fulfill with the cards', function() {
                            expect(success).toHaveBeenCalledWith(cards);
                        });
                    });

                    describe('if the amount is 0', function() {
                        beforeEach(function(done) {
                            request.get.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            amount = 0;
                            loader.__findCards__(campaign, params, amount, uuid).then(success, failure).finally(done);
                        });

                        it('should not make a request', function() {
                            expect(request.get).not.toHaveBeenCalled();
                        });

                        it('should fulfill with an empty array', function() {
                            expect(success).toHaveBeenCalledWith([]);
                        });
                    });
                });
            });
        });

        describe('@public', function() {
            describe('properties:', function() {
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

                describe('trackingPixel', function() {
                    it('should be the provided trackingPixel', function() {
                        expect(loader.trackingPixel).toBe(config.trackingPixel);
                    });
                });
            });

            describe('methods:', function() {
                describe('fillPlaceholders(experience, campaign, meta, uuid)', function() {
                    var experience, campaign, meta, uuid;
                    var success, failure;
                    var findCardsDeferred;

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
                                preview: false,
                                placement: 'pl-fb664dc7936ca5'
                            }
                        };
                        campaign = 'cam-74cfe164c53fc9';
                        meta = {
                            origin: 'https://reelcontent.com/'
                        };
                        uuid = 'fj829rhf849';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        findCardsDeferred = q.defer();
                        spyOn(loader, '__findCards__').and.returnValue(findCardsDeferred.promise);

                        loader.fillPlaceholders(experience, campaign, meta, uuid).then(success, failure);
                    });

                    it('should find cards for each placeholder', function() {
                        expect(loader.__findCards__).toHaveBeenCalledWith(campaign, {}, 3, meta.origin, uuid);
                    });

                    describe('if getting cards succeeds', function() {
                        var cards;
                        var originalDeck;

                        beforeEach(function(done) {
                            cards = [
                                {
                                    campaignId: campaign,
                                    id: 'rc-3fef9cb732c596',
                                    type: 'youtube',
                                    data: {}
                                },
                                {
                                    campaignId: campaign,
                                    type: 'youtube',
                                    id: experience.data.deck[3].id, // Simulate ADTECH loading a card that is already in the MR
                                    data: {}
                                },
                                {
                                    campaignId: campaign,
                                    type: 'youtube',
                                    id: 'rc-822dfc305faa57',
                                    data: {}
                                }
                            ];

                            originalDeck = experience.data.deck.slice();

                            spyOn(AdLoader, 'removePlaceholders').and.callThrough();
                            spyOn(loader, '__addTrackingPixels__').and.callThrough();

                            findCardsDeferred.fulfill(cards);
                            findCardsDeferred.promise.finally(done);
                        });

                        it('should add tracking pixels to the sponsored cards', function() {
                            expect(loader.__addTrackingPixels__.calls.count()).toBe(2);
                            expect(loader.__addTrackingPixels__).toHaveBeenCalledWith(cards[0], extend({ experience: experience.id }, meta));
                            expect(loader.__addTrackingPixels__).toHaveBeenCalledWith(cards[2], extend({ experience: experience.id }, meta));
                        });

                        it('should replace the wildcard placeholders with actual sponsored cards', function() {
                            expect(experience.data.deck).toEqual([
                                cards[0],
                                originalDeck[1],
                                cards[2]
                            ].concat(originalDeck.slice(3).filter(function(card) {
                                return card.type !== 'wildcard';
                            })));
                        });

                        it('should removePlaceholders() from the deck', function() {
                            expect(AdLoader.removePlaceholders).toHaveBeenCalledWith(experience);
                        });

                        it('should fulfill with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });
                });

                describe('loadAds(experience, campaignId, meta, uuid)', function() {
                    var experience, campaignId, meta, uuid;
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
                        campaignId = 'cam-19849e91e5e46b';
                        meta = {
                            origin: 'https://facebook.com/'
                        };
                        uuid = 'ufr8934yr849';

                        spyOn(loader, 'fillPlaceholders').and.callFake(function(experience) {
                            return q(experience);
                        });

                        result = loader.loadAds(experience, campaignId, meta, uuid);
                        result.then(success, failure);

                        result.finally(done);
                    });

                    it('should fill the experience\'s placeholders', function() {
                        expect(loader.fillPlaceholders).toHaveBeenCalledWith(experience, campaignId, meta, uuid);
                    });

                    it('should fulfill with the experience', function() {
                        expect(success).toHaveBeenCalledWith(experience);
                    });

                    describe('if the experience has no ads', function() {
                        beforeEach(function(done) {
                            delete experience.data.wildCardPlacement;
                            experience.data.deck = experience.data.deck.filter(function(card) {
                                return !(card.type === 'wildcard' || typeof card.campaignId === 'string');
                            });
                            loader.fillPlaceholders.calls.reset();
                            success.calls.reset();
                            failure.calls.reset();

                            loader.loadAds(experience, campaignId, meta, uuid).then(success, failure).finally(done);
                        });

                        it('should not fill the placeholders', function() {
                            expect(loader.fillPlaceholders).not.toHaveBeenCalled();
                        });

                        it('should fulfill the promise with the experience', function() {
                            expect(success).toHaveBeenCalledWith(experience);
                        });
                    });
                });

                describe('findCard(campaign, context, meta, uuid)', function() {
                    var campaign, context, meta, uuid;
                    var findCardsDeferred;
                    var success, failure;

                    beforeEach(function() {
                        campaign = 'cam-22c20fc774788d';
                        context = {
                            container: 'pocketmath',
                            hostApp: 'Ruzzle',
                            network: 'mopub',
                            pageUrl: 'cinema6.com',
                            experience: 'e-58e475ab5f932b',
                            preview: true
                        };
                        meta = {
                            origin: 'https://digitaljournal.com/'
                        };
                        uuid = '894yr9hfu943';

                        findCardsDeferred = q.defer();

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        spyOn(loader, '__findCards__').and.returnValue(findCardsDeferred.promise);

                        loader.findCard(campaign, context, meta, uuid).then(success, failure);
                    });

                    it('should find a single card', function() {
                        expect(loader.__findCards__).toHaveBeenCalledWith(campaign, context, 1, meta.origin, uuid);
                    });

                    describe('if no card is found', function() {
                        beforeEach(function(done) {
                            findCardsDeferred.fulfill([]);

                            process.nextTick(done);
                        });

                        it('should fulfill with null', function() {
                            expect(success).toHaveBeenCalledWith(null);
                        });
                    });

                    describe('if a card is found', function() {
                        var card;

                        beforeEach(function(done) {
                            card = {
                                campaignId: '39485789345',
                                id: 'rc-d1812b837e9752',
                                type: 'youtube',
                                data: {}
                            };

                            spyOn(loader, '__addTrackingPixels__').and.callThrough();

                            findCardsDeferred.fulfill([card]);
                            process.nextTick(done);
                        });

                        it('should add tracking pixels', function() {
                            expect(loader.__addTrackingPixels__).toHaveBeenCalledWith(card, meta);
                        });

                        it('should be fulfilled with the card', function() {
                            expect(success).toHaveBeenCalledWith(card);
                        });
                    });
                });

                describe('getCard(id, params, meta, uuid)', function() {
                    var id, params, meta, uuid;
                    var getCardDeferred;
                    var success, failure;

                    beforeEach(function() {
                        id = 'rc-a12831fe0ab18a';
                        params = {
                            container: 'pocketmath',
                            hostApp: 'Ruzzle',
                            network: 'mopub',
                            pageUrl: 'cinema6.com',
                            experience: 'e-58e475ab5f932b',
                            preview: false
                        };
                        meta = {
                            origin: 'http://worldlifestyle.com/'
                        };
                        uuid = '8urhdf9348hf934';

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        getCardDeferred = q.defer();
                        spyOn(loader, '__getCard__').and.returnValue(getCardDeferred.promise);

                        loader.getCard(id, params, meta, uuid).then(success, failure);
                    });

                    it('should get the card from the content service', function() {
                        expect(loader.__getCard__).toHaveBeenCalledWith(id, params, meta.origin, uuid);
                    });

                    describe('when the card is fetched', function() {
                        var card;

                        beforeEach(function(done) {
                            card = {
                                id: 'rc-24c019f713fc51',
                                data: {},
                                campaign: {}
                            };

                            spyOn(loader, '__addTrackingPixels__').and.callThrough();

                            getCardDeferred.fulfill(card);
                            process.nextTick(done);
                        });

                        it('should add tracking pixels to the card', function() {
                            expect(loader.__addTrackingPixels__).toHaveBeenCalledWith(card, meta);
                        });

                        it('should fulfill with the card', function() {
                            expect(success).toHaveBeenCalledWith(card);
                        });
                    });

                    describe('when fetching the card fails', function() {
                        var reason;

                        beforeEach(function(done) {
                            reason = new Error('Couldn\'t find that one.');
                            getCardDeferred.reject(reason);

                            process.nextTick(done);
                        });

                        it('should reject the promise', function() {
                            expect(failure).toHaveBeenCalledWith(reason);
                        });
                    });

                    describe('if preview is true', function() {
                        var card;

                        beforeEach(function(done) {
                            loader.__getCard__.calls.reset();

                            card = {
                                id: 'rc-24c019f713fc51',
                                data: {},
                                campaign: {}
                            };
                            loader.__getCard__.and.returnValue(q.when(card));
                            spyOn(AdLoader.prototype, '__getCard__').and.returnValue(q.when(card));
                            spyOn(loader, '__addTrackingPixels__').and.callThrough();

                            params.preview = true;

                            loader.getCard(id, params, meta, uuid).then(success, failure).finally(done);
                        });

                        it('should get the card without caching', function() {
                            expect(AdLoader.prototype.__getCard__).toHaveBeenCalledWith(id, params, meta.origin, uuid);
                            expect(AdLoader.prototype.__getCard__.calls.mostRecent().object).toBe(loader);
                            expect(loader.__getCard__).not.toHaveBeenCalled();
                        });

                        it('should add tracking pixels to the card', function() {
                            expect(loader.__addTrackingPixels__).toHaveBeenCalledWith(card, meta);
                        });

                        it('should fulfill with the card', function() {
                            expect(success).toHaveBeenCalledWith(card);
                        });
                    });
                });
            });
        });
    });
});
