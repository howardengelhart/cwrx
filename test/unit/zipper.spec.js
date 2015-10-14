describe('Zipper()', function() {
    var Zipper;
    var Readable;
    var zlib;
    var Promise;
    var Transform;
    var q;

    beforeEach(function() {
        Zipper = require('../../lib/zipper');
        Readable = require('stream').Readable;
        zlib = require('zlib');
        Promise = require('q')().constructor;
        Transform = require('stream').Transform;
        q = require('q');
    });

    it('should exist', function() {
        expect(Zipper).toEqual(jasmine.any(Function));
        expect(Zipper.name).toBe('Zipper');
    });

    describe('static', function() {
        describe('@public', function() {
            describe('classes:', function() {
                describe('StringStream(string, encoding)', function() {
                    var StringStream;

                    beforeEach(function() {
                        StringStream = Zipper.StringStream;
                    });

                    describe('@private', function() {
                        describe('instance:', function() {
                            var string, encoding;
                            var stream;

                            beforeEach(function() {
                                string = 'Hello world!';
                                encoding = 'utf8';

                                stream = new StringStream(string, encoding);
                            });

                            it('should be a Readable stream', function() {
                                expect(stream).toEqual(jasmine.any(Readable));
                                expect(Object.keys(stream)).toEqual(jasmine.arrayContaining(Object.keys(new Readable())));
                            });

                            describe('methods:', function() {
                                describe('_read()', function() {
                                    beforeEach(function() {
                                        spyOn(stream, 'push').and.callFake(function(chunk) {
                                            if (chunk === null) { expect(stream.push.calls.count()).toBeGreaterThan(1); }
                                        });

                                        stream._read();
                                    });

                                    it('should push() the String into the Stream', function() {
                                        expect(stream.push).toHaveBeenCalledWith(string, encoding);
                                    });

                                    it('should end the stream', function() {
                                        expect(stream.push).toHaveBeenCalledWith(null);
                                    });
                                });
                            });
                        });
                    });
                });
            });

            describe('methods:', function() {
                describe('gzip(string, options)', function() {
                    var StringStream;
                    var success, failure;
                    var string, options;
                    var result;

                    var gzipped;
                    var stringStream, gzipStream;

                    beforeEach(function(done) {
                        StringStream = Zipper.StringStream;

                        success = jasmine.createSpy('success()');
                        failure = jasmine.createSpy('failure()');

                        string = 'I will be gzipped.';
                        options = {
                            level: 5,
                            strategy: 3
                        };

                        gzipped = new Buffer('ahfui394yhr84d3yru34hr943ur');

                        spyOn(zlib, 'createGzip').and.callFake(function() {
                            gzipStream = new Transform();
                            spyOn(gzipStream, 'pipe').and.callThrough();
                            gzipStream._transform = function(data, encoding, callback) {
                                callback(null, gzipped);
                            };

                            return gzipStream;
                        });
                        spyOn(Zipper, 'StringStream').and.callFake(function(string, encoding) {
                            stringStream = new StringStream(string, encoding);
                            spyOn(stringStream, 'pipe').and.callThrough();

                            return stringStream;
                        });

                        result = Zipper.gzip(string, options);
                        result.then(success, failure).finally(done);
                    });

                    it('should return a Promise', function() {
                        expect(result).toEqual(jasmine.any(Promise));
                    });

                    it('should create a StringStream with the string', function() {
                        expect(Zipper.StringStream).toHaveBeenCalledWith(string);
                    });

                    it('should create a gzip stream', function() {
                        expect(zlib.createGzip).toHaveBeenCalledWith(options);
                    });

                    it('should pipe the StringStream into the gzip stream', function() {
                        expect(stringStream.pipe).toHaveBeenCalledWith(gzipStream);
                    });

                    it('should fulfill with the gzipped data', function() {
                        expect(success).toHaveBeenCalledWith(gzipped);
                    });
                });
            });
        });
    });

    describe('instance:', function() {
        var zipper;

        beforeEach(function() {
            zipper = new Zipper();
        });

        describe('@public', function() {
            describe('methods:', function() {
                describe('gzip(string, options)', function() {
                    var string, options;
                    var result;

                    beforeEach(function() {
                        string = 'I am some text.';
                        options = { level: 4 };

                        spyOn(Zipper, 'gzip').and.callFake(function() {
                            return q(new Buffer('jdi9wuhd7328yeh7382ye'));
                        });

                        result = zipper.gzip(string, options);
                    });

                    it('should call Zipper.gzip()', function() {
                        expect(Zipper.gzip).toHaveBeenCalledWith(string, options);
                    });

                    it('should return the promise returned by Zipper.gzip()', function() {
                        expect(result).toBe(Zipper.gzip.calls.mostRecent().returnValue);
                    });

                    it('should cache by the provided String', function() {
                        expect(zipper.gzip('foo')).toBe(zipper.gzip('foo'));
                        expect(zipper.gzip('bar')).toBe(zipper.gzip('bar'));
                        expect(zipper.gzip('foo')).not.toBe(zipper.gzip('bar'));
                    });

                    it('should cache by the providied options', function() {
                        expect(zipper.gzip('foo', { level: 2, strategy: 3 })).toBe(zipper.gzip('foo', { level: 2, strategy: 3 }));
                        expect(zipper.gzip('foo', { level: 9, strategy: 2 })).toBe(zipper.gzip('foo', { level: 9, strategy: 2 }));
                        expect(zipper.gzip('foo', { level: 2, strategy: 3 })).not.toBe(zipper.gzip('foo', { level: 9, strategy: 2 }));
                    });
                });
            });
        });
    });
});
