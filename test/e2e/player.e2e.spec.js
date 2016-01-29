var host = process.env.host || '33.33.33.10';
var resetCollection = require('./testUtils').resetCollection;
var formatURL = require('url').format;
var parseURL = require('url').parse;
var querystring = require('querystring');
var cheerio = require('cheerio');
var readFileSync = require('fs').readFileSync;
var q = require('q');
var readJSONSync = require('fs-extra').readJSONSync;

function find(array, predicate) {
    var length = array.length;

    while (length--) {
        if (predicate(array[length], length, array)) {
            return array[length];
        }
    }
}

describe('player service', function() {
    var request;
    var config;
    var systemExperience;
    var response, body, $;

    function getResponse(/*response*/) {
        response = arguments[0];

        try {
            body = JSON.parse(response.body.toString());
        } catch(e) {
            body = response.body.toString();
        }

        try {
            $ = cheerio.load(response.body.toString());
        } catch(e) {
            $ = null;
        }
    }

    function parseResponse(type) {
        return {
            css: $('style[data-href$="' + type + '.css"]').text(),
            js: $('script[data-src$="' + type + '.js"]').text(),
            experience: JSON.parse($('script[data-src="experience"]').text() || null),
            options: JSON.parse($('script[data-src="options"]').text() || null),
            buildProfile: JSON.parse($('script[data-src="build-profile"]').text() || null),
            seemsValid: function() {
                return !!(
                    this.css.length >= 1000 &&
                    this.js.length >= 1000 &&
                    this.experience.data.deck.length > 0 &&
                    this.options && this.options.type === type &&
                    this.buildProfile && this.buildProfile.type === type
                );
            }
        };
    }

    function getURL() {
        return formatURL(config.playerUrl);
    }

    beforeEach(function(done) {
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;

        request = require('request-promise').defaults({
            jar: require('request-promise').jar(),
            resolveWithFullResponse: true,
            simple: false,
            followRedirect: false,
            headers: {
                'Origin': 'https://imasdk.googleapis.com',
                'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/41.0.2228.0 Safari/537.36'
            }
        });

        config = {
            playerUrl: {
                protocol: 'http:',
                host: host,
                query: {}
            }
        };

        systemExperience = readJSONSync(require.resolve('./helpers/player/default_experience.json'));
        resetCollection('experiences', [systemExperience]).then(done, done.fail);
    });

    afterEach(function() {
        response = undefined;
        body = undefined;
        $ = undefined;
    });

    describe('[GET] /api/players/meta', function() {
        beforeEach(function(done) {
            config.playerUrl.pathname = '/api/players/meta';

            request.get({ url: formatURL(config.playerUrl) }).then(getResponse).then(done, done.fail);
        });

        it('should return some metadata', function() {
            expect(body).toEqual({
                serviceVersion: jasmine.any(String),
                playerVersion: 'master',
                started: jasmine.any(String),
                status: 'OK'
            });
        });
    });

    describe('[GET] /api/public/players/:type', function() {
        beforeEach(function() {
            config.playerUrl.pathname = '/api/public/players/lightbox';
        });

        describe('with an experience', function(done) {
            var experience;

            beforeEach(function(done) {
                experience = readJSONSync(require.resolve('./helpers/player/minireel_without_placeholders.json'));
                config.playerUrl.query.experience = experience.id;

                resetCollection('experiences', [experience]).then(function() {
                    return request.get({ url: getURL() });
                }).then(getResponse).then(done, done.fail);
            });

            it('should succeed', function() {
                expect(response.statusCode).toBe(200);
                expect(response.body.toString().length).toBeGreaterThan(200000);
                expect($.html()).toBe(response.body.toString());
            });

            it('should change the <base>', function() {
                var $base = $('base');

                expect($base.attr('href')).toBe('http://localhost/static/player/master/');
            });

            it('should inline the css', function() {
                var $css = $('style[data-href="./css/lightbox.css"]');

                expect($css.length).toBe(1);
                expect($css.text().length).toBeGreaterThan(1000);
                expect($css.text()).toContain('url(./img/social-card-sprites.png)'); // Test CSS rebasing
            });

            it('should inline the JS', function() {
                var $js = $('script[data-src="../src/lightbox.js"]');

                expect($js.length).toBe(1);
                expect($js.text().length).toBeGreaterThan(5000);
            });

            it('should inline the experience', function() {
                var $experience = $('script[data-src="experience"]');
                var responseExperience = JSON.parse($experience.text());

                expect($experience.length).toBe(1);
                expect(responseExperience.id).toBe(experience.id);
                expect(responseExperience.data.deck).toEqual(experience.data[0].data.deck.map(function(card) {
                    card.data.prebuffer = false;

                    return card;
                }));
            });

            it('should inline the options', function() {
                var options = JSON.parse($('script[data-src="options"]').text());

                expect(options).toEqual({
                    type: 'lightbox',
                    reqUuid: jasmine.any(String),
                    origin: 'https://imasdk.googleapis.com/',
                    desktop: true,
                    mobile: false,
                    secure: false,
                    experience: experience.id,
                    context: 'standalone',
                    container: 'standalone',
                    mobileType: 'mobile',
                    standalone: true,
                    interstitial: false,
                    autoLaunch: true,
                    $params: config.playerUrl.query
                });
            });

            it('should inline the build profile', function() {
                var buildProfile = JSON.parse($('script[data-src="build-profile"]').text() || null);

                expect(buildProfile).toEqual({
                    type: 'lightbox',
                    context: 'standalone',

                    debug: false,
                    secure: false,

                    isMiniReel: true,
                    card: {
                        types: ['recap', 'youtube'],
                        modules: ['ballot']
                    }
                });
            });

            it('should inline the branding', function() {
                var $branding = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/lightbox/theme.css"]');
                var $brandingHover = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/lightbox/theme--hover.css"]');

                expect($branding.length).toBe(1);
                expect($branding.text().length).toBeGreaterThan(500);
                expect($brandingHover.length).toBe(1);
                expect($brandingHover.text().length).toBeGreaterThan(500);
            });

            ['mraid', 'vpaid', 'embed', 'standalone'].forEach(function(context) {
                describe('if the context is "' + context + '"', function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.context = context;

                        return request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should not make the first card not preload', function() {
                        var experience = parseResponse('lightbox').experience;

                        expect(experience.data.deck[0].data.preload).toBeUndefined();
                    });

                    it('should provide the player', function() {
                        expect(parseResponse('lightbox').seemsValid()).toBe(true);
                    });
                });
            });

            describe('and a campaign', function() {
                var campaign, cards;

                beforeEach(function(done) {
                    experience = readJSONSync(require.resolve('./helpers/player/minireel_with_placeholders.json'));
                    cards = readJSONSync(require.resolve('./helpers/player/cards.json'));

                    config.playerUrl.query.experience = experience.id;

                    q.all([
                        resetCollection('experiences', [experience]),
                        resetCollection('cards', cards)
                    ]).then(done, done.fail);
                });

                describe('with no static card mapping', function() {
                    beforeEach(function(done) {
                        campaign = readJSONSync(require.resolve('./helpers/player/campaign_without_static_map.json'));
                        config.playerUrl.query.campaign = campaign.id;

                        resetCollection('campaigns', [campaign]).then(function() {
                            return request.get(getURL()).then(getResponse);
                        }).then(done, done.fail);
                    });

                    it('should stick at least one of the sponsored cards in the placeholder', function() {
                        var $experience = $('script[data-src="experience"]');
                        var experience = JSON.parse($experience.text());
                        var sponsoredCardId = experience.data.deck[1].id;
                        var cardIds = campaign.cards.map(function(config) { return config.id; });

                        expect(cardIds).toContain(sponsoredCardId);
                    });

                    it('should inline the build profile', function() {
                        var buildProfile = JSON.parse($('script[data-src="build-profile"]').text() || null);

                        expect(buildProfile).toEqual({
                            type: 'lightbox',
                            context: 'standalone',

                            debug: false,
                            secure: false,

                            isMiniReel: true,
                            card: {
                                types: ['recap', 'youtube'],
                                modules: []
                            }
                        });
                    });

                    it('should remove all placeholders', function() {
                        var $experience = $('script[data-src="experience"]');
                        var experience = JSON.parse($experience.text());
                        var types = experience.data.deck.map(function(card) { return card.type; });

                        expect(types).not.toContain('wildcard');
                    });

                    describe('and lots of tracking parameters', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.container = 'beeswax';
                            config.playerUrl.query.placement = 'pl-7c0f526f86d41f';
                            config.playerUrl.query.hostApp = 'My Talking Tom';
                            config.playerUrl.query.network = 'MoPub';
                            config.playerUrl.query.uuid = 'rd8392eh3';
                            config.playerUrl.query.branding = 'rcplatform';
                            config.playerUrl.query.ex = 'My Awesome Experiment';
                            config.playerUrl.query.vr = 'The Great Variant';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should add tracking pixels to the card', function() {
                            var card = parseResponse('lightbox').experience.data.deck[1];

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
                                var pixels = card.campaign[item.prop];

                                expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                                    protocol: 'https:',
                                    host: 's3.amazonaws.com',
                                    pathname: '/c6.dev/e2e/1x1-pixel.gif',
                                    query: {
                                        campaign: card.campaignId,
                                        card: card.id,
                                        experience: experience.id,
                                        container: config.playerUrl.query.container,
                                        placement: config.playerUrl.query.placement,
                                        host: 'imasdk.googleapis.com',
                                        hostApp: config.playerUrl.query.hostApp,
                                        network: config.playerUrl.query.network,
                                        sessionId: jasmine.any(String),
                                        extSessionId: config.playerUrl.query.uuid,
                                        branding: config.playerUrl.query.branding,
                                        ex: config.playerUrl.query.ex,
                                        vr: config.playerUrl.query.vr,
                                        event: item.event,
                                        d: '{delay}',
                                        cb: '{cachebreaker}'
                                    }
                                }));
                            });

                            Object.keys(card.links).forEach(function(type) {
                                var pixels = card.links[type].tracking;

                                expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                                    protocol: 'https:',
                                    host: 's3.amazonaws.com',
                                    pathname: '/c6.dev/e2e/1x1-pixel.gif',
                                    query: {
                                        campaign: card.campaignId,
                                        card: card.id,
                                        experience: experience.id,
                                        container: config.playerUrl.query.container,
                                        placement: config.playerUrl.query.placement,
                                        host: 'imasdk.googleapis.com',
                                        hostApp: config.playerUrl.query.hostApp,
                                        network: config.playerUrl.query.network,
                                        sessionId: jasmine.any(String),
                                        extSessionId: config.playerUrl.query.uuid,
                                        branding: config.playerUrl.query.branding,
                                        ex: config.playerUrl.query.ex,
                                        vr: config.playerUrl.query.vr,
                                        event: 'link.' + type,
                                        d: '{delay}',
                                        cb: '{cachebreaker}'
                                    }
                                }));
                            });

                            Object.keys(card.shareLinks).forEach(function(type) {
                                var pixels = card.shareLinks[type].tracking;

                                expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                                    protocol: 'https:',
                                    host: 's3.amazonaws.com',
                                    pathname: '/c6.dev/e2e/1x1-pixel.gif',
                                    query: {
                                        campaign: card.campaignId,
                                        card: card.id,
                                        experience: experience.id,
                                        container: config.playerUrl.query.container,
                                        placement: config.playerUrl.query.placement,
                                        host: 'imasdk.googleapis.com',
                                        hostApp: config.playerUrl.query.hostApp,
                                        network: config.playerUrl.query.network,
                                        sessionId: jasmine.any(String),
                                        extSessionId: config.playerUrl.query.uuid,
                                        branding: config.playerUrl.query.branding,
                                        ex: config.playerUrl.query.ex,
                                        vr: config.playerUrl.query.vr,
                                        event: 'shareLink.' + type,
                                        d: '{delay}',
                                        cb: '{cachebreaker}'
                                    }
                                }));
                            });
                        });
                    });

                    describe('with user-defined pixels', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.launchUrls = 'http://c6.com/launch,http://rc.com/launch';
                            config.playerUrl.query.countUrls = 'http://c6.com/count,http://rc.com/count';
                            config.playerUrl.query.playUrls = 'http://c6.com/play,http://rc.com/play';
                            config.playerUrl.query.clickUrls = 'http://c6.com/click,http://rc.com/click';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should add the pixels', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var card = experience.data.deck[1];

                            expect(card.campaign.launchUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.launchUrls.split(',')));
                            expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.countUrls.split(',')));
                            expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.playUrls.split(',')));

                            expect(Object.keys(card.links).length).toBeGreaterThan(0);
                            Object.keys(card.links).forEach(function(type) {
                                expect(card.links[type].tracking).toEqual(jasmine.arrayContaining(config.playerUrl.query.clickUrls.split(',')), type);
                            });

                            expect(Object.keys(card.shareLinks).length).toBeGreaterThan(0);
                            Object.keys(card.shareLinks).forEach(function(type) {
                                expect(card.shareLinks[type].tracking).toEqual(jasmine.arrayContaining(config.playerUrl.query.clickUrls.split(',')), type);
                            });
                        });
                    });
                });

                describe('with a static card mapping', function() {
                    beforeEach(function(done) {
                        campaign = readJSONSync(require.resolve('./helpers/player/campaign_with_static_map.json'));
                        config.playerUrl.query.campaign = campaign.id;

                        resetCollection('campaigns', [campaign]).then(function() {
                            return request.get(getURL()).then(getResponse);
                        }).then(done, done.fail);
                    });

                    it('should keep the sponsored cards in the deck', function() {
                        var $experience = $('script[data-src="experience"]');
                        var experience = JSON.parse($experience.text());
                        var cardIds = experience.data.deck.map(function(card) { return card.id; });
                        var staticCardIds = Object.keys(campaign.staticCardMap[experience.id]).map(function(placeholderId) {
                            return campaign.staticCardMap[experience.id][placeholderId];
                        });

                        expect(experience.data.deck[1].id).toBe('rc-0a8a41066c1c7b');
                        expect(experience.data.deck[3].id).toBe('rc-2b278986abacf8');
                    });

                    it('should inline the build profile', function() {
                        var buildProfile = JSON.parse($('script[data-src="build-profile"]').text() || null);

                        expect(buildProfile).toEqual({
                            type: 'lightbox',
                            context: 'standalone',

                            debug: false,
                            secure: false,

                            isMiniReel: true,
                            card: {
                                types: ['adUnit', 'recap', 'youtube'],
                                modules: []
                            }
                        });
                    });

                    it('should remove all placeholders', function() {
                        var $experience = $('script[data-src="experience"]');
                        var experience = JSON.parse($experience.text());
                        var types = experience.data.deck.map(function(card) { return card.type; });

                        expect(types).not.toContain('wildcard');
                    });

                    describe('with user-defined pixels', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.launchUrls = 'http://c6.com/launch,http://rc.com/launch';
                            config.playerUrl.query.countUrls = 'http://c6.com/count,http://rc.com/count';
                            config.playerUrl.query.playUrls = 'http://c6.com/play,http://rc.com/play';
                            config.playerUrl.query.clickUrls = 'http://c6.com/click,http://rc.com/click';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should add the pixels', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var card = experience.data.deck[1];

                            expect(card.campaign.launchUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.launchUrls.split(',')));
                            expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.countUrls.split(',')));
                            expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.playUrls.split(',')));

                            expect(Object.keys(card.links).length).toBeGreaterThan(0);
                            Object.keys(card.links).forEach(function(type) {
                                expect(card.links[type].tracking).toEqual(jasmine.arrayContaining(config.playerUrl.query.clickUrls.split(',')), type);
                            });

                            expect(Object.keys(card.shareLinks).length).toBeGreaterThan(0);
                            Object.keys(card.shareLinks).forEach(function(type) {
                                expect(card.shareLinks[type].tracking).toEqual(jasmine.arrayContaining(config.playerUrl.query.clickUrls.split(',')), type);
                            });
                        });
                    });
                });
            });

            describe('and a card', function() {
                beforeEach(function(done) {
                    config.playerUrl.query.card = 'rc-abaddbbd3e050b';

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should [400]', function() {
                    expect(response.statusCode).toBe(400);
                    expect(response.body.toString()).toBe('You may specify an experience or card, not both.');
                });
            });

            describe('in vpaid mode', function() {
                beforeEach(function() {
                    config.playerUrl.query.vpaid = true;
                });

                describe('with one card', function() {
                    beforeEach(function(done) {
                        experience.data[0].data.deck.length = 1;
                        experience.id = 'e-ur8934r37438789';
                        config.playerUrl.query.experience = experience.id;

                        resetCollection('experiences', [experience]).then(function() {
                            return request.get(getURL());
                        }).then(getResponse).then(done, done.fail);
                    });

                    it('should [200]', function() {
                        experience.data[0].data.deck[0].data.prebuffer = false;

                        expect(response.statusCode).toBe(200);
                        expect(parseResponse('lightbox').seemsValid()).toBe(true);
                        expect(parseResponse('lightbox').experience.data.deck[0]).toEqual(experience.data[0].data.deck[0]);
                    });
                });

                describe('with many cards', function() {
                    beforeEach(function(done) {
                        experience.data[0].data.deck.length = 3;
                        experience.id = 'e-jdy3i476eie8';
                        config.playerUrl.query.experience = experience.id;

                        resetCollection('experiences', [experience]).then(function() {
                            return request.get(getURL());
                        }).then(getResponse).then(done, done.fail);
                    });

                    it('should [400]', function() {
                        expect(response.statusCode).toBe(400);
                        expect(response.body.toString()).toBe('VPAID does not support MiniReels.');
                    });
                });
            });

            describe('that has no cards', function() {
                beforeEach(function(done) {
                    experience.data[0].data.deck.length = 0;
                    experience.id = 'e-738yr7348rg74';
                    config.playerUrl.query.experience = experience.id;

                    resetCollection('experiences', [experience]).then(function() {
                        return request.get(getURL());
                    }).then(getResponse).then(done, done.fail);
                });

                it('should [409]', function() {
                    expect(response.statusCode).toBe(409);
                    expect(response.body.toString()).toBe('Experience {' + experience.id + '} has no cards.');
                });
            });

            describe('but an invalid player type', function() {
                beforeEach(function(done) {
                    config.playerUrl.pathname = '/api/public/players/uwrhfdsjf';

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should [404]', function() {
                    expect(response.statusCode).toBe(404);
                    expect(response.body.toString()).toBe('Unknown player type: uwrhfdsjf');
                });
            });

            describe('on a mobile device', function() {
                beforeEach(function(done) {
                    request = request.defaults({
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4'
                        }
                    });

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should redirect to the mobile player', function() {
                    expect(response.statusCode).toBe(303);
                    expect(response.headers.location).toBe('mobile?experience=e-6f9a14a4b10263');
                });

                // We only support one mobile player now, so this is kind of impossible to E2E
                // test at the moment...
                /*describe('with a mobileType param', function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.mobileType = 'swipe';

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should redirect to the specified mobileType', function() {
                        expect(response.statusCode).toBe(303);
                        expect(response.headers.location).toBe('swipe?experience=e-6f9a14a4b10263&mobileType=swipe');
                    });

                    describe('on the proper endpoint', function() {
                        beforeEach(function(done) {
                            config.playerUrl.pathname = '/api/public/players/swipe';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should [200]', function() {
                            expect(response.statusCode).toBe(200);
                            expect(parseResponse('swipe').seemsValid()).toBe(true);
                        });
                    });
                });*/

                describe('for the mobile player', function() {
                    beforeEach(function(done) {
                        config.playerUrl.pathname = '/api/public/players/mobile';

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should not inline the hover branding', function() {
                        var $branding = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/mobile/theme.css"]');
                        var $brandingHover = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/mobile/theme--hover.css"]');

                        expect($branding.length).toBe(1);
                        expect($branding.text().length).toBeGreaterThan(500);
                        expect($brandingHover.length).toBe(0);
                    });
                });
            });
        });

        describe('with a card', function() {
            var cards;

            beforeEach(function(done) {
                cards = readJSONSync(require.resolve('./helpers/player/cards.json'));

                config.playerUrl.pathname = '/api/public/players/light';
                config.playerUrl.query.card = cards[0].id;

                resetCollection('cards', cards).then(function() {
                    return request.get(getURL()).then(getResponse);
                }).then(done, done.fail);
            });

            describe('and a campaign', function() {
                describe('that matches the card', function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.campaign = cards[0].campaignId;

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should succeed', function() {
                        expect(parseResponse('light').seemsValid()).toBe(true);
                    });
                });

                describe('that does not match the card', function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.campaign = 'cam-9feeb5f2aa3563';

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should [400]', function() {
                        expect(response.statusCode).toBe(400);
                        expect(response.body).toBe('Card\'s campaign {' + cards[0].campaignId + '} does not match specified campaign {' + config.playerUrl.query.campaign + '}.');
                    });
                });
            });

            it('should load the card into the default experience', function() {
                var parsed = parseResponse('light');
                var experience = parsed.experience;

                expect(experience.id).toBe(systemExperience.id);
                expect(experience.data.title).toBe(cards[0].title);
                expect(experience.data.deck[0].id).toBe(cards[0].id);
                expect(experience.data.deck.length).toBe(1);
            });

            it('should set the prebuffer property on the card', function() {
                var card = parseResponse('light').experience.data.deck[0];

                expect(card.data.prebuffer).toBe(false);
            });

            it('should load the player', function() {
                expect(parseResponse('light').seemsValid()).toBe(true);
            });

            it('should inline the build profile', function() {
                expect(parseResponse('light').buildProfile).toEqual({
                    type: 'light',
                    context: 'standalone',

                    debug: false,
                    secure: false,

                    isMiniReel: false,
                    card: {
                        types: ['adUnit'],
                        modules: []
                    }
                });
            });

            describe('and lots of tracking parameters', function() {
                beforeEach(function(done) {
                    config.playerUrl.query.container = 'beeswax';
                    config.playerUrl.query.placement = 'pl-7c0f526f86d41f';
                    config.playerUrl.query.hostApp = 'My Talking Tom';
                    config.playerUrl.query.network = 'MoPub';
                    config.playerUrl.query.uuid = 'rd8392eh3';
                    config.playerUrl.query.branding = 'rcplatform';
                    config.playerUrl.query.ex = 'My Awesome Experiment';
                    config.playerUrl.query.vr = 'The Great Variant';

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should add tracking pixels to the card', function() {
                    var card = parseResponse('light').experience.data.deck[0];

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
                        var pixels = card.campaign[item.prop];

                        expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                            protocol: 'https:',
                            host: 's3.amazonaws.com',
                            pathname: '/c6.dev/e2e/1x1-pixel.gif',
                            query: {
                                campaign: card.campaignId,
                                card: card.id,
                                experience: 'e-00000000000000',
                                container: config.playerUrl.query.container,
                                placement: config.playerUrl.query.placement,
                                host: 'imasdk.googleapis.com',
                                hostApp: config.playerUrl.query.hostApp,
                                network: config.playerUrl.query.network,
                                sessionId: jasmine.any(String),
                                extSessionId: config.playerUrl.query.uuid,
                                branding: config.playerUrl.query.branding,
                                ex: config.playerUrl.query.ex,
                                vr: config.playerUrl.query.vr,
                                event: item.event,
                                d: '{delay}',
                                cb: '{cachebreaker}'
                            }
                        }), item.prop);
                    });

                    Object.keys(card.links).forEach(function(type) {
                        var pixels = card.links[type].tracking;

                        expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                            protocol: 'https:',
                            host: 's3.amazonaws.com',
                            pathname: '/c6.dev/e2e/1x1-pixel.gif',
                            query: {
                                campaign: card.campaignId,
                                card: card.id,
                                experience: 'e-00000000000000',
                                container: config.playerUrl.query.container,
                                placement: config.playerUrl.query.placement,
                                host: 'imasdk.googleapis.com',
                                hostApp: config.playerUrl.query.hostApp,
                                network: config.playerUrl.query.network,
                                sessionId: jasmine.any(String),
                                extSessionId: config.playerUrl.query.uuid,
                                branding: config.playerUrl.query.branding,
                                ex: config.playerUrl.query.ex,
                                vr: config.playerUrl.query.vr,
                                event: 'link.' + type,
                                d: '{delay}',
                                cb: '{cachebreaker}'
                            }
                        }));
                    });

                    Object.keys(card.shareLinks).forEach(function(type) {
                        var pixels = card.shareLinks[type].tracking;

                        expect(parseURL('https:' + pixels[pixels.length - 1], true)).toEqual(jasmine.objectContaining({
                            protocol: 'https:',
                            host: 's3.amazonaws.com',
                            pathname: '/c6.dev/e2e/1x1-pixel.gif',
                            query: {
                                campaign: card.campaignId,
                                card: card.id,
                                experience: 'e-00000000000000',
                                container: config.playerUrl.query.container,
                                placement: config.playerUrl.query.placement,
                                host: 'imasdk.googleapis.com',
                                hostApp: config.playerUrl.query.hostApp,
                                network: config.playerUrl.query.network,
                                sessionId: jasmine.any(String),
                                extSessionId: config.playerUrl.query.uuid,
                                branding: config.playerUrl.query.branding,
                                ex: config.playerUrl.query.ex,
                                vr: config.playerUrl.query.vr,
                                event: 'shareLink.' + type,
                                d: '{delay}',
                                cb: '{cachebreaker}'
                            }
                        }));
                    });
                });
            });

            describe('and no Origin', function() {
                beforeEach(function(done) {
                    request = request.defaults({
                        headers: {
                            'Origin': '',
                            'Referer': ''
                        }
                    });

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should succeed', function() {
                    expect(parseResponse('light').seemsValid()).toBe(true);
                });

                it('should use the default origin', function() {
                    expect(parseResponse('light').options.origin).toBe('http://www.cinema6.com/');
                });
            });

            describe('and no countdown configuration', function() {
                beforeEach(function(done) {
                    delete config.playerUrl.query.countdown;

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should respond with a player', function() {
                    expect(parseResponse('light').seemsValid()).toBe(true);
                });

                it('should not change the card\'s skip setting', function() {
                    var card = parseResponse('light').experience.data.deck[0];

                    expect(card.data.skip).toBe(cards[0].data.skip);
                });
            });

            [true, false, 30].forEach(function(value) {
                describe('and a countdown configuration of ' + value, function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.countdown = value;

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should set the card\'s skip property to ' + value, function() {
                        var card = parseResponse('light').experience.data.deck[0];

                        expect(card.data.skip).toBe(value);
                    });
                });
            });

            describe('and skip: true', function() {
                beforeEach(function(done) {
                    config.playerUrl.query.prebuffer = true;

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should set the prebuffer property on the card to true', function() {
                    var card = parseResponse('light').experience.data.deck[0];

                    expect(card.data.prebuffer).toBe(true);
                });
            });

            [false, 0, true, 1, 2].forEach(function(debug) {
                describe('and debug: ' + debug, function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.debug = debug;

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should serve minified code', function() {
                        expect((parseResponse('light').js.match(/\n/g).length)).toBeLessThan(50);
                    });
                });
            });

            [3, 4, 5, 6].forEach(function(debug) {
                describe('and debug: ' + debug, function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.debug = debug;

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should serve unminified code', function() {
                        expect((parseResponse('light').js.match(/\n/g).length)).toBeGreaterThan(500);
                    });
                });
            });
        });

        describe('with a campaign', function() {
            var cards;

            beforeEach(function(done) {
                cards = readJSONSync(require.resolve('./helpers/player/cards.json'));

                config.playerUrl.pathname = '/api/public/players/light';
                config.playerUrl.query.campaign = 'cam-7637703876d1f5';

                resetCollection('cards', cards).then(function() {
                    return request.get(getURL()).then(getResponse);
                }).then(done, done.fail);
            });

            it('should load the card into the default experience', function() {
                var parsed = parseResponse('light');
                var experience = parsed.experience;

                expect(experience.id).toBe(systemExperience.id);
                expect(cards.slice(0, 2).map(function(card) { return card.title; })).toContain(experience.data.title);
                expect(cards.slice(0, 2).map(function(card) { return card.id; })).toContain(experience.data.deck[0].id);
                expect(experience.data.deck.length).toBe(1);
            });

            it('should load the player', function() {
                expect(parseResponse('light').seemsValid()).toBe(true);
            });

            it('should inline the build profile', function() {
                expect(parseResponse('light').buildProfile).toEqual({
                    type: 'light',
                    context: 'standalone',

                    debug: false,
                    secure: false,

                    isMiniReel: false,
                    card: {
                        types: ['adUnit'],
                        modules: []
                    }
                });
            });
        });

        describe('with no experience, card, or campaign campaign', function() {
            beforeEach(function(done) {
                request.get(getURL()).then(getResponse).then(done, done.fail);
            });

            it('should [400]', function() {
                expect(response.statusCode).toBe(400);
                expect(response.body.toString()).toBe('You must specify either an experience, card or campaign.');
            });

            describe('but with embed=true', function() {
                beforeEach(function(done) {
                    config.playerUrl.query.embed = true;

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should [200]', function() {
                    expect(response.statusCode).toBe(200);
                });

                it('should inline the assets but not include an experience', function() {
                    var parsed = parseResponse('lightbox');

                    expect(parsed.js.length).toBeGreaterThan(2000);
                    expect(parsed.css.length).toBeGreaterThan(1000);
                    expect(parsed.experience).toBeNull();
                    expect(parsed.options).toEqual(jasmine.objectContaining({
                        type: 'lightbox',
                        reqUuid: jasmine.any(String)
                    }));
                    expect($('base').attr('href')).toBe('http://localhost/static/player/master/');
                });

                it('should inline the build profile', function() {
                    expect(parseResponse('light').buildProfile).toEqual({
                        type: 'lightbox',
                        context: 'standalone',

                        debug: false,
                        secure: false,

                        isMiniReel: null,
                        card: {
                            types: null,
                            modules: null
                        }
                    });
                });

                describe('and a branding', function() {
                    beforeEach(function(done) {
                        config.playerUrl.query.branding = 'digitaljournal';

                        request.get(getURL()).then(getResponse).then(done, done.fail);
                    });

                    it('should inline the branding', function() {
                        var $branding = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/lightbox/theme.css"]');
                        var $brandingHover = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/lightbox/theme--hover.css"]');

                        expect($branding.length).toBe(1);
                        expect($branding.text().length).toBeGreaterThan(500);
                        expect($brandingHover.length).toBe(1);
                        expect($brandingHover.text().length).toBeGreaterThan(500);
                    });
                });
            });
        });

        [
            { old: 'lightbox-playlist', new: 'lightbox' },
            { old: 'full', new: 'full-np' },
            { old: 'solo-ads', new: 'solo' },
            { old: 'swipe', new: 'mobile' }
        ].forEach(function(types) {
            describe('with the ' + types.old + ' player', function() {
                beforeEach(function(done) {
                    config.playerUrl.pathname = '/api/public/players/' + types.old;
                    config.playerUrl.query = {
                        card: 'rc-77d7314f0cfa59',
                        preview: true,
                        container: 'jun'
                    };

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should redirect to the ' + types.new + ' player', function() {
                    expect(response.statusCode).toBe(301);
                    expect(response.headers.location).toBe(types.new + formatURL({ query: config.playerUrl.query }));
                });
            });
        });
    });

    describe('[GET] /api/public/player', function() {
        var placement, card, campaign;

        beforeEach(function(done) {
            placement = require('./helpers/player/placement.json');
            card = require('./helpers/player/cards.json')[1];
            campaign = require('./helpers/player/campaign_with_static_map.json');

            expect(placement.tagParams.card).toBe(card.id);
            expect(card.campaignId).toBe(campaign.id);
            expect(placement.tagParams.campaign).toBe(campaign.id);

            q.all([
                resetCollection('placements', [placement]),
                resetCollection('cards', [card]),
                resetCollection('campaigns', [campaign])
            ]).then(done, done.fail);

            config.playerUrl.pathname = '/api/public/player';
        });

        describe('without a placement', function() {
            beforeEach(function(done) {
                request.get(getURL()).then(getResponse).then(done, done.fail);
            });

            it('should [400]', function() {
                expect(response.statusCode).toBe(400);
                expect(body).toBe('You must provide a placement.');
            });
        });

        describe('with a placement', function() {
            beforeEach(function(done) {
                config.playerUrl.query.placement = placement.id;
                config.playerUrl.query.playUrls = 'https://tracking.com/pixel.gif?event=play';
                config.playerUrl.query.debug = 2;

                request.get(getURL()).then(getResponse).then(done, done.fail);
            });

            it('should return a valid player', function() {
                expect(parseResponse('light').seemsValid()).toBe(true);
            });

            it('should create options by combining the options from the placement with the ones in the query params', function() {
                expect(parseResponse('light').options).toEqual({
                    container: 'reactx',
                    campaign: 'cam-7637703876d1f5',
                    card: 'rc-2b278986abacf8',
                    type: 'light',
                    debug: 2,
                    reqUuid: jasmine.any(String),
                    origin: 'https://imasdk.googleapis.com/',
                    desktop: true,
                    mobile: false,
                    secure: false,
                    placement: 'pl-83bc832ca2b056',
                    playUrls: ['https://tracking.com/pixel.gif?event=play'],
                    context: 'standalone',
                    mobileType: 'mobile',
                    standalone: true,
                    interstitial: false,
                    autoLaunch: true,
                    $params: {
                        placement: 'pl-83bc832ca2b056',
                        playUrls: [ 'https://tracking.com/pixel.gif?event=play' ],
                        debug: 2
                    }
                });
            });

            it('should get the creative from the placement', function() {
                expect(parseResponse('light').experience.data.deck[0].id).toBe(card.id);
            });

            describe('on a mobile device', function() {
                beforeEach(function(done) {
                    request = request.defaults({
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4'
                        }
                    });

                    request.get(getURL()).then(getResponse).then(done, done.fail);
                });

                it('should serve the mobile player', function() {
                    expect(parseResponse('mobile').seemsValid()).toBe(true);
                });

                it('should make the options reflect the substituted player', function() {
                    expect(parseResponse('mobile').options).toEqual(jasmine.objectContaining({
                        desktop: false,
                        mobile: true,
                        type: 'mobile'
                    }));
                });
            });
        });
    });
});
