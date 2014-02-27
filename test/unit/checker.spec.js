var flush = true;
describe('Checker', function() {
    var Checker, enums;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        Checker  = require('../../lib/checker');
        enums    = require('../../lib/enums');
        Scope    = enums.Scope;
    });

    describe('initialization', function() {
        it('should correctly initialize a checker', function() {
            var condForbidden = { c: function() {} };
            var checker = new Checker(['a', 'b'], condForbidden);
            expect(checker._forbidden).toEqual(['a', 'b']);
            expect(checker._condForbidden).toBe(condForbidden);
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
        });
        
        it('should throw an error if neither forbidden nor condForbidden are defined', function() {
            var msg = 'Cannot create a checker with no fields to check for';
            expect(function() { new Checker(); }).toThrow(msg);
            expect(function() { new Checker(null, null); }).toThrow(msg);
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
    
    describe('eqFieldFunc', function() {
        it('should return a funciton that checks updates[field] === requester[field', function() {
            var func = Checker.eqFieldFunc('id');
            expect(func({id: 'u-1'}, {}, {id: 'u-1', foo: 'bar'})).toBe(true);
            expect(func({id: 'u-2'}, {}, {id: 'u-1', foo: 'bar'})).toBe(false);
        });
    });
    
    describe('scopeFunc', function() {
        it('should return a function that checks the requester for the given perm level', function() {
            var func = Checker.scopeFunc('users', 'create', Scope.All);
            var requester = { permissions: { users: { create: Scope.All } } };
            expect(func({}, {}, requester)).toBe(true);
            requester.permissions.users.create = Scope.Org;
            expect(func({}, {}, requester)).toBe(false);
            delete requester.permissions.users.create;
            expect(func({}, {}, requester)).toBe(false);
            delete requester.permissions.users;
            expect(func({}, {}, requester)).toBe(false);
            delete requester.permissions;
            expect(func({}, {}, requester)).toBe(false);            
        });
    });
});
