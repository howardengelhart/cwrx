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
    });
    
    describe('parseUuid', function() {
        it('should be able to parse the components of uuid strings', function() {
            expect(uuid.parseUuid('0Gz38h0004azV4dM')).toEqual({
                machineId   : 2723,
                ip          : '?.?.10.163',
                processId   : 12817,
                ts          : jasmine.any(Date),
                counter     : 17264
            });
            expect(uuid.parseUuid('0Gz38h0004azV4dM').ts.toString()).toBe('Mon Feb 22 2016 17:50:33 GMT-0500 (EST)');

            expect(uuid.parseUuid('f!!!!!!!!!!!!!!!')).toEqual({
                machineId   : 65535,
                ip          : '?.?.255.255',
                processId   : 262143,
                ts          : jasmine.any(Date),
                counter     : 262143
            });
            expect(uuid.parseUuid('f!!!!!!!!!!!!!!!').ts.toString()).toBe('Mon Jul 07 2155 02:07:32 GMT-0400 (EDT)');
        });
        
        it('should throw an error if the string is not a valid uuid', function() {
            var msg = 'str is not a valid uuid';
            expect(function() { uuid.parseUuid('foo') }).toThrow(new Error(msg));
            expect(function() { uuid.parseUuid('1234567890abcdefg') }).toThrow(new Error(msg));
            expect(function() { uuid.parseUuid('1234567890abcde*') }).toThrow(new Error(msg));
        });
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

    describe('internal generator', function() {
        describe('capValue', function() {
            it('should cap a value if larger than max possible for the given uuid component', function() {
                expect(uuid.generator.capValue(1000, 'machineId')).toBe(1000);
                expect(uuid.generator.capValue(10000000000, 'machineId')).toBe(254976);
                expect(uuid.generator.capValue(10000000000, 'ts')).toBe(10000000000);
                expect(uuid.generator.capValue(999999999999999999, 'ts')).toBe(2970630750208);
            });
        });
        
        describe('getMachineId', function() {
            beforeEach(function() {
                spyOn(hostUtils, 'getIp');
            });
            
            it('should return a number computed from the last two sections of the ip', function() {
                hostUtils.getIp.and.returnValue('10.0.0.123');
                expect(uuid.generator.getMachineId()).toBe(123);

                hostUtils.getIp.and.returnValue('11.12.0.123');
                expect(uuid.generator.getMachineId()).toBe(123);

                hostUtils.getIp.and.returnValue('10.0.1.123');
                expect(uuid.generator.getMachineId()).toBe(379);

                hostUtils.getIp.and.returnValue('10.0.255.255');
                expect(uuid.generator.getMachineId()).toBe(65535);
            });
        });
        
        describe('encode', function() {
            it('should encode values into strings for each component type', function() {
                expect(uuid.generator.encode(200000, 'machineId')).toBe('MR0');
                expect(uuid.generator.encode(100000, 'processId')).toBe('oqw');
                expect(uuid.generator.encode(3666666666666, 'ts')).toBe('RmSnjGG');
                expect(uuid.generator.encode(166666, 'counter')).toBe('EIa');
            });
            
            it('should be able to pad the strings if not long enough', function() {
                expect(uuid.generator.encode(1, 'machineId')).toBe('001');
                expect(uuid.generator.encode(100, 'processId')).toBe('01A');
                expect(uuid.generator.encode(100000, 'ts')).toBe('0000oqw');
                expect(uuid.generator.encode(1000, 'counter')).toBe('0fE');
            });
        });
        
        describe('decode', function() {
            it('should decode strings into integers', function() {
                expect(uuid.generator.decode('MR0')).toBe(200000);
                expect(uuid.generator.decode('000001')).toBe(1);
                expect(uuid.generator.decode('FOO!')).toBe(10955967);
                expect(uuid.generator.decode('evan')).toBe(3797655);
            });
        });
    });
});

