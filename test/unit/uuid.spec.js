var flush = true;
describe('uuid', function() {
    var uuid, fs, crypto, q, events, hostUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        uuid        = require('../../lib/uuid');
        fs          = require('fs-extra');
        q           = require('q');
        events      = require('events');
        crypto      = require('crypto');
        hostUtils   = require('../../lib/hostUtils');
    });
    
    describe('randInt', function() {
        it('should return a random integer', function() {
            var rand = uuid.randInt(100);
            expect(rand >= 0).toBe(true);
            expect(rand <= 100).toBe(true);
        });
        
        it('should handle an undefined max', function() {
            expect(uuid.randInt()).toBe(0);
        });
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
        
        it('should be able to use different hashing algorithms', function() {
            var txt = 'abc123',
                hash1 = uuid.hashText(txt),
                hash2 = uuid.hashText(txt, 'sha256');
                
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
            var promise = uuid.hashFile('/ut/fake');
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
            var promise = uuid.hashFile('/ut/fake', 'sha256');
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
            var promise = uuid.hashFile('/ut/fake');
            fakeStream.emit('data', 'asdf');
            fakeStream.emit('error', 'I GOT A PROBLEM');
            // fakeStream.emit('end');
            
            promise.then(function(hash) {
                expect(hash).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(fakeHash.update).toHaveBeenCalledWith('asdf');
                expect(fakeHash.digest).not.toHaveBeenCalled();
            }).done(done)
        });
    });

    describe('createUuid', function() {
        it('should generate a 16 character id using url-safe characters', function() {
            var id = uuid.createUuid();
            expect(id.length).toEqual(16);
            expect(id).toMatch(/^[0-9a-zA-Z~!]{16}$/);
        });
        
        it('should not return duplicate ids when many calls are made', function() {
            var ids = {};
            for (var i = 0; i < 1000; i++) {
                var id = uuid.createUuid();
                expect(ids[id]).not.toBeDefined();
                ids[id] = true;
            }
        });
        
        //TODO: more tests?

        xit ('should generate unique ids in a timely manner',function(){ // TODO: should this still be a thing?
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
    
    describe('internal Generator', function() {
        //TODO: test counter start/max?
        
        describe('capValue', function() {
        
        });
        
        describe('getMachineId', function() {
            beforeEach(function() {
                spyOn(hostUtils, 'getIp').and.returnValue('1.2.3.4');
            });
            
            
        });
        
        describe('encode', function() {
        
        });
        
        describe('decode', function() {
        
        });
        
        describe('generate', function() {
        
        });
        
        describe('parse', function() {
        
        });
    });
    
    describe('parseUuid', function() { //TODO
    
    });
    
    describe('randomUuid', function() {
        it('should generate an id using url-safe characters', function() {
            var id = uuid.randomUuid();
            expect(id.length).toEqual(20);
            expect(id).toMatch(/^[0-9a-zA-Z~!]{20}$/);
        });
        
        it('should allow generating an id of a custom length', function() {
            var id = uuid.randomUuid(100);
            expect(id.length).toEqual(100);
            expect(id).toMatch(/^[0-9a-zA-Z~!]{100}$/);
        });
    });
});

