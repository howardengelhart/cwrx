var flush = true;
describe('FieldValidator', function() {
    var mockLog, logger, FieldValidator, enums;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        FieldValidator  = require('../../lib/fieldValidator');
        enums    = require('../../lib/enums');
        logger   = require('../../lib/logger');
        Scope    = enums.Scope;

        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        spyOn(FieldValidator, 'checkFormat').andCallThrough();
    });

    describe('initialization', function() {
        it('should correctly initialize a validator', function() {
            var cF = { c: function() {} };
            var fmts = { e: 'string' }
            var v = new FieldValidator({forbidden: ['a', 'b'], condForbidden: cF,
                                        required: ['c', 'd'], formats: fmts});
            expect(v._forbidden).toEqual(['a', 'b']);
            expect(v._required).toEqual(['c', 'd']);
            expect(v._condForbidden).toBe(cF);
            expect(v._formats).toBe(fmts);
        });
        
        it('should initialize be able to initialize an empty validator', function() {
            var v;
            expect(function() { v = new FieldValidator(); }).not.toThrow();
            expect(v._forbidden).toEqual([]);
            expect(v._required).toEqual([]);
            expect(v._condForbidden).toEqual({});
            expect(v._formats).toEqual({});
            expect(v.validate({foo: 'bar'}, {}, {})).toBe(true);
        });
    });
    
    describe('checkFormat', function() {
        it('should handle string formats', function() {
            expect(FieldValidator.checkFormat('string', 1)).toBe(false);
            expect(FieldValidator.checkFormat('string', '1')).toBe(true);
            expect(FieldValidator.checkFormat('object', 'a')).toBe(false);
            expect(FieldValidator.checkFormat('object', { foo: 'bar' })).toBe(true);
            expect(FieldValidator.checkFormat('object', [1, 2, '3'])).toBe(true);
        });
        
        it('should handle function formats', function() {
            function MyClass() { this.foo = 'bar'; }
            expect(FieldValidator.checkFormat(Date, 'a')).toBe(false);
            expect(FieldValidator.checkFormat(Date, new Date())).toBe(true);
            expect(FieldValidator.checkFormat(MyClass, { foo: 'bar' })).toBe(false);
            expect(FieldValidator.checkFormat(MyClass, new MyClass())).toBe(true);
        });
        
        it('should handle formats with options', function() {
            expect(FieldValidator.checkFormat({or: ['string', 'number']}, 'a')).toBe(true);
            expect(FieldValidator.checkFormat({or: ['string', 'number']}, 1.5)).toBe(true);
            expect(FieldValidator.checkFormat({or: ['string', 'number']}, true)).toBe(false);
        });
        
        it('should handle array formats', function() {
            expect(FieldValidator.checkFormat(['string'], ['a', 'b'])).toBe(true);
            expect(FieldValidator.checkFormat(['string'], ['a', 1])).toBe(false);
            expect(FieldValidator.checkFormat([{or: ['string', 'number']}], ['a', 1])).toBe(true);
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
        
        it('should return false if the update object does not contain all required fields', function() {
            var v = new FieldValidator({required: ['c', 'd']});
            expect(v.validate({a: 1}, {}, {})).toBe(false);
            expect(v.validate({a: 1, c: 1}, {}, {})).toBe(false);
            expect(v.validate({a: 1, d: 1}, {}, {})).toBe(false);
            expect(v.validate({c: 1, d: 1}, {}, {})).toBe(true);
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
        
        it('should not return false if a forbidden field is unchanged', function() {
            var fooSpy = jasmine.createSpy('foo').andReturn(false);
            var v = new FieldValidator({ forbidden: ['a'], condForbidden: { foo: fooSpy } });
            expect(v.validate({a: 1}, {a: 2}, {})).toBe(false);
            expect(v.validate({a: 2}, {a: 2}, {})).toBe(true);
            expect(v.validate({foo: { val: 'bar' }}, {foo: { val: 'baz' }}, {})).toBe(false);
            expect(v.validate({foo: { val: 'bar' }}, {foo: { val: 'bar' }}, {})).toBe(true);
        });
        
        it('should return false if a field is in the wrong format', function() {
            var v = new FieldValidator({ formats: { a: 'string' } });
            expect(v.validate({a: 1}, {}, {})).toBe(false);
            expect(FieldValidator.checkFormat).toHaveBeenCalledWith('string', 1);
            expect(v.validate({a: '1'}, {}, {})).toBe(true);
            expect(FieldValidator.checkFormat).toHaveBeenCalledWith('string', '1');
        });
    });
    
    describe('eqReqFieldFunc', function() {
        it('should return a funciton that checks updates[field] === requester[field', function() {
            var func = FieldValidator.eqReqFieldFunc('id');
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
    
    describe('orgFunc', function() {
        it('should return a function that validates the org field', function() {
            spyOn(FieldValidator, 'eqReqFieldFunc').andCallThrough();
            spyOn(FieldValidator, 'scopeFunc').andCallThrough();
            var requester = { org: 'o1', permissions: { users: { read: Scope.All, create: Scope.Org } } };
            
            var func = FieldValidator.orgFunc('users', 'create');
            expect(func({foo: 'bar', org: 'o2'}, {}, requester)).toBe(false);
            expect(func({foo: 'bar', org: 'o1'}, {}, requester)).toBe(true);
            requester.permissions.users.create = Scope.All;
            expect(func({foo: 'bar', org: 'o2'}, {}, requester)).toBe(true);
            
            expect(FieldValidator.eqReqFieldFunc).toHaveBeenCalledWith('org');
            expect(FieldValidator.scopeFunc).toHaveBeenCalledWith('users', 'create', Scope.All);
        });
    });
    
    describe('midWare', function() {
        var v, next, done, req;
        beforeEach(function() {
            v = new FieldValidator({forbidden: ['a']});
            spyOn(v, 'validate').andReturn(true);
            next = jasmine.createSpy('next spy');
            done = jasmine.createSpy('done spy');
            req = { body: 'fakeBody', user: 'fakeUser', origObj: 'fakeOrig' };
        });
        
        it('should call next if validate returns true', function() {
            v.midWare(req, next, done);
            expect(next).toHaveBeenCalled();
            expect(done).not.toHaveBeenCalled();
            expect(v.validate).toHaveBeenCalledWith('fakeBody', 'fakeOrig', 'fakeUser');
        });
        
        it('should call done if validate returns false', function() {
            v.validate.andReturn(false);
            v.midWare(req, next, done);
            expect(next).not.toHaveBeenCalled();
            expect(done).toHaveBeenCalledWith({code: 400, body: 'Invalid request body'});
            expect(v.validate).toHaveBeenCalledWith('fakeBody', 'fakeOrig', 'fakeUser');
        });
        
        it('should handle the origObj not being defined', function() {
            delete req.origObj;
            v.midWare(req, next, done);
            expect(next).toHaveBeenCalled();
            expect(done).not.toHaveBeenCalled();
            expect(v.validate).toHaveBeenCalledWith('fakeBody', {}, 'fakeUser');
        });
    });
});
