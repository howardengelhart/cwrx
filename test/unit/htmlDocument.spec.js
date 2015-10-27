describe('HTMLDocument(html)', function() {
    var HTMLDocument, css, js;
    var cheerio = require('cheerio');

    beforeEach(function() {
        HTMLDocument = require('../../lib/htmlDocument');
        css = require('fs').readFileSync(require.resolve('./helpers/lightbox.css')).toString();
        js = require('fs').readFileSync(require.resolve('./helpers/lightbox.js')).toString();
    });

    it('should exist', function() {
        expect(HTMLDocument).toEqual(jasmine.any(Function));
        expect(HTMLDocument.name).toBe('HTMLDocument');
    });

    describe('static:', function() {
        describe('methods:', function() {
            describe('rebaseCSS(css, base)', function() {
                var result;
                var base;

                beforeEach(function() {
                    base = 'http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/lightbox.css';
                    result = HTMLDocument.rebaseCSS(css, base);
                });

                it('should replace URLs with no quotes', function() {
                    expect(result).toContain('.player__playIcon{height:45%;width:100%;background:url(http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/img/play-icon.svg) 56% 50%/contain no-repeat}');
                });

                it('should replace URLs with single quotes', function() {
                    expect(result).toContain('.recap__imgBox{width:8em;height:5em;background:url(http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/css/img/default_square.jpg) 50% 50%/cover no-repeat;float:left;margin:0 1em 0 3em}');
                });

                it('should replace URLs with double quotes', function() {
                    expect(result).toContain('.instag____profileDesc__logo{background:url(http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/img/social-card-sprites.png) -1em -1em/19em no-repeat;width:5em;height:1.5em;margin:1em 0 0;display:block}');
                });
            });

            describe('rebaseJS(js, base)', function() {
                var result;
                var base;

                beforeEach(function() {
                    base = 'http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js';
                    result = HTMLDocument.rebaseJS(js, base);
                });

                it('should rebase single-line comment sourceMapURLs', function() {
                    expect(result).toContain('//# sourceMappingURL=http://localhost/apps/mini-reel-player/v0.25.0-0-g8b946d4/lightbox.js.map');
                });

                it('should rebase multi-line comment sourceMapURLs', function() {
                    expect(result).toContain('/*# sourceMappingURL = http://localhost/foo/lightbox.foo.js.map */');
                });
            });
        });
    });

    describe('instance:', function() {
        var html;
        var document;

        beforeEach(function() {
            html = require('fs').readFileSync(require('path').resolve(__dirname, './helpers/player.html')).toString();
            document = new HTMLDocument(html);
        });

        describe('methods:', function() {
            describe('addResource(src, type, contents)', function() {
                var src, type, contents;
                var result;
                var $;

                beforeEach(function() {
                    src = 'http://staging.cinema6.com/api/public/content/experience/e-92160a770b81d5';
                    type = 'application/json';
                    contents = JSON.stringify({ hello: 'world', foo: '<script></script><link></link><script></script>' });

                    result = document.addResource(src, type, contents);
                    $ = cheerio.load(document.toString());
                });

                it('should return itself', function() {
                    expect(result).toBe(document);
                });

                it('should add a script tag to the document with the resource', function() {
                    var $script = $('head script[data-src="' + src + '"]');

                    expect($script.length).toBe(1);
                    expect($script.attr('type')).toBe(type);
                    expect($script.attr('data-src')).toBe(src);
                    expect($script.text()).toBe(contents.replace(/<\/script>/g, '<\\/script>'));
                });

                describe('if called again', function() {
                    beforeEach(function() {
                        src = 'http://staging.cinema6.com/api/public/content/experience/e-349638d007fe9f';
                        contents = { hello: 'world', foo: '<script></script><link></link>' };

                        document.addResource(src, type, contents);
                        $ = cheerio.load(document.toString());
                    });

                    it('should add another resource', function() {
                        var $script = $('head script[data-src="' + src + '"]');

                        expect($script.length).toBe(1);
                        expect($script.attr('type')).toBe(type);
                        expect($script.attr('data-src')).toBe(src);
                        expect($script.text()).toBe(JSON.stringify(contents).replace(/<\/script>/g, '<\\/script>'));
                        expect($script.prev()[0].tagName).toBe('script');
                    });
                });
            });

            describe('toString()', function() {
                it('should return the String of HTML', function() {
                    expect(document.toString()).toBe(html);
                });
            });

            describe('clone()', function() {
                var result;
                var expectedString;

                beforeEach(function() {
                    document.addResource('experience', 'text/plain', 'Hey! Sweet...');
                    expectedString = document.toString();
                    result = document.clone();

                    document.addResource('vast', 'application/xml', '<xml>');
                });

                it('should return a copy of the document at the time it was copied', function() {
                    expect(result).toEqual(jasmine.any(HTMLDocument));
                    expect(result.constructor).toBe(HTMLDocument);

                    expect(result.toString()).toBe(expectedString);
                });
            });
        });
    });
});
