var host = process.env.host || '33.33.33.10';
var resetCollection = require('./testUtils').resetCollection;
var formatURL = require('url').format;
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

    beforeEach(function() {
        request = require('request-promise').defaults({
            jar: require('request-promise').jar(),
            resolveWithFullResponse: true,
            simple: false,
            followRedirect: false,
            headers: {
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
    });

    describe('[GET] /api/public/players/:type', function() {
        var response;
        var $;

        function getResponse(_response_) {
            response = _response_;
            try { $ = cheerio.load(response.body.toString()); } catch(e) {}
        }

        function parseResponse(type) {
            return {
                css: $('style[data-href$="' + type + '.css"]').text(),
                js: $('script[data-src$="' + type + '.js"]').text(),
                experience: JSON.parse($('script[data-src="experience"]').text()),
                seemsValid: function() {
                    return this.css.length >= 1000 && this.js.length >= 1000 && this.experience.data.deck.length > 0;
                }
            };
        }

        function getURL() {
            return formatURL(config.playerUrl);
        }

        beforeEach(function() {
            config.playerUrl.pathname = '/api/public/players/full';
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

                expect($base.attr('href')).toBe('http://localhost/apps/mini-reel-player/v1.0.0-rc2-0-ga4912c3/');
            });

            it('should inline the css', function() {
                var $css = $('style[data-href="http://localhost/apps/mini-reel-player/v1.0.0-rc2-0-ga4912c3/css/full.css"]');

                expect($css.length).toBe(1);
                expect($css.text().length).toBeGreaterThan(1000);
                expect($css.text()).toContain('url(http://localhost/apps/mini-reel-player/v1.0.0-rc2-0-ga4912c3/img/social-card-sprites.png)'); // Test CSS rebasing
            });

            it('should inline the JS', function() {
                var $js = $('script[data-src="http://localhost/apps/mini-reel-player/v1.0.0-rc2-0-ga4912c3/full.js"]');

                expect($js.length).toBe(1);
                expect($js.text().length).toBeGreaterThan(5000);
                expect($js.text()).toContain('//# sourceMappingURL=http://localhost/apps/mini-reel-player/v1.0.0-rc2-0-ga4912c3/full.js.map'); // Test JS source map rebasing
            });

            it('should inline the experience', function() {
                var $experience = $('script[data-src="experience"]');
                var responseExperience = JSON.parse($experience.text());

                expect($experience.length).toBe(1);
                expect(responseExperience.id).toBe(experience.id);
                expect(responseExperience.data.deck).toEqual(experience.data[0].data.deck);
            });

            it('should inline the branding', function() {
                var $branding = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/full/theme.css"]');
                var $brandingHover = $('head style[data-href="http://localhost/collateral/branding/digitaljournal/styles/full/theme--hover.css"]');

                expect($branding.length).toBe(1);
                expect($branding.text().length).toBeGreaterThan(500);
                expect($brandingHover.length).toBe(1);
                expect($brandingHover.text().length).toBeGreaterThan(500);
            });

            describe('and categories', function() {
                var CARD_ID = 'rc-c89f1a8f5d5af4'; // Card with comedy keyword in ADTECH
                var experience, cards, campaign;

                beforeEach(function(done) {
                    experience = readJSONSync(require.resolve('./helpers/player/minireel_with_placeholders.json'));
                    cards = readJSONSync(require.resolve('./helpers/player/cards.json'));
                    campaign = readJSONSync(require.resolve('./helpers/player/campaign_without_static_map.json'));

                    config.playerUrl.query.experience = experience.id;
                    config.playerUrl.query.categories = 'comedy';
                    config.playerUrl.query.wildCardPlacement = '3685123'; // Legit E2E test placement setup in ADTECH

                    q.all([
                        resetCollection('experiences', [experience]),
                        resetCollection('cards', cards),
                        resetCollection('campaigns', [campaign])
                    ]).then(function() {
                        return request.get(getURL());
                    }).then(getResponse).then(done, done.fail);
                });

                it('should get the cards by category', function() {
                    var $experience = $('script[data-src="experience"]');
                    var experience = JSON.parse($experience.text());

                    expect(experience.data.deck[1].id).toBe(CARD_ID);
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

                        resetCollection('campaigns', [campaign]).then(done, done.fail);
                    });

                    describe('and a valid placement', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.wildCardPlacement = '3685123'; // Legit E2E test placement setup in ADTECH

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should stick at least one of the sponsored cards in the placeholder', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var sponsoredCardId = experience.data.deck[1].id;
                            var cardIds = campaign.cards.map(function(config) { return config.id; });

                            expect(cardIds).toContain(sponsoredCardId);
                        });

                        it('should stick some ADTECH tracking pixels in the sponsored cards', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var card = experience.data.deck[1];

                            expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adcount/)]));
                            expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adlink/)]));
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

                                request.get(getURL()).then(getResponse).then(done, done.fail);
                            });

                            it('should add the pixels', function() {
                                var $experience = $('script[data-src="experience"]');
                                var experience = JSON.parse($experience.text());
                                var card = experience.data.deck[1];

                                expect(experience.data.campaign.launchUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.launchUrls.split(',')));
                                expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.countUrls.split(',')));
                                expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.playUrls.split(',')));
                            });
                        });
                    });

                    describe('and an invalid placement', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.wildCardPlacement = '3596007'; // Legit E2E test placement setup in ADTECH

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should not stick any sponsored cards in the placeholder', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var sponsoredCardId = experience.data.deck[1].id;
                            var cardIds = campaign.cards.map(function(config) { return config.id; });

                            expect(cardIds).not.toContain(sponsoredCardId);
                        });

                        it('should remove all placeholders', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var types = experience.data.deck.map(function(card) { return card.type; });

                            expect(types).not.toContain('wildcard');
                        });

                        describe('in preview mode', function() {
                            beforeEach(function(done) {
                                config.playerUrl.query.preview = true;

                                request.get(getURL()).then(getResponse).then(done, done.fail);
                            });

                            it('should remove all placeholders', function() {
                                var $experience = $('script[data-src="experience"]');
                                var experience = JSON.parse($experience.text());
                                var types = experience.data.deck.map(function(card) { return card.type; });

                                expect(types).not.toContain('wildcard');
                            });
                        });
                    });

                    describe('and no placement', function() {
                        beforeEach(function(done) {
                            delete config.playerUrl.query.wildCardPlacement;
                            config.playerUrl.query.pageUrl = 'somefakesite.com';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should not stick any sponsored cards in the placeholder', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var sponsoredCardId = experience.data.deck[1].id;
                            var cardIds = campaign.cards.map(function(config) { return config.id; });

                            expect(cardIds).not.toContain(sponsoredCardId);
                        });

                        it('should remove all placeholders', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var types = experience.data.deck.map(function(card) { return card.type; });

                            expect(types).not.toContain('wildcard');
                        });
                    });
                });

                describe('with a static card mapping', function() {
                    beforeEach(function(done) {
                        campaign = readJSONSync(require.resolve('./helpers/player/campaign_with_static_map.json'));
                        config.playerUrl.query.campaign = campaign.id;

                        resetCollection('campaigns', [campaign]).then(done, done.fail);
                    });

                    describe('and a valid placement', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.wildCardPlacement = '3685123'; // Legit E2E test placement setup in ADTECH

                            request.get(getURL()).then(getResponse).then(done, done.fail);
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

                        it('should stick some ADTECH tracking pixels in the sponsored cards', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var card1 = find(experience.data.deck, function(card) { return card.id === cards[0].id; });
                            var card2 = find(experience.data.deck, function(card) { return card.id === cards[1].id; });

                            expect(card1.campaign.countUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adcount/)]));
                            expect(card1.campaign.playUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adlink/)]));

                            expect(card2.campaign.countUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adcount/)]));
                            expect(card2.campaign.playUrls).toEqual(jasmine.arrayContaining([jasmine.stringMatching(/^http:\/\/adserver\.adtechus\.com\/adlink/)]));
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

                                request.get(getURL()).then(getResponse).then(done, done.fail);
                            });

                            it('should add the pixels', function() {
                                var $experience = $('script[data-src="experience"]');
                                var experience = JSON.parse($experience.text());
                                var card = experience.data.deck[1];

                                expect(experience.data.campaign.launchUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.launchUrls.split(',')));
                                expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.countUrls.split(',')));
                                expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.playUrls.split(',')));
                            });
                        });
                    });

                    describe('and an invalid placement', function() {
                        beforeEach(function(done) {
                            config.playerUrl.query.wildCardPlacement = '3596007'; // A valid, but incorrect, placement

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should remove all sponsored cards and placeholders', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var cardIds = experience.data.deck.map(function(card) { return card.id; });
                            var staticCardIds = Object.keys(campaign.staticCardMap[experience.id]).map(function(placeholderId) {
                                return campaign.staticCardMap[experience.id][placeholderId];
                            });
                            var types = experience.data.deck.map(function(card) { return card.type; });

                            expect(staticCardIds.length).toBeGreaterThan(0); // Double-check we're actually testing something
                            staticCardIds.forEach(function(id) {
                                expect(cardIds).not.toContain(id);
                            });
                            expect(types).not.toContain('wildcard');
                        });

                        describe('in preview mode', function() {
                            beforeEach(function(done) {
                                config.playerUrl.query.preview = true;

                                request.get(getURL()).then(getResponse).then(done, done.fail);
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

                            describe('with user-defined pixels', function() {
                                beforeEach(function(done) {
                                    config.playerUrl.query.launchUrls = 'http://c6.com/launch,http://rc.com/launch';
                                    config.playerUrl.query.countUrls = 'http://c6.com/count,http://rc.com/count';
                                    config.playerUrl.query.playUrls = 'http://c6.com/play,http://rc.com/play';

                                    request.get(getURL()).then(getResponse).then(done, done.fail);
                                });

                                it('should add the pixels', function() {
                                    var $experience = $('script[data-src="experience"]');
                                    var experience = JSON.parse($experience.text());
                                    var card = experience.data.deck[1];

                                    expect(experience.data.campaign.launchUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.launchUrls.split(',')));
                                    expect(card.campaign.countUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.countUrls.split(',')));
                                    expect(card.campaign.playUrls).toEqual(jasmine.arrayContaining(config.playerUrl.query.playUrls.split(',')));
                                });
                            });
                        });
                    });

                    describe('and no placement', function() {
                        beforeEach(function(done) {
                            delete config.playerUrl.query.wildCardPlacement;
                            config.playerUrl.query.pageUrl = 'somefakesite.com';

                            request.get(getURL()).then(getResponse).then(done, done.fail);
                        });

                        it('should remove all sponsored cards and placeholders', function() {
                            var $experience = $('script[data-src="experience"]');
                            var experience = JSON.parse($experience.text());
                            var cardIds = experience.data.deck.map(function(card) { return card.id; });
                            var staticCardIds = Object.keys(campaign.staticCardMap[experience.id]).map(function(placeholderId) {
                                return campaign.staticCardMap[experience.id][placeholderId];
                            });
                            var types = experience.data.deck.map(function(card) { return card.type; });

                            expect(staticCardIds.length).toBeGreaterThan(0); // Double-check we're actually testing something
                            staticCardIds.forEach(function(id) {
                                expect(cardIds).not.toContain(id);
                            });
                            expect(types).not.toContain('wildcard');
                        });
                    });
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
                        expect(response.statusCode).toBe(200);
                        expect(parseResponse('full').seemsValid()).toBe(true);
                        expect(parseResponse('full').experience.data.deck[0]).toEqual(experience.data[0].data.deck[0]);
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

                describe('with a mobileType param', function() {
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
                });

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

        describe('with no experience', function() {
            beforeEach(function(done) {
                request.get(getURL()).then(getResponse).then(done, done.fail);
            });

            it('should [400]', function() {
                expect(response.statusCode).toBe(400);
                expect(response.body.toString()).toBe('experience must be specified');
            });
        });
    });
});
