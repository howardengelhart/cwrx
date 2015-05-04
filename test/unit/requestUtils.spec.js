var flush = true;
describe('requestUtils', function() {
    var requestUtils, fs, q, net, events;
    
    beforeEach(function() {
        jasmine.Clock.useMock();
        // clearTimeout/clearInterval not properly mocked in jasmine-node: https://github.com/mhevery/jasmine-node/issues/276
        spyOn(global, 'clearTimeout').andCallFake(function() {
            return jasmine.Clock.installed.clearTimeout.apply(this, arguments);
        });
        spyOn(global, 'clearInterval').andCallFake(function() {
            return jasmine.Clock.installed.clearInterval.apply(this, arguments);
        });

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        requestUtils    = require('../../lib/requestUtils');
        fs              = require('fs-extra');
        q               = require('q');
        net             = require('net');
        events          = require('events');
    });
    
    describe('qRequest', function() {
        var requestSpy, opts, fakeReq, fakeForm;
        beforeEach(function() {
            delete require.cache[require.resolve('../../lib/requestUtils')];
            requestSpy = jasmine.createSpy('request').andCallFake(function(opts, cb) {
                cb(null, {statusCode: 200}, 'Success!');
                return fakeReq;
            });
            require.cache[require.resolve('request')] = { exports: requestSpy };
            requestUtils = require('../../lib/requestUtils');
            opts = { url: 'http://c6.com' };
            spyOn(fs, 'createReadStream').andReturn('fakeStream');
            fakeForm = { append: jasmine.createSpy('form.append') };
            fakeReq = { form: jasmine.createSpy('req.form').andReturn(fakeForm) };
        });

        it('should make a request and return a promise for the result', function(done) {
            requestUtils.qRequest('get', opts).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 200}, body: 'Success!'});
                expect(requestSpy).toHaveBeenCalledWith({method: 'get', url: 'http://c6.com'}, jasmine.any(Function));
                expect(fakeReq.form).not.toHaveBeenCalled();
                expect(fakeForm.append).not.toHaveBeenCalled();
                expect(fs.createReadStream).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should parse the body as JSON if possible', function(done) {
            requestSpy.andCallFake(function(opts, cb) {
                cb(null, {statusCode: 200}, '{"foo": "bar"}');
            });
            requestUtils.qRequest('get', opts).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 200}, body: {foo: 'bar'}});
                expect(requestSpy).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should allow files to be uploaded with the request', function(done) {
            var files = { file1: 'path1', file2: 'path2' };
            requestUtils.qRequest('get', opts, files).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 200}, body: 'Success!'});
                expect(requestSpy).toHaveBeenCalled();
                expect(fakeReq.form).toHaveBeenCalled();
                expect(fakeForm.append).toHaveBeenCalledWith('file1', 'fakeStream');
                expect(fakeForm.append).toHaveBeenCalledWith('file2', 'fakeStream');
                expect(fs.createReadStream).toHaveBeenCalledWith('path1');
                expect(fs.createReadStream).toHaveBeenCalledWith('path2');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not upload any files if the files param is empty', function(done) {
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 200}, body: 'Success!'});
                expect(requestSpy).toHaveBeenCalled();
                expect(fakeReq.form).not.toHaveBeenCalled();
                expect(fakeForm.append).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if request calls back with an error', function(done) {
            requestSpy.andCallFake(function(opts, cb) {
                cb('I GOT A PROBLEM');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({error: 'I GOT A PROBLEM'});
            }).done(done);
        });
        
        it('should reject if the response is not defined', function(done) {
            requestSpy.andCallFake(function(opts, cb) {
                cb(null, null, 'Success?');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({error: 'Missing response'});
            }).done(done);
        });
        
        it('should reject if the body contains an error property', function(done) {
            requestSpy.andCallFake(function(opts, cb) {
                cb(null, {statusCode: 500, headers: 'fakeHeaders'}, '{"foo": "bar", "error": "Server is borked"}');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code: 500, headers: 'fakeHeaders', body: {foo: 'bar', error: 'Server is borked'}});
            }).done(done);
        });
        
        it('should not necessarily reject if the status code is not 2xx', function(done) {
            requestSpy.andCallFake(function(opts, cb) {
                cb(null, {statusCode: 500}, '{"foo": "bar"}');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 500}, body: {foo: 'bar'}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('portScan', function() {
        var mockSock;
        beforeEach(function() {
            mockSock = new events.EventEmitter();
            mockSock.destroy = jasmine.createSpy('destroy');
            mockSock.setTimeout = jasmine.createSpy('setTimeout').andCallFake(function(delay, fn) {
                var timeout = setTimeout(fn, delay);
                mockSock.on('connect', function() { clearTimeout(timeout); });
                mockSock.on('error', function() { clearTimeout(timeout); });
            });
            spyOn(net, 'connect').andReturn(mockSock);
        });
        
        it('should resolve with true if the connection is made', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.Clock.tick(1000);
            mockSock.emit('connect');
            jasmine.Clock.tick(1001);

            promise.then(function(val) {
                expect(val).toBe(true);
                expect(net.connect).toHaveBeenCalledWith({host: 'host1', port: 80});
                expect(mockSock.setTimeout).toHaveBeenCalledWith(2000, jasmine.any(Function));
                expect(mockSock.destroy.calls.length).toBe(1);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the connection has an error', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.Clock.tick(1000);
            mockSock.emit('error', new Error('I GOT A PROBLEM'));
            jasmine.Clock.tick(1001);

            promise.then(function(val) {
                expect(val).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Connection received error: [Error: I GOT A PROBLEM]');
                expect(mockSock.destroy.calls.length).toBe(1);
            }).done(done);
        });
        
        it('should reject if the connection times out', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.Clock.tick(1000);
            jasmine.Clock.tick(1001);
            mockSock.emit('connect');

            promise.then(function(val) {
                expect(val).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Connection timed out after 2000 ms');
            }).done(done);
        });
    });
});

