describe('uuid',function(){
    var uuid, id;
    
    beforeEach(function(){
        uuid = require('../lib/uuid');
        id = uuid();
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
            ids[i] = uuid();
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



