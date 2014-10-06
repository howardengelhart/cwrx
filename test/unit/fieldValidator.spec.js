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
    });

    describe('initialization', function() {
        it('should correctly initialize a validator', function() {
            var cF = { c: function() {} };
            var v = new FieldValidator({forbidden: ['a', 'b'], condForbidden: cF, required: ['c', 'd']});
            expect(v._forbidden).toEqual(['a', 'b']);
            expect(v._required).toEqual(['c', 'd']);
            expect(v._condForbidden).toBe(cF);
        });
        
        it('should initialize a validator with only one of the three restriction sets', function() {
            var cF = { c: function() {} },
                v;
            expect(function() { v = new FieldValidator({forbidden: ['a', 'b']}); }).not.toThrow();
            expect(v._forbidden).toEqual(['a', 'b']);
            expect(v._required).toEqual([]);
            expect(v._condForbidden).toEqual({});
            expect(function() { v = new FieldValidator({condForbidden: cF}); }).not.toThrow();
            expect(v._forbidden).toEqual([]);
            expect(v._condForbidden).toEqual(cF);
            expect(v._required).toEqual([]);
            expect(function() { v = new FieldValidator({required: ['c', 'd']}); }).not.toThrow();
            expect(v._forbidden).toEqual([]);
            expect(v._condForbidden).toEqual({});
            expect(v._required).toEqual(['c', 'd']);
        });
        
        it('should throw an error if no restriction sets are defined', function() {
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
            expect(mockLog.warn).toHaveBeenCalled();
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
