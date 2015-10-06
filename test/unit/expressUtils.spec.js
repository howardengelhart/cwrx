describe('expressUtils', function() {
    var parseQuery;

    beforeEach(function() {
        parseQuery = require('../../lib/expressUtils').parseQuery;
    });

    describe('parseQuery(config)', function() {
        it('should exist', function() {
            expect(parseQuery).toEqual(jasmine.any(Function));
        });

        describe('when called', function() {
            var config;
            var middleware;

            beforeEach(function() {
                config = {
                    arrays: ['names', 'ages', 'ahem']
                };

                middleware = parseQuery(config);
            });

            it('should return a Function', function() {
                expect(middleware).toEqual(jasmine.any(Function));
            });

            describe('(the middleware)', function() {
                var request, response, next;

                beforeEach(function() {
                    request = {
                        query: {
                            names: 'howard,josh, evan,   scott, true, false,22.4,44,1986,0',
                            ages: '24, 25, 88, 44, foo',
                            ahem: 'cool',
                            id: 'cam-2955fce737e487',
                            hey: 'true',
                            cool: 'FALSE',
                            hello: 'hello world!',
                            nest: {
                                needed: '0'
                            },
                            okay: 'null',
                            bleh: 'undefined',
                            age: '44',
                            temp: '98.667'
                        }
                    };
                    response = {};
                    next = jasmine.createSpy('next()');

                    middleware(request, response, next);
                });

                it('should convert Strings into Numbers', function() {
                    expect(request.query.age).toBe(44);
                    expect(request.query.temp).toBe(98.667);
                    expect(request.query.nest.needed).toBe(0);
                });

                it('should leave Strings alone', function() {
                    expect(request.query.id).toBe('cam-2955fce737e487');
                    expect(request.query.hello).toBe('hello world!');
                });

                it('should convert Strings into Booleans', function() {
                    expect(request.query.hey).toBe(true);
                    expect(request.query.cool).toBe(false);
                });

                it('should convert Strings into null and undefined', function() {
                    expect(request.query.okay).toBe(null);
                    expect(request.query.bleh).toBe(undefined);
                });

                it('should convert Strings into Arrays', function() {
                    expect(request.query.names).toEqual(['howard', 'josh', 'evan', 'scott', true, false, 22.4, 44, 1986, 0]);
                    expect(request.query.ages).toEqual([24, 25, 88, 44, 'foo']);
                    expect(request.query.ahem).toEqual(['cool']);
                });

                it('should call next()', function() {
                    expect(next).toHaveBeenCalled();
                });

                describe('when an array value is an empty String', function() {
                    beforeEach(function() {
                        next.calls.reset();
                        request.query = { names: '' };

                        middleware(request, response, next);
                    });

                    it('should make the property null', function() {
                        expect(request.query.names).toBe(null);
                    });

                    it('should call next()', function() {
                        expect(next).toHaveBeenCalled();
                    });
                });
            });

            describe('without configuration', function() {
                var request, response, next;

                beforeEach(function() {
                    request = {
                        query: {
                            names: 'howard,josh, evan,   scott, true, false,22.4,44,1986,0',
                            ages: '24, 25, 88, 44, foo',
                            ahem: 'cool',
                            id: 'cam-2955fce737e487',
                            hey: 'true',
                            cool: 'FALSE',
                            hello: 'hello world!',
                            nest: {
                                needed: '0'
                            },
                            okay: 'null',
                            bleh: 'undefined',
                            age: '44',
                            temp: '98.667'
                        }
                    };
                    response = {};
                    next = jasmine.createSpy('next()');

                    parseQuery()(request, response, next);
                });

                it('should still work', function() {
                    expect(request.query.names).toBe('howard,josh, evan,   scott, true, false,22.4,44,1986,0');
                    expect(request.query.hey).toBe(true);
                    expect(next).toHaveBeenCalled();
                });
            });
        });
    });
});
