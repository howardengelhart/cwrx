
describe('parser.parseNVPStr test suite',function(){
    var parser,
        testStr1 = 'abc=1;def=2;ghi=3';
    
    beforeEach(function(){
        parser = require('../lib/parser');
    });

    it('parser.parseNVPStr should exist',function(){
        expect(parser).toBeDefined();
        expect(parser.parseNVPStr).toBeDefined();
    });

    it('should parse with default delims and obj output',function(){
        var obj = parser.parseNVPStr(testStr1);
        expect(obj.abc).toEqual('1');
        expect(obj.def).toEqual('2');
        expect(obj.ghi).toEqual('3');
    });

    it('should throw an exception if a closing delim is required and not found',function(){
        expect(function(){ 
            parser.parseNVPStr(testStr1,{'requireClosingDelim' : true});
        }).toThrow('outer delim[59] not found at [17] [index=2]');
    });

    it('should parse using startAt/endAt options',function(){
        var obj = parser.parseNVPStr(testStr1,{startAt : 6, endAt : -6});
        expect(Object.keys(obj).length).toEqual(1);
        expect(obj.def).toEqual('2');
    });

});


