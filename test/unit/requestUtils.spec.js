var flush = true;
describe('requestUtils', function() {
    var requestUtils, fs, q, net, events;
    
    beforeEach(function() {
        jasmine.clock().install();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        requestUtils    = require('../../lib/requestUtils');
        fs              = require('fs-extra');
        q               = require('q');
        net             = require('net');
        events          = require('events');
    });

    afterEach(function() {
        jasmine.clock().uninstall();
    });
    
    describe('qRequest', function() {
        var requestSpy, opts, fakeReq, fakeForm;
        beforeEach(function() {
            delete require.cache[require.resolve('../../lib/requestUtils')];
            requestSpy = jasmine.createSpy('request').and.callFake(function(opts, cb) {
                cb(null, {statusCode: 200}, 'Success!');
                return fakeReq;
            });
            require.cache[require.resolve('request')] = { exports: requestSpy };
            requestUtils = require('../../lib/requestUtils');
            opts = { url: 'http://c6.com' };
            spyOn(fs, 'createReadStream').and.returnValue('fakeStream');
            fakeForm = { append: jasmine.createSpy('form.append') };
            fakeReq = { form: jasmine.createSpy('req.form').and.returnValue(fakeForm) };
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
            requestSpy.and.callFake(function(opts, cb) {
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
            requestSpy.and.callFake(function(opts, cb) {
                cb('I GOT A PROBLEM');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({error: 'I GOT A PROBLEM'});
            }).done(done);
        });
        
        it('should reject if the response is not defined', function(done) {
            requestSpy.and.callFake(function(opts, cb) {
                cb(null, null, 'Success?');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({error: 'Missing response'});
            }).done(done);
        });
        
        it('should reject if the body contains an error property', function(done) {
            requestSpy.and.callFake(function(opts, cb) {
                cb(null, {statusCode: 500, headers: 'fakeHeaders'}, '{"foo": "bar", "error": "Server is borked"}');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual({code: 500, headers: 'fakeHeaders', body: {foo: 'bar', error: 'Server is borked'}});
            }).done(done);
        });
        
        it('should not necessarily reject if the status code is not 2xx', function(done) {
            requestSpy.and.callFake(function(opts, cb) {
                cb(null, {statusCode: 500}, '{"foo": "bar"}');
            });
            requestUtils.qRequest('get', opts, {}).then(function(resp) {
                expect(resp).toEqual({response: {statusCode: 500}, body: {foo: 'bar'}});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        describe('if it receives a 202 status', function() {
            var jobPolling, callCount;
            beforeEach(function() {
                jobPolling = { maxAttempts: 4, delay: 1000 };
                callCount = 0;
                requestSpy.and.callFake(function(opts, cb) {
                    if (!!opts.url.match(/\/api\/job\/1234/)) {
                        callCount++;
                        if (callCount >= 3) {
                            cb(null, { statusCode: 200 }, 'Success!');
                            return fakeReq;
                        }
                    }

                    cb(null, { statusCode: 202 }, '{ "url": "/api/job/1234" }');
                    return fakeReq;
                });
                spyOn(requestUtils, 'qRequest').and.callThrough();
            });
            
            it('should repeatedly poll for the job result', function(done) {
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                expect(requestUtils.qRequest.calls.count()).toBe(1);
                jasmine.clock().tick(1001);
                expect(requestUtils.qRequest.calls.count()).toBe(2);
                jasmine.clock().tick(1001);
                expect(requestUtils.qRequest.calls.count()).toBe(3);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).toEqual({ response: { statusCode: 200 }, body: 'Success!' });
                    expect(requestSpy.calls.count()).toBe(4);
                    expect(requestUtils.qRequest.calls.count()).toBe(4);
                    expect(requestUtils.qRequest.calls.all()[0].args).toEqual(['get',
                        { url: 'http://c6.com', method: 'get' }, null, jobPolling]);
                    for (var i = 1; i <= 3; i++) {
                        expect(requestUtils.qRequest.calls.all()[i].args).toEqual(['get',
                            { url: 'http://c6.com/api/job/1234', method: 'get' }, null, jobPolling]);
                    }
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should fully match the host and protocol of the original request for job result requests', function(done) {
                opts.url = 'https://localhost:3300/api/content/foo?q=bloop&preview=yes';
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).toEqual({ response: { statusCode: 200 }, body: 'Success!' });
                    expect(requestSpy.calls.count()).toBe(4);
                    expect(requestUtils.qRequest.calls.count()).toBe(4);
                    for (var i = 1; i <= 3; i++) {
                        expect(requestUtils.qRequest.calls.all()[i].args[1].url).toEqual('https://localhost:3300/api/job/1234');
                    }
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject if the maxAttempts are exceeded before a non-202 status is returned', function(done) {
                jobPolling.maxAttempts = 2;
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toBe('Timed out getting job result after 2 attempts');
                    expect(requestSpy.calls.count()).toBe(3);
                    expect(requestUtils.qRequest.calls.count()).toBe(3);
                }).done(done);
            });
            
            it('should just return normally if jobPolling is disabled', function(done) {
                jobPolling.enabled = false;
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).toEqual({ response: { statusCode: 202 }, body: { url: '/api/job/1234' }});
                    expect(requestSpy.calls.count()).toBe(1);
                    expect(requestUtils.qRequest.calls.count()).toBe(1);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should just return normally if no url is included in the 202 response\'s body', function(done) {
                requestSpy.and.callFake(function(opts, cb) {
                    cb(null, {statusCode: 202}, { foo: 'bar' });
                });
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).toEqual({ response: { statusCode: 202 }, body: { foo: 'bar' }});
                    expect(requestSpy.calls.count()).toBe(1);
                    expect(requestUtils.qRequest.calls.count()).toBe(1);
                }).catch(function(error) {
                    expect(error.toString()).not.toBeDefined();
                }).done(done);
            });
            
            it('should reject the original promise if a job result request fails', function(done) {
                requestSpy.and.callFake(function(opts, cb) {
                    if (!!opts.url.match(/\/api\/job\/1234/)) {
                        callCount++;
                        if (callCount >= 2) {
                            cb(null, {statusCode: 500}, '{"error": "Server is borked"}');
                            return fakeReq;
                        } else if (callCount >= 3) {
                            cb(null, { statusCode: 200 }, 'Success!');
                            return fakeReq;
                        }
                    }

                    cb(null, { statusCode: 202 }, { url: '/api/job/1234' });
                    return fakeReq;
                });
                var promise = requestUtils.qRequest('get', opts, null, jobPolling);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                jasmine.clock().tick(1001);
                
                promise.then(function(resp) {
                    expect(resp).not.toBeDefined();
                }).catch(function(error) {
                    expect(error).toEqual({code: 500, headers: undefined, body: {error: 'Server is borked'}});
                    expect(requestSpy.calls.count()).toBe(3);
                    expect(requestUtils.qRequest.calls.count()).toBe(3);
                }).done(done);
            });
        });
    });
    
    describe('portScan', function() {
        var mockSock;
        beforeEach(function() {
            mockSock = new events.EventEmitter();
            mockSock.destroy = jasmine.createSpy('destroy');
            mockSock.setTimeout = jasmine.createSpy('setTimeout').and.callFake(function(delay, fn) {
                var timeout = setTimeout(fn, delay);
                mockSock.on('connect', function() { clearTimeout(timeout); });
                mockSock.on('error', function() { clearTimeout(timeout); });
            });
            spyOn(net, 'connect').and.returnValue(mockSock);
        });
        
        it('should resolve with true if the connection is made', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.clock().tick(1000);
            mockSock.emit('connect');
            jasmine.clock().tick(1001);

            promise.then(function(val) {
                expect(val).toBe(true);
                expect(net.connect).toHaveBeenCalledWith({host: 'host1', port: 80});
                expect(mockSock.setTimeout).toHaveBeenCalledWith(2000, jasmine.any(Function));
                expect(mockSock.destroy.calls.count()).toBe(1);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the connection has an error', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.clock().tick(1000);
            mockSock.emit('error', new Error('I GOT A PROBLEM'));
            jasmine.clock().tick(1001);

            promise.then(function(val) {
                expect(val).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Connection received error: [Error: I GOT A PROBLEM]');
                expect(mockSock.destroy.calls.count()).toBe(1);
            }).done(done);
        });
        
        it('should reject if the connection times out', function(done) {
            var promise = requestUtils.portScan('host1', 80, 2000);
            jasmine.clock().tick(1000);
            jasmine.clock().tick(1001);
            mockSock.emit('connect');

            promise.then(function(val) {
                expect(val).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('Connection timed out after 2000 ms');
            }).done(done);
        });
    });
});

