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
            streamUtils.produceEvent('', 'campaign', { }, { code: 200, body: { } }).catch(function(error) {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(error).toBe('epic fail');
            }).then(done, done.fail);
        });

        it('should resolve if the given response is not a successfull one', function(done) {
            streamUtils.producer = mockProducer;
            q.all([
                { code: 100, body: { } },
                { code: 400, body: { } },
                { code: 200, body: 'body' }
            ].map(function(resp) {
                return streamUtils.produceEvent('', 'campaign', { }, resp);
            })).then(function(results) {
                expect(mockProducer.produce).not.toHaveBeenCalled();
                results.forEach(function(result) {
                    expect(result).toBe(false);
                });
            }).then(done, done.fail);
        });

        it('should produce an event with the given event name', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', 'campaign', { }, { code: 200, body: { } }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].type).toBe('somethingHappened');
            }).then(done, done.fail);
        });
        
        it('should produce an event with defaulted data values', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', 'campaign', {
                application: {
                    id: 'app-123'
                }
            }, { code: 200, body: { } }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data).toEqual({
                    date: jasmine.any(Date),
                    application: {
                        id: 'app-123'
                    },
                    campaign: { }
                });
            }).then(done, done.fail);
        });
        
        it('should only produce with data which is defined', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', 'campaign', {
                user: null,
                application: null
            }, { code: 200, body: { } }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data).toEqual({
                    date: jasmine.any(Date),
                    campaign: { }
                });
            }).then(done, done.fail);
        });
        
        it('should allow overriding the default data values', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', 'campaign', { }, { code: 200, body: { } }, { date: 'date' }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data.date).toBe('date')
            }).then(done, done.fail);
        });
        
        it('should allow specifying new data values', function(done) {
            streamUtils.producer = mockProducer;
            mockProducer.produce.and.returnValue(q());
            streamUtils.produceEvent('somethingHappened', 'campaign', { }, { code: 200, body: { } }, { foo: 'bar' }).then(function() {
                expect(mockProducer.produce).toHaveBeenCalled();
                expect(mockProducer.produce.calls.mostRecent().args[0].data.foo).toBe('bar')
            }).then(done, done.fail);
        });
    });
});
