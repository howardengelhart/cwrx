var flush = true;
describe('uuid', function() {
    var uuid, fs, crypto, q, events;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid    = require('../../lib/uuid');
        fs      = require('fs-extra');
        q       = require('q');
        events  = require('events');
        crypto  = require('crypto');
    });
    
    describe('hashText', function() {
        it('should create the same random hash for the same text', function() {
            var txt = "abc123",
                hash1 = uuid.hashText(txt),
                hash2 = uuid.hashText(txt);
            
            expect(hash1).toEqual(hash2);
            expect(hash1).not.toEqual(txt);
        });
        
        it('should create different hashes for different text', function() {
            var txt1 = "abc123",
                txt2 = "def456",
                hash1 = uuid.hashText(txt1),
                hash2 = uuid.hashText(txt2);

            expect(hash1).not.toEqual(hash2);
        });
    });
    
    describe('hashFile', function() {
        var fakeStream, fakeHash;
        beforeEach(function() {
            fakeStream = new events.EventEmitter();
            fakeHash = {
                update: jasmine.createSpy('hash.update'),
                digest: jasmine.createSpy('hash.digest').andReturn('hashbrownsaretasty')
            };
            spyOn(fs, 'createReadStream').andReturn(fakeStream);
            spyOn(crypto, 'createHash').andReturn(fakeHash);
        });
        
        it('should read and hash a file', function(done) {
            var promise = uuid.hashFile('/ut/fake');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('data', new Buffer('qwer', 'utf8'));
            fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).toBe('hashbrownsaretasty');
                expect(fs.createReadStream).toHaveBeenCalledWith('/ut/fake');
                expect(fakeHash.update.calls.length).toBe(2);
                expect(fakeHash.update.calls[0].args[0]).toBe('asdf');
                expect(fakeHash.update.calls[1].args[0] instanceof Buffer).toBe(true);
                expect(fakeHash.digest).toHaveBeenCalledWith('hex');
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
        
        it('should reject with an error if the read stream has an error', function(done) {
            var promise = uuid.hashFile('/ut/fake');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('error', 'I GOT A PROBLEM');
            // fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fakeHash.update).toHaveBeenCalledWith('asdf');
                expect(fakeHash.digest).not.toHaveBeenCalled();
                done();
            });
        });
    });

    describe('createUuid',function(){
        it('should exist',function(){
            expect(uuid.createUuid).toBeDefined();
        });

        it('should generate a 40 char uuid',function(){
            expect(uuid.createUuid().length).toEqual(40);
        });

        it('should generate ids only with lowercase alpha numerics',function(){
            expect(uuid.createUuid().match(/[^a-z,0-9]/g)).toBeNull();
        });

        it ('should generate unique ids in a timely manner',function(){
            var count = 10000, ids, dtStart, dtEnd, i, hash = {};

            ids = new Array();
            ids.length = count;

            dtStart = new Date();
            for (i = 0; i  < count; i++){
                ids[i] = uuid.createUuid();
            }
            dtEnd = new Date();

            for (i = 0; i < count; i++){
                hash[ids[i]] = 1;
            }

            i = 0;
            for (var id in hash){
                i++;
            }

            expect(dtEnd.valueOf() - dtStart.valueOf()).toBeLessThan(1000);
            expect(i).toEqual(count);
        });
    });
});

