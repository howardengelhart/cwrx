describe('Aggregator(config)', function() {
    var Aggregator;
    var EventEmitter;

    beforeEach(function() {
        jasmine.clock().install();

        Aggregator = require('../../lib/aggregator');
        EventEmitter = require('events').EventEmitter;
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });

    it('should exist', function() {
        expect(Aggregator).toEqual(jasmine.any(Function));
        expect(Aggregator.name).toBe('Aggregator');
    });

    describe('instance:', function() {
        var aggregator;

        beforeEach(function() {
            aggregator = new Aggregator();
        });

        it('should be an EventEmitter', function() {
            expect(aggregator).toEqual(jasmine.any(EventEmitter));
        });

        describe('properties:', function() {
            describe('values', function() {
                it('should be an Array', function() {
                    expect(aggregator.values).toEqual([]);
                });
            });

            describe('length', function() {
                it('should be the length of the values Array', function() {
                    expect(aggregator.length).toBe(0);

                    aggregator.push(3);
                    expect(aggregator.length).toBe(1);

                    aggregator.push(12);
                    expect(aggregator.length).toBe(2);
                });
            });
        });

        describe('methods:', function() {
            describe('push(value)', function() {
                var newValue;

                beforeEach(function() {
                    newValue = jasmine.createSpy('newValue()').and.callFake(function(value) {
                        expect(aggregator.values).toContain(value);
                    });
                    aggregator.on('newValue', newValue);
                });

                it('should add the value to the values Array', function() {
                    expect(aggregator.push(10)).toBe(1);
                    expect(aggregator.values).toEqual([10]);
                    expect(newValue).toHaveBeenCalledWith(10, 1);
                    newValue.calls.reset();

                    expect(aggregator.push(3)).toBe(2);
                    expect(aggregator.values).toEqual([10, 3]);
                    expect(newValue).toHaveBeenCalledWith(3, 2);
                });
            });

            describe('getAggregateData()', function() {
                var data;

                beforeEach(function() {
                    [2, 4, 30, 22, 2, 76, 99.3, 52, 6].forEach(aggregator.push.bind(aggregator));

                    data = aggregator.getAggregateData();
                });

                it('should be an Object with info about the data', function() {
                    expect(data).toEqual({
                        max: 99.3,
                        min: 2,
                        sampleSize: 9,
                        sum: 293.3
                    });
                });
            });

            describe('flush()', function() {
                var data;
                var flush;
                var result;

                beforeEach(function() {
                    flush = jasmine.createSpy('flush()').and.callFake(function() {
                        expect(aggregator.values.length).toBe(0);
                    });
                    aggregator.on('flush', flush);

                    [4, 6, 10, 3].forEach(aggregator.push.bind(aggregator));
                    data = aggregator.getAggregateData();

                    result = aggregator.flush();
                });

                it('should return the aggregate data', function() {
                    expect(result).toEqual(data);
                });

                it('should empty the values Array', function() {
                    expect(aggregator.values).toEqual([]);
                });

                it('should emit the flush event', function() {
                    expect(flush).toHaveBeenCalledWith(data);
                });
            });

            describe('autoflush(interval)', function() {
                beforeEach(function() {
                    spyOn(Aggregator.prototype, 'flush').and.callThrough();

                    aggregator.autoflush(250);
                });

                it('should call flush() every arg[0] ms', function() {
                    jasmine.clock().tick(250);
                    expect(aggregator.flush).toHaveBeenCalled();
                    aggregator.flush.calls.reset();

                    jasmine.clock().tick(250);
                    expect(aggregator.flush).toHaveBeenCalled();
                });

                describe('when called again', function() {
                    beforeEach(function() {
                        aggregator.flush.calls.reset();
                        aggregator.autoflush(500);
                    });

                    it('should only flush on the new interval', function() {
                        jasmine.clock().tick(500);
                        expect(aggregator.flush.calls.count()).toBe(1);
                    });
                });

                describe('when called with 0', function() {
                    beforeEach(function() {
                        aggregator.autoflush(0);
                    });

                    it('should stop autoflushing', function() {
                        jasmine.clock().tick(1000);
                        expect(aggregator.flush).not.toHaveBeenCalled();
                    });
                });
            });
        });
    });
});
