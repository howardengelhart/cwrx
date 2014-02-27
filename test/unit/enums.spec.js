var flush = true;
describe('enums', function() {
    var enums;
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        enums = require('../../lib/enums');
    });
    
    it('should define constants correctly', function() {
        expect(enums.Status.Active).toBe('active');
        expect(enums.Status.Inactive).toBe('inactive');
        expect(enums.Status.Pending).toBe('pending');
        expect(enums.Status.Deleted).toBe('deleted');
        expect(enums.Access.Public).toBe('public');
        expect(enums.Access.Private).toBe('private');
        expect(enums.Scope.Own).toBe('own');
        expect(enums.Scope.Org).toBe('org');
        expect(enums.Scope.All).toBe('all');
    });
    
    it('should be frozen', function() {
        enums.Access.Public = 'foo';
        expect(enums.Access.Public).toBe('public');
        delete enums.Status.Pending;
        expect(enums.Status.Pending).toBe('pending');
        var fakeFunc = function() { console.log('i\'m in ur enums messing up ur scopes'); };
        enums.Scope.getVal = fakeFunc;
        expect(enums.Scope.getVal).not.toBe(fakeFunc);
        enums.Foo = { blah: 'bloop' };
        expect(enums.Foo).not.toBeDefined();
    });
    
    describe('Scope.getVal', function() {
        it('should successfully translate strings to values', function() {
            expect(enums.Scope.getVal('own')).toBe(1);
            expect(enums.Scope.getVal('org')).toBe(2);
            expect(enums.Scope.getVal('all')).toBe(3);
            expect(enums.Scope.getVal('foo')).toBe(0);
            expect(enums.Scope.getVal({ foo: 'bar'})).toBe(0);
            expect(enums.Scope.getVal(undefined)).toBe(0);
            expect(enums.Scope.getVal(null)).toBe(0);
        });
    });
});
