var flush = true;
describe('uuid', function() {
    var uuid, fs, crypto, q, events, hostUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        hashUtils   = require('../../lib/hashUtils');
        fs          = require('fs-extra');
        q           = require('q');
        events      = require('events');
        crypto      = require('crypto');
    });
    
    describe('hashText', function() {
        it('should create the same random hash for the same text', function() {
            var txt = 'abc123',
                hash1 = hashUtils.hashText(txt),
                hash2 = hashUtils.hashText(txt);
            
            expect(hash1).toEqual(hash2);
            expect(hash1).not.toEqual(txt);
        });
        
        it('should create different hashes for different text', function() {
            var txt1 = 'abc123',
                txt2 = 'def456',
                hash1 = hashUtils.hashText(txt1),
                hash2 = hashUtils.hashText(txt2);

            expect(hash1).not.toEqual(hash2);
        });
        
        it('should be able to use different hashing algorithms', function() {
            var txt = 'abc123',
                hash1 = hashUtils.hashText(txt),
                hash2 = hashUtils.hashText(txt, 'sha256');
                
            expect(hash1).not.toEqual(hash2);
        });
    });
    
    describe('hashFile', function() {
        var fakeStream, fakeHash;
        beforeEach(function() {
            fakeStream = new events.EventEmitter();
            fakeHash = {
                update: jasmine.createSpy('hash.update'),
                digest: jasmine.createSpy('hash.digest').and.returnValue('hashbrownsaretasty')
            };
            spyOn(fs, 'createReadStream').and.returnValue(fakeStream);
            spyOn(crypto, 'createHash').and.returnValue(fakeHash);
        });
        
        it('should read and hash a file', function(done) {
            var promise = hashUtils.hashFile('/ut/fake');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('data', new Buffer('qwer', 'utf8'));
            fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).toBe('hashbrownsaretasty');
                expect(fs.createReadStream).toHaveBeenCalledWith('/ut/fake');
                expect(crypto.createHash).toHaveBeenCalledWith('md5');
                expect(fakeHash.update.calls.count()).toBe(2);
                expect(fakeHash.update.calls.all()[0].args[0]).toBe('asdf');
                expect(fakeHash.update.calls.all()[1].args[0] instanceof Buffer).toBe(true);
                expect(fakeHash.digest).toHaveBeenCalledWith('hex');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should be able to use different hashing algorithms', function(done) {
            var promise = hashUtils.hashFile('/ut/fake', 'sha256');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('data', new Buffer('qwer', 'utf8'));
            fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).toBe('hashbrownsaretasty');
                expect(crypto.createHash).toHaveBeenCalledWith('sha256');
                expect(fakeHash.update.calls.count()).toBe(2);
                expect(fakeHash.digest).toHaveBeenCalledWith('hex');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject with an error if the read stream has an error', function(done) {
            var promise = hashUtils.hashFile('/ut/fake');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('error', 'I GOT A PROBLEM');
            // fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fakeHash.update).toHaveBeenCalledWith('asdf');
                expect(fakeHash.digest).not.toHaveBeenCalled();
            }).done(done);
        });
    });
});

