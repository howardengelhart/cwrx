describe('collateralScrape-scraper (UT)', function() {
    var q, logger, util;
    var spidey, mockLog, request;
    var requestDeferreds;
    var collateralScrape;

    beforeAll(function() {
        for (var m in require.cache){ delete require.cache[m]; }

        require('spidey.js');
        require('request-promise');
    });

    beforeEach(function() {
        q = require('q');
        logger = require('../../lib/logger');
        util = require('util');

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'getLog').and.returnValue(mockLog);

        spidey = spyOn(require.cache[require.resolve('spidey.js')], 'exports');

        requestDeferreds = {};
        spyOn(require('request-promise'), 'defaults').and.returnValue(jasmine.createSpy('request()').and.callFake(function(uri) {
            return (requestDeferreds[uri] = q.defer()).promise;
        }));

        delete require.cache[require.resolve('../../bin/collateral-scrape')];
        collateralScrape  = require('../../bin/collateral-scrape');

        request = require('request-promise').defaults.calls.mostRecent().returnValue;
        expect(require('request-promise').defaults).toHaveBeenCalledWith({ json: true });
    });

    describe('parseProductURI(uri)', function() {
        var uri;

        describe('with no uri', function() {
            it('should throw an Error', function() {
                expect(function() { collateralScrape.parseProductURI(uri); }).toThrow(new Error('URI is required.'));
                try {
                    collateralScrape.parseProductURI(uri);
                } catch (error) {
                    expect(error.code).toBe('EINVAL');
                }
            });
        });

        describe('with an App Store URI', function() {
            beforeEach(function() {
                uri = 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8';
            });

            it('should return an object with the extracted data of the URL', function() {
                expect(collateralScrape.parseProductURI(uri)).toEqual({
                    type: 'APP_STORE',
                    id: '284882215'
                });
            });

            describe('without an ID', function() {
                beforeEach(function() {
                    uri = 'https://itunes.apple.com/us/app/facebook/';
                });

                it('should throw an Error', function() {
                    expect(function() { collateralScrape.parseProductURI(uri); }).toThrow(new Error('URI has no ID.'));
                    try {
                        collateralScrape.parseProductURI(uri);
                    } catch (error) {
                        expect(error.code).toBe('EINVAL');
                    }
                });
            });
        });

        describe('with an unknown URI', function() {
            beforeEach(function() {
                uri = 'https://platform.reelcontent.com/#/apps/selfie/campaigns/manage/cam-0aa4RF01oA3YFaI9/manage';
            });

            it('should throw an Error', function() {
                expect(function() { collateralScrape.parseProductURI(uri); }).toThrow(new Error('URI is not from a valid platform.'));
                try {
                    collateralScrape.parseProductURI(uri);
                } catch (error) {
                    expect(error.code).toBe('EINVAL');
                }
            });
        });

        describe('with not-a-url', function() {
            beforeEach(function() {
                uri = 'jkdhsfeirhfui';
            });

            it('should throw an Error', function() {
                expect(function() { collateralScrape.parseProductURI(uri); }).toThrow(new Error('URI is invalid.'));
                try {
                    collateralScrape.parseProductURI(uri);
                } catch (error) {
                    expect(error.code).toBe('EINVAL');
                }
            });
        });
    });

    describe('getProductData(req, config)', function() {
        var req, config;
        var success, failure;
        var productDataDeferred;

        beforeEach(function(done) {
            req = {
                user: { id: 'u-0507ebe9b5dc5d' },
                requester: { id: 'u-0507ebe9b5dc5d', permissions: {} },
                body: null,
                query: {
                    uri: 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8'
                },
                uuid: 'uieyrf7834rg'
            };

            config = {};

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            spyOn(collateralScrape, 'parseProductURI').and.returnValue({
                type: 'APP_STORE',
                id: '7584395748'
            });

            spyOn(collateralScrape.productDataFrom, 'APP_STORE').and.returnValue((productDataDeferred = q.defer()).promise);

            collateralScrape.getProductData(req, config).then(success, failure);
            process.nextTick(done);
        });

        it('should parse the given URI', function() {
            expect(collateralScrape.parseProductURI).toHaveBeenCalledWith(req.query.uri);
        });

        it('should get product data from the correct place', function() {
            expect(collateralScrape.productDataFrom.APP_STORE).toHaveBeenCalledWith(collateralScrape.parseProductURI.calls.mostRecent().returnValue.id);
        });

        describe('if getting the data succeeds', function() {
            var data;

            beforeEach(function(done) {
                data = {
                    type: 'app',
                    platform: 'iOS',
                    name: 'My App',
                    description: 'This is the best app in the world!',
                    uri: 'https://itunes.apple.com/us/app/facebook/id284882215?mt=8',
                    category: 'Social',
                    price: 'Free',
                    extID: '284882215',
                    images: []
                };

                productDataDeferred.fulfill(data);
                process.nextTick(done);
            });

            it('should fulfill with that data', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 200,
                    body: data
                }));
            });
        });

        describe('if getting the data fails', function() {
            var reason;

            describe('because the URI is invalid', function() {
                beforeEach(function(done) {
                    reason = new Error('URI is invalid.');
                    reason.code = 'EINVAL';

                    productDataDeferred.reject(reason);
                    process.nextTick(done);
                });

                it('should fulfill with a failing ServiceResponse', function() {
                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        code: 400,
                        body: reason.message
                    }));
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });
            });

            describe('because the app cannot be found', function() {
                beforeEach(function(done) {
                    reason = new Error('No app found with that ID.');
                    reason.code = 'ENOTFOUND';

                    productDataDeferred.reject(reason);
                    process.nextTick(done);
                });

                it('should fulfill with a failing ServiceResponse', function() {
                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        code: 404,
                        body: reason.message
                    }));
                });

                it('should not log an error', function() {
                    expect(mockLog.error).not.toHaveBeenCalled();
                });
            });

            describe('for some other reason', function() {
                beforeEach(function(done) {
                    reason = new SyntaxError('I suck at coding.');

                    productDataDeferred.reject(reason);
                    process.nextTick(done);
                });

                it('should fulfill with a failing ServiceResponse', function() {
                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        code: 500,
                        body: reason.message
                    }));
                });

                it('should log an error', function() {
                    expect(mockLog.error).toHaveBeenCalled();
                });
            });
        });
    });

    describe('productDataFrom', function() {
        describe('APP_STORE(id)', function() {
            var id;
            var success, failure;

            beforeEach(function(done) {
                id = '48357348957';

                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                collateralScrape.productDataFrom.APP_STORE(id).then(success, failure);
                process.nextTick(done);
            });

            it('should make a request to the App Store API', function() {
                expect(request).toHaveBeenCalledWith('https://itunes.apple.com/lookup?id=' + id);
            });

            describe('if the request succeeds', function() {
                var response;

                beforeEach(function(done) {
                    response = {
                        "resultCount": 1,
                        "results": [
                            {
                                "artworkUrl512": "http://is2.mzstatic.com/image/thumb/Purple49/v4/12/ad/a1/12ada118-67b6-6296-fe53-ae62fa5e4156/source/512x512bb.jpg",
                                "screenshotUrls": [
                                    "http://a1.mzstatic.com/us/r30/Purple69/v4/af/c4/ef/afc4efaa-b23d-0f42-9c9c-011a86ad5e7d/screen1136x1136.jpeg",
                                    "http://a4.mzstatic.com/us/r30/Purple49/v4/5f/fb/01/5ffb01ac-a7d8-9467-69c3-067b53bbd9d5/screen1136x1136.jpeg",
                                    "http://a4.mzstatic.com/us/r30/Purple49/v4/dd/c4/a0/ddc4a006-a974-e505-6eda-1b8472f0edaa/screen1136x1136.jpeg",
                                    "http://a5.mzstatic.com/us/r30/Purple69/v4/42/0a/e8/420ae8f2-3316-4cce-a67f-7dd843a5f041/screen1136x1136.jpeg",
                                    "http://a3.mzstatic.com/us/r30/Purple49/v4/d3/7e/43/d37e43a8-b74b-ce69-0491-e89ca1505c5a/screen1136x1136.jpeg"
                                ],
                                "ipadScreenshotUrls": [
                                    "http://a1.mzstatic.com/us/r30/Purple69/v4/0d/7b/f6/0d7bf6a2-375a-6a36-8a02-adca474c7caa/screen480x480.jpeg",
                                    "http://a2.mzstatic.com/us/r30/Purple49/v4/da/80/a2/da80a2f3-3ac3-cdbf-4e75-f36b80c8e17f/screen480x480.jpeg",
                                    "http://a1.mzstatic.com/us/r30/Purple49/v4/95/bc/62/95bc62e8-f428-246c-fea4-095fc714108f/screen480x480.jpeg",
                                    "http://a5.mzstatic.com/us/r30/Purple49/v4/a1/35/f8/a135f868-5df0-4bf9-0282-ed8a4120ab52/screen480x480.jpeg",
                                    "http://a2.mzstatic.com/us/r30/Purple49/v4/e6/dd/f9/e6ddf9ce-05c6-3ad0-2541-1d823329a714/screen480x480.jpeg"
                                ],
                                "artistViewUrl": "https://itunes.apple.com/us/developer/sega/id281966698?mt=8&uo=4",
                                "artworkUrl60": "http://is2.mzstatic.com/image/thumb/Purple49/v4/12/ad/a1/12ada118-67b6-6296-fe53-ae62fa5e4156/source/60x60bb.jpg",
                                "artworkUrl100": "http://is2.mzstatic.com/image/thumb/Purple49/v4/12/ad/a1/12ada118-67b6-6296-fe53-ae62fa5e4156/source/100x100bb.jpg",
                                "kind": "software",
                                "features": ["iosUniversal"],
                                "supportedDevices": [
                                    "iPad2Wifi",
                                    "iPad23G",
                                    "iPhone4S",
                                    "iPadThirdGen",
                                    "iPadThirdGen4G",
                                    "iPhone5",
                                    "iPodTouchFifthGen",
                                    "iPadFourthGen",
                                    "iPadFourthGen4G",
                                    "iPadMini",
                                    "iPadMini4G",
                                    "iPhone5c",
                                    "iPhone5s",
                                    "iPhone6",
                                    "iPhone6Plus",
                                    "iPodTouchSixthGen"
                                ],
                                "advisories": ["Infrequent/Mild Realistic Violence"],
                                "isGameCenterEnabled": false,
                                "languageCodesISO2A": ["EN"],
                                "fileSizeBytes": "359378784",
                                "sellerUrl": "http://www.totalwar.com/kingdom",
                                "averageUserRatingForCurrentVersion": 4.0,
                                "userRatingCountForCurrentVersion": 510,
                                "trackContentRating": "12+",
                                "trackCensoredName": "Total War Battles: KINGDOM",
                                "trackViewUrl": "https://itunes.apple.com/us/app/total-war-battles-kingdom/id992140314?mt=8&uo=4",
                                "contentAdvisoryRating": "12+",
                                "currency": "USD",
                                "wrapperType": "software",
                                "version": "1.0",
                                "bundleId": "com.sega.twbkingdom",
                                "artistId": 281966698,
                                "artistName": "SEGA",
                                "genres": ["Games", "Strategy", "Action"],
                                "price": 0.00,
                                "description": "Shape the land, build sprawling towns and recruit and train a powerful army. \nConquer new territories to expand your realm and defeat rival lords and other players in epic real-time battles. \n\nPlease note that iPhone 4s, iPad 2, iPad 3 and iPad mini 1 are not supported.\n\nFEATURES\n• Build and expand your Kingdom, with farms, quarries, blacksmiths and more.\n• Alter the land by creating rivers, lakes and mountains.\n• Command your army in large-scale battles.\n• Battle other players in real-time.\n• Cross-Platform - Play on Phones, Tablet, and PC, whenever you want, wherever you want. Actions in your Kingdom will carry over onto any device you play on.\n• From the creators of the award-winning Total War™ games.\n\nREQUIREMENTS\n• 4th generation iPad or above\n• iPad mini 2 or above\n• iPhone 5 or above\n• iPod Touch 6th generation or above\n• iOS 8 or above\n• An internet connection\n\n\nNEWS\nLike us on Facebook: https://www.facebook.com/totalwarbattles\nFollow us on Twitter: https://twitter.com/TotalWarBattles\nFollow us on Instagram: https://www.instagram.com/totalwarbattles\n\n\nPLEASE NOTE\nTotal War Battles: KINGDOM is free to download and play.\n\nAdditional Gold can be purchased using real money. More information on in-app purchases is available here: http://wiki.totalwar.com/w/Total_War_Battles_Kingdom_Information\n\nIf you do not want to use this feature, please disable in-app purchases in your device’s settings. Also, under our Terms of Service and Privacy Policy, you must be at least 13 years of age to play or download Total War Battles: KINGDOM.\n\n\n- - - - -\nEULA: http://www.sega.co.uk/Mobile_EULA\nTerms of Service: http://www.sega.co.uk/Account-Terms-of-Service\nPrivacy Policy: http://www.sega.co.uk/mprivacy\n\n© SEGA. Creative Assembly, the Creative Assembly logo, Total War, Total War Battles: Kingdom and the Total War Battles logo are either registered trademarks or trademarks of The Creative Assembly Limited. SEGA and the SEGA logo are either registered trademarks or trademarks of SEGA Holdings Co., Ltd. or its affiliates. All rights reserved. SEGA is registered in the U.S. Patent and Trademark Office. All other trademarks, logos and copyrights are property of their respective owners.",
                                "trackName": "Total War Battles: KINGDOM",
                                "trackId": 992140314,
                                "releaseDate": "2016-03-21T15:05:58Z",
                                "primaryGenreName": "Games",
                                "isVppDeviceBasedLicensingEnabled": true,
                                "minimumOsVersion": "8.0",
                                "currentVersionReleaseDate": "2016-03-21T15:05:58Z",
                                "releaseNotes": "* Unexpected flooding should happen less often\n* The Advisor now gives additional guidance on water management\n* Unit balancing has been adjusted\n* Economy, Quests, and Masters have been rebalanced\n* Further UI improvements\n* Many smaller bug fixes and stability improvements",
                                "sellerName": "Sega America",
                                "primaryGenreId": 6014,
                                "genreIds": ["6014", "7017", "7001"],
                                "formattedPrice": "Free",
                                "averageUserRating": 4.0,
                                "userRatingCount": 510
                            }
                        ]
                    };

                    requestDeferreds[request.calls.mostRecent().args[0]].fulfill(response);
                    process.nextTick(done);
                });

                it('should fulfill with some data', function() {
                    expect(success).toHaveBeenCalledWith({
                        type: 'app',
                        platform: 'iOS',
                        name: response.results[0].trackCensoredName,
                        description: response.results[0].description,
                        uri: response.results[0].trackViewUrl,
                        category: response.results[0].primaryGenreName,
                        price: response.results[0].formattedPrice,
                        extID: response.results[0].trackId,
                        images: [].concat(
                            response.results[0].screenshotUrls.map(function(uri) {
                                return {
                                    uri: uri,
                                    type: 'screenshot',
                                    device: 'phone'
                                };
                            }),
                            response.results[0].ipadScreenshotUrls.map(function(uri) {
                                return {
                                    uri: uri,
                                    type: 'screenshot',
                                    device: 'tablet'
                                };
                            }),
                            [
                                {
                                    uri: response.results[0].artworkUrl512,
                                    type: 'thumbnail'
                                }
                            ]
                        )
                    });
                });
            });

            describe('if nothing is found', function() {
                beforeEach(function(done) {
                    response = {
                        "resultCount": 0,
                        "results": []
                    };

                    requestDeferreds[request.calls.mostRecent().args[0]].fulfill(response);
                    process.nextTick(done);
                });

                it('should reject the Promise', function() {
                    expect(failure).toHaveBeenCalledWith(new Error('No app found with that ID.'));
                    expect(failure.calls.mostRecent().args[0].code).toBe('ENOTFOUND');
                });
            });

            describe('if the store item is not an app', function() {
                beforeEach(function(done) {
                    response = {
                        "resultCount": 1,
                        "results": [{
                            "wrapperType": "collection",
                            "collectionType": "Album",
                            "artistId": 973181994,
                            "collectionId": 1087172327,
                            "artistName": "ZAYN",
                            "collectionName": "Mind of Mine (Deluxe Edition)",
                            "collectionCensoredName": "Mind of Mine (Deluxe Edition)",
                            "artistViewUrl": "https://itunes.apple.com/us/artist/zayn/id973181994?uo=4",
                            "collectionViewUrl": "https://itunes.apple.com/us/album/mind-of-mine-deluxe-edition/id1087172327?uo=4",
                            "artworkUrl60": "http://is1.mzstatic.com/image/thumb/Music69/v4/3c/a0/76/3ca076fc-c0dc-b7bd-0971-b4b8f031d7c3/source/60x60bb.jpg",
                            "artworkUrl100": "http://is1.mzstatic.com/image/thumb/Music69/v4/3c/a0/76/3ca076fc-c0dc-b7bd-0971-b4b8f031d7c3/source/100x100bb.jpg",
                            "collectionPrice": 13.99,
                            "collectionExplicitness": "explicit",
                            "contentAdvisoryRating": "Explicit",
                            "trackCount": 18,
                            "copyright": "℗ 2016 RCA Records, a division of Sony Music Entertainment",
                            "country": "USA",
                            "currency": "USD",
                            "releaseDate": "2016-03-25T07:00:00Z",
                            "primaryGenreName": "Pop"
                        }]
                    };

                    requestDeferreds[request.calls.mostRecent().args[0]].fulfill(response);
                    process.nextTick(done);
                });

                it('should reject the Promise', function() {
                    expect(failure).toHaveBeenCalledWith(new Error('URI is not for an app.'));
                    expect(failure.calls.mostRecent().args[0].code).toBe('EINVAL');
                });
            });
        });
    });

    describe('getWebsiteData(req, config)', function() {
        var req, config;
        var success, failure;
        var spideyDeferred;

        beforeEach(function(done) {
            req = {
                user: { id: 'u-0507ebe9b5dc5d' },
                requester: { id: 'u-0507ebe9b5dc5d', permissions: {} },
                body: null,
                query: {
                    uri: 'http://www.toyota.com/'
                },
                uuid: 'uieyrf7834rg'
            };

            config = {
                scraper: {
                    timeout: 5000,
                    agent: 'Reelcontent Web Scraper'
                }
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            spideyDeferred = q.defer();
            spidey.and.returnValue(spideyDeferred.promise);

            collateralScrape.getWebsiteData(req, config).then(success, failure);
            process.nextTick(done);
        });

        it('should make a request with spidey.js', function() {
            expect(spidey).toHaveBeenCalledWith(req.query.uri, {
                timeout: config.scraper.timeout,
                gzip: true,
                headers: {
                    'User-Agent': config.scraper.agent
                }
            });
        });

        describe('when the spidey() call succeeds', function() {
            var data;

            beforeEach(function(done) {
                data = {
                    links: {
                        website: 'http://www.toyota.com/',
                        facebook: 'http://www.facebook.com/toyota',
                        twitter: 'http://twitter.com/toyota',
                        instagram: 'http://instagram.com/toyotausa/',
                        youtube: 'http://www.youtube.com/user/ToyotaUSA',
                        pinterest: null,
                        google: 'https://plus.google.com/+toyotausa/',
                        tumblr: null
                    },
                    images: {
                        profile: 'https://fbcdn-profile-a.akamaihd.net/hprofile-ak-xaf1/v/t1.0-1/c124.57.712.712/s200x200/399266_10151276650434201_443074649_n.jpg?oh=e6b8cc83da86e05e312beab0daad0d95&oe=56EA86EA&__gda__=1458601243_4b4d11415406f734644c00dd8898c10f'
                    }
                };

                spideyDeferred.fulfill(data);
                process.nextTick(done);
            });

            it('should fulfill with a [200]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 200,
                    body: data
                }));
            });
        });

        describe('if the request times out', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: ETIMEDOUT');
                error.name = 'RequestError';
                error.cause = new Error('ETIMEDOUT');
                error.cause.code = 'ETIMEDOUT';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [408]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 408,
                    body: 'Timed out scraping website [' + req.query.uri + '].'
                }));
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if there is no server at that address', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: getaddrinfo ENOTFOUND');
                error.name = 'RequestError';
                error.cause = new Error('getaddrinfo ENOTFOUND');
                error.cause.code = 'ENOTFOUND';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [400]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Upstream server not found.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if something else goes wrong in request', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('Error: BLEH');
                error.name = 'RequestError';
                error.cause = new Error('BLEH');
                error.cause.code = 'EBLEH';

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a 500', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 500,
                    body: 'Unexpected error fetching website: ' + util.inspect(error)
                }));
            });

            it('should log a warning', function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if the upstream server responds with a failing status code', function() {
            var error;

            beforeEach(function(done) {
                error = new Error('404 - The page could not be found.');
                error.name = 'StatusCodeError';
                error.statusCode = 404;

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [400]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Upstream server responded with status code [404].'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if there is some unknown error', function() {
            var error;

            beforeEach(function(done) {
                error = new SyntaxError('You can\'t type.');

                spideyDeferred.reject(error);
                process.nextTick(done);
            });

            it('should fulfill with a [500]', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 500,
                    body: 'Internal error: ' + util.inspect(error)
                }));
            });

            it('should log an error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).toHaveBeenCalled();
            });
        });

        describe('if the request uri is not valid', function() {
            beforeEach(function(done) {
                spidey.and.callThrough();
                req.query.uri = 'fiurwehrfui4th';

                collateralScrape.getWebsiteData(req, config).then(success, failure).finally(done);
            });

            it('should succeed with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'URI [' + req.query.uri + '] is not valid.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });

        describe('if a request uri is not specified', function() {
            beforeEach(function(done) {
                spidey.and.callThrough();
                spidey.calls.reset();
                delete req.query.uri;

                collateralScrape.getWebsiteData(req, config).then(success, failure).finally(done);
            });

            it('should not attempt to scrape anything', function() {
                expect(spidey).not.toHaveBeenCalled();
            });

            it('should succeed with a 400', function() {
                expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                    code: 400,
                    body: 'Must specify a URI.'
                }));
            });

            it('should not log a warning or error', function() {
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            });
        });
    });
});
