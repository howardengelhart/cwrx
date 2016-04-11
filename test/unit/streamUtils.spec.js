var streamUtils = require('../../lib/streamUtils'),
    rcKinesis = require('rc-kinesis'),
    q = require('q');

describe('streamUtils', function() {
    var mockProducer;
    
    beforeEach(function() {
        mockProducer = {
            produce: jasmine.createSpy('produce()')
        };
        spyOn(rcKinesis, 'JsonProducer').and.returnValue(mockProducer);
    });
    
    afterEach(function() {
        streamUtils.producer = null;
    });
    
    it('should initialize the producer to null', function() {
        expect(streamUtils.producer).toBeNull();
    });
    
    describe('createProducer', function() {
        it('should create a JsonProducer', function() {
            streamUtils.createProducer({
                streamName: 'sillyStream',
                region: 'narnia'
            });
            expect(rcKinesis.JsonProducer).toHaveBeenCalledWith('sillyStream', {
                region: 'narnia'
            });
            expect(streamUtils.producer).toEqual(mockProducer);
        });
    });
    
    describe('produceEvent', function() {
        it('should reject if the producer has not been created', function(done) {
            streamUtils.produceEvent().catch(function(error) {
                expect(error).toBeDefined();
                expect(mockProducer.produce).not.toHaveBeenCalled();
            }).then(done, done.fail);
        });
        
        it('should reject if producing fails', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q.reject('epic fail'));
            streamUtils.produceEvent('').catch(function(error) {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(error).toBe('epic fail');
            }).then(done, done.fail);
        });

        it('should produce an event with the given event name', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened').then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].type).toBe('somethingHappened');
            }).then(done, done.fail);
        });
        
        it('should produce an event with the date defaulted', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened').then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data).toEqual({
                    date: jasmine.any(Date)
                });
            }).then(done, done.fail);
        });
        
        it('should allow overriding the default date', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', { date: 'date' }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data.date).toBe('date')
            }).then(done, done.fail);
        });
        
        it('should allow specifying new data values', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', { foo: 'bar' }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data.foo).toBe('bar')
            }).then(done, done.fail);
        });
    });
});
