describe('HTMLDocument(html)', function() {
    var HTMLDocument;
    var Zipper;
    var cheerio;
    var q;

    var MockZipper;
    var zipper;

    beforeEach(function() {
        cheerio = require('cheerio');
        q = require('q');

        delete require.cache[require.resolve('../../lib/zipper')];
        Zipper = require('../../lib/zipper');
        spyOn(require.cache[require.resolve('../../lib/zipper')], 'exports').and.callFake(function() {
            return (zipper = new Zipper());
        });
        MockZipper = require('../../lib/zipper');

        delete require.cache[require.resolve('../../lib/htmlDocument')];
        HTMLDocument = require('../../lib/htmlDocument');
    });

    it('should exist', function() {
        expect(HTMLDocument).toEqual(jasmine.any(Function));
        expect(HTMLDocument.name).toBe('HTMLDocument');
    });

    it('should create a Zipper', function() {
        expect(MockZipper).toHaveBeenCalledWith();
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
                    document = new HTMLDocument(html, { gzip: { static: 2, resource: 4 } });

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

                it('should gzip at the same levels', function(done) {
                    spyOn(zipper, 'gzip').and.returnValue(q(new Buffer('du93hr49')));
                    result.gzip().then(function() {
                        expect(zipper.gzip).toHaveBeenCalledWith(jasmine.any(String), { level: 2 });
                        expect(zipper.gzip).toHaveBeenCalledWith(jasmine.any(String), { level: 4 });
                    }).then(done, done.fail);
                });
            });

            describe('gzip()', function() {
                var success, failure;
                var buffers;

                beforeEach(function(done) {
                    success = jasmine.createSpy('success()');
                    failure = jasmine.createSpy('failure()');

                    document.addResource('experience', 'application/json', { id: 'e-hfu9yrh483ry4' });
                    document.addResource('vast', 'application/xml', '<xml></xml>');

                    buffers = {};
                    spyOn(zipper, 'gzip').and.callFake(function(string) {
                        return q(buffers[string] = new Buffer('GZIP__' + string + '__GZIP'));
                    });

                    document.gzip().then(success, failure).finally(done);
                });

                it('should gzip the static HTML at level 9', function() {
                    expect(zipper.gzip).toHaveBeenCalledWith(document.__private__.start, { level: 9 });
                    expect(zipper.gzip).toHaveBeenCalledWith(document.__private__.end, { level: 9 });
                });

                it('should gzip the resources at level 1', function() {
                    expect(document.__private__.resources.length).toBeGreaterThan(0);
                    document.__private__.resources.forEach(function(resource) {
                        expect(zipper.gzip).toHaveBeenCalledWith(resource, { level: 1 });
                    });
                });

                it('should fulfill with a Buffer that contains the entire gzipped document', function() {
                    expect(success).toHaveBeenCalledWith(jasmine.any(Buffer));
                    expect(success.calls.mostRecent().args[0].toString()).toBe(Buffer.concat([].concat(
                        [buffers[document.__private__.start]],
                        document.__private__.resources.map(function(resource) {
                            return buffers[resource];
                        }),
                        [buffers[document.__private__.end]]
                    )).toString());
                });

                describe('if instantiated with gzip level options', function() {
                    beforeEach(function(done) {
                        document = new HTMLDocument(html, { gzip: { static: 5, resource: 2 } });
                        document.addResource('experience', 'application/json', { id: 'e-hfu9yrh483ry4' });
                        document.addResource('vast', 'application/xml', '<xml></xml>');
                        zipper.gzip.calls.reset();

                        document.gzip().finally(done);
                    });

                    it('should gzip at the specified levels', function() {
                        expect(zipper.gzip).toHaveBeenCalledWith(document.__private__.start, { level: 5 });
                        expect(zipper.gzip).toHaveBeenCalledWith(document.__private__.end, { level: 5 });
                        expect(document.__private__.resources.length).toBeGreaterThan(0);
                        document.__private__.resources.forEach(function(resource) {
                            expect(zipper.gzip).toHaveBeenCalledWith(resource, { level: 2 });
                        });
                    });
                });
            });
        });
    });
});
