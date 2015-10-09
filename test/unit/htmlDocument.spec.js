describe('HTMLDocument(html)', function() {
    var HTMLDocument;
    var cheerio = require('cheerio');

    beforeEach(function() {
        HTMLDocument = require('../../lib/htmlDocument');
    });

    it('should exist', function() {
        expect(HTMLDocument).toEqual(jasmine.any(Function));
        expect(HTMLDocument.name).toBe('HTMLDocument');
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
                    contents = JSON.stringify({ hello: 'world', foo: '<script></script><link></link>' });

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
                    expect($script.text()).toBe(contents.replace(/<\//g, '<\\/'));
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
                        expect($script.text()).toBe(JSON.stringify(contents).replace(/<\//g, '<\\/'));
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
