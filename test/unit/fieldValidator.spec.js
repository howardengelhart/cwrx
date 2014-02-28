var flush = true;
describe('FieldValidator', function() {
    var FieldValidator, enums;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        FieldValidator  = require('../../lib/fieldValidator');
        enums    = require('../../lib/enums');
        Scope    = enums.Scope;
    });

    describe('initialization', function() {
        it('should correctly initialize a validator', function() {
            var cF = { c: function() {} };
            var v = new FieldValidator({forbidden: ['a', 'b'], condForbidden: cF});
            expect(v._forbidden).toEqual(['a', 'b']);
            expect(v._condForbidden).toBe(cF);
        });
        
        it('should initialize a validator with only forbidden or condForbidden', function() {
            var cF = { c: function() {} },
                v;
            expect(function() { v = new FieldValidator({forbidden: ['a', 'b']}); }).not.toThrow();
            expect(v._forbidden).toEqual(['a', 'b']);
            expect(v._condForbidden).toEqual({});
            expect(function() { v = new FieldValidator({condForbidden: cF}); }).not.toThrow();
            expect(v._forbidden).toEqual([]);
            expect(v._condForbidden).toEqual(cF);
        });
        
        it('should throw an error if neither forbidden nor condForbidden are defined', function() {
            var msg = 'Cannot create a FieldValidator with no fields to validate';
            expect(function() { new FieldValidator({}); }).toThrow(msg);
            expect(function() { new FieldValidator(); }).toThrow(msg);
        });
    });
    
    describe('validate', function() {
        it('should return false if any of the params are undefined or not objects', function() {
            var v =  new FieldValidator({forbidden: [], condForbidden: {}});
            expect(v.validate()).toBe(false);
            expect(v.validate({}, {}, null)).toBe(false);
            expect(v.validate({}, null, {})).toBe(false);
            expect(v.validate(null, {}, {})).toBe(false);
            expect(v.validate({}, {}, 'a')).toBe(false);
            expect(v.validate({}, 'a', {})).toBe(false);
            expect(v.validate('a', {}, {})).toBe(false);
            expect(v.validate({}, {}, {})).toBe(true);
        });
        
        it('should return false if the update object contains forbidden fields', function() {
            var v =  new FieldValidator({forbidden: ['a', 'b']});
            expect(v.validate({a: 1, c: 2}, {}, {})).toBe(false);
            expect(v.validate({b: 1, c: 2}, {}, {})).toBe(false);
            expect(v.validate({d: 1, c: 2}, {}, {})).toBe(true);
        });
        
        it('should return false if the update object contains conditonally forbidden fields', function() {
            var fooSpy = jasmine.createSpy('foo').andReturn(true);
            var barSpy = jasmine.createSpy('bar').andReturn(false);
            var v =  new FieldValidator({ condForbidden: { foo: fooSpy, bar: barSpy } });
            expect(v.validate({foo: 1, bar: 2}, { a: 1}, { b: 2})).toBe(false);
            expect(fooSpy).toHaveBeenCalledWith({foo: 1, bar: 2}, { a: 1}, { b: 2});
            expect(barSpy).toHaveBeenCalledWith({foo: 1, bar: 2}, { a: 1}, { b: 2});
            expect(v.validate({foo: 2}, { a: 1}, { b: 2})).toBe(true);
            fooSpy.andReturn(false);
            expect(v.validate({foo: 1}, { a: 1}, { b: 2})).toBe(false);
        });
    });
    
    describe('eqFieldFunc', function() {
        it('should return a funciton that checks updates[field] === requester[field', function() {
            var func = FieldValidator.eqFieldFunc('id');
            expect(func({id: 'u-1'}, {}, {id: 'u-1', foo: 'bar'})).toBe(true);
            expect(func({id: 'u-2'}, {}, {id: 'u-1', foo: 'bar'})).toBe(false);
        });
    });
    
    describe('scopeFunc', function() {
        it('should return a function that checks the requester for the given perm level', function() {
            var func = FieldValidator.scopeFunc('users', 'create', Scope.All);
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
