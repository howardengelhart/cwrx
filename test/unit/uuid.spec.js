var uuid = require('../../lib/uuid');

describe('uuid', function() {
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

    describe('uuid',function(){
        var id;
        
        beforeEach(function(){
            id = uuid.createUuid();
        });

        it('should exist',function(){
            expect(uuid).toBeDefined();
        });

        it('should generate a 40 char uuid',function(){
            expect(id.length).toEqual(40);
        });

        it('should generate ids only with lowercase alpha numerics',function(){
            expect(id.match(/[^a-z,0-9]/g)).toBeNull();
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

