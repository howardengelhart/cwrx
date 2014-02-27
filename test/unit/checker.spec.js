var flush = true;
describe('Checker', function() {
    var Checker;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        Checker  = require('../../lib/checker');
    });

    describe('initialization', function() {
        beforeEach(function() {
            spyOn(Checker, 'validateForbidden');
            spyOn(Checker, 'validateCondForbidden');
        });
        
        it('should correctly initialize a checker', function() {
            var condForbidden = { c: function() {} };
            var checker = new Checker(['a', 'b'], condForbidden);
            expect(checker._forbidden).toEqual(['a', 'b']);
            expect(checker._condForbidden).toBe(condForbidden);
            expect(Checker.validateForbidden).toHaveBeenCalledWith(['a', 'b']);
            expect(Checker.validateCondForbidden).toHaveBeenCalledWith(condForbidden);
        });
        
        it('should initialize a checker with only forbidden or condForbidden', function() {
            var condForbidden = { c: function() {} },
                checker;
            expect(function() { checker = new Checker(['a', 'b']); }).not.toThrow();
            expect(checker._forbidden).toEqual(['a', 'b']);
            expect(checker._condForbidden).toEqual({});
            expect(function() { checker = new Checker(null, condForbidden); }).not.toThrow();
            expect(checker._forbidden).toEqual([]);
            expect(checker._condForbidden).toEqual(condForbidden);
            expect(Checker.validateForbidden.calls.length).toBe(2);
            expect(Checker.validateForbidden.calls[0].args).toEqual([['a', 'b']]);
            expect(Checker.validateForbidden.calls[1].args).toEqual([[]]);
            expect(Checker.validateCondForbidden.calls.length).toBe(2);
            expect(Checker.validateCondForbidden.calls[0].args).toEqual([{}]);
            expect(Checker.validateCondForbidden.calls[1].args).toEqual([condForbidden]);
        });
        
        it('should throw an error if neither forbidden nor condForbidden are defined', function() {
            var msg = 'Cannot create a checker with no fields to check for';
            expect(function() { new Checker(); }).toThrow(msg);
            expect(function() { new Checker(null, null); }).toThrow(msg);
        });
    });
    
    describe('validateForbidden', function() {
        it('should throw an error if the param is not an array', function() {
            var msg = 'forbidden must be an array';
            expect(function() { Checker.validateForbidden('foo') }).toThrow(msg);
            expect(function() { Checker.validateForbidden(1) }).toThrow(msg);
            expect(function() { Checker.validateForbidden({foo: 'bar'}) }).toThrow(msg);
            expect(function() { Checker.validateForbidden() }).toThrow(msg);
        });
        
        it('should throw an error if the values are not all strings', function() {
            var msg = 'forbidden must be an array of strings';
            expect(function() { Checker.validateForbidden([1, 2, 3]) }).toThrow(msg);
            expect(function() { Checker.validateForbidden(['a', 1, {}]) }).toThrow(msg);
            expect(function() { Checker.validateForbidden(['a', 'b', 5]) }).toThrow(msg);
        });
        
        it('should do nothing otherwise', function() {
            expect(function() { Checker.validateForbidden(['a', 'b', 'c']) }).not.toThrow();
            expect(function() { Checker.validateForbidden(['a']) }).not.toThrow();
            expect(function() { Checker.validateForbidden([]) }).not.toThrow();
        });
    });
    
    describe('validateCondForbidden', function() {
        it('should throw an error if the param is not an object', function() {
            var msg = 'condForbidden must be an object';
            expect(function() { Checker.validateCondForbidden('foo') }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden(1) }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden() }).toThrow(msg);
        });
        
        it('should throw an error if the values are not all functions', function() {
            var msg = 'values of condForbidden must all be functions';
            expect(function() { Checker.validateCondForbidden({foo: 'bar'}) }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden({foo: 1}) }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden({foo: {}}) }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden([1, 2, 3]) }).toThrow(msg);
            expect(function() { Checker.validateCondForbidden({ foo: 1, f: function() {} }) })
                .toThrow(msg);
        });
        
        it('should do nothing otherwise', function() {
            expect(function() { Checker.validateCondForbidden({}) }).not.toThrow();
            expect(function() { Checker.validateCondForbidden({ f: function() {} }) }).not.toThrow();
        });
    });
    
    describe('check', function() {
        it('should return false if any of the params are undefined or not objects', function() {
            var c = new Checker([], {});
            expect(c.check()).toBe(false);
            expect(c.check({}, {}, null)).toBe(false);
            expect(c.check({}, null, {})).toBe(false);
            expect(c.check(null, {}, {})).toBe(false);
            expect(c.check({}, {}, 'a')).toBe(false);
            expect(c.check({}, 'a', {})).toBe(false);
            expect(c.check('a', {}, {})).toBe(false);
            expect(c.check({}, {}, {})).toBe(true);
        });
        
        it('should return false if the update object contains forbidden fields', function() {
            var c = new Checker(['a', 'b']);
            expect(c.check({a: 1, c: 2}, {}, {})).toBe(false);
            expect(c.check({b: 1, c: 2}, {}, {})).toBe(false);
            expect(c.check({d: 1, c: 2}, {}, {})).toBe(true);
        });
        
        it('should return false if the update object contains conditonally forbidden fields', function() {
            var fooSpy = jasmine.createSpy('foo').andReturn(true);
            var barSpy = jasmine.createSpy('bar').andReturn(false);
            var c = new Checker(null, { foo: fooSpy, bar: barSpy });
            expect(c.check({foo: 1, bar: 2}, { a: 1}, { b: 2})).toBe(false);
            expect(fooSpy).toHaveBeenCalledWith({foo: 1, bar: 2}, { a: 1}, { b: 2});
            expect(barSpy).toHaveBeenCalledWith({foo: 1, bar: 2}, { a: 1}, { b: 2});
            expect(c.check({foo: 2}, { a: 1}, { b: 2})).toBe(true);
            fooSpy.andReturn(false);
            expect(c.check({foo: 1}, { a: 1}, { b: 2})).toBe(false);
        });
    });
});
