var flush = true;
describe('s3util', function() {
    var s3util, fs, q, events;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        s3util  = require('../../lib/s3util');
        fs      = require('fs-extra');
        events  = require('events');
        q       = require('q');
    });
    
    describe('getObject', function() {
        var s3, params;
        beforeEach(function() {
            params = { Key: 'path/to/file', Bucket: 'bkt' };
            s3 = {
                getObject: jasmine.createSpy('s3.getObject').and.callFake(function(params, cb) {
                    cb(null, { Body: 'thisisafile', name: 'fakeData' });
                })
            };
            spyOn(fs, 'writeFile').and.callFake(function(fpath, data, cb) {
                cb();
            });
        });
        
        it('should get a file and write it to disk', function(done) {
            s3util.getObject(s3, '/a/test/file', params).then(function(data) {
                expect(data).toEqual({name: 'fakeData', s3util: { localFile: '/a/test/file' } });
                expect(s3.getObject).toHaveBeenCalled();
                expect(s3.getObject.calls.all()[0].args[0]).toEqual({Key:'path/to/file', Bucket:'bkt'});
                expect(fs.writeFile).toHaveBeenCalled();
                expect(fs.writeFile.calls.all()[0].args[0]).toEqual('/a/test/file');
                expect(fs.writeFile.calls.all()[0].args[1]).toEqual('thisisafile');
                done();
            }).catch(function(error) {
                expect(error.toString()).toBeDefined();
                done();
            });
        });
        
        it('should fail if getting the file from s3 fails', function(done) {
            s3.getObject.and.callFake(function(params, cb) { cb('I GOT A PROBLEM'); });
            s3util.getObject(s3, '/a/test/file', params).then(function(data) {
                expect(data).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(s3.getObject).toHaveBeenCalled();
                expect(fs.writeFile).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if writing the file to disk fails', function(done) {
            fs.writeFile.and.callFake(function(fpath, data, cb) { cb('I GOT A PROBLEM'); });
            s3util.getObject(s3, '/a/test/file', params).then(function(data) {
                expect(data).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(s3.getObject).toHaveBeenCalled();
                expect(fs.writeFile).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('putObject', function() {
        var s3, params, fakeStream;
        beforeEach(function() {
            params = { Key: 'path/to/file', Bucket: 'bkt' };
            s3 = {
                putObject: jasmine.createSpy('s3.getObject').and.callFake(function(params, cb) {
                    cb(null, 'some data');
                })
            };
            fakeStream = new events.EventEmitter();
            spyOn(fs, 'createReadStream').and.returnValue(fakeStream);
        });
        
        it('should read a local file and upload it to s3', function(done) {
            var promise = s3util.putObject(s3, '/a/test/file', params);
            fakeStream.emit('readable');
            promise.then(function(response) {
                expect(response).toBe('some data');
                expect(fs.createReadStream).toHaveBeenCalledWith('/a/test/file');
                expect(s3.putObject).toHaveBeenCalled();
                expect(s3.putObject.calls.all()[0].args[0])
                    .toEqual({Key: 'path/to/file', Bucket: 'bkt', Body: fakeStream});
                done();
            }).catch(function(error) {
                expect(error.toString()).toBeDefined();
                done();
            });
        });
        
        it('should fail if reading the local file fails', function(done) {
            var deferred = q.defer();
            s3.putObject.and.callFake(function(params, cb) {
                deferred.promise.then(function() { cb(null, 'data') });
            });
            var promise = s3util.putObject(s3, '/a/test/file', params);
            fakeStream.emit('readable');
            fakeStream.emit('error', 'I GOT A PROBLEM');
            deferred.resolve();
            
            promise.then(function(response) {
                expect(response).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.createReadStream).toHaveBeenCalled();
                done();
            });
        });
        
        it('should fail if uploading the file fails', function(done) {
            s3.putObject.and.callFake(function(params, cb) { cb('I GOT A PROBLEM', 'data'); });
            var promise = s3util.putObject(s3, '/a/test/file', params);
            fakeStream.emit('readable');
            promise.then(function(response) {
                expect(response).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fs.createReadStream).toHaveBeenCalled();
                expect(s3.putObject).toHaveBeenCalled();
                done();
            });
        });
    });
});

