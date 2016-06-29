describe('collateralScrape-scraper (UT)', function() {
    var q, logger, util, url, uuid, entities, getSymbolFromCurrency, RequestErrors;
    var spidey, mockLog, request;
    var requestDeferreds;
    var collateralScrape;

    beforeAll(function() {
        for (var m in require.cache){ delete require.cache[m]; }

        require('util');
        require('spidey.js');
        require('request-promise');
    });

    beforeEach(function() {
        var HtmlEntities = require('html-entities').AllHtmlEntities;

        q = require('q');
        logger = require('../../lib/logger');
        util = require('util');
        url = require('url');
        uuid = require('rc-uuid');
        entities = new HtmlEntities();
        getSymbolFromCurrency = require('currency-symbol-map').getSymbolFromCurrency;
        RequestErrors = require('request-promise/lib/errors');

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
            var deferred = q.defer();

            requestDeferreds[uri] = deferred;

            return deferred.promise;
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

        describe('with an Etsy URI', function() {
            beforeEach(function() {
                uri = 'https://www.etsy.com/shop/DewberryRidge?ga_order=most_relevant&ga_search_type=all&ga_view_type=gallery&ga_search_query=&ref=sc_gallery_2';
            });

            it('should return an Object with the extracted data of the URI', function() {
                expect(collateralScrape.parseProductURI(uri)).toEqual({
                    type: 'ETSY',
                    id: 'DewberryRidge'
                });
            });

            describe('on an unrelated etsy page', function() {
                beforeEach(function() {
                    uri = 'https://www.etsy.com/listing/152558536/peg-looms-30-hand-made-red-oak?ref=shop_home_listings';
                });

                it('should throw an Error', function() {
                    expect(function() { collateralScrape.parseProductURI(uri); }).toThrow(new Error('URI is not for a shop.'));
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

    describe('getProductData(req, config, secrets)', function() {
        var req, config, secrets;
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

            config = {
                etsy: {}
            };

            secrets = {
                etsyKey: 'dh398q2dh2389ry3489rt'
            };

            success = jasmine.createSpy('success()');
            failure = jasmine.createSpy('failure()');

            spyOn(collateralScrape, 'parseProductURI').and.returnValue({
                type: 'APP_STORE',
                id: '7584395748'
            });

            spyOn(collateralScrape.productDataFrom, 'APP_STORE').and.returnValue((productDataDeferred = q.defer()).promise);

            collateralScrape.getProductData(req, config, secrets).then(success, failure);
            process.nextTick(done);
        });

        it('should parse the given URI', function() {
            expect(collateralScrape.parseProductURI).toHaveBeenCalledWith(req.query.uri);
        });

        it('should get product data from the correct place', function() {
            expect(collateralScrape.productDataFrom.APP_STORE).toHaveBeenCalledWith(collateralScrape.parseProductURI.calls.mostRecent().returnValue.id, config, secrets);
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
        describe('ETSY(id, config, secrets)', function() {
            var id, config, secrets;
            var success, failure;

            beforeEach(function(done) {
                id = 'DewberryRidge';
                config = {
                    etsy: {}
                };
                secrets = {
                    etsyKey: 'du8239yrh8493r'
                };

                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                collateralScrape.productDataFrom.ETSY(id, config, secrets).then(success, failure);
                process.nextTick(done);
            });

            it('should make a request for the etsy store', function() {
                expect(request).toHaveBeenCalledWith(url.format({
                    protocol: 'https',
                    hostname: 'openapi.etsy.com',
                    pathname: '/v2/shops/' + id,
                    query: {
                        api_key: secrets.etsyKey
                    }
                }));
            });

            it('should make a request for the store\'s featured listings', function() {
                expect(request).toHaveBeenCalledWith(url.format({
                    protocol: 'https',
                    hostname: 'openapi.etsy.com',
                    pathname: '/v2/shops/' + id + '/listings/featured',
                    query: {
                        includes: 'Images',
                        api_key: secrets.etsyKey
                    }
                }));
            });

            describe('if the requests succeeds', function() {
                var shopResponse, featuredListingsResponse;

                beforeEach(function(done) {
                    shopResponse = {
                        "count": 1,
                        "results": [
                            {
                                "shop_id": 6292650,
                                "shop_name": "DewberryRidge",
                                "user_id": 10950790,
                                "creation_tsz": 1302437079,
                                "title": "Dewberry Ridge - A Fiber Art Business",
                                "announcement": "Dewberry Ridge - A Fiber Art Business -- Wearable Fiber Art and Fiber Art Tools www.dewberryridge.com",
                                "currency_code": "USD",
                                "is_vacation": false,
                                "vacation_message": null,
                                "sale_message": "Dewberry Ridge - A Fiber Art Business - Wearable Art and Fiber Art Tools www.dewberryridge.com",
                                "digital_sale_message": "Thank you for ordering one of our patterns.  We know  you will enjoy making and wearing this items.  For more patterns, visit www.dewberryridge.com",
                                "last_updated_tsz": 1460582517,
                                "listing_active_count": 22,
                                "digital_listing_count": 2,
                                "login_name": "studio21fiberart",
                                "accepts_custom_requests": false,
                                "policy_welcome": "Welcome to Dewberry Ridge - A Fiber Art Business.  All of our Wearable Fiber Art and Fiber Art Tools are hand made by our family.  We use only the highest quality fiber, woods, and embellishments when we design and manufacture our products.  \r\nWe strive to bring you a product you can be proud to wear and use.  Our goal is to always make you feel special--because you ARE special to us.",
                                "policy_payment": "PayPal is our preferred payment method.  If other arrangements are necessary, please contact us.",
                                "policy_shipping": "Products are shipped the most secure, expeditious and economical way using United States Post Office, Federal Express or UPS.  We provide shipping confirmations and insure our shipments.",
                                "policy_refunds": "Please contact us directly if you require a replacement or refund.  ",
                                "policy_additional": "Please contact us for wholesale pricing, if applicable.",
                                "policy_seller_info": null,
                                "policy_updated_tsz": 1445128160,
                                "policy_has_private_receipt_info": false,
                                "vacation_autoreply": null,
                                "url": "https://www.etsy.com/shop/DewberryRidge?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "image_url_760x100": "https://img0.etsystatic.com/000/0/0/iusb_760x100.8502736.jpg",
                                "num_favorers": 217,
                                "languages": [
                                    "en-US"
                                ],
                                "upcoming_local_event_id": null,
                                "icon_url_fullxfull": null,
                                "is_using_structured_policies": false,
                                "has_onboarded_structured_policies": false,
                                "has_unstructured_policies": true
                            }
                        ],
                        "params": {
                            "shop_id": "DewberryRidge"
                        },
                        "type": "Shop",
                        "pagination": {}
                    };

                    featuredListingsResponse = {
                        "count": 7,
                        "results": [
                            {
                                "listing_id": 153526623,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69154275,
                                "title": "Apple Key Ring / Apple Keychain / Apple Bag Charm / Teacher Thank You Gift / Apple of My Eye / Miniature Fruit",
                                "description": "Teeny red apple, handmade in sustainable, eco-friendly materials.\n\nThis cute apple has been carefully crocheted in organic cotton and is stuffed with 100% British sheep&#39;s wool.\n\nA unique and cheerful little gift for a favourite teacher, the apple of your eye, a fruit grower or anyone!\n\nThe apple is approximately 3cm tall, excluding the leaf.\nAvailable just as it is, or with a silver-tone split ring key ring and chain to make a cute key fob.\n\nPlease see my other listings for more bag charms / key fobs!\nwww.etsy.com/uk/shop/LittleConkers?section_id=16530320",
                                "creation_tsz": 1453017377,
                                "ending_tsz": 1463468177,
                                "original_creation_tsz": 1370791924,
                                "last_modified_tsz": 1460708693,
                                "price": "6.00",
                                "currency_code": "GBP",
                                "quantity": 3,
                                "tags": [
                                    "apple gift",
                                    "teacher gift",
                                    "teacher thank you",
                                    "thank you gift",
                                    "small gift",
                                    "apple of my eye",
                                    "red uk seller",
                                    "Valentines Day",
                                    "love apple",
                                    "keychain keyring",
                                    "bag charm purse",
                                    "key fob key chain",
                                    "apple keychain"
                                ],
                                "category_path": [
                                    "Accessories",
                                    "Keychain"
                                ],
                                "category_path_ids": [
                                    69150467,
                                    69154275
                                ],
                                "materials": [
                                    "organic cotton",
                                    "wool stuffing"
                                ],
                                "shop_section_id": 16530320,
                                "featured_rank": 1,
                                "state_tsz": 1456582187,
                                "url": "https://www.etsy.com/listing/153526623/apple-key-ring-apple-keychain-apple-bag?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 2366,
                                "num_favorers": 178,
                                "shipping_template_id": 10012240165,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "made_to_order",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": true,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 165,
                                "taxonomy_path": [
                                    "Accessories",
                                    "Keychains & Lanyards",
                                    "Keychains"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 930134698,
                                        "hex_code": "D6918A",
                                        "red": 214,
                                        "green": 145,
                                        "blue": 138,
                                        "hue": 6,
                                        "saturation": 35,
                                        "brightness": 83,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1456583524,
                                        "listing_id": 153526623,
                                        "rank": 1,
                                        "url_75x75": "https://img0.etsystatic.com/130/0/6648390/il_75x75.930134698_3x5v.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/130/0/6648390/il_170x135.930134698_3x5v.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/130/0/6648390/il_570xN.930134698_3x5v.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/130/0/6648390/il_fullxfull.930134698_3x5v.jpg",
                                        "full_height": 1500,
                                        "full_width": 1500
                                    },
                                    {
                                        "listing_image_id": 930134978,
                                        "hex_code": "8C5741",
                                        "red": 140,
                                        "green": 87,
                                        "blue": 65,
                                        "hue": 18,
                                        "saturation": 53,
                                        "brightness": 54,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1456583524,
                                        "listing_id": 153526623,
                                        "rank": 2,
                                        "url_75x75": "https://img0.etsystatic.com/110/0/6648390/il_75x75.930134978_5b40.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/110/0/6648390/il_170x135.930134978_5b40.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/110/0/6648390/il_570xN.930134978_5b40.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/110/0/6648390/il_fullxfull.930134978_5b40.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 930134974,
                                        "hex_code": "B2876F",
                                        "red": 178,
                                        "green": 135,
                                        "blue": 111,
                                        "hue": 21,
                                        "saturation": 37,
                                        "brightness": 69,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1456583524,
                                        "listing_id": 153526623,
                                        "rank": 3,
                                        "url_75x75": "https://img0.etsystatic.com/108/0/6648390/il_75x75.930134974_cslv.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/108/0/6648390/il_170x135.930134974_cslv.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/108/0/6648390/il_570xN.930134974_cslv.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/108/0/6648390/il_fullxfull.930134974_cslv.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    }
                                ]
                            },
                            {
                                "listing_id": 217456472,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69154275,
                                "title": "Key Ring / Keychain / Bag Charm / Small Gift / Bright Fun Round Rainbow Crochet Accessory / Eco-friendly",
                                "description": "Keychain or bag charm, handmade in sustainable, eco-friendly materials.\n\nThese cheerful crocheted keychains are a great small gift for yourself or a friend, for any occasion. The key fobs are soft and light but large enough to make it easy to find and identify those keys!\n\nI crochet these from the ends of balls of yarn too short to be used in my larger projects. The yarns are mainly organic cotton, with some hemp, bamboo, wool and &#39;ordinary&#39; cotton. They are stuffed with 100% British sheep&#39;s wool, an annually-renewable resource.\n\nChoose from either &#39;brights&#39; or &#39;naturals&#39; - I will pick your fob at random. I carefully choose colours that go together so each fob is always attractive. The two sides will have the same colours but sometimes in a different order.\n\nIf you have a strong preference for a particular colour scheme (school colours, football team, no yellow...) do let me know, and I&#39;ll see what I can do!\n\nThe fobs are 5-6cm across.\nIncludes a silver-tone chain and split-ring key ring.\n\nFor more keychains / bag charms, please see my other listings:\nhttps://www.etsy.com/uk/shop/LittleConkers?section_id=16530320&ref=shopsection_leftnav_5",
                                "creation_tsz": 1457939373,
                                "ending_tsz": 1468480173,
                                "original_creation_tsz": 1420576732,
                                "last_modified_tsz": 1461073248,
                                "price": "5.00",
                                "currency_code": "GBP",
                                "quantity": 5,
                                "tags": [
                                    "eco-friendly",
                                    "small gift",
                                    "mothers day gift",
                                    "British uk seller",
                                    "rainbow bright",
                                    "keychain keyring",
                                    "key ring key fob",
                                    "crochet gift granny",
                                    "handbag purse charm",
                                    "keyrings key-ring",
                                    "bag charm bag charms",
                                    "fathers day gift",
                                    "soft crocheted round"
                                ],
                                "category_path": [
                                    "Accessories",
                                    "Keychain"
                                ],
                                "category_path_ids": [
                                    69150467,
                                    69154275
                                ],
                                "materials": [
                                    "wool",
                                    "organic cotton",
                                    "bamboo",
                                    "hemp",
                                    "cotton",
                                    "keychain"
                                ],
                                "shop_section_id": 16530320,
                                "featured_rank": 2,
                                "state_tsz": 1457939354,
                                "url": "https://www.etsy.com/listing/217456472/key-ring-keychain-bag-charm-small-gift?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 1184,
                                "num_favorers": 133,
                                "shipping_template_id": 10012240165,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "made_to_order",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": false,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 165,
                                "taxonomy_path": [
                                    "Accessories",
                                    "Keychains & Lanyards",
                                    "Keychains"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 926704339,
                                        "hex_code": "BCAB84",
                                        "red": 188,
                                        "green": 171,
                                        "blue": 132,
                                        "hue": 42,
                                        "saturation": 29,
                                        "brightness": 73,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1456127658,
                                        "listing_id": 217456472,
                                        "rank": 1,
                                        "url_75x75": "https://img1.etsystatic.com/110/0/6648390/il_75x75.926704339_gmyx.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/110/0/6648390/il_170x135.926704339_gmyx.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/110/0/6648390/il_570xN.926704339_gmyx.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/110/0/6648390/il_fullxfull.926704339_gmyx.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 707830313,
                                        "hex_code": "A48C7D",
                                        "red": 164,
                                        "green": 140,
                                        "blue": 125,
                                        "hue": 23,
                                        "saturation": 23,
                                        "brightness": 64,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1420576732,
                                        "listing_id": 217456472,
                                        "rank": 2,
                                        "url_75x75": "https://img1.etsystatic.com/049/0/6648390/il_75x75.707830313_z6jm.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/049/0/6648390/il_170x135.707830313_z6jm.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/049/0/6648390/il_570xN.707830313_z6jm.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/049/0/6648390/il_fullxfull.707830313_z6jm.jpg",
                                        "full_height": 1500,
                                        "full_width": 1500
                                    },
                                    {
                                        "listing_image_id": 707830283,
                                        "hex_code": "AD9A86",
                                        "red": 173,
                                        "green": 154,
                                        "blue": 134,
                                        "hue": 31,
                                        "saturation": 22,
                                        "brightness": 67,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1420576732,
                                        "listing_id": 217456472,
                                        "rank": 3,
                                        "url_75x75": "https://img1.etsystatic.com/050/0/6648390/il_75x75.707830283_aqy4.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/050/0/6648390/il_170x135.707830283_aqy4.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/050/0/6648390/il_570xN.707830283_aqy4.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/050/0/6648390/il_fullxfull.707830283_aqy4.jpg",
                                        "full_height": 1500,
                                        "full_width": 1500
                                    },
                                    {
                                        "listing_image_id": 707830011,
                                        "hex_code": "B9B296",
                                        "red": 185,
                                        "green": 178,
                                        "blue": 150,
                                        "hue": 48,
                                        "saturation": 18,
                                        "brightness": 72,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1420576732,
                                        "listing_id": 217456472,
                                        "rank": 4,
                                        "url_75x75": "https://img1.etsystatic.com/058/0/6648390/il_75x75.707830011_e6km.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/058/0/6648390/il_170x135.707830011_e6km.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/058/0/6648390/il_570xN.707830011_e6km.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/058/0/6648390/il_fullxfull.707830011_e6km.jpg",
                                        "full_height": 1023,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 707710020,
                                        "hex_code": "AF9876",
                                        "red": 175,
                                        "green": 152,
                                        "blue": 118,
                                        "hue": 36,
                                        "saturation": 32,
                                        "brightness": 68,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1420576732,
                                        "listing_id": 217456472,
                                        "rank": 5,
                                        "url_75x75": "https://img0.etsystatic.com/047/0/6648390/il_75x75.707710020_6jbu.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/047/0/6648390/il_170x135.707710020_6jbu.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/047/0/6648390/il_570xN.707710020_6jbu.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/047/0/6648390/il_fullxfull.707710020_6jbu.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    }
                                ]
                            },
                            {
                                "listing_id": 183011170,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69150433,
                                "title": "Crochet Kit / DIY Kit Crochet Fruit / Crochet Gift / Eco-friendly Craft Kit / Apple Pear / Gift for Crocheter / Beginner Crochet",
                                "description": "DIY kit to make a red apple and a green pear in sustainable, eco-friendly materials.\n\nA beautiful decorative accent, they also make lovely natural toys for a child.\n\nThis crochet kit contains everything you need to make the pair of fruit, including a cute leaf:\n--- 6 page crochet pattern, fully illustrated with colour photos\n--- organic cotton yarn\n--- 100% natural British sheep&#39;s wool stuffing\n--- blunt-tipped yarn needle\n--- gift tag up-cycled from cereal packets, etc\n\nYou will need a 3.5mm crochet hook (or the size you need to make a compact crochet fabric with the given yarn), and I can include a quality bamboo crochet hook in the kit if you don&#39;t have one or are giving the kit as a gift.\n\nThe finished fruit are approximately 5.5cm in diameter.\n\nThe kit is designed to be as low-impact / sustainable as I can possibly make it, and is beautifully presented, so it also makes a great gift for a crafty and/or eco-minded friend.\n\nbox - reusable / recyclable / biodegradable\ntissue - 100% recycled\nprinter paper - 100% recycled\ntags - handmade from old birthday cards, etc\n\nIf you&#39;d like this item sent directly to someone else as a gift, that&#39;s no problem, just use the &quot;Notes to seller&quot; section at checkout to let me know.\n\nWant to make a banana too? See my pattern here:\nwww.etsy.com/uk/listing/153348454\n\nIf you&#39;d like any of my other fruit or vegetable patterns made into a kit, just ask and I&#39;ll see what I can do!\n\n___________________________\n\nOnce purchased, this pattern remains the copyright of Little Conkers. You may not reproduce all or any part of this pattern. Please do not sell items made from this pattern, without express prior permission (which is usually granted) and credit.",
                                "creation_tsz": 1458361762,
                                "ending_tsz": 1468902562,
                                "original_creation_tsz": 1395092067,
                                "last_modified_tsz": 1460466889,
                                "price": "15.00",
                                "currency_code": "GBP",
                                "quantity": 1,
                                "tags": [
                                    "crochet pattern",
                                    "eco-friendly",
                                    "crochet kit",
                                    "crochet gift",
                                    "craft kit",
                                    "crochet fruit",
                                    "fruit pattern",
                                    "crochet apple",
                                    "crochet pear",
                                    "pear pattern",
                                    "apple pattern",
                                    "crochet decorations",
                                    "DIY kit"
                                ],
                                "category_path": [
                                    "Supplies"
                                ],
                                "category_path_ids": [
                                    69150433
                                ],
                                "materials": [
                                    "organic cotton",
                                    "wool",
                                    "recycled paper",
                                    "recycled tissue"
                                ],
                                "shop_section_id": 15294433,
                                "featured_rank": 3,
                                "state_tsz": 1449537638,
                                "url": "https://www.etsy.com/listing/183011170/crochet-kit-diy-kit-crochet-fruit?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 4049,
                                "num_favorers": 392,
                                "shipping_template_id": 8197097133,
                                "processing_min": 1,
                                "processing_max": 2,
                                "who_made": "i_did",
                                "is_supply": "true",
                                "when_made": "2010_2016",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": false,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 2718,
                                "taxonomy_path": [
                                    "Craft Supplies & Tools",
                                    "Kits",
                                    "Fiber Arts",
                                    "Crochet"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 577854953,
                                        "hex_code": "B29063",
                                        "red": 178,
                                        "green": 144,
                                        "blue": 99,
                                        "hue": 34,
                                        "saturation": 44,
                                        "brightness": 69,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1395092067,
                                        "listing_id": 183011170,
                                        "rank": 1,
                                        "url_75x75": "https://img1.etsystatic.com/029/0/6648390/il_75x75.577854953_dxh2.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/029/0/6648390/il_170x135.577854953_dxh2.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/029/0/6648390/il_570xN.577854953_dxh2.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/029/0/6648390/il_fullxfull.577854953_dxh2.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 577743930,
                                        "hex_code": "AE9B93",
                                        "red": 174,
                                        "green": 155,
                                        "blue": 147,
                                        "hue": 18,
                                        "saturation": 15,
                                        "brightness": 68,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1395092067,
                                        "listing_id": 183011170,
                                        "rank": 2,
                                        "url_75x75": "https://img0.etsystatic.com/042/1/6648390/il_75x75.577743930_avqd.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/042/1/6648390/il_170x135.577743930_avqd.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/042/1/6648390/il_570xN.577743930_avqd.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/042/1/6648390/il_fullxfull.577743930_avqd.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 930992109,
                                        "hex_code": "C5AB9B",
                                        "red": 197,
                                        "green": 171,
                                        "blue": 155,
                                        "hue": 23,
                                        "saturation": 21,
                                        "brightness": 77,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1456753444,
                                        "listing_id": 183011170,
                                        "rank": 3,
                                        "url_75x75": "https://img1.etsystatic.com/115/0/6648390/il_75x75.930992109_t2t9.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/115/0/6648390/il_170x135.930992109_t2t9.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/115/0/6648390/il_570xN.930992109_t2t9.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/115/0/6648390/il_fullxfull.930992109_t2t9.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 577738152,
                                        "hex_code": "A5524B",
                                        "red": 165,
                                        "green": 82,
                                        "blue": 75,
                                        "hue": 5,
                                        "saturation": 54,
                                        "brightness": 64,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1395092068,
                                        "listing_id": 183011170,
                                        "rank": 4,
                                        "url_75x75": "https://img0.etsystatic.com/037/0/6648390/il_75x75.577738152_7hk2.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/037/0/6648390/il_170x135.577738152_7hk2.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/037/0/6648390/il_570xN.577738152_7hk2.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/037/0/6648390/il_fullxfull.577738152_7hk2.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 577738188,
                                        "hex_code": "AC9D4C",
                                        "red": 172,
                                        "green": 157,
                                        "blue": 76,
                                        "hue": 51,
                                        "saturation": 55,
                                        "brightness": 67,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1395092068,
                                        "listing_id": 183011170,
                                        "rank": 5,
                                        "url_75x75": "https://img0.etsystatic.com/027/0/6648390/il_75x75.577738188_ljdm.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/027/0/6648390/il_170x135.577738188_ljdm.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/027/0/6648390/il_570xN.577738188_ljdm.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/027/0/6648390/il_fullxfull.577738188_ljdm.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    }
                                ]
                            },
                            {
                                "listing_id": 189898950,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69150367,
                                "title": "Teacher Thank you Card with Apple Brooch",
                                "description": "Thank a special teacher for all their hard work with this little gift and card in one.\n\nThis eco-friendly card features an apple brooch hand-crocheted in organic cotton which detaches easily without damaging the card.\n\nThe 100% recycled card comes with a matching wallet-style envelope ready to give to your chosen teacher. It is blank inside for your own message.\n\nThe card is 12cm square.\n\nI can add a different greeting to the card if you prefer, and I also have other brooches available, just drop me a message or see my other listings.",
                                "creation_tsz": 1458675983,
                                "ending_tsz": 1469216783,
                                "original_creation_tsz": 1400337219,
                                "last_modified_tsz": 1460699411,
                                "price": "4.99",
                                "currency_code": "GBP",
                                "quantity": 3,
                                "tags": [
                                    "teacher card",
                                    "teacher gift",
                                    "apple card",
                                    "teacher appreciation",
                                    "teacher thank you",
                                    "thank you card",
                                    "apple brooch",
                                    "eco-friendly card",
                                    "greetings card",
                                    "brooch card",
                                    "small teacher gift",
                                    "handmade brooch",
                                    "badge card"
                                ],
                                "category_path": [
                                    "Paper Goods"
                                ],
                                "category_path_ids": [
                                    69150367
                                ],
                                "materials": [
                                    "organic cotton",
                                    "recycled card"
                                ],
                                "shop_section_id": 15835102,
                                "featured_rank": 4,
                                "state_tsz": 1458492029,
                                "url": "https://www.etsy.com/listing/189898950/teacher-thank-you-card-with-apple-brooch?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 787,
                                "num_favorers": 75,
                                "shipping_template_id": 5058983722,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "2010_2016",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": false,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": false,
                                "taxonomy_id": 1271,
                                "taxonomy_path": [
                                    "Paper & Party Supplies",
                                    "Paper",
                                    "Greeting Cards",
                                    "Graduation & School Cards"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 603458970,
                                        "hex_code": "BEA079",
                                        "red": 190,
                                        "green": 160,
                                        "blue": 121,
                                        "hue": 34,
                                        "saturation": 36,
                                        "brightness": 74,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1400342757,
                                        "listing_id": 189898950,
                                        "rank": 1,
                                        "url_75x75": "https://img0.etsystatic.com/030/0/6648390/il_75x75.603458970_tu9y.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/030/0/6648390/il_170x135.603458970_tu9y.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/030/0/6648390/il_570xN.603458970_tu9y.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/030/0/6648390/il_fullxfull.603458970_tu9y.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 603521823,
                                        "hex_code": "B99873",
                                        "red": 185,
                                        "green": 152,
                                        "blue": 115,
                                        "hue": 32,
                                        "saturation": 37,
                                        "brightness": 72,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1400337219,
                                        "listing_id": 189898950,
                                        "rank": 2,
                                        "url_75x75": "https://img1.etsystatic.com/036/0/6648390/il_75x75.603521823_sd71.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/036/0/6648390/il_170x135.603521823_sd71.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/036/0/6648390/il_570xN.603521823_sd71.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/036/0/6648390/il_fullxfull.603521823_sd71.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 603521835,
                                        "hex_code": "BE9F81",
                                        "red": 190,
                                        "green": 159,
                                        "blue": 129,
                                        "hue": 30,
                                        "saturation": 32,
                                        "brightness": 74,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1400337219,
                                        "listing_id": 189898950,
                                        "rank": 3,
                                        "url_75x75": "https://img1.etsystatic.com/042/0/6648390/il_75x75.603521835_mpth.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/042/0/6648390/il_170x135.603521835_mpth.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/042/0/6648390/il_570xN.603521835_mpth.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/042/0/6648390/il_fullxfull.603521835_mpth.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 603420006,
                                        "hex_code": "BB9363",
                                        "red": 187,
                                        "green": 147,
                                        "blue": 99,
                                        "hue": 33,
                                        "saturation": 47,
                                        "brightness": 73,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1400337220,
                                        "listing_id": 189898950,
                                        "rank": 4,
                                        "url_75x75": "https://img0.etsystatic.com/028/0/6648390/il_75x75.603420006_3qxj.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/028/0/6648390/il_170x135.603420006_3qxj.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/028/0/6648390/il_570xN.603420006_3qxj.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/028/0/6648390/il_fullxfull.603420006_3qxj.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 603420010,
                                        "hex_code": "BD594E",
                                        "red": 189,
                                        "green": 89,
                                        "blue": 78,
                                        "hue": 6,
                                        "saturation": 58,
                                        "brightness": 74,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1400337219,
                                        "listing_id": 189898950,
                                        "rank": 5,
                                        "url_75x75": "https://img0.etsystatic.com/030/0/6648390/il_75x75.603420010_6hyh.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/030/0/6648390/il_170x135.603420010_6hyh.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/030/0/6648390/il_570xN.603420010_6hyh.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/030/0/6648390/il_fullxfull.603420010_6hyh.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    }
                                ]
                            },
                            {
                                "listing_id": 231282571,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69152963,
                                "title": "Seahorse Greetings Card / Seahorse Brooch / Coral Reef Sea-life Seahorse Birthday Card / Eco-friendly",
                                "description": "A greetings card and gift in one for any occasion!\n\nYoung and old will love this happy seahorse and the lucky recipient can wear their brooch long after their birthday.\n\nThe 100% recycled card features a hand-crocheted brooch/badge, which detaches easily without damaging the card.\n\nThe card comes with a sturdy, self-seal box envelope (second picture) to protect the card en route to its recipient.\n\nThe card is 12cm square and is blank inside for your message.\n\nIn the UK the card can be sent in the &#39;Large Letter&#39; category.\n\nPlease take delivery times to your location into account when placing your order. If you are in the UK, you can opt to choose &#39;1st Class Signed For&#39; at checkout for faster delivery.\n\nThe brooches are made mainly in organic cotton, bamboo or cotton hand-dyed by an enterprise providing employment to women in an economically-deprived area of South Africa. I use small amounts of &#39;ordinary&#39; (good quality) cotton where I have some of this to use up. I buy small quantities of non organic yarn when I require a particular colour for my larger items (bright yellow for example) and I have also sometimes been given yarn which I prefer to use up rather than throw away. Let me know if you would prefer your brooch to be made entirely in organic cotton, as I can usually oblige.\n\nThe badges are sewn together, not glued, for sustainability and robustness. They will withstand washing and can be gently ironed if they happen to get left on clothes!\n\nI can usually make these in the colours of your choice, please just let me know in &quot;Notes to Seller&quot; as you check out. If you don&#39;t specify anything you will receive one of the colours shown. \n\nI can also make sets of badges for party bags or wedding favours on request.\n\nFor my full range of brooch cards (third picture) please see here:\nhttps://www.etsy.com/uk/shop/LittleConkers?section_id=15835102&ref=shopsection_leftnav_7",
                                "creation_tsz": 1460292097,
                                "ending_tsz": 1470832897,
                                "original_creation_tsz": 1430057412,
                                "last_modified_tsz": 1460907917,
                                "price": "5.00",
                                "currency_code": "GBP",
                                "quantity": 2,
                                "tags": [
                                    "eco-friendly card",
                                    "greetings card",
                                    "handmade brooch",
                                    "birthday badge card",
                                    "small gift child",
                                    "yellow",
                                    "seahorse",
                                    "underwater sealife",
                                    "marine biology",
                                    "brooch badge pin",
                                    "thank you card love",
                                    "mothers day card",
                                    "undersea theme"
                                ],
                                "category_path": [
                                    "Paper Goods",
                                    "Cards"
                                ],
                                "category_path_ids": [
                                    69150367,
                                    69152963
                                ],
                                "materials": [
                                    "recycled card",
                                    "cotton",
                                    "organic cotton"
                                ],
                                "shop_section_id": 15835102,
                                "featured_rank": 5,
                                "state_tsz": 1459239613,
                                "url": "https://www.etsy.com/listing/231282571/seahorse-greetings-card-seahorse-brooch?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 581,
                                "num_favorers": 44,
                                "shipping_template_id": 5058983722,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "2010_2016",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": true,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 1261,
                                "taxonomy_path": [
                                    "Paper & Party Supplies",
                                    "Paper",
                                    "Greeting Cards"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 894742374,
                                        "hex_code": "CFB06E",
                                        "red": 207,
                                        "green": 176,
                                        "blue": 110,
                                        "hue": 41,
                                        "saturation": 46,
                                        "brightness": 81,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1451412469,
                                        "listing_id": 231282571,
                                        "rank": 1,
                                        "url_75x75": "https://img0.etsystatic.com/128/0/6648390/il_75x75.894742374_8dbo.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/128/0/6648390/il_170x135.894742374_8dbo.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/128/0/6648390/il_570xN.894742374_8dbo.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/128/0/6648390/il_fullxfull.894742374_8dbo.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 894858370,
                                        "hex_code": "B9BAB3",
                                        "red": 185,
                                        "green": 186,
                                        "blue": 179,
                                        "hue": 69,
                                        "saturation": 3,
                                        "brightness": 72,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1451425532,
                                        "listing_id": 231282571,
                                        "rank": 2,
                                        "url_75x75": "https://img0.etsystatic.com/126/0/6648390/il_75x75.894858370_vzsm.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/126/0/6648390/il_170x135.894858370_vzsm.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/126/0/6648390/il_570xN.894858370_vzsm.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/126/0/6648390/il_fullxfull.894858370_vzsm.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 954434046,
                                        "hex_code": "ACABA3",
                                        "red": 172,
                                        "green": 171,
                                        "blue": 163,
                                        "hue": 53,
                                        "saturation": 5,
                                        "brightness": 67,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1460116109,
                                        "listing_id": 231282571,
                                        "rank": 3,
                                        "url_75x75": "https://img0.etsystatic.com/124/0/6648390/il_75x75.954434046_5387.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/124/0/6648390/il_170x135.954434046_5387.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/124/0/6648390/il_570xN.954434046_5387.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/124/0/6648390/il_fullxfull.954434046_5387.jpg",
                                        "full_height": 1500,
                                        "full_width": 1500
                                    }
                                ]
                            },
                            {
                                "listing_id": 194251987,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69152963,
                                "title": "Butterfly Brooch / Dragonfly Brooch / Eco-friendly Card / Mothers&#39; Day Birthday Greetings Card with Brooch",
                                "description": "A small gift and card in one!\n\nGive an eco-friendly birthday badge someone can wear for more than one day, or send the greetings of your choice on little wings to someone who deserves a little lift.\n\nThis card features a hand-crocheted brooch/badge, made mainly in organic cotton, which detaches easily without damaging the card.\n\nThe 100% recycled card comes with a sturdy, self-seal box envelope to protect the card en route to its recipient.\n\nIf you have a particular colour preference, please let me know in &#39;Notes to Seller&#39; at checkout. If nothing is specified, you will receive a brooch similar to any of the ones shown here.\n\nThe card is 12cm square and is blank inside for your message.\n\nIn the UK the card can be sent in the &#39;Large Letter&#39; category.\n\nPlease take delivery times to your location into account when placing your order. If you are in the UK, you can opt to choose &#39;1st Class Signed For&#39; at checkout for faster delivery. Delivery in time for Valentine&#39;s Day cannot now be guaranteed.\n\nThe brooches are made mainly in organic cotton, bamboo or cotton hand-dyed by an enterprise providing employment to women in an economically-deprived area of South Africa. I use small amounts of &#39;ordinary&#39; (good quality) cotton where I have some of this to use up. I buy small quantities of non organic yarn when I require a particular colour for my larger items (bright yellow for example) and I have also sometimes been given yarn which I prefer to use up rather than throw away. Let me know if you would prefer your brooch to be made entirely in organic cotton, as I can usually oblige.\n\nThe badges are sewn together, not glued, for sustainability and robustness. They will withstand washing and can be gently ironed if they happen to get left on clothes!\n\nI can also make sets of badges for party bags / wedding favours on request.",
                                "creation_tsz": 1456247881,
                                "ending_tsz": 1466698681,
                                "original_creation_tsz": 1403704310,
                                "last_modified_tsz": 1460426200,
                                "price": "6.00",
                                "currency_code": "GBP",
                                "quantity": 3,
                                "tags": [
                                    "eco-friendly card",
                                    "greetings card",
                                    "badge card",
                                    "small gift child",
                                    "butterfly insect",
                                    "dragon fly",
                                    "yellow",
                                    "Spring Easter",
                                    "thank you card",
                                    "Mothers' Mother's",
                                    "brooch badge pin",
                                    "birthday card child",
                                    "card for her"
                                ],
                                "category_path": [
                                    "Paper Goods",
                                    "Cards"
                                ],
                                "category_path_ids": [
                                    69150367,
                                    69152963
                                ],
                                "materials": [
                                    "recycled card",
                                    "cotton",
                                    "organic cotton",
                                    "metal findings"
                                ],
                                "shop_section_id": 15835102,
                                "featured_rank": 6,
                                "state_tsz": 1452977119,
                                "url": "https://www.etsy.com/listing/194251987/butterfly-brooch-dragonfly-brooch-eco?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 1012,
                                "num_favorers": 51,
                                "shipping_template_id": 5058983722,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "2010_2016",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": true,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 1261,
                                "taxonomy_path": [
                                    "Paper & Party Supplies",
                                    "Paper",
                                    "Greeting Cards"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 716665401,
                                        "hex_code": "CEB482",
                                        "red": 206,
                                        "green": 180,
                                        "blue": 130,
                                        "hue": 39,
                                        "saturation": 36,
                                        "brightness": 80,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1422085661,
                                        "listing_id": 194251987,
                                        "rank": 1,
                                        "url_75x75": "https://img1.etsystatic.com/057/0/6648390/il_75x75.716665401_mbtk.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/057/0/6648390/il_170x135.716665401_mbtk.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/057/0/6648390/il_570xN.716665401_mbtk.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/057/0/6648390/il_fullxfull.716665401_mbtk.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 890663389,
                                        "hex_code": "BA9681",
                                        "red": 186,
                                        "green": 150,
                                        "blue": 129,
                                        "hue": 22,
                                        "saturation": 30,
                                        "brightness": 72,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1450481052,
                                        "listing_id": 194251987,
                                        "rank": 2,
                                        "url_75x75": "https://img1.etsystatic.com/115/0/6648390/il_75x75.890663389_bg2r.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/115/0/6648390/il_170x135.890663389_bg2r.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/115/0/6648390/il_570xN.890663389_bg2r.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/115/0/6648390/il_fullxfull.890663389_bg2r.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 890075587,
                                        "hex_code": "D1C4A6",
                                        "red": 209,
                                        "green": 196,
                                        "blue": 166,
                                        "hue": 42,
                                        "saturation": 20,
                                        "brightness": 81,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1450373582,
                                        "listing_id": 194251987,
                                        "rank": 3,
                                        "url_75x75": "https://img1.etsystatic.com/134/0/6648390/il_75x75.890075587_qi0q.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/134/0/6648390/il_170x135.890075587_qi0q.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/134/0/6648390/il_570xN.890075587_qi0q.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/134/0/6648390/il_fullxfull.890075587_qi0q.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    },
                                    {
                                        "listing_image_id": 890313572,
                                        "hex_code": "C5AD8E",
                                        "red": 197,
                                        "green": 173,
                                        "blue": 142,
                                        "hue": 34,
                                        "saturation": 27,
                                        "brightness": 77,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1450373582,
                                        "listing_id": 194251987,
                                        "rank": 4,
                                        "url_75x75": "https://img0.etsystatic.com/127/0/6648390/il_75x75.890313572_4jz4.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/127/0/6648390/il_170x135.890313572_4jz4.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/127/0/6648390/il_570xN.890313572_4jz4.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/127/0/6648390/il_fullxfull.890313572_4jz4.jpg",
                                        "full_height": 1500,
                                        "full_width": 1500
                                    },
                                    {
                                        "listing_image_id": 716665341,
                                        "hex_code": "C0A999",
                                        "red": 192,
                                        "green": 169,
                                        "blue": 153,
                                        "hue": 25,
                                        "saturation": 20,
                                        "brightness": 75,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1422085661,
                                        "listing_id": 194251987,
                                        "rank": 5,
                                        "url_75x75": "https://img1.etsystatic.com/059/0/6648390/il_75x75.716665341_qal1.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/059/0/6648390/il_170x135.716665341_qal1.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/059/0/6648390/il_570xN.716665341_qal1.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/059/0/6648390/il_fullxfull.716665341_qal1.jpg",
                                        "full_height": 1280,
                                        "full_width": 1280
                                    }
                                ]
                            },
                            {
                                "listing_id": 160671743,
                                "state": "active",
                                "user_id": 18196286,
                                "category_id": 69154275,
                                "title": "Car Key Fob / Car Key Chain / Car Bag Charm / Eco-friendly Gift / Eco-friendly Key Fob / Eco-friendly Bag Charm",
                                "description": "Cute little car key fob or bag charm, handmade to order in sustainable, eco-friendly materials.\n\nThis little vehicle is carefully crocheted in soft organic cotton* with cotton details, and is stuffed with 100% British sheep&#39;s wool.\n\nAn ideal gift for someone who has just passed their test, bought a new car, got the keys to a new house... especially if they appreciate sustainability.\n\nThe car is 9cm bumper to bumper.\nPlease choose the colour you would like from the drop-down list.\n\n\n*Please note that the blue colour is not currently available in organic cotton, instead I use a cotton yarn hand-dyed and balled by women in an economically depressed rural area of South Africa. Selling this yarn brings empowerment to them and economic benefits to their community.",
                                "creation_tsz": 1460996095,
                                "ending_tsz": 1471536895,
                                "original_creation_tsz": 1377440102,
                                "last_modified_tsz": 1460996095,
                                "price": "10.00",
                                "currency_code": "GBP",
                                "quantity": 2,
                                "tags": [
                                    "Eco-friendly Gift",
                                    "Eco-friendly Key Fob",
                                    "Organic Sustainable",
                                    "small gift",
                                    "stocking filler",
                                    "new car",
                                    "Car Key Ring",
                                    "gift for man men",
                                    "bag charm",
                                    "key fob key chain",
                                    "driving test",
                                    "car automobile",
                                    "fathers day gift"
                                ],
                                "category_path": [
                                    "Accessories",
                                    "Keychain"
                                ],
                                "category_path_ids": [
                                    69150467,
                                    69154275
                                ],
                                "materials": [
                                    "organic cotton",
                                    "wool",
                                    "cotton"
                                ],
                                "shop_section_id": 16530320,
                                "featured_rank": 7,
                                "state_tsz": 1458595230,
                                "url": "https://www.etsy.com/listing/160671743/car-key-fob-car-key-chain-car-bag-charm?utm_source=cinema6&utm_medium=api&utm_campaign=api",
                                "views": 1848,
                                "num_favorers": 117,
                                "shipping_template_id": 10012240165,
                                "processing_min": 3,
                                "processing_max": 5,
                                "who_made": "i_did",
                                "is_supply": "false",
                                "when_made": "made_to_order",
                                "item_weight": null,
                                "item_weight_units": null,
                                "item_length": null,
                                "item_width": null,
                                "item_height": null,
                                "item_dimensions_unit": "in",
                                "is_private": false,
                                "recipient": null,
                                "occasion": null,
                                "style": null,
                                "non_taxable": false,
                                "is_customizable": true,
                                "is_digital": false,
                                "file_data": "",
                                "language": "en-US",
                                "has_variations": true,
                                "taxonomy_id": 165,
                                "taxonomy_path": [
                                    "Accessories",
                                    "Keychains & Lanyards",
                                    "Keychains"
                                ],
                                "used_manufacturer": false,
                                "Images": [
                                    {
                                        "listing_image_id": 731979913,
                                        "hex_code": "667D8B",
                                        "red": 102,
                                        "green": 125,
                                        "blue": 139,
                                        "hue": 203,
                                        "saturation": 26,
                                        "brightness": 54,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1424678968,
                                        "listing_id": 160671743,
                                        "rank": 1,
                                        "url_75x75": "https://img1.etsystatic.com/049/0/6648390/il_75x75.731979913_odyc.jpg",
                                        "url_170x135": "https://img1.etsystatic.com/049/0/6648390/il_170x135.731979913_odyc.jpg",
                                        "url_570xN": "https://img1.etsystatic.com/049/0/6648390/il_570xN.731979913_odyc.jpg",
                                        "url_fullxfull": "https://img1.etsystatic.com/049/0/6648390/il_fullxfull.731979913_odyc.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 494130498,
                                        "hex_code": "A06D60",
                                        "red": 160,
                                        "green": 109,
                                        "blue": 96,
                                        "hue": 12,
                                        "saturation": 40,
                                        "brightness": 62,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1377440102,
                                        "listing_id": 160671743,
                                        "rank": 2,
                                        "url_75x75": "https://img0.etsystatic.com/018/0/6648390/il_75x75.494130498_lhyo.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/018/0/6648390/il_170x135.494130498_lhyo.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/018/0/6648390/il_570xN.494130498_lhyo.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/018/0/6648390/il_fullxfull.494130498_lhyo.jpg",
                                        "full_height": 478,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 494130508,
                                        "hex_code": "A87574",
                                        "red": 168,
                                        "green": 117,
                                        "blue": 116,
                                        "hue": 1,
                                        "saturation": 30,
                                        "brightness": 65,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1377440102,
                                        "listing_id": 160671743,
                                        "rank": 3,
                                        "url_75x75": "https://img0.etsystatic.com/023/0/6648390/il_75x75.494130508_1jzd.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/023/0/6648390/il_170x135.494130508_1jzd.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/023/0/6648390/il_570xN.494130508_1jzd.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/023/0/6648390/il_fullxfull.494130508_1jzd.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 494130502,
                                        "hex_code": "7E747D",
                                        "red": 126,
                                        "green": 116,
                                        "blue": 125,
                                        "hue": 306,
                                        "saturation": 7,
                                        "brightness": 49,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1377440102,
                                        "listing_id": 160671743,
                                        "rank": 4,
                                        "url_75x75": "https://img0.etsystatic.com/020/0/6648390/il_75x75.494130502_aosp.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/020/0/6648390/il_170x135.494130502_aosp.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/020/0/6648390/il_570xN.494130502_aosp.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/020/0/6648390/il_fullxfull.494130502_aosp.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    },
                                    {
                                        "listing_image_id": 526968512,
                                        "hex_code": "6E6D66",
                                        "red": 110,
                                        "green": 109,
                                        "blue": 102,
                                        "hue": 52,
                                        "saturation": 7,
                                        "brightness": 43,
                                        "is_black_and_white": false,
                                        "creation_tsz": 1384695561,
                                        "listing_id": 160671743,
                                        "rank": 5,
                                        "url_75x75": "https://img0.etsystatic.com/017/0/6648390/il_75x75.526968512_emlv.jpg",
                                        "url_170x135": "https://img0.etsystatic.com/017/0/6648390/il_170x135.526968512_emlv.jpg",
                                        "url_570xN": "https://img0.etsystatic.com/017/0/6648390/il_570xN.526968512_emlv.jpg",
                                        "url_fullxfull": "https://img0.etsystatic.com/017/0/6648390/il_fullxfull.526968512_emlv.jpg",
                                        "full_height": 640,
                                        "full_width": 640
                                    }
                                ]
                            }
                        ],
                        "params": {
                            "shop_id": "LittleConkers",
                            "limit": 25,
                            "offset": 0,
                            "page": null
                        },
                        "type": "Listing",
                        "pagination": {
                            "effective_limit": 25,
                            "effective_offset": 0,
                            "next_offset": null,
                            "effective_page": 1,
                            "next_page": null
                        }
                    };

                    requestDeferreds[url.format({
                        protocol: 'https',
                        hostname: 'openapi.etsy.com',
                        pathname: '/v2/shops/' + id,
                        query: {
                            api_key: secrets.etsyKey
                        }
                    })].fulfill(shopResponse);

                    requestDeferreds[url.format({
                        protocol: 'https',
                        hostname: 'openapi.etsy.com',
                        pathname: '/v2/shops/' + id + '/listings/featured',
                        query: {
                            includes: 'Images',
                            api_key: secrets.etsyKey
                        }
                    })].fulfill(featuredListingsResponse);

                    process.nextTick(done);
                });

                it('should fulfill with some data', function() {
                    expect(success).toHaveBeenCalledWith({
                        type: 'ecommerce',
                        platform: 'etsy',
                        name: shopResponse.results[0].shop_name,
                        description: shopResponse.results[0].announcement,
                        uri: shopResponse.results[0].url,
                        extID: shopResponse.results[0].shop_id,
                        products: jasmine.any(Array)
                    });

                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        products: featuredListingsResponse.results.map(function(listing) {
                            return {
                                name: listing.title,
                                description: entities.decode(listing.description),
                                uri: listing.url,
                                categories: listing.category_path,
                                price: getSymbolFromCurrency(listing.currency_code) + listing.price,
                                extID: listing.listing_id,
                                images: jasmine.any(Array)
                            };
                        })
                    }));

                    expect(success).toHaveBeenCalledWith(jasmine.objectContaining({
                        products: featuredListingsResponse.results.map(function(listing) {
                            return jasmine.objectContaining({
                                images: listing.Images.map(function(image) {
                                    return {
                                        uri: image.url_570xN,
                                        averageColor: image.hex_code
                                    };
                                })
                            });
                        })
                    }));
                });
            });

            describe('if the store cannot be found', function() {
                beforeEach(function(done) {
                    var reason = new RequestErrors.StatusCodeError(404, '\'DewberryRidge\' is not a valid shop name');

                    requestDeferreds[url.format({
                        protocol: 'https',
                        hostname: 'openapi.etsy.com',
                        pathname: '/v2/shops/' + id,
                        query: {
                            api_key: secrets.etsyKey
                        }
                    })].reject(reason);

                    requestDeferreds[url.format({
                        protocol: 'https',
                        hostname: 'openapi.etsy.com',
                        pathname: '/v2/shops/' + id + '/listings/featured',
                        query: {
                            includes: 'Images',
                            api_key: secrets.etsyKey
                        }
                    })].reject(reason);

                    process.nextTick(done);
                });

                it('should reject the Promise', function() {
                    expect(failure).toHaveBeenCalledWith(new Error('No store found with that name.'));
                    expect(failure.calls.mostRecent().args[0].code).toBe('ENOTFOUND');
                });
            });

            [400, 403, 500, 504, 505].forEach(function(statusCode) {
                describe('if a request fails with a ' + statusCode, function() {
                    var reason;

                    beforeEach(function(done) {
                        reason = new RequestErrors.StatusCodeError(statusCode, 'Something bad happened!');

                        requestDeferreds[url.format({
                            protocol: 'https',
                            hostname: 'openapi.etsy.com',
                            pathname: '/v2/shops/' + id,
                            query: {
                                api_key: secrets.etsyKey
                            }
                        })].reject(reason);

                        process.nextTick(done);
                    });

                    it('should reject the Promise with the reason', function() {
                        expect(failure).toHaveBeenCalledWith(reason);
                    });
                });
            });
        });

        describe('APP_STORE(id, config, secrets)', function() {
            var id, config, secrets;
            var success, failure;

            beforeEach(function(done) {
                id = '48357348957';
                config = {
                    etsy: {}
                };
                secrets = {
                    etsyKey: 'wfnu439ihrufr4'
                };

                success = jasmine.createSpy('success()');
                failure = jasmine.createSpy('failure()');

                collateralScrape.productDataFrom.APP_STORE(id, config).then(success, failure);
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
                                //"description": "Shape the land, build sprawling towns and recruit and train a powerful army. \nConquer new territories to expand your realm and defeat rival lords and other players in epic real-time battles. \n\nPlease note that iPhone 4s, iPad 2, iPad 3 and iPad mini 1 are not supported.\n\nFEATURES\n• Build and expand your Kingdom, with farms, quarries, blacksmiths and more.\n• Alter the land by creating rivers, lakes and mountains.\n• Command your army in large-scale battles.\n• Battle other players in real-time.\n• Cross-Platform - Play on Phones, Tablet, and PC, whenever you want, wherever you want. Actions in your Kingdom will carry over onto any device you play on.\n• From the creators of the award-winning Total War™ games.\n\nREQUIREMENTS\n• 4th generation iPad or above\n• iPad mini 2 or above\n• iPhone 5 or above\n• iPod Touch 6th generation or above\n• iOS 8 or above\n• An internet connection\n\n\nNEWS\nLike us on Facebook: https://www.facebook.com/totalwarbattles\nFollow us on Twitter: https://twitter.com/TotalWarBattles\nFollow us on Instagram: https://www.instagram.com/totalwarbattles\n\n\nPLEASE NOTE\nTotal War Battles: KINGDOM is free to download and play.\n\nAdditional Gold can be purchased using real money. More information on in-app purchases is available here: http://wiki.totalwar.com/w/Total_War_Battles_Kingdom_Information\n\nIf you do not want to use this feature, please disable in-app purchases in your device’s settings. Also, under our Terms of Service and Privacy Policy, you must be at least 13 years of age to play or download Total War Battles: KINGDOM.\n\n\n- - - - -\nEULA: http://www.sega.co.uk/Mobile_EULA\nTerms of Service: http://www.sega.co.uk/Account-Terms-of-Service\nPrivacy Policy: http://www.sega.co.uk/mprivacy\n\n© SEGA. Creative Assembly, the Creative Assembly logo, Total War, Total War Battles: Kingdom and the Total War Battles logo are either registered trademarks or trademarks of The Creative Assembly Limited. SEGA and the SEGA logo are either registered trademarks or trademarks of SEGA Holdings Co., Ltd. or its affiliates. All rights reserved. SEGA is registered in the U.S. Patent and Trademark Office. All other trademarks, logos and copyrights are property of their respective owners.",
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

                it('makes head requests for all the images', function() {
                    var options = {
                        method: 'HEAD'
                    };
                    response.results[0].screenshotUrls.forEach(function (uri) {
                        expect(request).toHaveBeenCalledWith(uri, options);
                    });
                    response.results[0].ipadScreenshotUrls.forEach(function (uri) {
                        expect(request).toHaveBeenCalledWith(uri, options);
                    });
                    expect(request).toHaveBeenCalledWith(response.results[0].artworkUrl512, options);
                    });

                describe('when all of the image requests are done', function() {
                    beforeEach(function(done) {

                        response.results[0].screenshotUrls.forEach(function (uri) {
                            requestDeferreds[uri].resolve({
                                'content-length': parseInt('200')
                            });
                        });
                        response.results[0].ipadScreenshotUrls.forEach(function (uri) {
                            requestDeferreds[uri].resolve({
                                'content-length': parseInt('300')
                            });
                        });
                        requestDeferreds[response.results[0].artworkUrl512].resolve({
                            'content-length': parseInt('400')
                        });

                        process.nextTick(done);
                    });

                    it('should fulfill with some data', function() {
                        expect(success).toHaveBeenCalledWith({
                            type: 'app',
                            platform: 'iOS',
                            name: response.results[0].trackCensoredName,
                            //description: response.results[0].description,
                            developer: response.results[0].artistName,
                            uri: response.results[0].trackViewUrl,
                            categories: response.results[0].genres,
                            price: response.results[0].formattedPrice,
                            rating: response.results[0].averageUserRating,
                            extID: response.results[0].trackId,
                            ratingCount: response.results[0].userRatingCount,
                            bundleId: response.results[0].bundleId,
                            images: [].concat(
                                response.results[0].screenshotUrls.map(function(uri) {
                                    return {
                                        uri: uri,
                                        type: 'screenshot',
                                        device: 'phone',
                                        fileSize: 200
                                    };
                                }),
                                response.results[0].ipadScreenshotUrls.map(function(uri) {
                                    return {
                                        uri: uri,
                                        type: 'screenshot',
                                        device: 'tablet',
                                        fileSize: 300
                                    };
                                }),
                                [
                                    {
                                        uri: response.results[0].artworkUrl512,
                                        type: 'thumbnail',
                                        device: undefined,
                                        fileSize: 400
                                    }
                                ]
                            )
                        });
                        // expect(failure).toHaveBeenCalledWith();
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

    describe('getMetadata', function() {
        var mockReq;
        var done = jasmine.createSpy('done()');

        beforeEach(function() {
            mockReq = {
                query : {
                    id: '1234' ,
                    uri: 'https://www.facebook.com/reelc/videos/1710824435853560/',
                    type: 'facebook'
                } ,
                uuid : 'testid-0000'
            };
            mockDone = jasmine.createSpy('doneSpy');
            metagetta = jasmine.createSpy('metagettaSpy').and.returnValue(
                q.resolve( {
                    id: '1234',
                    uri: 'www.suchvideo.com/muchuri=wow',
                    type: 'wtvr',
                    title: 'I is video',
                    duration: '900'
                })
            );

            metagetta.hasFacebookCreds = true;
            metagetta.hasGoogleKey = true;

        });

        describe('when no id or URI is given', function() {
            it('should throw an error',function(done) {
                delete mockReq.query.uri;
                delete mockReq.query.id;
                collateralScrape.getMetadata(mockReq, metagetta).then(function(resp) {
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(resp.code).toEqual(400);
                    expect(resp.body).toEqual('Must specify either a URI or id.');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        describe('when no type is given', function() {
            it ('should still get metadata if valid uri', function(done) {
                delete mockReq.query.type;
                collateralScrape.getMetadata(mockReq, metagetta).then(function(resp) {
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(resp.code).toEqual(200);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        describe('if given all required params', function() {
            it ('should successfully get metadata for a video', function(done) {
                collateralScrape.getMetadata(mockReq,metagetta).then(function(resp) {
                    expect(mockLog.info).toHaveBeenCalled();
                    expect(mockLog.error).not.toHaveBeenCalled();
                    expect(mockLog.warn).not.toHaveBeenCalled();
                    expect(resp.code).toEqual(200);
                    expect(resp.body).toEqual(jasmine.objectContaining({
                        id: '1234',
                        uri: 'www.suchvideo.com/muchuri=wow',
                        type: 'wtvr',
                        title: 'I is video',
                        duration: '900'
                    }));
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });
        describe('if metagetta fails', function() {
            beforeEach(function(){
                metagetta = jasmine.createSpy('metagettaSpy').and.returnValue(
                    q.reject( {
                        code: 400,
                        body: 'Error getting metadata',
                    })
                );
            });

            it ('should [400]', function(done) {
                mockReq.query.uri  = 'https://www.instagram.com/p/BGhQhO2HDyZ/?taken-by=prissy_pig';
                mockReq.query.type      = 'instagram';
                collateralScrape.getMetadata(mockReq,metagetta).then(function(resp) {
                    expect(mockLog.warn.calls.mostRecent().args[2]).toEqual('{ code: 400, body: \'Error getting metadata\' }');
                    expect(resp.code).toEqual(400);
                    expect(resp.body).toEqual('Error getting metadata');
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
        });

    });
});
