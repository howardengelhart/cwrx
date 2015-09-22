var flush = true;
describe('objUtils', function() {
    var objUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        objUtils = require('../../lib/objUtils');
    });
    
    describe('isPOJO', function() {
        it('should only return true if the val is a plain old javascript object', function() {
            expect(objUtils.isPOJO(undefined)).toBe(false);
            expect(objUtils.isPOJO(null)).toBe(false);
            expect(objUtils.isPOJO(123)).toBe(false);
            expect(objUtils.isPOJO('asdf')).toBe(false);
            expect(objUtils.isPOJO(new Date())).toBe(false);
            expect(objUtils.isPOJO([1, 2, 3])).toBe(false);
            expect(objUtils.isPOJO({ foo: 'bar' })).toBe(true);
        });
    });

    describe('filter(object, predicate)', function() {
        var object, predicate;
        var result;

        beforeEach(function() {
            object = {
                a: 1,
                b: 2,
                c: 3,
                d: 4,
                e: 5,
                f: 6,
                g: 7,
                h: 8,
                i: 9,
                j: 10
            };
            predicate = jasmine.createSpy('predicate()').andCallFake(function(value) {
                return value > 2 && value < 8;
            });

            result = objUtils.filter(object, predicate);
        });

        it('should call the predicate for each key of the object', function() {
            expect(predicate.callCount).toBe(Object.keys(object).length);
            Object.keys(object).forEach(function(key, index) {
                var call = predicate.calls[index];

                expect(call.args).toEqual([object[key], key, index, object]);
            });
        });

        it('should return a new object containing only the props for which the predicate returned truthy', function() {
            expect(result).not.toBe(object);
            expect(result).toEqual({
                c: 3,
                d: 4,
                e: 5,
                f: 6,
                g: 7
            });
        });
    });
   
    describe('sortObject', function() {
        it('should simply return the obj if not an object', function() {
            expect(objUtils.sortObject('abcd')).toBe('abcd');
            expect(objUtils.sortObject(10)).toBe(10);
        });
        
        it('should recursively sort an object by its keys', function() {
            var obj = {b: 1, a: 2, c: 5};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: 1, c: 5}));
            
            var obj = {b: {f: 3, e: 8}, a: 2, c: [3, 2, 1]};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: {e: 8, f: 3}, c: [3, 2, 1]}));
            
            var obj = {b: [{h: 1, g: 2}, {e: 5, f: 3}], a: 2};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: [{g: 2, h: 1}, {e: 5, f: 3}]}));
        });
        
        it('should be able to handle null fields', function() {
            var obj = {b: 1, a: null}, sorted;
            expect(function() {sorted = objUtils.sortObject(obj);}).not.toThrow();
            expect(sorted).toEqual({a: null, b: 1});
        });
        
        it('should be able to handle dates', function() {
            var now = new Date(),
                obj = { b: 1, a: now },
                sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: now, b: 1}));
        });
    });

    describe('compareObjects', function() {
        it('should perform a deep equality check on two objects', function() {
            var a = { foo: 'bar', arr: [1, 3, 2] }, b = { foo: 'bar', arr: [1, 2, 2] };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            b.arr[1] = 3;
            expect(objUtils.compareObjects(a, b)).toBe(true);
            a.foo = 'baz';
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.foo = 'bar';
            a.data = { user: 'otter' };
            b.data = { user: 'otter', org: 'c6' };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.data.org = 'c6';
            expect(objUtils.compareObjects(a, b)).toBe(true);
        });
    });

    describe('trimNull', function() {
        it('should trim any fields with null values from an object', function() {
            var obj = { a: 1, b: null, nested: { c: null, d: undefined, e: 3 } };
            objUtils.trimNull(obj);
            expect(obj).toEqual({ a: 1, nested: { d: undefined, e: 3 } });
            
            obj = 'foo';
            objUtils.trimNull(obj);
            expect(obj).toBe('foo');
        });
    });
    
    describe('isListDistinct', function() {
        it('should return true if the return true if a list has all distinct elements', function() {
            expect(objUtils.isListDistinct(['a', 'b', 'aa'])).toBe(true);
            expect(objUtils.isListDistinct(['a', 'b', 'a'])).toBe(false);
            expect(objUtils.isListDistinct([1, '1', 2])).toBe(true);
            expect(objUtils.isListDistinct([1, 1, 2])).toBe(false);
        });
        
        it('should return true if the list is undefined', function() {
            expect(objUtils.isListDistinct(undefined)).toBe(true);
        });
    });
    
    describe('extend', function() {
        it('should copy properties from newObj to orig if not defined on orig', function() {
            var orig = { a: 1, b: null },
                newObj = { a: 2, b: 'foo', c: 'bar', d: { foo: 'bar' } };
                
            expect(objUtils.extend(orig, newObj)).toBe(orig);
            expect(orig).toEqual({a: 1, b: null, c: 'bar', d: { foo: 'bar' } });
            expect(orig).not.toBe(newObj);
            expect(orig.d).not.toBe(newObj.d);
        });
        
        it('should handle either param being a non-object', function() {
            var obj = { foo: 'bar' };
            expect(objUtils.extend(obj, 'baz')).toBe(obj);
            expect(objUtils.extend(obj)).toBe(obj);
            expect(obj).toEqual({foo: 'bar'});

            expect(objUtils.extend(null, {foo: 'baz'})).toBe(null);
        });
        
        it('should handle dates properly', function() {
            var orig = { a: new Date('2015-08-03T14:58:50.479Z'), b: {} },
                newObj = { a: 'asdf', b: { c: 'foo', d: new Date('2015-08-03T14:55:22.236Z') } };
                
            expect(objUtils.extend(orig, newObj)).toBe(orig);
            expect(orig).toEqual({ a: new Date('2015-08-03T14:58:50.479Z'), b: { c: 'foo', d: new Date('2015-08-03T14:55:22.236Z') } });
        });
        
        it('should handle other instantiated classes properly', function() {
            var events = require('events'),
                orig = {},
                newObj = { e: new events.EventEmitter() };
            
            expect(objUtils.extend(orig, newObj)).toBe(orig);
            expect(orig).toEqual({ e: jasmine.any(events.EventEmitter) });
            expect(orig.e).toBe(newObj.e);
        });
        
        it('should handle arrays properly', function() {
            var orig = { a: [10, 11], b: {}, d: [{ foo: 'bar' }] },
                newObj = { a: [20, 21, 22], b: { c: [31, 32] }, d: [{ foo: 'baz', blah: 'bloop' }] };
                
            expect(objUtils.extend(orig, newObj)).toBe(orig);
            expect(orig).toEqual({ a: [10, 11, 22], b: { c: [31, 32] }, d: [{ foo: 'bar', blah: 'bloop' }] });
            expect(orig.b.c).not.toBe(newObj.b.c);
        });
    });
});
