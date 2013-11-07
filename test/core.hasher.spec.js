var hasher     = require('../lib/hasher');

describe('hasher', function() {
    describe('hashText', function() {
        it('should create the same random hash for the same text', function() {
            var txt = "abc123",
                hash1 = hasher.hashText(txt),
                hash2 = hasher.hashText(txt);
            
            expect(hash1).toEqual(hash2);
            expect(hash1).not.toEqual(txt);
        });
        
        it('should create different hashes for different text', function() {
            var txt1 = "abc123",
                txt2 = "def456",
                hash1 = hasher.hashText(txt1),
                hash2 = hasher.hashText(txt2);

            expect(hash1).not.toEqual(hash2);
        });
    });
    
    describe('getObjId', function() {
        it('should create a random 16 char id', function() {
            var testObj1 = { uri: 'abc' },
                testObj2 = { uri: 'def' },

                id1 = hasher.getObjId('e', testObj1),
                id2 = hasher.getObjId('e', testObj2);

            expect(id1.match(/^e-/)).toBeTruthy();
            expect(id2.match(/^e-/)).toBeTruthy();
            expect(id1.length).toBe(16);
            expect(id2.length).toBe(16);
            expect(id1).not.toEqual(id2);
        });
        
        it('should still create an id without an input item', function() {
            var id1 = hasher.getObjId('e');
            expect(id1).toBeDefined();
            expect(id1.match(/^e-/)).toBeTruthy();
            expect(id1.length).toBe(16);
        });
    });
});
