function BrowserInfo(userAgent) {
    var $private = this.__private__ = {
        agent: userAgent
    };

    $private.isMobile = (/iPhone|Mobile Safari|Windows Phone/).test(userAgent);
    $private.isTablet = !$private.isMobile && (/Android|iPad|PlayBook|Silk/).test(userAgent);
    $private.isDesktop = !!userAgent && !$private.isTablet && !$private.isMobile;
}
Object.defineProperties(BrowserInfo.prototype, {
    agent: {
        get: function getAgent() {
            return this.__private__.agent;
        }
    },

    isMobile: {
        get: function getIsMobile() {
            return this.__private__.isMobile;
        }
    },

    isTablet: {
        get: function getIsTablet() {
            return this.__private__.isTablet;
        }
    },

    isDesktop: {
        get: function getIsDesktop() {
            return this.__private__.isDesktop;
        }
    }
});

module.exports = BrowserInfo;
