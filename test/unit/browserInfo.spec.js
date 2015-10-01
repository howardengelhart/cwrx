describe('BrowserInfo', function() {
    var BrowserInfo;

    beforeEach(function() {
        BrowserInfo = require('../../lib/browserInfo');
    });

    it('should exist', function() {
        expect(BrowserInfo).toEqual(jasmine.any(Function));
        expect(BrowserInfo.name).toBe('BrowserInfo');
    });

    [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/600.8.9 (KHTML, like Gecko) Version/8.0.8 Safari/600.8.9', // Safari
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_10_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/45.0.2454.93 Safari/537.36', // Chrome
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.10; rv:39.0) Gecko/20100101 Firefox/39.0', // Firefox
        'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.71 Safari/537.36 Edge/12.0', // Spartan
        'Mozilla/5.0 (compatible, MSIE 11, Windows NT 6.3; Trident/7.0; rv:11.0) like Gecko' // IE 11
    ].forEach(function(userAgent) {
        describe('when instantiated with "' + userAgent + '"', function() {
            var instance;

            beforeEach(function() {
                instance = new BrowserInfo(userAgent);
            });

            describe('agent', function() {
                it('should be the provided user agent', function() {
                    expect(instance.agent).toBe(userAgent);
                });
            });

            describe('isMobile', function() {
                it('should be false', function() {
                    expect(instance.isMobile).toBe(false);
                });
            });

            describe('isTablet', function() {
                it('should be false', function() {
                    expect(instance.isTablet).toBe(false);
                });
            });

            describe('isDesktop', function() {
                it('should be true', function() {
                    expect(instance.isDesktop).toBe(true);
                });
            });
        });
    });

    [
        'Mozilla/5.0 (iPad; CPU OS 7_0 like Mac OS X) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53', // iPad
        'Mozilla/5.0 (iPad; CPU OS 7_0_4 like Mac OS X) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11B554a Safari/9537.53', // iPad Mini
        'Mozilla/5.0 (PlayBook; U; RIM Tablet OS 2.1.0; en-US) AppleWebKit/536.2+ (KHTML like Gecko) Version/7.2.1.0 Safari/536.2+', // Blackberry Playbook
        'Mozilla/5.0 (Linux; Android 4.3; Nexus 10 Build/JSS15Q) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2307.2 Safari/537.36', // Nexus 10
        'Mozilla/5.0 (Linux; U; en-us; KFAPWI Build/JDQ39) AppleWebKit/535.19 (KHTML, like Gecko) Silk/3.13 Safari/535.19 Silk-Accelerated=true', // Kindle Fire HDX
        'Mozilla/5.0 (Linux; Android 4.3; Nexus 7 Build/JSS15Q) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2307.2 Safari/537.36', // Nexus 7
    ].forEach(function(userAgent) {
        describe('when instantiated with "' + userAgent + '"', function() {
            var instance;

            beforeEach(function() {
                instance = new BrowserInfo(userAgent);
            });

            describe('agent', function() {
                it('should be the provided user agent', function() {
                    expect(instance.agent).toBe(userAgent);
                });
            });

            describe('isMobile', function() {
                it('should be false', function() {
                    expect(instance.isMobile).toBe(false);
                });
            });

            describe('isTablet', function() {
                it('should be true', function() {
                    expect(instance.isTablet).toBe(true);
                });
            });

            describe('isDesktop', function() {
                it('should be false', function() {
                    expect(instance.isDesktop).toBe(false);
                });
            });
        });
    });

    [
        'Mozilla/5.0 (iPhone; U; CPU iPhone OS 4_2_1 like Mac OS X; en-us) AppleWebKit/533.17.9 (KHTML, like Gecko) Version/5.0.2 Mobile/8C148 Safari/6533.18.5', //iPhone 4
        'Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X; en-us) AppleWebKit/537.51.1 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53', // iPhone 5
        'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4', // iPhone 6
        'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.3 (KHTML, like Gecko) Version/8.0 Mobile/12A4345d Safari/600.1.4', // iPhone 6 Plus
        'Mozilla/5.0 (BB10; Touch) AppleWebKit/537.10+ (KHTML, like Gecko) Version/10.0.9.2372 Mobile Safari/537.10+', // BlackBerry Z30
        'Mozilla/5.0 (Linux; Android 4.4.2; Nexus 4 Build/KOT49H) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/35.0.1916.122 Mobile Safari/537.36', // Nexus 4
        'Mozilla/5.0 (Linux; Android 4.4.4; Nexus 5 Build/KTU84P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/38.0.2125.114 Mobile Safari/537.36', // Nexus 5
        'Mozilla/5.0 (Linux; Android 5.1.1; Nexus 6 Build/LYZ28E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/44.0.2403.20 Mobile Safari/537.36', // Nexus 6
        'Mozilla/5.0 (Linux; U; Android 4.4.2; en-us; LGMS323 Build/KOT49I.MS32310c) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/30.0.1599.103 Mobile Safari/537.36', // LG Optimus L70
        'Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch; NOKIA; Lumia 520)', // Nokia Lumina 520
        'Mozilla/5.0 (MeeGo; NokiaN9) AppleWebKit/534.13 (KHTML, like Gecko) NokiaBrowser/8.5.0 Mobile Safari/534.13', // Nokia N9
        'Mozilla/5.0 (Linux; U; Android 4.3; en-us; SM-N900T Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30', // Samsung Galaxy Note 3
        'Mozilla/5.0 (Linux; U; Android 4.1; en-us; GT-N7100 Build/JRO03C) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30', // Samsung Galaxy Note II
        'Mozilla/5.0 (Linux; U; Android 4.0; en-us; GT-I9300 Build/IMM76D) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30', // Samsung Galaxy S III
        'Mozilla/5.0 (Linux; Android 4.2.2; GT-I9505 Build/JDQ39) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/31.0.1650.59 Mobile Safari/537.36' // Samsung Galaxy S4
    ].forEach(function(userAgent) {
        describe('when instantiated with "' + userAgent + '"', function() {
            var instance;

            beforeEach(function() {
                instance = new BrowserInfo(userAgent);
            });

            describe('agent', function() {
                it('should be the provided user agent', function() {
                    expect(instance.agent).toBe(userAgent);
                });
            });

            describe('isMobile', function() {
                it('should be true', function() {
                    expect(instance.isMobile).toBe(true);
                });
            });

            describe('isTablet', function() {
                it('should be false', function() {
                    expect(instance.isTablet).toBe(false);
                });
            });

            describe('isDesktop', function() {
                it('should be false', function() {
                    expect(instance.isDesktop).toBe(false);
                });
            });
        });
    });

    describe('if instantiated with undefined', function() {
        var instance;

        beforeEach(function() {
            instance = new BrowserInfo(undefined);
        });

        describe('agent', function() {
            it('should be undefined', function() {
                expect(instance.agent).toBeUndefined();
            });
        });

        describe('isMobile', function() {
            it('should be false', function() {
                expect(instance.isMobile).toBe(false);
            });
        });

        describe('isTablet', function() {
            it('should be false', function() {
                expect(instance.isTablet).toBe(false);
            });
        });

        describe('isDesktop', function() {
            it('should be false', function() {
                expect(instance.isDesktop).toBe(false);
            });
        });
    });
});
